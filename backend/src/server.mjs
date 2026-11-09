import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  LiveWebSocketHub,
  SupabaseAuthService,
  SupabaseDatabaseAdapter,
  TraccarBridgeClient,
  VeloTrackEngine
} from "./core.mjs";

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Sms-Webhook-Secret",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

export function createVeloTrackRequestListener({
  engine,
  authService,
  traccarClient,
  smsWebhookSecret = process.env.SMS_WEBHOOK_SECRET ?? "",
  smsGatewayConfigured = false
}) {
  function authenticateRequest(req) {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) {
      throw new Error("AUTH_TOKEN_MISSING");
    }
    return authService.verifyToken(header.slice("Bearer ".length).trim());
  }

  function verifyWebhookSecret(req) {
    if (!smsWebhookSecret) {
      throw new Error("SMS_WEBHOOK_SECRET_NOT_CONFIGURED");
    }
    const provided = String(req.headers["x-sms-webhook-secret"] ?? "");
    const a = Buffer.from(provided);
    const b = Buffer.from(smsWebhookSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error("AUTH_WEBHOOK_UNAUTHORIZED");
    }
  }

  return async (req, res) => {
    if (req.method === "OPTIONS") {
      return sendJson(res, 200, { ok: true });
    }
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname;

      if (req.method === "GET" && (pathname === "/" || pathname === "/api/v1/health")) {
        let databaseConnected = false;
        let databaseError = null;
        try {
          await engine.db.runSystemTransaction(async (tx) => {
            await tx.query("SELECT 1");
          });
          databaseConnected = true;
        } catch (healthError) {
          databaseError = healthError.message ?? "DATABASE_UNAVAILABLE";
        }
        const healthy = databaseConnected;
        return sendJson(res, healthy ? 200 : 503, {
          status: healthy ? "OK" : "DEGRADED",
          supabaseConnected: databaseConnected,
          databaseError,
          traccarConnected: Boolean(traccarClient.sessionCookie),
          traccarWsConnected: Boolean(traccarClient.wsConnected),
          traccarLastSyncAtMs: traccarClient.lastSyncAtMs,
          smsGatewayConfigured: Boolean(smsGatewayConfigured)
        });
      }

      if (req.method === "POST" && pathname === "/api/v1/auth/login") {
        const body = await readJsonBody(req);
        const identifier = body.identifier ?? body.username ?? body.email ?? "";
        const session = await engine.login(identifier, body.password);
        return sendJson(res, 200, session);
      }

      if (req.method === "POST" && pathname === "/api/v1/webhooks/sms/delivery") {
        verifyWebhookSecret(req);
        const body = await readJsonBody(req);
        const updated = await engine.handleSmsDeliveryWebhook(body);
        return sendJson(res, 200, updated);
      }

      if (req.method === "POST" && pathname === "/api/v1/webhooks/sms/inbound") {
        verifyWebhookSecret(req);
        const body = await readJsonBody(req);
        const updated = await engine.handleInboundSmsReply(body);
        return sendJson(res, 200, updated);
      }

      const claims = authenticateRequest(req);

      if (req.method === "GET" && pathname === "/api/v1/auth/me") {
        const user = await engine.getAuthenticatedUserProfile(claims);
        return sendJson(res, 200, user);
      }

      if (req.method === "POST" && pathname === "/api/v1/auth/change-password") {
        const body = await readJsonBody(req);
        const updatedSession = await engine.changePassword(claims, {
          currentPassword: body.currentPassword,
          newPassword: body.newPassword
        });
        return sendJson(res, 200, updatedSession);
      }

      if (req.method === "GET" && pathname === "/api/v1/users") {
        const list = await engine.listUsers(claims);
        return sendJson(res, 200, list);
      }

      if (req.method === "POST" && pathname === "/api/v1/admin/customers") {
        const body = await readJsonBody(req);
        const created = await engine.createCustomerAccount(claims, body);
        return sendJson(res, 201, created);
      }

      if (req.method === "GET" && pathname === "/api/v1/profiles") {
        const list = await engine.listDeviceProfiles(claims);
        return sendJson(res, 200, list);
      }

      if (req.method === "POST" && pathname === "/api/v1/profiles") {
        const body = await readJsonBody(req);
        const created = await engine.registerDeviceProfile(claims, body);
        return sendJson(res, 201, created);
      }

      const verifyProfileMatch = /^\/api\/v1\/admin\/profiles\/([^/]+)\/verify$/.exec(pathname);
      if (req.method === "POST" && verifyProfileMatch) {
        const verified = await engine.markProfileVerifiedAfterPhysicalTest(
          claims,
          verifyProfileMatch[1]
        );
        return sendJson(res, 200, verified);
      }

      if (req.method === "GET" && pathname === "/api/v1/devices") {
        const devices = await engine.listAuthorizedDevices(claims);
        return sendJson(res, 200, devices);
      }

      if (req.method === "POST" && pathname === "/api/v1/admin/devices/activate") {
        const body = await readJsonBody(req);
        const result = await engine.provisionAndActivateDevice(claims, body);
        return sendJson(res, 201, result);
      }

      const overrideMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/override-activate$/.exec(
        pathname
      );
      if (req.method === "POST" && overrideMatch) {
        const body = await readJsonBody(req);
        const result = await engine.adminOverrideActivation(claims, {
          deviceId: overrideMatch[1],
          auditReason: body.auditReason
        });
        return sendJson(res, 200, result);
      }

      const reassignMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/reassign$/.exec(pathname);
      if (req.method === "POST" && reassignMatch) {
        const body = await readJsonBody(req);
        const result = await engine.reassignCustomer(claims, {
          deviceId: reassignMatch[1],
          newCustomerId: body.newCustomerId,
          reason: body.reason
        });
        return sendJson(res, 200, result);
      }

      const renewMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/renew$/.exec(pathname);
      if (req.method === "POST" && renewMatch) {
        const body = await readJsonBody(req);
        const result = await engine.renewSubscription(claims, {
          deviceId: renewMatch[1],
          planDuration: body.planDuration
        });
        return sendJson(res, 200, result);
      }

      const historyMatch = /^\/api\/v1\/devices\/([^/]+)\/history$/.exec(pathname);
      if (req.method === "GET" && historyMatch) {
        const fromIso =
          url.searchParams.get("from") ?? new Date(Date.now() - 86400000).toISOString();
        const toIso = url.searchParams.get("to") ?? new Date().toISOString();
        const history = await engine.getAuthorizedRouteHistory(claims, {
          deviceId: historyMatch[1],
          fromIso,
          toIso
        });
        return sendJson(res, 200, history);
      }

      if (req.method === "POST" && pathname === "/api/v1/admin/traccar/sync") {
        if (claims.role !== "ADMIN") throw new Error("FORBIDDEN_ADMIN_ONLY");
        const snapshot = await traccarClient.fetchDevicesAndPositions();
        const updatedIds = await engine.ingestTraccarUpdate({
          traccarDevices: snapshot.devices,
          traccarPositions: snapshot.positions
        });
        return sendJson(res, 200, {
          updatedDeviceIds: updatedIds,
          syncedAtMs: traccarClient.lastSyncAtMs
        });
      }

      sendJson(res, 404, { error: "NOT_FOUND" });
    } catch (err) {
      const msg = err.message ?? "SERVER_ERROR";
      const status =
        msg.startsWith("AUTH_") || msg === "INVALID_CREDENTIALS"
          ? 401
          : msg.startsWith("FORBIDDEN") ||
            msg === "SUBSCRIPTION_EXPIRED" ||
            msg === "PASSWORD_CHANGE_REQUIRED"
          ? 403
          : msg.endsWith("NOT_FOUND")
          ? 404
          : 400;
      sendJson(res, status, { error: msg });
    }
  };
}

