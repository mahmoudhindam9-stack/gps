# VeloTrack GPS — Final Self-Hosted Architecture & Implementation Plan
## Self-Hosted Infrastructure | Zero Paid Software Subscriptions

A 100% privately owned, commercial-grade GPS vehicle tracking platform engineered with **zero mandatory paid SaaS subscriptions**. Every component—**Supabase Self-Hosted**, **Traccar GPS Server**, **dual PostgreSQL databases**, **NestJS Backend API**, **React Web Dashboard**, **MapLibre vector maps**, and **Native Kotlin Android APK**—runs on infrastructure under our complete control.

---

### User Review, Core Policy & Technical Corrections Incorporated

> [!IMPORTANT]
> **Final Technical Corrections & Mandates Locked In**
> 1. **Realistic VPS Sizing Baseline**: Because Supabase alone recommends `8 GB+ RAM`, `4 vCPU / 8 GB RAM` is restricted strictly to **limited development or pilot deployments**. The **Provisional Production Baseline is `8 vCPU / 16 GB RAM`** (subject to empirical load testing before scaling device count).
> 2. **Dual-Layer Tenant Isolation (NestJS + Non-Bypassed Supabase RLS)**: NestJS never uses `service_role` or `BYPASSRLS` database connections for customer queries. Every customer database operation validates the Supabase Auth JWT and executes inside a transaction that sets `SET LOCAL ROLE authenticated` and injects `request.jwt.claims` so PostgreSQL Row Level Security (RLS) is actively enforced alongside NestJS guards.
> 3. **Authenticated Traccar WebSocket Bridge (`JSESSIONID` + `event.status.enable=true`)**: NestJS authenticates against Traccar via `POST /api/session` to obtain and renew a valid `JSESSIONID` cookie before opening `ws://traccar:8082/api/socket`, enables `event.status.enable=true` in `traccar.xml`, and performs full device-status reconciliation (`GET /api/devices`) on every reconnect.
> 4. **APN-Free, Firmware-Verified GT06N SMS Activation**: APN configuration is completely excluded. Normal activation sends only the verified `SERVER` command (and `GPRSON,1#` only when verified/required by the specific firmware). **`TIMER` commands are excluded from automatic activation** and kept strictly optional and firmware-specific. Device SMS replies are treated as configurable per-profile patterns rather than fixed universal strings.
> 5. **Inline & Scheduled Subscription Expiration Cutoffs**: Subscription expiration is verified **inline before every outgoing WebSocket frame** AND enforced at the **exact `expires_at` timestamp via scheduled timers**, keeping the 30-second periodic sweep strictly as a fallback recovery mechanism.
> 6. **MapLibre Native Android `>= 11.7.0` & PMTiles Architecture**: Android pins MapLibre Native to `>= 11.7.0` for native `pmtiles://` support, Caddy/Nginx serves HTTP `Range` (`206`) + CORS headers with visible `© OpenStreetMap contributors` attribution, actual `.pmtiles` archive sizes are measured post-generation, and lack of built-in remote PMTiles offline caching is explicitly addressed.

> [!WARNING]
> **Remaining Hardware & Empirical Verification Dependencies (Phases 3–4)**
> 1. **GSM Modem Gateway & Egyptian Network Empirical Verification**: Numeric sender compatibility, carrier delivery receipts (DLR), and two-way SMS replies **must not be assumed universal** across all Egyptian networks or trackers; they will be empirically verified in Phase 4 using the actual physical GSM modem, Egyptian SIM card, carrier, and target GT06N firmware.
> 2. **GT06N Firmware Variations & Indoor Connection Detection**: `SERVER` DNS vs. IP modes, TCP transport (`0`), optional password prefixes, and connection detection without a satellite GPS fix must be verified against the physical GT06N units before marking a profile `VERIFIED`.

---

### 1. Final Infrastructure & System Architecture

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                      GPS HARDWARE & EGYPTIAN CELLULAR NETWORK                     │
│   [Concox GT06N: TCP Port 5023]          [Future Verified Models: Port 50XX]      │
└──────────────────┬────────────────────────────────────────────────▲───────────────┘
                   │ 1. Raw TCP Packets (IMEI Login / Heartbeat /   │ 2. Verified Server SMS
                   │    GPS Fix on Port 5023)                       │    (Empirical GSM Test)
                   ▼                                                │
