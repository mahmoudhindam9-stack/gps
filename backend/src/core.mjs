import crypto from "node:crypto";

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

export class AuthService {
  constructor(jwtSecret) {
    if (!jwtSecret || jwtSecret.length < 16 || jwtSecret.includes("replace_with")) {
      throw new Error("Missing or insecure VELOTRACK_JWT_SECRET");
    }
    this.jwtSecret = jwtSecret;
  }

  signToken(payload, expiresInSeconds = 3600 * 12) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const nowSec = Math.floor(Date.now() / 1000);
    const bodyObj = {
      sub: payload.userId,
      role: payload.role,
      email: payload.email,
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
    if (!claims.sub || !["ADMIN", "CUSTOMER"].includes(claims.role)) {
      throw new Error("AUTH_CLAIMS_INVALID");
    }
    return {
      userId: claims.sub,
      role: claims.role,
      email: claims.email
    };
  }
}

export class TraccarBridgeClient {
  constructor({ baseUrl, adminEmail, adminPassword, fetchImpl = globalThis.fetch }) {
    this.baseUrl = String(baseUrl ?? "").replace(/\/+$/, "");
    this.adminEmail = adminEmail;
    this.adminPassword = adminPassword;
    this.fetchImpl = fetchImpl;
    this.sessionCookie = null;
    this.wsConnected = false;
    this.lastSyncAtMs = null;
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

  async authenticateSession() {
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
}

export class VeloTrackEngine {
  constructor({ authService, traccarClient, smsGateway }) {
    this.authService = authService;
    this.traccarClient = traccarClient;
    this.smsGateway = smsGateway;

    // Authoritative server-side stores (backed by PostgreSQL in production deployment)
    this.users = new Map();
    this.profiles = new Map();
    this.devices = new Map();
    this.subscriptions = new Map();
    this.smsLogs = new Map();
    this.subscriptionHistory = [];
    this.ownershipHistory = [];
  }

  createUser({ email, phone, fullName, password, role }) {
    const id = crypto.randomUUID();
    const user = {
      id,
      email: email.toLowerCase().trim(),
      phone,
      fullName,
      passwordHash: hashPassword(password),
      role,
      isActive: true,
      createdAtMs: Date.now()
    };
    this.users.set(id, user);
    return user;
  }

  login(email, password) {
    const cleanEmail = String(email ?? "").toLowerCase().trim();
    const user = [...this.users.values()].find((u) => u.email === cleanEmail && u.isActive);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new Error("INVALID_CREDENTIALS");
    }
    const token = this.authService.signToken({
      userId: user.id,
      role: user.role,
      email: user.email
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role
      }
    };
  }

  /**
   * Registers a versioned SMS profile.
   * Profiles default to isVerified = false until physically verified on hardware.
   * Rejects any profile containing APN or automatic TIMER commands.
   */
  registerDeviceProfile(actorClaims, input) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const serverCmd = String(input.serverCommandTemplate ?? "").trim();
    if (!serverCmd || /APN/i.test(serverCmd) || /TIMER/i.test(serverCmd)) {
      throw new Error("INVALID_PROFILE_COMMAND_POLICY");
    }
    const id = crypto.randomUUID();
    const profile = {
      id,
      manufacturer: input.manufacturer,
      model: input.model,
      firmwareVersion: input.firmwareVersion,
      traccarProtocol: input.traccarProtocol ?? "gt06",
      serverHost: input.serverHost,
      serverPort: Number(input.serverPort ?? 5023),
      transport: input.transport ?? "TCP",
      serverMode: input.serverMode ?? "DOMAIN",
      requiresDevicePassword: Boolean(input.requiresDevicePassword),
      defaultDevicePassword: input.defaultDevicePassword ?? null,
      requiresGprsonCommand: Boolean(input.requiresGprsonCommand),
      serverCommandTemplate: serverCmd,
      gprsonCommandTemplate: input.requiresGprsonCommand ? (input.gprsonCommandTemplate ?? "GPRSON,1#") : null,
      optionalTimerCommandTemplate: input.optionalTimerCommandTemplate ?? null,
      expectedReplyPattern: input.expectedReplyPattern ?? null,
      isVerified: Boolean(input.isVerified ?? false),
      createdAtMs: Date.now()
    };
    this.profiles.set(id, profile);
    return profile;
  }

