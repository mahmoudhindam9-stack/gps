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

export const VEHICLE_TYPES = [
  "CAR",
  "MOTORCYCLE",
  "TRUCK",
  "BUS",
  "VAN",
  "EQUIPMENT",
  "OTHER"
];

export const VEHICLE_ICONS = [
  "car",
  "suv",
  "motorcycle",
  "truck",
  "bus",
  "van",
  "pickup",
  "tractor"
];

export const OFFICIAL_TRACCAR_COMMANDS = {
  positionSingle: {
    type: "positionSingle",
    labelAr: "طلب موقع فوري",
    labelEn: "Single Position Request",
    isSensitive: false,
    sensitive: false,
    requiresConfirmation: false,
    customerPermitted: true,
    parameters: []
  },
  engineStop: {
    type: "engineStop",
    labelAr: "إيقاف المحرك",
    labelEn: "Engine Stop",
    isSensitive: true,
    sensitive: true,
    requiresConfirmation: true,
    customerPermitted: true,
    parameters: []
  },
  engineResume: {
    type: "engineResume",
    labelAr: "استئناف المحرك",
    labelEn: "Engine Resume",
    isSensitive: true,
    sensitive: true,
    requiresConfirmation: true,
    customerPermitted: true,
    parameters: []
  },
  outputControl: {
    type: "outputControl",
    labelAr: "التحكم في المخرجات",
    labelEn: "Output Control",
    isSensitive: true,
    sensitive: true,
    requiresConfirmation: true,
    customerPermitted: false,
    parameters: ["index", "data"]
  },
  rebootDevice: {
    type: "rebootDevice",
    labelAr: "إعادة تشغيل الجهاز",
    labelEn: "Reboot Device",
    isSensitive: true,
    sensitive: true,
    requiresConfirmation: true,
    customerPermitted: false,
    parameters: []
  },
  setTimezone: {
    type: "setTimezone",
    labelAr: "ضبط المنطقة الزمنية",
    labelEn: "Set Timezone",
    isSensitive: false,
    sensitive: false,
    requiresConfirmation: false,
    customerPermitted: false,
    parameters: ["timezone"]
  },
  custom: {
    type: "custom",
    labelAr: "أمر مخصص",
    labelEn: "Custom Command",
    isSensitive: true,
    sensitive: true,
    requiresConfirmation: true,
    customerPermitted: false,
    parameters: ["data"]
  }
};

