import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_GITHUB_REPO,
  LiveWebSocketHub,
  SupabaseAuthService,
  SupabaseDatabaseAdapter,
  TraccarBridgeClient,
  VELOTRACK_APP_VERSION,
  VELOTRACK_SCHEMA_VERSION,
  VeloTrackEngine,
  checkGitHubReleaseStatus
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

function resolveAllowedOrigin(req, allowedOriginsConfig = process.env.CORS_ALLOWED_ORIGINS ?? "") {
  const requestOrigin = String(req?.headers?.origin ?? "").trim();
  const configured = String(allowedOriginsConfig ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (configured.includes("*")) {
    return requestOrigin || "*";
  }

  const defaultDevOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ];
  const allowSet = new Set([...defaultDevOrigins, ...configured]);

  if (!requestOrigin) {
    return configured[0] ?? defaultDevOrigins[0];
  }
  if (allowSet.has(requestOrigin)) {
    return requestOrigin;
  }
  return configured[0] ?? defaultDevOrigins[0];
}

function sendJson(res, status, payload, req = null, allowedOriginsConfig = "") {
  const allowOrigin = resolveAllowedOrigin(req, allowedOriginsConfig);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Sms-Webhook-Secret",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

export function createVeloTrackRequestListener({
  engine,
  authService,
  traccarClient,
  smsWebhookSecret = process.env.SMS_WEBHOOK_SECRET ?? "",
  smsGatewayConfigured = false,
  corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS ?? "",
  githubRepo = process.env.VELOTRACK_GITHUB_REPO ?? DEFAULT_GITHUB_REPO,
  appVersion = process.env.VELOTRACK_APP_VERSION ?? VELOTRACK_APP_VERSION,
  releaseFetchImpl = globalThis.fetch
}) {
  let autoUpdateEnabled = process.env.VELOTRACK_AUTO_UPDATE_ENABLED !== "false";

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
      return sendJson(res, 200, { ok: true }, req, corsAllowedOrigins);
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
        return sendJson(
          res,
          healthy ? 200 : 503,
          {
            status: healthy ? "OK" : "DEGRADED",
            version: appVersion,
            schemaVersion: VELOTRACK_SCHEMA_VERSION,
            repository: githubRepo,
            supabaseConnected: databaseConnected,
            databaseError,
            traccarConnected: Boolean(traccarClient.sessionCookie),
            traccarWsConnected: Boolean(traccarClient.wsConnected),
            traccarLastSyncAtMs: traccarClient.lastSyncAtMs,
            smsGatewayConfigured: Boolean(smsGatewayConfigured)
          },
          req,
          corsAllowedOrigins
        );
      }

      if (
        (req.method === "GET" || req.method === "POST") &&
        (pathname === "/api/v1/system/version" || pathname === "/api/v1/system/check-update")
      ) {
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          if (typeof body.autoUpdateEnabled === "boolean") {
            autoUpdateEnabled = body.autoUpdateEnabled;
          }
        }
        const releaseInfo = await checkGitHubReleaseStatus({
          repo: githubRepo,
          currentVersion: appVersion,
          autoUpdateEnabled,
          fetchImpl: releaseFetchImpl
        });
        return sendJson(res, 200, releaseInfo, req, corsAllowedOrigins);
      }

      if (req.method === "POST" && pathname === "/api/v1/auth/login") {
        const body = await readJsonBody(req);
        const identifier = body.identifier ?? body.username ?? body.phone ?? body.email ?? "";
        const session = await engine.login(identifier, body.password);
        return sendJson(res, 200, session, req, corsAllowedOrigins);
      }

      if (req.method === "POST" && pathname === "/api/v1/webhooks/sms/delivery") {
        verifyWebhookSecret(req);
        const body = await readJsonBody(req);
        const updated = await engine.handleSmsDeliveryWebhook(body);
        return sendJson(res, 200, updated, req, corsAllowedOrigins);
      }

      if (req.method === "POST" && pathname === "/api/v1/webhooks/sms/inbound") {
        verifyWebhookSecret(req);
        const body = await readJsonBody(req);
        const updated = await engine.handleInboundSmsReply(body);
        return sendJson(res, 200, updated, req, corsAllowedOrigins);
      }

      const claims = authenticateRequest(req);

      if (req.method === "GET" && pathname === "/api/v1/auth/me") {
        const user = await engine.getAuthenticatedUserProfile(claims);
        return sendJson(res, 200, user, req, corsAllowedOrigins);
      }

      if (req.method === "POST" && pathname === "/api/v1/auth/ws-ticket") {
        const issued = authService.issueWebSocketTicket(claims);
        return sendJson(
          res,
          200,
          {
            ticket: typeof issued === "string" ? issued : issued.ticket,
            expiresAtMs: issued.expiresAtMs,
            expiresInSeconds: 45
          },
          req,
          corsAllowedOrigins
        );
      }

      if (req.method === "POST" && pathname === "/api/v1/auth/change-password") {
        const body = await readJsonBody(req);
        const updatedSession = await engine.changePassword(claims, {
          currentPassword: body.currentPassword,
          newPassword: body.newPassword
        });
        return sendJson(res, 200, updatedSession, req, corsAllowedOrigins);
      }

      if (req.method === "GET" && pathname === "/api/v1/users") {
        const list = await engine.listUsers(claims);
        return sendJson(res, 200, list, req, corsAllowedOrigins);
      }

      if (req.method === "POST" && pathname === "/api/v1/users") {
        const body = await readJsonBody(req);
        const created = await engine.createUserAccount(claims, body);
        return sendJson(res, 201, created, req, corsAllowedOrigins);
      }

      if (req.method === "POST" && pathname === "/api/v1/admin/customers") {
        const body = await readJsonBody(req);
        const created = await engine.createCustomerAccount(claims, body);
        return sendJson(res, 201, created, req, corsAllowedOrigins);
      }

      const userStatusMatch = /^\/api\/v1\/users\/([^/]+)\/status$/.exec(pathname);
      if (req.method === "POST" && userStatusMatch) {
        const body = await readJsonBody(req);
        const updated = await engine.setUserActiveStatus(claims, userStatusMatch[1], {
          isActive: body.isActive
        });
        return sendJson(res, 200, updated, req, corsAllowedOrigins);
      }

      const userMatch = /^\/api\/v1\/(?:users|customers)\/([^/]+)$/.exec(pathname);
      if (userMatch) {
        const targetUserId = userMatch[1];
        if (req.method === "GET") {
          const details = await engine.getCustomerDetails(claims, targetUserId);
          return sendJson(res, 200, details, req, corsAllowedOrigins);
        }
        if (req.method === "PATCH" || req.method === "PUT") {
          const body = await readJsonBody(req);
          const updated = await engine.updateUserAccount(claims, targetUserId, body);
          return sendJson(res, 200, updated, req, corsAllowedOrigins);
        }
        if (req.method === "DELETE") {
          const deleted = await engine.deleteUserAccount(claims, targetUserId);
          return sendJson(res, 200, deleted, req, corsAllowedOrigins);
        }
      }

      if (req.method === "GET" && pathname === "/api/v1/profiles") {
        const list = await engine.listDeviceProfiles(claims);
        return sendJson(res, 200, list, req, corsAllowedOrigins);
      }

      if (req.method === "POST" && pathname === "/api/v1/profiles") {
        const body = await readJsonBody(req);
        const created = await engine.registerDeviceProfile(claims, body);
        return sendJson(res, 201, created, req, corsAllowedOrigins);
      }

      const verifyProfileMatch = /^\/api\/v1\/admin\/profiles\/([^/]+)\/verify$/.exec(pathname);
      if (req.method === "POST" && verifyProfileMatch) {
        const verified = await engine.markProfileVerifiedAfterPhysicalTest(
          claims,
          verifyProfileMatch[1]
        );
        return sendJson(res, 200, verified, req, corsAllowedOrigins);
      }

      if (req.method === "GET" && pathname === "/api/v1/devices") {
        const devices = await engine.listAuthorizedDevices(claims);
        return sendJson(res, 200, devices, req, corsAllowedOrigins);
      }

      if (req.method === "POST" && pathname === "/api/v1/admin/devices/activate") {
        const body = await readJsonBody(req);
        const result = await engine.provisionAndActivateDevice(claims, body);
        return sendJson(res, 201, result, req, corsAllowedOrigins);
      }

      const sendSmsMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/send-activation-sms$/.exec(
        pathname
      );
      if (req.method === "POST" && sendSmsMatch) {
        const body = await readJsonBody(req);
        const result = await engine.sendDeviceActivationSms(claims, {
          deviceId: sendSmsMatch[1],
          idempotencyKey: body.idempotencyKey ?? null,
          forceResend: Boolean(body.forceResend)
        });
        return sendJson(res, 200, result, req, corsAllowedOrigins);
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
        return sendJson(res, 200, result, req, corsAllowedOrigins);
      }

      const reassignMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/reassign$/.exec(pathname);
      if (req.method === "POST" && reassignMatch) {
        const body = await readJsonBody(req);
        const result = await engine.reassignCustomer(claims, {
          deviceId: reassignMatch[1],
          newCustomerId: body.newCustomerId,
          reason: body.reason
        });
        return sendJson(res, 200, result, req, corsAllowedOrigins);
      }

      const renewMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/renew$/.exec(pathname);
      if (req.method === "POST" && renewMatch) {
        const body = await readJsonBody(req);
        const result = await engine.renewSubscription(claims, {
          deviceId: renewMatch[1],
          planDuration: body.planDuration
        });
        return sendJson(res, 200, result, req, corsAllowedOrigins);
      }

      const suspendMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/suspend$/.exec(pathname);
      if (req.method === "POST" && suspendMatch) {
        const body = await readJsonBody(req);
        const result = await engine.suspendSubscription(claims, {
          deviceId: suspendMatch[1],
          reason: body.reason
        });
        return sendJson(res, 200, result, req, corsAllowedOrigins);
      }

      const resumeMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/resume$/.exec(pathname);
      if (req.method === "POST" && resumeMatch) {
        const body = await readJsonBody(req);
        const result = await engine.resumeSubscription(claims, {
          deviceId: resumeMatch[1],
          reason: body.reason
        });
        return sendJson(res, 200, result, req, corsAllowedOrigins);
      }


      if (req.method === "GET" && pathname === "/api/v1/events") {
        const events = await engine.getAuthorizedFleetEvents(claims, {
          deviceId: url.searchParams.get("deviceId"),
          fromIso: url.searchParams.get("from") ?? new Date(Date.now() - 7 * 86400000).toISOString(),
          toIso: url.searchParams.get("to") ?? new Date().toISOString()
        });
        return sendJson(res, 200, events, req, corsAllowedOrigins);
      }

      if (req.method === "GET" && pathname === "/api/v1/reports/summary") {
        const report = await engine.getAuthorizedMileageSummary(claims, {
          deviceId: url.searchParams.get("deviceId"),
          fromIso: url.searchParams.get("from") ?? new Date(Date.now() - 86400000).toISOString(),
          toIso: url.searchParams.get("to") ?? new Date().toISOString()
        });
        return sendJson(res, 200, report, req, corsAllowedOrigins);
      }

      if (req.method === "GET" && pathname === "/api/v1/telemetry") {
        const telemetry = await engine.getAuthorizedFleetTelemetry(
          claims, url.searchParams.get("deviceId")
        );
        return sendJson(res, 200, telemetry, req, corsAllowedOrigins);
      }

      if (pathname === "/api/v1/geofences" && req.method === "GET") {
        const zones = await engine.listAuthorizedGeofences(claims);
        return sendJson(res, 200, zones, req, corsAllowedOrigins);
      }

      if (pathname === "/api/v1/geofences" && req.method === "POST") {
        const body = await readJsonBody(req);
        const zone = await engine.createAuthorizedGeofence(claims, body);
        return sendJson(res, 201, zone, req, corsAllowedOrigins);
      }

      const geofencePrefix = "/api/v1/geofences/";
      const geofenceId = pathname.startsWith(geofencePrefix)
        ? pathname.slice(geofencePrefix.length)
        : "";
      if (req.method === "DELETE" && geofenceId && /^[0-9]+$/.test(geofenceId)) {
        const result = await engine.deleteAuthorizedGeofence(claims, geofenceId);
        return sendJson(res, 200, result, req, corsAllowedOrigins);
      }

      const devicePrefix = "/api/v1/devices/";
      const shareSuffix = "/share";
      const shareDeviceId = pathname.startsWith(devicePrefix) && pathname.endsWith(shareSuffix)
        ? pathname.slice(devicePrefix.length, -shareSuffix.length)
        : "";
      if (req.method === "POST" && shareDeviceId && !shareDeviceId.includes("/")) {
        const body = await readJsonBody(req);
        const result = await engine.createAuthorizedDeviceShare(claims, {
          deviceId: shareDeviceId,
          expiresInHours: body.expiresInHours ?? 24
        });
        return sendJson(res, 201, result, req, corsAllowedOrigins);
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
        return sendJson(res, 200, history, req, corsAllowedOrigins);
      }

      const cmdTypesMatch = /^\/api\/v1\/devices\/([^/]+)\/commands\/types$/.exec(pathname);
      if (req.method === "GET" && cmdTypesMatch) {
        const types = await engine.getSupportedDeviceCommands(claims, cmdTypesMatch[1]);
        return sendJson(res, 200, types, req, corsAllowedOrigins);
      }

      const cmdMatch = /^\/api\/v1\/devices\/([^/]+)\/commands$/.exec(pathname);
      if (cmdMatch) {
        const targetDeviceId = cmdMatch[1];
        if (req.method === "GET") {
          const history = await engine.listDeviceCommandHistory(claims, targetDeviceId);
          return sendJson(res, 200, history, req, corsAllowedOrigins);
        }
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          const sent = await engine.sendAuthorizedDeviceCommand(claims, {
            deviceId: targetDeviceId,
            type: body.type,
            parameters: body.parameters ?? body.attributes ?? {},
            confirmedSensitive: Boolean(body.confirmedSensitive || body.confirmed)
          });
          return sendJson(res, 200, sent, req, corsAllowedOrigins);
        }
      }

      const deviceDetailMatch = /^\/api\/v1\/(?:admin\/)?devices\/([^/]+)$/.exec(pathname);
      if (deviceDetailMatch) {
        const targetDeviceId = deviceDetailMatch[1];
        if (req.method === "GET") {
          const details = await engine.getAuthorizedDeviceDetails(claims, targetDeviceId);
          return sendJson(res, 200, details, req, corsAllowedOrigins);
        }
        if (req.method === "PATCH" || req.method === "PUT") {
          const body = await readJsonBody(req);
          const updated = await engine.updateVehicleMetadata(claims, targetDeviceId, body);
          return sendJson(res, 200, updated, req, corsAllowedOrigins);
        }
      }

      if (req.method === "POST" && pathname === "/api/v1/admin/traccar/sync") {
        if (claims.role !== "ADMIN") throw new Error("FORBIDDEN_ADMIN_ONLY");
        const snapshot = await traccarClient.fetchDevicesAndPositions();
        const updatedIds = await engine.ingestTraccarUpdate({
          traccarDevices: snapshot.devices,
          traccarPositions: snapshot.positions
        });
        return sendJson(
          res,
          200,
          {
            updatedDeviceIds: updatedIds,
            syncedAtMs: traccarClient.lastSyncAtMs
          },
          req,
          corsAllowedOrigins
        );
      }

      sendJson(res, 404, { error: "NOT_FOUND" }, req, corsAllowedOrigins);
    } catch (err) {
      const msg = err.message ?? "SERVER_ERROR";
      const status =
        msg.startsWith("AUTH_") || msg === "INVALID_CREDENTIALS"
          ? 401
          : msg.startsWith("FORBIDDEN") ||
            msg === "SUBSCRIPTION_EXPIRED" ||
            msg === "SUBSCRIPTION_SUSPENDED" ||
            msg === "PASSWORD_CHANGE_REQUIRED" ||
            msg === "ACCOUNT_DEACTIVATED"
          ? 403
          : msg.endsWith("NOT_FOUND")
          ? 404
          : 400;
      const finalStatus =
        msg === "TRACCAR_PUBLIC_URL_NOT_CONFIGURED" ||
        msg === "TRACCAR_PUBLIC_URL_MUST_USE_HTTPS"
          ? 503
          : msg.startsWith("TRACCAR_API_REQUEST_FAILED_")
            ? 502
            : status;
      sendJson(res, finalStatus, { error: msg }, req, corsAllowedOrigins);
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
    const supabaseAnonKey =
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      "";
    const supabaseSecretKey =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "";
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
      !supabaseSecretKey ||
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
      supabaseSecretKey,
      supabaseServiceRoleKey: supabaseSecretKey,
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

    const initialAdminEmail = (process.env.VELOTRACK_INITIAL_ADMIN_EMAIL ?? "").trim();
    const initialAdminPassword = process.env.VELOTRACK_INITIAL_ADMIN_PASSWORD ?? "";
    if (initialAdminEmail && initialAdminPassword) {
      await engine.bootstrapInitialAdminIfNeeded({
        adminEmail: initialAdminEmail,
        adminUsername: process.env.VELOTRACK_INITIAL_ADMIN_USERNAME || "admin",
        adminPassword: initialAdminPassword,
        adminPhone: process.env.VELOTRACK_INITIAL_ADMIN_PHONE ?? ""
      });
    } else if (initialAdminEmail || initialAdminPassword) {
      throw new Error("VELOTRACK_INITIAL_ADMIN_CONFIGURATION_INCOMPLETE");
    }

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
