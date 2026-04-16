import { describe, it, expect } from 'vitest';
import grantsGovPlugin from '@common-grants/cg-grants-gov';
import { PaOpportunitySchema, paGrantToOpportunity } from '../../src/adapter';
import { pdA1Fixture } from './fixtures';

/**
 * The shared custom-field value schemas in `src/adapter/fields.ts` are
 * mirrored verbatim from the grants.gov plugin. This file is the regression
 * guard: an opportunity populated with the shared fields (`agency`,
 * `contactInfo`, `additionalInfo`, `costSharing`, `legacySerialId`) must
 * validate under BOTH plugins' schemas. If a drift is introduced on either
 * side, one of these assertions fails.
 *
 * When it fails, the fix is to re-align `src/adapter/fields.ts` with
 * `ts-grants-gov/src/index.ts` (the source of truth).
 */
describe('cross-plugin alignment (shared fields)', () => {
  const grantsGovSchema = grantsGovPlugin.schemas.Opportunity;

  // Build a minimal opportunity whose customFields only use the shared keys.
  const opp = paGrantToOpportunity(pdA1Fixture, '2026-04-15T00:00:00Z');
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

  it('the SAME shared-only opportunity also validates under the grants.gov schema', () => {
    expect(() => grantsGovSchema.parse(sharedOnly)).not.toThrow();
  });

  it('parses identically under both schemas for the shared custom fields', () => {
    const paParsed = PaOpportunitySchema.parse(sharedOnly);
    const ggParsed = grantsGovSchema.parse(sharedOnly);
    expect(paParsed.customFields?.agency?.value).toEqual(ggParsed.customFields?.agency?.value);
    expect(paParsed.customFields?.contactInfo?.value).toEqual(
      ggParsed.customFields?.contactInfo?.value,
    );
    expect(paParsed.customFields?.additionalInfo?.value).toEqual(
      ggParsed.customFields?.additionalInfo?.value,
    );
    expect(paParsed.customFields?.costSharing?.value).toEqual(
      ggParsed.customFields?.costSharing?.value,
    );
    expect(paParsed.customFields?.legacySerialId?.value).toEqual(
      ggParsed.customFields?.legacySerialId?.value,
    );
  });
});
