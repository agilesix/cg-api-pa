import { v5 as uuidv5 } from 'uuid';
import type { z, ZodIssue } from 'zod';
import type { PaGrant } from './paSource';
import { PaOpportunitySchema } from './plugin';
import type { StoredOpportunity } from '../core';

/**
 * The **input** type of the PA-extended Opportunity schema — i.e. the plain
 * JSON shape before Zod applies its `.transform()` steps.
 *
 * The SDK's `UTCDateTimeSchema` and `ISODateSchema` transform strings into
 * `Date` objects on parse. Our transform functions emit the raw-string shape;
 * callers that want runtime validation + Date objects call
 * `PaOpportunitySchema.parse(input)`.
 */
export type PaOpportunityInput = z.input<typeof PaOpportunitySchema>;

/** Element type of `PaOpportunityInput.keyDates.otherDates`. */
type OtherDateInput = NonNullable<
  NonNullable<PaOpportunityInput['keyDates']>['otherDates']
>[string];

/** Element type of `PaOpportunityInput.customFields`. */
type CustomFieldInput = NonNullable<PaOpportunityInput['customFields']>[string];

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown by `paGrantToOpportunity` when the post-transform object fails
 * `PaOpportunitySchema.safeParse(...)`. Carries the offending Zod issues so
 * callers (the ETL `toStored` wrapper, tests) can log structured details
 * before deciding whether to skip the record or rethrow.
 */
export class TransformValidationError extends Error {
  readonly issues: ZodIssue[];
  readonly sourceId: string;

