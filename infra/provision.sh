#!/usr/bin/env bash
# Provision the Perdura demo infrastructure in the thezmgroup account (idempotent).
# Creates: ECR repos, a private S3 deploy bucket, an SSM/ECR/S3 IAM instance role,
# a security group (80/443 only), a t4g.small EC2 (AL2023 arm64, SSM-managed), and
# an Elastic IP. Writes results to infra/.deploy-state. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
STATE_FILE="${INFRA_DIR:-$(pwd)}/.deploy-state"
SG_NAME="perdura-demo-sg"
ROLE_NAME="perdura-demo-ec2"
PROFILE_NAME="perdura-demo-ec2"
BUCKET="perdura-demo-deploy-${ACCOUNT_ID}"
INSTANCE_TYPE="t4g.small"
VOLUME_GB="20"
echo "Account ${ACCOUNT_ID} / region ${AWS_REGION}"

say() { echo "── $* ───────────────────────────────────────────"; }

# 1) ECR repos ────────────────────────────────────────────────────────────────
say "ECR repos"
for repo in perdura-api perdura-web; do
  aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "$repo" \
         --image-scanning-configuration scanOnPush=true >/dev/null
  echo "  ✓ $repo"
done

# 2) Private S3 deploy bucket (secret-safe file delivery) ──────────────────────
say "S3 deploy bucket: $BUCKET"
if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null
  fi
fi
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null
echo "  ✓ private + encrypted"

# 3) IAM role + instance profile (SSM + ECR read + S3 deploy read) ─────────────
say "IAM role: $ROLE_NAME"
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
aws iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null
aws iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly >/dev/null
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name perdura-deploy-s3-read \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:ListBucket\"],\"Resource\":[\"arn:aws:s3:::${BUCKET}\",\"arn:aws:s3:::${BUCKET}/*\"]}]}" >/dev/null
if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" >/dev/null
fi
echo "  ✓ role + instance profile"

# 4) Security group (default VPC), inbound 80/443 only ─────────────────────────
say "Security group: $SG_NAME"
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
SG_ID="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID="$(aws ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
    --description "Perdura demo: HTTP/HTTPS only; shell via SSM" --query GroupId --output text)"
fi
for port in 80 443; do
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port "$port" --cidr 0.0.0.0/0 >/dev/null 2>&1 || true
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port "$port" --ipv6-cidr ::/0 >/dev/null 2>&1 || true
done
echo "  ✓ $SG_ID (VPC $VPC_ID) — 80/443 open, no SSH"

# 5) Launch instance (if not already present) ─────────────────────────────────
say "EC2 instance ($INSTANCE_TYPE, AL2023 arm64)"
IID="$(instance_id)"
if [ -z "$IID" ] || [ "$IID" = "None" ]; then
  AMI_ID="$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query 'Parameter.Value' --output text)"
  echo "  AMI: $AMI_ID"
  # IAM eventual consistency: retry run-instances until the instance profile is usable.
  for attempt in 1 2 3 4 5 6; do
    IID="$(aws ec2 run-instances \
      --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
      --iam-instance-profile "Name=$PROFILE_NAME" \
      --security-group-ids "$SG_ID" \
      --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' \
      --block-device-mappings "[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":${VOLUME_GB},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
      --user-data "file://${INFRA_DIR:-$(pwd)}/user-data.sh" \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${PERDURA_TAG_NAME}}]" \
      --query 'Instances[0].InstanceId' --output text 2>/tmp/perdura-run-err)" && break
    echo "  run-instances attempt $attempt failed ($(tr -d '\n' </tmp/perdura-run-err | tail -c 160)); retrying in 10s..."; sleep 10
  done
  [ -n "$IID" ] && [ "$IID" != "None" ] || { echo "run-instances failed"; cat /tmp/perdura-run-err; exit 1; }
  echo "  launched $IID — waiting until running..."
  aws ec2 wait instance-running --instance-ids "$IID"
else
  echo "  ✓ reusing existing $IID"
fi

# 6) Elastic IP (allocate + associate) ────────────────────────────────────────
say "Elastic IP"
ALLOC_ID="$(aws ec2 describe-addresses --filters Name=tag:Name,Values="$PERDURA_TAG_NAME" --query 'Addresses[0].AllocationId' --output text 2>/dev/null || true)"
if [ -z "$ALLOC_ID" ] || [ "$ALLOC_ID" = "None" ]; then
  ALLOC_ID="$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${PERDURA_TAG_NAME}}]" \
    --query AllocationId --output text)"
fi
aws ec2 associate-address --instance-id "$IID" --allocation-id "$ALLOC_ID" >/dev/null
EIP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)"
echo "  ✓ $EIP → $IID"

# 7) Persist state ────────────────────────────────────────────────────────────
cat > "$STATE_FILE" <<EOF
ACCOUNT_ID=$ACCOUNT_ID
REGION=$AWS_REGION
INSTANCE_ID=$IID
ELASTIC_IP=$EIP
ALLOC_ID=$ALLOC_ID
SG_ID=$SG_ID
DEPLOY_BUCKET=$BUCKET
ECR_REGISTRY=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
EOF
echo
echo "✓ provisioned. State → $STATE_FILE"
echo "  Instance: $IID    Elastic IP: $EIP"
echo "  Next: point DNS (infra/dns.sh), build images (infra/build-and-push.sh), deploy (infra/deploy-files.sh)."
