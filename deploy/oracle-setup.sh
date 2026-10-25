#!/usr/bin/env bash
# Prepare a fresh Ubuntu VM (e.g. Oracle Cloud Always Free A1) to run docker-compose.prod.yml:
# installs Docker Engine + Compose plugin and opens 80/443 in the host firewall. Safe to re-run.
# Usage: sudo bash deploy/oracle-setup.sh
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# Let the login user run docker without sudo (takes effect on next login).
user="${SUDO_USER:-ubuntu}"
id "$user" >/dev/null 2>&1 && usermod -aG docker "$user"

# Oracle images ship iptables rules that reject everything but SSH. Insert ACCEPT rules
# before the first REJECT so they win, then persist them across reboots.
if command -v iptables >/dev/null 2>&1; then
  reject_at="$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')"
  for rule in "tcp 80" "tcp 443" "udp 443"; do
    set -- $rule
    if ! iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null; then
      if [ -n "$reject_at" ]; then iptables -I INPUT "$reject_at" -p "$1" --dport "$2" -j ACCEPT
      else iptables -A INPUT -p "$1" --dport "$2" -j ACCEPT; fi
    fi
  done
  apt-get install -y iptables-persistent
  netfilter-persistent save
fi

docker --version
docker compose version
cat <<EOF

VM ready. Next:
  1. Log out and back in so the docker group applies.
  2. Open ports 80 and 443 (TCP) plus 443 (UDP) in the Oracle VCN Security List.
  3. Point your DuckDNS subdomain at this VM's public IP.
  4. Follow docs/deployment.md from "First deploy".
EOF
