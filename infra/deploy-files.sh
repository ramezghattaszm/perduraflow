#!/usr/bin/env bash
# Deliver the on-instance deploy files to /opt/perdura via the private S3 bucket
# (keeps the .env out of CloudTrail/user-data). Bundles compose, Caddyfile, the real
# .env, and the db helper scripts; the instance pulls with its IAM role; the S3 copy
# is deleted afterward. Re-run any time you change these files.
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth
STATE_FILE="$(pwd)/.deploy-state"
[ -f "$STATE_FILE" ] || { echo "No .deploy-state — run provision.sh first." >&2; exit 1; }
# shellcheck disable=SC1090
source "$STATE_FILE"
[ -f .env ] || { echo "No infra/.env — create it from .env.example first (chmod 600)." >&2; exit 1; }

IID="$(instance_id)"
[ -n "$IID" ] && [ "$IID" != "None" ] || { echo "No instance found." >&2; exit 1; }

TARBALL="$(mktemp -t perdura-deploy-XXXX).tgz"
trap 'rm -f "$TARBALL"' EXIT
tar -czf "$TARBALL" docker-compose.yml Caddyfile .env migrate.sh reseed.sh
KEY="deploy/$(basename "$TARBALL")"
aws s3 cp "$TARBALL" "s3://${DEPLOY_BUCKET}/${KEY}" >/dev/null
echo "→ uploaded bundle to s3://${DEPLOY_BUCKET}/${KEY}"

cmd_id="$(aws ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript \
  --comment "perdura: sync deploy files" \
  --parameters "commands=[\"set -e\",\"mkdir -p /opt/perdura\",\"aws s3 cp s3://${DEPLOY_BUCKET}/${KEY} /tmp/perdura-deploy.tgz\",\"tar -xzf /tmp/perdura-deploy.tgz -C /opt/perdura\",\"chmod +x /opt/perdura/*.sh\",\"chmod 600 /opt/perdura/.env\",\"rm -f /tmp/perdura-deploy.tgz\",\"ls -la /opt/perdura\"]" \
  --query 'Command.CommandId' --output text)"
aws ssm wait command-executed --command-id "$cmd_id" --instance-id "$IID" 2>/dev/null || true
status="$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$IID" --query 'Status' --output text)"
aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$IID" --query 'StandardOutputContent' --output text

# Remove the secret-bearing bundle from S3 once it's on the box.
aws s3 rm "s3://${DEPLOY_BUCKET}/${KEY}" >/dev/null || true
echo "── sync status: $status (S3 copy removed) ──"
[ "$status" = "Success" ]
