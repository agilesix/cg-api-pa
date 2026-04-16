#!/usr/bin/env bash
set -euo pipefail

# Create (or reuse) an ephemeral preview D1 database and patch wrangler.jsonc.
#
# Usage:
#   ./scripts/preview-create.sh <identifier>
#
# Example:
#   ./scripts/preview-create.sh pr-42       # CI uses the PR number
#   ./scripts/preview-create.sh my-feature   # local testing
#
# Outputs (for CI consumption via $GITHUB_OUTPUT):
#   db_name=pa-grants-preview-<identifier>
#   db_id=<uuid>

IDENTIFIER="${1:?Usage: preview-create.sh <identifier>}"
DB_NAME="pa-grants-preview-${IDENTIFIER}"
WRANGLER="pnpm exec wrangler"

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

echo "→ Patching wrangler.jsonc (env.preview)"
sed -i.bak 's/"database_id": "PATCHED_BY_CI"/"database_id": "'"${DB_ID}"'"/' wrangler.jsonc
sed -i.bak 's/"database_name": "pa-grants-preview"/"database_name": "'"${DB_NAME}"'"/' wrangler.jsonc
rm -f wrangler.jsonc.bak
echo "  ✓ Patched"

echo "→ Applying migrations to ${DB_NAME}"
${WRANGLER} d1 migrations apply "${DB_NAME}" --remote --yes --env preview
echo "  ✓ Migrations applied"

echo "→ Deploying preview Worker"
${WRANGLER} deploy --env preview
echo "  ✓ Deployed"

# Emit outputs for CI (no-op if not running in GitHub Actions).
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "db_name=${DB_NAME}" >> "$GITHUB_OUTPUT"
  echo "db_id=${DB_ID}" >> "$GITHUB_OUTPUT"
fi

echo ""
echo "✅ Preview ready: ${DB_NAME} (${DB_ID})"
