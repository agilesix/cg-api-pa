/**
 * Kysely type-level schema for the SQL tier.
 *
 * This file is kept in sync with `migrations/*.sql` manually for now. The
 * project ships a `kysely-codegen` workflow (see CONTRIBUTING.md) but running
 * it requires applying migrations to a local D1 first, which we do after the
 * first `wrangler d1 create`. Until that's done for a given checkout, this
 * hand-written copy is authoritative.
 *
 * After running `pnpm run migrate && pnpm run db:codegen`, this file is
 * overwritten. Any hand-added documentation in it will be lost — keep it
 * minimal and document conventions in CONTRIBUTING.md instead.
 */

import type { ColumnType, Generated } from 'kysely';

export interface OpportunitiesTable {
  id: string;
  source_id: string;
  title: string;
  status: string;
  close_date: string | null;
  post_date: string | null;
  min_award_amount_cents: number | null;
  max_award_amount_cents: number | null;
  total_amount_available_cents: number | null;
  search_text: string;
  content_hash: string;
  last_modified_at: string;
  raw_json: string;
  /** SQL DEFAULT (datetime('now')) — optional on insert. */
  created_at: ColumnType<string, string | undefined, string>;
  /** SQL DEFAULT (datetime('now')) — optional on insert. */
  updated_at: ColumnType<string, string | undefined, string>;
}

export interface SyncLogTable {
  /** INTEGER PRIMARY KEY AUTOINCREMENT — generated on insert. */
  id: Generated<number>;
  started_at: string;
  completed_at: string | null;
  records_fetched: number | null;
  records_inserted: number | null;
  records_updated: number | null;
  records_skipped: number | null;
  error_message: string | null;
}

export interface DB {
  opportunities: OpportunitiesTable;
  sync_log: SyncLogTable;
}
