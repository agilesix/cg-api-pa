import type { StoredOpportunity } from '../core';

/**
 * Generic projection from a CommonGrants `Opportunity` to the storage-tier
 * `StoredOpportunity` row.
 *
 * This replaces the former adapter-specific `buildStoredOpportunity(paGrant,
 * ...)`. Because the SDK v0.5.0 plugin standardizes the common schema, every
 * denormalized column except `searchText` and `sourceId` derives generically
 * from the CG opportunity — so a new source only has to supply those two
 * per-source hooks (plus the content hash) rather than reimplement the whole
 * row builder. (When a second source lands — see the California plan — this is
 * the seam to fold into a small standardized binding contract.)
 *
 * Accepts the **string-shaped** opportunity emitted by a plugin's `toCommon`
 * (dates as strings); also tolerates the parsed `Date` shape.
 */

/** A CG `Money`-shaped value. */
interface MoneyLike {
  amount?: unknown;
}

/** The subset of a CG single-date event we read for denormalized date columns. */
interface EventLike {
  eventType?: unknown;
  date?: unknown;
  time?: unknown;
}

/** The minimal structural view of a CG `Opportunity` needed to build a row. */
export interface CgOpportunityLike {
  id: string;
  title: string;
  status: { value: string };
  funding?: {
    minAwardAmount?: MoneyLike | null;
    maxAwardAmount?: MoneyLike | null;
    totalAmountAvailable?: MoneyLike | null;
  } | null;
  keyDates?: {
    postDate?: EventLike | null;
    closeDate?: EventLike | null;
  } | null;
  // Optional `unknown` because the plugin's string-shaped (input) opportunity
  // types datetime fields loosely; `isoString` narrows at runtime.
  lastModifiedAt?: unknown;
}

/** Per-source inputs the CG opportunity can't supply on its own. */
export interface StoredFromCommonMeta {
  /** Source-system identifier (e.g. PA slug). */
  sourceId: string;
  /** Concatenated FTS text (source-specific field selection). */
  searchText: string;
  /** Canonical-JSON hash of the source record, for change detection. */
  contentHash: string;
}

/** Build a `StoredOpportunity` row from a CG opportunity plus per-source metadata. */
export function storedFromCommon(
  opp: CgOpportunityLike,
  meta: StoredFromCommonMeta,
): StoredOpportunity {
  return {
    id: opp.id,
    sourceId: meta.sourceId,
    title: opp.title,
    status: opp.status.value,
    closeDate: eventToIso(opp.keyDates?.closeDate),
    postDate: eventToIso(opp.keyDates?.postDate),
    minAwardAmountCents: moneyToCents(opp.funding?.minAwardAmount),
    maxAwardAmountCents: moneyToCents(opp.funding?.maxAwardAmount),
    totalAmountAvailableCents: moneyToCents(opp.funding?.totalAmountAvailable),
    searchText: meta.searchText,
    contentHash: meta.contentHash,
    lastModifiedAt: isoString(opp.lastModifiedAt),
    rawJson: JSON.stringify(opp),
  };
}

/** CG `Money` → integer cents, or null. */
function moneyToCents(money: MoneyLike | null | undefined): number | null {
  if (!money || typeof money.amount !== 'string') return null;
  const dollars = Number(money.amount);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/** CG single-date event → ISO 8601 string (date, optionally with time), or null. */
function eventToIso(event: EventLike | null | undefined): string | null {
  if (!event || event.eventType !== 'singleDate') return null;
  const date = event.date instanceof Date ? event.date.toISOString().slice(0, 10) : event.date;
  if (typeof date !== 'string') return null;
  return typeof event.time === 'string' && event.time ? `${date}T${event.time}` : date;
}

/** Coerce a datetime (string or `Date`) to an ISO string; `""` for anything else. */
function isoString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return '';
}
