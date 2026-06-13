#!/usr/bin/env bash
# Create the app database if it does not exist. Idempotent.
# Reads DATABASE_URL from the environment (or apps/api/.env).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/perduraflow}"

# Extract the database name (last path segment, strip query string).
DB_NAME="$(printf '%s' "$DB_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
# Admin URL points at the default 'postgres' database on the same server.
ADMIN_URL="$(printf '%s' "$DB_URL" | sed -E 's#/([^/?]+)(\?.*)?$#/postgres#')"

echo "Ensuring database '${DB_NAME}' exists…"
if psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  echo "  → already exists"
else
  psql "$ADMIN_URL" -c "CREATE DATABASE \"${DB_NAME}\""
  echo "  ✓ created"
fi
