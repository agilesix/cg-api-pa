/**
 * Shared types for the core contracts layer (future `@common-grants/contracts`).
 *
 * These types are deliberately adapter-agnostic and persistence-agnostic so
 * that every `IOppRepo` implementation (proxy, memory, KV, SQL)
 * agrees on the same shape. The full typed `Opportunity` (including
 * adapter-specific custom fields) is serialized as JSON in
 * `StoredOpportunity.rawJson` and deserialized at the service layer via the
 * active adapter's schema.
 */

import type {
  OppFilters as _OppFilters,
  OppSorting as _OppSorting,
} from '@common-grants/sdk/types';

export type OppFilters = _OppFilters;
export type OppSorting = _OppSorting;

/**
 * A persisted opportunity row — the lowest-common-denominator shape that
 * every `IOppRepo` stores and retrieves.
 *
 * Denormalized columns (`title`, `status`, `closeDate`, funding amounts)
 * exist so tiered storage implementations can do server-side filtering and
 * sorting without parsing `rawJson` on every query.
 */
export interface StoredOpportunity {
  /** CommonGrants UUID (v5 deterministic from the source identifier). */
  id: string;
  /** Source-system identifier (PA slug, grants.gov opportunity id, etc.). */
  sourceId: string;
  /** Display title, denormalized for search/sort. */
  title: string;
  /** CG `OppStatus.value` — `forecasted | open | closed | custom`. */
  status: string;
  /** ISO 8601 datetime, or null if not set. */
  closeDate: string | null;
  /** ISO 8601 datetime, or null if not set. */
  postDate: string | null;
  /**
   * Funding amounts stored as integer cents to avoid floating-point drift
   * and to make range queries ergonomic. Converted to/from the SDK's
   * `Money` shape at the adapter/service boundary.
   */
  minAwardAmountCents: number | null;
  maxAwardAmountCents: number | null;
  totalAmountAvailableCents: number | null;
  /** Concatenated searchable text (title + description + agency + ...) for FTS. */
  searchText: string;
  /** Canonical-JSON SHA-256 of the source record; used by the ETL for change detection. */
  contentHash: string;
  /** ISO 8601 datetime of the record's last modification in the source system. */
  lastModifiedAt: string;
  /** Fully serialized CommonGrants `Opportunity` (including any plugin custom fields). */
  rawJson: string;
}

/**
 * Query parameters for `IOppRepo.search()`.
 *
 * Uses the SDK's native `OppFilters` and `OppSorting` types directly so that
 * structured operators (e.g. `status.operator: "notIn"`,
 * `closeDateRange.operator: "outside"`) and custom filters flow through to
 * the repository without flattening. Each repository tier interprets these
 * as best it can — the proxy tier filters in JS; the SQL tier translates to
 * `WHERE` + `ORDER BY`.
 *
 * `pagination` is non-optional: the service layer enforces defaults and
 * limits before passing to the repo.
 */
export interface OpportunitySearchParams {
  /** Full-text query. FTS-backed impls tokenize; simpler impls do substring match. */
  query?: string;
  /** Structured CommonGrants filters (status, closeDateRange, funding ranges, custom). */
  filters?: OppFilters;
  /** Sort field + direction. */
  sorting?: OppSorting;
  /** Pagination — always provided by the service layer (defaults + cap enforced). */
  pagination: { page: number; pageSize: number };
}

/** Result shape for paginated queries. `total` is the full count, not just this page. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

/** ETL run accounting, persisted by `IOppRepo.logSyncComplete()`. */
export interface SyncStats {
  startedAt: string;
  completedAt: string;
  recordsFetched: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errorMessage: string | null;
}

/**
 * Minimal logger shape used by the ETL and service layers. Lets deployments
 * plug in console, pino, structured Workers logs, etc. without coupling.
 */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
