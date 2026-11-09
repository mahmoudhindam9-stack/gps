# VeloTrack GPS

VeloTrack is an Android GPS fleet-management client. The tracking engine is provided by the official, self-hosted [Traccar Server](https://github.com/traccar/traccar). VeloTrack-specific customer, ownership, subscription and device-provisioning workflows belong in a separate authenticated backend.

## Current integration foundation

- Traccar Server deployment: `deployment/traccar/`
- GT06 protocol listener for Concox GT06N: TCP port `5023`
- Traccar REST/API and web UI: bound to loopback `127.0.0.1:8082` by default
- Traccar status events: enabled in `deployment/traccar/traccar.xml`
- Traccar telemetry database: dedicated TimescaleDB/PostgreSQL container and volume
- Permanent UI requirements: `docs/PRODUCT_UI_RULES.md`
- Android/backend completion instructions: `docs/GEMINI_COMPLETION_PROMPT.md`

**Important:** This foundation adds the real Traccar server deployment. It does not yet complete the Android-to-backend integration, VeloTrack subscription service, or bidirectional SMS gateway. The existing Android prototype must not be treated as production-ready until the remaining work in the handoff prompt is completed and tested.

## Start the Traccar server

On a Linux VPS with Docker Engine and the Docker Compose plugin:

```bash
cd deployment/traccar
cp .env.example .env
```

Edit `.env` and set a strong unique `TRACCAR_DB_PASSWORD`. You can generate one with:

```bash
openssl rand -hex 32
```

Validate and start:

```bash
docker compose config
docker compose up -d
docker compose ps
```

Check server health on the VPS:

```bash
curl --fail http://127.0.0.1:8082/api/health
```

The expected successful response is `OK`.

## Network and tracker setup

- Allow inbound **TCP 5023** in the VPS firewall for the GT06 protocol.
- Configure the physical GT06N with the VPS DNS name/IP and port `5023`, using the correct command syntax for its actual firmware.
- Do not expose Traccar's HTTP/API port `8082` or the database port publicly. Port `8082` is loopback-only in this Compose file.
- For temporary browser administration, use an SSH tunnel: `ssh -L 8082:127.0.0.1:8082 user@your-vps`, then open `http://127.0.0.1:8082` locally.
- Use HTTPS through a reverse proxy and a properly authenticated VeloTrack backend before enabling remote app access.

Traccar lists **Concox GT06N** under protocol `gt06` on port `5023`. This confirms protocol-family support, not the exact firmware's SMS command syntax or behavior. Test the physical tracker before marking any SMS profile as verified.

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
