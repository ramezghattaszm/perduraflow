#!/usr/bin/env bash
# Build the API + web images for linux/arm64 (Graviton t4g) on the Mac and push to ECR.
# Native on Apple Silicon — no emulation. Run from anywhere; paths are resolved here.
#   infra/build-and-push.sh                 # builds + pushes both, tag "latest"
#   IMAGE_TAG=v2 infra/build-and-push.sh     # custom tag
#   infra/build-and-push.sh api              # just the api image
set -euo pipefail
cd "$(dirname "$0")"; source ./aws-env.sh
require_auth
INFRA_DIR="$(pwd)"
REPO_ROOT="$(cd .. && pwd)"
IMAGE_TAG="${IMAGE_TAG:-latest}"
WEB_API_URL="${NEXT_PUBLIC_API_URL:-https://perduraapi.thezmgroup.com/api/v1}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
echo "Registry: $REGISTRY   tag: $IMAGE_TAG   arch: linux/arm64"

# ECR auth for docker.
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"

want="${1:-both}"

build_push() {
  local name="$1" dockerfile="$2"; shift 2
  echo "── building perdura-${name} ───────────────────────────"
  docker buildx build \
    --platform linux/arm64 \
    -f "${INFRA_DIR}/${dockerfile}" \
    -t "${REGISTRY}/perdura-${name}:${IMAGE_TAG}" \
    "$@" \
    --push \
    "$REPO_ROOT"
}

if [ "$want" = "both" ] || [ "$want" = "api" ]; then
  build_push api api.Dockerfile
fi
if [ "$want" = "both" ] || [ "$want" = "web" ]; then
  build_push web web.Dockerfile --build-arg "NEXT_PUBLIC_API_URL=${WEB_API_URL}"
fi

echo "✓ pushed to ${REGISTRY} (tag ${IMAGE_TAG})"
