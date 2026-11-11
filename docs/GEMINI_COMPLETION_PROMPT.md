# Gemini Task — Complete the VeloTrack GPS Traccar Integration

You are continuing from the current `main` branch of `mahmoudhindam9-stack/gps`.

The universal Traccar ingress change was already merged into `main` in Pull Request #5. The feature branch name in older task notes is historical only. Start from the imported current `main` source and do not recreate or revert the already-merged work.

The Traccar deployment foundation has already been added in:
- `deployment/traccar/compose.yaml`
- `deployment/traccar/traccar.xml`
- `deployment/traccar/.env.example`
- `deployment/traccar/protocol-ports.json`
- `deployment/traccar/verify-protocol-ports.mjs`
- `deployment/traccar/UNIVERSAL-DEVICE-SUPPORT.md`
- `deployment/vps-deploy.sh`
- `deployment/configure-firewall.sh`
- `docs/TRACCAR_FOUNDATION.md`
- `docs/PRODUCT_UI_RULES.md`

Read these files first. Do not replace them with a new architecture or revert the current `main` branch.

## Goal

Finish the real VeloTrack system using the official Traccar ecosystem as the GPS engine while preserving the existing Kotlin/Jetpack Compose app design wherever useful. This is a production integration task, not a prototype or UI-only task.

Official sources:
- https://github.com/traccar/traccar
- https://github.com/traccar/traccar-web
- https://github.com/traccar/traccar-manager
- https://github.com/traccar/traccar-sms-gateway
- https://www.traccar.org/traccar-api/
- https://www.traccar.org/devices/

Do not blindly copy the Flutter Manager app over the existing native Kotlin app. Use official Traccar implementations/API behavior as references and integrate the existing Kotlin UI with real services. If the native app cannot be completed safely without a larger migration, explain the blocker and propose the smallest safe migration.

## Critical existing-code defects to remove

Inspect the current repository and remove every production fake/mock/simulation path, including:
- `seedInitialDataIfNeeded()` and all automatic sample users, customers, device profiles, devices, subscriptions, SMS logs, route history and positions.
- Any random Traccar device ID generation.
- Cairo/Giza/Alexandria placeholder coordinates or any random coordinates.
- `updateActiveVehiclePositionsInline()` and all synthetic movement, speed, heading, ignition or last-seen updates.
- Fake session-cookie/JSESSIONID generation and fake reconnect-success flows.
- Simulated SMS sent/delivered/replied states, random gateway message IDs and fabricated `OK` replies.
- UI controls that simulate GPS packets, confirm GPS fixes, fake device connections, or schedule a demo five-second expiry.
- Generated test IMEIs and sample form defaults.
- Local role switching or hard-coded admin/customer identities presented as authentication.
- Custom headers such as `X-Supabase-RLS-Role`, `X-Supabase-JWT-Sub` or `X-VeloTrack-Role` being treated as proof of identity/authorization.
- Any screen that reports connected/online/activated before a real backend/Traccar confirmation.

Test fixtures may exist only inside isolated automated tests and must never seed an app installation or production database.

The production app must start with an empty database and an empty device list. It must show no map markers until real coordinates are received. Keep the UI visually polished without inventing filler content.

## Integration requirements

### A. Traccar Server

Use the real self-hosted Traccar deployment added to this branch. The pinned version is 6.17.0.

Universal device protocol support is mandatory:
- Use the official Traccar 6.17.0 protocol registry, not a GT06-only configuration.
- The registry has 268 protocol classes: 267 non-zero network listeners plus Orbcomm (port 0, no inbound listener).
- The exact port map is `deployment/traccar/protocol-ports.json`.
- The full inbound port set is TCP and UDP 5001–5174 and 5176–5268. Port 5175 is intentionally unassigned.
- Do not add a `protocols.enable` whitelist or disable protocols to reduce resource usage.
- Keep the Traccar web/API on 127.0.0.1:8082 and the telemetry database private.
- Use the matching default port for each device protocol and preserve device IMEI/unique-ID correlation.
- Do not claim compatibility for an unknown clone or firmware without identifying its protocol and testing a real packet.

Use Traccar's documented REST API and WebSocket:
- Authenticate through a real Traccar account/session or backend service credentials.
- WebSocket authentication must use a valid server-issued session cookie; never manufacture a JSESSIONID.
- Handle authentication failure, network loss, reconnect with bounded exponential backoff, and state reconciliation after reconnect.
- Load actual registered devices, positions and status from Traccar.
- Fetch route history from the Traccar API using correct ISO-8601 date/time parameters and correlate it to VeloTrack device records.
- Do not query or mutate Traccar internal database tables directly.
- Do not expose a Traccar admin token/password in Android or client-side code.

Railway is only a temporary web/API and OsmAnd smoke-test environment. The all-protocol TCP/UDP ingress in `deployment/traccar/compose.yaml` is the VPS deployment target; do not claim Railway's single exposed TCP listener replaces it.

### B. VeloTrack backend and business database

The Android app currently has local Room entities but no completed production backend. Implement the missing secure backend rather than pretending the Retrofit route declarations are a working service.

Use a clear server-side API for:
- login/session,
- admin/customer accounts,
- device profiles and firmware revisions,
- device activation,
- device/customer assignment,
- subscription creation, renewal, suspension and expiry,
- activation/SMS audit history,
- route/history access and customer-authorized live updates.

