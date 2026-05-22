import { sql, type Insertable, type Selectable } from 'kysely';
import type {
  IOppRepo,
  OpportunitySearchParams,
  PaginatedResult,
  StoredOpportunity,
  SyncStats,
} from '../../core';
import type { Db } from './db';
import type { OpportunitiesTable } from './schema';

/** The shape of a SELECTed opportunities row (generated columns resolved to string). */
type OpportunitiesRow = Selectable<OpportunitiesTable>;

// Columns updated on `ON CONFLICT` for batch upserts. Listed once so a column
// rename in `OpportunitiesTable` is a single-line change here; `satisfies`
// catches any typo against the table schema at compile time.
const UPSERT_UPDATE_COLS = [
  'source_id',
  'title',
  'status',
  'close_date',
  'post_date',
  'min_award_amount_cents',
  'max_award_amount_cents',
  'total_amount_available_cents',
  'search_text',
  'content_hash',
  'last_modified_at',
  'raw_json',
  'updated_at',
] as const satisfies ReadonlyArray<keyof OpportunitiesTable>;

// Maps CG `sortBy` values → SQL column names on the `opportunities` table.
const SORT_COLUMN_MAP: Record<string, string> = {
  title: 'title',
  'status.value': 'status',
  'keyDates.closeDate': 'close_date',
  lastModifiedAt: 'last_modified_at',
  createdAt: 'created_at',
  'funding.maxAwardAmount': 'max_award_amount_cents',
  'funding.minAwardAmount': 'min_award_amount_cents',
  'funding.totalAmountAvailable': 'total_amount_available_cents',
};

/**
 * Tier 3 repository — Kysely-backed SQL storage.
 *
 * Works on D1 (Cloudflare) and any other SQLite engine. Ships with FTS5 for
 * full-text search (isolated in the private `searchByText` method so a
 * Postgres swap touches only that one method — see PORTING.md).
 */
export class SqliteOppRepo implements IOppRepo {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<StoredOpportunity | null> {
    const row = await this.db
      .selectFrom('opportunities')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? rowToStored(row) : null;
  }

  async findBySourceId(sourceId: string): Promise<StoredOpportunity | null> {
    const row = await this.db
      .selectFrom('opportunities')
      .selectAll()
      .where('source_id', '=', sourceId)
      .executeTakeFirst();
    return row ? rowToStored(row) : null;
  }

