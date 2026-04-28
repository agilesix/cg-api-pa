import { describe, it, expect, beforeEach } from 'vitest';
import { runSync, type SyncDeps } from '../../src/etl';
import type {
  ISourceClient,
  IOppRepo,
  ISnapshotStore,
  PaginatedResult,
  OpportunitySearchParams,
  StoredOpportunity,
  SyncStats,
} from '../../src/core';

// -------------------------------------------------------------------------
// Fakes
// -------------------------------------------------------------------------

/**
 * A deliberately minimal in-memory implementation of `IOppRepo`
 * for ETL tests. Kept in the test file so `src/storage/` stays scoped to the
 * two tiers we actually ship (proxy, SQL). Memory tier is documented as a
 * future 1-file PORTING.md addition.
 */
class FakeRepo implements IOppRepo {
  readonly rows = new Map<string, StoredOpportunity>();
  readonly syncLogs: { startedAt: string; stats: SyncStats | null }[] = [];

  async findById(id: string) {
    for (const row of this.rows.values()) if (row.id === id) return row;
    return null;
  }
  async findBySourceId(sourceId: string) {
    return this.rows.get(sourceId) ?? null;
  }
  async search(_params: OpportunitySearchParams): Promise<PaginatedResult<StoredOpportunity>> {
    return { items: [...this.rows.values()], total: this.rows.size };
  }
  async upsert(record: StoredOpportunity) {
    this.rows.set(record.sourceId, record);
  }
  async getLastSyncedAt() {
    const last = this.syncLogs.at(-1);
    return last?.stats?.completedAt ?? null;
  }
  async logSyncStart() {
    const id = this.syncLogs.length;
    this.syncLogs.push({ startedAt: new Date().toISOString(), stats: null });
    return id;
  }
  async logSyncComplete(id: number, stats: SyncStats) {
    const log = this.syncLogs[id];
    if (log) log.stats = stats;
  }
}

class CapturingSnapshotStore implements ISnapshotStore {
  readonly writes: { key: string; value: string }[] = [];
  async put(key: string, value: string) {
    this.writes.push({ key, value });
  }
}

interface FakeSource {
  slug: string;
  title: string;
  status: string;
}

function buildClient(sources: FakeSource[]): ISourceClient<FakeSource> {
  return {
    async getGrant(slug: string) {
      return sources.find((s) => s.slug === slug) ?? null;
    },
    async *listAll() {
      for (const s of sources) yield s;
    },
  };
}

function toStored(src: FakeSource, contentHash: string): StoredOpportunity {
  return {
    id: `id-${src.slug}`,
    sourceId: src.slug,
    title: src.title,
    status: src.status,
    closeDate: null,
    postDate: null,
    minAwardAmountCents: null,
    maxAwardAmountCents: null,
    totalAmountAvailableCents: null,
    searchText: src.title,
    contentHash,
    lastModifiedAt: '2026-04-15T00:00:00Z',
    rawJson: JSON.stringify(src),
  };
}

function buildDeps(sources: FakeSource[]): {
  deps: SyncDeps<FakeSource>;
  repo: FakeRepo;
  snapshots: CapturingSnapshotStore;
} {
  const repo = new FakeRepo();
  const snapshots = new CapturingSnapshotStore();
  const deps: SyncDeps<FakeSource> = {
    client: buildClient(sources),
    repo,
    snapshots,
    toStored,
    getSourceId: (s) => s.slug,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { deps, repo, snapshots };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('runSync', () => {
  let sources: FakeSource[];

  beforeEach(() => {
    sources = [
      { slug: 's1', title: 'Agriculture', status: 'open' },
      { slug: 's2', title: 'Education', status: 'open' },
      { slug: 's3', title: 'Research', status: 'closed' },
    ];
  });

  it('inserts every record on first run', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    const stats = await runSync(deps);

    expect(stats.recordsFetched).toBe(3);
    expect(stats.recordsInserted).toBe(3);
    expect(stats.recordsUpdated).toBe(0);
    expect(stats.recordsSkipped).toBe(0);
    expect(stats.errorMessage).toBeNull();
    expect(repo.rows.size).toBe(3);
    expect(snapshots.writes).toHaveLength(3);
  });

  it('hash-skips unchanged records on second run', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    await runSync(deps);
    const stats = await runSync(deps);

    expect(stats.recordsFetched).toBe(3);
    expect(stats.recordsInserted).toBe(0);
    expect(stats.recordsUpdated).toBe(0);
    expect(stats.recordsSkipped).toBe(3);
    // Snapshots written on first run (3) stay; no new writes on second run.
    expect(repo.rows.size).toBe(3);
    expect(snapshots.writes).toHaveLength(3);
  });

  it('force=true re-upserts unchanged records (counted as updates, fresh snapshots)', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    await runSync(deps);
    const stats = await runSync(deps, { force: true });

    expect(stats.recordsFetched).toBe(3);
    expect(stats.recordsInserted).toBe(0);
    expect(stats.recordsUpdated).toBe(3);
    expect(stats.recordsSkipped).toBe(0);
    expect(repo.rows.size).toBe(3);
    expect(snapshots.writes).toHaveLength(6);
  });

  it('marks changed records as updated and writes fresh snapshots', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    await runSync(deps);
    // Mutate one source record to trigger a hash change.
    sources[0]!.title = 'Agriculture (revised)';
    const stats = await runSync(deps);

    expect(stats.recordsFetched).toBe(3);
    expect(stats.recordsInserted).toBe(0);
    expect(stats.recordsUpdated).toBe(1);
    expect(stats.recordsSkipped).toBe(2);
    expect(repo.rows.get('s1')?.title).toBe('Agriculture (revised)');
    expect(snapshots.writes).toHaveLength(4);
  });

  it('writes snapshots under `<sourceId>/<iso-timestamp>.json`', async () => {
    const { deps, snapshots } = buildDeps(sources);
    await runSync(deps);
    for (const w of snapshots.writes) {
      expect(w.key).toMatch(/^s\d+\/\d{4}-\d{2}-\d{2}T[\d:.]+Z\.json$/);
    }
  });

  it('records a sync_log entry for the run', async () => {
    const { deps, repo } = buildDeps(sources);
    await runSync(deps);
    expect(repo.syncLogs).toHaveLength(1);
    expect(repo.syncLogs[0]?.stats?.recordsInserted).toBe(3);
    expect(await repo.getLastSyncedAt()).toBeTypeOf('string');
  });

  it('captures and rethrows errors; sync_log records the failure', async () => {
    const throwingClient: ISourceClient<FakeSource> = {
      async getGrant() {
        return null;
      },
      // eslint-disable-next-line require-yield
      async *listAll() {
        throw new Error('upstream fetch failed');
      },
    };
    const repo = new FakeRepo();
    const snapshots = new CapturingSnapshotStore();
    const deps: SyncDeps<FakeSource> = {
      client: throwingClient,
      repo,
      snapshots,
      toStored,
      getSourceId: (s) => s.slug,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    };

    await expect(runSync(deps)).rejects.toThrow('upstream fetch failed');
    expect(repo.syncLogs).toHaveLength(1);
    expect(repo.syncLogs[0]?.stats?.errorMessage).toBe('upstream fetch failed');
  });
});
