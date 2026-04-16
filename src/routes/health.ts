import type { OpenAPIHono } from '@hono/zod-openapi';
import { createRoute, z } from '@hono/zod-openapi';
import type { OpportunityService } from '../services';

const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  lastSync: z.string().nullable(),
});

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Health check',
  description:
    'Liveness probe. Returns the service name, current version, and the timestamp of the most recent successful ETL run (or null if none).',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: HealthSchema } },
    },
  },
});

export function registerHealthRoute(
  app: OpenAPIHono,
  service: OpportunityService,
  version: string,
): OpenAPIHono {
  app.openapi(healthRoute, async (c) => {
    const lastSync = await service.getLastSyncedAt();
    return c.json(
      {
        status: 'ok' as const,
        service: 'pa-commongrants-api',
        version,
        lastSync,
      },
      200,
    );
  });
  return app;
}