  constructor(sourceId: string, issues: ZodIssue[]) {
    super(
      `paGrantToOpportunity produced invalid output for "${sourceId}": ${issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'TransformValidationError';
    this.sourceId = sourceId;
    this.issues = issues;
  }
}

// =============================================================================
// UUID v5 namespace
// =============================================================================

/**
 * Deterministic namespace for PA CommonGrants UUIDs. Derived once from the DNS
 * namespace + `"pa.commongrants.api"` so it is stable forever without needing
 * a hardcoded magic UUID literal. The namespace never changes; a given PA
 * `slug` always maps to the same CG id.
 */
const PA_NAMESPACE = uuidv5('pa.commongrants.api', uuidv5.DNS);

/** Map a PA slug to a deterministic CommonGrants UUID. */
export function slugToCgId(slug: string): string {
  return uuidv5(slug, PA_NAMESPACE);
}

// =============================================================================
// Primitive normalization helpers
// =============================================================================

/** Trim + treat `""` as `null`. */
export function nullIfEmpty(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Like `nullIfEmpty`, but additionally returns null when the value isn't a
 * parseable absolute URL. Use for fields that the CommonGrants schema
 * validates with `.url()` (e.g. `Opportunity.source`) so that free-form PA
 * values like `"TBD"` or `"Contact agency"` don't slip through and break
 * downstream Zod parsing.
 */
export function nullIfNotUrl(s: string | null): string | null {
  if (!s) return null;
  try {
    new URL(s);
    return s;
  } catch {
    return null;
  }
}

/**
 * Best-effort strip of HTML tags. PA embeds simple anchor tags in `overview`
 * and `processSteps[].description`; this is enough to produce a clean plain-
 * text `description`. Not a security sanitizer — do not pass untrusted HTML
 * from a different source through this and expect XSS protection.
 */
export function stripHtml(s: string | null): string | null {
  if (!s) return null;
  const plain = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain === '' ? null : plain;
}

// =============================================================================
// Financial parsing
// =============================================================================

/**
 * Parse a PA financial string into a CG `Money`-shaped object.
 *
 * Handles observed formats:
 *   - plain integer: `"1000"`, `"200000"`
 *   - dollar-prefixed integer: `"$500000"`
 *   - "N million": `"$2 million"`, `"$10 million total"`
 *   - "N thousand" / "Nk": `"500k"`
 *
 * Returns `null` when the string is empty, not numeric, or semantically free-
 * form (`"Part of Micro"`). Callers should preserve the raw string in a
 * custom field (`paRawMinAward`, etc.) when this returns null so the source
 * data isn't silently lost.
 */
export function parseFinancial(raw: string | null): { amount: string; currency: 'USD' } | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (cleaned === '') return null;

  // Plain number
  const plainMatch = cleaned.match(/^(\d+(?:\.\d+)?)$/);
  if (plainMatch) {
    const n = Number(plainMatch[1]);
    if (Number.isFinite(n) && n >= 0) return { amount: n.toFixed(2), currency: 'USD' };
  }

  // "N million" / "N mil" / "Nm"
  const millionMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:m|mil|million)\b/);
  if (millionMatch) {
    const n = Number(millionMatch[1]) * 1_000_000;
    if (Number.isFinite(n) && n >= 0) return { amount: n.toFixed(2), currency: 'USD' };
  }

  // "N thousand" / "Nk"
  const thousandMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:k|thousand)\b/);
  if (thousandMatch) {
    const n = Number(thousandMatch[1]) * 1_000;
    if (Number.isFinite(n) && n >= 0) return { amount: n.toFixed(2), currency: 'USD' };
  }

  return null;
}

/** Convert a parsed `Money` to integer cents. Null in, null out. */
export function moneyToCents(money: { amount: string } | null | undefined): number | null {
  if (!money) return null;
  const dollars = Number(money.amount);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

// =============================================================================
// Date / time splitting
// =============================================================================

/**
 * Split a PA ISO 8601 datetime (e.g. `"2024-08-01T12:00:00-00:00"`) into the
 * `{ date, time }` pair the CG `SingleDateEventSchema` expects. Falls back to
 * parsing via `Date` when the regex doesn't match; returns `null` time when
 * the input has only a date.
 */
export function splitIsoDateTime(iso: string | null): { date: string; time: string | null } | null {
  if (!iso) return null;
  const match = iso.match(
    /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:Z|[+-]\d{2}:\d{2})?)?$/,
  );
  if (match) {
    return { date: match[1] as string, time: match[2] ?? null };
  }
  // Fallback: let JS parse it
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const isoStr = d.toISOString();
  return {
    date: isoStr.slice(0, 10),
    time: isoStr.slice(11, 19),
  };
}

// =============================================================================
// Status mapping
// =============================================================================

const STATUS_MAP: Record<string, 'forecasted' | 'open' | 'closed'> = {
  'accepting applications': 'open',
  closed: 'closed',
  forecasted: 'forecasted',
};

/**
 * Map PA's free-form `status` string to the CG `OppStatus` enum. Unknown
 * values fall back to `custom` with the original string in `customValue`
 * (not in `description` — `description` is for human-readable context per
 * the SDK schema).
 */
export function normalizeStatus(raw: string | null): {
  value: 'forecasted' | 'open' | 'closed' | 'custom';
  customValue: string | null;
} {
  const norm = (raw ?? '').trim().toLowerCase();
  const mapped = STATUS_MAP[norm];
  if (mapped) return { value: mapped, customValue: null };
  if (norm === '') return { value: 'custom', customValue: null };
  return { value: 'custom', customValue: raw };
}

// =============================================================================
// Contact parsing
// =============================================================================

/**
 * Parse PA's mashed `pointOfContact.name` field into a structured contact.
 * Examples:
 *   - `"Tracey Barone, tbarone@pa.gov"` → `{ name: "Tracey Barone", email: "tbarone@pa.gov" }`
 *   - `"Jane Doe, 555-123-4567, jdoe@pa.gov"` → name + phone + email
 *   - `"Grants Office"` → just a name
 *
 * Preserves any unparsed trailing parts in `description` so nothing is lost.
 */
export function parseContact(raw: { name?: string | null } | null | undefined): {
  name: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
} | null {
  if (!raw) return null;
  const s = nullIfEmpty(raw.name ?? null);
  if (!s) return null;

  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRe = /^[\d\s\-().+]{7,}$/;

  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  const extra: string[] = [];

  for (const p of parts) {
    if (!email && emailRe.test(p)) {
      email = p;
    } else if (!phone && phoneRe.test(p) && p.replace(/\D/g, '').length >= 7) {
      phone = p;
    } else if (!name) {
      name = p;
    } else {
      extra.push(p);
    }
  }

  return {
    name,
    email,
    phone,
    description: extra.length ? extra.join(', ') : null,
  };
}

// =============================================================================
// Core transform: PaGrant → PaOpportunity
// =============================================================================

/**
 * Convert a raw PA grant record into a CommonGrants `Opportunity` with PA
 * custom fields attached. Pure function — no I/O, no DB, no Workers types.
 *
 * Returns the **input** shape (strings everywhere, no `Date` objects) so
 * callers can serialize directly to JSON. Before returning, the result is
 * validated with `PaOpportunitySchema.safeParse(...)`; on failure a
 * `TransformValidationError` is thrown so the ETL skips the record instead
 * of persisting data that would 502 the consumer at read time.
 *
 * The `syncedAt` argument is the ISO timestamp of the current ETL run; it
 * is stored in the `paLastSyncedAt` custom field and used as the `createdAt`
 * fallback when the source has no creation timestamp.
 */
export function paGrantToOpportunity(pa: PaGrant, syncedAt: string): PaOpportunityInput {
  const status = normalizeStatus(pa.status);

  // Financial parsing: successful → standard funding field; unsuccessful →
  // preserve the raw string in a custom field.
  const minAward = parseFinancial(nullIfEmpty(pa.minimumAward));
  const maxAward = parseFinancial(nullIfEmpty(pa.maximumAward));
  const totalAvailable = parseFinancial(nullIfEmpty(pa.totalFundsToBeAwarded));

  // Dates: PA datetimes split into { date, time } per the CG Event schema.
  const openDateSplit = splitIsoDateTime(nullIfEmpty(pa.openDate));
  const closeDateSplit = splitIsoDateTime(nullIfEmpty(pa.closeDate));
  const decisionDateSplit = splitIsoDateTime(nullIfEmpty(pa.decisionDate));
  const anticipatedFundingDateSplit = splitIsoDateTime(nullIfEmpty(pa.anticipatedFundingDate));
  const anticipatedFunding = nullIfEmpty(pa.anticipatedFunding);

  const otherDates: Record<string, OtherDateInput> = {};
  if (decisionDateSplit) {
    otherDates['decisionDate'] = {
      name: 'Decision Date',
      eventType: 'singleDate',
      date: decisionDateSplit.date,
      time: decisionDateSplit.time,
    };
  }
  if (anticipatedFundingDateSplit) {
    otherDates['anticipatedFundingDate'] = {
      name: 'Anticipated Funding Date',
      eventType: 'singleDate',
      date: anticipatedFundingDateSplit.date,
      time: anticipatedFundingDateSplit.time,
    };
  }
  if (anticipatedFunding) {
    otherDates['anticipatedFunding'] = {
      name: 'Anticipated Funding',
      eventType: 'other',
      details: anticipatedFunding,
    };
  }

  const hasKeyDates =
    openDateSplit !== null || closeDateSplit !== null || Object.keys(otherDates).length > 0;
  const hasFunding = minAward !== null || maxAward !== null || totalAvailable !== null;

  // Matching funds → standard costSharing.isRequired + exact ratio in custom field.
  const matchingRaw = nullIfEmpty(pa.matchingFundsRequirements);
  const matchingRatio = matchingRaw !== null ? Number(matchingRaw) : null;
  const matchingRatioValid =
    matchingRatio !== null && Number.isFinite(matchingRatio) && matchingRatio >= 0;
  const matchingRequired = matchingRatioValid && (matchingRatio as number) > 0;

  // Agency: shared grants.gov schema for code + name.
  const agencyName = nullIfEmpty(pa.issuingAgency);
  const agencyCode = nullIfEmpty(pa.shortIssuingAgency);
  const agencyUrl = nullIfEmpty(pa.issuingAgencyUrl);
  const hasAgency = agencyName !== null || agencyCode !== null;

  // Contact: parse the mashed `pointOfContact.name` field.
  const contact = parseContact(pa.pointOfContact);
  const hasContact =
    contact !== null && (contact.name !== null || contact.email !== null || contact.phone !== null);

  // Description: prefer overview (HTML-stripped), fall back to shortDescription.
  const description =
    stripHtml(nullIfEmpty(pa.overview)) ?? stripHtml(nullIfEmpty(pa.shortDescription)) ?? '';

  // Build customFields — each slot is `{ name, fieldType, value, description? }`.
  // Only populate keys that actually have data so the emitted JSON is clean.
  const customFields: Record<string, CustomFieldInput> = {};

  customFields['paSlug'] = { name: 'paSlug', fieldType: 'string', value: pa.slug };

  if (pa.issuingAgencyGrantNumber !== undefined && pa.issuingAgencyGrantNumber !== null) {
    customFields['legacySerialId'] = {
      name: 'legacySerialId',
      fieldType: 'integer',
      value: pa.issuingAgencyGrantNumber,
    };
  }

  if (hasAgency) {
    customFields['agency'] = {
      name: 'agency',
      fieldType: 'object',
      value: {
        code: agencyCode,
        name: agencyName,
        parentName: null,
        parentCode: null,
      },
    };
  }

  if (hasContact) {
    customFields['contactInfo'] = {
      name: 'contactInfo',
      fieldType: 'object',
      value: contact,
    };
  }

  if (agencyUrl !== null) {
    customFields['additionalInfo'] = {
      name: 'additionalInfo',
      fieldType: 'object',
      value: {
        url: agencyUrl,
        description: 'Issuing agency homepage',
      },
    };
  }

  if (matchingRatioValid) {
    customFields['costSharing'] = {
      name: 'costSharing',
      fieldType: 'object',
      value: { isRequired: matchingRequired },
    };
    customFields['paMatchingFundsRequirement'] = {
      name: 'paMatchingFundsRequirement',
      fieldType: 'number',
      value: matchingRatio,
    };
  }

  const category = nullIfEmpty(pa.category);
  if (category !== null) {
    customFields['paCategory'] = { name: 'paCategory', fieldType: 'string', value: category };
  }
  const grantCycle = nullIfEmpty(pa.grantCycle);
  if (grantCycle !== null) {
    customFields['paGrantCycle'] = {
      name: 'paGrantCycle',
      fieldType: 'string',
      value: grantCycle,
    };
  }
  const fundingType = nullIfEmpty(pa.fundingType);
  if (fundingType !== null) {
    customFields['paFundingType'] = {
      name: 'paFundingType',
      fieldType: 'string',
      value: fundingType,
    };
  }
  const fundingSource = nullIfEmpty(pa.fundingSource);
  if (fundingSource !== null) {
    customFields['paFundingSource'] = {
      name: 'paFundingSource',
      fieldType: 'string',
      value: fundingSource,
    };
  }

  // Raw financial fallbacks: preserve source text when the numeric parse
  // failed but the field was non-empty.
  const rawMin = nullIfEmpty(pa.minimumAward);
  if (rawMin !== null && minAward === null) {
    customFields['paRawMinAward'] = { name: 'paRawMinAward', fieldType: 'string', value: rawMin };
  }
  const rawMax = nullIfEmpty(pa.maximumAward);
  if (rawMax !== null && maxAward === null) {
    customFields['paRawMaxAward'] = { name: 'paRawMaxAward', fieldType: 'string', value: rawMax };
  }
  const rawTotal = nullIfEmpty(pa.totalFundsToBeAwarded);
  if (rawTotal !== null && totalAvailable === null) {
    customFields['paRawTotalFunds'] = {
      name: 'paRawTotalFunds',
      fieldType: 'string',
      value: rawTotal,
    };
  }

  if (pa.processSteps.length > 0) {
    customFields['paProcessSteps'] = {
      name: 'paProcessSteps',
      fieldType: 'array',
      value: pa.processSteps,
    };
  }
  if (pa.additionalResources.length > 0) {
    customFields['paAdditionalResources'] = {
      name: 'paAdditionalResources',
      fieldType: 'array',
      value: pa.additionalResources,
    };
  }
  if (pa.FAQs.length > 0) {
    customFields['paFaqs'] = { name: 'paFaqs', fieldType: 'array', value: pa.FAQs };
  }

  customFields['paLastSyncedAt'] = {
    name: 'paLastSyncedAt',
    fieldType: 'string',
    value: syncedAt,
  };

  // Source URL: PA's `linkToApply` is *usually* an absolute URL, but the
  // feed sometimes carries free-form values like "TBD" or "Contact agency"
  // that fail the SDK's `.url()` validation. Coerce non-URLs to null and
  // stash the raw value in `paRawLinkToApply` so it isn't silently lost
  // (mirrors the `paRawMinAward` / `paRawMaxAward` pattern above).
  const cleanedLink = nullIfEmpty(pa.linkToApply);
  const source = nullIfNotUrl(cleanedLink);
  if (cleanedLink !== null && source === null) {
    customFields['paRawLinkToApply'] = {
      name: 'paRawLinkToApply',
      fieldType: 'string',
      value: cleanedLink,
    };
  }

  // PA's `last_modified` is already ISO 8601 UTC (`"2026-04-07T20:00:21Z"`).
  const lastModifiedAt = pa.last_modified;

  const opp: PaOpportunityInput = {
    id: slugToCgId(pa.slug),
    title: nullIfEmpty(pa.title) ?? '',
    description,
    status: {
      value: status.value,
      customValue: status.customValue,
      description: null,
    },
    source,
    funding: hasFunding
      ? {
          details: null,
          totalAmountAvailable: totalAvailable,
          minAwardAmount: minAward,
          maxAwardAmount: maxAward,
          minAwardCount: null,
          maxAwardCount: null,
          estimatedAwardCount: null,
        }
      : null,
    keyDates: hasKeyDates
      ? {
          postDate: openDateSplit
            ? {
                name: 'Open Date',
                eventType: 'singleDate',
                date: openDateSplit.date,
                time: openDateSplit.time,
              }
            : null,
          closeDate: closeDateSplit
            ? {
                name: 'Close Date',
                eventType: 'singleDate',
                date: closeDateSplit.date,
                time: closeDateSplit.time,
              }
            : null,
          otherDates: Object.keys(otherDates).length > 0 ? otherDates : null,
        }
      : null,
    customFields,
    createdAt: lastModifiedAt,
    lastModifiedAt,
  };

  const parsed = PaOpportunitySchema.safeParse(opp);
  if (!parsed.success) {
    throw new TransformValidationError(pa.slug, parsed.error.issues);
  }
  return opp;
}

// =============================================================================
// Search-text helper — used by SQL tier for FTS indexing
// =============================================================================

/** Concatenate searchable text fields into a single string for FTS indexing. */
export function buildSearchText(pa: PaGrant): string {
  const parts: string[] = [
    pa.title,
    stripHtml(pa.overview) ?? '',
    stripHtml(pa.shortDescription) ?? '',
    pa.issuingAgency,
    pa.category,
    pa.grantCycle,
    pa.fundingType,
    pa.fundingSource,
  ];
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ');
}

// =============================================================================
// Row builder: StoredOpportunity from a PaGrant + its transformed PaOpportunity
// =============================================================================

/**
 * Build the adapter-agnostic `StoredOpportunity` row from a PA grant and its
 * transformed opportunity input. This is what the ETL upserts into the
 * repository; the service layer deserializes `rawJson` back and (optionally)
 * runs it through `PaOpportunitySchema.parse()` for full typed validation.
 */
export function buildStoredOpportunity(
  pa: PaGrant,
  opp: PaOpportunityInput,
  contentHash: string,
): StoredOpportunity {
  return {
    id: opp.id,
    sourceId: pa.slug,
    title: opp.title,
    status: opp.status.value,
    closeDate: nullIfEmpty(pa.closeDate),
    postDate: nullIfEmpty(pa.openDate),
    minAwardAmountCents: moneyToCents(opp.funding?.minAwardAmount),
    maxAwardAmountCents: moneyToCents(opp.funding?.maxAwardAmount),
    totalAmountAvailableCents: moneyToCents(opp.funding?.totalAmountAvailable),
    searchText: buildSearchText(pa),
    contentHash,
    lastModifiedAt: opp.lastModifiedAt,
    rawJson: JSON.stringify(opp),
  };
}