export function createVeloTrackHttpServer(options) {
  const listener = createVeloTrackRequestListener(options);
  const server = http.createServer(listener);
  const wsHub = new LiveWebSocketHub({
    httpServer: server,
    engine: options.engine,
    authService: options.authService
  });
  server.wsHub = wsHub;
  return server;
}

let cachedRuntimePromise = null;

/**
 * Initializes the Supabase-backed VeloTrack runtime for both standalone servers
 * and Vercel Serverless Functions (`api/index.mjs`).
 */
export async function getOrCreateVeloTrackRuntime() {
  if (cachedRuntimePromise) return cachedRuntimePromise;

  cachedRuntimePromise = (async () => {
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET ?? "";
    const supabaseDbUrl = process.env.SUPABASE_DB_URL ?? process.env.VELOTRACK_DB_URL ?? "";

    const traccarBaseUrl = process.env.TRACCAR_BASE_URL ?? "";
    const traccarAdminEmail = process.env.TRACCAR_ADMIN_EMAIL ?? "";
    const traccarAdminPassword = process.env.TRACCAR_ADMIN_PASSWORD ?? "";

    const smsGatewayUrl = process.env.SMS_GATEWAY_URL ?? "";
    const smsGatewayToken = process.env.SMS_GATEWAY_TOKEN ?? "";
    const smsWebhookSecret = process.env.SMS_WEBHOOK_SECRET ?? "";

    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !supabaseServiceRoleKey ||
      !supabaseDbUrl ||
      !supabaseJwtSecret ||
      supabaseDbUrl.includes("replace_with") ||
      supabaseJwtSecret.includes("replace_with")
    ) {
      throw new Error("SUPABASE_PRODUCTION_CONFIGURATION_INCOMPLETE");
    }
    if (!traccarBaseUrl || !traccarAdminEmail || !traccarAdminPassword) {
      throw new Error("TRACCAR_CONNECTION_CONFIGURATION_INCOMPLETE");
    }
    const dbAdapter = new SupabaseDatabaseAdapter({
      connectionString: supabaseDbUrl,
      ssl: process.env.SUPABASE_DB_SSL !== "false"
    });

    await dbAdapter.applySchemaMigration();

    const authService = new SupabaseAuthService({
      supabaseUrl,
      supabaseAnonKey,
      supabaseServiceRoleKey,
      supabaseJwtSecret,
      dbAdapter
    });

    const traccarClient = new TraccarBridgeClient({
      baseUrl: traccarBaseUrl,
      adminEmail: traccarAdminEmail,
      adminPassword: traccarAdminPassword
    });

    const smsGateway = {
      async sendSms({ toE164, text }) {
        if (!smsGatewayUrl || !smsGatewayToken) {
          throw new Error("SMS_GATEWAY_NOT_CONFIGURED");
        }
        const res = await fetch(smsGatewayUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${smsGatewayToken}`
          },
          body: JSON.stringify({ to: toE164, message: text })
        });
        if (!res.ok) {
          throw new Error(`SMS_GATEWAY_HTTP_${res.status}`);
        }
        const body = await res.json();
        if (!body || !body.messageId) {
          throw new Error("SMS_GATEWAY_MISSING_MESSAGE_ID");
        }
        return { gatewayMessageId: String(body.messageId), initialStatus: "ACCEPTED" };
      }
    };

    const engine = new VeloTrackEngine({
      dbAdapter,
      authService,
      traccarClient,
      smsGateway
    });

    const initialAdminEmail = process.env.VELOTRACK_INITIAL_ADMIN_EMAIL ?? "";
    const initialAdminUsername = process.env.VELOTRACK_INITIAL_ADMIN_USERNAME ?? "";
    const initialAdminPassword = process.env.VELOTRACK_INITIAL_ADMIN_PASSWORD ?? "";
    const initialAdminPhone = process.env.VELOTRACK_INITIAL_ADMIN_PHONE ?? "";

    if (!initialAdminEmail || !initialAdminUsername || !initialAdminPassword || !initialAdminPhone) {
      throw new Error("VELOTRACK_INITIAL_ADMIN_CONFIGURATION_INCOMPLETE");
    }

    await engine.bootstrapInitialAdminIfNeeded({
      adminEmail: initialAdminEmail,
      adminUsername: initialAdminUsername,
      adminPassword: initialAdminPassword,
      adminPhone: initialAdminPhone
    });

    const requestListener = createVeloTrackRequestListener({
      engine,
      authService,
      traccarClient,
      smsWebhookSecret,
      smsGatewayConfigured: Boolean(smsGatewayUrl && smsGatewayToken)
    });

    return {
      dbAdapter,
      authService,
      traccarClient,
      engine,
      requestListener,
      smsWebhookSecret,
      smsGatewayConfigured: Boolean(smsGatewayUrl && smsGatewayToken)
    };
  })();

  return cachedRuntimePromise;
}

async function startProductionServer() {
  const host = process.env.HOST ?? "0.0.0.0";
  const port = Number(process.env.DEFAULT_APP_PORT ?? process.env.PORT ?? 3000);
  const runtime = await getOrCreateVeloTrackRuntime();

  if (process.env.TRACCAR_ADMIN_EMAIL && process.env.TRACCAR_ADMIN_PASSWORD) {
    runtime.traccarClient.connectLiveSocket({
      onUpdate: async (frame) => {
        await runtime.engine.ingestTraccarUpdate(frame);
      }
    });
  }

  const server = createVeloTrackHttpServer({
    engine: runtime.engine,
    authService: runtime.authService,
    traccarClient: runtime.traccarClient,
    smsWebhookSecret: runtime.smsWebhookSecret,
    smsGatewayConfigured: runtime.smsGatewayConfigured
  });

  server.listen(port, host, () => {
    console.log(`VeloTrack backend listening on http://${host}:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startProductionServer().catch((err) => {
    console.error("Failed to start VeloTrack backend:", err.message);
    process.exit(1);
  });
}
