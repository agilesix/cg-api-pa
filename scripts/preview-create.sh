#!/usr/bin/env bash
set -euo pipefail

# Create (or reuse) an ephemeral preview D1 database, deploy a per-PR
# Worker, and output the preview URL.
#
# Usage:
#   ./scripts/preview-create.sh <identifier>
#
# Example:
#   ./scripts/preview-create.sh pr-42       # CI uses the PR number
#   ./scripts/preview-create.sh my-feature   # local testing
#
# Each identifier gets its own Worker name and D1 database, so multiple
# PRs can be open simultaneously without overwriting each other.
#
# Outputs (for CI consumption via $GITHUB_OUTPUT):
#   db_name=pa-grants-preview-<identifier>
#   db_id=<uuid>
#   url=https://<worker-name>.<subdomain>.workers.dev

IDENTIFIER="${1:?Usage: preview-create.sh <identifier>}"
DB_NAME="pa-grants-preview-${IDENTIFIER}"
WORKER_NAME="pa-commongrants-api-${IDENTIFIER}"
WRANGLER="pnpm exec wrangler"

# -------------------------------------------------------------------------
# 1. Create or reuse the ephemeral D1 database
# -------------------------------------------------------------------------

echo "→ Checking for existing database: ${DB_NAME}"
EXISTING=$(${WRANGLER} d1 list --json 2>/dev/null \
  | node -e "
      const j = require('fs').readFileSync('/dev/stdin', 'utf8');
      const db = JSON.parse(j).find(d => d.name === '${DB_NAME}');
      if (db) console.log(db.uuid);
    " 2>/dev/null || true)

if [ -n "$EXISTING" ]; then
  echo "  ✓ Reusing existing DB: ${EXISTING}"
  DB_ID="$EXISTING"
else
  echo "  → Creating ${DB_NAME}..."
  OUTPUT=$(${WRANGLER} d1 create "${DB_NAME}" 2>&1)
  echo "$OUTPUT"
  DB_ID=$(echo "$OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$DB_ID" ]; then
    echo "  ✗ Failed to parse database_id from wrangler output"
    exit 1
  fi
  echo "  ✓ Created: ${DB_ID}"
fi

# -------------------------------------------------------------------------
# 2. Patch wrangler.jsonc with the ephemeral DB and per-PR Worker name
# -------------------------------------------------------------------------

echo "→ Patching wrangler.jsonc (env.preview)"
sed -i.bak 's/"database_id": "PATCHED_BY_CI"/"database_id": "'"${DB_ID}"'"/' wrangler.jsonc
sed -i.bak 's/"database_name": "pa-grants-preview"/"database_name": "'"${DB_NAME}"'"/' wrangler.jsonc
rm -f wrangler.jsonc.bak
echo "  ✓ Patched"

# -------------------------------------------------------------------------
# 3. Apply migrations
# -------------------------------------------------------------------------

echo "→ Applying migrations to ${DB_NAME}"
${WRANGLER} d1 migrations apply "${DB_NAME}" --remote --env preview
echo "  ✓ Migrations applied"

# -------------------------------------------------------------------------
# 4. Deploy with a unique Worker name so multiple PRs don't collide
# -------------------------------------------------------------------------

echo "→ Deploying preview Worker: ${WORKER_NAME}"
DEPLOY_OUTPUT=$(${WRANGLER} deploy --env preview --name "${WORKER_NAME}" 2>&1)
echo "$DEPLOY_OUTPUT"

# Parse the URL from wrangler deploy output (typically the last https:// URL)
PREVIEW_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^ ]+\.workers\.dev' | tail -1)
echo "  ✓ Deployed: ${PREVIEW_URL:-unknown}"

# -------------------------------------------------------------------------
# 5. Emit outputs for CI
# -------------------------------------------------------------------------

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "db_name=${DB_NAME}" >> "$GITHUB_OUTPUT"
  echo "db_id=${DB_ID}" >> "$GITHUB_OUTPUT"
  echo "url=${PREVIEW_URL}" >> "$GITHUB_OUTPUT"
fi

echo ""
echo "✅ Preview ready: ${PREVIEW_URL:-${WORKER_NAME}}"
echo "   D1: ${DB_NAME} (${DB_ID})"
