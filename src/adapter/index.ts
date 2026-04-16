/**
 * Public surface of the PA adapter (future `@common-grants/cg-pa`).
 *
 * This is the only module that routes, services, ETL, and `src/cg.config.ts`
 * should import from. Deep imports into `./plugin`, `./fields`, etc. are
 * forbidden by lint zones to keep the future package extraction cheap.
 *
 * The adapter bundles:
 *   - `PaAdapter`: the composed `IAdapter<PaGrant>` object
 *   - the CommonGrants Zod plugin (`PaPlugin`)
 *   - the HTTP client for the PA eGrants Beta API (`PaSourceClient`)
 *   - pure transforms that map raw PA records into CG opportunities
 *   - value schemas for custom-field values
 */

import type { z } from 'zod';
import type { IAdapter } from '../core';
import { PaPlugin } from './plugin';
import { PaGrantSchema, type PaGrant } from './paSource';
import { PaSourceClient } from './PaSourceClient';
import { paGrantToOpportunity, buildStoredOpportunity, buildSearchText } from './transform';

/**
 * The PA adapter — satisfies `IAdapter<PaGrant>`. This is the single
 * integration point that `cg.config.ts` wires into the server. Swapping
 * to a different source system means swapping this object.
 */
export const PaAdapter: IAdapter<PaGrant> = {
  plugin: PaPlugin,
  // PaGrantSchema has .nullable().transform() chains that make the input/output
  // types differ; the cast bridges the Zod inference gap.
  sourceSchema: PaGrantSchema as unknown as z.ZodType<PaGrant>,
  toCommonGrants: paGrantToOpportunity,
  createSourceClient: (config) => new PaSourceClient(config['baseUrl'] as string),
  buildStoredOpportunity,
  buildSearchText,
  getSourceId: (g) => g.slug,
};

// Plugin + schema
export { PaPlugin, PaOpportunitySchema, type PaOpportunity } from './plugin';

// HTTP client
export { PaSourceClient, PaApiError } from './PaSourceClient';

// Raw source schema + type (useful for fixtures / tests downstream)
export { PaGrantSchema, PaGrantsListResponseSchema, type PaGrant } from './paSource';

// Pure transform functions (exported so the ETL can use them directly)
export {
  paGrantToOpportunity,
  buildStoredOpportunity,
  buildSearchText,
  slugToCgId,
  // Lower-level helpers are exported for testability / advanced use.
  normalizeStatus,
  parseContact,
  parseFinancial,
  moneyToCents,
  stripHtml,
  nullIfEmpty,
  splitIsoDateTime,
  type PaOpportunityInput,
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