export const PROTOCOL_SUPPORTED_COMMANDS = {
  gt06: ["positionSingle", "engineStop", "engineResume", "rebootDevice", "setTimezone", "custom"],
  teltonika: ["positionSingle", "outputControl", "rebootDevice", "custom"],
  coban: ["positionSingle", "engineStop", "engineResume", "custom"],
  tk103: ["positionSingle", "engineStop", "engineResume", "custom"]
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

/**
 * Normalizes Egyptian user phone numbers (accepting local `010...`, `10...`, or `+2010...`, `002010...`)
 * into canonical E.164 format (`+2010...`).
 */
export function normalizeEgyptianPhone(rawInput) {
  const cleaned = String(rawInput ?? "").trim().replace(/[\s()-]/g, "");
  if (!cleaned) {
    return { isValid: false, localNumber: "", e164Number: "", errorReason: "Phone required" };
  }
  let stripped = cleaned;
  if (stripped.startsWith("+20")) {
    stripped = stripped.slice(3);
  } else if (stripped.startsWith("0020")) {
    stripped = stripped.slice(4);
  } else if (stripped.startsWith("20") && stripped.length === 12) {
    stripped = stripped.slice(2);
  }
  if (stripped.length === 11 && stripped.startsWith("0")) {
    stripped = stripped.slice(1);
  }
  if (!/^(10|11|12|15)\d{8}$/.test(stripped)) {
    return {
      isValid: false,
      localNumber: cleaned,
      e164Number: "",
      errorReason: "Invalid Egyptian phone number"
    };
  }
  return {
    isValid: true,
    localNumber: `0${stripped}`,
    e164Number: `+20${stripped}`,
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

export const VELOTRACK_APP_VERSION = "1.1.0";
export const DEFAULT_GITHUB_REPO = "mahmoudhindam9-stack/gps";

export function normalizeSemver(versionStr) {
  const clean = String(versionStr ?? "")
    .trim()
    .replace(/^v/i, "")
    .split("-")[0];
  const parts = clean.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n) || n < 0)) {
    return [0, 0, 0];
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareSemver(versionA, versionB) {
  const a = normalizeSemver(versionA);
  const b = normalizeSemver(versionB);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

export async function checkGitHubReleaseStatus({
  repo = process.env.VELOTRACK_GITHUB_REPO ?? DEFAULT_GITHUB_REPO,
  currentVersion = process.env.VELOTRACK_APP_VERSION ?? VELOTRACK_APP_VERSION,
  autoUpdateEnabled = process.env.VELOTRACK_AUTO_UPDATE_ENABLED !== "false",
  fetchImpl = globalThis.fetch
} = {}) {
  const cleanRepo = String(repo || DEFAULT_GITHUB_REPO).trim();
  const checkedAtMs = Date.now();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `VeloTrack-GPS/${currentVersion}`
  };

  try {
    let releaseObj = null;
    const latestRes = await fetchImpl(`https://api.github.com/repos/${cleanRepo}/releases/latest`, {
      headers
    });
    if (latestRes.ok) {
      releaseObj = await latestRes.json();
    } else if (latestRes.status === 404) {
      const listRes = await fetchImpl(`https://api.github.com/repos/${cleanRepo}/releases?per_page=1`, {
        headers
      });
      if (listRes.ok) {
        const list = await listRes.json();
        if (Array.isArray(list) && list.length > 0) {
          releaseObj = list[0];
        }
      }
    }

    if (!releaseObj || !releaseObj.tag_name) {
      return {
        currentVersion,
        repository: cleanRepo,
        latestVersion: currentVersion,
        tagName: `v${currentVersion}`,
        releaseName: `VeloTrack GPS v${currentVersion}`,
        publishedAt: null,
        htmlUrl: `https://github.com/${cleanRepo}/releases`,
        apkDownloadUrl: null,
        webBundleDownloadUrl: null,
        releaseNotes: "",
        updateAvailable: false,
        autoUpdateEnabled: Boolean(autoUpdateEnabled),
        checkedAtMs,
        status: "UP_TO_DATE"
      };
    }

    const tagName = String(releaseObj.tag_name);
    const latestVersion = tagName.replace(/^v/i, "");
    const assets = Array.isArray(releaseObj.assets) ? releaseObj.assets : [];
    const apkAsset = assets.find((a) => String(a?.name ?? "").toLowerCase().endsWith(".apk"));
    const webAsset = assets.find((a) => String(a?.name ?? "").toLowerCase().endsWith(".tar.gz"));
    const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;

    return {
      currentVersion,
      repository: cleanRepo,
      latestVersion,
      tagName,
      releaseName: String(releaseObj.name || tagName),
      publishedAt: releaseObj.published_at ?? null,
      htmlUrl: String(releaseObj.html_url || `https://github.com/${cleanRepo}/releases`),
      apkDownloadUrl: apkAsset?.browser_download_url ?? null,
      webBundleDownloadUrl: webAsset?.browser_download_url ?? null,
      releaseNotes: String(releaseObj.body ?? ""),
      updateAvailable,
      autoUpdateEnabled: Boolean(autoUpdateEnabled),
      checkedAtMs,
      status: updateAvailable ? "UPDATE_AVAILABLE" : "UP_TO_DATE"
    };
  } catch (err) {
    return {
      currentVersion,
      repository: cleanRepo,
      latestVersion: currentVersion,
      tagName: `v${currentVersion}`,
      releaseName: `VeloTrack GPS v${currentVersion}`,
      publishedAt: null,
      htmlUrl: `https://github.com/${cleanRepo}/releases`,
      apkDownloadUrl: null,
      webBundleDownloadUrl: null,
      releaseNotes: "",
      updateAvailable: false,
      autoUpdateEnabled: Boolean(autoUpdateEnabled),
      checkedAtMs,
      status: "OFFLINE",
      error: err.message ?? "GITHUB_UNREACHABLE"
    };
  }
}


/**
 * Supabase PostgreSQL Database Adapter
 * Enforces per-transaction Row-Level Security (RLS) context for all authenticated requests.
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
      // PGlite is a test-only compatibility fixture. Hosted Supabase already owns
      // auth.users and its roles, so production SQL never alters the auth schema.
      if (this.pglite) {
        await client.exec(`
          CREATE SCHEMA IF NOT EXISTS auth;
          CREATE TABLE IF NOT EXISTS auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE,
            phone VARCHAR(32) UNIQUE,
            encrypted_password TEXT,
            email_confirmed_at TIMESTAMPTZ,
            phone_confirmed_at TIMESTAMPTZ,
            raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
            raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
              CREATE ROLE authenticated NOLOGIN;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
              CREATE ROLE service_role NOLOGIN BYPASSRLS;
            END IF;
          END
          $;
          -- Test-only emulation of Supabase's privileged server role.
          -- Production Supabase auth schema and grants are never modified here.
          GRANT USAGE ON SCHEMA auth TO service_role;
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth.users TO service_role;
        `);
      }
      await client.exec(sqlText);
    });
  }

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

  async runTenantTransaction(actorClaims, callback) {
    if (!actorClaims || !actorClaims.userId || !actorClaims.role) {
      throw new Error("AUTH_CLAIMS_INVALID");
    }
    const claimsJson = JSON.stringify({
      sub: actorClaims.userId,
      role: "authenticated",
      user_role: actorClaims.role,
      email: actorClaims.email ?? "",
      phone: actorClaims.phone ?? ""
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
 * Supports phone-and-password and email-and-password authentication without fabricating emails,
 * plus single-use short-lived WebSocket tickets.
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
    this._wsTickets = new Map();

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

  signSupabaseJwt({ userId, email = null, phone = null, role, username }, expiresInSeconds = 3600 * 12) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const nowSec = Math.floor(Date.now() / 1000);
    const bodyObj = {
      aud: "authenticated",
      role: "authenticated",
      sub: userId,
      email: email ?? undefined,
      phone: phone ?? undefined,
      user_role: role,
      app_metadata: { provider: email ? "email" : "phone", role, username },
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
      email: claims.email ?? null,
      phone: claims.phone ?? null,
      username: claims.app_metadata?.username ?? claims.user_metadata?.username ?? null
    };
  }

  /**
   * Issues a short-lived (45s), single-use WebSocket ticket so browser clients
   * do not need to pass long-lived JWTs in URL query strings.
   */
  issueWebSocketTicket(claims, ttlMs = 45000) {
    const now = Date.now();
    for (const [k, v] of this._wsTickets.entries()) {
      if (v.expiresAtMs <= now) this._wsTickets.delete(k);
    }
    const ticket = crypto.randomBytes(24).toString("hex");
    this._wsTickets.set(ticket, {
      claims,
      expiresAtMs: now + ttlMs
    });
    return { ticket, expiresAtMs: now + ttlMs };
  }

  consumeWebSocketTicket(ticketOrObj) {
    const ticket =
      ticketOrObj && typeof ticketOrObj === "object" ? ticketOrObj.ticket : ticketOrObj;
    if (!ticket || typeof ticket !== "string") {
      throw new Error("AUTH_WS_TICKET_INVALID");
    }
    const entry = this._wsTickets.get(ticket);
    this._wsTickets.delete(ticket);
    if (!entry || entry.expiresAtMs <= Date.now()) {
      throw new Error("AUTH_WS_TICKET_EXPIRED");
    }
    return entry.claims;
  }

  async createAuthUser({ email = null, phone = null, password, role, username }) {
    const cleanEmail = email ? String(email).toLowerCase().trim() : null;
    const cleanPhone = phone ? String(phone).trim() : null;

    if (!cleanEmail && !cleanPhone) {
      throw new Error("AUTH_IDENTIFIER_REQUIRED");
    }

    if (this.adminClient) {
      const createPayload = {
        password,
        app_metadata: { role, username },
        user_metadata: { username }
      };
      if (cleanPhone) {
        createPayload.phone = cleanPhone;
        createPayload.phone_confirm = true;
      }
      if (cleanEmail) {
        createPayload.email = cleanEmail;
        createPayload.email_confirm = true;
      }
      const { data, error } = await this.adminClient.auth.admin.createUser(createPayload);
      if (error || !data?.user?.id) {
        const errMsg = error?.message ?? "unknown";
        if (/phone.*disable/i.test(errMsg)) {
          throw new Error(
            "SUPABASE_PHONE_AUTH_NOT_ENABLED: Enable GOTRUE_EXTERNAL_PHONE_ENABLED=true and GOTRUE_SMS_AUTOCONFIRM=true in self-hosted Supabase GoTrue"
          );
        }
        throw new Error(`SUPABASE_AUTH_CREATE_FAILED:${errMsg}`);
      }
      // Supabase Auth owns auth.users and password hashing. Never write encrypted_password directly.
      return { id: data.user.id, email: cleanEmail, phone: cleanPhone };
    }

    // Direct Supabase PostgreSQL `auth.users` persistence (self-hosted DB / test environment)
    return this.dbAdapter.runSystemTransaction(async (tx) => {
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO auth.users (
           id, email, phone, encrypted_password,
           email_confirmed_at, phone_confirmed_at,
           raw_app_meta_data, raw_user_meta_data
         )
         VALUES ($1, $2::text, $3::text, $4, CASE WHEN $2::text IS NOT NULL THEN NOW() ELSE NULL END, CASE WHEN $3::text IS NOT NULL THEN NOW() ELSE NULL END, $5::jsonb, $6::jsonb)`,
        [
          id,
          cleanEmail,
          cleanPhone,
          hashPassword(password),
          JSON.stringify({ role, username }),
          JSON.stringify({ username })
        ]
      );
      return { id, email: cleanEmail, phone: cleanPhone };
    });
  }

  async verifyUserPassword({ userId, email = null, phone = null, password }) {
    if (this.anonClient) {
      const credentials = email
        ? { email, password }
        : phone
        ? { phone, password }
        : null;
      if (!credentials) {
        return { valid: false, accessToken: null };
      }
      const { data, error } = await this.anonClient.auth.signInWithPassword(credentials);
      if (error || !data?.user) {
        if (error?.message && /phone.*disable/i.test(error.message)) {
          throw new Error(
            "SUPABASE_PHONE_AUTH_NOT_ENABLED: Enable GOTRUE_EXTERNAL_PHONE_ENABLED=true and GOTRUE_SMS_AUTOCONFIRM=true in self-hosted Supabase GoTrue"
          );
        }
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

  async updateAuthUserMetadata({ userId, email = undefined, phone = undefined, role, username }) {
    if (this.adminClient) {
      const payload = {
        app_metadata: { role, username },
        user_metadata: { username }
      };
      if (email !== undefined) {
        payload.email = email;
        if (email) payload.email_confirm = true;
      }
      if (phone !== undefined) {
        payload.phone = phone;
        if (phone) payload.phone_confirm = true;
      }
      const { error } = await this.adminClient.auth.admin.updateUserById(userId, payload);
      if (error) {
        throw new Error(`SUPABASE_AUTH_UPDATE_FAILED:${error.message}`);
      }
      return;
    }
    await this.dbAdapter.runSystemTransaction(async (tx) => {
      await tx.query(
        `UPDATE auth.users
         SET email = COALESCE($2, email),
             phone = COALESCE($3, phone),
             raw_app_meta_data = $4::jsonb,
             raw_user_meta_data = $5::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          userId,
          email !== undefined ? email : null,
          phone !== undefined ? phone : null,
          JSON.stringify({ role, username }),
          JSON.stringify({ username })
        ]
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

  async registerDeviceInTraccar({ name, imei, category = null }) {
    if (!this.sessionCookie) {
      await this.authenticateSession();
    }
    const payloadBody = { name, uniqueId: imei };
    if (category) payloadBody.category = String(category).toLowerCase();
    const res = await this.fetchImpl(`${this.baseUrl}/api/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: this.sessionCookie
      },
      body: JSON.stringify(payloadBody)
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

  async updateDeviceInTraccar({ traccarDeviceId, name, imei, category = null }) {
    if (!this.sessionCookie) {
      await this.authenticateSession();
    }
    const payloadBody = { id: Number(traccarDeviceId), name, uniqueId: imei };
    if (category) payloadBody.category = String(category).toLowerCase();
    const res = await this.fetchImpl(`${this.baseUrl}/api/devices/${traccarDeviceId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: this.sessionCookie
      },
      body: JSON.stringify(payloadBody)
    });
    if (res.status === 401) {
      this.sessionCookie = null;
      throw new Error("TRACCAR_UNAUTHORIZED");
    }
    if (!res.ok) {
      throw new Error(`TRACCAR_DEVICE_UPDATE_FAILED_${res.status}`);
    }
    return res.json();
  }

  async deleteDeviceInTraccar(traccarDeviceId) {
    if (!this.sessionCookie) {
      await this.authenticateSession();
    }
    const res = await this.fetchImpl(`${this.baseUrl}/api/devices/${traccarDeviceId}`, {
      method: "DELETE",
      headers: { Cookie: this.sessionCookie }
    });
    if (res.status === 401) {
      this.sessionCookie = null;
    }
    return res.ok;
  }

  async fetchSupportedCommandTypes(traccarDeviceId) {
    if (!this.sessionCookie) {
      await this.authenticateSession();
    }
    const params = new URLSearchParams({ deviceId: String(traccarDeviceId) });
    const res = await this.fetchImpl(`${this.baseUrl}/api/commands/types?${params.toString()}`, {
      headers: { Accept: "application/json", Cookie: this.sessionCookie }
    });
    if (res.status === 401) {
      this.sessionCookie = null;
      throw new Error("TRACCAR_SESSION_EXPIRED");
    }
    if (!res.ok) {
      return null;
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    return rows.map((r) => (typeof r === "string" ? r : r.type)).filter(Boolean);
  }

  async sendDeviceCommand({ traccarDeviceId, type, attributes = {}, description = "" }) {
    if (!this.sessionCookie) {
      await this.authenticateSession();
    }
    const res = await this.fetchImpl(`${this.baseUrl}/api/commands/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: this.sessionCookie
      },
      body: JSON.stringify({
        deviceId: Number(traccarDeviceId),
        type,
        attributes,
        description
      })
    });
    if (res.status === 401) {
      this.sessionCookie = null;
      throw new Error("TRACCAR_SESSION_EXPIRED");
    }
    if (!res.ok && res.status !== 202) {
      throw new Error(`TRACCAR_COMMAND_SEND_FAILED_${res.status}`);
    }
    let body = {};
    try {
      body = await res.json();
    } catch {
      body = { status: res.status };
    }
    return {
      queued: res.status === 202,
      response: body
    };
  }


  /**
   * Server-owned Traccar REST helper. Callers pass fixed API paths, never absolute URLs.
   */
  async requestApi(path, { method = "GET", body, contentType = "application/json" } = {}) {
    const rawPath = String(path ?? "");
    const safePath = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
    if (!safePath || safePath.includes("..") || safePath.includes("://")) {
      throw new Error("TRACCAR_API_PATH_INVALID");
    }
    if (!this.sessionCookie) await this.authenticateSession();
    const headers = { Accept: "application/json", Cookie: this.sessionCookie };
    let requestBody;
    if (body !== undefined) {
      headers["Content-Type"] = contentType;
      requestBody = contentType === "application/json" ? JSON.stringify(body) : String(body);
    }
    const response = await this.fetchImpl(`${this.baseUrl}/api/${safePath}`, {
      method,
      headers,
      ...(requestBody !== undefined ? { body: requestBody } : {})
    });
    if (response.status === 401) {
      this.sessionCookie = null;
      throw new Error("TRACCAR_SESSION_EXPIRED");
    }
    if (!response.ok && response.status !== 202) {
      throw new Error(`TRACCAR_API_REQUEST_FAILED_${response.status}`);
    }
    if (response.status === 204) return null;
    const raw = await response.text();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  _validatedTraccarIds(deviceIds) {
    const ids = [...new Set((Array.isArray(deviceIds) ? deviceIds : []).map(Number))];
    if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error("TRACCAR_DEVICE_IDS_REQUIRED");
    }
    return ids;
  }

  _reportQuery(deviceIds, fromIso, toIso) {
    const ids = this._validatedTraccarIds(deviceIds);
    const fromMs = Date.parse(fromIso);
    const toMs = Date.parse(toIso);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      throw new Error("INVALID_REPORT_WINDOW");
    }
    const params = new URLSearchParams();
    for (const id of ids) params.append("deviceId", String(id));
    params.set("from", new Date(fromMs).toISOString());
    params.set("to", new Date(toMs).toISOString());
    return params;
  }

  async fetchEvents(deviceIds, fromIso, toIso) {
    const rows = await this.requestApi("reports/events?" + this._reportQuery(deviceIds, fromIso, toIso));
    return Array.isArray(rows) ? rows : [];
  }

  async fetchMileageSummary(deviceIds, fromIso, toIso) {
    const rows = await this.requestApi("reports/summary?" + this._reportQuery(deviceIds, fromIso, toIso));
    return Array.isArray(rows) ? rows : [];
  }

  async fetchGeofencesForDevice(traccarDeviceId) {
    const id = Number(traccarDeviceId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("TRACCAR_DEVICE_ID_INVALID");
    const rows = await this.requestApi("geofences?deviceId=" + encodeURIComponent(String(id)));
    return Array.isArray(rows) ? rows : [];
  }

  async fetchAllGeofences() {
    const rows = await this.requestApi("geofences?all=true");
    return Array.isArray(rows) ? rows : [];
  }

  async createGeofence({ name, description = "", area, attributes = {} }) {
    return this.requestApi("geofences", {
      method: "POST",
      body: { name, description, area, attributes }
    });
  }

  async fetchGeofencePermissions(geofenceId) {
    const id = Number(geofenceId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("GEOFENCE_ID_INVALID");
    const rows = await this.requestApi(
      "permissions?geofenceId=" + encodeURIComponent(String(id)) + "&deviceId=0"
    );
    return Array.isArray(rows) ? rows : [];
  }

  async linkGeofenceToDevice(traccarDeviceId, geofenceId) {
    const deviceId = Number(traccarDeviceId);
    const zoneId = Number(geofenceId);
    if (!Number.isSafeInteger(deviceId) || deviceId <= 0 ||
        !Number.isSafeInteger(zoneId) || zoneId <= 0) {
      throw new Error("GEOFENCE_PERMISSION_INVALID");
    }
    return this.requestApi("permissions", {
      method: "POST",
      body: { deviceId, geofenceId: zoneId }
    });
  }

  async unlinkGeofenceFromDevice(traccarDeviceId, geofenceId) {
    const deviceId = Number(traccarDeviceId);
    const zoneId = Number(geofenceId);
    if (!Number.isSafeInteger(deviceId) || deviceId <= 0 ||
        !Number.isSafeInteger(zoneId) || zoneId <= 0) {
      throw new Error("GEOFENCE_PERMISSION_INVALID");
    }
    return this.requestApi("permissions", {
      method: "DELETE",
      body: { deviceId, geofenceId: zoneId }
    });
  }

  async deleteGeofence(geofenceId) {
    const id = Number(geofenceId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("GEOFENCE_ID_INVALID");
    return this.requestApi("geofences/" + encodeURIComponent(String(id)), { method: "DELETE" });
  }

  async createDeviceShare(traccarDeviceId, expiresAtIso) {
    const id = Number(traccarDeviceId);
    const expiresAt = new Date(expiresAtIso);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(expiresAt.getTime())) {
      throw new Error("DEVICE_SHARE_INPUT_INVALID");
    }
    const form = new URLSearchParams({
      deviceId: String(id),
      expiration: expiresAt.toISOString()
    });
    const token = await this.requestApi("share/device", {
      method: "POST",
      body: form.toString(),
      contentType: "application/x-www-form-urlencoded"
    });
    const clean = String(token ?? "").trim().replace(/^"+|"+$/g, "");
    if (!clean || clean.length > 4096) throw new Error("TRACCAR_SHARE_TOKEN_INVALID");
    return clean;
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
    if (typeof this._reconnectTimer.unref === "function") {
      this._reconnectTimer.unref();
    }
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
 */
export class VeloTrackEngine {
  constructor({ dbAdapter, authService, traccarClient, smsGateway }) {
    if (!dbAdapter) throw new Error("DB_ADAPTER_REQUIRED");
    this.db = dbAdapter;
    this.authService = authService;
    this.traccarClient = traccarClient;
    this.smsGateway = smsGateway;
    this.traccarPublicUrl = String(process.env.TRACCAR_PUBLIC_URL ?? "").trim();
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

  async bootstrapInitialAdminIfNeeded({
    adminEmail = process.env.VELOTRACK_INITIAL_ADMIN_EMAIL,
    adminUsername = process.env.VELOTRACK_INITIAL_ADMIN_USERNAME,
    adminPassword = process.env.VELOTRACK_INITIAL_ADMIN_PASSWORD,
    adminPhone = process.env.VELOTRACK_INITIAL_ADMIN_PHONE ?? ""
  } = {}) {
    const check = await this.db.runSystemTransaction(async (tx) => {
      const stateRes = await tx.query(
        `SELECT admin_bootstrapped, admin_user_id FROM public.bootstrap_state WHERE id = 1 FOR UPDATE`
      );
      const adminCountRes = await tx.query(
        `SELECT id, username, email FROM public.users_profile WHERE role = 'ADMIN' AND deleted_at IS NULL LIMIT 1`
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
    const rawPhone = String(adminPhone ?? "").trim();
    const phoneNorm = rawPhone ? normalizeEgyptianPhone(rawPhone) : null;
    if (rawPhone && !phoneNorm?.isValid) {
      throw new Error("BOOTSTRAP_ADMIN_PHONE_INVALID");
    }
    const finalPhone = phoneNorm?.isValid ? phoneNorm.e164Number : "";

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
      phone: finalPhone,
      password: rawPassword,
      role: "ADMIN",
      username: cleanUsername
    });

    await this.db.runSystemTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO public.users_profile (
           id, username, email, phone, full_name, role, must_change_password, is_active
         ) VALUES ($1, $2, $3, $4, $5, 'ADMIN', TRUE, TRUE)`,
        [authUser.id, cleanUsername, cleanEmail, finalPhone, "System Administrator"]
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
      phone: finalPhone,
      mustChangePassword: true
    };
  }

  /**
   * Ensures that the primary administrator account (`admin` / `Admin@123456` by default)
   * exists, is active, and has the expected credentials.
   */
  // Backward-compatible alias. Bootstrap is one-shot and never resets an existing admin password.
  async ensureAdminCredentials(options = {}) {
    return this.bootstrapInitialAdminIfNeeded(options);
  }

  /**
   * Authenticates by username, phone number (local `010...` or E.164 `+2010...`), or email.
   */
  async login(identifier, password) {
    const cleanId = String(identifier ?? "").trim();
    if (!cleanId || !password) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const phoneCandidate = normalizeEgyptianPhone(cleanId);
    const e164Candidate = phoneCandidate.isValid ? phoneCandidate.e164Number : cleanId;
    const localCandidate = phoneCandidate.isValid ? phoneCandidate.localNumber : cleanId;

    const profileRow = await this.db.runSystemTransaction(async (tx) => {
      const res = await tx.query(
        `SELECT id, username, email, phone, full_name, role, must_change_password, is_active, deleted_at, created_at
         FROM public.users_profile
         WHERE deleted_at IS NULL
           AND (
             LOWER(username) = LOWER($1)
             OR LOWER(COALESCE(email, '')) = LOWER($1)
             OR phone = $1
             OR phone = $2
             OR phone = $3
           )
         LIMIT 1`,
        [cleanId, e164Candidate, localCandidate]
      );
      return res.rows[0] ?? null;
    });

    if (!profileRow) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const authCheck = await this.authService.verifyUserPassword({
      userId: profileRow.id,
      email: profileRow.email,
      phone: profileRow.phone,
      password
    });

    if (!authCheck.valid) {
      throw new Error("INVALID_CREDENTIALS");
    }

    if (!profileRow.is_active) {
      throw new Error("ACCOUNT_DISABLED");
    }

    const token = this.authService.signSupabaseJwt({
      userId: profileRow.id,
      email: profileRow.email,
      phone: profileRow.phone,
      role: profileRow.role,
      username: profileRow.username
    });

    return {
      token,
      mustChangePassword: Boolean(profileRow.must_change_password),
      user: this._mapUserRow(profileRow)
    };
  }

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
         WHERE id = $1 AND deleted_at IS NULL`,
        [actorClaims.userId]
      );
      return res.rows[0] ?? null;
    });

    if (!profileRow || !profileRow.is_active) {
      throw new Error("AUTH_USER_NOT_FOUND");
    }

    const authCheck = await this.authService.verifyUserPassword({
      userId: profileRow.id,
      email: profileRow.email,
      phone: profileRow.phone,
      password: currentPassword
    });
    if (!authCheck.valid) {
      throw new Error("INVALID_CREDENTIALS");
    }

    await this.authService.updateAuthUserPassword({
      userId: profileRow.id,
      newPassword
    });

    // Password validation and Supabase Auth update have succeeded. Use the trusted
    // server-side transaction for this protected profile flag; customer rows are not
    // directly updatable by authenticated clients.
    const updatedRow = await this.db.runSystemTransaction(async (tx) => {
      const res = await tx.query(
        `UPDATE public.users_profile
         SET must_change_password = FALSE,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, username, email, phone, full_name, role, must_change_password, is_active, created_at`,
        [actorClaims.userId]
      );
      if (res.rows.length === 0) throw new Error("AUTH_USER_NOT_FOUND");
      return res.rows[0];
    });

    const freshToken = this.authService.signSupabaseJwt({
      userId: updatedRow.id,
      email: updatedRow.email,
      phone: updatedRow.phone,
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
         WHERE id = $1 AND deleted_at IS NULL`,
        [actorClaims.userId]
      );
      if (res.rows.length === 0 || !res.rows[0].is_active) {
        throw new Error("AUTH_USER_NOT_FOUND");
      }
      return this._mapUserRow(res.rows[0]);
    });
  }

  async _assertActiveAndPasswordUpdated(tx, actorClaims) {
    const res = await tx.query(
      `SELECT id, role, must_change_password, is_active, deleted_at
       FROM public.users_profile
       WHERE id = $1`,
      [actorClaims.userId]
    );
    const user = res.rows[0];
    if (!user || !user.is_active || user.deleted_at) {
      throw new Error("AUTH_USER_NOT_FOUND");
    }
    if (user.must_change_password) {
      throw new Error("PASSWORD_CHANGE_REQUIRED");
    }
    return user;
  }

  /**
   * Creates a user account (ADMIN or CUSTOMER) with:
   * - Full name, Phone number (normalized E.164), Username, Password, Role (ADMIN or CUSTOMER).
   * - Email is optional and never fabricated.
   */
  async createUserAccount(
    actorClaims,
    {
      username,
      phone,
      fullName,
      password,
      role = "CUSTOMER",
      email = null,
      mustChangePassword = false
    }
  ) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
    });

    const cleanFullName = String(fullName ?? "").trim();
    const cleanUsername = String(username ?? "").trim();
    const cleanRole = String(role ?? "CUSTOMER").toUpperCase().trim();
    const cleanEmail = email && String(email).trim() ? String(email).toLowerCase().trim() : null;
    const phoneNorm = normalizeEgyptianPhone(phone);

    if (
      !cleanFullName ||
      !cleanUsername ||
      !phoneNorm.isValid ||
      !password ||
      String(password).length < 8 ||
      !["ADMIN", "CUSTOMER"].includes(cleanRole) ||
      (cleanEmail !== null && !cleanEmail.includes("@"))
    ) {
      throw new Error("INVALID_CUSTOMER_INPUT");
    }

    await this.db.runTenantTransaction(actorClaims, async (tx) => {
      const dupUsername = await tx.query(
        `SELECT id FROM public.users_profile WHERE LOWER(username) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
        [cleanUsername]
      );
      if (dupUsername.rows.length > 0) {
        throw new Error("DUPLICATE_USERNAME");
      }
      const dupPhone = await tx.query(
        `SELECT id FROM public.users_profile WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
        [phoneNorm.e164Number]
      );
      if (dupPhone.rows.length > 0) {
        throw new Error("DUPLICATE_PHONE");
      }
      if (cleanEmail) {
        const dupEmail = await tx.query(
          `SELECT id FROM public.users_profile WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
          [cleanEmail]
        );
        if (dupEmail.rows.length > 0) {
          throw new Error("DUPLICATE_EMAIL");
        }
      }
    });

    const authUser = await this.authService.createAuthUser({
      email: cleanEmail,
      phone: phoneNorm.e164Number,
      password: String(password),
      role: cleanRole,
      username: cleanUsername
    });

    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      const res = await tx.query(
        `INSERT INTO public.users_profile (
           id, username, email, phone, full_name, role, must_change_password, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         RETURNING id, username, email, phone, full_name, role, must_change_password, is_active, created_at`,
        [
          authUser.id,
          cleanUsername,
          cleanEmail,
          phoneNorm.e164Number,
          cleanFullName,
          cleanRole,
          Boolean(mustChangePassword)
        ]
      );
      return this._mapUserRow(res.rows[0]);
    });
  }

  async createCustomerAccount(actorClaims, input) {
    return this.createUserAccount(actorClaims, {
      ...input,
      role: input.role ?? "CUSTOMER"
    });
  }

  async _isPrimaryAdmin(tx, userId) {
    const bootRes = await tx.query(
      `SELECT admin_user_id FROM public.bootstrap_state WHERE id = 1`
    );
    if (bootRes.rows[0]?.admin_user_id === userId) return true;
    const uRes = await tx.query(
      `SELECT username, role FROM public.users_profile WHERE id = $1`,
      [userId]
    );
    return (
      uRes.rows[0]?.role === "ADMIN" &&
      String(uRes.rows[0]?.username ?? "").toLowerCase() === "admin"
    );
  }

  async updateUserAccount(
    actorClaims,
    userId,
    { fullName, phone, username, email, role, password }
  ) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }

    const existing = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const uRes = await tx.query(
        `SELECT * FROM public.users_profile WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      if (uRes.rows.length === 0) throw new Error("USER_NOT_FOUND");
      const isPrimary = await this._isPrimaryAdmin(tx, userId);
      return { row: uRes.rows[0], isPrimary };
    });

    const nextFullName =
      fullName !== undefined ? String(fullName).trim() : existing.row.full_name;
    const nextUsername =
      username !== undefined ? String(username).trim() : existing.row.username;
    const nextRole =
      role !== undefined ? String(role).toUpperCase().trim() : existing.row.role;
    const nextEmail =
      email !== undefined
        ? String(email ?? "").trim()
          ? String(email).toLowerCase().trim()
          : null
        : existing.row.email;

    let nextPhone = existing.row.phone;
    if (phone !== undefined) {
      const pNorm = normalizeEgyptianPhone(phone);
      if (!pNorm.isValid) throw new Error("INVALID_CUSTOMER_INPUT");
      nextPhone = pNorm.e164Number;
    }

    if (!nextFullName || !nextUsername || !["ADMIN", "CUSTOMER"].includes(nextRole)) {
      throw new Error("INVALID_CUSTOMER_INPUT");
    }
    if (existing.isPrimary && nextRole !== "ADMIN") {
      throw new Error("CANNOT_DEMOTE_PRIMARY_ADMIN");
    }

    await this.db.runTenantTransaction(actorClaims, async (tx) => {
      const dupU = await tx.query(
        `SELECT id FROM public.users_profile
         WHERE LOWER(username) = LOWER($1) AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
        [nextUsername, userId]
      );
      if (dupU.rows.length > 0) throw new Error("DUPLICATE_USERNAME");

      const dupP = await tx.query(
        `SELECT id FROM public.users_profile
         WHERE phone = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
        [nextPhone, userId]
      );
      if (dupP.rows.length > 0) throw new Error("DUPLICATE_PHONE");

      if (nextEmail) {
        const dupE = await tx.query(
          `SELECT id FROM public.users_profile
           WHERE LOWER(email) = LOWER($1) AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
          [nextEmail, userId]
        );
        if (dupE.rows.length > 0) throw new Error("DUPLICATE_EMAIL");
      }
    });

    await this.authService.updateAuthUserMetadata({
      userId,
      email: nextEmail,
      phone: nextPhone,
      role: nextRole,
      username: nextUsername
    });

    if (password && String(password).trim().length > 0) {
      if (String(password).length < 8) {
        throw new Error("WEAK_NEW_PASSWORD");
      }
      await this.authService.updateAuthUserPassword({
        userId,
        newPassword: String(password)
      });
    }

    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      const res = await tx.query(
        `UPDATE public.users_profile
         SET full_name = $2,
             username = $3,
             phone = $4,
             email = $5,
             role = $6,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, username, email, phone, full_name, role, must_change_password, is_active, created_at`,
        [userId, nextFullName, nextUsername, nextPhone, nextEmail, nextRole]
      );
      return this._mapUserRow(res.rows[0]);
    });
  }

  async setUserActiveStatus(actorClaims, userId, { isActive }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const uRes = await tx.query(
        `SELECT * FROM public.users_profile WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      if (uRes.rows.length === 0) throw new Error("USER_NOT_FOUND");
      const isPrimary = await this._isPrimaryAdmin(tx, userId);
      if (!isActive && (isPrimary || userId === actorClaims.userId)) {
        throw new Error("CANNOT_DEACTIVATE_PRIMARY_ADMIN");
      }
      const res = await tx.query(
        `UPDATE public.users_profile
         SET is_active = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id, username, email, phone, full_name, role, must_change_password, is_active, created_at`,
        [userId, Boolean(isActive)]
      );
      return this._mapUserRow(res.rows[0]);
    });
  }

  async deleteUserAccount(actorClaims, userId) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const uRes = await tx.query(
        `SELECT * FROM public.users_profile WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      if (uRes.rows.length === 0) throw new Error("USER_NOT_FOUND");
      const isPrimary = await this._isPrimaryAdmin(tx, userId);
      if (isPrimary || userId === actorClaims.userId) {
        throw new Error("CANNOT_DELETE_PRIMARY_ADMIN");
      }
      const devCountRes = await tx.query(
        `SELECT COUNT(*)::int AS cnt FROM public.devices WHERE current_customer_id = $1`,
        [userId]
      );
      if ((devCountRes.rows[0]?.cnt ?? 0) > 0) {
        throw new Error("USER_HAS_ASSIGNED_VEHICLES");
      }
      const res = await tx.query(
        `UPDATE public.users_profile
         SET is_active = FALSE,
             deleted_at = NOW(),
             deleted_by = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, username, email, phone, full_name, role, must_change_password, is_active, deleted_at, created_at`,
        [userId, actorClaims.userId]
      );
      return {
        deleted: true,
        userId,
        user: this._mapUserRow(res.rows[0])
      };
    });
  }

  async listUsers(actorClaims, nowMs = Date.now()) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    await this._enforceAllExpiredSubscriptions(nowMs);
    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const res = await tx.query(
        `SELECT
           u.id, u.username, u.email, u.phone, u.full_name, u.role,
           u.must_change_password, u.is_active, u.deleted_at, u.created_at,
           COUNT(DISTINCT d.id)::int AS vehicle_count,
           COUNT(DISTINCT s.id)::int AS subscription_count,
           COUNT(DISTINCT CASE WHEN s.status = 'ACTIVE' THEN s.id END)::int AS active_subscription_count,
           COUNT(DISTINCT CASE WHEN s.status = 'AWAITING_FIRST_CONNECTION' THEN s.id END)::int AS pending_subscription_count,
           COUNT(DISTINCT CASE WHEN s.status = 'EXPIRED' THEN s.id END)::int AS expired_subscription_count,
           COUNT(DISTINCT CASE WHEN s.status = 'SUSPENDED' THEN s.id END)::int AS suspended_subscription_count
         FROM public.users_profile u
         LEFT JOIN public.devices d ON d.current_customer_id = u.id
         LEFT JOIN public.subscriptions s ON s.device_id = d.id
         WHERE u.deleted_at IS NULL
         GROUP BY u.id
         ORDER BY u.created_at ASC`
      );
      return res.rows.map((r) => this._mapUserRow(r));
    });
  }

  /**
   * Dedicated Customer / User Details with independent per-vehicle subscription breakdown.
   */
  async getCustomerDetails(actorClaims, targetUserId, nowMs = Date.now()) {
    if (actorClaims.role !== "ADMIN" && actorClaims.userId !== targetUserId) {
      throw new Error("FORBIDDEN_TENANT_ISOLATION");
    }
    await this._enforceAllExpiredSubscriptions(nowMs);

    const userRow = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const uRes = await tx.query(
        `SELECT * FROM public.users_profile WHERE id = $1 AND deleted_at IS NULL`,
        [targetUserId]
      );
      return uRes.rows[0] ?? null;
    });

    if (!userRow) {
      throw new Error("CUSTOMER_NOT_FOUND");
    }

    const allBundles = await this.listAuthorizedDevices(actorClaims, nowMs);
    const vehicles = allBundles.filter((b) => b.device.currentCustomerId === targetUserId);

    const activeCnt = vehicles.filter((v) => v.subscription?.status === "ACTIVE").length;
    const pendingCnt = vehicles.filter(
      (v) => v.subscription?.status === "AWAITING_FIRST_CONNECTION"
    ).length;
    const expiredCnt = vehicles.filter((v) => v.subscription?.status === "EXPIRED").length;
    const suspendedCnt = vehicles.filter((v) => v.subscription?.status === "SUSPENDED").length;

    const summary = {
      totalVehicles: vehicles.length,
      totalSubscriptions: vehicles.filter((v) => v.subscription !== null).length,
      activeSubscriptions: activeCnt,
      activeSubscriptionsCount: activeCnt,
      pendingSubscriptions: pendingCnt,
      pendingSubscriptionsCount: pendingCnt,
      expiredSubscriptions: expiredCnt,
      expiredSubscriptionsCount: expiredCnt,
      suspendedSubscriptions: suspendedCnt,
      suspendedSubscriptionsCount: suspendedCnt,
      onlineVehicles: vehicles.filter((v) =>
        String(v.device.connectionState ?? "").startsWith("ONLINE")
      ).length
    };

    const mappedCustomer = this._mapUserRow({
      ...userRow,
      vehicle_count: summary.totalVehicles,
      subscription_count: summary.totalSubscriptions,
      active_subscription_count: summary.activeSubscriptions,
      pending_subscription_count: summary.pendingSubscriptions,
      expired_subscription_count: summary.expiredSubscriptions,
      suspended_subscription_count: summary.suspendedSubscriptions
    });

    return {
      customer: mappedCustomer,
      user: mappedCustomer,
      summary,
      vehicles
    };
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
    const protocol = String(input.traccarProtocol ?? "gt06").toLowerCase().trim();
    const defaultCommands =
      PROTOCOL_SUPPORTED_COMMANDS[protocol] ?? ["positionSingle", "engineStop", "engineResume", "custom"];
    const supportedCommands = Array.isArray(input.supportedCommands)
      ? input.supportedCommands.filter((c) => c in OFFICIAL_TRACCAR_COMMANDS)
      : defaultCommands;

    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const res = await tx.query(
        `INSERT INTO public.device_profiles (
           manufacturer, model, firmware_version, traccar_protocol,
           server_host, server_port, transport, server_mode,
           requires_device_password, default_device_password,
           requires_gprson_command, server_command_template,
           gprson_command_template, optional_timer_command_template,
           expected_reply_pattern, supported_commands, is_verified
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
         RETURNING *`,
        [
          String(input.manufacturer ?? "").trim(),
          String(input.model ?? "").trim(),
          String(input.firmwareVersion ?? "").trim(),
          protocol,
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
          JSON.stringify(supportedCommands),
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
   * Provisions a vehicle & GPS device in Traccar and Supabase PostgreSQL with safe rollback
   * if database insertion fails, and optionally dispatches idempotent activation SMS commands.
   */
  async provisionAndActivateDevice(actorClaims, input) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const cleanImei = String(input.imei ?? "").trim();
    if (!isValidImei(cleanImei)) {
      throw new Error("INVALID_IMEI");
    }
    const sim = normalizeEgyptianSim(input.simLocalWithoutPlus20);
    if (!sim.isValid) {
      throw new Error(`INVALID_SIM:${sim.errorReason}`);
    }

    const vehicleType = VEHICLE_TYPES.includes(String(input.vehicleType ?? "CAR").toUpperCase())
      ? String(input.vehicleType ?? "CAR").toUpperCase()
      : "CAR";
    const vehicleIcon = VEHICLE_ICONS.includes(String(input.vehicleIcon ?? "car").toLowerCase())
      ? String(input.vehicleIcon ?? "car").toLowerCase()
      : "car";
    const serialNumber =
      input.serialNumber && String(input.serialNumber).trim()
        ? String(input.serialNumber).trim()
        : null;
    const sendActivationSms =
      input.sendActivationSms !== false && input.sendActivationSmsNow !== false;

    const { profile, customer } = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const dupRes = await tx.query(`SELECT id FROM public.devices WHERE imei = $1`, [cleanImei]);
      if (dupRes.rows.length > 0) {
        throw new Error("DUPLICATE_IMEI");
      }
      const profRes = await tx.query(`SELECT * FROM public.device_profiles WHERE id = $1`, [
        input.profileId
      ]);
      if (profRes.rows.length === 0) throw new Error("PROFILE_NOT_FOUND");
      const prof = this._mapProfileRow(profRes.rows[0]);
      if (sendActivationSms && !prof.isVerified) {
        throw new Error("PROFILE_NOT_VERIFIED_FOR_SMS");
      }

      const custRes = await tx.query(
        `SELECT * FROM public.users_profile
         WHERE id = $1 AND role = 'CUSTOMER' AND is_active = TRUE AND deleted_at IS NULL`,
        [input.customerId]
      );
      if (custRes.rows.length === 0) throw new Error("CUSTOMER_NOT_FOUND");
      return { profile: prof, customer: this._mapUserRow(custRes.rows[0]) };
    });

    // 1. Register in real Traccar Server via POST /api/devices
    const traccarDevice = await this.traccarClient.registerDeviceInTraccar({
      name: String(input.vehicleName ?? "").trim(),
      imei: cleanImei,
      category: vehicleIcon
    });

    // 2. Persist device, subscription (AWAITING_FIRST_CONNECTION), and history in a transaction.
    //    If DB transaction fails, delete the newly created Traccar device to prevent orphans.
    let provisioned;
    try {
      provisioned = await this.db.runTenantTransaction(actorClaims, async (tx) => {
        const devRes = await tx.query(
          `INSERT INTO public.devices (
             imei, serial_number, traccar_device_id, profile_id, current_customer_id,
             vehicle_name, vehicle_type, vehicle_icon, plate_number,
             sim_local_number, sim_e164_number,
             activation_status, connection_state, has_valid_fix
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING','OFFLINE',FALSE)
           RETURNING *`,
          [
            cleanImei,
            serialNumber,
            traccarDevice.id,
            profile.id,
            customer.id,
            String(input.vehicleName ?? "").trim(),
            vehicleType,
            vehicleIcon,
            String(input.plateNumber ?? "").trim(),
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

        return { device: dev, subscription: sub };
      });
    } catch (dbErr) {
      await this.traccarClient.deleteDeviceInTraccar(traccarDevice.id).catch(() => {});
      throw dbErr;
    }

    if (!sendActivationSms) {
      await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [provisioned.device.id] });
      return {
        device: provisioned.device,
        subscription: provisioned.subscription,
        smsLogs: []
      };
    }

    const smsResult = await this.sendDeviceActivationSms(actorClaims, {
      deviceId: provisioned.device.id,
      idempotencyKey: input.idempotencyKey ?? null
    });

    return {
      device: smsResult.device,
      subscription: provisioned.subscription,
      smsLogs: smsResult.smsLogs,
      duplicatePrevented: Boolean(smsResult.duplicatePrevented)
    };
  }

  /**
   * Dispatches profile-specific SMS activation commands for an existing device with
   * idempotency protection so repeated clicks or network retries never send duplicate SMS messages.
   */
  async sendDeviceActivationSms(
    actorClaims,
    { deviceId, idempotencyKey = null, forceResend = false }
  ) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }

    const prep = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const devRes = await tx.query(
        `SELECT * FROM public.devices WHERE id = $1 FOR UPDATE`,
        [deviceId]
      );
      if (devRes.rows.length === 0) throw new Error("DEVICE_NOT_FOUND");
      const dev = this._mapDeviceRow(devRes.rows[0]);

      const profRes = await tx.query(`SELECT * FROM public.device_profiles WHERE id = $1`, [
        dev.profileId
      ]);
      if (profRes.rows.length === 0) throw new Error("PROFILE_NOT_FOUND");
      const profile = this._mapProfileRow(profRes.rows[0]);
      if (!profile.isVerified) {
        throw new Error("PROFILE_NOT_VERIFIED_FOR_SMS");
      }

      const existingLogsRes = await tx.query(
        `SELECT * FROM public.activation_sms_logs
         WHERE device_id = $1
         ORDER BY step_order ASC
         FOR UPDATE`,
        [deviceId]
      );
      const existingLogs = existingLogsRes.rows.map((r) => this._mapSmsLogRow(r));

      const hasActiveLogs = existingLogs.some((l) =>
        ["QUEUED", "ACCEPTED", "SENT", "DELIVERED", "REPLIED"].includes(l.status)
      );
      const matchesIdempotency =
        idempotencyKey &&
        existingLogs.some(
          (l) => l.idempotencyKey === `${idempotencyKey}:1` || l.idempotencyKey === idempotencyKey
        );

      if ((hasActiveLogs || matchesIdempotency) && !forceResend) {
        return {
          alreadySent: true,
          device: dev,
          smsLogs: existingLogs
        };
      }

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

      const baseOrder = existingLogs.length;
      const queuedLogs = [];
      for (const cmd of commands) {
        const stepOrder = baseOrder + cmd.stepOrder;
        const stepIdemKey = idempotencyKey ? `${idempotencyKey}:${stepOrder}` : null;
        const logRes = await tx.query(
          `INSERT INTO public.activation_sms_logs (
             device_id, step_order, command_key, command_text, idempotency_key, status
           ) VALUES ($1,$2,$3,$4,$5,'QUEUED')
           RETURNING *`,
          [dev.id, stepOrder, cmd.commandKey, cmd.commandText, stepIdemKey]
        );
        queuedLogs.push(this._mapSmsLogRow(logRes.rows[0]));
      }

      return {
        alreadySent: false,
        device: dev,
        smsLogs: queuedLogs
      };
    });

    if (prep.alreadySent) {
      return {
        device: prep.device,
        smsLogs: prep.smsLogs,
        duplicatePrevented: true
      };
    }

    const updatedLogs = [];
    for (const logEntry of prep.smsLogs) {
      try {
        const gwRes = await this.smsGateway.sendSms({
          toE164: prep.device.simE164Number,
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
            `UPDATE public.devices
             SET activation_status = CASE WHEN activation_status = 'ACTIVATED' THEN 'ACTIVATED' ELSE 'FAILED' END,
                 updated_at = NOW()
             WHERE id = $1`,
            [prep.device.id]
          );
        });
        throw err;
      }
    }

    const finalDevice = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      const r = await tx.query(
        `UPDATE public.devices
         SET activation_status = CASE WHEN activation_status = 'ACTIVATED' THEN 'ACTIVATED' ELSE 'SMS_SENT' END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [prep.device.id]
      );
      return this._mapDeviceRow(r.rows[0]);
    });

    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [finalDevice.id] });
    return {
      device: finalDevice,
      smsLogs: updatedLogs,
      duplicatePrevented: false
    };
  }

  /**
   * Updates vehicle details (name, type, icon, plate, serialNumber, SIM, profile).
   */
  async updateVehicleMetadata(actorClaims, deviceId, input) {
    const updated = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const devRes = await tx.query(
        `SELECT * FROM public.devices WHERE id = $1 FOR UPDATE`,
        [deviceId]
      );
      if (devRes.rows.length === 0) {
        return null;
      }
      const existing = devRes.rows[0];

      const nextName =
        input.vehicleName !== undefined
          ? String(input.vehicleName).trim()
          : existing.vehicle_name;
      const nextPlate =
        input.plateNumber !== undefined
          ? String(input.plateNumber).trim()
          : existing.plate_number;
      const nextType =
        input.vehicleType !== undefined
          ? String(input.vehicleType).toUpperCase().trim()
          : existing.vehicle_type;
      const nextIcon =
        input.vehicleIcon !== undefined
          ? String(input.vehicleIcon).toLowerCase().trim()
          : existing.vehicle_icon;

      if (!nextName || !VEHICLE_TYPES.includes(nextType) || !VEHICLE_ICONS.includes(nextIcon)) {
        throw new Error("INVALID_VEHICLE_METADATA");
      }

      let nextSerial = existing.serial_number;
      let nextSimLocal = existing.sim_local_number;
      let nextSimE164 = existing.sim_e164_number;
      let nextProfileId = existing.profile_id;

      if (actorClaims.role === "ADMIN") {
        if (input.serialNumber !== undefined) {
          nextSerial = String(input.serialNumber ?? "").trim() || null;
        }
        if (input.simLocalWithoutPlus20 !== undefined) {
          const simNorm = normalizeEgyptianSim(input.simLocalWithoutPlus20);
          if (!simNorm.isValid) {
            throw new Error(`INVALID_SIM:${simNorm.errorReason}`);
          }
          nextSimLocal = simNorm.localNumber;
          nextSimE164 = simNorm.e164Number;
        }
        if (input.profileId !== undefined && input.profileId !== existing.profile_id) {
          const pRes = await tx.query(`SELECT id FROM public.device_profiles WHERE id = $1`, [
            input.profileId
          ]);
          if (pRes.rows.length === 0) throw new Error("PROFILE_NOT_FOUND");
          nextProfileId = input.profileId;
        }
      }

      const uRes = await tx.query(
        `UPDATE public.devices
         SET vehicle_name = $2,
             vehicle_type = $3,
             vehicle_icon = $4,
             plate_number = $5,
             serial_number = $6,
             sim_local_number = $7,
             sim_e164_number = $8,
             profile_id = $9,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          deviceId,
          nextName,
          nextType,
          nextIcon,
          nextPlate,
          nextSerial,
          nextSimLocal,
          nextSimE164,
          nextProfileId
        ]
      );
      return this._mapDeviceRow(uRes.rows[0]);
    });

    if (!updated) {
      const existsInSystem = await this.db.runSystemTransaction(async (tx) => {
        const r = await tx.query(`SELECT id FROM public.devices WHERE id = $1`, [deviceId]);
        return r.rows.length > 0;
      });
      if (existsInSystem) throw new Error("FORBIDDEN_TENANT_ISOLATION");
      throw new Error("DEVICE_NOT_FOUND");
    }

    await this.traccarClient
      .updateDeviceInTraccar({
        traccarDeviceId: updated.traccarDeviceId,
        name: updated.vehicleName,
        imei: updated.imei,
        category: updated.vehicleIcon
      })
      .catch(() => {});

    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [deviceId] });
    return { ...updated, device: updated };
  }

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
         SET activation_status = $2, updated_at = NOW()
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
        `UPDATE public.devices SET activation_status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
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
                 last_seen_at = $4,
                 updated_at = NOW()
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
            `UPDATE public.devices SET connection_state = 'OFFLINE', updated_at = NOW() WHERE id = $1`,
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
               last_seen_at = $10,
               updated_at = NOW()
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
             first_connected_at = COALESCE(first_connected_at, $2),
             updated_at = NOW()
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

  async _enforceAllExpiredSubscriptions(nowMs = Date.now()) {
    await this.db.runSystemTransaction(async (tx) => {
      const activeSubs = await tx.query(
        `SELECT device_id FROM public.subscriptions WHERE status = 'ACTIVE' AND plan_duration <> 'LIFETIME'`
      );
      for (const row of activeSubs.rows) {
        await this._enforceSubscriptionExpiryTx(tx, row.device_id, nowMs);
      }
    });
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

  async suspendSubscription(actorClaims, { deviceId, reason = "Suspended by administrator", nowMs = Date.now() }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const updatedSub = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const subRes = await tx.query(
        `SELECT * FROM public.subscriptions WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      if (subRes.rows.length === 0) throw new Error("DEVICE_NOT_FOUND");
      const subRow = subRes.rows[0];

      const uSub = await tx.query(
        `UPDATE public.subscriptions SET status = 'SUSPENDED' WHERE device_id = $1 RETURNING *`,
        [deviceId]
      );

      await tx.query(
        `INSERT INTO public.subscription_history (
           device_id, customer_id, action_type, plan_duration, actor_user_id, notes, created_at
         ) VALUES ($1,$2,'SUSPENDED',$3,$4,$5,$6)`,
        [
          deviceId,
          subRow.customer_id,
          subRow.plan_duration,
          actorClaims.userId,
          String(reason || "Suspended by administrator").trim(),
          new Date(nowMs).toISOString()
        ]
      );

      return this._mapSubscriptionRow(uSub.rows[0]);
    });

    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [deviceId] });
    return { ...updatedSub, subscription: updatedSub };
  }

  async resumeSubscription(actorClaims, { deviceId, reason = "Resumed by administrator", nowMs = Date.now() }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const updatedSub = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const subRes = await tx.query(
        `SELECT * FROM public.subscriptions WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      if (subRes.rows.length === 0) throw new Error("DEVICE_NOT_FOUND");
      const sub = this._mapSubscriptionRow(subRes.rows[0]);

      let nextStatus = "AWAITING_FIRST_CONNECTION";
      if (sub.startedAtMs !== null) {
        if (sub.planDuration === "LIFETIME" || (sub.expiresAtMs ?? 0) > nowMs) {
          nextStatus = "ACTIVE";
        } else {
          nextStatus = "EXPIRED";
        }
      }

      const uSub = await tx.query(
        `UPDATE public.subscriptions SET status = $2 WHERE device_id = $1 RETURNING *`,
        [deviceId, nextStatus]
      );

      await tx.query(
        `INSERT INTO public.subscription_history (
           device_id, customer_id, action_type, plan_duration, actor_user_id, notes, created_at
         ) VALUES ($1,$2,'RESUMED',$3,$4,$5,$6)`,
        [
          deviceId,
          sub.customerId,
          sub.planDuration,
          actorClaims.userId,
          String(reason || "Resumed by administrator").trim(),
          new Date(nowMs).toISOString()
        ]
      );

      return this._mapSubscriptionRow(uSub.rows[0]);
    });

    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [deviceId] });
    return { ...updatedSub, subscription: updatedSub };
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
        `SELECT * FROM public.users_profile
         WHERE id = $1 AND role = 'CUSTOMER' AND is_active = TRUE AND deleted_at IS NULL`,
        [newCustomerId]
      );
      if (devRes.rows.length === 0 || subRes.rows.length === 0 || custRes.rows.length === 0) {
        throw new Error("INVALID_REASSIGNMENT_TARGET");
      }

      const previousCustomerId = devRes.rows[0].current_customer_id;
      const uDev = await tx.query(
        `UPDATE public.devices SET current_customer_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
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
   * Queries supported commands for a specific device based on its profile protocol
   * and Traccar's `/api/commands/types` endpoint.
   */
  async getSupportedDeviceCommands(actorClaims, deviceId) {
    const { device, profile } = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const devRes = await tx.query(`SELECT * FROM public.devices WHERE id = $1`, [deviceId]);
      if (devRes.rows.length === 0) return { device: null, profile: null };
      const dev = this._mapDeviceRow(devRes.rows[0]);
      const profRes = await tx.query(`SELECT * FROM public.device_profiles WHERE id = $1`, [
        dev.profileId
      ]);
      const prof = profRes.rows[0] ? this._mapProfileRow(profRes.rows[0]) : null;
      return { device: dev, profile: prof };
    });

    if (!device) {
      const existsInSystem = await this.db.runSystemTransaction(async (tx) => {
        const r = await tx.query(`SELECT id FROM public.devices WHERE id = $1`, [deviceId]);
        return r.rows.length > 0;
      });
      if (existsInSystem) throw new Error("FORBIDDEN_TENANT_ISOLATION");
      throw new Error("DEVICE_NOT_FOUND");
    }

    const protocolDefaults =
      PROTOCOL_SUPPORTED_COMMANDS[profile?.traccarProtocol ?? "gt06"] ??
      ["positionSingle", "engineStop", "engineResume"];
    const profileAllowed =
      Array.isArray(profile?.supportedCommands) && profile.supportedCommands.length > 0
        ? profile.supportedCommands
        : protocolDefaults;

    let traccarTypes = null;
    try {
      traccarTypes = await this.traccarClient.fetchSupportedCommandTypes(device.traccarDeviceId);
    } catch {
      traccarTypes = null;
    }

    const effectiveTypes = Array.isArray(traccarTypes) && traccarTypes.length > 0
      ? profileAllowed.filter((t) => traccarTypes.includes(t))
      : profileAllowed;

    return effectiveTypes
      .map((type) => OFFICIAL_TRACCAR_COMMANDS[type])
      .filter(Boolean)
      .filter((cmd) => (actorClaims.role === "ADMIN" ? true : cmd.customerPermitted));
  }

  /**
   * Executes a supported Traccar command on a vehicle and writes an immutable audit record.
   */
  async sendAuthorizedDeviceCommand(
    actorClaims,
    { deviceId, type, parameters = {}, confirmedSensitive = false, nowMs = Date.now() }
  ) {
    const accessible = await this.enforceSubscriptionExpiry(deviceId, nowMs);
    const supportedList = await this.getSupportedDeviceCommands(actorClaims, deviceId);

    if (actorClaims.role === "CUSTOMER" && !accessible) {
      throw new Error("SUBSCRIPTION_EXPIRED");
    }

    const cmdDef = supportedList.find((c) => c.type === type);
    if (!cmdDef) {
      throw new Error("UNSUPPORTED_DEVICE_COMMAND");
    }

    if (cmdDef.requiresConfirmation && !confirmedSensitive) {
      throw new Error("SENSITIVE_COMMAND_CONFIRMATION_REQUIRED");
    }

    const deviceRow = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      const r = await tx.query(`SELECT * FROM public.devices WHERE id = $1`, [deviceId]);
      return r.rows[0];
    });

    if (type === "custom") {
      const customData = String(parameters?.data ?? "").trim();
      if (!customData || /APN/i.test(customData) || /TIMER/i.test(customData)) {
        throw new Error("INVALID_PROFILE_COMMAND_POLICY");
      }
    }

    let status = "SENT";
    let traccarResponse = null;
    let failureReason = null;

    try {
      const sendRes = await this.traccarClient.sendDeviceCommand({
        traccarDeviceId: deviceRow.traccar_device_id,
        type,
        attributes: parameters ?? {},
        description: `VeloTrack ${actorClaims.role} command ${type}`
      });
      status = sendRes.queued ? "QUEUED" : "SENT";
      traccarResponse = sendRes.response ?? {};
    } catch (err) {
      status = "FAILED";
      failureReason = err.message;
    }

    const savedAudit = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      const ins = await tx.query(
        `INSERT INTO public.device_commands (
           device_id, traccar_device_id, actor_user_id, actor_role,
           command_type, parameters, confirmed_sensitive,
           traccar_response, status, failure_reason, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11)
         RETURNING *`,
        [
          deviceId,
          deviceRow.traccar_device_id,
          actorClaims.userId,
          actorClaims.role,
          type,
          JSON.stringify(parameters ?? {}),
          Boolean(confirmedSensitive),
          traccarResponse ? JSON.stringify(traccarResponse) : null,
          status,
          failureReason,
          new Date(nowMs).toISOString()
        ]
      );
      return this._mapCommandRow(ins.rows[0]);
    });

    await this._notifyListeners({ type: "DEVICE_UPDATE", deviceIds: [deviceId] });

    if (status === "FAILED") {
      throw new Error(failureReason ?? "TRACCAR_COMMAND_FAILED");
    }
    return savedAudit;
  }

  async listDeviceCommandHistory(actorClaims, deviceId) {
    const exists = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const dRes = await tx.query(`SELECT id FROM public.devices WHERE id = $1`, [deviceId]);
      if (dRes.rows.length === 0) return null;
      const cRes = await tx.query(
        `SELECT * FROM public.device_commands WHERE device_id = $1 ORDER BY created_at DESC`,
        [deviceId]
      );
      return cRes.rows.map((r) => this._mapCommandRow(r));
    });

    if (exists === null) {
      const existsInSystem = await this.db.runSystemTransaction(async (tx) => {
        const r = await tx.query(`SELECT id FROM public.devices WHERE id = $1`, [deviceId]);
        return r.rows.length > 0;
      });
      if (existsInSystem) throw new Error("FORBIDDEN_TENANT_ISOLATION");
      throw new Error("DEVICE_NOT_FOUND");
    }
    return exists;
  }

  async listAuthorizedDevices(actorClaims, nowMs = Date.now()) {
    await this._enforceAllExpiredSubscriptions(nowMs);

    return this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);

      const devRes = await tx.query(`SELECT * FROM public.devices ORDER BY created_at DESC`);
      const bundles = [];

      for (const dRow of devRes.rows) {
        const device = this._mapDeviceRow(dRow);
        const [subRes, custRes, profRes, smsRes, subHistRes, ownHistRes, cmdRes] =
          await Promise.all([
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
            ),
            tx.query(
              `SELECT * FROM public.device_commands WHERE device_id = $1 ORDER BY created_at DESC LIMIT 30`,
              [device.id]
            )
          ]);

        const sub = subRes.rows[0] ? this._mapSubscriptionRow(subRes.rows[0]) : null;
        const prof = profRes.rows[0] ? this._mapProfileRow(profRes.rows[0]) : null;
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

        const allowedCmdTypes =
          Array.isArray(prof?.supportedCommands) && prof.supportedCommands.length > 0
            ? prof.supportedCommands
            : PROTOCOL_SUPPORTED_COMMANDS[prof?.traccarProtocol ?? "gt06"] ?? [];
        const supportedCommands = allowedCmdTypes
          .map((t) => OFFICIAL_TRACCAR_COMMANDS[t])
          .filter(Boolean)
          .filter((c) => (actorClaims.role === "ADMIN" ? true : c.customerPermitted));

        bundles.push({
          device: safeDevice,
          subscription: sub,
          customer: custRes.rows[0] ? this._mapUserRow(custRes.rows[0]) : null,
          profile: prof,
          smsLogs: smsRes.rows.map((r) => this._mapSmsLogRow(r)),
          subscriptionHistory: subHistRes.rows.map((r) => this._mapSubHistoryRow(r)),
          ownershipHistory: ownHistRes.rows.map((r) => this._mapOwnershipHistoryRow(r)),
          commandHistory: cmdRes.rows.map((r) => this._mapCommandRow(r)),
          supportedCommands
        });
      }

      return bundles;
    });
  }

  async getAuthorizedDeviceDetails(actorClaims, deviceId, nowMs = Date.now()) {
    const list = await this.listAuthorizedDevices(actorClaims, nowMs);
    const found = list.find((b) => b.device.id === deviceId);
    if (found) return found;

    const existsInSystem = await this.db.runSystemTransaction(async (tx) => {
      const r = await tx.query(`SELECT id FROM public.devices WHERE id = $1`, [deviceId]);
      return r.rows.length > 0;
    });
    if (existsInSystem) {
      throw new Error("FORBIDDEN_TENANT_ISOLATION");
    }
    throw new Error("DEVICE_NOT_FOUND");
  }

  /**
   * Fetches route history from Traccar.
   * Administrators retain access to expired/suspended vehicles so they can inspect devices;
   * customers are blocked when their subscription is expired or suspended.
   */
  async getAuthorizedRouteHistory(actorClaims, { deviceId, fromIso, toIso, nowMs = Date.now() }) {
    const accessible = await this.enforceSubscriptionExpiry(deviceId, nowMs);
    const device = await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
      const res = await tx.query(`SELECT * FROM public.devices WHERE id = $1`, [deviceId]);
      if (res.rows.length === 0) {
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

    if (!accessible && actorClaims.role !== "ADMIN") {
      throw new Error("SUBSCRIPTION_EXPIRED");
    }
    return this.traccarClient.fetchRouteHistory(device.traccarDeviceId, fromIso, toIso);
  }


  _assertFleetReportWindow(fromIso, toIso) {
    const fromMs = Date.parse(fromIso);
    const toMs = Date.parse(toIso);
    const maxWindowMs = 90 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) ||
        toMs <= fromMs || toMs - fromMs > maxWindowMs) {
      throw new Error("INVALID_REPORT_WINDOW");
    }
    return { fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
  }

  async _resolveAuthorizedFleetBundles(actorClaims, deviceId = null) {
    if (!actorClaims || !["ADMIN", "CUSTOMER"].includes(actorClaims.role)) {
      throw new Error("FORBIDDEN_DEVICE_ACCESS");
    }
    const bundles = await this.listAuthorizedDevices(actorClaims);
    const isSubscriptionActive = (bundle) =>
      bundle.subscription?.status === "ACTIVE" &&
      (bundle.subscription.planDuration === "LIFETIME" ||
        (bundle.subscription.expiresAtMs ?? 0) > Date.now());

    if (deviceId) {
      const requestedId = String(deviceId);
      const found = bundles.find((bundle) => bundle.device.id === requestedId);
      if (!found) {
        const existsInSystem = await this.db.runSystemTransaction(async (tx) => {
          const result = await tx.query("SELECT id FROM public.devices WHERE id = $1", [requestedId]);
          return result.rows.length > 0;
        });
        if (existsInSystem) throw new Error("FORBIDDEN_TENANT_ISOLATION");
        throw new Error("DEVICE_NOT_FOUND");
      }
      if (actorClaims.role !== "ADMIN" && !isSubscriptionActive(found)) {
        throw new Error("SUBSCRIPTION_EXPIRED");
      }
      return [found];
    }

    return bundles.filter((bundle) => actorClaims.role === "ADMIN" || isSubscriptionActive(bundle));
  }

  async getAuthorizedFleetEvents(actorClaims, { deviceId = null, fromIso, toIso }) {
    const window = this._assertFleetReportWindow(fromIso, toIso);
    const bundles = await this._resolveAuthorizedFleetBundles(actorClaims, deviceId);
    if (!bundles.length) return [];
    const deviceMap = new Map(bundles.map((bundle) => [Number(bundle.device.traccarDeviceId), bundle]));
    const rows = await this.traccarClient.fetchEvents(
      [...deviceMap.keys()], window.fromIso, window.toIso
    );
    return rows
      .filter((event) => deviceMap.has(Number(event.deviceId)))
      .map((event) => {
        const bundle = deviceMap.get(Number(event.deviceId));
        return {
          id: Number(event.id),
          type: String(event.type ?? "unknown"),
          eventTime: event.eventTime ?? null,
          deviceId: bundle.device.id,
          vehicleName: bundle.device.vehicleName,
          geofenceId: event.geofenceId ?? null,
          positionId: event.positionId ?? null,
          attributes: event.attributes && typeof event.attributes === "object"
            ? event.attributes
            : {}
        };
      })
      .sort((a, b) => Date.parse(b.eventTime ?? 0) - Date.parse(a.eventTime ?? 0));
  }

  async getAuthorizedMileageSummary(actorClaims, { deviceId = null, fromIso, toIso }) {
    const window = this._assertFleetReportWindow(fromIso, toIso);
    const bundles = await this._resolveAuthorizedFleetBundles(actorClaims, deviceId);
    if (!bundles.length) return [];
    const deviceMap = new Map(bundles.map((bundle) => [Number(bundle.device.traccarDeviceId), bundle]));
    const rows = await this.traccarClient.fetchMileageSummary(
      [...deviceMap.keys()], window.fromIso, window.toIso
    );
    return rows
      .filter((row) => deviceMap.has(Number(row.deviceId)))
      .map((row) => {
        const bundle = deviceMap.get(Number(row.deviceId));
        const metric = (value, multiplier = 1) =>
          value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
            ? null
            : Number((Number(value) * multiplier).toFixed(2));
        return {
          deviceId: bundle.device.id,
          vehicleName: bundle.device.vehicleName,
          distanceKm: metric(row.distance, 0.001),
          maxSpeedKmh: metric(row.maxSpeed, 1.852),
          averageSpeedKmh: metric(row.averageSpeed, 1.852),
          spentFuelLiters: metric(row.spentFuel),
          engineHours: metric(row.engineHours)
        };
      });
  }

  async getAuthorizedFleetTelemetry(actorClaims, deviceId = null) {
    const bundles = await this._resolveAuthorizedFleetBundles(actorClaims, deviceId);
    if (!bundles.length) return [];
    const snapshot = await this.traccarClient.fetchDevicesAndPositions();
    const allowedIds = new Set(bundles.map((bundle) => Number(bundle.device.traccarDeviceId)));
    const traccarDevices = new Map(
      (snapshot.devices ?? []).filter((item) => allowedIds.has(Number(item.id)))
        .map((item) => [Number(item.id), item])
    );
    const positions = new Map(
      (snapshot.positions ?? []).filter((item) => allowedIds.has(Number(item.deviceId)))
        .map((item) => [Number(item.deviceId), item])
    );
    const safeAttribute = /^(battery(level)?|power|external(power|voltage)|fuel(level|percentage|consumption)?|odometer|totaldistance|distance|temperature[0-9]*|door|ignition|motion|alarm|sat(ellites)?|rssi|gsmsignal|charge|charging|voltage|enginehours)$/i;
    return bundles.map((bundle) => {
      const id = Number(bundle.device.traccarDeviceId);
      const traccarDevice = traccarDevices.get(id) ?? {};
      const position = positions.get(id) ?? {};
      const source = {
        ...(traccarDevice.attributes && typeof traccarDevice.attributes === "object"
          ? traccarDevice.attributes : {}),
        ...(position.attributes && typeof position.attributes === "object"
          ? position.attributes : {})
      };
      const values = {};
      for (const [key, value] of Object.entries(source)) {
        if (safeAttribute.test(key) &&
            (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
            !(typeof value === "number" && !Number.isFinite(value))) values[key] = value;
      }
      const reportedAt = position.fixTime ?? position.serverTime ?? position.deviceTime ?? null;
      return {
        deviceId: bundle.device.id,
        vehicleName: bundle.device.vehicleName,
        reportedAtMs: reportedAt ? Date.parse(reportedAt) || null : null,
        values
      };
    });
  }

  async listAuthorizedGeofences(actorClaims) {
    const bundles = await this._resolveAuthorizedFleetBundles(actorClaims);
    const zones = new Map();
    for (const bundle of bundles) {
      const rows = await this.traccarClient.fetchGeofencesForDevice(bundle.device.traccarDeviceId);
      for (const row of rows) {
        const id = Number(row.id);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        const zone = zones.get(id) ?? {
          id,
          name: String(row.name ?? "منطقة جغرافية"),
          description: String(row.description ?? ""),
          area: String(row.area ?? ""),
          deviceIds: [],
          vehicleNames: []
        };
        if (!zone.deviceIds.includes(bundle.device.id)) {
          zone.deviceIds.push(bundle.device.id);
          zone.vehicleNames.push(bundle.device.vehicleName);
        }
        zones.set(id, zone);
      }
    }
    return [...zones.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }

  _validateGeofenceInput({ name, description = "", area }) {
    const cleanName = String(name ?? "").trim();
    const cleanDescription = String(description ?? "").trim();
    const cleanArea = String(area ?? "").trim();
    if (!cleanName || cleanName.length > 100 || cleanDescription.length > 500 ||
        cleanArea.length > 12000) throw new Error("INVALID_GEOFENCE_INPUT");

    const circle = /^CIRCLE\s*\(\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/i.exec(cleanArea);
    if (circle) {
      const lon = Number(circle[1]), lat = Number(circle[2]), radius = Number(circle[3]);
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90 || radius <= 0 || radius > 1000000) {
        throw new Error("INVALID_GEOFENCE_INPUT");
      }
      return { name: cleanName, description: cleanDescription, area: cleanArea };
    }

    const polygon = /^POLYGON\s*\(\(([^()]+)\)\)$/i.exec(cleanArea);
    if (polygon) {
      const points = polygon[1].split(",").map((part) => part.trim().split(/\s+/).map(Number));
      if (points.length < 4 || points.some((point) =>
        point.length !== 2 || point.some((value) => !Number.isFinite(value)) ||
        Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90
      )) throw new Error("INVALID_GEOFENCE_INPUT");
      const first = points[0], last = points[points.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) throw new Error("INVALID_GEOFENCE_INPUT");
      return { name: cleanName, description: cleanDescription, area: cleanArea };
    }
    throw new Error("INVALID_GEOFENCE_INPUT");
  }

  async createAuthorizedGeofence(actorClaims, input) {
    if (actorClaims.role !== "ADMIN") throw new Error("FORBIDDEN_ADMIN_ONLY");
    await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
    });
    const normalized = this._validateGeofenceInput(input ?? {});
    const requestedIds = [...new Set(
      (Array.isArray(input?.deviceIds) ? input.deviceIds : []).map((id) => String(id))
    )].filter(Boolean);
    if (!requestedIds.length || requestedIds.length > 50) throw new Error("INVALID_GEOFENCE_INPUT");
    const bundles = await this._resolveAuthorizedFleetBundles(actorClaims);
    const selected = bundles.filter((bundle) => requestedIds.includes(bundle.device.id));
    if (selected.length !== requestedIds.length) throw new Error("DEVICE_NOT_FOUND");

    const zone = await this.traccarClient.createGeofence({
      ...normalized,
      attributes: { source: "velotrack" }
    });
    const zoneId = Number(zone?.id);
    if (!Number.isSafeInteger(zoneId) || zoneId <= 0) {
      throw new Error("TRACCAR_GEOFENCE_CREATE_FAILED");
    }
    const linked = [];
    try {
      for (const bundle of selected) {
        await this.traccarClient.linkGeofenceToDevice(bundle.device.traccarDeviceId, zoneId);
        linked.push(bundle.device.traccarDeviceId);
      }
    } catch {
      for (const traccarDeviceId of linked) {
        await this.traccarClient.unlinkGeofenceFromDevice(traccarDeviceId, zoneId).catch(() => {});
      }
      await this.traccarClient.deleteGeofence(zoneId).catch(() => {});
      throw new Error("TRACCAR_GEOFENCE_ASSIGN_FAILED");
    }
    return {
      id: zoneId,
      ...normalized,
      deviceIds: selected.map((bundle) => bundle.device.id),
      vehicleNames: selected.map((bundle) => bundle.device.vehicleName)
    };
  }

  async deleteAuthorizedGeofence(actorClaims, geofenceId) {
    if (actorClaims.role !== "ADMIN") throw new Error("FORBIDDEN_ADMIN_ONLY");
    await this.db.runTenantTransaction(actorClaims, async (tx) => {
      await this._assertActiveAndPasswordUpdated(tx, actorClaims);
    });
    const id = Number(geofenceId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("GEOFENCE_ID_INVALID");
    const bundles = await this._resolveAuthorizedFleetBundles(actorClaims);
    const ownedTraccarIds = new Set(bundles.map((bundle) => Number(bundle.device.traccarDeviceId)));
    const visibleZones = await this.listAuthorizedGeofences(actorClaims);
    if (!visibleZones.some((zone) => zone.id === id)) throw new Error("GEOFENCE_NOT_FOUND");
    const permissions = await this.traccarClient.fetchGeofencePermissions(id);
    const linkedDevices = permissions.filter(
      (permission) => Number(permission.geofenceId) === id && Number(permission.deviceId) > 0
    );
    if (linkedDevices.some((permission) => !ownedTraccarIds.has(Number(permission.deviceId)))) {
      throw new Error("GEOFENCE_SHARED_WITH_OTHER_TRACCAR_DEVICES");
    }
    for (const permission of linkedDevices) {
      await this.traccarClient.unlinkGeofenceFromDevice(permission.deviceId, id);
    }
    await this.traccarClient.deleteGeofence(id);
    return { id, deleted: true };
  }

  async createAuthorizedDeviceShare(actorClaims, { deviceId, expiresInHours = 24 }) {
    const bundles = await this._resolveAuthorizedFleetBundles(actorClaims, deviceId);
    const hours = Number(expiresInHours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
      throw new Error("DEVICE_SHARE_INPUT_INVALID");
    }
    let publicUrl;
    try {
      publicUrl = new URL(this.traccarPublicUrl);
    } catch {
      throw new Error("TRACCAR_PUBLIC_URL_NOT_CONFIGURED");
    }
    if (publicUrl.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "::1"].includes(publicUrl.hostname)) {
      throw new Error("TRACCAR_PUBLIC_URL_MUST_USE_HTTPS");
    }
    const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
    const token = await this.traccarClient.createDeviceShare(
      bundles[0].device.traccarDeviceId, expiresAt
    );
    const sharePageUrl = new URL("/", publicUrl);
    sharePageUrl.searchParams.set("token", token);
    return {
      deviceId: bundles[0].device.id,
      vehicleName: bundles[0].device.vehicleName,
      shareUrl: sharePageUrl.toString(),
      expiresAt
    };
  }

  _mapUserRow(row) {
    return {
      id: row.id,
      username: row.username ?? null,
      email: row.email ?? null,
      phone: row.phone ?? "",
      fullName: row.full_name,
      role: row.role,
      mustChangePassword: Boolean(row.must_change_password),
      isActive: Boolean(row.is_active),
      deletedAtMs: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : 0,
      vehicleCount: row.vehicle_count !== undefined ? Number(row.vehicle_count) : undefined,
      subscriptionCount:
        row.subscription_count !== undefined ? Number(row.subscription_count) : undefined,
      activeSubscriptionCount:
        row.active_subscription_count !== undefined
          ? Number(row.active_subscription_count)
          : undefined,
      pendingSubscriptionCount:
        row.pending_subscription_count !== undefined
          ? Number(row.pending_subscription_count)
          : undefined,
      expiredSubscriptionCount:
        row.expired_subscription_count !== undefined
          ? Number(row.expired_subscription_count)
          : undefined,
      suspendedSubscriptionCount:
        row.suspended_subscription_count !== undefined
          ? Number(row.suspended_subscription_count)
          : undefined
    };
  }

  _mapProfileRow(row) {
    let supportedCommands = ["positionSingle", "engineStop", "engineResume", "custom"];
    if (Array.isArray(row.supported_commands)) {
      supportedCommands = row.supported_commands;
    } else if (typeof row.supported_commands === "string") {
      try {
        supportedCommands = JSON.parse(row.supported_commands);
      } catch {
        // use default
      }
    }
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
      supportedCommands,
      isVerified: Boolean(row.is_verified),
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : 0
    };
  }

  _mapDeviceRow(row) {
    return {
      id: row.id,
      imei: row.imei,
      serialNumber: row.serial_number ?? null,
      traccarDeviceId: Number(row.traccar_device_id),
      profileId: row.profile_id,
      currentCustomerId: row.current_customer_id,
      vehicleName: row.vehicle_name,
      vehicleType: row.vehicle_type ?? "CAR",
      vehicleIcon: row.vehicle_icon ?? "car",
      plateNumber: row.plate_number,
      simNumber: row.sim_e164_number,
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
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : 0,
      updatedAtMs: row.updated_at ? new Date(row.updated_at).getTime() : 0
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
      idempotencyKey: row.idempotency_key ?? null,
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

  _mapCommandRow(row) {
    let params = {};
    if (row.parameters && typeof row.parameters === "object") {
      params = row.parameters;
    } else if (typeof row.parameters === "string") {
      try {
        params = JSON.parse(row.parameters);
      } catch {
        params = {};
      }
    }
    return {
      id: row.id,
      deviceId: row.device_id,
      traccarDeviceId: Number(row.traccar_device_id),
      actorUserId: row.actor_user_id,
      actorRole: row.actor_role,
      commandType: row.command_type,
      parameters: params,
      confirmedSensitive: Boolean(row.confirmed_sensitive),
      status: row.status,
      failureReason: row.failure_reason ?? null,
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : 0
    };
  }
}

/**
 * Authenticated `/ws/live` WebSocket Hub for Android & Web Clients
 * Supports Authorization: Bearer <jwt>, single-use `?ticket=<ticket>`, and `?token=<jwt>` fallback.
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
        const ticket = url.searchParams.get("ticket");
        let claims;
        if (ticket) {
          claims = this.authService.consumeWebSocketTicket(ticket);
        } else {
          const bearerToken = authHeader.startsWith("Bearer ")
            ? authHeader.slice("Bearer ".length).trim()
            : url.searchParams.get("token");
          claims = this.authService.verifyToken(bearerToken);
        }

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
