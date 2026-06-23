import { z } from 'zod';
import {
  definePlugin,
  type ToCommon,
  type FromCommon,
  type TransformResult,
} from '@common-grants/sdk/extensions';
import {
  AdditionalInfoValueSchema,
  AgencyValueSchema,
  ContactInfoValueSchema,
  CostSharingValueSchema,
  PaAdditionalResourceSchema,
  PaFaqSchema,
  PaProcessStepSchema,
} from './fields';
import { PaGrantSchema, type PaGrant } from './paSource';
import { paGrantToOpportunity, paOpportunityToGrant } from './transform';

/**
 * PA custom-field specifications, hoisted to a `const` so the same object can
 * be passed to `definePlugin()` **and** referenced by the `ToCommon` /
 * `FromCommon` helper types below. `as const` keeps the `fieldType` literals
 * narrow (per the SDK extensions guide).
 *
 * Extends the base CG `Opportunity` schema with:
 *
 *   - Ecosystem-shared fields (`agency`, `contactInfo`, `additionalInfo`,
 *     `costSharing`, `legacySerialId`) whose value schemas are identical to
 *     the grants.gov plugin — values under these keys are interoperable across
 *     plugins per https://commongrants.org/custom-fields/.
 *   - PA-specific fields (`paSlug`, `paCategory`, `paGrantCycle`, `paFaqs`,
 *     etc.) for data that has no ecosystem equivalent. The `pa` prefix marks
 *     the namespace; migrate to a shared key if/when one lands upstream.
 */
const paCustomFields = {
  // --- shared with grants.gov ------------------------------------------
  legacySerialId: {
    fieldType: 'integer',
    description: 'An integer ID for the opportunity, needed for compatibility with legacy systems',
  },
  agency: {
    fieldType: 'object',
    value: AgencyValueSchema,
    description: 'Information about the agency offering this opportunity',
  },
  contactInfo: {
    fieldType: 'object',
    value: ContactInfoValueSchema,
    description: 'Contact information (name, email, phone, description) for this resource',
  },
  additionalInfo: {
    fieldType: 'object',
    value: AdditionalInfoValueSchema,
    description: 'URL and description for additional information about the opportunity',
  },
  costSharing: {
    fieldType: 'object',
    value: CostSharingValueSchema,
    description: 'Whether cost sharing or matching funds are required for this opportunity',
  },

  // --- PA-specific -----------------------------------------------------
  paSlug: {
    fieldType: 'string',
    description: "Pennsylvania's URL-friendly opportunity identifier",
  },
  paCategory: {
    fieldType: 'string',
    description: "Pennsylvania's category taxonomy (often mirrors the issuing agency)",
  },
  paGrantCycle: {
    fieldType: 'string',
    description: 'PA grant cycle label (e.g. "Annual")',
  },
  paFundingType: {
    fieldType: 'string',
    description: 'PA funding type label (e.g. "Grant", "Loan")',
  },
  paFundingSource: {
    fieldType: 'string',
    description: 'PA funding source label (e.g. "State", "Federal")',
  },
  paMatchingFundsRequirement: {
    fieldType: 'number',
    value: z.number().min(0).max(1),
    description:
      'Exact matching-funds ratio (0–1) reported by PA. Complements the standard `costSharing.isRequired` with the numeric value.',
  },
  paRawMinAward: {
    fieldType: 'string',
    description:
      'Original `minimumAward` string preserved when the value could not be parsed into a numeric amount',
  },
  paRawMaxAward: {
    fieldType: 'string',
    description:
      'Original `maximumAward` string preserved when the value could not be parsed into a numeric amount',
  },
  paRawTotalFunds: {
    fieldType: 'string',
    description:
      'Original `totalFundsToBeAwarded` string preserved when the value could not be parsed into a numeric amount',
  },
  paRawLinkToApply: {
    fieldType: 'string',
    description:
      'Original `linkToApply` string preserved when the value was not a valid absolute URL',
  },
  paProcessSteps: {
    fieldType: 'array',
    value: z.array(PaProcessStepSchema),
    description: 'PA application process steps (HTML descriptions preserved as-is)',
  },
  paAdditionalResources: {
    fieldType: 'array',
    value: z.array(PaAdditionalResourceSchema),
    description: 'Links to supporting documents and pages for the opportunity',
  },
  paFaqs: {
    fieldType: 'array',
    value: z.array(PaFaqSchema),
    description: 'Frequently asked questions for the opportunity',
  },
  paLastSyncedAt: {
    fieldType: 'string',
    value: z.string().datetime(),
    description: 'ISO 8601 datetime when this record was last ingested from PA',
  },
} as const;

/**
 * Type parameters shared by the `toCommon` / `fromCommon` helper annotations:
 * the model selects the base schema, `sourceSchema` types the source side, and
 * `customFields` resolves the extended common type — exactly the inputs
 * `definePlugin()` uses internally. These are *type-level* inputs only; no
 * runtime schema is referenced here, which is what keeps this module free of a
 * `plugin ⇄ transform` import cycle.
 */
type PaTransform = {
  model: 'Opportunity';
  sourceSchema: typeof PaGrantSchema;
  customFields: typeof paCustomFields;
};

/**
 * Source → CommonGrants. A thin wrapper over the pure `paGrantToOpportunity`
 * mapper. **No validation here on purpose:** `definePlugin()` wraps this
 * callable with `commonSchema` validation (see the SDK's
 * `wrapWithSchemaValidation`), folding any Zod issues into
 * `TransformResult.errors`. We return the string-shaped draft (the date
 * schemas accept string input; the consumer-facing type claims `Date`, hence
 * the bridging cast).
 */
const toCommon: ToCommon<PaTransform> = (source) =>
  ({
    result: paGrantToOpportunity(source, new Date().toISOString()) as unknown as PaOpportunity,
    errors: [],
  }) satisfies TransformResult<PaOpportunity>;

/**
 * CommonGrants → source (best-effort, lossy — see `paOpportunityToGrant`).
 * As with `toCommon`, `definePlugin()` wraps this with `sourceSchema`
 * validation, so no explicit parse is needed here.
 */
const fromCommon: FromCommon<PaTransform> = (common) =>
  ({
    result: paOpportunityToGrant(common as unknown as PaOpportunityInput),
    errors: [],
  }) satisfies TransformResult<PaGrant>;

/**
 * The PA CommonGrants plugin. v0.5.0 `definePlugin()` owns the schema
 * extension **and** the bidirectional transforms + source schema — replacing
 * the project's former `IAdapter` seam (see ADR 003 / 005).
 */
export const PaPlugin = definePlugin({
  meta: {
    name: 'pa-egrants',
    version: '0.1.0',
    sourceSystem: 'pa-egrants',
    capabilities: ['customFields', 'transforms'],
  },
  schemas: {
    Opportunity: {
      customFields: paCustomFields,
      sourceSchema: PaGrantSchema,
      toCommon,
      fromCommon,
    },
  },
} as const);

/** The CG Opportunity Zod schema extended with PA custom fields. */
export const PaOpportunitySchema = PaPlugin.schemas.Opportunity.commonSchema;

/** Inferred TypeScript type for a PA-flavored Opportunity (output shape — dates as `Date`). */
export type PaOpportunity = z.infer<typeof PaOpportunitySchema>;

/**
 * The **input** type of the PA-extended Opportunity schema — the plain JSON
 * shape before Zod applies its `.transform()` steps (dates as strings). The
 * pure mappers in `./transform` produce and consume this shape.
 */
export type PaOpportunityInput = z.input<typeof PaOpportunitySchema>;