Keep Traccar telemetry data separate from VeloTrack business records. Traccar is the source of truth for GPS protocol and positions; VeloTrack is the source of truth for customers, device ownership, plans, and provisioning audit.

Use one real authentication authority. Reuse Supabase Auth/JWT only if the required configuration actually exists. Validate tokens server-side and apply tenant authorization server-side. Never trust a role, user ID, or customer ID merely because Android sends it in a header/body. Do not use a Supabase service-role key for customer-facing queries. If required backend credentials or deployment targets are unavailable, stop at an explicit configuration boundary and report the exact missing environment variables; never insert fake credentials.

### C. Actual activation and SMS

Implement a provider-independent SMS interface and a real bidirectional GSM gateway adapter. The existing Traccar SMS Gateway can be considered for outbound transport only; do not assume it handles inbound replies, delivery reports, firmware command profiles, or VeloTrack activation auditing.

Maintain these rules:
- No APN commands.
- No automatic TIMER commands or reporting-interval changes.
- SERVER command syntax and any optional GPRSON command must be stored in versioned profiles for the exact manufacturer/model/firmware.
- Profiles must default to unverified. Do not mark GT06N firmware commands as verified without physical testing.
- Log a message as sent/delivered/replied only after the relevant real gateway/carrier/inbound event is received.
- A submitted SMS request or an HTTP 200 from the gateway is not proof of delivery.
- SMS delivery or an SMS reply does not activate the device.
- The backend starts a subscription only after it correlates a genuine Traccar connection/packet with the registered IMEI.
- Verify indoor login/heartbeat without satellite fix and full GPS fix separately.

### D. Subscription and ownership rules

Preserve:
- Plans: 1, 3, 6, 12 months and lifetime.
- Status: awaiting first connection, active, expired, suspended.
- Subscription start time is null until the first real device connection is confirmed (except a deliberate audited admin override).
- Exact server-side expiry enforcement for API requests and live streams.
- Renewal rules and immutable subscription history.
- Customer reassignment without loss of device history, GPS history, SMS logs, or ownership history.
- Admin override requires a real authenticated admin and a non-empty audit reason.

Do not treat a client-side coroutine timer or Room value as the enforcement authority.

### E. Android app

Retain the current native Kotlin/Compose UI and branding as much as possible. Replace the repository layer with real backend repositories. Room becomes an offline cache, not a fake backend or authority.

- No sample login, sample IMEI/SIM, seeded customer, seeded device, random Traccar ID, fake map coordinate, random position, or simulated success.
- Use server-returned Traccar IDs and actual positions.
- Use loading/error/disconnected/empty states honestly.
- Never show success before the server confirms a write.
- Make reconnect and live updates reflect the real connection state.
- Keep the map attribution compliant with the map data provider.
- Do not put privileged credentials or service-role keys in the APK.

### F. Permanent UI rule

Read and enforce `docs/PRODUCT_UI_RULES.md` in every change.

**No explanatory text under/around buttons or sections.** No subtitles, descriptions, helper paragraphs, instructional empty-state copy, or tooltips explaining ordinary controls. Use concise titles, short button labels, compact status text and icons. Keep developer/setup documentation in Markdown files, not in the app UI. Accessibility semantics are still required.

### Docker daemon performance for wide port publishing

Read the official Traccar Docker guidance: https://www.traccar.org/docker/.
The multi-port TCP/UDP ingress can spawn one docker-proxy process per published port when Docker userland proxy is enabled. Inspect `/etc/docker/daemon.json` and ensure `"userland-proxy": false` for the production VPS.
Do not overwrite an existing daemon.json. Merge this key while preserving all other settings, validate the JSON, explain that restarting Docker interrupts all containers, and only perform the restart during a safe maintenance window. The deployment script deliberately does not mutate global Docker daemon configuration.

## Required validation and delivery

1. Run a source-wide search for fake/mock/demo/simulation paths and remove or isolate every production occurrence.
2. Run `./gradlew testDebugUnitTest` and `./gradlew assembleDebug`.
3. Validate the Compose configuration with `docker compose config`.
4. Start Traccar only when valid server credentials/environment are supplied; verify `GET /api/health` returns `OK`.
5. Add automated tests for Traccar API parsing, authentication failures, reconnect/state reconciliation, IMEI-to-device correlation, first-connection subscription start, expiry, reassignment, and SMS state transitions. Keep test data isolated.
6. Provide a real-device acceptance checklist for representative protocol families (including Concox GT06/GT06N, Teltonika, Queclink, and other customer-owned models) plus the Egyptian SIM/GSM gateway. Do not claim any family passed until a real tracker packet has been decoded. Do not claim those checks passed unless they were physically performed.
7. Report exact files changed, tests run, test results, missing secrets/configuration, deployment steps, and remaining hardware checks.
8. Do not deploy to production or distribute a public APK unless the owner explicitly approves it. A local/debug release-candidate APK for owner review is allowed after the relevant tests pass.
9. This project will be imported into a separate AI Studio workspace. Do not attempt GitHub commits, pushes, pull requests, or merges from that imported workspace. Complete source changes locally and provide a complete project export plus release-candidate artifacts for review.

Do not stop after producing a plan or UI mockup. Implement all code that can be completed without external secrets or physical hardware, run the available tests, and clearly separate completed work from blocked hardware/deployment validation.
