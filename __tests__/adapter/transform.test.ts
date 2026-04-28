import { describe, it, expect } from 'vitest';
import {
  buildSearchText,
  buildStoredOpportunity,
  moneyToCents,
  normalizeStatus,
  nullIfEmpty,
  nullIfNotUrl,
  PaOpportunitySchema,
  paGrantToOpportunity,
  parseContact,
  parseFinancial,
  slugToCgId,
  splitIsoDateTime,
  stripHtml,
  TransformValidationError,
} from '../../src/adapter';
import { pdA1Fixture, pdA2FixtureEdgeCases } from './fixtures';

describe('nullIfEmpty', () => {
  it('returns null for empty, whitespace-only, null, or undefined', () => {
    expect(nullIfEmpty('')).toBeNull();
    expect(nullIfEmpty('   ')).toBeNull();
    expect(nullIfEmpty(null)).toBeNull();
    expect(nullIfEmpty(undefined)).toBeNull();
  });

  it('trims surrounding whitespace on real values', () => {
    expect(nullIfEmpty('  hello  ')).toBe('hello');
    expect(nullIfEmpty('Annual ')).toBe('Annual');
  });
});

describe('nullIfNotUrl', () => {
  it('returns null for null, empty, or non-URL strings', () => {
    expect(nullIfNotUrl(null)).toBeNull();
    expect(nullIfNotUrl('')).toBeNull();
    expect(nullIfNotUrl('TBD')).toBeNull();
    expect(nullIfNotUrl('Contact agency')).toBeNull();
    expect(nullIfNotUrl('/relative/path')).toBeNull();
  });

  it('returns the string unchanged for parseable absolute URLs', () => {
    expect(nullIfNotUrl('https://example.gov/x')).toBe('https://example.gov/x');
    expect(nullIfNotUrl('http://pa.gov')).toBe('http://pa.gov');
  });
});

