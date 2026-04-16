/**
 * Public surface of the snapshot stores.
 *
 * Each implementer of `ISnapshotStore` handles raw-record archival for a
 * specific backend. Deployments pick one in `src/cg.config.ts`; the ETL is
 * agnostic.
 */

export { NoopSnapshotStore } from './NoopSnapshotStore';
export { BucketSnapshotStore, type BucketLike } from './BucketSnapshotStore';