┌───────────────────────────────────────────────────────────────────┼───────────────┐
│                         PRIVATE VPS (DOCKER COMPOSE STACK)        │               │
│                                                                   │               │
│  ┌─────────────────────────────────────────────────────────────┐  │               │
│  │ CADDY / NGINX REVERSE PROXY (Ports 80 / 443 — Auto HTTPS)   │  │               │
│  │ • Serves Static React + TypeScript Web App                  │  │               │
│  │ • Serves Self-Hosted Vector Map Tiles (.pmtiles)            │  │               │
│  │   (HTTP 206 Range Requests + CORS + Byte-Range Caching)     │  │               │
│  │ • Proxies /api & /ws ──► NestJS Backend                     │  │               │
│  └──────────────────────────────┬──────────────────────────────┘  │               │
│                                 │                                 │               │
│                                 ▼                                 │               │
│  ┌─────────────────────────────────────────────────────────────┐  │               │
│  │ NESTJS BACKEND API & BUSINESS ENGINE (Internal Port 3000)   │  │               │
│  │ ┌────────────────────────┐ ┌──────────────────────────────┐ │  │               │
│  │ │ JWT Guard + Per-Tx     │ │ Versioned SMS Profile Engine │ │  │               │
│  │ │ Postgres RLS Context   │ │ (SERVER + Optional GPRSON)   │ │  │               │
│  │ └────────────────────────┘ └──────────────┬───────────────┘ │  │               │
│  │ ┌────────────────────────┐ ┌──────────────▼───────────────┐ │  │               │
│  │ │ Traccar Session Cookie │ │ Provider-Independent SMS     │─┼──┼───┐           │
│  │ │ WS Bridge + Reconnect  │ │ Gateway Adapter (WireGuard)  │ │  │   │           │
│  │ └───────────┬────────────┘ └──────────────────────────────┘ │  │   │           │
│  │ ┌───────────┴────────────┐ ┌──────────────────────────────┐ │  │   │           │
│  │ │ Inline Frame Check +   │ │ 4-Stage Activation FSM &     │ │  │   │           │
│  │ │ Exact Expiry Timer     │ │ Customer Reassignment Engine │ │  │   │           │
│  │ └───────────┬────────────┘ └──────────────────────────────┘ │  │   │           │
│  └─────────────┼──────────────────────────────────┬────────────┘  │   │           │
│                │ Private Internal Network         │               │   │           │
│                ▼ (JSESSIONID REST + WS :8082)     ▼               │   │           │
│  ┌──────────────────────────────┐  ┌───────────────────────────┐  │   │           │
│  │ TRACCAR GPS SERVER           │  │ SUPABASE SELF-HOSTED      │  │   │           │
│  │ • event.status.enable = true │  │ • GoTrue Auth (JWT)       │  │   │           │
│  │ • Internal REST & WS (:8082) │  │ • PostgREST & Realtime    │  │   │           │
│  │ • GT06 Protocol (:5023)      │  │ • Non-Bypassed RLS        │  │   │           │
│  └──────────────┬───────────────┘  └──────────────┬────────────┘  │   │           │
│                 ▼                                 ▼               │   │           │
│  ┌──────────────────────────────┐  ┌───────────────────────────┐  │   │           │
│  │ POSTGRESQL #1: traccar_db    │  │ POSTGRESQL #2: supabase_db│  │   │           │
│  │ • Owned 100% by Traccar      │  │ • Users, Devices, Profiles│  │   │           │
│  │ • Controlled Batched 180d    │  │ • Subscriptions & Audits  │  │   │           │
│  │   Retention Maintenance Job  │  │ • RLS Enforced per Query  │  │   │           │
│  └──────────────────────────────┘  └───────────────────────────┘  │   │           │
└─────────────────────────────────┬─────────────────────────────────┼───┼───────────┘
                                  │                                 │   │
                                  │ HTTPS REST + WSS                │   │ Secure VPN / HTTPS
                                  ▼                                 │   ▼
        ┌───────────────────────────────────────────────────┐       │ ┌─────────────────────────┐
        │ CLIENTS (Visible "© OpenStreetMap contributors")  │       │ │ PRIVATE GSM MODEM       │
        │ • Web App (React + TS + MapLibre GL JS)           │       └─┤ GATEWAY (Egyptian SIM)  │
        │ • Android App (Kotlin + Compose + MapLibre>=11.7) │         │ • Empirically Verified  │
        └───────────────────────────────────────────────────┘         │   Sender, DLR & Replies │
                                                                      └─────────────────────────┘
