/**
 * Idempotent project bootstrap.
 *
 * Runs the Cloudflare side of first-time setup so a fresh clone / fork can
 * reach a working `pnpm run dev` with a single command:
 *
 *   pnpm run bootstrap
 *
 * What it does (all safe to re-run):
 *
 *   1. Verifies you're authenticated with Cloudflare (`wrangler whoami`).
 *   2. Creates the D1 database (`pa-grants-commongrants`) if it doesn't
 *      already exist. If it DOES exist, reads its id via `wrangler d1 list`.
 *   3. Patches `wrangler.jsonc`'s `database_id` placeholder with the real id.
 *   4. Creates the R2 bucket (`pa-grants-raw-snapshots`) if it doesn't exist.
 *   5. Applies local D1 migrations.
 *
 * Forks of this template: update `DB_NAME` and `BUCKET_NAME` below to
 * match your own `wrangler.jsonc`, then commit. The whole setup is then
 * reproducible with `pnpm run bootstrap` — no clickops required.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// -------------------------------------------------------------------------
// Resource names — the only values forks need to change.
// Must match the `database_name` and `bucket_name` in wrangler.jsonc.
// -------------------------------------------------------------------------
const DB_NAME = 'pa-grants-commongrants';
const BUCKET_NAME = 'pa-grants-raw-snapshots';
const WRANGLER_CONFIG = 'wrangler.jsonc';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

const ANSI = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const step = (msg: string) => console.log(`\n${ANSI.bold(`→ ${msg}`)}`);
const ok = (msg: string) => console.log(`  ${ANSI.green('✓')} ${msg}`);
const warn = (msg: string) => console.log(`  ${ANSI.yellow('!')} ${msg}`);
const fail = (msg: string) => {
  console.error(`  ${ANSI.red('✗')} ${msg}`);
  process.exit(1);
};

/**
 * Run a shell command. Returns stdout. On failure, either throws (default)
 * or returns captured stderr when `allowFail` is true.
 */
function sh(cmd: string, opts: { allowFail?: boolean; silent?: boolean } = {}): string {
  if (!opts.silent) console.log(ANSI.dim(`    $ ${cmd}`));
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const stderr = e.stderr?.toString() ?? '';
    if (opts.allowFail) return stderr;
    console.error(stderr);
    console.error((e.stdout ?? Buffer.from('')).toString());
    process.exit(1);
  }
}

const WRANGLER = 'pnpm exec wrangler';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// -------------------------------------------------------------------------
// 1. Cloudflare auth
// -------------------------------------------------------------------------

step('Verifying Cloudflare authentication');
const whoami = sh(`${WRANGLER} whoami`, { allowFail: true, silent: true });
if (/not authenticated|not logged/i.test(whoami)) {
  console.log(whoami);
  fail('Not authenticated. Run `pnpm exec wrangler login` and try again.');
}
ok('authenticated');

// -------------------------------------------------------------------------
// 2. D1 database — ensure it exists; capture its id.
// -------------------------------------------------------------------------

step(`Ensuring D1 database "${DB_NAME}" exists`);

interface D1ListEntry {
  uuid?: string;
  name?: string;
}

const listJson = sh(`${WRANGLER} d1 list --json`, { silent: true });
let databaseId: string | null = null;
try {
  const existing = JSON.parse(listJson) as D1ListEntry[];
  const match = existing.find((db) => db.name === DB_NAME);
  if (match?.uuid) {
    databaseId = match.uuid;
    ok(`${DB_NAME} already exists (id: ${databaseId})`);
  }
} catch {
  // fall through to create
}

if (!databaseId) {
  console.log(`  creating ${DB_NAME}...`);
  const createOut = sh(`${WRANGLER} d1 create ${DB_NAME}`);
  const m = createOut.match(/"database_id"\s*:\s*"([^"]+)"/) ?? createOut.match(UUID_RE);
  if (!m) {
    console.error(createOut);
    fail(`Couldn't parse database_id from wrangler output (see above).`);
  }
  // Both patterns return the id in the first capture group or as the match itself.
  databaseId = (m as RegExpMatchArray)[1] ?? (m as RegExpMatchArray)[0];
  ok(`created (id: ${databaseId})`);
}

