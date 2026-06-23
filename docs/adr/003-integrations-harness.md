# ADR 003: Adapter-vs-plugin semantics and the integrations harness vision

**Status:** Superseded by [ADR 005](005-sdk-0.5.0-plugin-transforms.md) (2026-06-22)

> **Superseded.** This ADR decided that adapters _contain_ plugins, keeping
> transforms and the source client out of the SDK plugin. SDK v0.5.0 moved the
> source schema and bidirectional transforms _into_ `definePlugin()`, so the
> bespoke `IAdapter` seam was retired. The dependency objection raised below is
> addressed by v0.5.0 keeping the HTTP client and storage helpers external to
> the plugin. See ADR 005 for the current model.

## Context

The CommonGrants SDK provides a **plugin** system (`definePlugin()`) for extending the `Opportunity` schema with custom fields. This project adds an **adapter** concept — a higher-level abstraction that bundles a plugin with a source client, transforms, and storage helpers. The question is: should plugins _become_ adapters, or should adapters _contain_ plugins?

Separately, as the ecosystem matures, we want a configuration model where swapping source systems, storage tiers, and deployment targets is as easy as changing imports in a single config file — similar to how Astro's integration system works.

## Decision

### Adapters contain plugins

An adapter (`IAdapter<TSource>`) bundles:

- A **plugin** (`plugin.schemas.Opportunity`) — the pure schema extension.
- A **source schema** (`sourceSchema`) — Zod schema for the upstream's raw records.
- **Transforms** (`toCommonGrants`, `fromCommonGrants`) — map between source and CG shapes.
- A **source client factory** (`createSourceClient`) — produces an `ISourceClient` for the upstream.
- **Storage helpers** (`buildStoredOpportunity`, `buildSearchText`, `getSourceId`).

Plugins remain reusable on their own — e.g., a browser-side consumer can use `PaPlugin.schemas.Opportunity` to parse CG opportunity JSON without importing the full adapter. The adapter adds the operational behavior.

### Why not "plugins become adapters"?

Merging the two concepts (e.g., adding `toCommonGrants()` to the plugin) conflates schema extension (read-only, side-effect-free) with operational behavior (HTTP clients, transforms). This would:

- Break the plugin's use as a pure client-side schema.
- Force every plugin consumer to install the adapter's dependencies (HTTP client, etc.).
- Make `definePlugin()` in the SDK responsible for factory methods that it shouldn't own.

### The concern: two concepts

Having both "plugin" and "adapter" creates a learning-curve overhead. A contributor must understand that:

- A **plugin** is a schema extension (lightweight, portable, reusable).
- An **adapter** is a deployment integration (bundles a plugin + transforms + client).

If the ecosystem converges on adapters being the primary deliverable (and standalone plugin usage is rare), a future SDK release could unify them via `defineAdapter()` that produces an object satisfying `IAdapter` and exposes `plugin` as a sub-property. This ADR should inform that decision.

### Future: custom filters

Adapters will declare **custom filter definitions** (analogous to custom fields) that extend the base `OppFilters`. For example, a PA adapter might declare a `paFundingSource` filter that maps to a SQL `WHERE` on a custom field. The route layer would accept these in the `customFilters` record of `OppSearchRequest`, and the Hono OpenAPI schema would reflect them automatically.

### Future: extended API client

An adapter will also export a factory for an extended CommonGrants SDK `Client` that includes the adapter's custom fields + custom filters in its type signature. Consumers of a deployed CG-compliant API get a typed client for free:

```ts
const client = PaAdapter.createApiClient({ baseUrl: 'https://deployed.api' });
const opp = await client.opportunities.get(id);
opp.customFields?.paSlug?.value; // typed!
```

This requires the SDK's `Client` class to accept plugin schemas as a generic parameter — a change to propose upstream.

### Future: Astro-style integrations harness

The current `cg.config.ts` is manual wiring. The long-term vision is:

```ts
// cg.config.ts — future
import { defineConfig } from '@common-grants/server';
import { paAdapter } from '@common-grants/cg-pa';
import { d1Storage } from '@common-grants/storage-d1';
import { r2Snapshots } from '@common-grants/snapshots-r2';

export default defineConfig({
  adapter: paAdapter({ baseUrl: '...' }),
  storage: d1Storage({ binding: 'DB' }),
  snapshots: r2Snapshots({ binding: 'SNAPSHOTS' }),
});
```

Each "integration" (`paAdapter`, `d1Storage`, `r2Snapshots`) is a separately installable package. The `defineConfig()` helper validates composition and produces the wired `AppConfig`. Routes are fully generic — they receive the adapter's schema at config time and auto-reflect custom fields in the OpenAPI spec.

What the SDK would need to provide:

- `@common-grants/server` — the `defineConfig()` entry point + generic Hono routes.
- `IAdapter`, `IOppRepo`, `ISnapshotStore` — the interfaces (currently in `src/core/`).
- A convention for how integrations declare their `peerDependencies`.

## Consequences

- Contributors need to learn two concepts (plugin + adapter) instead of one.
- Plugins remain lightweight and portable — a win for client-side usage.
- The adapter interface (`IAdapter<TSource>`) gives adopters a single object to swap when forking.
- Routes become generic (adapter-driven schemas) instead of hardcoded to PA.
- The path to `defineAdapter()` in the SDK is documented, not ad-hoc.
