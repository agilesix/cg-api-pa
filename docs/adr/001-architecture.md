# ADR 001: Architecture

**Status:** Accepted (2026-04-15)
**Context:** scaffolding the PA CommonGrants API as both a proof of concept and a reusable template.

## Context

Pennsylvania's eGrants Beta API exposes ~362 grant opportunity records as a single unpaginated, unfiltered JSON envelope. We want to surface that data through a CommonGrants-compliant API so PA grant seekers get a standard, interoperable interface, and so Pennsylvania itself can consider adopting the protocol natively.

Beyond PA, this repo is a **template**: other states (or funders) should be able to fork it, swap the adapter, and re-deploy with minimal changes. The user also needs the template to scale **in both directions** — down to a proxy-only service for demos and small datasets, up to an enterprise deployment with strict security, observability, and horizontal-scale requirements.

## Decision

1. **Cloudflare Workers + D1 (SQLite) + R2 is the default deployment** — chosen for:
   - Zero-operations per-request costs at this dataset size.
   - Built-in D1 for relational queries + FTS5 full-text search.
   - R2 for raw source snapshots (auditability).
   - Cron triggers for the scheduled ETL, no external scheduler needed.
   - Local dev via Miniflare that exactly matches production.

2. **One Workers-aware module** — `src/index.ts` and `src/cg.config.ts` are the **only** files that may import Cloudflare-specific types. Every other layer depends on interfaces from `src/core/` (`ISourceClient`, `IOppRepo`, `ISnapshotStore`). A Node/Cloud Run port is a new `src/server.ts` + a Node-flavored `buildConfig()`, no other code changes.

3. **Deployment tiers are repository implementations.** `IOppRepo` is deliberately minimal (findById, findBySourceId, search, upsert, sync_log methods) so it can be implemented as a pass-through proxy (Tier 0), an in-process cache (Tier 1), a KV blob store (Tier 2), a SQL/Kysely store (Tier 3), or Postgres + Elasticsearch (Tier 4) — all with the exact same route and service code.

4. **Directory layout foreshadows future npm packages** — without actually splitting today. Each `src/<dir>/` has an `index.ts` public surface; cross-directory deep imports are forbidden by ESLint `no-restricted-imports` zones. Future extractions are folder moves, not rewrites.

5. **CommonGrants SDK used directly** — all base schemas, filters, pagination envelopes, and the plugin/extensions API come from `@common-grants/sdk`. The PA adapter mirrors `ts-grants-gov`'s shared value schemas (`agency`, `contactInfo`, `additionalInfo`, `costSharing`, `legacySerialId`) verbatim so values are interoperable across plugins per commongrants.org/custom-fields/.

6. **OpenAPI auto-generated from Hono + Zod** — no TypeSpec, no handwritten spec file. `scripts/export-openapi.ts` materializes `dist/openapi.json`, which is validated against the base protocol via `@common-grants/cli`'s `cg check spec` in CI (currently advisory — some SDK-level nullability quirks are tracked separately).

## Alternatives considered

- **Express + handwritten OpenAPI:** the existing `simpler-grants-protocol/templates/express-js/` uses this pattern, but it couples the routes to a spec file that drifts without discipline. Auto-generation from Zod was preferred.
- **Flat monorepo with split packages from day one:** rejected as premature. Organize the directory layout so a split is cheap when it becomes useful.
- **Postgres as the default:** rejected because the PA dataset is tiny and D1 is zero-ops. Postgres is a one-line swap per PORTING.md if the dataset or deployment requirements change.

## Consequences

- Anyone reading `src/` can find the Workers-specific concerns localized to two files (`index.ts`, `deps.ts`).
- Swapping tiers is a single change in `deps.ts` + package.json + wrangler.jsonc. Routes, services, ETL, adapter, tests don't move.
- The `src/adapter/` directory is extractable to `@common-grants/cg-pa` later as a single-folder move.
- Cross-plugin alignment on shared custom fields is enforced by an automated test, not just conventions.