describe('stripHtml', () => {
  it('strips simple anchor tags and collapses whitespace', () => {
    expect(stripHtml('Hello <a href="x">world</a>!')).toBe('Hello world!');
  });

  it('decodes common HTML entities', () => {
    expect(stripHtml('Jack &amp; Jill &lt;3')).toBe('Jack & Jill <3');
  });

  it('translates <br> and </p> into line breaks', () => {
    expect(stripHtml('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
  });

  it('returns null for empty or null input', () => {
    expect(stripHtml(null)).toBeNull();
    expect(stripHtml('')).toBeNull();
    expect(stripHtml('<br>')).toBeNull();
  });
});

describe('parseFinancial', () => {
  it('parses plain integers', () => {
    expect(parseFinancial('1000')).toEqual({ amount: '1000.00', currency: 'USD' });
  });

  it('parses dollar-prefixed values', () => {
    expect(parseFinancial('$500000')).toEqual({ amount: '500000.00', currency: 'USD' });
  });

  it('parses comma-formatted values', () => {
    expect(parseFinancial('$1,500,000')).toEqual({ amount: '1500000.00', currency: 'USD' });
  });

  it('parses "N million" phrasing', () => {
    expect(parseFinancial('$2 million')).toEqual({ amount: '2000000.00', currency: 'USD' });
    expect(parseFinancial('$10 million total')).toEqual({ amount: '10000000.00', currency: 'USD' });
  });

  it('parses "Nk" and "N thousand"', () => {
    expect(parseFinancial('500k')).toEqual({ amount: '500000.00', currency: 'USD' });
    expect(parseFinancial('5 thousand')).toEqual({ amount: '5000.00', currency: 'USD' });
  });

  it('returns null for free-form strings that are not amounts', () => {
    expect(parseFinancial('Part of Micro')).toBeNull();
    expect(parseFinancial('')).toBeNull();
    expect(parseFinancial(null)).toBeNull();
  });
});

describe('moneyToCents', () => {
  it('converts dollar decimal strings to integer cents', () => {
    expect(moneyToCents({ amount: '1000.00' })).toBe(100_000);
    expect(moneyToCents({ amount: '500.50' })).toBe(50_050);
  });

  it('returns null on null / invalid input', () => {
    expect(moneyToCents(null)).toBeNull();
    expect(moneyToCents({ amount: 'abc' })).toBeNull();
  });
});

describe('splitIsoDateTime', () => {
  it('splits ISO 8601 with offset into date + time', () => {
    expect(splitIsoDateTime('2024-08-01T12:00:00-00:00')).toEqual({
      date: '2024-08-01',
      time: '12:00:00',
    });
  });

  it('splits ISO 8601 UTC (Z) into date + time', () => {
    expect(splitIsoDateTime('2026-04-07T20:00:21Z')).toEqual({
      date: '2026-04-07',
      time: '20:00:21',
    });
  });

  it('returns date-only when the string has no time component', () => {
    expect(splitIsoDateTime('2024-08-01')).toEqual({ date: '2024-08-01', time: null });
  });

  it('returns null for empty or unparseable input', () => {
    expect(splitIsoDateTime(null)).toBeNull();
    expect(splitIsoDateTime('')).toBeNull();
    expect(splitIsoDateTime('not a date')).toBeNull();
  });
});

describe('normalizeStatus', () => {
  it('maps "Accepting applications" to open', () => {
    expect(normalizeStatus('Accepting applications')).toEqual({ value: 'open', customValue: null });
  });

  it('maps "Closed" to closed', () => {
    expect(normalizeStatus('Closed')).toEqual({ value: 'closed', customValue: null });
  });

  it('is case- and whitespace-tolerant', () => {
    expect(normalizeStatus('  ACCEPTING APPLICATIONS  ')).toEqual({
      value: 'open',
      customValue: null,
    });
  });

  it('falls back to custom with the original string for unknown values', () => {
    expect(normalizeStatus('Pending Review')).toEqual({
      value: 'custom',
      customValue: 'Pending Review',
    });
  });

  it('returns custom with null customValue when the input is empty', () => {
    expect(normalizeStatus('')).toEqual({ value: 'custom', customValue: null });
    expect(normalizeStatus(null)).toEqual({ value: 'custom', customValue: null });
  });
});

describe('parseContact', () => {
  it('parses name + email', () => {
    expect(parseContact({ name: 'Tracey Barone, tbarone@pa.gov' })).toEqual({
      name: 'Tracey Barone',
      email: 'tbarone@pa.gov',
      phone: null,
      description: null,
    });
  });

  it('parses name + phone + email', () => {
    expect(parseContact({ name: 'Jane Doe, 555-123-4567, jdoe@pa.gov' })).toEqual({
      name: 'Jane Doe',
      email: 'jdoe@pa.gov',
      phone: '555-123-4567',
      description: null,
    });
  });

  it('handles just a name', () => {
    expect(parseContact({ name: 'Grants Office' })).toEqual({
      name: 'Grants Office',
      email: null,
      phone: null,
      description: null,
    });
  });

  it('returns null for empty or missing input', () => {
    expect(parseContact(null)).toBeNull();
    expect(parseContact({ name: '' })).toBeNull();
    expect(parseContact({ name: '   ' })).toBeNull();
  });

  it('preserves extra unparsed parts in description', () => {
    expect(parseContact({ name: 'Alice, alice@x.org, additional note, more stuff' })).toEqual({
      name: 'Alice',
      email: 'alice@x.org',
      phone: null,
      description: 'additional note, more stuff',
    });
  });
});

describe('slugToCgId', () => {
  it('produces a valid UUID v5', () => {
    const id = slugToCgId('pda1');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is deterministic across calls', () => {
    expect(slugToCgId('pda1')).toBe(slugToCgId('pda1'));
    expect(slugToCgId('pda2')).toBe(slugToCgId('pda2'));
  });

  it('produces distinct ids for distinct slugs', () => {
    expect(slugToCgId('pda1')).not.toBe(slugToCgId('pda2'));
  });
});

describe('buildSearchText', () => {
  it('concatenates searchable fields with single spaces', () => {
    const text = buildSearchText(pdA1Fixture);
    expect(text).toContain('4-H Reimbursement');
    expect(text).toContain('Agriculture');
    expect(text).toContain('Annual');
    expect(text).not.toContain('<a');
  });
});

describe('paGrantToOpportunity (happy path)', () => {
  const opp = paGrantToOpportunity(pdA1Fixture, '2026-04-15T00:00:00Z');

  it('assigns a deterministic CG id from the PA slug', () => {
    expect(opp.id).toBe(slugToCgId('pda1'));
  });

  it('maps status "Accepting applications" to open', () => {
    expect(opp.status).toMatchObject({ value: 'open', customValue: null });
  });

  it('strips HTML from the overview in description', () => {
    expect(opp.description).not.toContain('<a');
    expect(opp.description).toContain('4-H Reimbursement program');
  });

  it('populates funding with parsed Money values', () => {
    expect(opp.funding?.minAwardAmount).toEqual({ amount: '1000.00', currency: 'USD' });
    expect(opp.funding?.maxAwardAmount).toEqual({ amount: '7500.00', currency: 'USD' });
    expect(opp.funding?.totalAmountAvailable).toEqual({ amount: '500000.00', currency: 'USD' });
  });

  it('splits openDate/closeDate into CG Event {date, time}', () => {
    expect(opp.keyDates?.postDate).toMatchObject({
      eventType: 'singleDate',
      date: '2024-08-01',
      time: '12:00:00',
    });
    expect(opp.keyDates?.closeDate).toMatchObject({
      eventType: 'singleDate',
      date: '2024-11-15',
    });
  });

  it('folds decisionDate into keyDates.otherDates', () => {
    const otherDates = opp.keyDates?.otherDates;
    expect(otherDates).toBeDefined();
    expect(otherDates?.['decisionDate']).toMatchObject({
      eventType: 'singleDate',
      date: '2025-01-15',
    });
  });

  it('sets Opportunity.source from linkToApply', () => {
    expect(opp.source).toBe('https://grants.pa.gov/Login.aspx');
  });

  it('populates the shared `agency` custom field from PA agency data', () => {
    expect(opp.customFields?.['agency']).toMatchObject({
      fieldType: 'object',
      value: { code: 'pda', name: 'Agriculture' },
    });
  });

  it('populates the shared `contactInfo` custom field from a parsed pointOfContact', () => {
    expect(opp.customFields?.['contactInfo']).toMatchObject({
      fieldType: 'object',
      value: { name: 'Tracey Barone', email: 'tbarone@pa.gov' },
    });
  });

  it('populates the shared `additionalInfo` custom field from issuingAgencyUrl', () => {
    expect(opp.customFields?.['additionalInfo']).toMatchObject({
      fieldType: 'object',
      value: {
        url: 'https://www.pa.gov/en/agencies/pda.html',
        description: 'Issuing agency homepage',
      },
    });
  });

  it('populates the shared `costSharing` and PA-specific ratio when matching funds are required', () => {
    expect(opp.customFields?.['costSharing']).toMatchObject({
      fieldType: 'object',
      value: { isRequired: true },
    });
    expect(opp.customFields?.['paMatchingFundsRequirement']).toMatchObject({
      fieldType: 'number',
      value: 0.5,
    });
  });

  it('populates the shared `legacySerialId` from issuingAgencyGrantNumber', () => {
    expect(opp.customFields?.['legacySerialId']).toMatchObject({
      fieldType: 'integer',
      value: 1,
    });
  });

  it('populates PA-specific fields (paSlug, paCategory, paProcessSteps, paFaqs, etc.)', () => {
    expect(opp.customFields?.['paSlug']?.value).toBe('pda1');
    expect(opp.customFields?.['paCategory']?.value).toBe('Agriculture');
    expect(opp.customFields?.['paGrantCycle']?.value).toBe('Annual');
    expect(opp.customFields?.['paFundingType']?.value).toBe('Grant');
    expect(opp.customFields?.['paFundingSource']?.value).toBe('State');
    expect(opp.customFields?.['paProcessSteps']?.value).toHaveLength(2);
    expect(opp.customFields?.['paAdditionalResources']?.value).toHaveLength(1);
    expect(opp.customFields?.['paFaqs']?.value).toHaveLength(1);
    expect(opp.customFields?.['paLastSyncedAt']?.value).toBe('2026-04-15T00:00:00Z');
  });

  it('produces output that passes full PaOpportunitySchema validation', () => {
    expect(() => PaOpportunitySchema.parse(opp)).not.toThrow();
  });
});

describe('paGrantToOpportunity (edge cases)', () => {
  const opp = paGrantToOpportunity(pdA2FixtureEdgeCases, '2026-04-15T00:00:00Z');

  it('falls back to custom status with the original value preserved', () => {
    expect(opp.status).toMatchObject({ value: 'custom', customValue: 'Pending Review' });
  });

  it('preserves unparseable financial values in paRaw* custom fields', () => {
    expect(opp.funding?.maxAwardAmount).toEqual({ amount: '2000000.00', currency: 'USD' });
    expect(opp.funding?.totalAmountAvailable).toBeNull();
    expect(opp.customFields?.['paRawTotalFunds']?.value).toBe('Part of Micro');
  });

  it('omits keyDates entirely when all PA date fields are empty', () => {
    expect(opp.keyDates).toBeNull();
  });

  it('leaves Opportunity.source null when linkToApply is empty', () => {
    expect(opp.source).toBeNull();
  });

  it('omits agency/contactInfo/additionalInfo/costSharing when PA fields are empty', () => {
    expect(opp.customFields?.['additionalInfo']).toBeUndefined();
    expect(opp.customFields?.['costSharing']).toBeUndefined();
  });

  it('still produces output that passes schema validation', () => {
    expect(() => PaOpportunitySchema.parse(opp)).not.toThrow();
  });
});

describe('paGrantToOpportunity (linkToApply coercion)', () => {
  it('drops non-URL linkToApply values from `source` and stashes them in paRawLinkToApply', () => {
    const opp = paGrantToOpportunity(
      { ...pdA1Fixture, slug: 'pda-bad-link', linkToApply: 'TBD' },
      '2026-04-27T00:00:00Z',
    );
    expect(opp.source).toBeNull();
    expect(opp.customFields?.['paRawLinkToApply']).toMatchObject({
      fieldType: 'string',
      value: 'TBD',
    });
  });

  it('keeps valid URL linkToApply values and does not stash a raw copy', () => {
    const opp = paGrantToOpportunity(
      { ...pdA1Fixture, linkToApply: 'https://example.gov/x' },
      '2026-04-27T00:00:00Z',
    );
    expect(opp.source).toBe('https://example.gov/x');
    expect(opp.customFields?.['paRawLinkToApply']).toBeUndefined();
  });

  it('leaves both `source` and paRawLinkToApply unset when linkToApply is empty', () => {
    const opp = paGrantToOpportunity(
      { ...pdA1Fixture, slug: 'pda-empty-link', linkToApply: '' },
      '2026-04-27T00:00:00Z',
    );
    expect(opp.source).toBeNull();
    expect(opp.customFields?.['paRawLinkToApply']).toBeUndefined();
  });
});

describe('paGrantToOpportunity (post-transform validation)', () => {
  it('throws TransformValidationError when the produced object fails schema validation', () => {
    // `last_modified` is passed straight through into `lastModifiedAt`, which
    // the SDK validates as a UTC datetime — a garbage value reliably trips
    // the post-transform safe-parse without us having to fake the schema.
    const bad: typeof pdA1Fixture = {
      ...pdA1Fixture,
      slug: 'pda-bad-modified',
      last_modified: 'not-a-datetime',
    };
    expect(() => paGrantToOpportunity(bad, '2026-04-27T00:00:00Z')).toThrow(
      TransformValidationError,
    );
  });

  it('attaches the source slug and the offending Zod issues on the thrown error', () => {
    const bad: typeof pdA1Fixture = {
      ...pdA1Fixture,
      slug: 'pda-bad-modified-2',
      last_modified: 'not-a-datetime',
    };
    try {
      paGrantToOpportunity(bad, '2026-04-27T00:00:00Z');
      throw new Error('expected paGrantToOpportunity to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TransformValidationError);
      const tve = err as TransformValidationError;
      expect(tve.sourceId).toBe('pda-bad-modified-2');
      expect(tve.issues.length).toBeGreaterThan(0);
      expect(tve.issues.some((i) => i.path.includes('lastModifiedAt'))).toBe(true);
    }
  });
});

describe('buildStoredOpportunity', () => {
  it('produces a StoredOpportunity with cents-denominated funding and a JSON-serialized opportunity', () => {
    const opp = paGrantToOpportunity(pdA1Fixture, '2026-04-15T00:00:00Z');
    const row = buildStoredOpportunity(pdA1Fixture, opp, 'deadbeef');

    expect(row).toMatchObject({
      id: slugToCgId('pda1'),
      sourceId: 'pda1',
      title: '4-H Reimbursement',
      status: 'open',
      minAwardAmountCents: 100_000,
      maxAwardAmountCents: 750_000,
      totalAmountAvailableCents: 50_000_000,
      contentHash: 'deadbeef',
    });
    expect(row.searchText).toContain('Agriculture');

    // rawJson round-trips to the same structure.
    const parsed = JSON.parse(row.rawJson);
    expect(parsed.id).toBe(opp.id);
    expect(parsed.title).toBe(opp.title);
  });
});
