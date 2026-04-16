#!/usr/bin/env bash
set -euo pipefail

# Delete an ephemeral preview D1 database.
#
# Usage:
#   ./scripts/preview-cleanup.sh <identifier>
#
# Example:
#   ./scripts/preview-cleanup.sh pr-42
#   ./scripts/preview-cleanup.sh my-feature

IDENTIFIER="${1:?Usage: preview-cleanup.sh <identifier>}"
DB_NAME="pa-grants-preview-${IDENTIFIER}"
WRANGLER="pnpm exec wrangler"

echo "→ Deleting preview database: ${DB_NAME}"
${WRANGLER} d1 delete "${DB_NAME}" --yes 2>&1 || echo "  Database not found (already cleaned up)"
echo "  ✓ Done"
