/**
 * Public surface of the PA adapter (future `@common-grants/cg-pa`).
 *
 * This is the only module that routes, services, ETL, and `src/cg.config.ts`
 * should import from. Deep imports into `./plugin`, `./fields`, etc. are
 * forbidden by lint zones to keep the future package extraction cheap.
 *
 * As of the SDK v0.5.0 migration there is no bespoke `IAdapter` seam: the
 * `PaPlugin` (`@common-grants/sdk` `definePlugin()`) owns the schema,
 * `sourceSchema`, and the bidirectional `toCommon` / `fromCommon` transforms.
 * The only pieces that live outside the plugin are the operational hooks the
 * SQL tier needs — `getSourceId` and `buildSearchText` — plus the HTTP client.
 * See ADR 003 / 005 for the rationale.
 */

import type { PaGrant } from './paSource';

/** Source-system identifier extractor — the per-source key used for upsert/snapshot keying. */
export const getSourceId = (grant: PaGrant): string => grant.slug;

// Plugin + schema + types
export {
  PaPlugin,
  PaOpportunitySchema,
  type PaOpportunity,
  type PaOpportunityInput,
} from './plugin';

// HTTP client
export { PaSourceClient, PaApiError } from './PaSourceClient';

// Raw source schema + type (useful for fixtures / tests downstream)
export { PaGrantSchema, PaGrantsListResponseSchema, type PaGrant } from './paSource';

// Pure transform functions (exported so the ETL/tests can use them directly)
export {
  paGrantToOpportunity,
  paOpportunityToGrant,
  buildSearchText,
  slugToCgId,
  // Lower-level helpers are exported for testability / advanced use.
  normalizeStatus,
  statusToPaString,
  parseContact,
  parseFinancial,
  moneyToCents,
  stripHtml,
  nullIfEmpty,
  nullIfNotUrl,
  splitIsoDateTime,
  eventToIso,
} from './transform';

// Value schemas for custom-field values
export {
  AgencyValueSchema,
  ContactInfoValueSchema,
  AdditionalInfoValueSchema,
  CostSharingValueSchema,
  PaProcessStepSchema,
  PaAdditionalResourceSchema,
  PaFaqSchema,
} from './fields';
