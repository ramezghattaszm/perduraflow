#!/usr/bin/env bash
# EC2 cloud-init (Amazon Linux 2023, arm64). Installs Docker + the compose plugin,
# enables Docker, and creates /opt/perdura. The SSM agent ships preinstalled on AL2023.
# Deploy files (compose, Caddyfile, .env, scripts) are delivered separately by
# infra/deploy-files.sh (via the private S3 deploy bucket).
set -euxo pipefail

dnf update -y
dnf install -y docker
systemctl enable --now docker

# docker compose v2 plugin (arm64).
mkdir -p /usr/libexec/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64" \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

# Let ec2-user (and SSM sessions, which land as ssm-user) use docker without sudo.
usermod -aG docker ec2-user || true

mkdir -p /opt/perdura
chown root:root /opt/perdura

echo "perdura cloud-init complete" > /opt/perdura/.bootstrap-ok
