import { describe, it, expect, beforeEach } from 'vitest';
import { ProxyOppRepo, matches, sortRows } from '../../src/storage/proxy/ProxyOppRepo';
import type { ISourceClient, OpportunitySearchParams, StoredOpportunity } from '../../src/core';

interface FakeRecord {
  id: string;
  sourceId: string;
  title: string;
  status: string;
  searchText: string;
}

function buildClient(records: FakeRecord[]): ISourceClient<FakeRecord> & { calls: number } {
  const state = { calls: 0 };
  return {
    async getGrant(sourceId: string) {
      return records.find((r) => r.sourceId === sourceId) ?? null;
    },
    async *listAll() {
      state.calls += 1;
      for (const r of records) yield r;
    },
    get calls() {
      return state.calls;
    },
  } as ISourceClient<FakeRecord> & { calls: number };
}

function transform(src: FakeRecord): StoredOpportunity {
  return {
    id: src.id,
    sourceId: src.sourceId,
    title: src.title,
    status: src.status,
    closeDate: null,
    postDate: null,
    minAwardAmountCents: null,
    maxAwardAmountCents: null,
    totalAmountAvailableCents: null,
    searchText: src.searchText,
    contentHash: src.id,
    lastModifiedAt: '2026-01-01T00:00:00Z',
    rawJson: JSON.stringify(src),
  };
}

const records: FakeRecord[] = [
  { id: 'id-1', sourceId: 's1', title: 'Agriculture Grant', status: 'open', searchText: 'farming' },
  { id: 'id-2', sourceId: 's2', title: 'Education Grant', status: 'open', searchText: 'schools' },
  { id: 'id-3', sourceId: 's3', title: 'Research Grant', status: 'closed', searchText: 'science' },
];

/** Shortcut: build an OpportunitySearchParams from a partial. */
function sp(overrides: Partial<OpportunitySearchParams> = {}): OpportunitySearchParams {
  return { pagination: { page: 1, pageSize: 10 }, ...overrides };
}

