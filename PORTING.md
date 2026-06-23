# Porting guide

This repo is designed so that swapping the deployment tier, database, hosting target, or source system is a **small, local change in `src/cg.config.ts`** — the rest of the codebase is agnostic.

Each recipe below is a concrete set of diffs, not prose. Pick the recipes that apply.

## Table of contents <!-- omit in toc -->

- [1. Scale down to Tier 0 (proxy-only)](#1-scale-down-to-tier-0-proxy-only)
- [2. Scale down to Tier 1 (in-memory on Node)](#2-scale-down-to-tier-1-in-memory-on-node)
- [3. Scale to Tier 2 (KV on serverless)](#3-scale-to-tier-2-kv-on-serverless)
- [4. Swap D1 → Postgres (stay on Tier 3)](#4-swap-d1--postgres-stay-on-tier-3)
- [5. Hosting swap (Workers → Node/Cloud Run)](#5-hosting-swap-workers--nodecloud-run)
- [6. Bypass the fetch layer (PA hosts internally)](#6-bypass-the-fetch-layer-pa-hosts-internally)
- [7. Scale up to Tier 4 (enterprise)](#7-scale-up-to-tier-4-enterprise)
- [8. Fork for a different source system](#8-fork-for-a-different-source-system)

---

## 1. Scale down to Tier 0 (proxy-only)

No database. Every request hits the upstream PA API, transforms on the fly, and caches in memory for a short TTL.

**Diff:**

```ts
// src/cg.config.ts
-import { SqliteOppRepo, createDb } from './storage/sql';
-import { D1Dialect } from './storage/sql/d1-dialect';
-import { BucketSnapshotStore } from './snapshots';
+import { ProxyOppRepo } from './storage/proxy';
+import { NoopSnapshotStore } from './snapshots';

 export function buildConfig(env: Cloudflare.Env, logger: Logger = console): AppConfig {
-  const db = createDb(new D1Dialect({ database: env.DB }));
-  const repo = new SqliteOppRepo(db);
-  const snapshots = new BucketSnapshotStore(env.SNAPSHOTS);
+  const client = new PaSourceClient(env.PA_API_BASE_URL);
+  const repo = new ProxyOppRepo(client, (src: PaGrant) => {
+    const opp = paGrantToOpportunity(src, new Date().toISOString());
+    // Proxy tier doesn't use content hashing — pass the source id as the hash.
+    return storedFromCommon(opp, {
+      sourceId: getSourceId(src),
+      searchText: buildSearchText(src),
+      contentHash: src.slug,
+    });
+  });
+  const snapshots = new NoopSnapshotStore();
   const service = new OpportunityService(repo);
-  const sync = (): Promise<SyncStats> => runSync({ ... });
-  return { repo, snapshots, service, sync, syncSecret, logger, version };
+  // No sync in proxy tier: the admin route is auto-omitted when `sync` is undefined.
+  return { repo, snapshots, service, syncSecret, logger, version };
 }
```

**`wrangler.jsonc`:** remove `d1_databases`, `r2_buckets`, `triggers.crons`.
**`package.json`:** remove `kysely`, `kysely-codegen`.

---

## 2. Scale down to Tier 1 (in-memory on Node)

Single-instance Node server with a `Map`-backed repository refreshed on a `setInterval`.

**Add `src/storage/memory/MemoryOpportunityRepository.ts`** (~30 lines) that implements `IOppRepo` against an internal `Map<string, StoredOpportunity>`. Filter/paginate in JS like `ProxyOppRepo` does; persist is `this.rows.set(row.id, row)`.

**Add `src/server.ts`** (Node entrypoint):

```ts
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { buildConfig } from './cg.config';
import { runSync } from './etl';

const config = buildConfig(process.env);
const app = createApp(config);
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });

// Refresh every 4 hours.
setInterval(() => config.sync?.(), 4 * 60 * 60 * 1000);
await config.sync?.(); // Initial sync on startup.
```

**Add `@hono/node-server` to dependencies.** Remove the Workers-specific deps (`wrangler`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`) if you're going Node-only.

---

## 3. Scale to Tier 2 (KV on serverless)

One JSON blob per opportunity in Cloudflare KV (or Upstash / DynamoDB / etc.).

**Add `src/storage/kv/KvOpportunityRepository.ts`** implementing `IOppRepo` against a KV binding. Keys: `opp:<id>` per opportunity, `idx:all` for a JSON-encoded list of IDs (for `search()`). Maintain `idx:all` on every upsert.

**`wrangler.jsonc`:** replace `d1_databases` with `kv_namespaces`.

**`src/cg.config.ts`:** `new KvOpportunityRepository(env.KV)` instead of the SQL repo.

---

## 4. Swap D1 → Postgres (stay on Tier 3)

All Kysely code stays the same — only the dialect changes.

```
pnpm add pg
pnpm add -D @types/pg
```

**`src/cg.config.ts`:**

```ts
-import { D1Dialect } from './storage/sql/d1-dialect';
+import { PostgresDialect } from 'kysely';
+import { Pool } from 'pg';

-const db = createDb(new D1Dialect({ database: env.DB }));
+const db = createDb(new PostgresDialect({
+  pool: new Pool({ connectionString: env.DATABASE_URL }),
+}));
```

**FTS5 → Postgres full-text search:** the only other change is in `SqliteOppRepo.searchByText()`. Replace the SQLite FTS5 query with a `tsvector @@ plainto_tsquery(...)` query. Every other method is unchanged because they're dialect-agnostic.

**Re-run `pnpm run migrate && pnpm run db:codegen`** against the new Postgres instance. Note the migration SQL may need minor adjustments for Postgres-specific syntax (`AUTOINCREMENT` → `SERIAL`/`IDENTITY`, `datetime('now')` → `NOW()`, FTS5 → `tsvector`).

---

## 5. Hosting swap (Workers → Node/Cloud Run)

Add a Node entrypoint alongside the Workers one.

**Add `src/server.ts`** (see recipe #2).

**Add `src/cg.config.ts`** with `buildConfig(env: NodeJS.ProcessEnv): AppConfig`:

- Database: pick a dialect (SQLite / Postgres).
- Snapshots: replace `BucketSnapshotStore` with `@google-cloud/storage`, `@aws-sdk/client-s3`, or local-disk (all implementing the `BucketLike` shape).
- Env: `process.env` instead of `env: Cloudflare.Env`.

**Remove Workers-specific deps if you're not deploying to Workers at all.** Or keep both entrypoints for flexibility.

---

## 6. Bypass the fetch layer (PA hosts internally)

When Pennsylvania itself hosts this API inside their own infrastructure, they may prefer to populate the database directly from their existing eGrants data warehouse rather than fetching from the public `egrants-apibeta` HTTP endpoint on a schedule.

**`src/cg.config.ts`:**

```ts
-const client = new PaSourceClient(env.PA_API_BASE_URL);
-const sync = (): Promise<SyncStats> => runSync({ client, ... });
+// No client, no sync. PA's internal ETL writes StoredOpportunity rows
+// directly into the same `opportunities` table via their own pipeline.
```

Return `{ repo, snapshots, service, syncSecret, logger, version }` — no `sync`. The admin route is auto-omitted; services, routes, and the PaPlugin remain unchanged.

**`wrangler.jsonc`:** remove `triggers.crons`. Remove `vars.PA_API_BASE_URL`.

---

## 7. Scale up to Tier 4 (enterprise)

Keep `SqliteOppRepo` and layer on enterprise concerns:

- **Authentication / RBAC:** add OAuth/JWT middleware in `createApp(config)` before route registration. `@hono/jwt` + a role-check middleware is ~30 lines.
- **Audit logging:** replace the default `console` logger in `buildConfig` with a structured logger (pino, Workers Analytics Engine, Datadog, …). The ETL + services already accept a `Logger`.
- **Horizontal scale with a dedicated search index:** implement `src/search/ElasticsearchIndex.ts`; have `SqliteOppRepo.search()` consult it first, falling back to SQL on cache miss.
- **Rate limiting:** Cloudflare Rate Limiting rules or Hono `rate-limiter` middleware.
- **Observability:** `wrangler.jsonc` `observability.enabled: true` is already on.

None of the above changes the contract of `IOppRepo` or touches routes, services, ETL, or the adapter.

---

## 8. Fork for a different source system

Example: an adapter for California's grants portal.

1. **Rename resources** in `wrangler.jsonc` from `pa-grants-*` to `ca-grants-*`. This is the collision-avoidance convention baked into the template.

2. **Replace `src/adapter/`** with a new adapter:
   - `fields.ts`: keep the mirrored shared schemas (`agency`, `contactInfo`, etc.) verbatim for cross-plugin interoperability. Add CA-specific fields as `ca*`.
   - `plugin.ts`: `definePlugin({ meta, schemas: { Opportunity: { customFields: {...shared, ...caSpecific }, sourceSchema, toCommon, fromCommon } } })` (SDK v0.5.0 — the plugin owns the source schema and transforms; see ADR 005).
   - `CaGrantsClient.ts`: new `ISourceClient` for CA's upstream.
   - `transform.ts`: CA's own pure `caGrantToOpportunity()` + reverse builder + helpers (no schema dependency).
   - `index.ts`: re-export the new public surface, including the per-source `getSourceId` and `buildSearchText` hooks.

3. **Update `src/cg.config.ts`** imports from `./adapter`. The ETL validates each record via `plugin.schemas.Opportunity.toCommon()` (skipping on `errors`) and builds the stored row with the generic `storedFromCommon()` plus the two per-source hooks.

4. **Verify shared-field alignment:** keep the alignment test in `__tests__/adapter/plugin.test.ts` — asserts that a fixture's shared custom-field values validate under your plugin's `commonSchema` and the mirrored value schemas. (The live cross-parse against `@common-grants/cg-grants-gov` is paused until a 0.5.0-compatible release ships; see the note in that test.)

Everything else — routes, services, ETL, storage tiers, CI/CD, docs UI — is unchanged.

When the adapter stabilizes, extract it as `@common-grants/cg-ca` (or similar) and add it as a workspace dep. The directory layout (`src/adapter/` with an `index.ts` public surface) was designed so this extraction is a folder move, not a rewrite.
