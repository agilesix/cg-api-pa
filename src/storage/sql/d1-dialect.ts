/**
 * Kysely dialect for Cloudflare D1.
 *
 * Replaces the `kysely-d1` npm package (unmaintained, ~100 LOC) with an
 * internal implementation. D1 is SQLite under the hood, so the adapter,
 * introspector, and query compiler are all Kysely's built-in SQLite variants.
 * The only custom piece is the Driver/Connection that translates Kysely's
 * `CompiledQuery` into D1's `.prepare(sql).bind(...params).all()` API.
 *
 * Limitations (inherited from D1):
 *   - No transactions (`beginTransaction` throws).
 *   - No streaming (`streamQuery` throws).
 */

import {
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from 'kysely';

export interface D1DialectConfig {
  database: D1Database;
}

export class D1Dialect implements Dialect {
  private readonly config: D1DialectConfig;

  constructor(config: D1DialectConfig) {
    this.config = config;
  }

  createAdapter() {
    return new SqliteAdapter();
  }

  createDriver() {
    return new D1Driver(this.config);
  }

  createQueryCompiler() {
    return new SqliteQueryCompiler();
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}

class D1Driver implements Driver {
  private readonly config: D1DialectConfig;

  constructor(config: D1DialectConfig) {
    this.config = config;
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new D1Connection(this.config);
  }

  async beginTransaction(conn: DatabaseConnection): Promise<void> {
    await (conn as D1Connection).beginTransaction();
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await (conn as D1Connection).commitTransaction();
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await (conn as D1Connection).rollbackTransaction();
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}

class D1Connection implements DatabaseConnection {
  private readonly config: D1DialectConfig;

  constructor(config: D1DialectConfig) {
    this.config = config;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const results = await this.config.database
      .prepare(compiledQuery.sql)
      .bind(...compiledQuery.parameters)
      .all();

    if (results.error) {
      throw new Error(results.error);
    }

    const numAffectedRows = results.meta.changes > 0 ? BigInt(results.meta.changes) : undefined;

    return {
      insertId: results.meta.last_row_id != null ? BigInt(results.meta.last_row_id) : undefined,
      rows: (results.results ?? []) as R[],
      numAffectedRows,
    };
  }

  async beginTransaction(): Promise<void> {
    throw new Error('D1 does not support transactions.');
  }

  async commitTransaction(): Promise<void> {
    throw new Error('D1 does not support transactions.');
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error('D1 does not support transactions.');
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('D1 does not support streaming.');
  }
}
