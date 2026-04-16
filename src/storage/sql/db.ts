import { Kysely, type Dialect } from 'kysely';
import type { DB } from './schema';

/**
 * Factory for a typed Kysely instance. The `dialect` argument is the one
 * place in the codebase where a concrete driver is chosen — `src/cg.config.ts`
 * passes `D1Dialect` for Workers, `PostgresDialect` for a Node/Postgres
 * deploy, `SqliteDialect` for local Node, etc.
 *
 * Everything else in `src/storage/sql/` depends on `Kysely<DB>` and is
 * dialect-agnostic.
 */
export function createDb(dialect: Dialect): Kysely<DB> {
  return new Kysely<DB>({ dialect });
}

export type Db = Kysely<DB>;
