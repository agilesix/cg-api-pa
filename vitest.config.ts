import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Two-project test config:
 *
 *   - `node`: pure-unit tests (adapter transforms, core contracts, proxy
 *     repository, ETL with mocks, routes with a fake repo). Fast, no
 *     Workers runtime, no native modules.
 *
 *   - `workers`: integration tests that talk to a real ephemeral Cloudflare
 *     D1 (and any other bindings) via `@cloudflare/vitest-pool-workers`.
 *     Runs inside Miniflare, so the SQL path exactly matches production.
 *     Migrations are discovered from `src/storage/sql/migrations/` by
 *     `readD1Migrations()` and applied per-test suite via a shared setup file.
 *
 * The `poolRunner` field is what routes a test to one project or the other —
 * files listed in the `workers` project's `include` run through Miniflare,
 * and the `node` project explicitly excludes them to prevent double-execution.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'src/storage/sql/migrations'));

  const workersPoolOptions = {
    // Use a minimal test-only worker entrypoint rather than `src/index.ts`.
    // The production entrypoint transitively imports `@common-grants/sdk`
    // (a CJS package) which doesn't load cleanly in Miniflare's test runtime.
    // Storage tests don't need the full app — they go straight to `env.DB`.
    main: './__tests__/storage/sql/worker-main.ts',
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      // Expose the migrations to tests as a binding that
      // `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` consumes.
      bindings: { TEST_MIGRATIONS: migrations },
    },
  } as const;

  return {
    test: {
      projects: [
        {
          test: {
            name: 'node',
            environment: 'node',
            include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
            exclude: ['__tests__/storage/sql/**/*.test.ts'],
          },
        },
        {
          plugins: [cloudflareTest(workersPoolOptions)],
          test: {
            name: 'workers',
            include: ['__tests__/storage/sql/**/*.test.ts'],
            setupFiles: ['./__tests__/storage/sql/setup.ts'],
            poolRunner: cloudflarePool(workersPoolOptions),
          },
        },
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/**',
          'dist/**',
          '.wrangler/**',
          'coverage/**',
          '**/*.test.ts',
          '**/*.spec.ts',
          '**/*.config.*',
          'src/storage/sql/schema.ts',
        ],
      },
    },
  };
});
