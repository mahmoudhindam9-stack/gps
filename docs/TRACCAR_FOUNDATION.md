# Traccar Ecosystem Integration Foundation

## What this branch adds

This branch establishes a real, self-hostable Traccar Server deployment for VeloTrack:

- Pinned Traccar Server image: `traccar/traccar:6.17.0`.
- Dedicated TimescaleDB/PostgreSQL storage, separate from all VeloTrack business data.
- The Traccar API/web UI is bound to `127.0.0.1:8082`, not the public interface.
- All 267 non-zero default protocol listeners from the pinned Traccar 6.17.0 registry are published: TCP and UDP ports 5001–5174 and 5176–5268. Port 5175 is intentionally excluded.
- Traccar connection status events are enabled.
- Local secrets are supplied through an ignored `.env` file.

This is the server foundation, not the completed VeloTrack backend or Android integration. The Android prototype still contains mock behavior that must be removed before production use.

## Official universal compatibility baseline

The pinned upstream source is `traccar/traccar` tag `v6.17.0`, file `src/main/java/org/traccar/config/ProtocolConfig.java`.

- 268 protocol classes are registered.
- 267 classes have a non-zero inbound listener port.
- Inbound ports are 5001–5174 and 5176–5268. Port 5175 is not assigned.
- Orbcomm is registered with port 0 and has no standard inbound socket listener.
- The exact protocol-to-port mapping is maintained in `deployment/traccar/protocol-ports.json`.

Traccar's server code determines which protocols use TCP, UDP, or both. The ingress layer publishes both transports for the complete listener-port set; only the transport(s) implemented by a given Traccar protocol accept data. `traccar.xml` deliberately does not set a `protocols.enable` whitelist, so the full default protocol set remains enabled.

This is complete coverage of the network listener registry shipped in Traccar 6.17.0, not a guarantee for every proprietary clone or firmware variant. Exact device/firmware compatibility still requires protocol identification and real packet tests.

## Target VeloTrack architecture

### 1. Traccar Server — GPS engine

Traccar must be the source of truth for:
- Protocol socket ingestion and IMEI identification.
- Tracker connection state.
- Live positions, speed, heading, ignition and timestamps when supplied by device/protocol.
- GPS history and route reports.

Do not directly read or write the Traccar database from VeloTrack application code. Use the official REST/WebSocket API.

### 2. VeloTrack backend — business engine

The current Android repository has Room entities for profiles, devices, users, subscriptions, activation SMS logs, ownership history and cached routes, but it currently simulates server behavior. Move authoritative business state into a server-side VeloTrack API and database.

Retain the agreed business features:
- Customer accounts and admin permissions.
- Per-device customer ownership and reassignment, with immutable audit history.
- Per-device plans: 1, 3, 6, 12 months and lifetime.
- Subscription status: awaiting first connection, active, expired and suspended.
- Start the subscription clock only after the backend observes a real first Traccar connection for the registered IMEI.
- Enforce expiration on the server/API and live streams, not only in Android UI timers.
- Admin override only with an authenticated admin identity and a required audit reason.
- Versioned SMS profiles keyed by manufacturer, exact model, and firmware revision.
- Activation audit logs preserving the exact command, gateway job/message ID, actual delivery state, actual received reply, timestamps and failures.

Keep Traccar GPS tables and VeloTrack business tables in separate databases or clearly separated database services/schemas. Traccar owns its internal schema. Do not let application code mutate `tc_devices`, `tc_positions`, or other Traccar internal tables.

Use one real authentication authority. Reuse the project's intended Supabase Auth/JWT configuration only if it is genuinely configured and deployed; otherwise ask for the required environment/deployment values rather than inventing them. Validate JWT signatures, issuer, audience, expiry, role and tenant scope on the backend. Never trust client-supplied role headers or customer IDs as authorization. A Supabase service-role key must never be used for customer-scoped requests.

### 3. Android app — VeloTrack client

Preserve the current Kotlin/Jetpack Compose visual design where useful, but replace its mock data source with the authenticated VeloTrack backend.

The Android app must:
- Load users/customers, profiles, devices, subscriptions, positions, logs and history from real server responses.
- Cache received real records locally in Room for offline viewing.
- Never generate fake devices, random Traccar IDs, Cairo placeholder coordinates, routes, speeds, headings, JSESSIONID values, fake SMS replies, or fake online statuses.
- Never default to sample users, customers, IMEIs, SIM numbers, or selected device IDs.
- Show no map marker until a real coordinate has been received.
- Show the disconnected/unknown state honestly when the server cannot be reached.
- Never show a success state until the backend confirms the operation.
- Never ship Traccar administrator credentials, Supabase service-role credentials, or GSM gateway secrets in the APK.

Do not use the local Room cache as the authoritative subscription or permission engine. The backend is authoritative; Room is a cache.

### 4. SMS and device activation

The Traccar SMS Gateway Android project is an optional outbound SMS transport. Its HTTP API does not constitute the full bidirectional SMS provisioning workflow required by VeloTrack. Do not mark a message as delivered or replied merely because an HTTP request was accepted.

Implement a provider-independent SMS adapter that can communicate with a private GSM modem/gateway and receive inbound SMS/replies and delivery reports where the hardware/carrier actually supports them. The backend must distinguish at least:
- queued,
- accepted by gateway,
- sent,
- delivered (only when a real delivery report is received),
- replied (only when the real inbound message is received),
- failed,
- timed out.

Keep the agreed activation policy:
- No APN commands.
- No automatic TIMER modification.
- Send only firmware-profile commands that are explicitly verified for the exact device/firmware.
- The standard `SERVER` command and optional `GPRSON,1#` must remain configurable per profile; do not hard-code assumed firmware behavior or mark untested profiles as verified.
- SMS success is not device activation.
- Device activation and subscription start occur only after a real Traccar connection/packet is correlated to the registered IMEI.
- Test no-GPS-fix login/heartbeat separately from full satellite GPS fix.

Never claim a physical tracker, SIM, carrier delivery report, or SMS reply has been tested unless it was actually tested.

## Official ecosystem references

- Server: https://github.com/traccar/traccar
- Web client: https://github.com/traccar/traccar-web
- Current mobile manager: https://github.com/traccar/traccar-manager
- Optional Android SMS transport: https://github.com/traccar/traccar-sms-gateway
- API documentation: https://www.traccar.org/traccar-api/
- Docker deployment: https://www.traccar.org/docker/
- Supported device list: https://www.traccar.org/devices/

The Traccar Server and official web/mobile projects have their own license files. Verify the exact license and notices for every dependency before copying source code. Keep the SMS Gateway project separate unless its GPL-3.0 obligations have been reviewed for the intended distribution.

## Operational security

- Do not expose Traccar port `8082` or the database port to the public internet.
- Publish the Traccar 6.17.0 listener ranges TCP/UDP 5001–5174 and 5176–5268; do not publish 8082 or 5432.
- Put the backend behind HTTPS and a restrictive firewall/reverse proxy.
- Use strong, unique database passwords and never commit `.env`.
- Back up both Traccar telemetry data and VeloTrack business data; test restoration.
- Pin and review container image versions/digests before production upgrades.
