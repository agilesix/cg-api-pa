#!/usr/bin/env bash
set -euo pipefail

# Delete an ephemeral preview D1 database and its per-PR Worker.
#
# Usage:
#   ./scripts/preview-cleanup.sh <identifier>
#
# Example:
#   ./scripts/preview-cleanup.sh pr-42
#   ./scripts/preview-cleanup.sh my-feature

IDENTIFIER="${1:?Usage: preview-cleanup.sh <identifier>}"
DB_NAME="pa-grants-preview-${IDENTIFIER}"
WORKER_NAME="pa-commongrants-api-${IDENTIFIER}"
WRANGLER="pnpm exec wrangler"

echo "→ Deleting preview Worker: ${WORKER_NAME}"
${WRANGLER} delete --name "${WORKER_NAME}" 2>&1 || echo "  Worker not found (already cleaned up)"

echo "→ Deleting preview database: ${DB_NAME}"
${WRANGLER} d1 delete "${DB_NAME}" 2>&1 || echo "  Database not found (already cleaned up)"

echo "  ✓ Cleanup complete"
