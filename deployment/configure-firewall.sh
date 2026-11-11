#!/usr/bin/env bash
set -euo pipefail

# Opens only the VeloTrack ingress ranges and the HTTPS reverse-proxy ports.
# This script never flushes or resets an existing firewall.

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run with sudo/root so firewall rules can be added." >&2
  exit 1
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  for port in 80 443; do
    ufw allow "${port}/tcp" comment "VeloTrack HTTPS reverse proxy"
  done
  for range in 5001:5174 5176:5268; do
    ufw allow "${range}/tcp" comment "VeloTrack Traccar 6.17.0 TCP ingress"
    ufw allow "${range}/udp" comment "VeloTrack Traccar 6.17.0 UDP ingress"
  done
  echo "Added VeloTrack rules to active UFW. Existing rules were not removed."
  exit 0
fi

if command -v firewall-cmd >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  for port in 80/tcp 443/tcp 5001-5174/tcp 5001-5174/udp 5176-5268/tcp 5176-5268/udp; do
    firewall-cmd --permanent --add-port="${port}"
  done
  firewall-cmd --reload
  echo "Added VeloTrack rules to active firewalld. Existing rules were not removed."
  exit 0
fi

cat <<'NOTICE'
No active UFW/firewalld instance was detected; no host firewall was changed.
Ensure the VPS/provider network firewall allows:
  TCP 80, 443
  TCP 5001-5174 and 5176-5268
  UDP 5001-5174 and 5176-5268
Do NOT expose TCP 8082, TCP 3000, or TCP 5432.
NOTICE
