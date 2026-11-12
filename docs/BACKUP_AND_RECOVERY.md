# VeloTrack GPS v1.3.0-rc1 — Backup & Recovery Procedures

VeloTrack separates GPS telemetry storage (self-hosted Traccar TimescaleDB/PostgreSQL on the VPS) from business/authentication data (verified cloud Supabase project `ixazqslcmqjmndhiyhux`). Both must be backed up and tested for restoration.

---

## 1. Cloud Supabase Business Database (`ixazqslcmqjmndhiyhux`)

### Tables Covered
- `auth.users` (Supabase Auth identities)
- `public.users_profile`
- `public.bootstrap_state`
- `public.device_profiles`
- `public.devices`
- `public.activation_sms_logs`
- `public.subscriptions`
- `public.subscription_history`
- `public.device_ownership_history`
- `public.device_commands`
- `public.schema_migrations`

### Backup Procedure (Encrypted Logical Dump)
Run from a secure operator workstation or VPS cron job using `SUPABASE_DB_URL`:
```bash
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump "${SUPABASE_DB_URL}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="velotrack-supabase-public-${TIMESTAMP}.dump"
sha256sum "velotrack-supabase-public-${TIMESTAMP}.dump" > "velotrack-supabase-public-${TIMESTAMP}.dump.sha256"
```
Also enable automated daily backups / Point-in-Time Recovery (PITR) in the Supabase Dashboard (`ixazqslcmqjmndhiyhux` → Database → Backups).

### Restore Verification Procedure
Always test restoration against an isolated staging database before restoring to production:
```bash
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="${STAGING_SUPABASE_DB_URL}" \
  "velotrack-supabase-public-${TIMESTAMP}.dump"
```
Verify row counts and migration version:
```sql
SELECT version, applied_at FROM public.schema_migrations ORDER BY version;
SELECT COUNT(*) FROM public.users_profile;
SELECT COUNT(*) FROM public.devices;
SELECT COUNT(*) FROM public.subscriptions;
```

---

## 2. Traccar Telemetry Database (`database` service on VPS)

### Backup Procedure
On the VPS, dump the `traccar` database from the private `database` container without exposing port `5432`:
```bash
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose --env-file deployment/traccar/.env -f deployment/traccar/compose.yaml \
  exec -T database pg_dump -U traccar -Fc traccar > "traccar-telemetry-${TIMESTAMP}.dump"
sha256sum "traccar-telemetry-${TIMESTAMP}.dump" > "traccar-telemetry-${TIMESTAMP}.dump.sha256"
```

### Restore Procedure
1. Stop the `traccar` server container so no active connections write during restore:
   ```bash
   docker compose --env-file deployment/traccar/.env -f deployment/traccar/compose.yaml stop traccar
   ```
2. Restore the dump into `database`:
   ```bash
   cat "traccar-telemetry-${TIMESTAMP}.dump" | \
     docker compose --env-file deployment/traccar/.env -f deployment/traccar/compose.yaml \
     exec -T database pg_restore -U traccar -d traccar --clean --if-exists --no-owner
   ```
3. Start `traccar` and verify health:
   ```bash
   docker compose --env-file deployment/traccar/.env -f deployment/traccar/compose.yaml start traccar
   curl --fail http://127.0.0.1:8082/api/health
   ```
