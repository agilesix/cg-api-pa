/**
 * An adapter-supplied client for a source grants system.
 *
 * Each adapter (e.g. `@common-grants/cg-pa`, `@common-grants/cg-grants-gov`)
 * provides its own `ISourceClient` implementation. The `TSource` generic is
 * the adapter's raw record type — `IOppRepo` and the ETL are
 * agnostic to it.
 *
 * For tier 0 (proxy) deployments this is the primary data source, hit on
 * every request. For DB-backed tiers it is only used by the scheduled ETL.
 * Deployments that populate the database directly (e.g. an internal host
 * that writes from their warehouse) may omit the client entirely.
 */
export interface ISourceClient<TSource = unknown> {
  /**
   * Fetch a single record by its source-system identifier (e.g. PA slug,
   * grants.gov opportunity number). Returns `null` if the source reports
   * 404 or equivalent.
   */
  getGrant(sourceId: string): Promise<TSource | null>;

  /**
   * Iterate every record from the source. Implementations may page
   * internally; callers treat it as a single stream. The ETL consumes this
   * generator once per sync run.
   */
  listAll(): AsyncIterable<TSource>;
}
