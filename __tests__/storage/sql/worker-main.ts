/**
 * Minimal Worker entrypoint used ONLY by the `workers` vitest project.
 *
 * The production entrypoint is `src/index.ts`, which transitively pulls in
 * `src/app.ts` → `src/routes/*` → `@common-grants/sdk/schemas`. The SDK is
 * published as CJS and does not load cleanly inside Miniflare's test
 * runtime, so we point the test pool at this file instead. Storage tests
 * talk to D1 via the `env` binding and never hit the `fetch` handler, so
 * its contents don't matter — this body just needs to be a valid Workers
 * module.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response('test-only worker', { status: 200 });
  },
};
