import type { OpenAPIHono } from '@hono/zod-openapi';

/**
 * Scalar API Reference UI served as a single inline HTML page that loads
 * Scalar from a CDN. Keeps the Docs UI zero-dependency at build time — the
 * browser fetches Scalar's bundle lazily from jsdelivr.
 *
 * `/openapi.json` is the auto-generated spec served by
 * `OpenAPIHono#doc31()`; the HTML below just points Scalar at it.
 */
const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PA CommonGrants API Reference</title>
    <style>body { margin: 0 }</style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi.json"
      data-configuration='{"theme":"default","layout":"modern","showSidebar":true}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
`;

export function registerDocsRoutes(app: OpenAPIHono): OpenAPIHono {
  // OpenAPI 3.1 JSON spec.
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'PA CommonGrants API',
      version: '0.1.0',
      description:
        'A CommonGrants-compliant HTTP API that surfaces Pennsylvania eGrants data. ' +
        'Generated automatically from Hono + Zod route definitions.',
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [{ url: '/', description: 'This server' }],
  });

  // Scalar UI.
  app.get('/docs', (c) => c.html(DOCS_HTML));

  // Root → docs redirect so hitting the base URL shows something useful.
  app.get('/', (c) => c.redirect('/docs'));

  return app;
}
