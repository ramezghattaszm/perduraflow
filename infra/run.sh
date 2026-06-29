#!/usr/bin/env bash
# Run one shell command on the demo instance via SSM (no SSH), print its output.
# Runs from /opt/perdura (where docker-compose.yml + scripts live) as root.
#   infra/run.sh "docker compose --env-file .env ps"
#   infra/run.sh "./migrate.sh"
#   infra/run.sh "./reseed.sh"
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth
[ "$#" -ge 1 ] || { echo "usage: run.sh \"<command>\"" >&2; exit 1; }
cmd="$*"
id="$(instance_id)"
[ -n "$id" ] && [ "$id" != "None" ] || { echo "No instance tagged Name=$PERDURA_TAG_NAME found." >&2; exit 1; }

comment="perdura: $cmd"; comment="${comment:0:99}"
cmd_id="$(aws ssm send-command \
  --instance-ids "$id" \
  --document-name AWS-RunShellScript \
  --comment "$comment" \
  --parameters "commands=[\"cd /opt/perdura && $cmd\"]" \
  --query 'Command.CommandId' --output text)"

echo "→ $cmd  (command $cmd_id on $id)"
aws ssm wait command-executed --command-id "$cmd_id" --instance-id "$id" 2>/dev/null || true

status="$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" --query 'Status' --output text)"
echo "── stdout ─────────────────────────────────────────────"
aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" --query 'StandardOutputContent' --output text
err="$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" --query 'StandardErrorContent' --output text)"
[ -n "$err" ] && { echo "── stderr ─────────────────────────────────────────────"; echo "$err"; }
echo "── status: $status ────────────────────────────────────"
[ "$status" = "Success" ]
