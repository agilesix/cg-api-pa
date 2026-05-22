/**
 * Core contracts smoke test — verifies the public surface of `src/core/`
 * and that its interfaces are implementable.
 *
 * This protects against two classes of regression:
 *   1. Accidentally removing a re-export from `src/core/index.ts`.
 *   2. Changing an interface signature in a way that breaks implementers.
 *
 * If either happens, this file will fail to compile.
 */

import { describe, it, expect } from 'vitest';
import type {
  ISourceClient,
  IOppRepo,
  ISnapshotStore,
  Logger,
  PaginatedResult,
  OpportunitySearchParams,
  StoredOpportunity,
  SyncStats,
} from '../src/core';

describe('core contracts', () => {
  it('IOppRepo is fully implementable by a fake', () => {
    const fake: IOppRepo = {
      findById: async () => null,
      findBySourceId: async () => null,
      search: async (_params: OpportunitySearchParams) => ({ items: [], total: 0 }),
      upsert: async (_record: StoredOpportunity) => {},
      upsertBatch: async (_records: StoredOpportunity[]) => {},
      allHashesBySourceId: async () => new Map<string, string>(),
      getLastSyncedAt: async () => null,
      logSyncStart: async () => 0,
      logSyncComplete: async (_id: number, _stats: SyncStats) => {},
    };
    expect(typeof fake.findById).toBe('function');
    expect(typeof fake.search).toBe('function');
  });

  it('ISourceClient is fully implementable by a fake', () => {
    interface FakeRecord {
      id: string;
    }
    const fake: ISourceClient<FakeRecord> = {
      async getGrant(_sourceId: string) {
        return null;
      },
      async *listAll() {
        // empty stream
      },
    };
    expect(typeof fake.getGrant).toBe('function');
  });

  it('ISnapshotStore is fully implementable by a fake', () => {
    const fake: ISnapshotStore = {
      put: async (_key: string, _value: string) => {},
      putMany: async (_entries: Array<{ key: string; body: string }>) => {},
    };
    expect(typeof fake.put).toBe('function');
  });

  it('Logger shape accepts console', () => {
    const logger: Logger = console;
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('StoredOpportunity has the expected shape', () => {
    const row: StoredOpportunity = {
      id: '00000000-0000-0000-0000-000000000001',
      sourceId: 'pda1',
      title: 'Test',
      status: 'open',
      closeDate: null,
      postDate: null,
      minAwardAmountCents: null,
      maxAwardAmountCents: null,
      totalAmountAvailableCents: null,
      searchText: '',
      contentHash: 'deadbeef',
      lastModifiedAt: '2026-01-01T00:00:00Z',
      rawJson: '{}',
    };
    expect(row.sourceId).toBe('pda1');
  });

  it('PaginatedResult preserves its element type', () => {
    const r: PaginatedResult<StoredOpportunity> = { items: [], total: 0 };
    expect(r.total).toBe(0);
  });
});
