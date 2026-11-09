import http from "node:http";
import crypto from "node:crypto";
import { AuthService, TraccarBridgeClient, VeloTrackEngine } from "./core.mjs";

const port = Number(process.env.PORT ?? 3000);
const jwtSecret = process.env.VELOTRACK_JWT_SECRET;
const traccarBaseUrl = process.env.TRACCAR_BASE_URL ?? "http://127.0.0.1:8082";
const traccarAdminEmail = process.env.TRACCAR_ADMIN_EMAIL ?? "";
const traccarAdminPassword = process.env.TRACCAR_ADMIN_PASSWORD ?? "";
const smsGatewayUrl = process.env.SMS_GATEWAY_URL ?? "";
const smsGatewayToken = process.env.SMS_GATEWAY_TOKEN ?? "";
const smsWebhookSecret = process.env.SMS_WEBHOOK_SECRET ?? "";

const authService = new AuthService(jwtSecret);
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

const engine = new VeloTrackEngine({ authService, traccarClient, smsGateway });

function readJsonBody(req) {
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
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/api/v1/health") {
      return sendJson(res, 200, {
        status: "OK",
        traccarConnected: Boolean(traccarClient.sessionCookie),
        traccarLastSyncAtMs: traccarClient.lastSyncAtMs,
        smsGatewayConfigured: Boolean(smsGatewayUrl && smsGatewayToken)
      });
    }

    if (req.method === "POST" && pathname === "/api/v1/auth/login") {
      const body = await readJsonBody(req);
      const session = engine.login(body.email, body.password);
      return sendJson(res, 200, session);
    }

    if (req.method === "POST" && pathname === "/api/v1/webhooks/sms/delivery") {
      verifyWebhookSecret(req);
      const body = await readJsonBody(req);
      const updated = engine.handleSmsDeliveryWebhook(body);
      return sendJson(res, 200, updated);
    }

    if (req.method === "POST" && pathname === "/api/v1/webhooks/sms/inbound") {
      verifyWebhookSecret(req);
      const body = await readJsonBody(req);
      const updated = engine.handleInboundSmsReply(body);
      return sendJson(res, 200, updated);
    }

    const claims = authenticateRequest(req);

    if (req.method === "GET" && pathname === "/api/v1/auth/me") {
      const u = engine.users.get(claims.userId);
      if (!u) throw new Error("AUTH_USER_NOT_FOUND");
      return sendJson(res, 200, {
        id: u.id,
        email: u.email,
        phone: u.phone,
        fullName: u.fullName,
        role: u.role
      });
    }

    if (req.method === "GET" && pathname === "/api/v1/users") {
      if (claims.role !== "ADMIN") throw new Error("FORBIDDEN_ADMIN_ONLY");
      const list = [...engine.users.values()].map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        fullName: u.fullName,
        role: u.role,
        isActive: u.isActive,
        createdAtMs: u.createdAtMs
      }));
      return sendJson(res, 200, list);
    }

    if (req.method === "GET" && pathname === "/api/v1/profiles") {
      const list = [...engine.profiles.values()];
      return sendJson(res, 200, list);
    }

    if (req.method === "POST" && pathname === "/api/v1/profiles") {
      const body = await readJsonBody(req);
      const created = engine.registerDeviceProfile(claims, body);
      return sendJson(res, 201, created);
    }

    if (req.method === "GET" && pathname === "/api/v1/devices") {
      return sendJson(res, 200, engine.listAuthorizedDevices(claims));
    }

    if (req.method === "POST" && pathname === "/api/v1/admin/devices/activate") {
      const body = await readJsonBody(req);
      const result = await engine.provisionAndActivateDevice(claims, body);
      return sendJson(res, 201, result);
    }

    const overrideMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/override-activate$/.exec(pathname);
    if (req.method === "POST" && overrideMatch) {
      const body = await readJsonBody(req);
      const result = engine.adminOverrideActivation(claims, {
        deviceId: overrideMatch[1],
        auditReason: body.auditReason
      });
      return sendJson(res, 200, result);
    }

    const reassignMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/reassign$/.exec(pathname);
    if (req.method === "POST" && reassignMatch) {
      const body = await readJsonBody(req);
      const result = engine.reassignCustomer(claims, {
        deviceId: reassignMatch[1],
        newCustomerId: body.newCustomerId,
        reason: body.reason
      });
      return sendJson(res, 200, result);
    }

    const renewMatch = /^\/api\/v1\/admin\/devices\/([^/]+)\/renew$/.exec(pathname);
    if (req.method === "POST" && renewMatch) {
      const body = await readJsonBody(req);
      const result = engine.renewSubscription(claims, {
        deviceId: renewMatch[1],
        planDuration: body.planDuration
      });
      return sendJson(res, 200, result);
    }

    const historyMatch = /^\/api\/v1\/devices\/([^/]+)\/history$/.exec(pathname);
    if (req.method === "GET" && historyMatch) {
      const fromIso = url.searchParams.get("from") ?? new Date(Date.now() - 86400000).toISOString();
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
      const updatedIds = engine.ingestTraccarUpdate({
        traccarDevices: snapshot.devices,
        traccarPositions: snapshot.positions
      });
      return sendJson(res, 200, { updatedDeviceIds: updatedIds, syncedAtMs: traccarClient.lastSyncAtMs });
    }

    sendJson(res, 404, { error: "NOT_FOUND" });
  } catch (err) {
    const msg = err.message ?? "SERVER_ERROR";
    const status =
      msg.startsWith("AUTH_") || msg === "INVALID_CREDENTIALS"
        ? 401
        : msg.startsWith("FORBIDDEN") || msg === "SUBSCRIPTION_EXPIRED"
        ? 403
        : 400;
    sendJson(res, status, { error: msg });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`VeloTrack backend listening on http://127.0.0.1:${port}`);
});
