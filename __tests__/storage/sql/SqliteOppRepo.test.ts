import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { D1Dialect, SqliteOppRepo, createDb } from '../../../src/storage/sql';
import type { OpportunitySearchParams, StoredOpportunity } from '../../../src/core';

const now = new Date('2026-04-15T00:00:00Z').toISOString();

function fakeRow(overrides: Partial<StoredOpportunity> = {}): StoredOpportunity {
  return {
    id: overrides.id ?? '00000000-0000-5000-8000-000000000001',
    sourceId: overrides.sourceId ?? 's1',
    title: overrides.title ?? 'Agriculture Grant',
    status: overrides.status ?? 'open',
    closeDate: overrides.closeDate ?? '2025-06-15T00:00:00Z',
    postDate: overrides.postDate ?? '2025-01-01T00:00:00Z',
    minAwardAmountCents: overrides.minAwardAmountCents ?? 100_000,
    maxAwardAmountCents: overrides.maxAwardAmountCents ?? 750_000,
    totalAmountAvailableCents: overrides.totalAmountAvailableCents ?? 50_000_000,
    searchText: overrides.searchText ?? 'Agriculture Grant farming rural',
    contentHash: overrides.contentHash ?? 'hash-1',
    lastModifiedAt: overrides.lastModifiedAt ?? now,
    rawJson: overrides.rawJson ?? JSON.stringify({ id: overrides.id ?? 'id-1' }),
  };
}

/** Shortcut for building search params. */
function sp(overrides: Partial<OpportunitySearchParams> = {}): OpportunitySearchParams {
  return { pagination: { page: 1, pageSize: 10 }, ...overrides };
}

// Migrations applied once per worker in test/storage/sql/setup.ts.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM opportunities'),
    env.DB.prepare('DELETE FROM sync_log'),
  ]);
});

describe('SqliteOppRepo', () => {
  function buildRepo() {
    const db = createDb(new D1Dialect({ database: env.DB }));
    return new SqliteOppRepo(db);
  }

  describe('upsert + findById', () => {
    it('inserts a new row and can read it back', async () => {
      const repo = buildRepo();
      const record = fakeRow();
      await repo.upsert(record);
      const read = await repo.findById(record.id);
      expect(read).toEqual(record);
    });

    it('updates on conflicting id (idempotent upsert)', async () => {
      const repo = buildRepo();
      const first = fakeRow({ title: 'v1' });
      await repo.upsert(first);
      await repo.upsert({ ...first, title: 'v2', contentHash: 'hash-2' });
      const read = await repo.findById(first.id);
      expect(read?.title).toBe('v2');
      expect(read?.contentHash).toBe('hash-2');
    });
  });

  describe('findBySourceId', () => {
    it('returns the row matching the source id', async () => {
      const repo = buildRepo();
      await repo.upsert(fakeRow({ sourceId: 'pda42' }));
      const read = await repo.findBySourceId('pda42');
      expect(read?.sourceId).toBe('pda42');
    });

    it('returns null when not found', async () => {
      const repo = buildRepo();
      expect(await repo.findBySourceId('missing')).toBeNull();
    });
  });

  describe('search — filters and pagination', () => {
    const rows: StoredOpportunity[] = [
      fakeRow({
        id: '00000000-0000-5000-8000-000000000001',
        sourceId: 's1',
        title: 'Agriculture Grant',
        status: 'open',
        closeDate: '2025-01-01T00:00:00Z',
        searchText: 'farming rural',
      }),
      fakeRow({
        id: '00000000-0000-5000-8000-000000000002',
        sourceId: 's2',
        title: 'Education Grant',
        status: 'open',
        closeDate: '2025-06-01T00:00:00Z',
        searchText: 'schools students',
      }),
      fakeRow({
        id: '00000000-0000-5000-8000-000000000003',
        sourceId: 's3',
        title: 'Research Grant',
        status: 'closed',
        closeDate: '2024-12-01T00:00:00Z',
        searchText: 'science laboratory',
      }),
    ];

    async function seed() {
      const repo = buildRepo();
      for (const r of rows) await repo.upsert(r);
      return repo;
    }

    it('returns everything with pagination when no filter is set', async () => {
      const repo = await seed();
      const result = await repo.search(sp());
      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(3);
    });

    it('filters by status IN', async () => {
      const repo = await seed();
      const result = await repo.search(
        sp({ filters: { status: { operator: 'in', value: ['open'] } } }),
      );
      expect(result.total).toBe(2);
      expect(result.items.map((r) => r.sourceId).sort()).toEqual(['s1', 's2']);
    });

    it('filters by status NOT IN', async () => {
      const repo = await seed();
      const result = await repo.search(
        sp({ filters: { status: { operator: 'notIn', value: ['closed'] } } }),
      );
      expect(result.total).toBe(2);
      expect(result.items.map((r) => r.sourceId).sort()).toEqual(['s1', 's2']);
    });

    it('filters by closeDateRange between', async () => {
      const repo = await seed();
      const result = await repo.search(
        sp({
          filters: {
            closeDateRange: {
              operator: 'between',
              value: { min: '2024-11-01T00:00:00Z', max: '2025-02-01T00:00:00Z' },
            },
          },
        }),
      );
      expect(result.total).toBe(2);
      expect(result.items.map((r) => r.sourceId).sort()).toEqual(['s1', 's3']);
    });

    it('FTS5 text search matches on title', async () => {
      const repo = await seed();
      const result = await repo.search(sp({ query: 'agriculture' }));
      expect(result.total).toBe(1);
      expect(result.items[0]?.sourceId).toBe('s1');
    });

    it('FTS5 text search matches on search_text', async () => {
      const repo = await seed();
      const result = await repo.search(sp({ query: 'laboratory' }));
      expect(result.total).toBe(1);
      expect(result.items[0]?.sourceId).toBe('s3');
    });

    it('paginates correctly', async () => {
      const repo = await seed();
      const page1 = await repo.search(sp({ pagination: { page: 1, pageSize: 2 } }));
      const page2 = await repo.search(sp({ pagination: { page: 2, pageSize: 2 } }));
      expect(page1.total).toBe(3);
      expect(page2.total).toBe(3);
      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(1);
    });

    it('sorts by title descending', async () => {
      const repo = await seed();
      const result = await repo.search(sp({ sorting: { sortBy: 'title', sortOrder: 'desc' } }));
      expect(result.items[0]?.title).toBe('Research Grant');
      expect(result.items[2]?.title).toBe('Agriculture Grant');
    });

    it('returns 0 results when FTS finds no matches', async () => {
      const repo = await seed();
      const result = await repo.search(sp({ query: 'nonexistent' }));
      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe('sync_log', () => {
    it('records a run start and completion', async () => {
      const repo = buildRepo();
      const runId = await repo.logSyncStart();
      expect(runId).toBeTypeOf('number');
      await repo.logSyncComplete(runId, {
        startedAt: now,
        completedAt: now,
        recordsFetched: 100,
        recordsInserted: 100,
        recordsUpdated: 0,
        recordsSkipped: 0,
        errorMessage: null,
      });
      const lastSync = await repo.getLastSyncedAt();
      expect(lastSync).toBe(now);
    });

    it('returns null from getLastSyncedAt when no completed runs exist', async () => {
      const repo = buildRepo();
      expect(await repo.getLastSyncedAt()).toBeNull();
    });
  });
});
