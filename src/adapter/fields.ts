import { z } from 'zod';

/**
 * PA custom-field value schemas.
 *
 * This file holds two groups of schemas:
 *
 *   1. **Shared schemas mirrored from the grants.gov plugin.** Copied verbatim
 *      so PA custom-field values are interoperable with grants.gov and any
 *      other CommonGrants plugin that registers these fields. When a shared
 *      `@common-grants/shared-fields` (or similar) package ships in the
 *      ecosystem, these definitions should migrate there. Until then, the
 *      copy-forward keeps downstream consumers from depending on another
 *      state's plugin package (which would be a state-on-state coupling).
 *
 *      Source of truth: `ts-grants-gov/src/index.ts`.
 *      Catalog: https://commongrants.org/custom-fields/
 *
 *   2. **PA-specific value schemas.** Structures we observed in the PA eGrants
 *      data that don't (yet) have an ecosystem equivalent.
 *
 * Keep the shared schemas **byte-identical** to the grants.gov plugin. The
 * alignment test in `__tests__/adapter/plugin.test.ts` parses a fixture through both
 * plugin schemas to catch drift.
 */

// =============================================================================
// Shared value schemas (mirrored from @common-grants/cg-grants-gov)
// =============================================================================

export const AgencyValueSchema = z.object({
  code: z.string().nullish(),
  name: z.string().nullish(),
  parentName: z.string().nullish(),
  parentCode: z.string().nullish(),
});

export const ContactInfoValueSchema = z.object({
  name: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  description: z.string().nullish(),
});

export const AdditionalInfoValueSchema = z.object({
  url: z.string().nullish(),
  description: z.string().nullish(),
});

/**
 * Cost sharing / matching requirement — mirrored verbatim from the grants.gov
 * `CustomCostSharing` value (commongrants.org catalog). The matching-funds
 * requirement lives here rather than in a separate custom field:
 *   - `isRequired` — whether cost sharing / matching funds are required
 *   - `percentage` — required match as a percentage, 0–100 (e.g. `25.0`)
 *   - `details`    — free-text description (type, waiver info, notes)
 * Kept byte-identical between the PA and CA plugins so cross-source consumers
 * see one shape.
 */
export const CostSharingValueSchema = z.object({
  isRequired: z.boolean().nullish(),
  percentage: z.number().nullish(),
  details: z.string().nullish(),
});

// =============================================================================
// PA-specific value schemas
// =============================================================================

export const PaProcessStepSchema = z.object({
  stepNumber: z.number().int(),
  description: z.string(),
});

export const PaAdditionalResourceSchema = z.object({
  title: z.string(),
  url: z.string(),
});

export const PaFaqSchema = z.object({
  question: z.string(),
  answer: z.string(),
});
