# VeloTrack GPS v1.2.0 — Production Hardening, Database Synchronization & Fleet Intelligence Release

## Release Identification
- **Version:** `1.2.0` (`tagName: v1.2.0`)
- **Android Version Code / Name:** `versionCode = 3`, `versionName = "1.2.0"`
- **Database Schema Version:** `003_customer_device_guard_and_fleet_ops`
- **Baseline Preserved:** Original `v1.0.0` / `v1.1.0` imported sources preserved in-place; release artifacts generated under `releases/v1.2.0/`.

## Key Changes in v1.2.0

### 1. Security & Production Hardening
- **One-Shot Admin Bootstrap (`ensureAdminCredentials`):** Made `ensureAdminCredentials` a strict one-shot alias for `bootstrapInitialAdminIfNeeded`. Restarting the backend never resets an existing administrator's password back to `Admin@123456`.
- **Supabase Auth Schema Separation:** Removed `CREATE SCHEMA auth` / `auth.users` DDL from production `backend/sql/schema.sql` (isolated strictly to the PGlite test harness).
- **RLS & Customer Device Update Guard:** Restricted `rls_users_profile_admin_modify` to `ADMIN` only; added `rls_devices_customer_update` and trigger `trg_guard_customer_device_updates` (`CUSTOMER_DEVICE_PROTECTED_FIELD_UPDATE`) so customers can only update presentation metadata (`vehicle_name`, `vehicle_type`, `vehicle_icon`, `plate_number`) and never protected fields (`imei`, `traccar_device_id`, `current_customer_id`, `sim_e164_number`, etc.).
- **Fail-Closed Android Authentication:** Removed local offline admin bypass (`local-admin-*`) from `VeloTrackRepository.kt`. All authentication and writes require backend confirmation, while Android Room operates as an offline cache with non-destructive migrations (`MIGRATION_3_4`).

### 2. Non-Destructive Database Migration Tracking
- Added `public.schema_migrations` with RLS policy `rls_schema_migrations_admin_select` and idempotent migration records (`001_initial_supabase_schema`, `002_user_vehicle_commands_rls`, `003_customer_device_guard_and_fleet_ops`).
- Exposed `schemaVersion` across `/api/v1/health` and `/api/v1/system/version`.

### 3. Fleet Intelligence Modules (Traccar + VeloTrack Authorization)
- **Alerts & Events Center (`GET /api/v1/events`):** Queries Traccar `/api/reports/events` scoped to authorized, active-subscription vehicles.
- **Geofence Management (`GET/POST /api/v1/geofences`, `DELETE /api/v1/geofences/:id`):** Validates `CIRCLE` and closed `POLYGON` WKT areas, enforces `ADMIN`-only creation/deletion, links devices via `/api/permissions`, and blocks deletion if a geofence is shared with external/unowned Traccar devices (`GEOFENCE_SHARED_WITH_OTHER_TRACCAR_DEVICES`).
- **Sensor & Telemetry View (`GET /api/v1/telemetry`):** Displays only real attributes reported by the GPS unit (`ignition`, `batteryLevel`, `satellites`, `rssi`, `fuelLevel`, etc.) without fabricating missing values as zero.
- **Mileage & Engine Summary (`GET /api/v1/reports/summary`):** Queries Traccar `/api/reports/summary` and converts meters to km and knots to km/h.
- **Temporary Location Sharing (`POST /api/v1/devices/:id/share`):** Generates expiring share tokens via Traccar `/api/share/device` and requires an HTTPS `TRACCAR_PUBLIC_URL`.

### 4. Product UI Rules Compliance
- Removed explanatory subtitles, card descriptions, form hints, and footer prose across Web (`FleetOperationsPage.tsx`) and Android screens in strict compliance with `docs/PRODUCT_UI_RULES.md`.
