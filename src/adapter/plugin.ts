import { z } from 'zod';
import { definePlugin } from '@common-grants/sdk/extensions';
import {
  AdditionalInfoValueSchema,
  AgencyValueSchema,
  ContactInfoValueSchema,
  CostSharingValueSchema,
  PaAdditionalResourceSchema,
  PaFaqSchema,
  PaProcessStepSchema,
} from './fields';

/**
 * CommonGrants plugin for the Pennsylvania eGrants API.
 *
 * Extends the base CG `Opportunity` schema with:
 *
 *   - Ecosystem-shared fields (`agency`, `contactInfo`, `additionalInfo`,
 *     `costSharing`, `legacySerialId`) whose value schemas are identical to
 *     the grants.gov plugin. This is intentional: values populated under
 *     these keys are interoperable across plugins per
 *     https://commongrants.org/custom-fields/.
 *
 *   - PA-specific fields (`paSlug`, `paCategory`, `paGrantCycle`, `paFaqs`,
 *     etc.) for data that has no ecosystem equivalent. The `pa` prefix
 *     makes the namespace clear. Migrate to a shared field key if/when one
 *     lands upstream.
 */
export const PaPlugin = definePlugin({
  extensions: {
    Opportunity: {
      // --- shared with grants.gov ------------------------------------------
      legacySerialId: {
        fieldType: 'integer',
        description:
          'An integer ID for the opportunity, needed for compatibility with legacy systems',
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
    },
  },
} as const);

/** The CG Opportunity Zod schema extended with PA custom fields. */
export const PaOpportunitySchema = PaPlugin.schemas.Opportunity;

/** Inferred TypeScript type for a PA-flavored Opportunity. */
export type PaOpportunity = z.infer<typeof PaOpportunitySchema>;
