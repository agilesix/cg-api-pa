/**
 * Raw source-record archival.
 *
 * Used by the ETL to preserve the pre-transform source JSON for auditability
 * and debugging. Keys are typically of the form
 * `<sourceId>/<iso-timestamp>.json`.
 *
 * The default Workers deploy backs this with R2. A Node deploy could back it
 * with S3, GCS, or local disk. Tiers that don't need archival (proxy,
 * memory, dev) wire a `NoopSnapshotStore`.
 */
export interface ISnapshotStore {
  put(key: string, value: string): Promise<void>;

  /**
   * Bounded-parallel bulk write. The ETL hands off all changed-record
   * snapshots in one call so implementations can pipeline the underlying
   * object-store PUTs (e.g. up to 8 concurrent R2 fetches) rather than the
   * ETL awaiting each one sequentially. Order of completion is unspecified.
   */
  putMany(entries: Array<{ key: string; body: string }>): Promise<void>;
}
