import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import WebSocket, { WebSocketServer } from "ws";

const { Pool } = pg;

export const PLAN_DURATION_DAYS = {
  MONTH_1: 30,
  MONTH_3: 90,
  MONTH_6: 180,
  MONTH_12: 365,
  LIFETIME: null
};

export function computeExpiryMillis(startedAtMs, planDuration) {
  if (!(planDuration in PLAN_DURATION_DAYS)) {
    throw new Error(`Unsupported planDuration: ${planDuration}`);
  }
  const days = PLAN_DURATION_DAYS[planDuration];
  if (days === null) return null;
  return startedAtMs + days * 24 * 60 * 60 * 1000;
}

export function normalizeEgyptianSim(rawInput) {
  const trimmed = String(rawInput ?? "").trim().replace(/[\s-]/g, "");
  if (!trimmed) {
    return { isValid: false, localNumber: "", e164Number: "", errorReason: "SIM required" };
  }
  if (trimmed.startsWith("+20") || trimmed.startsWith("0020")) {
    return {
      isValid: false,
      localNumber: trimmed,
      e164Number: "",
      errorReason: "Enter without +20"
    };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { isValid: false, localNumber: trimmed, e164Number: "", errorReason: "Digits only" };
  }
  let tenDigit = "";
  if (trimmed.length === 11 && trimmed.startsWith("0")) {
    tenDigit = trimmed.slice(1);
  } else if (trimmed.length === 10) {
    tenDigit = trimmed;
  } else {
    return {
      isValid: false,
      localNumber: trimmed,
      e164Number: "",
      errorReason: "10 or 11 digits required"
    };
  }
  if (!/^(10|11|12|15)\d{8}$/.test(tenDigit)) {
    return {
      isValid: false,
      localNumber: `0${tenDigit}`,
      e164Number: "",
      errorReason: "Invalid Egyptian operator prefix"
    };
  }
  return {
    isValid: true,
    localNumber: `0${tenDigit}`,
    e164Number: `+20${tenDigit}`,
    errorReason: null
  };
}

export function isValidImei(imei) {
  const clean = String(imei ?? "").trim();
  if (!/^\d{15}$/.test(clean)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = Number(clean[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(clean[14]);
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, keyHex] = String(storedHash ?? "").split(":");
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

/**
 * Supabase PostgreSQL Database Adapter
 * Enforces per-transaction Row-Level Security (RLS) context for all authenticated requests.
 * Supports both `pg.Pool` (production Supabase PostgreSQL) and `PGlite` (embedded PostgreSQL for tests).
 */
export class SupabaseDatabaseAdapter {
  constructor({ connectionString, pool = null, pglite = null, ssl = false }) {
    this.pglite = pglite;
    if (pool) {
      this.pool = pool;
    } else if (!pglite) {
      if (!connectionString || connectionString.includes("replace_with")) {
        throw new Error("SUPABASE_DB_URL_MISSING");
      }
      this.pool = new Pool({
        connectionString,
        ssl: ssl ? { rejectUnauthorized: false } : false,
        max: 15,
        idleTimeoutMillis: 30000
      });
    }
    this._txMutex = Promise.resolve();
  }

  async _withSerializedClient(work) {
    if (this.pglite) {
      const prev = this._txMutex;
      let release;
      this._txMutex = new Promise((resolve) => {
        release = resolve;
      });
      await prev;
      try {
        return await work({
          query: (text, params) => this.pglite.query(text, params),
          exec: (sqlText) => this.pglite.exec(sqlText)
        });
      } finally {
        release();
      }
    }
    const client = await this.pool.connect();
    try {
      return await work({
        query: (text, params) => client.query(text, params),
        exec: (sqlText) => client.query(sqlText)
      });
    } finally {
      client.release();
    }
  }

  async applySchemaMigration(customSchemaPath = null) {
    const defaultPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../sql/schema.sql"
    );
    const sqlText = fs.readFileSync(customSchemaPath ?? defaultPath, "utf8");
    await this._withSerializedClient(async (client) => {
      await client.exec(sqlText);
    });
    await this.purgeKnownDemoRecords();
  }

  /**
   * Removes only known fake/demo/seeded artifacts from earlier prototypes
   * without touching legitimate user-created production records.
   */
  async purgeKnownDemoRecords() {
    await this.runSystemTransaction(async (tx) => {
      await tx.query(
        `DELETE FROM public.activation_sms_logs
         WHERE gateway_message_id LIKE 'GSM-EG-%'`
      );
      await tx.query(
        `DELETE FROM public.users_profile
         WHERE email LIKE '%@velotrack.demo'
            OR email IN ('admin@velotrack.eg', 'customer@velotrack.eg')`
      );
    });
  }

  /**
   * Executes a privileged system transaction (used ONLY for one-time admin bootstrap,
   * incoming Traccar telemetry ingestion, and verified SMS webhooks).
   */
  async runSystemTransaction(callback) {
    return this._withSerializedClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE service_role");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  /**
   * Executes a tenant-isolated transaction that switches the PostgreSQL role to `authenticated`
   * and binds the caller's verified Supabase JWT claims so PostgreSQL RLS policies are enforced.
   */
  async runTenantTransaction(actorClaims, callback) {
    if (!actorClaims || !actorClaims.userId || !actorClaims.role) {
      throw new Error("AUTH_CLAIMS_INVALID");
    }
    const claimsJson = JSON.stringify({
      sub: actorClaims.userId,
      role: "authenticated",
      user_role: actorClaims.role,
      email: actorClaims.email ?? ""
    });
    return this._withSerializedClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
          String(actorClaims.userId)
        ]);
        await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [
          String(actorClaims.role)
        ]);
        await client.query("SELECT set_config('request.jwt.claims', $1, true)", [claimsJson]);
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
    if (this.pglite && typeof this.pglite.close === "function") {
      await this.pglite.close();
    }
  }
}

/**
 * Supabase Authentication & JWT Service
 * Connects to Supabase Auth (`@supabase/supabase-js`) and `auth.users`,
 * and verifies HS256 Supabase JWTs using `SUPABASE_JWT_SECRET`.
 */
export class SupabaseAuthService {
  constructor({
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    supabaseJwtSecret,
    dbAdapter
  }) {
    if (!supabaseJwtSecret || supabaseJwtSecret.length < 16 || supabaseJwtSecret.includes("replace_with")) {
      throw new Error("SUPABASE_JWT_SECRET_MISSING");
    }
    this.jwtSecret = supabaseJwtSecret;
    this.dbAdapter = dbAdapter;
    this.supabaseUrl = supabaseUrl;

    const hasRemoteSupabase =
      Boolean(supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey) &&
      !String(supabaseUrl).includes("replace_with");

    if (hasRemoteSupabase) {
      this.anonClient = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      this.adminClient = createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    } else {
      this.anonClient = null;
      this.adminClient = null;
    }
  }

  signSupabaseJwt({ userId, email, role, username }, expiresInSeconds = 3600 * 12) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const nowSec = Math.floor(Date.now() / 1000);
    const bodyObj = {
      aud: "authenticated",
      role: "authenticated",
      sub: userId,
      email,
      user_role: role,
      app_metadata: { provider: "email", role, username },
      user_metadata: { username },
      iat: nowSec,
      exp: nowSec + expiresInSeconds
    };
    const body = Buffer.from(JSON.stringify(bodyObj)).toString("base64url");
    const sig = crypto
      .createHmac("sha256", this.jwtSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return `${header}.${body}.${sig}`;
  }

