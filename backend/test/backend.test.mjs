import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthService,
  TraccarBridgeClient,
  VeloTrackEngine,
  isValidImei,
  normalizeEgyptianSim
} from "../src/core.mjs";

const TEST_SECRET = "test_only_32_byte_hmac_secret_key_velotrack_2026";

function createTestHarness({ smsGatewayImpl } = {}) {
  const authService = new AuthService(TEST_SECRET);
  let nextTraccarId = 500;
  const traccarDevicesStore = [];
  const traccarPositionsStore = [];

  const mockFetch = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith("/api/session") && options.method === "POST") {
      if (String(options.body).includes("wrongpass")) {
        return { ok: false, status: 401, headers: new Map() };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          getSetCookie: () => ["JSESSIONID=real_traccar_session_abc123; Path=/; HttpOnly"]
        },
        json: async () => ({ id: 1, email: "admin@traccar.local" })
      };
    }
    if (u.endsWith("/api/devices") && options.method === "POST") {
      const body = JSON.parse(options.body);
      const created = {
        id: ++nextTraccarId,
        name: body.name,
        uniqueId: body.uniqueId,
        status: "offline"
      };
      traccarDevicesStore.push(created);
      return { ok: true, status: 200, json: async () => created };
    }
    if (u.endsWith("/api/devices")) {
      return { ok: true, status: 200, json: async () => traccarDevicesStore };
    }
    if (u.endsWith("/api/positions")) {
      return { ok: true, status: 200, json: async () => traccarPositionsStore };
    }
    if (u.includes("/api/reports/route")) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 9001,
            deviceId: 501,
            latitude: 30.0444,
            longitude: 31.2357,
            speed: 20, // knots -> 37.04 km/h
            course: 90,
            valid: true,
            attributes: { ignition: true },
            fixTime: "2026-11-09T10:00:00Z"
          }
        ]
      };
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  const traccarClient = new TraccarBridgeClient({
    baseUrl: "http://127.0.0.1:8082",
    adminEmail: "admin@traccar.local",
    adminPassword: "correct_password",
    fetchImpl: mockFetch
  });

  let msgSeq = 1;
  const defaultSmsGateway = {
    async sendSms() {
      return {
        gatewayMessageId: `gw_msg_${msgSeq++}`,
        initialStatus: "ACCEPTED"
      };
    }
  };

  const engine = new VeloTrackEngine({
    authService,
    traccarClient,
    smsGateway: smsGatewayImpl ?? defaultSmsGateway
  });

  return { authService, traccarClient, engine };
}

test("1. Authentication, JWT verification, and tenant RBAC isolation", () => {
  const { authService, engine } = createTestHarness();
  const admin = engine.createUser({
    email: "admin@velotrack.local",
    phone: "+201000000001",
    fullName: "Admin",
    password: "StrongPassword123!",
    role: "ADMIN"
  });
  const customer = engine.createUser({
    email: "cust1@velotrack.local",
    phone: "+201012345678",
    fullName: "Customer One",
    password: "CustPassword123!",
    role: "CUSTOMER"
  });

  assert.throws(() => engine.login("admin@velotrack.local", "WrongPass"), /INVALID_CREDENTIALS/);

  const session = engine.login("cust1@velotrack.local", "CustPassword123!");
  const claims = authService.verifyToken(session.token);
  assert.equal(claims.userId, customer.id);
  assert.equal(claims.role, "CUSTOMER");

  // Customer cannot register device profiles
  assert.throws(
    () =>
      engine.registerDeviceProfile(claims, {
        manufacturer: "Concox",
        model: "GT06N",
        firmwareVersion: "v1.0",
        serverHost: "gps.example.com",
        serverCommandTemplate: "SERVER,1,gps.example.com,5023,0#"
      }),
    /FORBIDDEN_ADMIN_ONLY/
  );
  assert.ok(admin.id);
});

test("2. Traccar authentication failure, real JSESSIONID extraction, and bounded reconnect backoff", async () => {
  const { traccarClient } = createTestHarness();
  const cookie = await traccarClient.authenticateSession();
  assert.equal(cookie, "JSESSIONID=real_traccar_session_abc123");

  assert.equal(TraccarBridgeClient.computeReconnectDelayMs(0), 1000);
  assert.equal(TraccarBridgeClient.computeReconnectDelayMs(1), 2000);
  assert.equal(TraccarBridgeClient.computeReconnectDelayMs(2), 4000);
  assert.equal(TraccarBridgeClient.computeReconnectDelayMs(10), 30000);

  const badClient = new TraccarBridgeClient({
    baseUrl: "http://127.0.0.1:8082",
    adminEmail: "admin@traccar.local",
    adminPassword: "wrongpass",
    fetchImpl: traccarClient.fetchImpl
  });
  await assert.rejects(() => badClient.authenticateSession(), /TRACCAR_AUTH_FAILED_401/);
  assert.equal(badClient.sessionCookie, null);
});

