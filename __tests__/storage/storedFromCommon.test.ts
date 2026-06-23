import { describe, it, expect } from 'vitest';
import { buildSearchText, getSourceId, paGrantToOpportunity } from '../../src/adapter';
import { storedFromCommon } from '../../src/storage';
import { pdA1Fixture } from '../adapter/fixtures';

/**
 * `storedFromCommon` is the generic projection from a CommonGrants opportunity
 * to the storage-tier `StoredOpportunity` row. It replaced the former
 * adapter-specific `buildStoredOpportunity`: every column except `sourceId` and
 * `searchText` derives from the CG opportunity itself.
 */
describe('storedFromCommon', () => {
  const opp = paGrantToOpportunity(pdA1Fixture, '2026-04-15T00:00:00Z');
  const row = storedFromCommon(opp, {
    sourceId: getSourceId(pdA1Fixture),
    searchText: buildSearchText(pdA1Fixture),
    contentHash: 'deadbeef',
  });

  it('derives the denormalized columns from the CG opportunity + per-source metadata', () => {
    expect(row).toMatchObject({
      id: opp.id,
      sourceId: 'pda1',
      title: '4-H Reimbursement',
      status: 'open',
      minAwardAmountCents: 100_000,
      maxAwardAmountCents: 750_000,
      totalAmountAvailableCents: 50_000_000,
      contentHash: 'deadbeef',
    });
    expect(row.searchText).toContain('Agriculture');
  });

  it('derives close/post dates from keyDates as calendar-date strings', () => {
    expect(row.postDate).toBe('2024-08-01T12:00:00');
    expect(row.closeDate).toBe('2024-11-15T12:00:00');
  });

  it('serializes the opportunity to rawJson, preserving the string date shape', () => {
    const parsed = JSON.parse(row.rawJson);
    expect(parsed.id).toBe(opp.id);
    expect(parsed.title).toBe(opp.title);
    // The pure builder emits calendar dates as plain strings (no Date coercion).
    expect(parsed.keyDates.closeDate.date).toBe('2024-11-15');
  });

  it('leaves money columns null when funding is absent', () => {
    const noFunding = paGrantToOpportunity(
      { ...pdA1Fixture, minimumAward: '', maximumAward: '', totalFundsToBeAwarded: '' },
      '2026-04-15T00:00:00Z',
    );
    const r = storedFromCommon(noFunding, {
      sourceId: 'x',
      searchText: '',
      contentHash: 'h',
    });
    expect(r.minAwardAmountCents).toBeNull();
    expect(r.maxAwardAmountCents).toBeNull();
    expect(r.totalAmountAvailableCents).toBeNull();
  });
});
