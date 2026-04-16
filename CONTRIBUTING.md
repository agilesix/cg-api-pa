# Contributing guidelines

This project is a CommonGrants-compliant HTTP API that surfaces Pennsylvania eGrants data. It is also a reference template for building CommonGrants API proxies against any source system.

Before contributing, please read our [LICENSE](LICENSE) and [README](README.md) files. By submitting a contribution, you agree that your code is licensed under the MIT License (the license of this project).

## Table of contents

- [Ways to contribute](#ways-to-contribute)
  - [Report a bug](#report-a-bug)
  - [Request new functionality](#request-new-functionality)
  - [Contribute to the codebase](#contribute-to-the-codebase)
  - [Propose a custom field](#propose-a-custom-field)
  - [Build an adapter for a different source system](#build-an-adapter-for-a-different-source-system)
- [Project conventions](#project-conventions)
  - [Directory layout and import zones](#directory-layout-and-import-zones)
  - [Custom field alignment](#custom-field-alignment)
  - [Database migrations and kysely-codegen](#database-migrations-and-kysely-codegen)
  - [OpenAPI spec compliance](#openapi-spec-compliance)
- [Getting started](#getting-started)
- [Questions?](#questions)

## Ways to contribute

### Report a bug

If you think you have found a bug, please open an issue on GitHub. Include as much context as you can: what you were trying to do, what happened, and what you expected. For CommonGrants-protocol-level issues, file upstream at [HHS/simpler-grants-protocol](https://github.com/HHS/simpler-grants-protocol/issues).

### Request new functionality

Open an issue describing the feature, the problem it solves, and any context about how it would fit into the existing architecture. Not every feature will be accepted — the project maintainers will review each request and either scope it into the roadmap or explain why it will not be implemented.

### Contribute to the codebase

1. Fork the repo.
2. Find or create an issue that describes the change you are making.
3. Create a feature branch (ideally referencing the issue number, e.g. `issue-10-add-memory-tier`).
4. Make changes and add tests. Run `pnpm run ci` locally before pushing.
5. Submit a pull request. Fill out the PR template so maintainers can review efficiently.
6. Address review feedback on the same branch — updates push automatically to the PR.

### Propose a custom field

This API server exposes PA-specific data through CommonGrants custom fields. Before defining a new custom field, **check the [CommonGrants custom fields catalog](https://commongrants.org/custom-fields/)** and the sibling [ts-grants-gov](https://github.com/common-grants/ts-cg-grants-gov) plugin for an existing definition. If a matching field already exists, reuse its exact field key and value schema (see [Custom field alignment](#custom-field-alignment) below) rather than defining a parallel one.

If no suitable field exists, consider proposing it upstream via the CommonGrants custom fields process so other plugins can benefit.

### Build an adapter for a different source system

This repo is structured so that `src/adapter/` (plugin + transform + HTTP client) is extractable to a separate adapter package (future `@common-grants/cg-pa`). To fork this template for another state or funder:

1. Replace the contents of `src/adapter/` with an adapter for your source system.
2. Update `wrangler.jsonc` resource names to match your state/funder prefix (e.g. `ca-grants-commongrants`).
3. Update `src/cg.config.ts` to wire your adapter's `ISourceClient` implementation.
4. See [PORTING.md](PORTING.md) for details on swapping storage tier or hosting target.

## Project conventions

### Directory layout and import zones

The `src/` tree is organized as if each subdirectory will eventually become its own npm package (see the future-package map in [README.md](README.md)). To keep extraction cheap, **do not deep-import across `src/<dir>/` boundaries**. Always import through each directory's `index.ts` public surface.

- `src/core/` may not import from any other `src/**` directory. It is the future `@common-grants/contracts`.
- `src/adapter/`, `src/storage/`, `src/snapshots/`, `src/etl/`, `src/services/`, `src/routes/` all depend on `src/core/` for interfaces and types.
- Only `src/index.ts` and `src/cg.config.ts` may import Cloudflare-specific types or R2 bindings. Every other file is hosting-agnostic.

These rules are enforced by ESLint (`no-restricted-imports` + `import/no-restricted-paths` zones configured in `eslint.config.mjs`). Violations fail CI.

### Custom field alignment

When adding a custom field to the PA plugin:

1. Check <https://commongrants.org/custom-fields/> for an existing registered field.
2. Check `/Users/billy.daly/Code/agile-six/protocol/ts-grants-gov/src/index.ts` (the grants.gov plugin) for an inline shared value schema.
3. **If a matching definition exists, mirror it verbatim** into `src/adapter/fields.ts` with a comment linking the source. Do not invent a parallel field.
4. If no match exists, prefix the new field with `pa` so the namespace is clear.

Cross-plugin alignment is validated by a test in `src/adapter/__tests__/plugin.test.ts` that parses a fixture opportunity through both `PaPlugin.schemas.Opportunity` and the grants.gov plugin's schema.

### Database migrations and kysely-codegen

The `src/storage/sql/schema.ts` file is **auto-generated by `kysely-codegen`** — never hand-edit it.

After writing or modifying a migration in `src/storage/sql/migrations/`:

```bash
pnpm run migrate       # apply the migration to the local D1 database
pnpm run db:codegen    # regenerate src/storage/sql/schema.ts from the live schema
git add src/storage/sql/schema.ts src/storage/sql/migrations/*.sql
git commit -m "migration: <description>"
```

The regenerated `schema.ts` diff is reviewed as part of the PR.

### OpenAPI spec compliance

The OpenAPI spec served at `/openapi.json` is auto-generated from Hono route definitions by `@hono/zod-openapi` — do not hand-author a spec file.

Before opening a PR, run:

```bash
pnpm run check:spec    # emits dist/openapi.json and runs `cg check spec` against it
```

This validates the generated spec against the CommonGrants base protocol via `@common-grants/cli`. A failing `cg check spec` means your route changes have drifted from the protocol and must be reconciled before merging.

## Getting started

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, dev workflow, and running tests.

## Questions?

Open a discussion or issue on this repository. For CommonGrants-protocol questions, post on the upstream [community forum](https://forum.simpler.grants.gov/c/commongrants/8).
