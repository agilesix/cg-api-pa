import type { OpenAPIHono } from '@hono/zod-openapi';
import { createRoute, z } from '@hono/zod-openapi';
import { ErrorSchema } from '@common-grants/sdk/schemas';
import type { SyncStats } from '../core';
import type { SyncOptions } from '../etl';

/**
 * Bearer-token authenticated admin endpoints.
 *
 * Injected via `registerAdminRoutes` rather than hardcoded so:
 *   - deployments without an ETL (proxy tier) can skip registration
 *   - deployments with different trigger mechanisms (GitHub Actions calling
 *     the endpoint instead of Cloudflare Cron) share the same handler
 */

const SyncStatsSchema = z.object({
  startedAt: z.string(),
  completedAt: z.string(),
  recordsFetched: z.number().int(),
  recordsInserted: z.number().int(),
  recordsUpdated: z.number().int(),
  recordsSkipped: z.number().int(),
  errorMessage: z.string().nullable(),
});

const syncRoute = createRoute({
  method: 'post',
  path: '/admin/sync',
  tags: ['Admin'],
  summary: 'Trigger a manual sync',
  description:
    'Fetches all records from the upstream source and upserts them into the local repository. Protected by a Bearer token; the same `runSync` function is invoked by the scheduled Cron trigger. Pass `?force=true` to re-transform every record even if its content hash is unchanged — use this to repair stored rows after a transform-layer fix.',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      force: z.enum(['true', 'false']).optional().openapi({
        description:
          'When `true`, bypass the contentHash short-circuit and re-transform every upstream record.',
        example: 'true',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Sync completed',
      content: { 'application/json': { schema: SyncStatsSchema } },
    },
    401: {
      description: 'Missing or invalid Bearer token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Sync failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

export interface AdminDeps {
  /** Secret that callers must present as `Authorization: Bearer <secret>`. */
  syncSecret: string;
  /** The sync function — pre-bound to its SyncDeps by `buildConfig`. */
  runSync: (options?: SyncOptions) => Promise<SyncStats>;
}

export function registerAdminRoutes(app: OpenAPIHono, deps: AdminDeps): OpenAPIHono {
  app.openapi(syncRoute, async (c) => {
    const auth = c.req.header('authorization') ?? '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1] !== deps.syncSecret) {
      return c.json(
        {
          status: 401,
          message: 'Unauthorized',
          errors: [],
        },
        401,
      );
    }
    try {
      const { force } = c.req.valid('query');
      const stats = await deps.runSync({ force: force === 'true' });
      return c.json(stats, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          status: 500,
          message: 'Sync failed',
          errors: [message],
        },
        500,
      );
    }
  });

  // Register the securityScheme in the generated spec.
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
  });

  return app;
}
