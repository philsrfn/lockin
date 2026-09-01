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

export DEBIAN_FRONTEND=noninteractive

echo "==> waiting for cloud-init/unattended-upgrades to release apt"
# A freshly created droplet is usually mid-way through its own first-boot apt
# run. Racing it fails with a dpkg lock error that looks alarming and is not.
for _ in $(seq 1 120); do
  if ! fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
command -v cloud-init >/dev/null && cloud-init status --wait >/dev/null 2>&1 || true

echo "==> updating"
apt-get update -qq
apt-get upgrade -y -qq

echo "==> swap"
# A 1GB droplet will OOM part-way through `npm ci` inside the image build, and
# the failure looks like an unrelated compiler crash. 2GB of swap costs a little
# disk and removes the whole class of problem.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Prefer RAM; use swap as a safety net rather than routinely.
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

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
# Cloud images drop overrides in here that re-enable password auth.
for extra in /etc/ssh/sshd_config.d/*.conf; do
  [ -e "$extra" ] || continue
  sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$extra"
done
sshd -t   # refuse to reload a config that would lock us out
# Ubuntu 24.04 uses socket activation, so ssh.service may not be running at all.
systemctl reload ssh 2>/dev/null \
  || systemctl reload sshd 2>/dev/null \
  || systemctl restart ssh 2>/dev/null \
  || true

echo "==> unattended security updates"
apt-get install -y -qq unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> app directory"
mkdir -p /opt/lockin

echo
echo "Done. Docker $(docker --version | cut -d' ' -f3 | tr -d ,), firewall on, password auth off."
echo "Next: run deploy/deploy.sh from your laptop."
