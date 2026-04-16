import type { PaGrant } from '../../src/adapter';

/**
 * A realistic fixture derived from an actual record in the PA eGrants Beta API.
 * Covers the fully-populated case: valid financial values, agency info,
 * contact, dates, process steps, FAQs, and additional resources.
 */
export const pdA1Fixture: PaGrant = {
  slug: 'pda1',
  title: '4-H Reimbursement',
  status: 'Accepting applications',
  category: 'Agriculture',
  issuingAgency: 'Agriculture',
  shortIssuingAgency: 'pda',
  last_modified: '2026-04-07T20:00:21Z',
  overview:
    'The 4-H Reimbursement program supports youth development. <a href="https://pa.gov" rel="noopener">Learn more</a>.',
  shortDescription: 'Short description for 4-H Reimbursement.',
  openDate: '2024-08-01T12:00:00-00:00',
  closeDate: '2024-11-15T12:00:00-00:00',
  decisionDate: '2025-01-15T00:00:00-00:00',
  anticipatedFundingDate: '',
  grantCycle: 'Annual ',
  fundingType: 'Grant ',
  fundingSource: 'State',
  minimumAward: '1000',
  maximumAward: '7500',
  totalFundsToBeAwarded: '500000',
  anticipatedFunding: '',
  matchingFundsRequirements: '0.5',
  applicantType: '',
  applicantCategory: '',
  eligibility: '',
  reportingMonitoring: '',
  populationServedType: '',
  populationServedGeography: '',
  issuingAgencyGrantNumber: 1,
  issuingAgencyUrl: 'https://www.pa.gov/en/agencies/pda.html',
  linkToApply: 'https://grants.pa.gov/Login.aspx',
  pointOfContact: { name: 'Tracey Barone, tbarone@pa.gov' },
  processSteps: [
    { stepNumber: 1, description: 'Review the RFP' },
    { stepNumber: 2, description: 'Submit the application' },
  ],
  additionalResources: [{ title: 'RFP PDF', url: 'https://example.pa.gov/rfp.pdf' }],
  FAQs: [{ question: 'Who can apply?', answer: 'Registered 4-H clubs.' }],
};

/**
 * A fixture exercising the edge cases that bit the transform layer during
 * development: free-form financial strings that can't be parsed cleanly, an
 * unfamiliar status value, empty dates, and an unparseable contact.
 */
export const pdA2FixtureEdgeCases: PaGrant = {
  slug: 'pda2-edge',
  title: 'Edge Case Grant',
  status: 'Pending Review',
  category: 'Agriculture',
  issuingAgency: 'Agriculture',
  shortIssuingAgency: 'pda',
  last_modified: '2026-04-07T20:00:21Z',
  overview: '',
  shortDescription: '',
  openDate: '',
  closeDate: '',
  decisionDate: '',
  anticipatedFundingDate: '',
  grantCycle: '',
  fundingType: '',
  fundingSource: '',
  minimumAward: '',
  maximumAward: '$2 million',
  totalFundsToBeAwarded: 'Part of Micro',
  anticipatedFunding: '',
  matchingFundsRequirements: '',
  applicantType: '',
  applicantCategory: '',
  eligibility: '',
  reportingMonitoring: '',
  populationServedType: '',
  populationServedGeography: '',
  issuingAgencyGrantNumber: 2,
  issuingAgencyUrl: '',
  linkToApply: '',
  pointOfContact: { name: 'Grants Office' },
  processSteps: [],
  additionalResources: [],
  FAQs: [],
};