// -------------------------------------------------------------------------
// 3. Patch wrangler.jsonc with the real database_id.
// -------------------------------------------------------------------------

step(`Updating ${WRANGLER_CONFIG}`);
const config = readFileSync(WRANGLER_CONFIG, 'utf8');
const patched = config.replace(/"database_id"\s*:\s*"[^"]+"/, `"database_id": "${databaseId}"`);
if (patched === config) {
  ok('already up to date');
} else {
  writeFileSync(WRANGLER_CONFIG, patched);
  ok(`patched database_id → ${databaseId}`);
}

// -------------------------------------------------------------------------
// 4. R2 bucket — ensure it exists.
// -------------------------------------------------------------------------

step(`Ensuring R2 bucket "${BUCKET_NAME}" exists`);
// `wrangler r2 bucket create` returns a non-zero exit code if the bucket
// already exists, with a recognizable error message. We swallow that case.
// It ALSO fails if the account hasn't enabled R2 yet — that enablement
// requires accepting terms + attaching a billing method and genuinely
// cannot be scripted, so we detect that case and hand the user the URL.
const r2Out = sh(`${WRANGLER} r2 bucket create ${BUCKET_NAME}`, { allowFail: true });

const needsR2Enablement =
  /must sign up for the R2 service|subscribe.*R2|R2 service is not enabled|enable R2|code:\s*10042/i.test(
    r2Out,
  );

if (needsR2Enablement) {
  console.log();
  console.log(
    ANSI.yellow(ANSI.bold('⚠  R2 needs one-time enablement in the Cloudflare dashboard.')),
  );
  console.log();
  console.log("This is the single Cloudflare setup step that can't be scripted —");
  console.log("you have to accept R2's terms and attach a billing method manually.");
  console.log('After that, the API is fully scriptable and this bootstrap is idempotent.');
  console.log();
  console.log(`  1. Open: ${ANSI.bold('https://dash.cloudflare.com/?to=/:account/r2')}`);
  console.log('  2. Click "Enable R2" and follow the prompts.');
  console.log(`  3. Re-run: ${ANSI.bold('pnpm run bootstrap')}`);
  console.log();
  console.log(
    ANSI.dim(
      "Alternatively, if you're deploying a tier that doesn't need raw-record\n" +
        'archival (tier 0 / tier 1), remove the `r2_buckets` entry from\n' +
        'wrangler.jsonc and swap `BucketSnapshotStore` for `NoopSnapshotStore` in\n' +
        'src/cg.config.ts (see PORTING.md recipe #1).',
    ),
  );
  console.log();
  process.exit(2);
}

if (/already exists|ResourceInUse|BucketAlreadyOwnedByYou/i.test(r2Out)) {
  ok(`${BUCKET_NAME} already exists`);
} else if (/Created bucket|created/i.test(r2Out)) {
  ok(`created`);
} else if (r2Out.trim() === '') {
  // Some wrangler versions print nothing on success.
  ok(`created (or already existed)`);
} else {
  warn(`r2 bucket create returned an unexpected output:`);
  console.log(r2Out);
}

// -------------------------------------------------------------------------
// 5. Apply local D1 migrations so `pnpm run dev` works out of the box.
// -------------------------------------------------------------------------

step('Applying local D1 migrations');
sh(`pnpm run migrate`);
ok('migrations applied');

// -------------------------------------------------------------------------
// Done.
// -------------------------------------------------------------------------

console.log(`
${ANSI.green(ANSI.bold('✅ Bootstrap complete.'))}

Next steps:
  ${ANSI.dim('# run the API locally')}
  pnpm run dev

  ${ANSI.dim('# deploy to Cloudflare (requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)')}
  pnpm run migrate:remote
  pnpm run deploy
`);