  async search(params: OpportunitySearchParams): Promise<PaginatedResult<StoredOpportunity>> {
    const filters = params.filters;

    // Sanitize the FTS query upfront (if provided).
    const ftsMatch = params.query ? sanitizeFtsQuery(params.query) : null;
    if (params.query && ftsMatch === null) {
      return { items: [], total: 0 };
    }

    // When there's a text query, INNER JOIN the FTS virtual table so SQLite
    // filters at the engine level. This uses a single bound parameter for the
    // MATCH expression instead of N rowid placeholders — avoiding D1's
    // 999-parameter cap.
    //
    // The FTS virtual table isn't in the Kysely schema, so the join branch
    // is typed via `any`. The join is safe: opportunities_fts is a
    // content-sync'd FTS5 table whose rowid maps 1:1 to opportunities.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FTS table not in Kysely schema
    let countQuery: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rowQuery: any;

    if (ftsMatch !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      const ftsBase = (this.db.selectFrom('opportunities') as any)
        .innerJoin('opportunities_fts', sql`opportunities.rowid`, sql`opportunities_fts.rowid`)
        .where(sql`opportunities_fts`, 'match', ftsMatch);
      countQuery = ftsBase.select((eb: any) => eb.fn.countAll().as('count')); // eslint-disable-line @typescript-eslint/no-explicit-any
      rowQuery = ftsBase.selectAll('opportunities');
    } else {
      countQuery = this.db.selectFrom('opportunities').select((eb) => eb.fn.countAll().as('count'));
      rowQuery = this.db.selectFrom('opportunities').selectAll();
    }

    // Status filter — supports `in` and `notIn`.
    const status = filters?.status;
    if (status?.value && status.value.length > 0) {
      const values = [...status.value];
      if (status.operator === 'notIn') {
        countQuery = countQuery.where('status', 'not in', values);
        rowQuery = rowQuery.where('status', 'not in', values);
      } else {
        countQuery = countQuery.where('status', 'in', values);
        rowQuery = rowQuery.where('status', 'in', values);
      }
    }

    // Close-date range filter — supports `between` and `outside`.
    const dateRange = filters?.closeDateRange;
    if (dateRange?.value) {
      const { min, max } = dateRange.value;
      if (dateRange.operator === 'outside') {
        // Outside = NOT BETWEEN min AND max.
        if (min) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          countQuery = countQuery.where((eb: any) =>
            eb.or([eb('close_date', '<', min), eb('close_date', '>', max ?? '9999-12-31')]),
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rowQuery = rowQuery.where((eb: any) =>
            eb.or([eb('close_date', '<', min), eb('close_date', '>', max ?? '9999-12-31')]),
          );
        }
      } else {
        // Default: between.
        if (min) {
          countQuery = countQuery.where('close_date', '>=', min);
          rowQuery = rowQuery.where('close_date', '>=', min);
        }
        if (max) {
          countQuery = countQuery.where('close_date', '<=', max);
          rowQuery = rowQuery.where('close_date', '<=', max);
        }
      }
    }

    // Funding range filters — compare against integer cents columns.
    applyMoneyRange('total_amount_available_cents', filters?.totalFundingAvailableRange);
    applyMoneyRange('min_award_amount_cents', filters?.minAwardAmountRange);
    applyMoneyRange('max_award_amount_cents', filters?.maxAwardAmountRange);

    function applyMoneyRange(
      column: 'total_amount_available_cents' | 'min_award_amount_cents' | 'max_award_amount_cents',
      filter?: { operator?: string; value?: { min?: unknown; max?: unknown } } | null,
    ) {
      if (!filter?.value) return;
      const minCents = moneyToCents(filter.value.min);
      const maxCents = moneyToCents(filter.value.max);
      if (minCents === null && maxCents === null) return;

      if (filter.operator === 'outside') {
        if (minCents !== null && maxCents !== null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          countQuery = countQuery.where((eb: any) =>
            eb.or([eb(column, '<', minCents), eb(column, '>', maxCents)]),
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rowQuery = rowQuery.where((eb: any) =>
            eb.or([eb(column, '<', minCents), eb(column, '>', maxCents)]),
          );
        }
      } else {
        if (minCents !== null) {
          countQuery = countQuery.where(column, '>=', minCents);
          rowQuery = rowQuery.where(column, '>=', minCents);
        }
        if (maxCents !== null) {
          countQuery = countQuery.where(column, '<=', maxCents);
          rowQuery = rowQuery.where(column, '<=', maxCents);
        }
      }
    }

    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.count ?? 0);

    // Sorting — map CG `sortBy` to SQL column.
    const sortColumn = SORT_COLUMN_MAP[params.sorting?.sortBy ?? ''];
    const sortDir = params.sorting?.sortOrder === 'desc' ? 'desc' : 'asc';
    if (sortColumn) {
      rowQuery = rowQuery.orderBy(sql.ref(sortColumn), sortDir);
    } else {
      rowQuery = rowQuery.orderBy('close_date', 'asc');
    }
    rowQuery = rowQuery.orderBy('id', 'asc'); // stable tiebreaker

    const offset = Math.max(0, (params.pagination.page - 1) * params.pagination.pageSize);
    const rows = await rowQuery.limit(params.pagination.pageSize).offset(offset).execute();

    return { items: rows.map(rowToStored), total };
  }

  async upsert(record: StoredOpportunity): Promise<void> {
    await this.upsertBatch([record]);
  }

