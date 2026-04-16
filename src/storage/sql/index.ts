/**
 * Public surface of the SQL storage tier (future `@common-grants/repository-sql`).
 *
 * Tier 3 implementation of `IOppRepo`, Kysely-backed, dialect-
 * agnostic. The concrete dialect (`D1Dialect` for Workers, `PostgresDialect`
 * for Postgres, etc.) is chosen in `src/cg.config.ts` and injected via
 * `createDb()`.
 *
 * Migration SQL lives in `./migrations/` and is applied via
 * `pnpm run migrate` (local) or `pnpm run migrate:remote` (production D1).
 */

export { SqliteOppRepo } from './SqliteOppRepo';
export { D1Dialect, type D1DialectConfig } from './d1-dialect';
export { createDb, type Db } from './db';
export type { DB, OpportunitiesTable, SyncLogTable } from './schema';