```

---

### 2. Docker Deployment & Network Isolation Architecture

All server services run via Docker Compose segmented into isolated bridge networks so internal databases and Traccar administration ports are never exposed publicly:

| Network / Zone | Attached Containers | Externally Exposed Ports | Security & Isolation Rule |
| :--- | :--- | :--- | :--- |
| **`edge_public_net`** | `caddy` (or `nginx`), `traccar` (protocol sockets only) | `80/tcp`, `443/tcp` (Web/API/WSS/Tiles), `5023/tcp` (GT06N TCP) | Only Caddy/Nginx and active GPS protocol ports are reachable from the internet. |
| **`app_backend_net`** | `caddy`, `nestjs-api`, `supabase-kong`, `gsm-gateway-bridge` | *None* | NestJS mediates all client requests; secrets stay strictly on the backend. |
| **`traccar_private_net`** | `nestjs-api`, `traccar`, `traccar-postgres`, `traccar-maintenance` | *None* | Traccar API (`:8082`) and `traccar-postgres` (`:5432`) are unreachable from outside the host. |
| **`supabase_private_net`** | `nestjs-api`, `supabase-kong`, `supabase-auth`, `supabase-rest`, `supabase-realtime`, `supabase-db` | *None* (`supabase-studio` bound to `127.0.0.1` via SSH tunnel only) | Protects `supabase-db` and internal Supabase services from direct public access. |

---

### 3. Supabase Self-Hosted & Non-Bypassed RLS Security Model

#### A. Per-Transaction RLS Enforcement in NestJS (Zero RLS Bypass)
- **The Problem Avoided**: Connecting NestJS directly to PostgreSQL with a `postgres` superuser or `service_role` (`BYPASSRLS`) connection pool silently bypasses all Row Level Security policies.
- **Our Mandatory Enforcement Pattern**:
  1. **Application Layer (NestJS Guard)**: Validates the incoming Supabase Auth JWT signature, expiration, user role (`ADMIN` vs. `CUSTOMER`), and tenant scope.
  2. **Database Layer (Per-Transaction RLS Context)**: Every customer-scoped database query runs inside a dedicated transaction helper (`runWithUserRlsContext(jwtClaims, callback)`) that executes:
     ```sql
     SET LOCAL ROLE authenticated;
     SELECT set_config('request.jwt.claims', $1, true);
     SELECT set_config('request.jwt.claim.sub', $2, true);
     ```
  3. **Strict Credential Separation**: `service_role` credentials are restricted exclusively to internal background system workers (such as incoming Traccar connection webhook handlers and GSM delivery report callbacks) and are **never** used to serve customer API or WebSocket requests.

#### B. Dual PostgreSQL Database Separation (`traccar_db` vs. `supabase_db`)
1. **`traccar_db` (Dedicated Traccar PostgreSQL Instance)**:
   - Owned and schema-managed 100% by Traccar (`tc_devices`, `tc_positions`, `tc_events`).
   - **Never modified directly by NestJS.** All device registration, updates, and historical route queries go through Traccar's internal REST API (`http://traccar:8082/api`).
