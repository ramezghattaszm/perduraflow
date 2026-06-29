#!/usr/bin/env bash
# Shared config + helpers for the Perdura demo AWS scripts. Source this:  source aws-env.sh
# Pins the account profile + region so nothing ever touches the default/eqall-deploy account.
export AWS_PROFILE="${AWS_PROFILE:-zmgroup}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

# Tag used to find the demo instance (set at launch: Name=perdura-demo).
export PERDURA_TAG_NAME="${PERDURA_TAG_NAME:-perdura-demo}"

# Echo the instance id of the demo box (most recent non-terminated match). Empty if none.
instance_id() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=${PERDURA_TAG_NAME}" \
              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'sort_by(Reservations[].Instances[], &LaunchTime)[-1].InstanceId' \
    --output text 2>/dev/null
}

# Fail early with a clear message if SSO creds are missing/expired.
require_auth() {
  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "AWS auth missing/expired for profile '$AWS_PROFILE'. Run:  aws sso login --profile $AWS_PROFILE" >&2
    exit 1
  fi
}
