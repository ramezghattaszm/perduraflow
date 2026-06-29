#!/usr/bin/env bash
# Power the demo box OFF after a demo — the main cost lever (you then pay only EBS + EIP).
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth
id="$(instance_id)"
[ -n "$id" ] && [ "$id" != "None" ] || { echo "No instance tagged Name=$PERDURA_TAG_NAME found." >&2; exit 1; }
aws ec2 stop-instances --instance-ids "$id" >/dev/null
echo "Stopping $id… (data persists on the EBS volume + named docker volumes)."
aws ec2 wait instance-stopped --instance-ids "$id"
echo "✓ stopped."