describe('matches (filter predicate)', () => {
  const row = transform(records[0]!);

  it('matches when no filters are set', () => {
    expect(matches(row, sp())).toBe(true);
  });

  it('excludes by status IN', () => {
    expect(matches(row, sp({ filters: { status: { operator: 'in', value: ['closed'] } } }))).toBe(
      false,
    );
  });

  it('includes by status IN', () => {
    expect(
      matches(row, sp({ filters: { status: { operator: 'in', value: ['open', 'closed'] } } })),
    ).toBe(true);
  });

  it('supports status notIn', () => {
    expect(matches(row, sp({ filters: { status: { operator: 'notIn', value: ['open'] } } }))).toBe(
      false,
    );
    expect(
      matches(row, sp({ filters: { status: { operator: 'notIn', value: ['closed'] } } })),
    ).toBe(true);
  });

  it('filters by substring in title or searchText', () => {
    expect(matches(row, sp({ query: 'Agriculture' }))).toBe(true);
    expect(matches(row, sp({ query: 'farming' }))).toBe(true);
    expect(matches(row, sp({ query: 'nonexistent' }))).toBe(false);
  });

  it('filters by closeDateRange between', () => {
    const r = { ...row, closeDate: '2025-01-15' };
    expect(
      matches(
        r,
        sp({
          filters: {
            closeDateRange: {
              operator: 'between',
              value: { min: '2025-01-01', max: '2025-02-01' },
            },
          },
        }),
      ),
    ).toBe(true);
    expect(
      matches(
        r,
        sp({
          filters: {
            closeDateRange: {
              operator: 'between',
              value: { min: '2025-02-01', max: '2025-03-01' },
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it('filters by closeDateRange outside', () => {
    const r = { ...row, closeDate: '2025-01-15' };
    expect(
      matches(
        r,
        sp({
          filters: {
            closeDateRange: {
              operator: 'outside',
              value: { min: '2025-01-01', max: '2025-02-01' },
            },
          },
        }),
      ),
    ).toBe(false);
    expect(
      matches(
        r,
        sp({
          filters: {
            closeDateRange: {
              operator: 'outside',
              value: { min: '2025-02-01', max: '2025-03-01' },
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it('excludes rows with null closeDate when a closeDateRange is specified', () => {
    expect(
      matches(
        { ...row, closeDate: null },
        sp({
          filters: {
            closeDateRange: {
              operator: 'between',
              value: { min: '2000-01-01', max: '2099-01-01' },
            },
          },
        }),
      ),
    ).toBe(false);
  });
});

describe('sortRows', () => {
  const rows = records.map(transform);

  it('sorts by title ascending', () => {
    const sorted = sortRows(rows, { sortBy: 'title', sortOrder: 'asc' });
    expect(sorted.map((r) => r.title)).toEqual([
      'Agriculture Grant',
      'Education Grant',
      'Research Grant',
    ]);
  });

  it('sorts by title descending', () => {
    const sorted = sortRows(rows, { sortBy: 'title', sortOrder: 'desc' });
    expect(sorted.map((r) => r.title)).toEqual([
      'Research Grant',
      'Education Grant',
      'Agriculture Grant',
    ]);
  });

  it('returns original order when sortBy is absent', () => {
    const sorted = sortRows(rows, undefined);
    expect(sorted.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });
});

describe('ProxyOppRepo', () => {
  let repo: ProxyOppRepo<FakeRecord>;
  let client: ReturnType<typeof buildClient>;

  beforeEach(() => {
    client = buildClient(records);
    repo = new ProxyOppRepo(client, transform, { ttlMs: 0 });
  });

  it('findById returns the matching row', async () => {
    const row = await repo.findById('id-2');
    expect(row?.sourceId).toBe('s2');
  });

  it('findById returns null when not found', async () => {
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findBySourceId returns the matching row', async () => {
    const row = await repo.findBySourceId('s3');
    expect(row?.id).toBe('id-3');
  });

  it('search filters, paginates, and reports total', async () => {
    const result = await repo.search(
      sp({
        pagination: { page: 1, pageSize: 2 },
        filters: { status: { operator: 'in', value: ['open'] } },
      }),
    );
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((r) => r.sourceId).sort()).toEqual(['s1', 's2']);
  });

  it('search honors page + pageSize', async () => {
    const p1 = await repo.search(sp({ pagination: { page: 1, pageSize: 1 } }));
    const p2 = await repo.search(sp({ pagination: { page: 2, pageSize: 1 } }));
    expect(p1.total).toBe(3);
    expect(p2.total).toBe(3);
    expect(p1.items).toHaveLength(1);
    expect(p2.items).toHaveLength(1);
    expect(p1.items[0]?.id).not.toBe(p2.items[0]?.id);
  });

  it('search with text query matches title or search_text', async () => {
    const r1 = await repo.search(sp({ query: 'schools' }));
    expect(r1.items.map((r) => r.sourceId)).toEqual(['s2']);
    const r2 = await repo.search(sp({ query: 'research' }));
    expect(r2.items.map((r) => r.sourceId)).toEqual(['s3']);
  });

  it('search with sorting orders results', async () => {
    const result = await repo.search(sp({ sorting: { sortBy: 'title', sortOrder: 'desc' } }));
    expect(result.items[0]?.title).toBe('Research Grant');
  });

  it('upsert / upsertBatch / logSyncStart / logSyncComplete are no-ops', async () => {
    await expect(repo.upsert(transform(records[0]!))).resolves.toBeUndefined();
    await expect(repo.upsertBatch(records.map(transform))).resolves.toBeUndefined();
    await expect(repo.logSyncStart()).resolves.toBe(0);
    await expect(
      repo.logSyncComplete(0, {
        startedAt: 's',
        completedAt: 'c',
        recordsFetched: 0,
        recordsInserted: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        errorMessage: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('allHashesBySourceId returns an empty map (no persistence)', async () => {
    const map = await repo.allHashesBySourceId();
    expect(map.size).toBe(0);
  });

  it('getLastSyncedAt returns null before first fetch and an ISO string after', async () => {
    expect(await repo.getLastSyncedAt()).toBeNull();
    await repo.findById('id-1');
    const ts = await repo.getLastSyncedAt();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('caches for ttlMs and refetches after expiry', async () => {
    const cachingRepo = new ProxyOppRepo(client, transform, { ttlMs: 1_000 });
    await cachingRepo.findById('id-1');
    await cachingRepo.findById('id-2');
    expect(client.calls).toBe(1);
    cachingRepo.invalidate();
    await cachingRepo.findById('id-1');
    expect(client.calls).toBe(2);
  });
});