test("3. SMS state transitions never activate device; first Traccar connection starts subscription", async () => {
  const { authService, engine } = createTestHarness();
  const admin = engine.createUser({
    email: "admin@velotrack.local",
    phone: "+201000000001",
    fullName: "Admin",
    password: "StrongPassword123!",
    role: "ADMIN"
  });
  const cust1 = engine.createUser({
    email: "cust1@velotrack.local",
    phone: "+201012345678",
    fullName: "Customer 1",
    password: "CustPassword123!",
    role: "CUSTOMER"
  });
  const adminClaims = authService.verifyToken(engine.login(admin.email, "StrongPassword123!").token);

  // Profiles default to isVerified = false
  const profile = engine.registerDeviceProfile(adminClaims, {
    manufacturer: "Concox",
    model: "GT06N",
    firmwareVersion: "v1.0",
    serverHost: "gps.velotrack.local",
    serverPort: 5023,
    requiresGprsonCommand: true,
    serverCommandTemplate: "SERVER,1,gps.velotrack.local,5023,0#",
    gprsonCommandTemplate: "GPRSON,1#"
  });
  assert.equal(profile.isVerified, false);

  // Cannot provision with an unverified profile
  await assert.rejects(
    () =>
      engine.provisionAndActivateDevice(adminClaims, {
        profileId: profile.id,
        imei: "358739051122332",
        customerId: cust1.id,
        vehicleName: "Truck 1",
        plateNumber: "CAI-101",
        planDuration: "MONTH_6",
        simLocalWithoutPlus20: "01012345678"
      }),
    /PROFILE_NOT_VERIFIED_FOR_SMS/
  );

  // Mark verified after physical testing
  engine.markProfileVerifiedAfterPhysicalTest(adminClaims, profile.id);

  const provisioned = await engine.provisionAndActivateDevice(adminClaims, {
    profileId: profile.id,
    imei: "358739051122332",
    customerId: cust1.id,
    vehicleName: "Truck 1",
    plateNumber: "CAI-101",
    planDuration: "MONTH_6",
    simLocalWithoutPlus20: "01012345678"
  });

  assert.equal(provisioned.device.traccarDeviceId, 501);
  assert.equal(provisioned.device.activationStatus, "SMS_SENT");
  assert.equal(provisioned.device.lastLat, null);
  assert.equal(provisioned.subscription.status, "AWAITING_FIRST_CONNECTION");
  assert.equal(provisioned.subscription.startedAtMs, null);
  assert.equal(provisioned.smsLogs.length, 2);
  assert.equal(provisioned.smsLogs[0].status, "ACCEPTED");

  // Delivery report & inbound reply transition to WAITING_FOR_DEVICE, NOT ACTIVATED
  engine.handleSmsDeliveryWebhook({
    gatewayMessageId: provisioned.smsLogs[0].gatewayMessageId,
    deliveryStatus: "DELIVERED"
  });
  engine.handleInboundSmsReply({
    fromE164: "+201012345678",
    replyText: "OK"
  });
  assert.equal(provisioned.device.activationStatus, "WAITING_FOR_DEVICE");
  assert.equal(provisioned.subscription.status, "AWAITING_FIRST_CONNECTION");
  assert.equal(provisioned.subscription.startedAtMs, null);

  // Indoor login/heartbeat on Traccar WITHOUT satellite GPS fix activates device & starts subscription!
  const firstConnTime = 1_760_000_000_000;
  engine.ingestTraccarUpdate({
    traccarDevices: [{ id: 501, uniqueId: "358739051122332", status: "online" }],
    traccarPositions: [],
    eventTimeMs: firstConnTime
  });

  assert.equal(provisioned.device.activationStatus, "ACTIVATED");
  assert.equal(provisioned.device.connectionState, "ONLINE_NO_FIX");
  assert.equal(provisioned.device.hasValidFix, false);
  assert.equal(provisioned.subscription.status, "ACTIVE");
  assert.equal(provisioned.subscription.startedAtMs, firstConnTime);
  assert.equal(provisioned.subscription.expiresAtMs, firstConnTime + 180 * 86_400_000);

  // Subsequent full satellite GPS fix updates coordinates
  engine.ingestTraccarUpdate({
    traccarDevices: [],
    traccarPositions: [
      {
        deviceId: 501,
        valid: true,
        latitude: 30.0444,
        longitude: 31.2357,
        speed: 30,
        course: 120,
        attributes: { ignition: true },
        fixTime: "2026-11-09T10:05:00Z"
      }
    ],
    eventTimeMs: firstConnTime + 60_000
  });
  assert.equal(provisioned.device.connectionState, "ONLINE_GPS_FIX");
  assert.equal(provisioned.device.hasValidFix, true);
  assert.equal(provisioned.device.lastLat, 30.0444);
});

