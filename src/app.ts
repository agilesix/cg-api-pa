import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import type { AppConfig } from './cg.config';
import {
  registerAdminRoutes,
  registerDocsRoutes,
  registerHealthRoute,
  registerOpportunityRoutes,
} from './routes';

/**
 * Build the Hono app from injected dependencies.
 *
 * This factory has **no Workers-specific types** and no knowledge of which
 * `IOppRepo` tier is wired in. Tests call it with a fake repo
 * service; Cloud Run / Node deployments call it with Node-native deps; the
 * Workers entrypoint calls it with `buildConfig(env)`.
 *
 * The `sync` admin endpoint is registered conditionally — tier 0 (proxy)
 * deployments pass `deps.sync === undefined`, and the admin route is
 * omitted from both the router and the OpenAPI spec.
 */
export function createApp(deps: AppConfig): OpenAPIHono {
  const app = new OpenAPIHono();

  // Public, unauthenticated read API — any origin, any browser. `X-Data-As-Of`
  // is exposed so clients can read the freshness timestamp the routes set.
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['X-Data-As-Of'],
      maxAge: 86400,
    }),
  );

  registerHealthRoute(app, deps.service, deps.version);
  registerOpportunityRoutes(app, deps.service);

  if (deps.sync) {
    registerAdminRoutes(app, {
      syncSecret: deps.syncSecret,
      runSync: deps.sync,
    });
  }

  registerDocsRoutes(app);

  app.onError((err, c) => {
    deps.logger.error('[app] unhandled error', err instanceof Error ? err.message : String(err));
    return c.json(
      {
        status: 500,
        message: 'Internal Server Error',
        errors: [err instanceof Error ? err.message : String(err)],
      },
      500,
    );
  });

  return app;
}
