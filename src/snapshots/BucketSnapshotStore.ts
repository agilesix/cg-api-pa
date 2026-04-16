import type { ISnapshotStore } from '../core';

/**
 * A minimal shape for Cloudflare R2 buckets. Written this way rather than
 * importing from `@cloudflare/workers-types` so the snapshots module has no
 * Workers-specific runtime dependency — any object-store client whose `put`
 * is compatible with this shape (S3 adapter, GCS adapter, local-disk
 * adapter) works without modification.
 */
export interface BucketLike {
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream | null,
  ): Promise<{ etag?: string } | null>;
}

/**
 * Raw-record archival backed by a Cloudflare R2 bucket (or any object store
 * implementing `BucketLike`). The ETL writes the pre-transform PA JSON
 * under `<sourceId>/<iso-timestamp>.json` for auditability.
 */
export class BucketSnapshotStore implements ISnapshotStore {
  private readonly bucket: BucketLike;

  constructor(bucket: BucketLike) {
    this.bucket = bucket;
  }

  async put(key: string, value: string): Promise<void> {
    await this.bucket.put(key, value);
  }
}
