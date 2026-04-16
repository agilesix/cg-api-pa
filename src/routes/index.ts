/**
 * Public surface of the routes layer.
 *
 * Each `registerXRoutes(app, deps)` mounts a slice of the API onto the
 * shared `OpenAPIHono` app. `src/app.ts` composes them; `src/cg.config.ts`
 * supplies the dependencies.
 */

export { registerOpportunityRoutes } from './opportunities';
export { registerAdminRoutes, type AdminDeps } from './admin';
export { registerHealthRoute } from './health';
export { registerDocsRoutes } from './docs';
