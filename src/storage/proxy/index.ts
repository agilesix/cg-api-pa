/**
 * Public surface of the proxy storage tier (future `@common-grants/repository-proxy`).
 *
 * Tier 0 implementation of `IOppRepo`: no persistence, each
 * call hits the upstream `ISourceClient` and filters/paginates in JS.
 */

export { ProxyOppRepo } from './ProxyOppRepo';
