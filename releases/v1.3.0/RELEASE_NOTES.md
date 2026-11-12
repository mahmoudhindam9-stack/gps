# VeloTrack GPS v1.3.0-rc1 — Universal Traccar 6.17.0 Ingress, Ordered SQL Migrations, Android Fleet Intelligence UI & Room Cache Protection

## Release Identification
- **Version:** `1.3.0` (`tagName: v1.3.0`, Release Candidate 1)
- **Repository Baseline:** `mahmoudhindam9-stack/gps` (`main` @ `79393bd102ac546ae5e1622985731763cf2e9f8d`)
- **Android Version Code / Name:** `versionCode = 4`, `versionName = "1.3.0"`
- **Database Schema Version:** `003_customer_device_guard_and_schema_migrations`
- **Verified Cloud Supabase Project:** `ixazqslcmqjmndhiyhux` (`https://ixazqslcmqjmndhiyhux.supabase.co`)
- **Pinned Traccar Server:** `traccar/traccar:6.17.0` (268 protocol classes: 267 non-zero network listeners on TCP/UDP 5001–5174 and 5176–5268; port 5175 excluded; Orbcomm port 0)

## Key Changes & Enhancements in v1.3.0-rc1

### 1. Universal Traccar 6.17.0 Protocol Registry & Ingress Integration
- Integrated `deployment/traccar/protocol-ports.json` (267 network listeners + Orbcomm) into `backend/src/core.mjs` (`TRACCAR_PROTOCOL_PORT_MANIFEST`, `TRACCAR_PROTOCOL_DEFAULT_PORTS`, `resolveTraccarProtocolPort`) and exposed `GET /api/v1/protocols` in `backend/src/server.mjs`.
- Device profile creation (`POST /api/v1/profiles`) automatically resolves each protocol's official default port (`gt06` → `5023`, `teltonika` → `5027`, `gl200` → `5004`, `osmand` → `5055`, etc.) and rejects unassigned port `5175` or non-network `orbcomm`.
- Extended `deployment/traccar/verify-protocol-ports.mjs` to validate loopback binding (`127.0.0.1:8082`), private database port `5432`, additive firewall rules (`deployment/configure-firewall.sh`), and verified cloud Supabase project `ixazqslcmqjmndhiyhux`.

### 2. Real Forward-Only SQL Migration Runner & `schema_migrations` RLS Enforcement
- Replaced artificial `INSERT INTO public.schema_migrations` seed statements in `backend/sql/schema.sql` with ordered forward-only migration files in `backend/sql/migrations/`:
  - `001_initial_supabase_schema.sql`
  - `002_user_vehicle_commands_rls.sql`
  - `003_customer_device_guard_and_schema_migrations.sql`
- `SupabaseDatabaseAdapter.applySchemaMigration()` executes each migration script in order inside a transaction, recording a row in `public.schema_migrations` **only** after the migration script succeeds.
- Added `ALTER TABLE public.schema_migrations FORCE ROW LEVEL SECURITY;` and `rls_schema_migrations_admin_all` (`USING (public.velotrack_current_role() = 'ADMIN') WITH CHECK (public.velotrack_current_role() = 'ADMIN')`).

### 3. Verified Cloud Supabase Configuration (`ixazqslcmqjmndhiyhux`) & Key Compatibility
- Updated `SupabaseAuthService` (`backend/src/core.mjs`) and `getOrCreateVeloTrackRuntime` (`backend/src/server.mjs`) to support both modern Supabase key formats (`SUPABASE_SECRET_KEY` / `SUPABASE_PUBLISHABLE_KEY`) and legacy JWT keys (`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`).
- Configured `backend/.env.example` for verified cloud Supabase project `ixazqslcmqjmndhiyhux` (`https://ixazqslcmqjmndhiyhux.supabase.co`, `SUPABASE_PUBLISHABLE_KEY=sb_publishable_8d2LOE7xILs6dxP7K2TKaw_9hCc8BP_`, `VELOTRACK_INITIAL_ADMIN_EMAIL=mahmoud.hindam9@gmail.com`, `VELOTRACK_INITIAL_ADMIN_USERNAME=admin`, `SUPABASE_DB_SSL=true`, and `CORS_ALLOWED_ORIGINS=https://velotrack-web.vercel.app`).

### 4. Android Room Non-Destructive Cache Protection (`v1` -> `v4`)
- Removed `.fallbackToDestructiveMigration(dropAllTables = true)` from `VeloTrackDatabase.kt`.
- Enabled `exportSchema = true` (`ksp { arg("room.schemaLocation", "$projectDir/schemas") }`) and implemented non-destructive `MIGRATION_1_2`, `MIGRATION_2_3`, and `MIGRATION_3_4` using `PRAGMA table_info` column checks so upgrading across any prior cached schema preserves all existing `users`, `devices`, `subscriptions`, `sms_logs`, and `waypoints`.

### 5. Complete Android Jetpack Compose Fleet Intelligence UI (`FleetIntelligenceScreen.kt`)
- Added the `FLEET` bottom-navigation tab (`AppTab.FLEET`) in `MainActivity.kt` and `VeloTrackViewModel.kt` for both `ADMIN` and `CUSTOMER` roles.
- Exposed all 5 Fleet Intelligence modules in Jetpack Compose (`EVENTS`, `GEOFENCES` with `GeofenceBoundaryMapCanvas`, `TELEMETRY` with `extractGenuineTelemetryMetrics`, `REPORTS` with null-safe mileage/speed/engineHours/fuel, and `SHARE` with expiring HTTPS share links).
- Strictly follows `docs/PRODUCT_UI_RULES.md` and supports Arabic/English + RTL/LTR layout switching.
