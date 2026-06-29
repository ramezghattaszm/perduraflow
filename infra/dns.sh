#!/usr/bin/env bash
# UPSERT the two A records (perdura, perduraapi → Elastic IP) in the thezmgroup.com
# public hosted zone. TTL 60 so it propagates fast for the demo. Idempotent.
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth
STATE_FILE="$(pwd)/.deploy-state"
[ -f "$STATE_FILE" ] || { echo "No .deploy-state — run provision.sh first." >&2; exit 1; }
# shellcheck disable=SC1090
source "$STATE_FILE"
[ -n "${ELASTIC_IP:-}" ] || { echo "No ELASTIC_IP in state." >&2; exit 1; }

ZONE_ID="$(aws route53 list-hosted-zones --query "HostedZones[?Name=='thezmgroup.com.'].Id | [0]" --output text | sed 's#/hostedzone/##')"
[ -n "$ZONE_ID" ] && [ "$ZONE_ID" != "None" ] || { echo "thezmgroup.com zone not found." >&2; exit 1; }
echo "Zone $ZONE_ID  →  perdura/perduraapi = $ELASTIC_IP"

change_batch() {
  local fqdn="$1"
  cat <<JSON
{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"${fqdn}","Type":"A","TTL":60,"ResourceRecords":[{"Value":"${ELASTIC_IP}"}]}}]}
JSON
}

for host in perdura perduraapi; do
  cid="$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --change-batch "$(change_batch "${host}.thezmgroup.com.")" \
    --query 'ChangeInfo.Id' --output text)"
  echo "  ✓ ${host}.thezmgroup.com  (change $cid)"
done
echo "DNS upserted. Caddy can issue certs once these resolve to the box."
