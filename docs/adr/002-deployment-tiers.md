# ADR 002: Deployment tiers

**Status:** Accepted (2026-04-15)

## Context

The template needs to support a wide range of deployments — from a zero-ops proof-of-concept to an enterprise internal service — without forking the codebase or introducing build-time variants.

## Decision

Five deployment tiers, distinguished by their `IOppRepo` implementation:

| Tier                  | Repository                                              | Upstream access                    | Storage                            | Search                                               | Best for                                     |
| --------------------- | ------------------------------------------------------- | ---------------------------------- | ---------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| **0 — Proxy**         | `ProxyOppRepo`                                          | Every request (TTL-cached)         | None                               | JS filter on fetched array                           | POC / demos / tiny datasets / zero-ops       |
| **1 — Memory**        | `MemoryOpportunityRepository` (future 30-line addition) | Scheduled refresh on a Node server | Process memory (`Map`)             | JS filter                                            | Node single-instance, small data             |
| **2 — KV**            | `KvOpportunityRepository` (future)                      | Scheduled ETL via Cron             | Cloudflare KV / Upstash / DynamoDB | JS filter on KV blob                                 | Serverless, read-heavy, eventual consistency |
| **3 — SQL (default)** | `SqliteOppRepo`                                         | Scheduled ETL via Cron             | D1 / SQLite / Postgres via Kysely  | SQL `WHERE` + FTS5 / tsvector                        | Most production cases                        |
| **4 — Enterprise**    | `SqliteOppRepo` + middleware                            | Scheduled ETL or direct DB writes  | Postgres / warehouse               | SQL + dedicated search index (Elasticsearch plug-in) | Large data, strict security/audit            |

The ONLY files that change tier-to-tier:

- `src/cg.config.ts` — which repository implementation is wired.
- `package.json` — tier-specific runtime dependencies (`kysely` only for Tier 3+, `@hono/node-server` only for Node-hosted tiers, etc.).
- `wrangler.jsonc` or equivalent deploy config — which bindings exist.

Routes, services, ETL, adapter, plugin, and tests are **identical** across all tiers.

## Consequences

- Downstream implementers (including PA itself) can bring their own infrastructure without forking.
- Adding a new tier is a new file (one repository implementation) and a PORTING.md recipe — never a cross-cutting change.
- Scale-down is genuinely lightweight: Tier 0 removes `kysely`, `kysely-codegen` from the dependency graph and has zero persistence concerns.
- Scale-up works without a rewrite: Tier 4 adds middleware and an auxiliary index but preserves the same route surface and data model.

## Trade-offs acknowledged

- `IOppRepo` is common-denominator and does not expose tier-specific capabilities (e.g. SQL transactions, FTS5 ranking). A feature that needs them should be a private method on the SQL implementation (like `searchByText`) rather than leaking into the interface. This is a deliberate constraint — the alternative would make tier substitution meaningless.
- FTS5 is SQLite-specific; Postgres deployments replace `SqliteOppRepo.searchByText()` with a tsvector implementation. All other code is dialect-agnostic.
