#!/usr/bin/env bash
# Optional: forward the instance's Postgres (container, published on the host) to
# localhost:5433 via SSM, for ad-hoc inspection from the Mac. Requires the Session
# Manager plugin. Ctrl-C to close.  Then:  psql postgresql://perdura:<pw>@localhost:5433/perdura
#
# The compose db service publishes Postgres on the instance's loopback only
# (127.0.0.1:5432 — host-local, never public), which this tunnel reaches.
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth
id="$(instance_id)"
[ -n "$id" ] && [ "$id" != "None" ] || { echo "No instance tagged Name=$PERDURA_TAG_NAME found." >&2; exit 1; }
echo "Forwarding instance 127.0.0.1:5432 → localhost:5433  (Ctrl-C to stop)..."
exec aws ssm start-session --target "$id" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["127.0.0.1"],"portNumber":["5432"],"localPortNumber":["5433"]}'
