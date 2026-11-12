# VeloTrack GPS v1.3.0-rc1 — Installation & VPS Deployment Guide

## 1. Prerequisites
- A Linux VPS (Ubuntu 22.04/24.04 LTS or Debian 12 recommended) with a static public IPv4 address.
- Docker Engine (`docker`) and Docker Compose plugin (`docker compose`).
- Node.js 22+ (`node` and `npm`), `curl`, and `ufw` or `firewalld`.
- Public DNS `A` record for the backend HTTPS reverse proxy (e.g., `api.<your-domain>`) pointing to the VPS IPv4 address.
- Verified Cloud Supabase Project: `ixazqslcmqjmndhiyhux` (`https://ixazqslcmqjmndhiyhux.supabase.co`).
  - Do **not** deploy a second self-hosted Supabase stack.

## 2. Docker Userland Proxy Preparation (Before Opening Wide Port Range)
Publishing TCP and UDP ports `5001–5174` and `5176–5268` (534 port bindings) can spawn one `docker-proxy` process per port if Docker's userland proxy is enabled. Per official Traccar Docker guidance (https://www.traccar.org/docker/):
1. Inspect `/etc/docker/daemon.json` if it exists.
2. Merge `"userland-proxy": false` into the existing JSON object without overwriting unrelated settings (see `deployment/docker-daemon.json.example`).
3. Validate the JSON syntax: `jq . /etc/docker/daemon.json`.
4. During a scheduled maintenance window, restart Docker (`sudo systemctl restart docker` — note that this interrupts all running containers on the host) and verify running workloads.

## 3. Configure Environment Files

### A. Traccar Telemetry Stack (`deployment/traccar/.env`)
```bash
cp deployment/traccar/.env.example deployment/traccar/.env
```
Set a strong, unique `TRACCAR_DB_PASSWORD` (e.g., `openssl rand -hex 32`). Keep `TRACCAR_IMAGE=traccar/traccar:6.17.0` and `GPS_INGRESS_BIND_ADDRESS=0.0.0.0`.

### B. VeloTrack Backend (`backend/.env`)
```bash
cp backend/.env.example backend/.env
```
Populate the following required values in `backend/.env` (never commit `backend/.env`):
- `VELOTRACK_API_DOMAIN=<your-backend-https-domain>`
- `CORS_ALLOWED_ORIGINS=https://velotrack-web.vercel.app`
- `SUPABASE_URL=https://ixazqslcmqjmndhiyhux.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=sb_publishable_8d2LOE7xILs6dxP7K2TKaw_9hCc8BP_`
- `SUPABASE_SECRET_KEY=<your-sb_secret-or-service-role-key>`
- `SUPABASE_JWT_SECRET=<random-32+-byte-secret-for-velotrack-jwt>`
- `SUPABASE_DB_URL=<full-postgresql-uri-from-supabase-connect-dialog>`
- `SUPABASE_DB_SSL=true`
- `VELOTRACK_INITIAL_ADMIN_EMAIL=mahmoud.hindam9@gmail.com`
- `VELOTRACK_INITIAL_ADMIN_USERNAME=admin`
- `VELOTRACK_INITIAL_ADMIN_PASSWORD=<temporary-initial-admin-password>`
- `TRACCAR_BASE_URL=http://traccar:8082`
- `TRACCAR_ADMIN_EMAIL=<traccar-admin-email>`
- `TRACCAR_ADMIN_PASSWORD=<traccar-admin-password>`
- `TRACCAR_PUBLIC_URL=<optional-https-traccar-origin-for-share-links>`

## 4. Deploy & Verify on the VPS
From the repository root:
```bash
sudo ./deployment/vps-deploy.sh
```
This script:
1. Verifies `backend/.env` points to `https://ixazqslcmqjmndhiyhux.supabase.co` and contains no stale project references.
2. Creates the shared private bridge network `velotrack-shared`.
3. Runs `node deployment/traccar/verify-protocol-ports.mjs` to verify all 267 Traccar 6.17.0 network listeners (`5001–5174` and `5176–5268`, excluding `5175`).
4. Applies additive firewall rules via `deployment/configure-firewall.sh` without resetting existing rules.
5. Validates `deployment/traccar/compose.yaml` and `backend/compose.yaml` with `docker compose config`.
6. Starts both stacks and verifies `http://127.0.0.1:8082/api/health` and `http://127.0.0.1:3000/api/v1/health`.
7. Verifies via `ss -H -lntup` that ports `8082`, `3000`, and `5432` are **not** bound publicly.

## 5. Cloud / Provider Network Firewall Rules
In your VPS provider's cloud firewall / security group, allow inbound:
- **TCP:** `80`, `443`, `5001–5174`, `5176–5268`
- **UDP:** `5001–5174`, `5176–5268`
- **Do NOT open:** `5175`, `8082`, `3000`, or `5432`.