2. **`supabase_db` (Application Business PostgreSQL Schema)**:
   - **`users_profile`**: `id` (UUID, PK -> `auth.users`), `email`, `phone`, `full_name`, `role` (`ADMIN` | `CUSTOMER`), `is_active`, `created_at`.
   - **`device_profiles` (Versioned Server SMS Registry — Zero APN Fields)**:
     - `id` (UUID, PK), `manufacturer` (`Concox`), `model` (`GT06N`), `firmware_version`, `traccar_protocol` (`gt06`), `server_host`, `server_port` (`5023`), `transport` (`TCP` | `UDP`), `server_mode` (`DOMAIN` | `IP`), `requires_device_password` (Boolean), `default_device_password` (VARCHAR, nullable), `requires_gprson_command` (Boolean), `required_commands` (JSONB ordered array of verified server activation commands), `optional_commands` (JSONB optional firmware-specific templates such as `TIMER`), `expected_reply_patterns` (JSONB configurable regex/substring matchers, nullable if firmware/carrier does not reply), `is_verified` (Boolean), `created_at`.
   - **`devices`**:
     - `id` (UUID, PK), `imei` (VARCHAR(15), Unique), `traccar_device_id` (BIGINT, Unique), `profile_id` (UUID, FK -> `device_profiles.id`), `current_customer_id` (UUID, FK -> `users_profile.id`), `vehicle_name`, `plate_number`, `sim_local_number` (VARCHAR(11), entered without `+20`), `sim_e164_number` (VARCHAR(15), normalized `+201XXXXXXXXX`), `activation_status` (`PENDING`, `SMS_SENT`, `WAITING_FOR_DEVICE`, `ACTIVATED`, `FAILED`), `first_connected_at` (TIMESTAMPTZ), `last_seen_at` (TIMESTAMPTZ), `created_at`.
   - **`activation_sms_logs`**:
     - `id` (UUID, PK), `device_id` (UUID, FK), `step_order` (SMALLINT), `command_key` (`SERVER`, `GPRSON`, `OPTIONAL_TIMER`), `command_text` (TEXT), `gateway_message_id`, `status` (`QUEUED`, `SENT`, `DELIVERED`, `REPLIED`, `FAILED`, `TIMED_OUT`), `device_reply` (TEXT, nullable), `sent_at`, `completed_at`.
   - **`subscriptions`, `subscription_history` & `device_ownership_history`**:
     - Tracks independent per-device plans (`MONTH_1`, `MONTH_3`, `MONTH_6`, `MONTH_12`, `LIFETIME`), status (`AWAITING_FIRST_CONNECTION`, `ACTIVE`, `EXPIRED`, `SUSPENDED`), `started_at`, `expires_at`, admin overrides, renewals, and customer reassignments with full immutable audit trails.

---

### 4. Authenticated Traccar WebSocket Bridge & Connection Detection

- **Session-Cookie Authentication (`JSESSIONID`)**:
  - Because Traccar's `/api/socket` endpoint requires a valid session cookie rather than HTTP Basic Auth headers, the NestJS `TraccarBridgeService` authenticates via `POST http://traccar:8082/api/session` using private backend credentials, extracts the `JSESSIONID` cookie from `Set-Cookie`, and attaches `Cookie: JSESSIONID=...` when upgrading the WebSocket connection to `ws://traccar:8082/api/socket`.
- **Mandatory `traccar.xml` Status Event Configuration**:
  - We explicitly configure `<entry key='event.status.enable'>true</entry>` in `traccar.xml` so Traccar emits immediate `deviceOnline`, `deviceUnknown`, and `deviceOffline` events alongside `devices` and `positions` frames over the WebSocket.
- **Resilient Reconnection, Session Renewal & State Reconciliation**:
  - Implements heartbeats and exponential backoff reconnection (`1s` → `2s` → `5s` → `15s`).
  - If the WebSocket closes with `401/403` or session expiry, `TraccarBridgeService` automatically re-authenticates via `POST /api/session` to obtain a fresh `JSESSIONID`.
  - **Post-Reconnect State Sync**: Immediately upon every WebSocket connection or reconnection, NestJS calls `GET http://traccar:8082/api/devices` to reconcile any `status: "online"` or `lastUpdate` changes that occurred while the socket was reconnecting—ensuring a device transitioning from `WAITING_FOR_DEVICE` is never missed.
- **No-GPS-Fix Connection Detection**:
  - When a GT06N powers on indoors or in an underground garage, it sends a TCP **Login Packet (`0x01`)** and **Heartbeat Packet (`0x13`)** containing its IMEI before acquiring satellite lock. Traccar updates the device's `lastUpdate` timestamp and `status = 'online'` immediately upon receiving the login packet. Our bridge detects this state change and triggers activation even when valid GPS coordinates (`positions`) have not yet arrived.

