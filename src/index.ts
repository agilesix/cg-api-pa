import { createApp } from './app';
import { buildConfig, type AppConfig } from './cg.config';

/** Matches the cron interval in wrangler.jsonc. */
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

/**
 * Per-isolate guard against firing concurrent syncs when a burst of cold
 * requests all see stale/missing data. The first request assigns the promise;
 * subsequent requests observe it and skip. Cleared when the sync settles.
 */
let inFlightSync: Promise<unknown> | null = null;

/**
 * Lazy, cache-miss-style resync: if data is missing (fresh DB) or older than
 * the cron interval (cron missed or never ran — local dev, PR previews), fire
 * `config.sync()` in the background. Does not block the response; the
 * triggering request still returns whatever is currently in the repo.
 */
async function maybeResync(config: AppConfig, ctx: ExecutionContext): Promise<void> {
  if (!config.sync || inFlightSync) return;
  const lastSync = await config.repo.getLastSyncedAt();
  const isStale = !lastSync || Date.now() - new Date(lastSync).getTime() > STALE_AFTER_MS;
  if (!isStale) return;
  inFlightSync = config.sync().finally(() => {
    inFlightSync = null;
  });
  ctx.waitUntil(inFlightSync);
}

/**
 * Cloudflare Workers entrypoint.
 *
 * This is the **only** module — together with `src/cg.config.ts` — that imports
 * Workers-specific types or runtime APIs. Every other layer of the
 * codebase is hosting-agnostic. A Node or Cloud Run port adds a sibling
 * `src/server.ts` that calls `createApp(buildConfig(process.env))` — no
 * other files change. See PORTING.md.
 *
 * Two exports:
 *   - `fetch` serves HTTP requests via the Hono app.
 *   - `scheduled` runs the ETL on the cron trigger defined in wrangler.jsonc.
 *     Deployments without an ETL (proxy tier) leave `deps.sync` undefined
 *     and this handler is a no-op.
 */
export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    const config = buildConfig(env);
    await maybeResync(config, ctx);
    return createApp(config).fetch(request, env, ctx);
  },

  async scheduled(
    _event: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const config = buildConfig(env);
    if (config.sync) {
      ctx.waitUntil(config.sync());
    }
  },
};
