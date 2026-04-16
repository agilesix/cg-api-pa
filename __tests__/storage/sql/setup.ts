import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import { beforeAll } from 'vitest';

/**
 * Shared setup for the `workers` vitest project. Applies all discovered D1
 * migrations (injected by the pool config in `vitest.config.ts` as
 * `TEST_MIGRATIONS`) to the ephemeral per-worker D1 database. Each test
 * file then wipes data in its own `beforeEach` hook while keeping the
 * schema intact.
 *
 * `TEST_MIGRATIONS` is a test-only binding — we don't augment the global
 * `Cloudflare.Env` interface for it. A local cast keeps the extra binding
 * scoped to this file.
 */
interface TestBindings {
  readonly TEST_MIGRATIONS: D1Migration[];
}

beforeAll(async () => {
  const { TEST_MIGRATIONS } = env as unknown as TestBindings;
  await applyD1Migrations(env.DB, TEST_MIGRATIONS);
});