---

### 5. Automatic GPS Server Activation by SMS (Zero APN, Firmware-Verified)

#### A. Simplified Admin "Device Activation" Form
1. **Manufacturer & Exact Model**: Selected from verified `device_profiles` (`Concox — GT06N`).
2. **Firmware Version**: Selected firmware profile revision.
3. **Device IMEI**: 15-digit numeric input with Luhn validation.
4. **Customer Account**: Assigned customer account.
5. **Subscription Duration**: `1`, `3`, `6`, `12` months, or `Lifetime`.
6. **Egyptian SIM Phone Number**: Entered **without `+20`** (`010/011/012/015XXXXXXXX` or `10/11/12/15XXXXXXXX`), automatically normalized by NestJS to `+201XXXXXXXXX`.
7. **Action**: Single **"Activate Device"** button. *(Zero APN fields, zero operator selectors, zero automatic timer overrides).*

#### B. Verified Concox GT06N (`Port 5023`, TCP) Command Policy
- **Excluded Commands**:
  - **Zero APN commands**: SIM cards auto-configure their APN on power-up.
  - **No automatic `TIMER` modification during activation**: Default activation **never** sends `TIMER,10,60#` or alters reporting intervals automatically. `TIMER` configuration is kept strictly optional, manual/on-demand, and bound to verified firmware syntax.
- **Standard Activation Sequence (Subject to Physical Firmware Verification in Phases 3–4)**:

| Step | Condition | Command Syntax | Purpose & Firmware Verification Notes |
| :--- | :--- | :--- | :--- |
| **1** | **Mandatory** | • Domain mode: `SERVER,1,{domain},5023,0#`<br>• Static IP mode: `SERVER,0,{ip},5023,0#` | Configures target VeloTrack server, port `5023`, and TCP transport (`0`). Password prefix (if required by specific firmware) is injected from `device_profiles`. |
| **2** | **Conditional** (`requires_gprson_command = true`) | `GPRSON,1#` | Sent **only** when verified and required by the specific GT06N firmware revision to switch the modem into active TCP reporting mode. |

- **Configurable Device Reply Matching**:
  - Each `device_profiles` entry defines optional, configurable reply patterns (e.g., `/OK/i`, `/SERVER/i`, or `null` if silent). The system logs all inbound SMS replies in `activation_sms_logs` for admin visibility, but never blocks activation if a device connects directly to Traccar without replying via SMS.

#### C. Provider-Independent SMS Adapter & Empirical GSM Gateway Verification
- NestJS communicates with SMS hardware through a clean `ISmsGatewayAdapter` interface, preferring a privately controlled **GSM/4G Modem Gateway** with a local Egyptian SIM connected to the VPS over WireGuard VPN / HTTPS.
- **No Unverified Assumptions**: The architecture does **not** assume that every Egyptian carrier, SIM plan, or GT06N firmware supports numeric sender acceptance, delivery receipts (DLR), or two-way SMS out of the box. Phase 4 is dedicated to empirically testing and documenting actual SMS delivery, sender compatibility, DLR behavior, and GT06N command execution with our physical modem and Egyptian SIMs before finalizing production profile flags.

#### D. 4-Stage Activation Verification State Machine
```
PENDING ──► SMS_SENT ──► WAITING_FOR_DEVICE ──► ACTIVATED / FAILED
```
- **Strict Activation Rule**: Neither `SMS_SENT`, carrier delivery receipt (`DELIVERED`), nor an SMS `OK` reply marks a device `ACTIVATED`.
- **Activation & Subscription Start**: Only when the NestJS Traccar Bridge confirms a valid connection (`status == 'online'` / updated `lastUpdate`) or packet from the registered IMEI on Traccar does the device transition to `ACTIVATED` and start its subscription clock (`started_at = NOW()`, `expires_at = NOW() + duration`).
- **Audited Admin Override**: Authorized admins may manually force-activate or start a subscription with a mandatory reason recorded in `subscription_history`.

---

### 6. Precision Subscription Enforcement & Customer Management

