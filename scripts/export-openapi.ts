/**
 * Emit the auto-generated OpenAPI 3.1 spec to `dist/openapi.json`.
 *
 * Build the Hono app once with fake (no-op) dependencies — we only need the
 * route registrations for the spec, not live DB access — then hit
 * `/openapi.json` through the in-process Hono request API to materialize
 * the spec. This is what `pnpm run check:spec` feeds to `cg check spec`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from '../src/app';
import { OpportunityService } from '../src/services';
import type { AppConfig } from '../src/cg.config';
import type {
  IOppRepo,
  ISnapshotStore,
  Logger,
  PaginatedResult,
  OpportunitySearchParams,
  StoredOpportunity,
  SyncStats,
} from '../src/core';

const OUTPUT_PATH = 'dist/openapi.json';

const noopRepo: IOppRepo = {
  findById: async () => null,
  findBySourceId: async () => null,
  search: async (_p: OpportunitySearchParams): Promise<PaginatedResult<StoredOpportunity>> => ({
    items: [],
    total: 0,
  }),
  upsert: async () => {},
  upsertBatch: async () => {},
  allHashesBySourceId: async () => new Map<string, string>(),
  getLastSyncedAt: async () => null,
  logSyncStart: async () => 0,
  logSyncComplete: async () => {},
};

const noopSnapshots: ISnapshotStore = { put: async () => {}, putMany: async () => {} };
const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const noopSync = async (): Promise<SyncStats> => ({
  startedAt: '',
  completedAt: '',
  recordsFetched: 0,
  recordsInserted: 0,
  recordsUpdated: 0,
  recordsSkipped: 0,
  errorMessage: null,
});

const deps: AppConfig = {
  repo: noopRepo,
  snapshots: noopSnapshots,
  service: new OpportunityService(noopRepo),
  sync: noopSync,
  syncSecret: '',
  logger: noopLogger,
  version: '0.1.0',
};

const app = createApp(deps);
const res = await app.request('/openapi.json');
if (!res.ok) {
  console.error(`Failed to generate OpenAPI spec: ${res.status}`);
  process.exit(1);
}

const spec = await res.text();
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, spec);
console.log(`Wrote ${OUTPUT_PATH} (${spec.length} bytes)`);
