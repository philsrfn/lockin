#!/usr/bin/env bash
# One-time server setup. Works on any fresh Ubuntu 22.04+/Debian 12+ VPS —
# Hetzner, netcup, DigitalOcean, Vultr, Scaleway, IONOS. Nothing here is
# provider-specific.
#
#
#   scp deploy/provision.sh root@YOUR_IP:/tmp/
#   ssh root@YOUR_IP 'bash /tmp/provision.sh'
#
# Idempotent — safe to run again.

set -euo pipefail

echo "==> updating"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "==> docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> firewall"
# Only SSH and the two web ports. Postgres and the API are on the docker
# network and must never be reachable from outside.
apt-get install -y -qq ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> ssh hardening"
# Key-only auth. Every provider installs your public key at create time.
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd

echo "==> unattended security updates"
apt-get install -y -qq unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> app directory"
mkdir -p /opt/lockin

echo
echo "Done. Docker $(docker --version | cut -d' ' -f3 | tr -d ,), firewall on, password auth off."
echo "Next: run deploy/deploy.sh from your laptop."
