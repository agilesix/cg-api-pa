import type {
  ISourceClient,
  IOppRepo,
  ISnapshotStore,
  Logger,
  StoredOpportunity,
  SyncStats,
} from '../core';
import { computeHash } from './hash';

/**
 * Dependencies for a sync run. All interfaces — the orchestrator has no
 * knowledge of PA, Cloudflare, kysely, or even which tier is in use. Wire
 * the right combination in `src/cg.config.ts` per the active deployment tier.
 */
export interface SyncDeps<TSource> {
  /** Pulls records from the source system. */
  client: ISourceClient<TSource>;

  /** Target repository. Tiers that don't persist (proxy) still satisfy this. */
  repo: IOppRepo;

  /**
   * Converts a raw source record + its freshly computed content hash into
   * the adapter-agnostic `StoredOpportunity` row that the repository stores.
   * The adapter's `buildStoredOpportunity` composed with `paGrantToOpportunity`
   * is the canonical implementation.
   *
   * Returns `null` when the record can't be converted (e.g. the transform's
   * post-Zod-parse validation rejected it). The runner counts these under
   * `recordsSkipped` and continues; the adapter is expected to have logged
   * the reason already.
   */
  toStored: (source: TSource, contentHash: string) => StoredOpportunity | null;

  /**
   * Optional raw-record archive. The ETL writes the pre-transform JSON to
   * `<sourceId>/<iso-timestamp>.json` when a record is new or changed. Use
   * `NoopSnapshotStore` to opt out cleanly.
   */
  snapshots: ISnapshotStore;

  /** Logger for progress / errors. Defaults to `console`. */
  logger?: Logger;

  /**
   * Extract the source identifier from a raw record. Needed here because
   * `SyncDeps` is generic over `TSource`; only the adapter knows which
   * field is the natural identifier (PA's `slug`, grants.gov's
   * `opportunityNumber`, etc.).
   */
  getSourceId: (source: TSource) => string;
}

/** Optional knobs for a single `runSync` invocation. */
export interface SyncOptions {
  /**
   * When true, skip the contentHash short-circuit so every upstream record
   * is re-transformed and re-upserted even if its content hasn't changed.
   * Use this to repair bad rows after a transform-layer fix lands — the
   * cron / lazy-resync paths leave this `false` so steady-state syncs stay
   * cheap.
   */
  force?: boolean;
}

/**
 * Runs a full sync pass:
 *
 *   1. Log the start of a run in the repository's sync_log.
 *   2. Iterate every record from the source via `client.listAll()`.
 *   3. For each record:
 *      - Hash the raw record.
 *      - Look up the existing row by source id.
 *      - If the hash is unchanged (and `force` is not set), skip.
 *      - Otherwise, transform via `toStored`, upsert, and write a snapshot.
 *   4. Log completion with stats.
 *
 * Errors are caught, logged, recorded in the sync_log row, and re-thrown so
 * the caller (cron / admin endpoint) can decide how to surface them. The
 * function never double-commits stats even if a later step throws.
 */
export async function runSync<TSource>(
  deps: SyncDeps<TSource>,
  options: SyncOptions = {},
): Promise<SyncStats> {
  const force = options.force ?? false;
  const logger = deps.logger ?? console;
  const startedAt = new Date().toISOString();
  const runId = await deps.repo.logSyncStart();

  let recordsFetched = 0;
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;
  let errorMessage: string | null = null;

  try {
    for await (const source of deps.client.listAll()) {
      recordsFetched += 1;
      const sourceId = deps.getSourceId(source);
      const contentHash = await computeHash(source);
      const existing = await deps.repo.findBySourceId(sourceId);

      if (!force && existing && existing.contentHash === contentHash) {
        recordsSkipped += 1;
        continue;
      }

      const row = deps.toStored(source, contentHash);
      if (row === null) {
        recordsSkipped += 1;
        continue;
      }
      await deps.repo.upsert(row);
      await deps.snapshots.put(`${sourceId}/${startedAt}.json`, JSON.stringify(source));

      if (existing) recordsUpdated += 1;
      else recordsInserted += 1;
    }
    logger.info(
      `[sync] complete${force ? ' (forced)' : ''}: fetched=${recordsFetched} inserted=${recordsInserted} updated=${recordsUpdated} skipped=${recordsSkipped}`,
    );
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('[sync] failed', errorMessage);
    // Fall through so the sync_log row gets the error + a completion time;
    // re-throw at the end so the caller sees the failure.
  }

  const completedAt = new Date().toISOString();
  const stats: SyncStats = {
    startedAt,
    completedAt,
    recordsFetched,
    recordsInserted,
    recordsUpdated,
    recordsSkipped,
    errorMessage,
  };
  await deps.repo.logSyncComplete(runId, stats);

  if (errorMessage !== null) {
    throw new Error(errorMessage);
  }
  return stats;
}
