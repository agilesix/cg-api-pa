import { D1Dialect } from './storage/sql/d1-dialect';
import {
  PaPlugin,
  PaSourceClient,
  buildSearchText,
  getSourceId,
  paGrantToOpportunity,
  type PaGrant,
} from './adapter';
import type { IOppRepo, ISnapshotStore, Logger, SyncStats } from './core';
import { runSync, type SyncOptions } from './etl';
import { BucketSnapshotStore } from './snapshots';
import { OpportunityService } from './services';
import { SqliteOppRepo, createDb, storedFromCommon } from './storage';

/**
 * Everything the Hono app (`createApp`) needs to run.
 *
 * This interface is the narrowest possible contract between the app and
 * the host environment. Crucially, it has NO Cloudflare-, D1-, R2-, or
 * Workers-specific types — so a Node or Cloud Run port only has to write
 * a Node-flavored `buildConfig(process.env)` and pass its output into
 * `createApp`; the rest of the codebase is unchanged.
 */
export interface AppConfig {
  repo: IOppRepo;
  snapshots: ISnapshotStore;
  service: OpportunityService;
  /**
   * Pre-bound sync function. Optional: proxy-tier deployments have nothing
   * to sync and pass `undefined`, which causes the admin route to be
   * omitted entirely.
   */
  sync?: (options?: SyncOptions) => Promise<SyncStats>;
  /** Bearer token required by `POST /common-grants/admin/sync`. */
  syncSecret: string;
  logger: Logger;
  version: string;
}

/**
 * Test-only bindings that aren't in `wrangler.jsonc`. Kept as a local cast
 * so we don't have to augment the global `Cloudflare.Env` interface.
 */
interface RuntimeSecrets {
  readonly SYNC_SECRET?: string;
}

const VERSION = '0.1.0';

/**
 * Wire up the default Tier 3 (SQL/D1 + R2) deployment from Workers bindings.
 *
 * This is the ONLY non-entrypoint file allowed to import D1-specific or any
 * Cloudflare-specific types, so that the rest of the codebase stays
 * hosting-agnostic. Swap to a different tier by returning a different
 * combination of `repo` / `snapshots` / `sync` here:
 *
 *   - Tier 0 (proxy): `new ProxyOppRepo(paClient, storedFromPa)`
 *     and `sync: undefined`.
 *   - Tier 3 (SQL/D1, default): this function.
 *   - Postgres swap: replace `new D1Dialect(...)` with `new PostgresDialect(...)`.
 *
 * See PORTING.md for worked examples.
 */
export function buildConfig(env: Cloudflare.Env, logger: Logger = console): AppConfig {
  const secrets = env as unknown as Cloudflare.Env & RuntimeSecrets;
  const syncSecret = secrets.SYNC_SECRET ?? '';

  const db = createDb(new D1Dialect({ database: env.DB }));
  const repo = new SqliteOppRepo(db);
  const snapshots = new BucketSnapshotStore(env.SNAPSHOTS);
  const service = new OpportunityService(repo);

  const client = new PaSourceClient(env.PA_API_BASE_URL);

  const sync = (options?: SyncOptions): Promise<SyncStats> =>
    runSync(
      {
        client,
        repo,
        snapshots,
        logger,
        getSourceId,
        toStored: (g: PaGrant, contentHash) => {
          // Validate via the plugin's `toCommon`. `definePlugin()` wraps it
          // with `commonSchema` validation, so any non-empty `errors` means the
          // record wouldn't round-trip — skip it rather than persist data that
          // would fail at read time.
          const { errors } = PaPlugin.schemas.Opportunity.toCommon(g);
          if (errors.length > 0) {
            const detail = errors.map((e) => `${e.path || '<root>'}: ${e.message}`).join('; ');
            logger.warn(`[sync] skipping invalid record sourceId=${getSourceId(g)}: ${detail}`);
            return null;
          }
          // Persist the canonical wire shape: the pure builder emits calendar
          // dates as strings, whereas the SDK's *validated* `toCommon` output
          // normalizes them to `Date` (which would serialize as datetimes in
          // `rawJson`). Storage keeps the string shape.
          const opp = paGrantToOpportunity(g, new Date().toISOString());
          return storedFromCommon(opp, {
            sourceId: getSourceId(g),
            searchText: buildSearchText(g),
            contentHash,
          });
        },
      },
      options,
    );

  return {
    repo,
    snapshots,
    service,
    sync,
    syncSecret,
    logger,
    version: VERSION,
  };
}
