/**
 * Public surface of the ETL orchestrator (future `@common-grants/etl`).
 *
 * Generic enough to work with any `ISourceClient` + `IOppRepo`
 * pair. Deployments wire it in `src/cg.config.ts` and invoke via Cron and/or
 * `POST /common-grants/admin/sync`.
 */

export { runSync, type SyncDeps, type SyncOptions } from './sync';
export { computeHash, canonicalJson } from './hash';
