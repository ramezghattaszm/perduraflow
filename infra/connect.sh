#!/usr/bin/env bash
# Open an interactive shell on the demo instance via SSM Session Manager (no SSH, no port 22).
# Requires the Session Manager plugin:  https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth
id="$(instance_id)"
[ -n "$id" ] && [ "$id" != "None" ] || { echo "No instance tagged Name=$PERDURA_TAG_NAME found." >&2; exit 1; }
echo "Connecting to $id ($PERDURA_TAG_NAME)... (the app lives in /opt/perdura)"
exec aws ssm start-session --target "$id"
