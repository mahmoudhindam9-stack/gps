# VeloTrack GPS v1.3.0-rc1 — Physical Device & SIM Gateway Acceptance Checklist

> **Important Honesty Rule:** None of the physical hardware checks below have been executed in the cloud build container. Every item below is currently **`NOT TESTED` (Pending Physical Hardware & Live VPS)** and must be physically verified before marking any device profile as `is_verified = true` in production.

---

## 1. VPS Network & Traccar 6.17.0 Ingress Verification
- [ ] **Status:** `NOT TESTED` — Verify `/etc/docker/daemon.json` includes `"userland-proxy": false` and Docker was restarted during a maintenance window.
- [ ] **Status:** `NOT TESTED` — Verify `curl --fail http://127.0.0.1:8082/api/health` returns `OK` on the VPS.
- [ ] **Status:** `NOT TESTED` — Verify `sudo ss -H -lntup` confirms `8082`, `3000`, and `5432` are bound to loopback/private interfaces only and **never** `0.0.0.0` or `[::]`.
- [ ] **Status:** `NOT TESTED` — Verify TCP and UDP ports `5001–5174` and `5176–5268` are reachable through both the VPS OS firewall (`ufw`/`firewalld`) and the cloud provider network firewall, and port `5175` is closed.

## 2. Egyptian SIM & Bidirectional GSM Modem Gateway
- [ ] **Status:** `NOT TESTED` — Insert an active Egyptian SIM (`+2010...`, `+2011...`, `+2012...`, or `+2015...`) with active data and SMS balance into the tracker.
- [ ] **Status:** `NOT TESTED` — Trigger activation SMS from VeloTrack Admin (`POST /api/v1/admin/devices/:id/send-activation-sms`). Confirm zero `APN` commands and zero automatic `TIMER` modifications are sent.
- [ ] **Status:** `NOT TESTED` — Verify distinct gateway webhook transitions in `public.activation_sms_logs`: `QUEUED` → `ACCEPTED` → `DELIVERED` → `REPLIED` (or `FAILED` / `TIMED_OUT`). Confirm HTTP 200 alone does not mark the SMS as delivered or the device as activated.

## 3. Representative GPS Tracker Protocol Families

### A. Concox GT06 / GT06N (`protocol: gt06`, Default Port: `5023`)
- [ ] **Status:** `NOT TESTED` — Configure physical GT06N to report to `<vps-host>:5023` using its firmware-specific command syntax (e.g., `SERVER,1,<vps-host>,5023,0#`).
- [ ] **Status:** `NOT TESTED` — Verify login packet and IMEI correlation in Traccar (`uniqueId === registered 15-digit IMEI`).
- [ ] **Status:** `NOT TESTED` — Verify `ONLINE_NO_FIX` state when indoor/no satellite lock (`valid = false`), and confirm subscription transitions from `PENDING_FIRST_CONNECTION` to `ACTIVE` upon first correlated connection.
- [ ] **Status:** `NOT TESTED` — Verify `ONLINE_GPS_FIX` state outdoors (`valid = true`) with real latitude, longitude, speed, heading, and ignition attributes streaming over `/ws/live` to Web and Android.
- [ ] **Status:** `NOT TESTED` — Test audited `positionSingle`, `engineStop`, and `engineResume` commands and verify physical relay behavior before marking profile verified.

### B. Teltonika FMB Series (`protocol: teltonika`, Default Port: `5027`)
- [ ] **Status:** `NOT TESTED` — Configure Teltonika tracker (e.g., FMB920/FMB120) to `<vps-host>:5027` (TCP/UDP).
- [ ] **Status:** `NOT TESTED` — Verify Codec 8 / Codec 8 Extended packet decoding in Traccar 6.17.0, IMEI correlation, IO telemetry attributes (external voltage, battery, ignition, satellites), and route history playback.

### C. Queclink GL/GV Series (`protocol: gl200`, Default Port: `5004`)
- [ ] **Status:** `NOT TESTED` — Configure Queclink tracker to `<vps-host>:5004` (TCP and UDP tested separately; do not infer UDP reachability from TCP).
- [ ] **Status:** `NOT TESTED` — Verify real packet decoding, heartbeat/reconnect reconciliation, and live map updates.

### D. Additional Customer-Owned Tracker Models (`deployment/traccar/protocol-ports.json`)
- [ ] **Status:** `NOT TESTED` — Identify exact protocol from https://www.traccar.org/devices/ and `deployment/traccar/protocol-ports.json`.
- [ ] **Status:** `NOT TESTED` — Verify real packet decoding (both TCP and UDP where applicable) before calling `POST /api/v1/admin/profiles/:id/verify`.