- **Dual-Layer Real-Time Expiration Enforcement**:
  1. **REST API Guard**: Every customer REST endpoint checks `subscription.status == 'ACTIVE' && (plan_duration == 'LIFETIME' || expires_at > NOW())`.
  2. **Inline Outgoing WebSocket Frame Guard**: Before emitting any live position or status frame over a client WebSocket room, the NestJS WebSocket gateway performs an O(1) timestamp check (`subscription.expiresAtMs > Date.now()`). If expired, the frame is dropped immediately and a `SUBSCRIPTION_EXPIRED` disconnect event is emitted.
  3. **Scheduled Exact-Timestamp Cutoff**: When a client subscribes to a device stream (or when a subscription is activated/updated), NestJS schedules a precise timer (`expiresAtMs - Date.now()`) to actively close the stream at the exact millisecond of expiration.
  4. **30-Second Recovery Sweep**: A lightweight background job runs every 30 seconds strictly as a fallback safety net to catch any edge-case state drift.
- **Customer Reassignment**:
  - Admins can reassign any device to a new Customer account at any time without losing activation logs, subscription history, ownership audit records, or Traccar GPS history.

---

### 7. Web, Native Android & MapLibre (`>= 11.7.0`) Tile Architecture

- **Pinned MapLibre Versions**:
  - **Android**: Pins **MapLibre Native Android SDK to `11.7.0` or newer** (`org.maplibre.gl:android-sdk:11.7.0+`), which natively supports the `pmtiles://` protocol.
  - **Web**: Uses `maplibre-gl` paired with the `pmtiles` protocol registered via `maplibre-gl.addProtocol('pmtiles', protocol.tile)`.
- **Self-Hosted PMTiles Server Configuration (Caddy / Nginx)**:
  - Generates the Egypt / MENA `.pmtiles` vector archive from OpenStreetMap data using Planetiler/Protomaps and **measures the actual generated file size on disk** during Phase 2 provisioning.
  - Caddy/Nginx is explicitly configured with:
    - HTTP `206 Partial Content` (`Accept-Ranges: bytes`) support.
    - Explicit CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, `Access-Control-Expose-Headers: Range, Content-Range, Content-Length, Accept-Ranges`).
  - **Mandatory Visible Attribution**: Both the Web Dashboard and Android Compose map screens render a permanent, visible **`© OpenStreetMap contributors`** attribution control in compliance with ODbL licensing.
- **Accounting for Remote PMTiles Offline Caching Limitations**:
  - MapLibre's built-in offline region manager (`OfflineManager`) does not automatically pre-cache arbitrary remote `pmtiles://https://...` byte ranges for offline use.
  - To handle intermittent connectivity on Android:
    1. **Local Room Telemetry Cache**: Last-known vehicle positions, status list, and recently viewed trip polylines are cached locally in **Room** so fleet coordinates and status remain readable offline.
    2. **HTTP Byte-Range Disk Cache + Optional Local File Pack**: OkHttp / Web caching caches viewed `206` byte-range chunks, and the Android architecture supports loading an optional pre-downloaded regional `.pmtiles` file directly from local app storage (`pmtiles://file:///.../egypt.pmtiles`) if full offline map rendering is required in the field.

---

### 8. VPS Sizing, Monitoring, Backups & Controlled GPS Retention

#### A. Corrected VPS Sizing Tiers

| Deployment Tier | Target Purpose & Scope | Minimum VPS Hardware Specs | Memory Allocation & Operational Guidance |
| :--- | :--- | :--- | :--- |
| **Pilot / Development Only** | Internal testing, Phase 2–4 hardware validation, & small pilot (`< 50` devices) | **4 vCPU / 8 GB RAM / 120 GB NVMe SSD** | *Not sized for full production.* Runs tuned/minimal container footprints for initial integration testing only. |
| **Provisional Production Baseline** | Full self-hosted stack (**Supabase + Traccar + 2x PostgreSQL + NestJS + Caddy**) | **8 vCPU / 16 GB RAM / 240 GB NVMe SSD** | • `supabase-db` + Supabase services: `~5.5 GB`<br>• `traccar-server` JVM (`-Xmx3g`): `~3.5 GB`<br>• `traccar-postgres`: `~3.5 GB`<br>• `nestjs-api` + `caddy`: `~1.5 GB`<br>• OS / FS Cache: `~2.0 GB`<br>*(Actual device capacity validated via Phase 9 load testing).* |

