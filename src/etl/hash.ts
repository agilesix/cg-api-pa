/**
 * Deterministic content hashing for ETL change detection.
 *
 * The ETL hashes every fetched source record and compares against the
 * `content_hash` of the row already in the repository. Unchanged records
 * are skipped without re-serializing, re-transforming, or re-writing the
 * snapshot — which is how a full sync of 362 mostly-static records stays
 * fast.
 *
 * Implementation:
 *   1. Serialize the record to canonical JSON (keys sorted at every level).
 *      Two objects with the same data but different key order produce the
 *      same hash.
 *   2. SHA-256 via Web Crypto (available in Workers and Node.js 18+).
 *   3. Hex-encode the digest for compact storage and easy comparison.
 */

/** Recursively canonicalize: sort object keys, leave arrays/primitives alone. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, canonicalize(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

/** Serialize `value` to canonical JSON (sorted keys, no whitespace). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Hex-encode a byte buffer. */
function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 the canonical JSON of `value`, return lowercase hex digest. */
export async function computeHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return hex(digest);
}
