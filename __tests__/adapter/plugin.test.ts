import { describe, it, expect } from 'vitest';
import {
  AdditionalInfoValueSchema,
  AgencyValueSchema,
  ContactInfoValueSchema,
  CostSharingValueSchema,
  PaOpportunitySchema,
  PaPlugin,
  paGrantToOpportunity,
} from '../../src/adapter';
import { pdA1Fixture } from './fixtures';

/**
 * The shared custom-field value schemas in `src/adapter/fields.ts` are
 * mirrored verbatim from the grants.gov plugin. This file guards against drift:
 * an opportunity populated with the shared fields (`agency`, `contactInfo`,
 * `additionalInfo`, `costSharing`, `legacySerialId`) must validate under
 * `PaOpportunitySchema`, and each shared value must validate under its mirrored
 * value schema.
 *
 * NOTE: The cross-plugin parse against the live `@common-grants/cg-grants-gov`
 * package is temporarily removed. That package (0.1.0) targets SDK 0.4.0's
 * `definePlugin({ extensions })` API and exposes `.schemas.Opportunity` as a
 * Zod schema; under SDK 0.5.0 it neither matches the new
 * `.schemas.Opportunity.commonSchema` shape nor registers its custom fields.
 * Restore the live cross-plugin assertions once a 0.5.0-compatible release
 * ships (common-grants/ts-cg-grants-gov PR #11): re-add the dev dependency and
 * compare against `grantsGovPlugin.schemas.Opportunity.commonSchema`.
 */
describe('shared-field alignment (mirrored from grants.gov)', () => {
  const opp = paGrantToOpportunity(pdA1Fixture, '2026-04-15T00:00:00Z');

  // A minimal opportunity whose customFields only use the shared keys.
  const sharedOnly = {
    id: opp.id,
    title: opp.title,
    description: opp.description,
    status: opp.status,
    source: opp.source,
    createdAt: opp.createdAt,
    lastModifiedAt: opp.lastModifiedAt,
    customFields: {
      legacySerialId: opp.customFields?.['legacySerialId'],
      agency: opp.customFields?.['agency'],
      contactInfo: opp.customFields?.['contactInfo'],
      additionalInfo: opp.customFields?.['additionalInfo'],
      costSharing: opp.customFields?.['costSharing'],
    },
  };

  it('a shared-only opportunity validates under PaOpportunitySchema', () => {
    expect(() => PaOpportunitySchema.parse(sharedOnly)).not.toThrow();
  });

  it('each shared custom-field value validates under its mirrored value schema', () => {
    expect(() => AgencyValueSchema.parse(opp.customFields?.['agency']?.value)).not.toThrow();
    expect(() =>
      ContactInfoValueSchema.parse(opp.customFields?.['contactInfo']?.value),
    ).not.toThrow();
    expect(() =>
      AdditionalInfoValueSchema.parse(opp.customFields?.['additionalInfo']?.value),
    ).not.toThrow();
    expect(() =>
      CostSharingValueSchema.parse(opp.customFields?.['costSharing']?.value),
    ).not.toThrow();
  });

  it('parsing preserves the shared custom-field values unchanged', () => {
    const parsed = PaOpportunitySchema.parse(sharedOnly);
    expect(parsed.customFields?.['agency']?.value).toEqual({
      code: 'pda',
      name: 'Agriculture',
      parentName: null,
      parentCode: null,
    });
    expect(parsed.customFields?.['contactInfo']?.value).toMatchObject({
      name: 'Tracey Barone',
      email: 'tbarone@pa.gov',
    });
    expect(parsed.customFields?.['costSharing']?.value).toEqual({ isRequired: true });
    expect(parsed.customFields?.['legacySerialId']?.value).toBe(1);
  });
});

/**
 * The plugin registers bidirectional transforms via `definePlugin()`. The SDK
 * wraps these callables with schema validation, so `toCommon` surfaces invalid
 * output through `TransformResult.errors` rather than throwing.
 */
describe('PaPlugin.toCommon', () => {
  it('returns the transformed opportunity with no errors for a valid record', () => {
    const { result, errors } = PaPlugin.schemas.Opportunity.toCommon(pdA1Fixture);
    expect(errors).toEqual([]);
    expect(result.id).toBe(paGrantToOpportunity(pdA1Fixture, '2026-04-15T00:00:00Z').id);
    expect(result.customFields?.['paSlug']?.value).toBe('pda1');
  });

  it('reports validation errors (does not throw) when the output is invalid', () => {
    // `last_modified` passes straight through to `lastModifiedAt`, which the SDK
    // validates as a UTC datetime — a garbage value reliably trips validation.
    const bad: typeof pdA1Fixture = {
      ...pdA1Fixture,
      slug: 'pda-bad-modified',
      last_modified: 'not-a-datetime',
    };
    const { errors } = PaPlugin.schemas.Opportunity.toCommon(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => (e.path ?? '').includes('lastModifiedAt'))).toBe(true);
  });
});
