import { createApp } from './app';
import { buildConfig } from './cg.config';

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
