import type { z } from 'zod';
import type { ISourceClient } from './ISourceClient';
import type { StoredOpportunity } from './types';

/**
 * The formal contract for a CommonGrants adapter.
 *
 * An adapter bundles everything needed to transform records from a specific
 * source system (PA eGrants, Grants.gov, a state portal, etc.) into the
 * CommonGrants `Opportunity` shape:
 *
 *   - A **plugin** (SDK extension) that registers custom fields.
 *   - A **source schema** (Zod) that validates raw source records.
 *   - **Transforms** (`toCommonGrants` / `fromCommonGrants`) that map
 *     between source and CG shapes.
 *   - A **source client factory** (`createSourceClient`) that produces
 *     an `ISourceClient` for fetching from the upstream.
 *   - Helpers for building the storage-tier row and extracting the source
 *     identifier.
 *
 * Adapters **contain** plugins — a plugin is a pure schema extension
 * reusable on its own (e.g., client-side parsing), while the adapter adds
 * the operational pieces (client, transforms). See
 * `docs/adr/003-integrations-harness.md` for the design rationale and the
 * path toward an SDK-level `defineAdapter()`.
 *
 * @typeParam TSource - The raw record type from the source system
 *   (e.g., `PaGrant` for Pennsylvania eGrants).
 */
export interface IAdapter<TSource> {
  /**
   * The CommonGrants SDK plugin that registers this adapter's custom fields
   * on the base `Opportunity` schema. The `plugin.schemas.Opportunity` Zod
   * schema is what routes use for OpenAPI generation and serialization.
   */
  plugin: {
    schemas: { Opportunity: z.ZodTypeAny };
    extensions: Record<string, unknown>;
  };

  /** Zod schema that validates raw source records. */
  sourceSchema: z.ZodType<TSource>;

  /** Transform a source record → CommonGrants Opportunity (input shape). */
  toCommonGrants(source: TSource, syncedAt: string): unknown;

  /** Optional reverse: CG Opportunity → source format (for write-back). */
  fromCommonGrants?(opportunity: unknown): TSource;

  /** Factory for the source-system client. */
  createSourceClient(config: Record<string, unknown>): ISourceClient<TSource>;

  /** Build the `StoredOpportunity` row from a source record + transformed opportunity + content hash. */
  buildStoredOpportunity(
    source: TSource,
    opportunity: unknown,
    contentHash: string,
  ): StoredOpportunity;

  /** Concatenate searchable text for FTS indexing. */
  buildSearchText(source: TSource): string;

  /** Extract the source-system identifier from a raw record (e.g., PA slug). */
  getSourceId(source: TSource): string;

  // -------------------------------------------------------------------------
  // Future additions (documented, not yet implemented)
  // -------------------------------------------------------------------------

  /**
   * Custom filter definitions (analogous to custom fields). A future version
   * will let adapters declare source-specific filters that extend the base
   * `OppFilters` via the `customFilters` record. For now, custom filters
   * pass through as untyped `Record<string, DefaultFilter>`.
   *
   * See `docs/adr/003-integrations-harness.md` for the design direction.
   */
  // customFilters?: CustomFilterDefinitions;

  /**
   * Factory for an extended CommonGrants SDK API client that includes the
   * adapter's custom fields + custom filters in its type signature. This
   * lets CONSUMERS of this CG-compliant API get a typed client for free:
   *
   * ```ts
   * const client = PaAdapter.createApiClient({ baseUrl: 'https://deployed.api' });
   * const opp = await client.opportunities.get(id);
   * opp.customFields?.paSlug?.value; // typed!
   * ```
   *
   * Not implemented yet — requires the SDK's `Client` class to accept plugin
   * schemas as a generic parameter.
   */
  // createApiClient?(config: { baseUrl: string }): unknown;
}
