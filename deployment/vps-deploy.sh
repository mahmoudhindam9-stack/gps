#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRACCAR_DIR="${ROOT_DIR}/deployment/traccar"
BACKEND_DIR="${ROOT_DIR}/backend"
NETWORK_NAME="velotrack-shared"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run this deployment script with sudo/root." >&2
  exit 1
fi

for command in docker node npm curl; do
  command -v "${command}" >/dev/null 2>&1 || { echo "Missing required command: ${command}" >&2; exit 1; }
done
docker compose version >/dev/null

echo "=== [1/7] Checking cloud Supabase configuration ==="
if [[ ! -f "${BACKEND_DIR}/.env" || ! -f "${TRACCAR_DIR}/.env" ]]; then
  echo "Missing backend/.env or deployment/traccar/.env. Copy the corresponding .env.example files and fill private values." >&2
  exit 1
fi
if ! grep -Fq 'https://ixazqslcmqjmndhiyhux.supabase.co' "${BACKEND_DIR}/.env"; then
  echo "backend/.env must point to the verified cloud Supabase project ixazqslcmqjmndhiyhux." >&2
  exit 1
fi
if grep -Fq 'wtbyarkiizmncjnuomti' "${BACKEND_DIR}/.env"; then
  echo "Stale Supabase project reference wtbyarkiizmncjnuomti found in backend/.env." >&2
  exit 1
fi

echo "=== [2/7] Ensuring shared Docker network '${NETWORK_NAME}' exists ==="
if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  docker network create --driver bridge "${NETWORK_NAME}" >/dev/null
fi

echo "=== [3/7] Verifying the complete Traccar 6.17.0 protocol inventory ==="
node "${TRACCAR_DIR}/verify-protocol-ports.mjs"

echo "=== [4/7] Adding firewall rules without resetting existing rules ==="
bash "${ROOT_DIR}/deployment/configure-firewall.sh"

echo "=== [5/7] Validating Docker Compose configurations ==="
docker compose --env-file "${TRACCAR_DIR}/.env" -f "${TRACCAR_DIR}/compose.yaml" config >/dev/null
docker compose --env-file "${BACKEND_DIR}/.env" -f "${BACKEND_DIR}/compose.yaml" config >/dev/null

echo "=== [6/7] Starting Traccar and VeloTrack backend ==="
(cd "${BACKEND_DIR}" && npm ci --omit=dev)
docker compose --env-file "${TRACCAR_DIR}/.env" -f "${TRACCAR_DIR}/compose.yaml" up -d
docker compose --env-file "${BACKEND_DIR}/.env" -f "${BACKEND_DIR}/compose.yaml" up -d

echo "=== [7/7] Verifying local health endpoints ==="
traccar_ok=false
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:8082/api/health >/dev/null; then traccar_ok=true; break; fi
  sleep 2
done
if [[ "${traccar_ok}" != true ]]; then echo "Traccar health check failed at 127.0.0.1:8082/api/health." >&2; exit 1; fi

backend_ok=false
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null; then backend_ok=true; break; fi
  sleep 2
done
if [[ "${backend_ok}" != true ]]; then echo "VeloTrack backend health check failed at 127.0.0.1:3000/api/v1/health." >&2; exit 1; fi

if command -v ss >/dev/null 2>&1; then
  if ss -H -lntup | grep -E '0\.0\.0\.0:(8082|3000|5432)|\[::\]:(8082|3000|5432)|\*:(8082|3000|5432)'; then
    echo "SECURITY ERROR: Traccar web/API 8082, backend 3000, or database 5432 appears bound publicly." >&2
    exit 1
  fi
fi

echo "VeloTrack backend and Traccar report healthy."
echo "GPS ingress: TCP/UDP 5001-5174 and 5176-5268; port 5175 is not assigned in Traccar 6.17.0."
echo "Traccar web/API remains loopback-only at 127.0.0.1:8082. Backend HTTPS is served by Caddy on 80/443."
