#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK_NAME="velotrack-shared"

echo "=== [1/6] Ensuring shared private Docker network '${NETWORK_NAME}' exists ==="
if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  docker network create --driver bridge "${NETWORK_NAME}"
  echo "Created Docker bridge network '${NETWORK_NAME}'."
else
  echo "Docker network '${NETWORK_NAME}' already exists."
fi

echo "=== [2/6] Attaching self-hosted Supabase services to '${NETWORK_NAME}' ==="
if [[ -n "${EXISTING_SUPABASE_COMPOSE_DIR:-}" && -f "${EXISTING_SUPABASE_COMPOSE_DIR}/docker-compose.yml" ]]; then
  docker compose \
    -f "${EXISTING_SUPABASE_COMPOSE_DIR}/docker-compose.yml" \
    -f "${ROOT_DIR}/deployment/supabase/compose.velotrack-shared.override.yaml" \
    up -d
else
  if [[ ! -f "${ROOT_DIR}/deployment/supabase/.env" ]]; then
    echo "ERROR: ${ROOT_DIR}/deployment/supabase/.env is missing." >&2
    exit 1
  fi
  docker compose --env-file "${ROOT_DIR}/deployment/supabase/.env" -f "${ROOT_DIR}/deployment/supabase/compose.yaml" config >/dev/null
  docker compose --env-file "${ROOT_DIR}/deployment/supabase/.env" -f "${ROOT_DIR}/deployment/supabase/compose.yaml" up -d
fi

echo "=== [3/6] Starting Traccar Server on '${NETWORK_NAME}' ==="
if [[ ! -f "${ROOT_DIR}/deployment/traccar/.env" ]]; then
  echo "ERROR: ${ROOT_DIR}/deployment/traccar/.env is missing." >&2
  exit 1
fi
docker compose --env-file "${ROOT_DIR}/deployment/traccar/.env" -f "${ROOT_DIR}/deployment/traccar/compose.yaml" config >/dev/null
docker compose --env-file "${ROOT_DIR}/deployment/traccar/.env" -f "${ROOT_DIR}/deployment/traccar/compose.yaml" up -d

echo "=== [4/6] Installing backend dependencies & starting VeloTrack API + HTTPS proxy ==="
if [[ ! -f "${ROOT_DIR}/backend/.env" ]]; then
  echo "ERROR: ${ROOT_DIR}/backend/.env is missing." >&2
  exit 1
fi
(cd "${ROOT_DIR}/backend" && npm ci --omit=dev)
docker compose --env-file "${ROOT_DIR}/backend/.env" -f "${ROOT_DIR}/backend/compose.yaml" config >/dev/null
docker compose --env-file "${ROOT_DIR}/backend/.env" -f "${ROOT_DIR}/backend/compose.yaml" up -d

echo "=== [5/6] Auditing public port bindings (8082 and 5432 must NOT be public) ==="
if ss -tulpn | grep -E '0\.0\.0\.0:(8082|5432)|\[::\]:(8082|5432)'; then
  echo "SECURITY ERROR: Port 8082 or 5432 is exposed on a public interface!" >&2
  exit 1
fi

echo "=== [6/6] Verifying VeloTrack Backend health on 127.0.0.1:3000 ==="
for i in {1..15}; do
  if curl -fsS http://127.0.0.1:3000/api/v1/health; then
    echo ""
    echo "VeloTrack Backend health check succeeded."
    exit 0
  fi
  sleep 2
done

echo "ERROR: VeloTrack Backend did not report healthy within timeout." >&2
exit 1
