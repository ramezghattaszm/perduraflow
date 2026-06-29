#!/usr/bin/env bash
# Run Drizzle migrations against the compose Postgres. Idempotent; safe to re-run.
# Runs as a one-off in a throwaway api container (DB only needs to be up, not the API).
set -euo pipefail
cd "$(dirname "$0")"
docker compose --env-file .env run --rm api bun --filter @perduraflow/api db:migrate
echo "✓ migrations applied"
