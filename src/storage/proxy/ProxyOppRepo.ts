import type {
  ISourceClient,
  IOppRepo,
  OpportunitySearchParams,
  PaginatedResult,
  StoredOpportunity,
  SyncStats,
} from '../../core';

/**
 * Tier 0 repository — no persistence.
 *
 * Each `findById` / `search` call hits the upstream via `ISourceClient`,
 * transforms on the fly, and filters/paginates in JS. Suitable for:
 *
 *   - proof-of-concept / demo deployments
 *   - datasets small enough that re-fetching on every request is acceptable
 *     (PA is ~362 records / ~1 MB — easily handled)
 *   - zero-ops or serverless environments that can't host a DB
 *
 * `upsert`, `logSyncStart`, `logSyncComplete` are no-ops: there's nothing to
 * persist. `getLastSyncedAt` returns the time of the last upstream fetch.
 *
 * A process-level memoization window avoids hitting the upstream on every
 * single request within a short interval. Default TTL is 5 minutes; set to 0
 * to disable and always fetch fresh.
 */
export class ProxyOppRepo<TSource> implements IOppRepo {
  private readonly client: ISourceClient<TSource>;
  private readonly transform: (source: TSource) => StoredOpportunity;
  private readonly ttlMs: number;

  private cache: StoredOpportunity[] | null = null;
  private cachedAt: number = 0;

  constructor(
    client: ISourceClient<TSource>,
    transform: (source: TSource) => StoredOpportunity,
    options: { ttlMs?: number } = {},
  ) {
    this.client = client;
    this.transform = transform;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /** Force a refresh on the next read. */
  invalidate(): void {
    this.cache = null;
    this.cachedAt = 0;
  }

  private async loadAll(): Promise<StoredOpportunity[]> {
    const now = Date.now();
    if (this.cache && now - this.cachedAt < this.ttlMs) {
      return this.cache;
    }
    const collected: StoredOpportunity[] = [];
    for await (const source of this.client.listAll()) {
      collected.push(this.transform(source));
    }
    this.cache = collected;
    this.cachedAt = now;
    return collected;
  }

  async findById(id: string): Promise<StoredOpportunity | null> {
    const all = await this.loadAll();
    return all.find((o) => o.id === id) ?? null;
  }

  async findBySourceId(sourceId: string): Promise<StoredOpportunity | null> {
    const all = await this.loadAll();
    return all.find((o) => o.sourceId === sourceId) ?? null;
  }

  async search(params: OpportunitySearchParams): Promise<PaginatedResult<StoredOpportunity>> {
    const all = await this.loadAll();
    let filtered = all.filter((o) => matches(o, params));
    filtered = sortRows(filtered, params.sorting);
    const total = filtered.length;
    const start = Math.max(0, (params.pagination.page - 1) * params.pagination.pageSize);
    const end = start + params.pagination.pageSize;
    return { items: filtered.slice(start, end), total };
  }

  async upsert(_record: StoredOpportunity): Promise<void> {
    // No-op: proxy tier has no persistence.
  }

  async upsertBatch(_records: StoredOpportunity[]): Promise<void> {
    // No-op: proxy tier has no persistence.
  }

  async allHashesBySourceId(): Promise<Map<string, string>> {
    // Proxy tier has no persisted rows — every ETL pass treats every record
    // as new, which is fine: the ETL never targets a proxy-tier deployment.
    return new Map();
  }

  async getLastSyncedAt(): Promise<string | null> {
    return this.cachedAt === 0 ? null : new Date(this.cachedAt).toISOString();
  }

  async logSyncStart(): Promise<number> {
    return 0;
  }

  async logSyncComplete(_runId: number, _stats: SyncStats): Promise<void> {
    // No-op.
  }
}

// =============================================================================
// Filtering — exported for testability
// =============================================================================

/**
 * Evaluate whether a stored row matches the structured CG filters.
 * Each filter respects its operator (`in`/`notIn`, `between`/`outside`).
 */
export function matches(row: StoredOpportunity, params: OpportunitySearchParams): boolean {
  const filters = params.filters;

  // Full-text query — substring match.
  if (params.query !== undefined && params.query.trim() !== '') {
    const q = params.query.trim().toLowerCase();
    const haystack = `${row.title} ${row.searchText}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  // Status filter.
  const status = filters?.status;
  if (status?.value && status.value.length > 0) {
    const inSet = status.value.includes(row.status);
    if (status.operator === 'notIn') {
      if (inSet) return false;
    } else {
      // default to 'in'
      if (!inSet) return false;
    }
  }

  // Close-date range filter.
  const dateRange = filters?.closeDateRange;
  if (dateRange?.value) {
    if (row.closeDate === null) return false;
    const { min, max } = dateRange.value;
    const isBetween =
      (min === undefined || row.closeDate >= min) && (max === undefined || row.closeDate <= max);
    if (dateRange.operator === 'outside') {
      if (isBetween) return false;
    } else {
      // default to 'between'
      if (!isBetween) return false;
    }
  }

  // Funding range filters — compare against stored cents.
  if (!matchesFundingRange(row.totalAmountAvailableCents, filters?.totalFundingAvailableRange)) {
    return false;
  }
  if (!matchesFundingRange(row.minAwardAmountCents, filters?.minAwardAmountRange)) {
    return false;
  }
  if (!matchesFundingRange(row.maxAwardAmountCents, filters?.maxAwardAmountRange)) {
    return false;
  }

  return true;
}

/**
 * Compare a stored cents value against a Money range filter.
 * Returns true if the row passes (or the filter is absent).
 */
function matchesFundingRange(
  cents: number | null,
  filter?: { operator?: string; value?: { min?: unknown; max?: unknown } } | null,
): boolean {
  if (!filter?.value) return true;
  if (cents === null) return false;

  const minCents = moneyStringToCents(filter.value.min);
  const maxCents = moneyStringToCents(filter.value.max);
  const isBetween =
    (minCents === null || cents >= minCents) && (maxCents === null || cents <= maxCents);

  if (filter.operator === 'outside') return !isBetween;
  return isBetween;
}

function moneyStringToCents(money: unknown): number | null {
  if (!money || typeof money !== 'object') return null;
  const m = money as { amount?: string };
  if (!m.amount) return null;
  const n = Number(m.amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// =============================================================================
// Sorting — exported for testability
// =============================================================================

const SORT_FIELD_MAP: Record<string, keyof StoredOpportunity> = {
  title: 'title',
  'status.value': 'status',
  'keyDates.closeDate': 'closeDate',
  lastModifiedAt: 'lastModifiedAt',
  createdAt: 'lastModifiedAt', // best proxy
  'funding.maxAwardAmount': 'maxAwardAmountCents',
  'funding.minAwardAmount': 'minAwardAmountCents',
  'funding.totalAmountAvailable': 'totalAmountAvailableCents',
};

export function sortRows(
  rows: StoredOpportunity[],
  sorting?: { sortBy?: string; sortOrder?: string | null } | null,
): StoredOpportunity[] {
  if (!sorting?.sortBy) return rows;
  const field = SORT_FIELD_MAP[sorting.sortBy];
  if (!field) return rows;
  const dir = sorting.sortOrder === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}