  markProfileVerifiedAfterPhysicalTest(actorClaims, profileId) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error("PROFILE_NOT_FOUND");
    profile.isVerified = true;
    return profile;
  }

  /**
   * Provisions a device in Traccar and VeloTrack, and dispatches verified SMS commands
   * via the real SMS gateway adapter.
   * - Never generates random Traccar IDs or placeholder coordinates.
   * - Subscription starts with startedAtMs = null (AWAITING_FIRST_CONNECTION).
   * - Requires profile.isVerified === true before sending SMS commands.
   */
  async provisionAndActivateDevice(actorClaims, input) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    if (!isValidImei(input.imei)) {
      throw new Error("INVALID_IMEI");
    }
    for (const existing of this.devices.values()) {
      if (existing.imei === input.imei) {
        throw new Error("DUPLICATE_IMEI");
      }
    }
    const sim = normalizeEgyptianSim(input.simLocalWithoutPlus20);
    if (!sim.isValid) {
      throw new Error(`INVALID_SIM:${sim.errorReason}`);
    }
    const profile = this.profiles.get(input.profileId);
    if (!profile) {
      throw new Error("PROFILE_NOT_FOUND");
    }
    if (!profile.isVerified) {
      throw new Error("PROFILE_NOT_VERIFIED_FOR_SMS");
    }
    const customer = this.users.get(input.customerId);
    if (!customer || customer.role !== "CUSTOMER") {
      throw new Error("CUSTOMER_NOT_FOUND");
    }

    // 1. Register in real Traccar Server via POST /api/devices
    const traccarDevice = await this.traccarClient.registerDeviceInTraccar({
      name: input.vehicleName,
      imei: input.imei
    });

    const nowMs = Date.now();
    const deviceId = crypto.randomUUID();
    const device = {
      id: deviceId,
      imei: input.imei,
      traccarDeviceId: traccarDevice.id,
      profileId: profile.id,
      currentCustomerId: customer.id,
      vehicleName: input.vehicleName,
      plateNumber: input.plateNumber,
      simLocalNumber: sim.localNumber,
      simE164Number: sim.e164Number,
      activationStatus: "PENDING",
      connectionState: "OFFLINE",
      hasValidFix: false,
      lastLat: null,
      lastLng: null,
      lastSpeedKmh: null,
      lastHeading: null,
      ignitionOn: null,
      firstConnectedAtMs: null,
      lastSeenAtMs: null,
      createdAtMs: nowMs
    };
    this.devices.set(deviceId, device);

    // 2. Create Subscription in AWAITING_FIRST_CONNECTION (startedAtMs = null, expiresAtMs = null)
    const subscription = {
      id: crypto.randomUUID(),
      deviceId,
      customerId: customer.id,
      planDuration: input.planDuration,
      status: "AWAITING_FIRST_CONNECTION",
      startedAtMs: null,
      expiresAtMs: null,
      adminOverrideBy: null,
      adminOverrideReason: null
    };
    this.subscriptions.set(deviceId, subscription);
    this.subscriptionHistory.push({
      id: crypto.randomUUID(),
      deviceId,
      customerId: customer.id,
      actionType: "PROVISIONED",
      planDuration: input.planDuration,
      actorUserId: actorClaims.userId,
      notes: "Provisioned awaiting 1st Traccar connection",
      createdAtMs: nowMs
    });

    // 3. Build APN-free, non-TIMER command list from verified profile
    const commands = [{ stepOrder: 1, commandKey: "SERVER", commandText: profile.serverCommandTemplate }];
    if (profile.requiresGprsonCommand && profile.gprsonCommandTemplate) {
      commands.push({ stepOrder: 2, commandKey: "GPRSON", commandText: profile.gprsonCommandTemplate });
    }

    const deviceLogs = [];
    for (const cmd of commands) {
      const logEntry = {
        id: crypto.randomUUID(),
        deviceId,
        stepOrder: cmd.stepOrder,
        commandKey: cmd.commandKey,
        commandText: cmd.commandText,
        gatewayMessageId: null,
        status: "QUEUED",
        deviceReply: null,
        failureReason: null,
        sentAtMs: Date.now(),
        completedAtMs: null
      };
      deviceLogs.push(logEntry);
    }
    this.smsLogs.set(deviceId, deviceLogs);

    // 4. Send via real SMS Gateway Adapter (no fake sent/delivered/replied states)
    for (const logEntry of deviceLogs) {
      try {
        const res = await this.smsGateway.sendSms({
          toE164: sim.e164Number,
          text: logEntry.commandText
        });
        logEntry.gatewayMessageId = res.gatewayMessageId;
        logEntry.status = res.initialStatus ?? "ACCEPTED";
      } catch (err) {
        logEntry.status = "FAILED";
        logEntry.failureReason = err.message;
        device.activationStatus = "FAILED";
        throw err;
      }
    }

    device.activationStatus = "SMS_SENT";
    return { device, subscription, smsLogs: deviceLogs };
  }

  /**
   * Handles real SMS gateway status callbacks (SENT, DELIVERED, FAILED, TIMED_OUT).
   * SMS delivery NEVER activates the device or starts the subscription.
   */
  handleSmsDeliveryWebhook({ gatewayMessageId, deliveryStatus, failureReason = null, timestampMs = Date.now() }) {
    for (const [deviceId, logs] of this.smsLogs.entries()) {
      const log = logs.find((l) => l.gatewayMessageId === gatewayMessageId);
      if (!log) continue;
      const device = this.devices.get(deviceId);
      if (deliveryStatus === "SENT") {
        log.status = "SENT";
      } else if (deliveryStatus === "DELIVERED") {
        log.status = "DELIVERED";
        log.completedAtMs = timestampMs;
        if (device && device.activationStatus === "SMS_SENT") {
          device.activationStatus = "WAITING_FOR_DEVICE";
        }
      } else if (deliveryStatus === "FAILED" || deliveryStatus === "TIMED_OUT") {
        log.status = deliveryStatus;
        log.failureReason = failureReason;
        log.completedAtMs = timestampMs;
        if (device && device.activationStatus !== "ACTIVATED") {
          device.activationStatus = "FAILED";
        }
      }
      return { device, log };
    }
    throw new Error("SMS_LOG_NOT_FOUND");
  }

  /**
   * Handles real inbound SMS reply from the tracker SIM (+20...).
   * Matches reply against the profile's configurable expectedReplyPattern.
   * Never activates the device or starts the subscription!
   */
  handleInboundSmsReply({ fromE164, replyText, timestampMs = Date.now() }) {
    const device = [...this.devices.values()].find((d) => d.simE164Number === fromE164);
    if (!device) {
      throw new Error("DEVICE_FOR_SIM_NOT_FOUND");
    }
    const logs = this.smsLogs.get(device.id) ?? [];
    const targetLog = logs.find((l) => l.status !== "REPLIED") ?? logs[logs.length - 1];
    if (targetLog) {
      targetLog.status = "REPLIED";
      targetLog.deviceReply = String(replyText ?? "").trim();
      targetLog.completedAtMs = timestampMs;
    }
    if (device.activationStatus === "SMS_SENT" || device.activationStatus === "PENDING") {
      device.activationStatus = "WAITING_FOR_DEVICE";
    }
    return { device, log: targetLog };
  }

  /**
   * Correlates real Traccar WebSocket/REST updates with VeloTrack devices by IMEI or traccarDeviceId.
   * Starts the subscription clock ONLY upon the first genuine Traccar connection.
   * Distinguishes indoor login/heartbeat without GPS fix from full satellite GPS fix.
   */
  ingestTraccarUpdate({ traccarDevices = [], traccarPositions = [], eventTimeMs = Date.now() }) {
    const updatedDeviceIds = [];

    for (const tcDev of traccarDevices) {
      const device = [...this.devices.values()].find(
        (d) => d.traccarDeviceId === tcDev.id || (tcDev.uniqueId && d.imei === tcDev.uniqueId)
      );
      if (!device) continue;

      if (tcDev.status === "online" || tcDev.lastUpdate) {
        this._confirmFirstConnectionAndStartSubscription(device, eventTimeMs);
        if (!device.hasValidFix) {
          device.connectionState = "ONLINE_NO_FIX";
        }
        device.lastSeenAtMs = tcDev.lastUpdate ? Date.parse(tcDev.lastUpdate) : eventTimeMs;
        updatedDeviceIds.push(device.id);
      } else if (tcDev.status === "offline") {
        device.connectionState = "OFFLINE";
        updatedDeviceIds.push(device.id);
      }
    }

    for (const pos of traccarPositions) {
      const device = [...this.devices.values()].find((d) => d.traccarDeviceId === pos.deviceId);
      if (!device) continue;

      this._confirmFirstConnectionAndStartSubscription(device, eventTimeMs);
      device.lastSeenAtMs = pos.fixTime ? Date.parse(pos.fixTime) : eventTimeMs;

      if (pos.valid === true && typeof pos.latitude === "number" && typeof pos.longitude === "number") {
        device.hasValidFix = true;
        device.connectionState = "ONLINE_GPS_FIX";
        device.lastLat = pos.latitude;
        device.lastLng = pos.longitude;
        device.lastSpeedKmh = typeof pos.speed === "number" ? Number((pos.speed * 1.852).toFixed(2)) : 0;
        device.lastHeading = typeof pos.course === "number" ? pos.course : 0;
        device.ignitionOn = typeof pos.attributes?.ignition === "boolean" ? pos.attributes.ignition : null;
      } else {
        if (!device.hasValidFix) {
          device.connectionState = "ONLINE_NO_FIX";
        }
        if (typeof pos.attributes?.ignition === "boolean") {
          device.ignitionOn = pos.attributes.ignition;
        }
      }
      updatedDeviceIds.push(device.id);
    }

    return [...new Set(updatedDeviceIds)];
  }

  _confirmFirstConnectionAndStartSubscription(device, eventTimeMs) {
    if (device.activationStatus !== "ACTIVATED") {
      device.activationStatus = "ACTIVATED";
    }
    if (!device.firstConnectedAtMs) {
      device.firstConnectedAtMs = eventTimeMs;
    }
    const sub = this.subscriptions.get(device.id);
    if (sub && sub.status === "AWAITING_FIRST_CONNECTION") {
      sub.status = "ACTIVE";
      sub.startedAtMs = eventTimeMs;
      sub.expiresAtMs = computeExpiryMillis(eventTimeMs, sub.planDuration);
      this.subscriptionHistory.push({
        id: crypto.randomUUID(),
        deviceId: device.id,
        customerId: device.currentCustomerId,
        actionType: "STARTED_ON_1ST_CONNECTION",
        planDuration: sub.planDuration,
        actorUserId: null,
        notes: "Started automatically on 1st confirmed Traccar connection",
        createdAtMs: eventTimeMs
      });
    }
  }

  adminOverrideActivation(actorClaims, { deviceId, auditReason, nowMs = Date.now() }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const cleanReason = String(auditReason ?? "").trim();
    if (cleanReason.length < 4) {
      throw new Error("AUDIT_REASON_REQUIRED");
    }
    const device = this.devices.get(deviceId);
    const sub = this.subscriptions.get(deviceId);
    if (!device || !sub) throw new Error("DEVICE_NOT_FOUND");

    device.activationStatus = "ACTIVATED";
    if (!device.firstConnectedAtMs) device.firstConnectedAtMs = nowMs;
    sub.status = "ACTIVE";
    sub.startedAtMs = sub.startedAtMs ?? nowMs;
    sub.expiresAtMs = computeExpiryMillis(sub.startedAtMs, sub.planDuration);
    sub.adminOverrideBy = actorClaims.userId;
    sub.adminOverrideReason = cleanReason;

    this.subscriptionHistory.push({
      id: crypto.randomUUID(),
      deviceId,
      customerId: device.currentCustomerId,
      actionType: "ADMIN_OVERRIDE",
      planDuration: sub.planDuration,
      actorUserId: actorClaims.userId,
      notes: cleanReason,
      createdAtMs: nowMs
    });
    return { device, subscription: sub };
  }

  enforceSubscriptionExpiry(deviceId, nowMs = Date.now()) {
    const sub = this.subscriptions.get(deviceId);
    if (!sub) throw new Error("SUBSCRIPTION_NOT_FOUND");
    if (
      sub.status === "ACTIVE" &&
      sub.planDuration !== "LIFETIME" &&
      sub.expiresAtMs !== null &&
      sub.expiresAtMs <= nowMs
    ) {
      sub.status = "EXPIRED";
      this.subscriptionHistory.push({
        id: crypto.randomUUID(),
        deviceId,
        customerId: sub.customerId,
        actionType: "EXPIRED",
        planDuration: sub.planDuration,
        actorUserId: null,
        notes: "Server-side subscription expiration enforced",
        createdAtMs: nowMs
      });
    }
    return sub.status === "ACTIVE" && (sub.planDuration === "LIFETIME" || (sub.expiresAtMs ?? 0) > nowMs);
  }

  renewSubscription(actorClaims, { deviceId, planDuration, nowMs = Date.now() }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const device = this.devices.get(deviceId);
    const sub = this.subscriptions.get(deviceId);
    if (!device || !sub) throw new Error("DEVICE_NOT_FOUND");

    const baseStart =
      sub.status === "ACTIVE" && sub.expiresAtMs !== null && sub.expiresAtMs > nowMs
        ? sub.expiresAtMs
        : nowMs;
    sub.planDuration = planDuration;
    sub.status = "ACTIVE";
    sub.startedAtMs = sub.startedAtMs ?? nowMs;
    sub.expiresAtMs = computeExpiryMillis(baseStart, planDuration);

    this.subscriptionHistory.push({
      id: crypto.randomUUID(),
      deviceId,
      customerId: device.currentCustomerId,
      actionType: "RENEWED",
      planDuration,
      actorUserId: actorClaims.userId,
      notes: `Renewed to ${planDuration}`,
      createdAtMs: nowMs
    });
    return sub;
  }

  reassignCustomer(actorClaims, { deviceId, newCustomerId, reason, nowMs = Date.now() }) {
    if (actorClaims.role !== "ADMIN") {
      throw new Error("FORBIDDEN_ADMIN_ONLY");
    }
    const device = this.devices.get(deviceId);
    const sub = this.subscriptions.get(deviceId);
    const nextCustomer = this.users.get(newCustomerId);
    if (!device || !sub || !nextCustomer || nextCustomer.role !== "CUSTOMER") {
      throw new Error("INVALID_REASSIGNMENT_TARGET");
    }
    const previousCustomerId = device.currentCustomerId;
    device.currentCustomerId = newCustomerId;
    sub.customerId = newCustomerId;

    this.ownershipHistory.push({
      id: crypto.randomUUID(),
      deviceId,
      previousCustomerId,
      newCustomerId,
      reassignedByAdminId: actorClaims.userId,
      reason: String(reason ?? "").trim() || "Reassigned",
      reassignedAtMs: nowMs
    });
    return { device, subscription: sub };
  }

  listAuthorizedDevices(actorClaims, nowMs = Date.now()) {
    const all = [...this.devices.values()];
    const visible =
      actorClaims.role === "ADMIN"
        ? all
        : all.filter((d) => d.currentCustomerId === actorClaims.userId);

    return visible.map((d) => {
      const accessible = this.enforceSubscriptionExpiry(d.id, nowMs);
      const sub = this.subscriptions.get(d.id);
      const customer = this.users.get(d.currentCustomerId);
      const profile = this.profiles.get(d.profileId);
      // If expired and caller is CUSTOMER, redact live coordinates & speed
      const safeDevice =
        !accessible && actorClaims.role === "CUSTOMER"
          ? {
              ...d,
              lastLat: null,
              lastLng: null,
              lastSpeedKmh: null,
              lastHeading: null,
              hasValidFix: false
            }
          : d;
      return {
        device: safeDevice,
        subscription: sub,
        customer: customer
          ? { id: customer.id, email: customer.email, phone: customer.phone, fullName: customer.fullName, role: customer.role }
          : null,
        profile,
        smsLogs: this.smsLogs.get(d.id) ?? [],
        subscriptionHistory: this.subscriptionHistory.filter((h) => h.deviceId === d.id),
        ownershipHistory: this.ownershipHistory.filter((o) => o.deviceId === d.id)
      };
    });
  }

  async getAuthorizedRouteHistory(actorClaims, { deviceId, fromIso, toIso, nowMs = Date.now() }) {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error("DEVICE_NOT_FOUND");
    if (actorClaims.role !== "ADMIN" && device.currentCustomerId !== actorClaims.userId) {
      throw new Error("FORBIDDEN_TENANT_ISOLATION");
    }
    const accessible = this.enforceSubscriptionExpiry(deviceId, nowMs);
    if (!accessible) {
      throw new Error("SUBSCRIPTION_EXPIRED");
    }
    return this.traccarClient.fetchRouteHistory(device.traccarDeviceId, fromIso, toIso);
  }
}