  verifyToken(token) {
    if (!token || typeof token !== "string") {
      throw new Error("AUTH_TOKEN_MISSING");
    }
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("AUTH_TOKEN_MALFORMED");
    }
    const [header, body, sig] = parts;
    const expectedSig = crypto
      .createHmac("sha256", this.jwtSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new Error("AUTH_SIGNATURE_INVALID");
    }
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp <= nowSec) {
      throw new Error("AUTH_TOKEN_EXPIRED");
    }
    const appRole = claims.user_role ?? claims.app_metadata?.role ?? claims.role;
    if (!claims.sub || !["ADMIN", "CUSTOMER"].includes(appRole)) {
      throw new Error("AUTH_CLAIMS_INVALID");
    }
    return {
      userId: claims.sub,
      role: appRole,
      email: claims.email,
      username: claims.app_metadata?.username ?? claims.user_metadata?.username ?? null
    };
  }

  async createAuthUser({ email, password, role, username }) {
    const cleanEmail = String(email ?? "").toLowerCase().trim();
    if (this.adminClient) {
      const { data, error } = await this.adminClient.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true,
        app_metadata: { role, username },
        user_metadata: { username }
      });
      if (error || !data?.user?.id) {
        throw new Error(`SUPABASE_AUTH_CREATE_FAILED:${error?.message ?? "unknown"}`);
      }
      // Supabase Auth owns auth.users and password hashing. Never write encrypted_password
      // directly: doing so would overwrite Supabase's bcrypt hash with an incompatible hash.
      return { id: data.user.id, email: cleanEmail };
    }

    // Direct Supabase PostgreSQL `auth.users` persistence (self-hosted DB / test environment)
    return this.dbAdapter.runSystemTransaction(async (tx) => {
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
         VALUES ($1, $2, $3, NOW(), $4::jsonb, $5::jsonb)`,
        [
          id,
          cleanEmail,
          hashPassword(password),
          JSON.stringify({ role, username }),
          JSON.stringify({ username })
        ]
      );
      return { id, email: cleanEmail };
    });
  }

  async verifyUserPassword({ userId, email, password }) {
    if (this.anonClient) {
      const { data, error } = await this.anonClient.auth.signInWithPassword({
        email,
        password
      });
      if (error || !data?.user) {
        return { valid: false, accessToken: null };
      }
      return { valid: true, accessToken: data.session?.access_token ?? null };
    }

    return this.dbAdapter.runSystemTransaction(async (tx) => {
      const res = await tx.query(
        `SELECT id, encrypted_password FROM auth.users WHERE id = $1`,
        [userId]
      );
      if (res.rows.length === 0) return { valid: false, accessToken: null };
      const ok = verifyPassword(password, res.rows[0].encrypted_password);
      return { valid: ok, accessToken: null };
    });
  }

  async updateAuthUserPassword({ userId, newPassword }) {
    if (this.adminClient) {
      const { error } = await this.adminClient.auth.admin.updateUserById(userId, {
        password: newPassword
      });
      if (error) {
        throw new Error(`SUPABASE_AUTH_PASSWORD_UPDATE_FAILED:${error.message}`);
      }
      return;
    }
    await this.dbAdapter.runSystemTransaction(async (tx) => {
      await tx.query(
        `UPDATE auth.users SET encrypted_password = $2, updated_at = NOW() WHERE id = $1`,
        [userId, hashPassword(newPassword)]
      );
    });
  }
}

/**
 * Official Traccar Server REST & Authenticated WebSocket Bridge
 */
export class TraccarBridgeClient {
  constructor({
    baseUrl,
    adminEmail,
    adminPassword,
    deploymentMode = process.env.BACKEND_DEPLOYMENT_MODE ?? "vps_local",
    privateTunnelEnabled = process.env.TRACCAR_PRIVATE_TUNNEL_ENABLED === "true",
    fetchImpl = globalThis.fetch,
    WebSocketImpl = WebSocket
  }) {
    this.baseUrl = String(baseUrl ?? "").trim().replace(/\/+$/, "");
    this.adminEmail = adminEmail;
    this.adminPassword = adminPassword;
    this.deploymentMode = deploymentMode;
    this.privateTunnelEnabled = privateTunnelEnabled;
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.sessionCookie = null;
    this.wsConnected = false;
    this.lastSyncAtMs = null;
    this._ws = null;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this._stopped = false;

    this.validateBaseUrlPolicy();
  }

  validateBaseUrlPolicy() {
    if (!this.baseUrl) return;
    let parsed;
    try {
      parsed = new URL(this.baseUrl);
    } catch {
      throw new Error("TRACCAR_BASE_URL_INVALID");
    }
    const isLoopback =
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1";

    if (this.deploymentMode === "external" && isLoopback && !this.privateTunnelEnabled) {
      throw new Error("TRACCAR_REMOTE_LOOPBACK_FORBIDDEN");
    }
  }

  static computeReconnectDelayMs(attempt) {
    const exp = Math.min(Math.max(0, attempt), 6);
    return Math.min(30000, 1000 * Math.pow(2, exp));
  }

  static extractJSessionId(setCookieHeaders) {
    const list = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : setCookieHeaders
      ? [setCookieHeaders]
      : [];
    for (const header of list) {
      const match = /JSESSIONID=([^;\s]+)/i.exec(header);
      if (match && match[1]) {
        return `JSESSIONID=${match[1]}`;
      }
    }
    return null;
  }

  async checkHealth() {
    if (!this.baseUrl) return false;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async authenticateSession() {
    this.validateBaseUrlPolicy();
    if (!this.baseUrl || !this.adminEmail || !this.adminPassword) {
      throw new Error("TRACCAR_CREDENTIALS_MISSING");
    }
    const body = new URLSearchParams({
      email: this.adminEmail,
      password: this.adminPassword
    });
    const res = await this.fetchImpl(`${this.baseUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!res.ok) {
      this.sessionCookie = null;
      throw new Error(`TRACCAR_AUTH_FAILED_${res.status}`);
    }
    const rawCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : res.headers.get("set-cookie");
    const cookie = TraccarBridgeClient.extractJSessionId(rawCookies);
    if (!cookie) {
      this.sessionCookie = null;
      throw new Error("TRACCAR_SESSION_COOKIE_MISSING");
    }
    this.sessionCookie = cookie;
    return cookie;
  }

  async registerDeviceInTraccar({ name, imei }) {
    if (!this.sessionCookie) {
      await this.authenticateSession();
    }
    const res = await this.fetchImpl(`${this.baseUrl}/api/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: this.sessionCookie
      },
      body: JSON.stringify({ name, uniqueId: imei })
    });
    if (res.status === 401) {
      this.sessionCookie = null;
      throw new Error("TRACCAR_UNAUTHORIZED");
    }
    if (!res.ok) {
      throw new Error(`TRACCAR_DEVICE_REGISTER_FAILED_${res.status}`);
    }
    const payload = await res.json();
    if (!payload || typeof payload.id !== "number") {
      throw new Error("TRACCAR_INVALID_DEVICE_ID");
    }
    return payload;
  }

  async fetchDevicesAndPositions() {
    if (!this.sessionCookie) {
      await this.authenticateSession();
    }
    const headers = { Accept: "application/json", Cookie: this.sessionCookie };
    const [devRes, posRes] = await Promise.all([
      this.fetchImpl(`${this.baseUrl}/api/devices`, { headers }),
      this.fetchImpl(`${this.baseUrl}/api/positions`, { headers })
    ]);
    if (devRes.status === 401 || posRes.status === 401) {
      this.sessionCookie = null;
      throw new Error("TRACCAR_SESSION_EXPIRED");
    }
    if (!devRes.ok || !posRes.ok) {
      throw new Error("TRACCAR_STATE_SYNC_FAILED");
    }
    this.lastSyncAtMs = Date.now();
    return {
      devices: await devRes.json(),
      positions: await posRes.json()
    };
  }

  async fetchRouteHistory(traccarDeviceId, fromIso, toIso) {
    if (!this.sessionCookie) {
      await this.authenticateSession();
    }
    const params = new URLSearchParams({
      deviceId: String(traccarDeviceId),
      from: fromIso,
      to: toIso
    });
    const res = await this.fetchImpl(`${this.baseUrl}/api/reports/route?${params.toString()}`, {
      headers: { Accept: "application/json", Cookie: this.sessionCookie }
    });
    if (res.status === 401) {
      this.sessionCookie = null;
      throw new Error("TRACCAR_SESSION_EXPIRED");
    }
    if (!res.ok) {
      throw new Error(`TRACCAR_ROUTE_HISTORY_FAILED_${res.status}`);
    }
    const rows = await res.json();
    return rows.map((p) => ({
      traccarPositionId: p.id,
      traccarDeviceId: p.deviceId,
      latitude: p.latitude,
      longitude: p.longitude,
      speedKmh: typeof p.speed === "number" ? Number((p.speed * 1.852).toFixed(2)) : 0,
      heading: typeof p.course === "number" ? p.course : 0,
      valid: Boolean(p.valid),
      ignition: Boolean(p.attributes?.ignition),
      recordedAtMs: p.fixTime ? Date.parse(p.fixTime) : Date.now()
    }));
  }

  /**
   * Opens and maintains an authenticated WebSocket connection to Traccar `/api/socket`
   * using the real `JSESSIONID` cookie, performing full state reconciliation on connect/reconnect.
   */
  async connectLiveSocket({ onUpdate, onError = () => {} }) {
    this._stopped = false;
    const connectOnce = async () => {
      if (this._stopped) return;
      try {
        if (!this.sessionCookie) {
          await this.authenticateSession();
        }
        const wsUrl =
          this.baseUrl.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://") +
          "/api/socket";
        const ws = new this.WebSocketImpl(wsUrl, {
          headers: { Cookie: this.sessionCookie }
        });
        this._ws = ws;

        ws.on("open", async () => {
          this.wsConnected = true;
          this._reconnectAttempt = 0;
          try {
            const snapshot = await this.fetchDevicesAndPositions();
            await onUpdate({
              traccarDevices: snapshot.devices ?? [],
              traccarPositions: snapshot.positions ?? []
            });
          } catch (syncErr) {
            onError(syncErr);
          }
        });

        ws.on("message", async (rawData) => {
          try {
            const text = typeof rawData === "string" ? rawData : rawData.toString("utf8");
            const frame = JSON.parse(text);
            this.lastSyncAtMs = Date.now();
            await onUpdate({
              traccarDevices: frame.devices ?? [],
              traccarPositions: frame.positions ?? []
            });
          } catch (parseErr) {
            onError(parseErr);
          }
        });

        ws.on("close", (code) => {
          this.wsConnected = false;
          if (code === 1008 || code === 4001) {
            this.sessionCookie = null;
          }
          this._scheduleReconnect(connectOnce);
        });

        ws.on("error", (err) => {
          this.wsConnected = false;
          this.sessionCookie = null;
          onError(err);
        });
      } catch (err) {
        this.wsConnected = false;
        onError(err);
        this._scheduleReconnect(connectOnce);
      }
    };

    await connectOnce();
  }

  _scheduleReconnect(connectFn) {
    if (this._stopped) return;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    const delayMs = TraccarBridgeClient.computeReconnectDelayMs(this._reconnectAttempt++);
    this._reconnectTimer = setTimeout(() => {
      connectFn();
    }, delayMs);
  }

  disconnectLiveSocket() {
    this._stopped = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        // ignore close error
      }
      this._ws = null;
    }
    this.wsConnected = false;
  }
}

/**
 * Authoritative VeloTrack Business Engine
 * 100% persisted in Supabase PostgreSQL (`public.*` tables linked to `auth.users`).
 * Zero JavaScript Map business stores.
 */
export class VeloTrackEngine {
  constructor({ dbAdapter, authService, traccarClient, smsGateway }) {
    if (!dbAdapter) throw new Error("DB_ADAPTER_REQUIRED");
    this.db = dbAdapter;
    this.authService = authService;
    this.traccarClient = traccarClient;
    this.smsGateway = smsGateway;
    this._liveListeners = new Set();
    this._expiryTimers = new Map();
  }

  onLiveStateChange(listener) {
    this._liveListeners.add(listener);
    return () => this._liveListeners.delete(listener);
  }

  async _notifyListeners(event) {
    for (const listener of this._liveListeners) {
      try {
        await listener(event);
      } catch {
        // isolate listener errors
      }
    }
  }

  scheduleExactExpiryCutoff(deviceId, expiresAtMs) {
    const existing = this._expiryTimers.get(deviceId);
    if (existing) {
      clearTimeout(existing);
      this._expiryTimers.delete(deviceId);
    }
    if (!expiresAtMs) return;
    const delay = Math.max(0, expiresAtMs - Date.now());
    if (delay > 2147483647) return;
    const timer = setTimeout(async () => {
      this._expiryTimers.delete(deviceId);
      try {
        await this.enforceSubscriptionExpiry(deviceId, Date.now());
        await this._notifyListeners({ type: "SUBSCRIPTION_EXPIRED", deviceIds: [deviceId] });
      } catch {
        // ignore background timer failure
      }
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
    this._expiryTimers.set(deviceId, timer);
  }

  clearAllTimers() {
    for (const timer of this._expiryTimers.values()) {
      clearTimeout(timer);
    }
    this._expiryTimers.clear();
  }

  /**
   * One-Time Initial Administrator Bootstrap
   * - Uses environment secrets (`VELOTRACK_INITIAL_ADMIN_EMAIL`, `VELOTRACK_INITIAL_ADMIN_USERNAME`, `VELOTRACK_INITIAL_ADMIN_PASSWORD`).
   * - Creates the administrator in Supabase Auth (`auth.users`) and `public.users_profile` with `role = 'ADMIN'` and `must_change_password = TRUE`.
   * - Locks `public.bootstrap_state.admin_bootstrapped = TRUE` so it never runs again or resets the admin on restart.
   */
  async bootstrapInitialAdminIfNeeded({
    adminEmail = process.env.VELOTRACK_INITIAL_ADMIN_EMAIL,
    adminUsername = process.env.VELOTRACK_INITIAL_ADMIN_USERNAME,
    adminPassword = process.env.VELOTRACK_INITIAL_ADMIN_PASSWORD,
    adminPhone = process.env.VELOTRACK_INITIAL_ADMIN_PHONE ?? "+201000000000"
  } = {}) {
    const check = await this.db.runSystemTransaction(async (tx) => {
      const stateRes = await tx.query(
        `SELECT admin_bootstrapped, admin_user_id FROM public.bootstrap_state WHERE id = 1 FOR UPDATE`
      );
      const adminCountRes = await tx.query(
        `SELECT id, username, email FROM public.users_profile WHERE role = 'ADMIN' LIMIT 1`
      );
      if (stateRes.rows[0]?.admin_bootstrapped || adminCountRes.rows.length > 0) {
        if (!stateRes.rows[0]?.admin_bootstrapped && adminCountRes.rows[0]?.id) {
          await tx.query(
            `UPDATE public.bootstrap_state
             SET admin_bootstrapped = TRUE, admin_user_id = $1, bootstrapped_at = NOW()
             WHERE id = 1`,
            [adminCountRes.rows[0].id]
          );
        }
        return { alreadyBootstrapped: true, existingAdmin: adminCountRes.rows[0] ?? null };
      }
      return { alreadyBootstrapped: false };
    });

    if (check.alreadyBootstrapped) {
      return {
        bootstrapped: false,
        reason: "ALREADY_BOOTSTRAPPED",
        adminUserId: check.existingAdmin?.id ?? null
      };
    }

    const cleanEmail = String(adminEmail ?? "").toLowerCase().trim();
    const cleanUsername = String(adminUsername ?? "").trim();
    const rawPassword = String(adminPassword ?? "");

    if (!cleanEmail || !cleanEmail.includes("@")) {
      throw new Error("BOOTSTRAP_ADMIN_EMAIL_REQUIRED");
    }
    if (!cleanUsername) {
      throw new Error("BOOTSTRAP_ADMIN_USERNAME_REQUIRED");
    }
    if (!rawPassword || rawPassword.length < 8) {
      throw new Error("BOOTSTRAP_ADMIN_PASSWORD_REQUIRED");
    }

    const authUser = await this.authService.createAuthUser({
      email: cleanEmail,
      password: rawPassword,
      role: "ADMIN",
      username: cleanUsername
    });

    await this.db.runSystemTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO public.users_profile (
           id, username, email, phone, full_name, role, must_change_password, is_active
         ) VALUES ($1, $2, $3, $4, $5, 'ADMIN', TRUE, TRUE)`,
        [authUser.id, cleanUsername, cleanEmail, adminPhone, "System Administrator"]
      );
      await tx.query(
        `UPDATE public.bootstrap_state
         SET admin_bootstrapped = TRUE,
             admin_user_id = $1,
             bootstrapped_at = NOW()
         WHERE id = 1`,
        [authUser.id]
      );
    });

    return {
      bootstrapped: true,
      adminUserId: authUser.id,
      username: cleanUsername,
      email: cleanEmail,
      mustChangePassword: true
    };
  }

  /**
   * Authenticates by username (e.g. `admin`) or email via Supabase Auth.
   */
  async login(identifier, password) {
    const cleanId = String(identifier ?? "").trim();
    if (!cleanId || !password) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const profileRow = await this.db.runSystemTransaction(async (tx) => {
      const res = await tx.query(
        `SELECT id, username, email, phone, full_name, role, must_change_password, is_active
         FROM public.users_profile
         WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))
           AND is_active = TRUE
         LIMIT 1`,
        [cleanId]
      );
      return res.rows[0] ?? null;
    });

    if (!profileRow) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const authCheck = await this.authService.verifyUserPassword({
      userId: profileRow.id,
      email: profileRow.email,
      password
    });

    if (!authCheck.valid) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const token = this.authService.signSupabaseJwt({
      userId: profileRow.id,
      email: profileRow.email,
      role: profileRow.role,
      username: profileRow.username
    });

    return {
      token,
      mustChangePassword: Boolean(profileRow.must_change_password),
      user: this._mapUserRow(profileRow)
    };
  }

  /**
   * Completes the mandatory password change after first login (or voluntary password change).
   */
  async changePassword(actorClaims, { currentPassword, newPassword }) {
    if (!currentPassword || !newPassword || String(newPassword).length < 8) {
      throw new Error("WEAK_NEW_PASSWORD");
    }
    if (currentPassword === newPassword) {
      throw new Error("NEW_PASSWORD_MUST_DIFFER");
    }

    const profileRow = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      const res = await tx.query(
        `SELECT id, username, email, phone, full_name, role, must_change_password, is_active
         FROM public.users_profile
         WHERE id = $1`,
        [actorClaims.userId]
      );
      return res.rows[0] ?? null;
    });

    if (!profileRow) {
      throw new Error("AUTH_USER_NOT_FOUND");
    }

    const authCheck = await this.authService.verifyUserPassword({
      userId: profileRow.id,
      email: profileRow.email,
      password: currentPassword
    });
    if (!authCheck.valid) {
      throw new Error("INVALID_CREDENTIALS");
    }

    await this.authService.updateAuthUserPassword({
      userId: profileRow.id,
      newPassword
    });

    const updatedRow = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      const res = await tx.query(
        `UPDATE public.users_profile
         SET must_change_password = FALSE,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, username, email, phone, full_name, role, must_change_password, is_active, created_at`,
        [actorClaims.userId]
      );
      return res.rows[0];
    });

    const freshToken = this.authService.signSupabaseJwt({
      userId: updatedRow.id,
      email: updatedRow.email,
      role: updatedRow.role,
      username: updatedRow.username
    });

    return {
      token: freshToken,
      mustChangePassword: false,
      user: this._mapUserRow(updatedRow)
    };
  }

  async getAuthenticatedUserProfile(actorClaims) {
    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      const res = await tx.query(
        `SELECT id, username, email, phone, full_name, role, must_change_password, is_active, created_at
         FROM public.users_profile
         WHERE id = $1`,
        [actorClaims.userId]
      );
      if (res.rows.length === 0) {
        throw new Error("AUTH_USER_NOT_FOUND");
      }
      return this._mapUserRow(res.rows[0]);
    });
  }

  async _assertActiveAndPasswordUpdated(tx, actorClaims) {
    const res = await tx.query(
      `SELECT id, role, must_change_password, is_active
       FROM public.users_profile
       WHERE id = $1`,
      [actorClaims.userId]
    );
    const user = res.rows[0];
    if (!user || !user.is_active) {
      throw new Error("AUTH_USER_NOT_FOUND");
    }
    if (user.must_change_password) {
      throw new Error("PASSWORD_CHANGE_REQUIRED");
    }
    return user;
  }

  /**
   * Admin-only customer account creation (Public registration is prohibited).
   */
  async createCustomerAccount(actorClaims, { username = null, email, phone, fullName, password }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
    });

    const cleanEmail = String(email ?? "").toLowerCase().trim();
    const cleanUsername = username ? String(username).trim() : null;
    if (!cleanEmail.includes("@") || !fullName || !password || String(password).length < 8) {
      throw new Error("INVALID_CUSTOMER_INPUT");
    }

    const authUser = await this.authService.createAuthUser({
      email: cleanEmail,
      password,
      role: "CUSTOMER",
      username: cleanUsername
    });

    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      const res = await tx.query(
        `INSERT INTO public.users_profile (
           id, username, email, phone, full_name, role, must_change_password, is_active
         ) VALUES ($1, $2, $3, $4, $5, 'CUSTOMER', FALSE, TRUE)
         RETURNING id, username, email, phone, full_name, role, must_change_password, is_active, created_at`,
        [authUser.id, cleanUsername, cleanEmail, String(phone ?? "").trim(), String(fullName).trim()]
      );
      return this._mapUserRow(res.rows[0]);
    });
  }

  async listUsers(actorClaims) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const res = await tx.query(
        `SELECT id, username, email, phone, full_name, role, must_change_password, is_active, created_at
         FROM public.users_profile
         ORDER BY created_at ASC`
      );
      return res.rows.map((r) => this._mapUserRow(r));
    });
  }

  async listDeviceProfiles(actorClaims) {
    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const res = await tx.query(
        `SELECT * FROM public.device_profiles ORDER BY created_at ASC`
      );
      return res.rows.map((r) => this._mapProfileRow(r));
    });
  }

  async registerDeviceProfile(actorClaims, input) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const serverCmd = String(input.serverCommandTemplate ?? "").trim();
    if (!serverCmd || /APN/i.test(serverCmd) || /TIMER/i.test(serverCmd)) {
      throw new Error("INVALID_PROFILE_COMMAND_POLICY");
    }
    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const res = await tx.query(
        `INSERT INTO public.device_profiles (
           manufacturer, model, firmware_version, traccar_protocol,
           server_host, server_port, transport, server_mode,
           requires_device_password, default_device_password,
           requires_gprson_command, server_command_template,
           gprson_command_template, optional_timer_command_template,
           expected_reply_pattern, is_verified
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          String(input.manufacturer ?? "").trim(),
          String(input.model ?? "").trim(),
          String(input.firmwareVersion ?? "").trim(),
          input.traccarProtocol ?? "gt06",
          String(input.serverHost ?? "").trim(),
          Number(input.serverPort ?? 5023),
          input.transport ?? "TCP",
          input.serverMode ?? "DOMAIN",
          Boolean(input.requiresDevicePassword),
          input.defaultDevicePassword ?? null,
          Boolean(input.requiresGprsonCommand),
          serverCmd,
          input.requiresGprsonCommand ? (input.gprsonCommandTemplate ?? "GPRSON,1#") : null,
          input.optionalTimerCommandTemplate ?? null,
          input.expectedReplyPattern ?? null,
          Boolean(input.isVerified ?? false)
        ]
      );
      return this._mapProfileRow(res.rows[0]);
    });
  }

  async markProfileVerifiedAfterPhysicalTest(actorClaims, profileId) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const res = await tx.query(
        `UPDATE public.device_profiles
         SET is_verified = TRUE
         WHERE id = $1
         RETURNING *`,
        [profileId]
      );
      if (res.rows.length === 0) throw new Error("PROFILE_NOT_FOUND");
      return this._mapProfileRow(res.rows[0]);
    });
  }

  /**
   * Provisions a device in Traccar and Supabase PostgreSQL inside a transaction,
   * and dispatches verified SMS commands via the real SMS gateway adapter.
   */
  async provisionAndActivateDevice(actorClaims, input) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    if (!isValidImei(input.imei)) {
      throw new Error("INVALID_IMEI");
    }
    const sim = normalizeEgyptianSim(input.simLocalWithoutPlus20);
    if (!sim.isValid) {
      throw new Error(`INVALID_SIM:${sim.errorReason}`);
    }

    const { profile, customer } = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const dupRes = await tx.query(`SELECT id FROM public.devices WHERE imei = $1`, [input.imei]);
      if (dupRes.rows.length > 0) {
        throw new Error("DUPLICATE_IMEI");
      }
      const profRes = await tx.query(`SELECT * FROM public.device_profiles WHERE id = $1`, [
        input.profileId
      ]);
      if (profRes.rows.length === 0) throw new Error("PROFILE_NOT_FOUND");
      const prof = this._mapProfileRow(profRes.rows[0]);
      if (!prof.isVerified) throw new Error("PROFILE_NOT_VERIFIED_FOR_SMS");

      const custRes = await tx.query(
        `SELECT * FROM public.users_profile WHERE id = $1 AND role = 'CUSTOMER' AND is_active = TRUE`,
        [input.customerId]
      );
      if (custRes.rows.length === 0) throw new Error("CUSTOMER_NOT_FOUND");
      return { profile: prof, customer: this._mapUserRow(custRes.rows[0]) };
    });

    // 1. Register in real Traccar Server via POST /api/devices
    const traccarDevice = await this.traccarClient.registerDeviceInTraccar({
      name: input.vehicleName,
      imei: input.imei
    });

    // 2. Persist device, subscription (AWAITING_FIRST_CONNECTION), history, and queued SMS logs in a transaction
    const provisioned = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      const devRes = await tx.query(
        `INSERT INTO public.devices (
           imei, traccar_device_id, profile_id, current_customer_id,
           vehicle_name, plate_number, sim_local_number, sim_e164_number,
           activation_status, connection_state, has_valid_fix
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING','OFFLINE',FALSE)
         RETURNING *`,
        [
          input.imei,
          traccarDevice.id,
          profile.id,
          customer.id,
          String(input.vehicleName).trim(),
          String(input.plateNumber).trim(),
          sim.localNumber,
          sim.e164Number
        ]
      );
      const dev = this._mapDeviceRow(devRes.rows[0]);

      const subRes = await tx.query(
        `INSERT INTO public.subscriptions (
           device_id, customer_id, plan_duration, status, started_at, expires_at
         ) VALUES ($1,$2,$3,'AWAITING_FIRST_CONNECTION',NULL,NULL)
         RETURNING *`,
        [dev.id, customer.id, input.planDuration]
      );
      const sub = this._mapSubscriptionRow(subRes.rows[0]);

      await tx.query(
        `INSERT INTO public.subscription_history (
           device_id, customer_id, action_type, plan_duration, actor_user_id, notes
         ) VALUES ($1,$2,'PROVISIONED',$3,$4,'Provisioned awaiting 1st Traccar connection')`,
        [dev.id, customer.id, input.planDuration, actorClaims.userId]
      );

      const commands = [
        { stepOrder: 1, commandKey: "SERVER", commandText: profile.serverCommandTemplate }
      ];
      if (profile.requiresGprsonCommand && profile.gprsonCommandTemplate) {
        commands.push({
          stepOrder: 2,
          commandKey: "GPRSON",
          commandText: profile.gprsonCommandTemplate
        });
      }

      const logs = [];
      for (const cmd of commands) {
        const logRes = await tx.query(
          `INSERT INTO public.activation_sms_logs (
             device_id, step_order, command_key, command_text, status
           ) VALUES ($1,$2,$3,$4,'QUEUED')
           RETURNING *`,
          [dev.id, cmd.stepOrder, cmd.commandKey, cmd.commandText]
        );
        logs.push(this._mapSmsLogRow(logRes.rows[0]));
      }

      return { device: dev, subscription: sub, smsLogs: logs };
    });

    // 3. Dispatch SMS commands via the real SMS gateway adapter and persist actual status
    const updatedLogs = [];
    for (const logEntry of provisioned.smsLogs) {
      try {
        const gwRes = await this.smsGateway.sendSms({
          toE164: sim.e164Number,
          text: logEntry.commandText
        });
        const savedLog = await this.db.runTenantTransaction(actorClaims, async (tx) => {
          const r = await tx.query(
            `UPDATE public.activation_sms_logs
             SET gateway_message_id = $2,
                 status = $3
             WHERE id = $1
             RETURNING *`,
            [logEntry.id, gwRes.gatewayMessageId, gwRes.initialStatus ?? "ACCEPTED"]
          );
          return this._mapSmsLogRow(r.rows[0]);
        });
        updatedLogs.push(savedLog);
      } catch (err) {
        await this.db.runTenantTransaction(actorClaims, async (tx) => {
          await tx.query(
            `UPDATE public.activation_sms_logs
             SET status = 'FAILED', failure_reason = $2, completed_at = NOW()
             WHERE id = $1`,
            [logEntry.id, err.message]
          );
          await tx.query(
            `UPDATE public.devices SET activation_status = 'FAILED' WHERE id = $1`,
            [provisioned.device.id]
          );
        });
        throw err;
      }
    }

    const finalDevice = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      const r = await tx.query(
        `UPDATE public.devices
         SET activation_status = 'SMS_SENT'
         WHERE id = $1
         RETURNING *`,
        [provisioned.device.id]
      );
      return this._mapDeviceRow(r.rows[0]);
    });

    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [finalDevice.id] });
    return { device: finalDevice, subscription: provisioned.subscription, smsLogs: updatedLogs };
  }

  /**
   * Handles real SMS gateway status callbacks (SENT, DELIVERED, FAILED, TIMED_OUT).
   * SMS delivery NEVER activates the device or starts the subscription.
   */
  async handleSmsDeliveryWebhook({
    gatewayMessageId,
    deliveryStatus,
    failureReason = null,
    timestampMs = Date.now()
  }) {
    const result = await this.db.runSystemTransaction(async (tx) => {
      const logRes = await tx.query(
        `SELECT * FROM public.activation_sms_logs WHERE gateway_message_id = $1 LIMIT 1 FOR UPDATE`,
        [gatewayMessageId]
      );
      if (logRes.rows.length === 0) {
        throw new Error("SMS_LOG_NOT_FOUND");
      }
      const logRow = logRes.rows[0];
      const devRes = await tx.query(
        `SELECT * FROM public.devices WHERE id = $1 FOR UPDATE`,
        [logRow.device_id]
      );
      const devRow = devRes.rows[0];

      let nextDeviceStatus = devRow.activation_status;
      let completedIso = logRow.completed_at;

      if (deliveryStatus === "DELIVERED") {
        completedIso = new Date(timestampMs).toISOString();
        if (devRow.activation_status === "SMS_SENT") {
          nextDeviceStatus = "WAITING_FOR_DEVICE";
        }
      } else if (deliveryStatus === "FAILED" || deliveryStatus === "TIMED_OUT") {
        completedIso = new Date(timestampMs).toISOString();
        if (devRow.activation_status !== "ACTIVATED") {
          nextDeviceStatus = "FAILED";
        }
      }

      const updatedLogRes = await tx.query(
        `UPDATE public.activation_sms_logs
         SET status = $2,
             failure_reason = COALESCE($3, failure_reason),
             completed_at = $4
         WHERE id = $1
         RETURNING *`,
        [logRow.id, deliveryStatus, failureReason, completedIso]
      );
      const updatedDevRes = await tx.query(
        `UPDATE public.devices
         SET activation_status = $2
         WHERE id = $1
         RETURNING *`,
        [devRow.id, nextDeviceStatus]
      );

      return {
        device: this._mapDeviceRow(updatedDevRes.rows[0]),
        log: this._mapSmsLogRow(updatedLogRes.rows[0])
      };
    });

    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [result.device.id] });
    return result;
  }

  /**
   * Handles real inbound SMS reply from the tracker SIM (+20...).
   * Never activates the device or starts the subscription!
   */
  async handleInboundSmsReply({ fromE164, replyText, timestampMs = Date.now() }) {
    const result = await this.db.runSystemTransaction(async (tx) => {
      const devRes = await tx.query(
        `SELECT * FROM public.devices WHERE sim_e164_number = $1 LIMIT 1 FOR UPDATE`,
        [fromE164]
      );
      if (devRes.rows.length === 0) {
        throw new Error("DEVICE_FOR_SIM_NOT_FOUND");
      }
      const devRow = devRes.rows[0];

      const logsRes = await tx.query(
        `SELECT * FROM public.activation_sms_logs
         WHERE device_id = $1
         ORDER BY step_order ASC
         FOR UPDATE`,
        [devRow.id]
      );
      const targetRow =
        logsRes.rows.find((l) => l.status !== "REPLIED") ?? logsRes.rows[logsRes.rows.length - 1];

      let updatedLog = null;
      if (targetRow) {
        const uLog = await tx.query(
          `UPDATE public.activation_sms_logs
           SET status = 'REPLIED',
               device_reply = $2,
               completed_at = $3
           WHERE id = $1
           RETURNING *`,
          [targetRow.id, String(replyText ?? "").trim(), new Date(timestampMs).toISOString()]
        );
        updatedLog = this._mapSmsLogRow(uLog.rows[0]);
      }

      const nextStatus =
        devRow.activation_status === "SMS_SENT" || devRow.activation_status === "PENDING"
          ? "WAITING_FOR_DEVICE"
          : devRow.activation_status;

      const uDev = await tx.query(
        `UPDATE public.devices SET activation_status = $2 WHERE id = $1 RETURNING *`,
        [devRow.id, nextStatus]
      );

      return {
        device: this._mapDeviceRow(uDev.rows[0]),
        log: updatedLog
      };
    });

    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [result.device.id] });
    return result;
  }

  /**
   * Correlates real Traccar WebSocket/REST updates with VeloTrack devices in Supabase PostgreSQL.
   * Starts the subscription clock ONLY upon the first genuine Traccar connection.
   * Distinguishes indoor login/heartbeat without GPS fix from full satellite GPS fix.
   */
  async ingestTraccarUpdate({ traccarDevices = [], traccarPositions = [], eventTimeMs = Date.now() }) {
    const updatedDeviceIds = [];
    const newlyActivatedSubs = [];

    await this.db.runSystemTransaction(async (tx) => {
      for (const tcDev of traccarDevices) {
        const devRes = await tx.query(
          `SELECT * FROM public.devices
           WHERE traccar_device_id = $1 OR ($2::text IS NOT NULL AND imei = $2)
           LIMIT 1 FOR UPDATE`,
          [tcDev.id ?? -1, tcDev.uniqueId ?? null]
        );
        if (devRes.rows.length === 0) continue;
        const devRow = devRes.rows[0];

        if (tcDev.status === "online" || tcDev.lastUpdate) {
          const seenMs = tcDev.lastUpdate ? Date.parse(tcDev.lastUpdate) : eventTimeMs;
          const firstConnIso = devRow.first_connected_at
            ? new Date(devRow.first_connected_at).toISOString()
            : new Date(eventTimeMs).toISOString();
          const nextConnState = devRow.has_valid_fix ? "ONLINE_GPS_FIX" : "ONLINE_NO_FIX";

          await tx.query(
            `UPDATE public.devices
             SET activation_status = 'ACTIVATED',
                 connection_state = $2,
                 first_connected_at = $3,
                 last_seen_at = $4
             WHERE id = $1`,
            [devRow.id, nextConnState, firstConnIso, new Date(seenMs).toISOString()]
          );

          const startedSub = await this._startSubscriptionOnFirstConnectionTx(
            tx,
            devRow,
            eventTimeMs
          );
          if (startedSub) newlyActivatedSubs.push(startedSub);
          updatedDeviceIds.push(devRow.id);
        } else if (tcDev.status === "offline") {
          await tx.query(
            `UPDATE public.devices SET connection_state = 'OFFLINE' WHERE id = $1`,
            [devRow.id]
          );
          updatedDeviceIds.push(devRow.id);
        }
      }

      for (const pos of traccarPositions) {
        const devRes = await tx.query(
          `SELECT * FROM public.devices WHERE traccar_device_id = $1 LIMIT 1 FOR UPDATE`,
          [pos.deviceId]
        );
        if (devRes.rows.length === 0) continue;
        const devRow = devRes.rows[0];

        const seenMs = pos.fixTime ? Date.parse(pos.fixTime) : eventTimeMs;
        const firstConnIso = devRow.first_connected_at
          ? new Date(devRow.first_connected_at).toISOString()
          : new Date(eventTimeMs).toISOString();

        const isGpsValid =
          pos.valid === true &&
          typeof pos.latitude === "number" &&
          typeof pos.longitude === "number";

        const nextHasValidFix = Boolean(devRow.has_valid_fix || isGpsValid);
        const nextConnState = nextHasValidFix ? "ONLINE_GPS_FIX" : "ONLINE_NO_FIX";
        const nextLat = isGpsValid ? pos.latitude : devRow.last_lat;
        const nextLng = isGpsValid ? pos.longitude : devRow.last_lng;
        const nextSpeed = isGpsValid
          ? typeof pos.speed === "number"
            ? Number((pos.speed * 1.852).toFixed(2))
            : 0
          : devRow.last_speed_kmh;
        const nextHeading = isGpsValid
          ? typeof pos.course === "number"
            ? pos.course
            : 0
          : devRow.last_heading;
        const nextIgnition =
          typeof pos.attributes?.ignition === "boolean"
            ? pos.attributes.ignition
            : devRow.ignition_on;

        await tx.query(
          `UPDATE public.devices
           SET activation_status = 'ACTIVATED',
               connection_state = $2,
               has_valid_fix = $3,
               last_lat = $4,
               last_lng = $5,
               last_speed_kmh = $6,
               last_heading = $7,
               ignition_on = $8,
               first_connected_at = $9,
               last_seen_at = $10
           WHERE id = $1`,
          [
            devRow.id,
            nextConnState,
            nextHasValidFix,
            nextLat,
            nextLng,
            nextSpeed,
            nextHeading,
            nextIgnition,
            firstConnIso,
            new Date(seenMs).toISOString()
          ]
        );

        const startedSub = await this._startSubscriptionOnFirstConnectionTx(
          tx,
          devRow,
          eventTimeMs
        );
        if (startedSub) newlyActivatedSubs.push(startedSub);
        updatedDeviceIds.push(devRow.id);
      }
    });

    for (const sub of newlyActivatedSubs) {
      if (sub.expiresAtMs) {
        this.scheduleExactExpiryCutoff(sub.deviceId, sub.expiresAtMs);
      }
    }

    const deduped = [...new Set(updatedDeviceIds)];
    if (deduped.length > 0) {
      await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: deduped });
    }
    return deduped;
  }

  async _startSubscriptionOnFirstConnectionTx(tx, devRow, eventTimeMs) {
    const subRes = await tx.query(
      `SELECT * FROM public.subscriptions WHERE device_id = $1 FOR UPDATE`,
      [devRow.id]
    );
    if (subRes.rows.length === 0) return null;
    const subRow = subRes.rows[0];
    if (subRow.status !== "AWAITING_FIRST_CONNECTION") return null;

    const expiresAtMs = computeExpiryMillis(eventTimeMs, subRow.plan_duration);
    const uSub = await tx.query(
      `UPDATE public.subscriptions
       SET status = 'ACTIVE',
           started_at = $2,
           expires_at = $3
       WHERE id = $1
       RETURNING *`,
      [
        subRow.id,
        new Date(eventTimeMs).toISOString(),
        expiresAtMs ? new Date(expiresAtMs).toISOString() : null
      ]
    );

    await tx.query(
      `INSERT INTO public.subscription_history (
         device_id, customer_id, action_type, plan_duration, actor_user_id, notes, created_at
       ) VALUES ($1,$2,'STARTED_ON_1ST_CONNECTION',$3,NULL,'Started automatically on 1st confirmed Traccar connection',$4)`,
      [
        devRow.id,
        devRow.current_customer_id,
        subRow.plan_duration,
        new Date(eventTimeMs).toISOString()
      ]
    );

    return this._mapSubscriptionRow(uSub.rows[0]);
  }

  async adminOverrideActivation(actorClaims, { deviceId, auditReason, nowMs = Date.now() }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const cleanReason = String(auditReason ?? "").trim();
    if (cleanReason.length < 4) {
      throw new Error("AUDIT_REASON_REQUIRED");
    }

    const result = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const devRes = await tx.query(
        `SELECT * FROM public.devices WHERE id = $1 FOR UPDATE`,
        [deviceId]
      );
      const subRes = await tx.query(
        `SELECT * FROM public.subscriptions WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      if (devRes.rows.length === 0 || subRes.rows.length === 0) {
        throw new Error("DEVICE_NOT_FOUND");
      }
      const devRow = devRes.rows[0];
      const subRow = subRes.rows[0];

      const startedMs = subRow.started_at ? new Date(subRow.started_at).getTime() : nowMs;
      const expiresAtMs = computeExpiryMillis(startedMs, subRow.plan_duration);

      const uDev = await tx.query(
        `UPDATE public.devices
         SET activation_status = 'ACTIVATED',
             first_connected_at = COALESCE(first_connected_at, $2)
         WHERE id = $1
         RETURNING *`,
        [deviceId, new Date(nowMs).toISOString()]
      );

      const uSub = await tx.query(
        `UPDATE public.subscriptions
         SET status = 'ACTIVE',
             started_at = $2,
             expires_at = $3,
             admin_override_by = $4,
             admin_override_reason = $5
         WHERE device_id = $1
         RETURNING *`,
        [
          deviceId,
          new Date(startedMs).toISOString(),
          expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
          actorClaims.userId,
          cleanReason
        ]
      );

      await tx.query(
        `INSERT INTO public.subscription_history (
           device_id, customer_id, action_type, plan_duration, actor_user_id, notes, created_at
         ) VALUES ($1,$2,'ADMIN_OVERRIDE',$3,$4,$5,$6)`,
        [
          deviceId,
          devRow.current_customer_id,
          subRow.plan_duration,
          actorClaims.userId,
          cleanReason,
          new Date(nowMs).toISOString()
        ]
      );

      return {
        device: this._mapDeviceRow(uDev.rows[0]),
        subscription: this._mapSubscriptionRow(uSub.rows[0])
      };
    });

    if (result.subscription.expiresAtMs) {
      this.scheduleExactExpiryCutoff(deviceId, result.subscription.expiresAtMs);
    }
    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [deviceId] });
    return result;
  }

  async enforceSubscriptionExpiry(deviceId, nowMs = Date.now()) {
    return this.db.runSystemTransaction(async (tx) => {
      return this._enforceSubscriptionExpiryTx(tx, deviceId, nowMs);
    });
  }

  async _enforceSubscriptionExpiryTx(tx, deviceId, nowMs = Date.now()) {
    const subRes = await tx.query(
      `SELECT * FROM public.subscriptions WHERE device_id = $1 FOR UPDATE`,
      [deviceId]
    );
    if (subRes.rows.length === 0) {
      throw new Error("SUBSCRIPTION_NOT_FOUND");
    }
    const sub = this._mapSubscriptionRow(subRes.rows[0]);
    if (
      sub.status === "ACTIVE" &&
      sub.planDuration !== "LIFETIME" &&
      sub.expiresAtMs !== null &&
      sub.expiresAtMs <= nowMs
    ) {
      await tx.query(
        `UPDATE public.subscriptions SET status = 'EXPIRED' WHERE id = $1`,
        [sub.id]
      );
      await tx.query(
        `INSERT INTO public.subscription_history (
           device_id, customer_id, action_type, plan_duration, actor_user_id, notes, created_at
         ) VALUES ($1,$2,'EXPIRED',$3,NULL,'Server-side subscription expiration enforced',$4)`,
        [deviceId, sub.customerId, sub.planDuration, new Date(nowMs).toISOString()]
      );
      return false;
    }
    return (
      sub.status === "ACTIVE" &&
      (sub.planDuration === "LIFETIME" || (sub.expiresAtMs ?? 0) > nowMs)
    );
  }

  async renewSubscription(actorClaims, { deviceId, planDuration, nowMs = Date.now() }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const updatedSub = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const devRes = await tx.query(`SELECT * FROM public.devices WHERE id = $1 FOR UPDATE`, [
        deviceId
      ]);
      const subRes = await tx.query(
        `SELECT * FROM public.subscriptions WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      if (devRes.rows.length === 0 || subRes.rows.length === 0) {
        throw new Error("DEVICE_NOT_FOUND");
      }
      const devRow = devRes.rows[0];
      const sub = this._mapSubscriptionRow(subRes.rows[0]);

      const baseStart =
        sub.status === "ACTIVE" && sub.expiresAtMs !== null && sub.expiresAtMs > nowMs
          ? sub.expiresAtMs
          : nowMs;
      const startedAtMs = sub.startedAtMs ?? nowMs;
      const expiresAtMs = computeExpiryMillis(baseStart, planDuration);

      const uSub = await tx.query(
        `UPDATE public.subscriptions
         SET plan_duration = $2,
             status = 'ACTIVE',
             started_at = $3,
             expires_at = $4
         WHERE device_id = $1
         RETURNING *`,
        [
          deviceId,
          planDuration,
          new Date(startedAtMs).toISOString(),
          expiresAtMs ? new Date(expiresAtMs).toISOString() : null
        ]
      );

      await tx.query(
        `INSERT INTO public.subscription_history (
           device_id, customer_id, action_type, plan_duration, actor_user_id, notes, created_at
         ) VALUES ($1,$2,'RENEWED',$3,$4,$5,$6)`,
        [
          deviceId,
          devRow.current_customer_id,
          planDuration,
          actorClaims.userId,
          `Renewed to ${planDuration}`,
          new Date(nowMs).toISOString()
        ]
      );

      return this._mapSubscriptionRow(uSub.rows[0]);
    });

    if (updatedSub.expiresAtMs) {
      this.scheduleExactExpiryCutoff(deviceId, updatedSub.expiresAtMs);
    }
    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [deviceId] });
    return updatedSub;
  }

  async reassignCustomer(actorClaims, { deviceId, newCustomerId, reason, nowMs = Date.now() }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const result = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const devRes = await tx.query(`SELECT * FROM public.devices WHERE id = $1 FOR UPDATE`, [
        deviceId
      ]);
      const subRes = await tx.query(
        `SELECT * FROM public.subscriptions WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      const custRes = await tx.query(
        `SELECT * FROM public.users_profile WHERE id = $1 AND role = 'CUSTOMER' AND is_active = TRUE`,
        [newCustomerId]
      );
      if (devRes.rows.length === 0 || subRes.rows.length === 0 || custRes.rows.length === 0) {
        throw new Error("INVALID_REASSIGNMENT_TARGET");
      }

      const previousCustomerId = devRes.rows[0].current_customer_id;
      const uDev = await tx.query(
        `UPDATE public.devices SET current_customer_id = $2 WHERE id = $1 RETURNING *`,
        [deviceId, newCustomerId]
      );
      const uSub = await tx.query(
        `UPDATE public.subscriptions SET customer_id = $2 WHERE device_id = $1 RETURNING *`,
        [deviceId, newCustomerId]
      );

      await tx.query(
        `INSERT INTO public.device_ownership_history (
           device_id, previous_customer_id, new_customer_id, reassigned_by_admin_id, reason, reassigned_at
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          deviceId,
          previousCustomerId,
          newCustomerId,
          actorClaims.userId,
          String(reason ?? "").trim() || "Reassigned",
          new Date(nowMs).toISOString()
        ]
      );

      return {
        device: this._mapDeviceRow(uDev.rows[0]),
        subscription: this._mapSubscriptionRow(uSub.rows[0])
      };
    });

    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [deviceId] });
    return result;
  }

  /**
   * Lists devices visible to the caller, enforcing both PostgreSQL RLS (`SET LOCAL ROLE authenticated`)
   * and server-side subscription expiration + coordinate redaction.
   */
  async listAuthorizedDevices(actorClaims, nowMs = Date.now()) {
    // First ensure any expired subscriptions are updated in DB
    await this.db.runSystemTransaction(async (tx) => {
      const activeSubs = await tx.query(
        `SELECT device_id FROM public.subscriptions WHERE status = 'ACTIVE' AND plan_duration <> 'LIFETIME'`
      );
      for (const row of activeSubs.rows) {
        await this._enforceSubscriptionExpiryTx(tx, row.device_id, nowMs);
      }
    });

    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);

      // Because RLS is active on `public.devices`, a CUSTOMER query only returns rows where current_customer_id = request_user_id()
      const devRes = await tx.query(`SELECT * FROM public.devices ORDER BY created_at DESC`);
      const bundles = [];

      for (const dRow of devRes.rows) {
        const device = this._mapDeviceRow(dRow);
        const [subRes, custRes, profRes, smsRes, subHistRes, ownHistRes] = await Promise.all([
          tx.query(`SELECT * FROM public.subscriptions WHERE device_id = $1`, [device.id]),
          tx.query(
            `SELECT id, username, email, phone, full_name, role, must_change_password, is_active, created_at
             FROM public.users_profile WHERE id = $1`,
            [device.currentCustomerId]
          ),
          tx.query(`SELECT * FROM public.device_profiles WHERE id = $1`, [device.profileId]),
          tx.query(
            `SELECT * FROM public.activation_sms_logs WHERE device_id = $1 ORDER BY step_order ASC`,
            [device.id]
          ),
          tx.query(
            `SELECT * FROM public.subscription_history WHERE device_id = $1 ORDER BY created_at DESC`,
            [device.id]
          ),
          tx.query(
            `SELECT * FROM public.device_ownership_history WHERE device_id = $1 ORDER BY reassigned_at DESC`,
            [device.id]
          )
        ]);

        const sub = subRes.rows[0] ? this._mapSubscriptionRow(subRes.rows[0]) : null;
        const accessible =
          sub !== null &&
          sub.status === "ACTIVE" &&
          (sub.planDuration === "LIFETIME" || (sub.expiresAtMs ?? 0) > nowMs);

        const safeDevice =
          !accessible && actorClaims.role === "CUSTOMER"
            ? {
                ...device,
                lastLat: null,
                lastLng: null,
                lastSpeedKmh: null,
                lastHeading: null,
                hasValidFix: false
              }
            : device;

        bundles.push({
          device: safeDevice,
          subscription: sub,
          customer: custRes.rows[0] ? this._mapUserRow(custRes.rows[0]) : null,
          profile: profRes.rows[0] ? this._mapProfileRow(profRes.rows[0]) : null,
          smsLogs: smsRes.rows.map((r) => this._mapSmsLogRow(r)),
          subscriptionHistory: subHistRes.rows.map((r) => this._mapSubHistoryRow(r)),
          ownershipHistory: ownHistRes.rows.map((r) => this._mapOwnershipHistoryRow(r))
        });
      }

      return bundles;
    });
  }

  async getAuthorizedRouteHistory(actorClaims, { deviceId, fromIso, toIso, nowMs = Date.now() }) {
    const accessible = await this.enforceSubscriptionExpiry(deviceId, nowMs);
    const device = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const res = await tx.query(`SELECT * FROM public.devices WHERE id = $1`, [deviceId]);
      if (res.rows.length === 0) {
        // Check if device exists at all to return 403 vs 404
        return null;
      }
      return this._mapDeviceRow(res.rows[0]);
    });

    if (!device) {
      const existsInSystem = await this.db.runSystemTransaction(async (tx) => {
        const r = await tx.query(`SELECT id FROM public.devices WHERE id = $1`, [deviceId]);
        return r.rows.length > 0;
      });
      if (existsInSystem) {
        throw new Error("FORBIDDEN_TENANT_ISOLATION");
      }
      throw new Error("DEVICE_NOT_FOUND");
    }

    if (!accessible) {
      throw new Error("SUBSCRIPTION_EXPIRED");
    }
    return this.traccarClient.fetchRouteHistory(device.traccarDeviceId, fromIso, toIso);
  }

  _mapUserRow(row) {
    return {
      id: row.id,
      username: row.username ?? null,
      email: row.email,
      phone: row.phone,
      fullName: row.full_name,
      role: row.role,
      mustChangePassword: Boolean(row.must_change_password),
      isActive: Boolean(row.is_active),
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : 0
    };
  }

  _mapProfileRow(row) {
    return {
      id: row.id,
      manufacturer: row.manufacturer,
      model: row.model,
      firmwareVersion: row.firmware_version,
      traccarProtocol: row.traccar_protocol,
      serverHost: row.server_host,
      serverPort: Number(row.server_port),
      transport: row.transport,
      serverMode: row.server_mode,
      requiresDevicePassword: Boolean(row.requires_device_password),
      defaultDevicePassword: row.default_device_password ?? null,
      requiresGprsonCommand: Boolean(row.requires_gprson_command),
      serverCommandTemplate: row.server_command_template,
      gprsonCommandTemplate: row.gprson_command_template ?? null,
      optionalTimerCommandTemplate: row.optional_timer_command_template ?? null,
      expectedReplyPattern: row.expected_reply_pattern ?? null,
      isVerified: Boolean(row.is_verified),
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : 0
    };
  }

  _mapDeviceRow(row) {
    return {
      id: row.id,
      imei: row.imei,
      traccarDeviceId: Number(row.traccar_device_id),
      profileId: row.profile_id,
      currentCustomerId: row.current_customer_id,
      vehicleName: row.vehicle_name,
      plateNumber: row.plate_number,
      simLocalNumber: row.sim_local_number,
      simE164Number: row.sim_e164_number,
      activationStatus: row.activation_status,
      connectionState: row.connection_state,
      hasValidFix: Boolean(row.has_valid_fix),
      lastLat: row.last_lat !== null && row.last_lat !== undefined ? Number(row.last_lat) : null,
      lastLng: row.last_lng !== null && row.last_lng !== undefined ? Number(row.last_lng) : null,
      lastSpeedKmh:
        row.last_speed_kmh !== null && row.last_speed_kmh !== undefined
          ? Number(row.last_speed_kmh)
          : null,
      lastHeading:
        row.last_heading !== null && row.last_heading !== undefined
          ? Number(row.last_heading)
          : null,
      ignitionOn:
        row.ignition_on !== null && row.ignition_on !== undefined
          ? Boolean(row.ignition_on)
          : null,
      firstConnectedAtMs: row.first_connected_at
        ? new Date(row.first_connected_at).getTime()
        : null,
      lastSeenAtMs: row.last_seen_at ? new Date(row.last_seen_at).getTime() : null,
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : 0
    };
  }

  _mapSubscriptionRow(row) {
    return {
      id: row.id,
      deviceId: row.device_id,
      customerId: row.customer_id,
      planDuration: row.plan_duration,
      status: row.status,
      startedAtMs: row.started_at ? new Date(row.started_at).getTime() : null,
      expiresAtMs: row.expires_at ? new Date(row.expires_at).getTime() : null,
      adminOverrideBy: row.admin_override_by ?? null,
      adminOverrideReason: row.admin_override_reason ?? null
    };
  }

  _mapSmsLogRow(row) {
    return {
      id: row.id,
      deviceId: row.device_id,
      stepOrder: Number(row.step_order),
      commandKey: row.command_key,
      commandText: row.command_text,
      gatewayMessageId: row.gateway_message_id ?? null,
      status: row.status,
      deviceReply: row.device_reply ?? null,
      failureReason: row.failure_reason ?? null,
      sentAtMs: row.sent_at ? new Date(row.sent_at).getTime() : 0,
      completedAtMs: row.completed_at ? new Date(row.completed_at).getTime() : null
    };
  }

  _mapSubHistoryRow(row) {
    return {
      id: row.id,
      deviceId: row.device_id,
      customerId: row.customer_id,
      actionType: row.action_type,
      planDuration: row.plan_duration,
      actorUserId: row.actor_user_id ?? null,
      notes: row.notes,
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : 0
    };
  }

  _mapOwnershipHistoryRow(row) {
    return {
      id: row.id,
      deviceId: row.device_id,
      previousCustomerId: row.previous_customer_id ?? null,
      newCustomerId: row.new_customer_id,
      reassignedByAdminId: row.reassigned_by_admin_id,
      reason: row.reason,
      reassignedAtMs: row.reassigned_at ? new Date(row.reassigned_at).getTime() : 0
    };
  }
}

/**
 * Authenticated `/ws/live` WebSocket Hub for Android & Web Clients
 * Enforces JWT verification, `must_change_password === false`, customer tenant isolation,
 * inline subscription expiration checks, and initial state reconciliation on connect.
 */
export class LiveWebSocketHub {
  constructor({ httpServer, engine, authService }) {
    this.engine = engine;
    this.authService = authService;
    this.clients = new Set();
    this.wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (req, socket, head) => {
      try {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname !== "/ws/live") {
          socket.destroy();
          return;
        }
        const authHeader = req.headers.authorization ?? "";
        const bearerToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length).trim()
          : url.searchParams.get("token");
        const claims = this.authService.verifyToken(bearerToken);

        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this._handleConnection(ws, claims);
        });
      } catch {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      }
    });

    this._unsubscribeEngine = this.engine.onLiveStateChange(async (event) => {
      await this.broadcastAuthorizedUpdate(event.type, event.deviceIds ?? []);
    });
  }

  async _handleConnection(ws, claims) {
    const clientEntry = { ws, claims };
    try {
      // Reconcile state immediately upon connection and verify must_change_password === false
      const authorizedDevices = await this.engine.listAuthorizedDevices(claims);
      this.clients.add(clientEntry);

      ws.send(
        JSON.stringify({
          type: "SNAPSHOT",
          timestampMs: Date.now(),
          devices: authorizedDevices
        })
      );

      ws.on("close", () => {
        this.clients.delete(clientEntry);
      });
      ws.on("error", () => {
        this.clients.delete(clientEntry);
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: "ERROR", error: err.message }));
      ws.close(1008, err.message);
    }
  }

  async broadcastAuthorizedUpdate(eventType, affectedDeviceIds = []) {
    for (const client of [...this.clients]) {
      if (client.ws.readyState !== WebSocket.OPEN) {
        this.clients.delete(client);
        continue;
      }
      try {
        const visibleBundles = await this.engine.listAuthorizedDevices(client.claims);
        const filtered =
          affectedDeviceIds.length > 0
            ? visibleBundles.filter((b) => affectedDeviceIds.includes(b.device.id))
            : visibleBundles;

        if (filtered.length > 0 || client.claims.role === "ADMIN") {
          client.ws.send(
            JSON.stringify({
              type: eventType,
              timestampMs: Date.now(),
              devices: filtered
            })
          );
        }
      } catch (err) {
        if (err.message === "PASSWORD_CHANGE_REQUIRED" || err.message.startsWith("AUTH_")) {
          client.ws.close(1008, err.message);
          this.clients.delete(client);
        }
      }
    }
  }

  close() {
    if (this._unsubscribeEngine) {
      this._unsubscribeEngine();
    }
    for (const client of this.clients) {
      try {
        client.ws.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.wss.close();
  }
}
