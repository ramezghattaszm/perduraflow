#!/usr/bin/env bash
# Power the demo box ON before a demo. (Containers auto-start: restart: unless-stopped.)
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth
id="$(instance_id)"
[ -n "$id" ] && [ "$id" != "None" ] || { echo "No instance tagged Name=$PERDURA_TAG_NAME found." >&2; exit 1; }
aws ec2 start-instances --instance-ids "$id" >/dev/null
echo "Starting $id... waiting until running."
aws ec2 wait instance-running --instance-ids "$id"
echo "✓ running. Give containers ~30s, then check: infra/run.sh \"docker compose --env-file .env ps\""
