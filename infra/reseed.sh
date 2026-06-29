#!/usr/bin/env bash
# Wipe + reseed the demo data (Magna-Coahuila tenant + warm-start actuals).
# demo:reset TRUNCATEs the app schemas, re-seeds, then drives the LIVE API at
# http://localhost:3010/api/v1 to solve→commit→simulate — so it MUST run INSIDE the
# running api container (localhost = the API). `exec`, not `run`.
#
# Requires: api + db already up (infra/run.sh "cd <dir> && docker compose up -d").
# Destructive: this wipes existing demo state. Login after reseed:
#   admin@perduraflow.test / Password123
set -euo pipefail
cd "$(dirname "$0")"
# Run reset.ts directly with bun (bun runs TS natively). NOT the `demo:reset` npm
# script — that uses `tsx`, which fails under the bun runtime. `-T` since SSM has no TTY.
docker compose --env-file .env exec -T api bun apps/api/src/db/reset.ts
echo "✓ demo data reseeded"
