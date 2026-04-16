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
}