#### B. Automated Backups & Controlled 180-Day GPS Retention Maintenance
1. **Nightly Dual-Database Backups & Restore Drills**:
   - Automated nightly `pg_dump -Fc` snapshots of both `supabase_db` and `traccar_db`, encrypted and replicated off-VPS, with tested restoration scripts verified during Phase 9.
2. **Controlled, Batched 180-Day GPS History Retention (`traccar_db`)**:
   - NestJS **never** executes ad-hoc `DELETE` queries against `traccar_db`.
   - Instead, a dedicated, isolated **Database Maintenance Job** runs during off-peak hours (`03:00 Cairo Time`) **only after verifying that the nightly `traccar_db` backup succeeded**:
     - Reads the configured retention window (default `180 days`, admin-adjustable) and purges historical records older than the cutoff in **small, bounded batches** (e.g., `DELETE ... WHERE fixtime < cutoff LIMIT 10000` loops with brief pauses or PostgreSQL time-based table partitioning) so Traccar's live ingestion socket never experiences table lock contention.

---

### 9. Final 9-Phase Implementation Roadmap

- **Phase 1: Finalize Self-Hosted Architecture & Database Design**
  - Lock in the Docker Compose network topology, non-bypassed Supabase RLS policies, `supabase_db` schema, APN-free `device_profiles` format, and API contracts.
- **Phase 2: Prepare VPS (16GB Baseline / 8GB Pilot) & Deploy Supabase Self-Hosted + Traccar**
  - Provision the VPS, deploy Supabase Self-Hosted and dedicated Traccar (`event.status.enable=true`) + `traccar_db`, generate and measure the Egypt `.pmtiles` map archive, and configure Caddy/Nginx (`HTTP Range` + CORS) and nightly backups.
- **Phase 3: Connect a Real Concox GT06N Device & Verify GPS Communication**
  - Point a physical GT06N tracker to port `5023`, verify TCP login/heartbeat detection (both with and without satellite GPS fix) and authenticated `JSESSIONID` WebSocket event streaming.
- **Phase 4: Empirically Test Automatic Server Activation via SMS (Egyptian SIM + GSM Gateway)**
  - Connect the physical GSM modem gateway over WireGuard, empirically test numeric sender acceptance, delivery receipts, two-way replies, and the APN-free `SERVER` (+ conditional `GPRSON,1#`) sequence on physical GT06N hardware across Egyptian networks.
- **Phase 5: Build the NestJS Backend, Per-Tx RLS, Subscription Engine & Device Management**
  - Implement Supabase Auth JWT validation, per-transaction `SET LOCAL ROLE authenticated` RLS context, the authenticated Traccar `JSESSIONID` WebSocket Bridge with reconnect state-sync, the 4-stage Activation FSM, and inline + exact-timer subscription expiration enforcement.
- **Phase 6: Build the Admin Web Dashboard & Automated Device Activation Module**
  - Build the self-hosted React + TypeScript Admin UI with the streamlined **Device Activation** form (Egyptian SIM without `+20`, zero APN fields, no auto-`TIMER`, live 4-stage tracker, Admin Override), customer reassignment, and subscription renewal ledger.
- **Phase 7: Build the Customer Web Tracking Interface**
  - Build the Customer MapLibre GL JS live tracking interface (with self-hosted `.pmtiles` and visible `© OpenStreetMap contributors` attribution), status list, and Traccar route history viewer.
- **Phase 8: Build the Unified Native Kotlin Android Application**
  - Build the Jetpack Compose + MVVM + Room + **MapLibre Native (`>= 11.7.0`)** Android app supporting both Admin and Customer roles via the shared NestJS backend, accounting for offline Room telemetry caching and optional local `.pmtiles` storage.
- **Phase 9: Multi-Protocol Testing, Security Audit, Backup Restore Drills & Load Testing**
  - Validate onboarding additional GPS models via `device_profiles`, verify RLS tenant isolation and sub-second WebSocket expiration cutoffs, test the batched 180-day retention job and full database restore, and benchmark VPS memory/CPU under simulated device load.
