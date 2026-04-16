# Development

Local development guide for the PA CommonGrants API.

## Prerequisites

- **Node.js** 22 or higher. A `.node-version` and `.nvmrc` are checked in; run `nvm use` (or `fnm use`) after cloning.
- **pnpm** 10 or higher. This repo pins the exact version via the `packageManager` field. Run `corepack enable` once after cloning to let Corepack auto-install the pinned pnpm.
- **Cloudflare account** (optional, only needed to deploy). Local development uses the Wrangler-bundled Miniflare runtime with a local SQLite-backed D1.
- **Wrangler** is installed as a dev dependency — no global install needed; run it via `pnpm run` scripts.

## Installation

```bash
git clone <repo-url> api-pa
cd api-pa
corepack enable        # once, if you haven't already
pnpm install
```

## Local development

### 1. First-time Cloudflare bootstrap

All first-time Cloudflare setup is a single idempotent command — no clicking through the dashboard:

```bash
pnpm exec wrangler login    # once, if you haven't already
pnpm run bootstrap          # creates D1 + R2, patches wrangler.jsonc, applies migrations
```

`bootstrap` does the following (safe to re-run if any step fails):

1. Verifies Cloudflare auth.
2. Creates the `pa-grants-commongrants` D1 database (or reuses the existing one by name).
3. Patches `wrangler.jsonc`'s `database_id` placeholder with the real id.
4. Creates the `pa-grants-raw-snapshots` R2 bucket (or reuses it).
5. Applies local D1 migrations.

#### One-time R2 enablement

The first time you use R2 on a Cloudflare account, you have to accept R2's terms and attach a billing method in the dashboard. This genuinely cannot be scripted — the Cloudflare API rejects R2 calls until a human has agreed to the terms. `bootstrap` detects this case and prints the URL to click (`https://dash.cloudflare.com/?to=/:account/r2`) before exiting. After enabling, re-run `pnpm run bootstrap`.

If you're running a tier that doesn't need raw-record archival (tier 0 proxy or tier 1 in-memory), you can skip R2 entirely: remove `r2_buckets` from `wrangler.jsonc` and swap `BucketSnapshotStore` for `NoopSnapshotStore` in `src/cg.config.ts`. See [PORTING.md](PORTING.md) recipe #1.

When you fork this template for a different state, edit the two `DB_NAME` / `BUCKET_NAME` constants at the top of `scripts/bootstrap.ts` (and the matching names in `wrangler.jsonc` + the `migrate` / `db:codegen` scripts in `package.json`). Then `pnpm run bootstrap` works for your fork too.

Local D1 state lives under `.wrangler/state/v3/d1/pa-grants-commongrants/`. Re-regenerate SQL types after any migration:

```bash
pnpm run db:codegen
```

### 2. Run the dev server

```bash
pnpm run dev
```

This starts a local Worker at `http://localhost:8787` via Miniflare. It hot-reloads on source changes.

### 3. Try the API

```bash
# Health check
curl http://localhost:8787/health

# OpenAPI spec
curl http://localhost:8787/openapi.json

# Swagger-style docs UI (Scalar, loaded from CDN)
open http://localhost:8787/docs

# List opportunities (requires a sync to populate data)
curl 'http://localhost:8787/common-grants/opportunities?page=1&pageSize=5'

# Search
curl -X POST http://localhost:8787/common-grants/opportunities/search \
  -H 'Content-Type: application/json' \
  -d '{"search": "agriculture"}'
```

### 4. Run a manual sync

The sync endpoint is Bearer-protected. Set `SYNC_SECRET` in a `.dev.vars` file:

```bash
echo 'SYNC_SECRET=local-dev-secret' > .dev.vars
```

Then trigger a sync:

```bash
curl -X POST http://localhost:8787/common-grants/admin/sync \
  -H 'Authorization: Bearer local-dev-secret'
```

This fetches all opportunities from the PA eGrants Beta API, transforms them into CommonGrants format, and upserts them into local D1. A second call hash-skips unchanged records.

## Tests

```bash
pnpm test              # run all tests once
pnpm run test:coverage # with v8 coverage report
```

Test layout mirrors `src/`. Tests fall into two buckets:

- **Pure unit tests** (adapter, transform, proxy repository, ETL orchestration with mocks) run under plain vitest with the Node environment.
- **Storage tests for the SQL tier** run under `@cloudflare/vitest-pool-workers` so Kysely talks to a real in-memory D1.

Individual test selection works as expected:

```bash
pnpm test src/adapter/__tests__/transform.test.ts
```

## Checks

All the checks that run in CI are wrapped in local scripts:

```bash
pnpm run check:types     # tsc --noEmit
pnpm run check:lint      # eslint .
pnpm run check:format    # prettier --check .
pnpm run check:spec      # exports dist/openapi.json and runs `cg check spec`
pnpm run checks          # runs lint + format + types in sequence
pnpm run ci              # full CI sequence: checks + build + test
```

Autofix equivalents:

```bash
pnpm run lint            # eslint . --fix
pnpm run format          # prettier --write .
```

## Adding a migration

```bash
# Create a new SQL file, numbered sequentially
touch src/storage/sql/migrations/0002_add_some_column.sql

# Apply it to local D1
pnpm run migrate

# Regenerate the schema.ts types from the live schema
pnpm run db:codegen

# Commit BOTH the migration SQL and the regenerated schema.ts
git add src/storage/sql/
```

See [CONTRIBUTING.md](CONTRIBUTING.md#database-migrations-and-kysely-codegen) for why `schema.ts` is auto-generated.

## Running a different deployment tier locally

The default setup uses **Tier 3 (D1/SQL)**. To try **Tier 0 (Proxy)** locally — no DB, no ETL, real-time transforms on every request:

1. Edit `src/cg.config.ts` to construct `new ProxyOppRepo(paClient, paGrantToOpportunity)` instead of the SQL repository.
2. `pnpm run dev` — no migration needed.

See [PORTING.md](PORTING.md) for the full tier matrix and swap recipes.

## Deployment (production)

Deploy happens via GitHub Actions on push to `main`. Manual deploy:

```bash
pnpm run migrate:remote   # apply pending migrations to production D1
pnpm run deploy           # wrangler deploy
```

Required Cloudflare secrets: `CLOUDFLARE_API_TOKEN` (Workers + D1 + R2 edit), `CLOUDFLARE_ACCOUNT_ID`, `SYNC_SECRET`.

First-time CF resource creation:

```bash
wrangler d1 create pa-grants-commongrants
# → copy the database_id into wrangler.jsonc

wrangler r2 bucket create pa-grants-raw-snapshots
```