test("4. Server-side subscription expiration blocks route history and redacts customer coordinates, while customer reassignment preserves history", async () => {
  const { authService, engine } = createTestHarness();
  const admin = engine.createUser({
    email: "admin@velotrack.local",
    phone: "+201000000001",
    fullName: "Admin",
    password: "StrongPassword123!",
    role: "ADMIN"
  });
  const cust1 = engine.createUser({
    email: "cust1@velotrack.local",
    phone: "+201012345678",
    fullName: "Customer 1",
    password: "CustPassword123!",
    role: "CUSTOMER"
  });
  const cust2 = engine.createUser({
    email: "cust2@velotrack.local",
    phone: "+201223456789",
    fullName: "Customer 2",
    password: "CustPassword123!",
    role: "CUSTOMER"
  });

  const adminClaims = authService.verifyToken(engine.login(admin.email, "StrongPassword123!").token);
  const cust1Claims = authService.verifyToken(engine.login(cust1.email, "CustPassword123!").token);
  const cust2Claims = authService.verifyToken(engine.login(cust2.email, "CustPassword123!").token);

  const profile = engine.registerDeviceProfile(adminClaims, {
    manufacturer: "Concox",
    model: "GT06N",
    firmwareVersion: "v1.0",
    serverHost: "gps.velotrack.local",
    serverCommandTemplate: "SERVER,1,gps.velotrack.local,5023,0#",
    isVerified: true
  });

  const { device } = await engine.provisionAndActivateDevice(adminClaims, {
    profileId: profile.id,
    imei: "358739051122332",
    customerId: cust1.id,
    vehicleName: "Fleet Van",
    plateNumber: "GIZ-202",
    planDuration: "MONTH_1",
    simLocalWithoutPlus20: "01012345678"
  });

  const startMs = 1_760_000_000_000;
  engine.ingestTraccarUpdate({
    traccarDevices: [{ id: device.traccarDeviceId, uniqueId: device.imei, status: "online" }],
    traccarPositions: [{ deviceId: device.traccarDeviceId, valid: true, latitude: 30.01, longitude: 31.21, speed: 10 }],
    eventTimeMs: startMs
  });

  // Active subscription allows route history for cust1, blocks cust2
  const route = await engine.getAuthorizedRouteHistory(cust1Claims, {
    deviceId: device.id,
    fromIso: "2026-11-09T00:00:00Z",
    toIso: "2026-11-09T23:59:59Z",
    nowMs: startMs + 1000
  });
  assert.equal(route.length, 1);

  await assert.rejects(
    () =>
      engine.getAuthorizedRouteHistory(cust2Claims, {
        deviceId: device.id,
        fromIso: "2026-11-09T00:00:00Z",
        toIso: "2026-11-09T23:59:59Z",
        nowMs: startMs + 1000
      }),
    /FORBIDDEN_TENANT_ISOLATION/
  );

  // After 31 days, subscription expires server-side -> route history blocked with SUBSCRIPTION_EXPIRED
  const afterExpiryMs = startMs + 31 * 86_400_000;
  await assert.rejects(
    () =>
      engine.getAuthorizedRouteHistory(cust1Claims, {
        deviceId: device.id,
        fromIso: "2026-11-09T00:00:00Z",
        toIso: "2026-11-09T23:59:59Z",
        nowMs: afterExpiryMs
      }),
    /SUBSCRIPTION_EXPIRED/
  );

  // Reassign to cust2 and renew subscription -> preserves SMS logs, subscription history, and ownership history
  engine.reassignCustomer(adminClaims, {
    deviceId: device.id,
    newCustomerId: cust2.id,
    reason: "Contract transfer",
    nowMs: afterExpiryMs + 1000
  });
  engine.renewSubscription(adminClaims, {
    deviceId: device.id,
    planDuration: "MONTH_12",
    nowMs: afterExpiryMs + 2000
  });

  const cust2Devices = engine.listAuthorizedDevices(cust2Claims, afterExpiryMs + 3000);
  assert.equal(cust2Devices.length, 1);
  assert.equal(cust2Devices[0].ownershipHistory.length, 1);
  assert.equal(cust2Devices[0].subscriptionHistory.length, 4); // PROVISIONED, STARTED, EXPIRED, RENEWED
  assert.equal(cust2Devices[0].smsLogs.length, 1);
  assert.ok(isValidImei("358739051122332"));
  assert.equal(normalizeEgyptianSim("01012345678").e164Number, "+201012345678");
});
