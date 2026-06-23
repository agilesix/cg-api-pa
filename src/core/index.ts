/**
 * Public surface of the core contracts layer.
 *
 * This is the future `@common-grants/contracts` package. It depends only on
 * `zod` and `@common-grants/sdk`. It must NOT import from any other
 * `src/**` directory — that rule is enforced by ESLint in `eslint.config.mjs`.
 *
 * Other layers import everything they need from `./core` through this file.
 * Deep imports (e.g. `import { Foo } from './core/types'`) are forbidden by
 * the same lint rule that will be tightened in subsequent phases.
 */

export type { ISourceClient } from './ISourceClient';
export type { IOppRepo } from './IOppRepo';
export type { ISnapshotStore } from './ISnapshotStore';
export type {
  Logger,
  OppFilters,
  OppSorting,
  OpportunitySearchParams,
  PaginatedResult,
  StoredOpportunity,
  SyncStats,
} from './types';
