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
  private readonly concurrency: number;

  constructor(bucket: BucketLike, options: { concurrency?: number } = {}) {
    this.bucket = bucket;
    // R2 throughput is bounded by the worker's outbound fetch budget. 8
    // concurrent PUTs keeps us well under typical limits while still
    // collapsing a 362-record snapshot into ~46 round trips instead of 362.
    this.concurrency = options.concurrency ?? 8;
  }

  async put(key: string, value: string): Promise<void> {
    await this.bucket.put(key, value);
  }

  async putMany(entries: Array<{ key: string; body: string }>): Promise<void> {
    if (entries.length === 0) return;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, entries.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= entries.length) return;
        const entry = entries[i]!;
        await this.bucket.put(entry.key, entry.body);
      }
    });
    await Promise.all(workers);
  }
}