  async upsertBatch(records: StoredOpportunity[]): Promise<void> {
    if (records.length === 0) return;
    const now = new Date().toISOString();
    // D1 caps bound parameters at 100 per statement. Each row binds 15
    // columns, so 6 rows × 15 = 90 leaves headroom. A larger batch on a
    // less-restricted SQLite would compile fine but fail under D1.
    const BATCH = 6;
    for (let i = 0; i < records.length; i += BATCH) {
      const chunk = records.slice(i, i + BATCH);
      await this.db
        .insertInto('opportunities')
        .values(chunk.map((record) => toInsertValues(record, now)))
        .onConflict((oc) =>
          // Build `col = excluded.col` for each column in SQLite's UPSERT pseudo-table
          // which holds the conflicting row's incoming insert values.
          oc
            .column('id')
            .doUpdateSet((eb) =>
              Object.fromEntries(UPSERT_UPDATE_COLS.map((c) => [c, eb.ref(`excluded.${c}`)])),
            ),
        )
        .execute();
    }
  }

  async allHashesBySourceId(): Promise<Map<string, string>> {
    const rows = await this.db
      .selectFrom('opportunities')
      .select(['source_id', 'content_hash'])
      .execute();
    return new Map(rows.map((r) => [r.source_id, r.content_hash]));
  }

  async getLastSyncedAt(): Promise<string | null> {
    const row = await this.db
      .selectFrom('sync_log')
      .select('completed_at')
      .where('completed_at', 'is not', null)
      .orderBy('completed_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.completed_at ?? null;
  }

  async logSyncStart(): Promise<number> {
    const result = await this.db
      .insertInto('sync_log')
      .values({ started_at: new Date().toISOString() })
      .returning('id')
      .executeTakeFirst();
    if (!result) throw new Error('Failed to insert sync_log row');
    return Number(result.id);
  }

  async logSyncComplete(runId: number, stats: SyncStats): Promise<void> {
    await this.db
      .updateTable('sync_log')
      .set({
        completed_at: stats.completedAt,
        records_fetched: stats.recordsFetched,
        records_inserted: stats.recordsInserted,
        records_updated: stats.recordsUpdated,
        records_skipped: stats.recordsSkipped,
        error_message: stats.errorMessage,
      })
      .where('id', '=', runId)
      .execute();
  }
}

/**
 * Sanitize a user-provided search string into an FTS5 MATCH expression, or
 * return `null` if the input is empty after sanitization.
 *
 * **Isolated here intentionally** — a Postgres port replaces this with
 * `plainto_tsquery()` and the INNER JOIN in `search()` becomes a
 * `tsvector @@ tsquery` WHERE clause. See PORTING.md.
 */
function sanitizeFtsQuery(query: string): string | null {
  const sanitized = query.trim().replace(/["']/g, ' ').trim();
  if (sanitized === '') return null;
  return `"${sanitized}"*`;
}

function toInsertValues(record: StoredOpportunity, now: string): Insertable<OpportunitiesTable> {
  return {
    id: record.id,
    source_id: record.sourceId,
    title: record.title,
    status: record.status,
    close_date: record.closeDate,
    post_date: record.postDate,
    min_award_amount_cents: record.minAwardAmountCents,
    max_award_amount_cents: record.maxAwardAmountCents,
    total_amount_available_cents: record.totalAmountAvailableCents,
    search_text: record.searchText,
    content_hash: record.contentHash,
    last_modified_at: record.lastModifiedAt,
    raw_json: record.rawJson,
    created_at: now,
    updated_at: now,
  };
}

function rowToStored(row: OpportunitiesRow): StoredOpportunity {
  return {
    id: row.id,
    sourceId: row.source_id,
    title: row.title,
    status: row.status,
    closeDate: row.close_date,
    postDate: row.post_date,
    minAwardAmountCents: row.min_award_amount_cents,
    maxAwardAmountCents: row.max_award_amount_cents,
    totalAmountAvailableCents: row.total_amount_available_cents,
    searchText: row.search_text,
    contentHash: row.content_hash,
    lastModifiedAt: row.last_modified_at,
    rawJson: row.raw_json,
  };
}

function moneyToCents(money: unknown): number | null {
  if (!money || typeof money !== 'object') return null;
  const m = money as { amount?: string };
  if (!m.amount) return null;
  const n = Number(m.amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
