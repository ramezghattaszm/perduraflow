#!/usr/bin/env bash
# One-command redeploy of the demo stack. Encodes the safe sequence + the two gotchas
# we hit by hand:
#   1. `docker image prune -f` BEFORE pulling — each redeploy adds a ~3GB image while the
#      old one is still held by the running container, so the 20GB disk fills otherwise.
#   2. `docker compose pull --quiet` — SSM caps command output at ~24KB; docker's noisy
#      layer-progress overruns it and the writer dies on SIGPIPE → the command "fails"
#      even though the pull was fine. Quiet output avoids it.
# Uses its own SSM poll (no premature timeout) so long pulls don't look like failures.
#
# Usage:
#   ./redeploy.sh                 # build+push BOTH images, prune, pull, migrate, up
#   ./redeploy.sh --seed          # ...and reseed the demo data at the end
#   ./redeploy.sh api             # only rebuild the api image (web|api)
#   ./redeploy.sh --no-build      # skip build (images already in ECR), just roll the box
#   ./redeploy.sh --no-migrate    # code-only change: skip migrations
#   flags compose: ./redeploy.sh web --no-migrate --seed
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth
STATE_FILE="$(pwd)/.deploy-state"
[ -f "$STATE_FILE" ] || { echo "No .deploy-state — run provision.sh first." >&2; exit 1; }
# shellcheck disable=SC1090
source "$STATE_FILE"

DO_BUILD=1 DO_MIGRATE=1 DO_SEED=0 TARGET=""
for a in "$@"; do
  case "$a" in
    --no-build) DO_BUILD=0 ;;
    --no-migrate) DO_MIGRATE=0 ;;
    --seed) DO_SEED=1 ;;
    api|web) TARGET="$a" ;;
    *) echo "unknown arg: $a" >&2; exit 1 ;;
  esac
done

IID="$(instance_id)"
[ -n "$IID" ] && [ "$IID" != "None" ] || { echo "No instance tagged Name=$PERDURA_TAG_NAME found." >&2; exit 1; }

# Run a command on the box via SSM and block until it really finishes (no premature timeout).
remote() {
  local desc="$1" cmd="$2" cid s
  cid="$(aws ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript \
    --comment "${desc:0:99}" \
    --parameters "commands=[\"cd /opt/perdura && $cmd\"]" \
    --query 'Command.CommandId' --output text)"
  echo "→ $desc"
  until s="$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$IID" --query 'Status' --output text 2>/dev/null)"; \
        [ -n "$s" ] && [ "$s" != InProgress ] && [ "$s" != Pending ]; do sleep 8; done
  local out; out="$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$IID" --query 'StandardOutputContent' --output text)"
  [ -n "$out" ] && echo "$out" | sed 's/^/    /'
  if [ "$s" != Success ]; then
    echo "  ✗ $desc → $s"
    aws ssm get-command-invocation --command-id "$cid" --instance-id "$IID" --query 'StandardErrorContent' --output text | tail -15 | sed 's/^/    /'
    exit 1
  fi
}

LOGIN="export AWS_REGION=${AWS_REGION} && aws ecr get-login-password | docker login --username AWS --password-stdin ${ECR_REGISTRY} >/dev/null 2>&1"

# 1) Build + push (on the Mac, native arm64) ──────────────────────────────────
if [ "$DO_BUILD" -eq 1 ]; then
  echo "══ build + push ${TARGET:-both} ══"
  ./build-and-push.sh ${TARGET:+$TARGET}
fi

# 2) Free disk, then pull the new images quietly ──────────────────────────────
remote "prune unused images" "docker image prune -f >/dev/null 2>&1 && df -h / | tail -1"
remote "pull new images" "$LOGIN && docker compose --env-file .env pull --quiet >/dev/null 2>&1 && echo pulled"

# 3) Migrate (new columns) then recreate the stack ────────────────────────────
if [ "$DO_MIGRATE" -eq 1 ]; then
  remote "migrate + up" "./migrate.sh && docker compose --env-file .env up -d 2>&1 | tail -1"
else
  remote "up (no migrate)" "docker compose --env-file .env up -d 2>&1 | tail -1"
fi

# 4) Optional reseed ──────────────────────────────────────────────────────────
if [ "$DO_SEED" -eq 1 ]; then
  remote "reseed demo data" "./reseed.sh 2>&1 | tail -3"
fi

# 5) Reclaim the now-unused old images + verify ───────────────────────────────
remote "prune replaced images" "docker image prune -f >/dev/null 2>&1 && df -h / | tail -1"
echo "══ verify ══"
api="$(curl -sS -m 20 https://perduraapi.thezmgroup.com/api/v1/health -o /dev/null -w '%{http_code}' || echo ERR)"
web="$(curl -sS -m 20 -L https://perdura.thezmgroup.com -o /dev/null -w '%{http_code}' || echo ERR)"
echo "  API health: $api   web: $web"
[ "$api" = 200 ] && [ "$web" = 200 ] && echo "✓ redeploy complete" || { echo "✗ post-deploy check failed"; exit 1; }
