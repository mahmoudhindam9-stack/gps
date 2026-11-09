package com.example.data.blueprint

data class ServerBlueprintDoc(
    val id: String,
    val title: String,
    val subtitle: String,
    val filename: String,
    val content: String
)

object SelfHostedServerBlueprints {
    val blueprints: List<ServerBlueprintDoc> = listOf(
        ServerBlueprintDoc(
            id = "rls_sql",
            title = "Supabase Per-Tx RLS & NestJS Context",
            subtitle = "SET LOCAL ROLE authenticated + request.jwt.claims (No BYPASSRLS)",
            filename = "supabase_rls_and_nestjs_tx.sql",
            content = """
-- ============================================================================
-- VELOTRACK GPS: SUPABASE SELF-HOSTED RLS & NON-BYPASSED TENANT ISOLATION
-- ============================================================================
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices FORCE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

-- Customer Isolation Policy: Customers only see devices assigned to their UID
CREATE POLICY customer_OwnDevices_select ON public.devices
  FOR SELECT TO authenticated
  USING (
    current_customer_id = (current_setting('request.jwt.claim.sub', true))::uuid
    OR (current_setting('request.jwt.claims', true)::jsonb ->> 'user_role') = 'ADMIN'
  );

-- NestJS Transaction Wrapper (TypeScript / Prisma / pg Pool):
-- NEVER use service_role or postgres superuser for customer requests!
/*
async runWithUserRlsContext<T>(jwtClaims: ValidatedJwt, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await this.pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(jwtClaims)]);
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [jwtClaims.sub]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
*/
            """.trimIndent()
        ),
        ServerBlueprintDoc(
            id = "traccar_xml",
            title = "Traccar Config + JSESSIONID WS Bridge",
            subtitle = "Port 5023 (GT06) • event.status.enable=true • Private :8082",
            filename = "traccar.xml",
            content = """
<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE properties SYSTEM 'http://java.sun.com/dtd/properties.dtd'>
<properties>
    <!-- Dedicated traccar_db PostgreSQL instance (Separate from supabase_db) -->
    <entry key='database.driver'>org.postgresql.Driver</entry>
    <entry key='database.url'>jdbc:postgresql://traccar-postgres:5432/traccar_db</entry>
    <entry key='database.user'>traccar_engine</entry>
    <entry key='database.password'>${'$'}{TRACCAR_DB_PASSWORD}</entry>

    <!-- Bind Admin Web/API strictly to internal Docker network -->
    <entry key='web.port'>8082</entry>

    <!-- MANDATORY: Emit deviceOnline / deviceUnknown / deviceOffline over WebSocket -->
    <entry key='event.status.enable'>true</entry>

    <!-- Enable Concox GT06N on TCP/UDP Port 5023 -->
    <entry key='gt06.port'>5023</entry>
    <entry key='gt06.timeout'>180</entry>
</properties>

<!-- NestJS Traccar Bridge Session Cookie Flow:
  1. POST http://traccar:8082/api/session (email/password) -> Extract Set-Cookie: JSESSIONID=...
  2. Connect WebSocket ws://traccar:8082/api/socket with Header 'Cookie: JSESSIONID=...'
  3. On connect/reconnect: GET http://traccar:8082/api/devices to sync online/lastUpdate state
  4. On login/heartbeat packet (even with 0 satellites / no GPS fix): transition WAITING_FOR_DEVICE -> ACTIVATED
-->
            """.trimIndent()
        ),
        ServerBlueprintDoc(
            id = "docker_compose",
            title = "Docker Compose (16GB Baseline / Isolated Nets)",
            subtitle = "Supabase + Traccar + 2x PostgreSQL + NestJS + Caddy",
            filename = "docker-compose.prod.yml",
            content = """
# Provisional Production Baseline: 8 vCPU / 16 GB RAM / 240 GB NVMe SSD
# (4 vCPU / 8 GB RAM is strictly for limited pilot/development only)
services:
  caddy:
    image: caddy:2.8-alpine
    ports:
      - "80:80"
      - "443:443"
    networks: [edge_public_net, app_backend_net]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./maps:/srv/maps:ro # Self-hosted egypt.pmtiles archive

  nestjs-api:
    build: ./backend-nestjs
    environment:
      - TRACCAR_INTERNAL_URL=http://traccar:8082
      - SUPABASE_DB_URL=postgresql://authenticator:${'$'}{DB_PASS}@supabase-db:5432/postgres
    networks: [app_backend_net, traccar_private_net, supabase_private_net]
    deploy:
      resources:
        limits: { memory: 1536M }

  traccar:
    image: traccar/traccar:6.5
    command: ["-Xmx3072m", "-jar", "tracker-server.jar", "conf/traccar.xml"]
    ports:
      - "5023:5023/tcp" # Concox GT06N exposed externally
      - "5023:5023/udp"
    networks: [edge_public_net, traccar_private_net]
    deploy:
      resources:
        limits: { memory: 3584M }

  traccar-postgres:
    image: postgres:16-alpine
    networks: [traccar_private_net]
    deploy:
      resources:
        limits: { memory: 3584M }

networks:
  edge_public_net:
  app_backend_net: { internal: true }
  traccar_private_net: { internal: true }
  supabase_private_net: { internal: true }
            """.trimIndent()
        ),
        ServerBlueprintDoc(
            id = "caddy_pmtiles",
            title = "Caddyfile — PMTiles HTTP Range & CORS",
            subtitle = "HTTP 206 Partial Content + CORS + Visible OSM Attribution",
            filename = "Caddyfile",
            content = """
gps.velotrack.eg {
    # 1. Self-Hosted PMTiles Vector Map Archive (HTTP 206 Range + CORS)
    handle_path /tiles/* {
        root * /srv/maps
        header Accept-Ranges "bytes"
        header Access-Control-Allow-Origin "*"
        header Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
        header Access-Control-Expose-Headers "Range, Content-Range, Content-Length, Accept-Ranges"
        file_server
    }

    # 2. NestJS REST API & Real-Time WebSocket Multiplexer
    handle /api/* {
        reverse_proxy nestjs-api:3000
    }
    handle /ws/* {
        reverse_proxy nestjs-api:3000
    }

    # 3. Static React + TypeScript Web Dashboard
    handle {
        root * /srv/web-dist
        try_files {path} /index.html
        file_server
    }
}
            """.trimIndent()
        ),
        ServerBlueprintDoc(
            id = "retention_180d",
            title = "Controlled 180-Day GPS Retention Job",
            subtitle = "Pre-Backup Verification + Batched Cleanup on traccar_db",
            filename = "traccar_retention_180d.sh",
            content = """
#!/usr/bin/env bash
set -euo pipefail
# Controlled off-peak maintenance job (03:00 Cairo Time).
# NestJS NEVER modifies traccar_db tables directly.

BACKUP_FILE="/backups/traccar_db_${'$'}(date +%F).dump"
RETENTION_DAYS="${'$'}{GPS_RETENTION_DAYS:-180}"

echo "[1/3] Running mandatory pg_dump -Fc backup before retention cleanup..."
pg_dump -Fc -h traccar-postgres -U traccar_engine traccar_db > "${'$'}BACKUP_FILE"
pg_restore --list "${'$'}BACKUP_FILE" > /dev/null

echo "[2/3] Executing batched deletion for positions older than ${'$'}{RETENTION_DAYS} days..."
while true; do
  DELETED=${'$'}(psql -h traccar-postgres -U traccar_engine -d traccar_db -tAc "
    WITH old_rows AS (
      SELECT id FROM tc_positions
      WHERE fixtime < NOW() - INTERVAL '${'$'}{RETENTION_DAYS} days'
        AND id NOT IN (SELECT positionid FROM tc_devices WHERE positionid IS NOT NULL)
      LIMIT 10000
    )
    DELETE FROM tc_positions WHERE id IN (SELECT id FROM old_rows) RETURNING 1;
  " | wc -l)
  [ "${'$'}DELETED" -eq 0 ] && break
  sleep 2
done
echo "[3/3] Batched 180-day retention cleanup complete."
            """.trimIndent()
        )
    )
}
