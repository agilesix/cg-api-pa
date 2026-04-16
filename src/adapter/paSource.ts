import { z } from 'zod';

/**
 * Coerce `null` → `""` for PA string fields. The API probe (April 2026)
 * showed all string fields as present-but-empty-string, but live data
 * includes `null` for a handful of records (e.g. `category`). The
 * transform layer already treats `""` as absent via `nullIfEmpty()`, so
 * coercing here keeps the pipeline uniform.
 */
const paStr = z
  .string()
  .nullable()
  .transform((v) => v ?? '');

/**
 * Zod schema + TypeScript type for a raw Pennsylvania eGrants record.
 *
 * Observed shape from `GET https://egrants-apibeta.azurewebsites.net/api/grants/`:
 *
 *   - Every record has all 34 top-level fields present; missing values are
 *     empty strings OR null (varies by field and record).
 *   - Financial fields are free-form strings (`"1000"`, `"$2 million"`,
 *     `"Part of Micro"`) — parsed best-effort in the transform layer.
 *   - Dates are ISO 8601 with offset (`"2024-08-01T12:00:00-00:00"`).
 *   - `last_modified` is the only underscore-cased key.
 *   - Some string fields carry trailing whitespace ("Annual ", "Grant ").
 *   - `overview` and `processSteps[].description` may contain HTML.
 *   - `linkToApply` is a constant central-portal URL across all records.
 *
 * `.passthrough()` lets unknown fields through — the PA API may add new
 * fields and we shouldn't fail validation on forward-compatible additions.
 */
export const PaGrantSchema = z
  .object({
    slug: z.string(),
    title: paStr,
    status: paStr,
    category: paStr,
    issuingAgency: paStr,
    shortIssuingAgency: paStr,
    last_modified: z.string(),
    overview: paStr,
    shortDescription: paStr,
    openDate: paStr,
    closeDate: paStr,
    decisionDate: paStr,
    anticipatedFundingDate: paStr,
    grantCycle: paStr,
    fundingType: paStr,
    fundingSource: paStr,
    minimumAward: paStr,
    maximumAward: paStr,
    totalFundsToBeAwarded: paStr,
    anticipatedFunding: paStr,
    matchingFundsRequirements: paStr,
    applicantType: paStr,
    applicantCategory: paStr,
    eligibility: paStr,
    reportingMonitoring: paStr,
    populationServedType: paStr,
    populationServedGeography: paStr,
    issuingAgencyGrantNumber: z.number().int().nullable(),
    issuingAgencyUrl: paStr,
    linkToApply: paStr,
    pointOfContact: z
      .object({
        name: z
          .string()
          .nullable()
          .transform((v) => v ?? ''),
      })
      .nullable(),
    processSteps: z
      .array(z.object({ stepNumber: z.number().int(), description: z.string() }))
      .nullable()
      .transform((v) => v ?? []),
    additionalResources: z
      .array(z.object({ title: z.string(), url: z.string() }))
      .nullable()
      .transform((v) => v ?? []),
    FAQs: z
      .array(z.object({ question: z.string(), answer: z.string() }))
      .nullable()
      .transform((v) => v ?? []),
  })
  .passthrough();

export type PaGrant = z.infer<typeof PaGrantSchema>;

/** List endpoint response envelope: `{ "grants": [...] }`. */
export const PaGrantsListResponseSchema = z.object({
  grants: z.array(PaGrantSchema),
});

export type PaGrantsListResponse = z.infer<typeof PaGrantsListResponseSchema>;
