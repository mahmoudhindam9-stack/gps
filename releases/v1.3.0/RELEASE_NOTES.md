# VeloTrack GPS v1.3.0 — Ordered SQL Migrations, Android Fleet Intelligence UI & Room Non-Destructive Cache Protection

## Release Identification
- **Version:** `1.3.0` (`tagName: v1.3.0`)
- **Android Version Code / Name:** `versionCode = 4`, `versionName = "1.3.0"`
- **Database Schema Version:** `003_customer_device_guard_and_schema_migrations`
- **Baseline Preserved:** Original workspace baseline (`v1.0.0` / `v1.1.0`) and `releases/v1.2.0/` preserved intact; release artifacts packaged under `releases/v1.3.0/`.

## Key Repairs & Enhancements in v1.3.0

### 1. Real Forward-Only SQL Migration Runner & `schema_migrations` RLS Enforcement
- Replaced artificial `INSERT INTO public.schema_migrations` seed statements in `backend/sql/schema.sql` with ordered forward-only migration files in `backend/sql/migrations/`:
  - `001_initial_supabase_schema.sql`
  - `002_user_vehicle_commands_rls.sql`
  - `003_customer_device_guard_and_schema_migrations.sql`
- `SupabaseDatabaseAdapter.applySchemaMigration()` executes `backend/sql/schema.sql` and then runs each migration script in order inside a transaction, recording a row in `public.schema_migrations` **only** after the migration script succeeds.
- Added `ALTER TABLE public.schema_migrations FORCE ROW LEVEL SECURITY;` and `rls_schema_migrations_admin_all` (`USING (public.velotrack_current_role() = 'ADMIN') WITH CHECK (public.velotrack_current_role() = 'ADMIN')`) so non-admin users cannot read or write migration history.

### 2. Supabase Key Format Compatibility (`sb_secret_...` & `sb_publishable_...`)
- Updated `SupabaseAuthService` (`backend/src/core.mjs`) and `getOrCreateVeloTrackRuntime` (`backend/src/server.mjs`) to support both modern Supabase key formats (`SUPABASE_SECRET_KEY` / `SUPABASE_PUBLISHABLE_KEY`) and legacy JWT keys (`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`).
- Pre-configured verified public endpoints in `backend/.env.example` for Supabase project `wtbyarkiizmncjnuomti` (`https://wtbyarkiizmncjnuomti.supabase.co`, `SUPABASE_DB_SSL=true`, and `CORS_ALLOWED_ORIGINS=https://velotrack-web.vercel.app`).

### 3. Android Room Non-Destructive Cache Protection (`v1` -> `v4`)
- Removed `.fallbackToDestructiveMigration(dropAllTables = true)` from `VeloTrackDatabase.kt`.
- Enabled `exportSchema = true` (`ksp { arg("room.schemaLocation", "$projectDir/schemas") }`) and implemented non-destructive `MIGRATION_1_2`, `MIGRATION_2_3`, and `MIGRATION_3_4` using `PRAGMA table_info` column checks so upgrading across any prior cached schema preserves all existing `users`, `devices`, `subscriptions`, `sms_logs`, and `waypoints`.

### 4. Complete Android Jetpack Compose Fleet Intelligence UI (`FleetIntelligenceScreen.kt`)
- Added the `FLEET` bottom-navigation tab (`AppTab.FLEET`) in `MainActivity.kt` and `VeloTrackViewModel.kt` for both `ADMIN` and `CUSTOMER` roles.
- Exposed all 5 Fleet Intelligence modules in Jetpack Compose:
  1. **Alerts & Events (`EVENTS`):** Vehicle selector, event type filter (`ALL`, `deviceOverspeed`, `geofenceEnter`, `geofenceExit`, `ignitionOn`, `ignitionOff`, `alarm`, `deviceOnline`, `deviceOffline`), date range selector, and event list.
  2. **Geofences (`GEOFENCES`):** Interactive `GeofenceBoundaryMapCanvas` rendering `CIRCLE` and `POLYGON` WKT boundaries + vehicle markers, plus admin-only geofence creation (`CIRCLE` / `POLYGON` with ≥3 vertices), vehicle linking, and safe deletion (`GEOFENCE_SHARED_WITH_OTHER_TRACCAR_DEVICES` protection).
  3. **Sensor & Telemetry (`TELEMETRY`):** Displays only genuinely reported sensor readings (`batteryLevel`, `power`/`voltage`, `ignition`, `rssi`, `satellites`, `fuelLevel`, `odometer`, `engineHours`, `blocked`, `charge`, `motion`) via `extractGenuineTelemetryMetrics()` — never fabricates missing readings or substitutes `0` for absent sensors.
  4. **Mileage & Engine Summary (`REPORTS`):** Displays distance (`km`), max speed (`km/h`), average speed (`km/h`), engine hours, and optional fuel consumption when reported (`null`-safe Moshi deserialization).
  5. **Temporary Location Sharing (`SHARE`):** Vehicle selector, duration chips (`15m`, `1h`, `6h`, `24h`), expiration badge, generated HTTPS share link, and one-tap clipboard copy.
- Strictly follows `docs/PRODUCT_UI_RULES.md` (zero explanatory subtitles, helper hints, or marketing copy) and supports Arabic/English + RTL/LTR layout switching.
