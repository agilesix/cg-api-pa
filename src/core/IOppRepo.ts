import type {
  OpportunitySearchParams,
  PaginatedResult,
  StoredOpportunity,
  SyncStats,
} from './types';

/**
 * Persistence interface for stored opportunities. Which implementation you
 * wire in `src/cg.config.ts` determines the deployment tier:
 *
 * - `ProxyOppRepo`: no persistence, every call hits the upstream
 * - `MemoryOpportunityRepository`: in-process `Map`
 * - `KvOpportunityRepository`: Cloudflare KV / Upstash / DynamoDB
 * - `SqliteOppRepo`: Kysely on D1 / SQLite / Postgres (default)
 *
 * Services, routes, and the ETL depend only on this interface; swapping
 * tier requires no changes outside `src/cg.config.ts` and `wrangler.jsonc`.
 */
export interface IOppRepo {
  /** Look up by CommonGrants id. Returns null if not found. */
  findById(id: string): Promise<StoredOpportunity | null>;

  /**
   * Look up by source-system id. Used by the ETL to find existing rows so
   * content-hash change detection can decide insert-vs-update-vs-skip.
   */
  findBySourceId(sourceId: string): Promise<StoredOpportunity | null>;

  /**
   * Filter + paginate. Each tier does its best:
   *
   * - proxy: fetches all upstream, filters in JS
   * - memory: filters on the in-process map
   * - KV: unpacks the stored blob, filters in JS
   * - SQL: translates to `WHERE` + FTS5 / tsvector
   */
  search(params: OpportunitySearchParams): Promise<PaginatedResult<StoredOpportunity>>;

  /** Insert or replace by id. No-op for the proxy tier. */
  upsert(record: StoredOpportunity): Promise<void>;

  /**
   * ISO datetime of the most recent successful sync, or `null` if none has
   * run yet. Drives the `X-Data-As-Of` response header.
   */
  getLastSyncedAt(): Promise<string | null>;

  /** Record the start of a sync run. Returns an opaque id passed to `logSyncComplete`. */
  logSyncStart(): Promise<number>;

  /** Complete the sync run with accounting stats. */
  logSyncComplete(runId: number, stats: SyncStats): Promise<void>;
}
