/**
 * Storage tiers, re-exported for a single import site.
 *
 * Most code should import from the specific tier (`storage/proxy` or
 * `storage/sql`) to make the dependency clear. This file exists for
 * convenience and for `src/cg.config.ts`.
 */

export { ProxyOppRepo } from './proxy';
export { SqliteOppRepo, createDb, type Db, type DB } from './sql';
export {
  storedFromCommon,
  type CgOpportunityLike,
  type StoredFromCommonMeta,
} from './storedFromCommon';
