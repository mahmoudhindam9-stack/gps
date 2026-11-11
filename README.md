# VeloTrack GPS

VeloTrack is an Android GPS fleet-management client. The tracking engine is provided by the official, self-hosted [Traccar Server](https://github.com/traccar/traccar). VeloTrack-specific customer, ownership, subscription and device-provisioning workflows belong in a separate authenticated backend.

## Current integration foundation

- Traccar Server is pinned to 6.17.0 in `deployment/traccar/`.
- The official 6.17.0 protocol registry contains 268 protocol classes: 267 non-zero network listeners plus Orbcomm (port 0, no inbound listener).
- Default device listener ports are 5001–5174 and 5176–5268; TCP and UDP ingress are published for the range. Port 5175 is intentionally excluded.
- The full protocol-to-default-port inventory is `deployment/traccar/protocol-ports.json`.
- Traccar web/API port 8082 is loopback-only; the telemetry database port 5432 is private.
- Traccar status events are enabled in `deployment/traccar/traccar.xml`.
- The Traccar telemetry database is separate from the verified cloud Supabase business database.
- VeloTrack backend and Traccar share the private Docker network `velotrack-shared`.
- Android/backend completion instructions: `docs/GEMINI_COMPLETION_PROMPT.md`.

**Compatibility boundary:** this config exposes the complete set of network listeners built into Traccar 6.17.0. It does not promise that every proprietary clone or firmware variant is compatible; the exact device protocol and packet decoding still require validation.

## Start the VeloTrack VPS stack

On a Linux VPS with Docker Engine, Docker Compose, Node.js/npm, curl, and an OS/provider firewall:

1. Copy `deployment/traccar/.env.example` to `deployment/traccar/.env` and set a unique long `TRACCAR_DB_PASSWORD`.
2. Copy `backend/.env.example` to `backend/.env`. Keep the verified Supabase URL and populate the private Supabase secret key, PostgreSQL connection URI, application JWT secret, and Traccar administrator credentials through the server secret store or the ignored `.env` file.
3. Run from the repository root: `sudo ./deployment/vps-deploy.sh`.
4. Check the containers with `docker compose --env-file deployment/traccar/.env -f deployment/traccar/compose.yaml ps` and `docker compose --env-file backend/.env -f backend/compose.yaml ps`.
5. The deploy script verifies the protocol manifest, validates both Compose files, applies additive firewall rules where UFW/firewalld is active, and checks Traccar and backend health endpoints.

Do not deploy a second self-hosted Supabase stack. The backend connects to the already verified cloud project `ixazqslcmqjmndhiyhux`.

## Docker userland proxy (important for the large port range)

Publishing hundreds of TCP/UDP ports can spawn one `docker-proxy` process per published port when Docker's userland proxy is enabled. Traccar's official Docker guidance recommends disabling it for this port-range deployment to reduce memory use and connection-related issues:

https://www.traccar.org/docker/

The example fragment is in `deployment/docker-daemon.json.example`. Before production deployment:

1. Inspect the existing `/etc/docker/daemon.json` (if it exists).
2. Merge the key `"userland-proxy": false` into the existing JSON object. Do not overwrite unrelated Docker settings or copy the example over an existing file.
3. Validate the JSON and schedule a maintenance window. Restarting Docker with `sudo systemctl restart docker` interrupts running containers; restart the VeloTrack Compose stacks afterward.
4. Verify the setting and running containers before opening the GPS ingress firewall ranges.

The automated deployment script intentionally does not rewrite the global Docker daemon configuration or restart Docker because that can affect unrelated workloads on the VPS.

## Network and tracker setup

- Open TCP 80/443 for the Caddy HTTPS reverse proxy.
- Open TCP and UDP 5001–5174 and 5176–5268 in both the VPS OS firewall and the cloud/provider network firewall.
- Do not open 5175; no protocol listener uses it in the pinned Traccar 6.17.0 registry.
- Do not expose Traccar web/API port 8082, backend port 3000, or database port 5432 publicly. The Traccar host binding remains `127.0.0.1:8082` and its database has no public port mapping.
- Configure each GPS tracker with its matching protocol's default port from `deployment/traccar/protocol-ports.json`; confirm its protocol in https://www.traccar.org/devices/.
- For Concox GT06/GT06N the protocol is `gt06`, port 5023. Other device families use their own ports.
- Do not infer UDP reachability from a TCP test. Verify real packets and decoded positions for each representative device family.

See `deployment/traccar/UNIVERSAL-DEVICE-SUPPORT.md` for the protocol inventory, ingress ranges, and validation procedure.

## Source-of-truth rules

1. Traccar owns GPS device protocol ingestion, live positions, device online/offline state, and GPS history.
2. Never write directly to Traccar's internal `tc_*` tables. Use its documented API.
3. VeloTrack business data (customers, ownership, subscription plans, SMS profile versions, activation audit) must be stored by the VeloTrack backend in its own database/schema.
4. The subscription clock starts only after the backend confirms the first real Traccar connection for the registered IMEI. SMS queued/sent/delivered/replied is not activation.
5. No mock users, devices, locations, routes, fake JSESSIONID values, synthetic SMS delivery, or simulated live movement in production.
6. Never ship Traccar admin credentials, Supabase service-role keys, or SMS-gateway secrets in the Android APK.

## Official ecosystem

- [Traccar Server](https://github.com/traccar/traccar) — tracking/protocol engine and REST/WebSocket API.
- [Traccar Web](https://github.com/traccar/traccar-web) — official browser UI source.
- [Traccar Manager](https://github.com/traccar/traccar-manager) — current official Flutter mobile client; use as an API/behavior reference if retaining the native Kotlin app.
- [Traccar SMS Gateway](https://github.com/traccar/traccar-sms-gateway) — outbound SMS transport only; it is not a complete two-way provisioning/audit service. Keep its GPL-3.0 licensing separate and review it before redistributing or linking code.

See `docs/TRACCAR_FOUNDATION.md` and `docs/GEMINI_COMPLETION_PROMPT.md` before implementing the remaining integration.


## Web dashboard

The VeloTrack web dashboard is included in `web/` on the `feature/web-dashboard-integrated` branch.

- Frontend: `web/src/`
- Local development: `cd web && npm install && npm run dev`
- Production build: `cd web && npm run build`
- Static output: `web/dist/`
- Configure `web/.env` with the public backend origin using `VITE_API_BASE_URL`.

The browser talks to the VeloTrack Backend API only. Never put Supabase service-role keys, PostgreSQL credentials, JWT signing secrets, or Traccar administrator credentials in this frontend.
