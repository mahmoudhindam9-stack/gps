import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { PGlite } from "@electric-sql/pglite";
import WebSocket, { WebSocketServer } from "ws";
import {
  SupabaseAuthService,
  SupabaseDatabaseAdapter,
  TraccarBridgeClient,
  VeloTrackEngine,
  normalizeEgyptianPhone,
  isValidImei
} from "../src/core.mjs";
import { createVeloTrackHttpServer } from "../src/server.mjs";

const TEST_JWT_SECRET = "velotrack_supabase_jwt_secret_key_32_bytes_minimum_2026";

test("1. One-time initial admin bootstrap (username `admin`), mandatory 1st-login password change, and PostgreSQL persistence across restarts", async () => {
  const tempPgDir = fs.mkdtempSync(path.join(os.tmpdir(), "velotrack-pg-"));
  try {
    // --- Boot #1 ---
    const pglite1 = new PGlite(tempPgDir);
    const db1 = new SupabaseDatabaseAdapter({ pglite: pglite1 });
    await db1.applySchemaMigration();

    const auth1 = new SupabaseAuthService({
      supabaseJwtSecret: TEST_JWT_SECRET,
      dbAdapter: db1
    });
    const traccar1 = new TraccarBridgeClient({
      baseUrl: "http://127.0.0.1:8082",
      adminEmail: "traccar@velotrack.local",
      adminPassword: "traccar_secret_password"
    });
    const engine1 = new VeloTrackEngine({
      dbAdapter: db1,
      authService: auth1,
      traccarClient: traccar1,
      smsGateway: { async sendSms() { return { gatewayMessageId: "gw-1", initialStatus: "ACCEPTED" }; } }
    });

    // Missing VELOTRACK_INITIAL_ADMIN_EMAIL must be rejected
    await assert.rejects(
      () =>
        engine1.bootstrapInitialAdminIfNeeded({
          adminEmail: "",
          adminUsername: "admin",
          adminPassword: "Admin@123456"
        }),
      /BOOTSTRAP_ADMIN_EMAIL_REQUIRED/
    );

    // Perform one-time initial administrator bootstrap
    const bootRes1 = await engine1.bootstrapInitialAdminIfNeeded({
      adminEmail: "owner.admin@velotrack.local",
      adminUsername: "admin",
      adminPassword: "Admin@123456"
    });
    assert.equal(bootRes1.bootstrapped, true);
    assert.equal(bootRes1.username, "admin");
    assert.equal(bootRes1.mustChangePassword, true);

    // Login using username `admin` and temporary password `Admin@123456`
    const firstLogin = await engine1.login("admin", "Admin@123456");
    assert.equal(firstLogin.mustChangePassword, true);
    assert.equal(firstLogin.user.username, "admin");
    assert.equal(firstLogin.user.role, "ADMIN");

    const claims = auth1.verifyToken(firstLogin.token);

    // All protected business operations must be blocked until password is changed
    await assert.rejects(
      () => engine1.listAuthorizedDevices(claims),
      /PASSWORD_CHANGE_REQUIRED/
    );

    // Change password after first login
    const changed = await engine1.changePassword(claims, {
      currentPassword: "Admin@123456",
      newPassword: "NewStrongAdmin#2026"
    });
    assert.equal(changed.mustChangePassword, false);

    // A backend restart must never reset an existing administrator's password.
    const ensureAfterPasswordChange = await engine1.ensureAdminCredentials({
      adminEmail: "owner.admin@velotrack.local",
      adminUsername: "admin",
      adminPassword: "Admin@123456"
    });
    assert.equal(ensureAfterPasswordChange.reason, "ALREADY_BOOTSTRAPPED");
    await assert.rejects(() => engine1.login("admin", "Admin@123456"), /INVALID_CREDENTIALS/);
    assert.equal((await engine1.login("admin", "NewStrongAdmin#2026")).user.username, "admin");

    // Old temporary password must no longer work
    await assert.rejects(
      () => engine1.login("admin", "Admin@123456"),
      /INVALID_CREDENTIALS/
    );

    // Create a persistent profile before shutting down Boot #1
    const updatedClaims = auth1.verifyToken(changed.token);
    const createdProfile = await engine1.registerDeviceProfile(updatedClaims, {
      manufacturer: "Concox",
      model: "GT06N",
      firmwareVersion: "V1.0",
      serverHost: "gps.velotrack.local",
      serverPort: 5023,
      serverCommandTemplate: "SERVER,1,gps.velotrack.local,5023,0#"
    });
    assert.equal(createdProfile.isVerified, false);

    await db1.close();

    // --- Boot #2 (Simulate full service restart on the same PostgreSQL storage) ---
    const pglite2 = new PGlite(tempPgDir);
    const db2 = new SupabaseDatabaseAdapter({ pglite: pglite2 });
    await db2.applySchemaMigration();

    const auth2 = new SupabaseAuthService({
      supabaseJwtSecret: TEST_JWT_SECRET,
      dbAdapter: db2
    });
    const engine2 = new VeloTrackEngine({
      dbAdapter: db2,
      authService: auth2,
      traccarClient: traccar1,
      smsGateway: { async sendSms() { return { gatewayMessageId: "gw-1", initialStatus: "ACCEPTED" }; } }
    });

    // Bootstrap must be disabled and must NOT reset the admin password back to Admin@123456
    const bootRes2 = await engine2.bootstrapInitialAdminIfNeeded({
      adminEmail: "owner.admin@velotrack.local",
      adminUsername: "admin",
      adminPassword: "Admin@123456"
    });
    assert.equal(bootRes2.bootstrapped, false);
    assert.equal(bootRes2.reason, "ALREADY_BOOTSTRAPPED");

    await assert.rejects(
      () => engine2.login("admin", "Admin@123456"),
      /INVALID_CREDENTIALS/
    );

    const restartLogin = await engine2.login("admin", "NewStrongAdmin#2026");
    assert.equal(restartLogin.mustChangePassword, false);

    const profilesAfterRestart = await engine2.listDeviceProfiles(
      auth2.verifyToken(restartLogin.token)
    );
    assert.equal(profilesAfterRestart.length, 1);
    assert.equal(profilesAfterRestart[0].id, createdProfile.id);

    await db2.close();
  } finally {
    fs.rmSync(tempPgDir, { recursive: true, force: true });
  }
});

test("2. Traccar remote loopback guard, authentication failure, real JSESSIONID extraction, and bounded reconnect backoff", async () => {
  // Never allow 127.0.0.1 when deployed externally without a private tunnel
  assert.throws(
    () =>
      new TraccarBridgeClient({
        baseUrl: "http://127.0.0.1:8082",
        adminEmail: "admin@velotrack.local",
        adminPassword: "secret",
        deploymentMode: "external",
        privateTunnelEnabled: false
      }),
    /TRACCAR_REMOTE_LOOPBACK_FORBIDDEN/
  );

  let authShouldFail = true;
  const mockFetch = async () => {
    if (authShouldFail) {
      return new Response("Unauthorized", { status: 401 });
    }
    return new Response(JSON.stringify({ id: 1, email: "admin@velotrack.local" }), {
      status: 200,
      headers: {
        "set-cookie": "JSESSIONID=real_traccar_session_998877; Path=/; HttpOnly"
      }
    });
  };

  const client = new TraccarBridgeClient({
    baseUrl: "http://127.0.0.1:8082",
    adminEmail: "admin@velotrack.local",
    adminPassword: "secret",
    fetchImpl: mockFetch
  });

  await assert.rejects(() => client.authenticateSession(), /TRACCAR_AUTH_FAILED_401/);
  assert.equal(client.sessionCookie, null);

  authShouldFail = false;
  const cookie = await client.authenticateSession();
  assert.equal(cookie, "JSESSIONID=real_traccar_session_998877");

  assert.equal(TraccarBridgeClient.computeReconnectDelayMs(0), 1000);
  assert.equal(TraccarBridgeClient.computeReconnectDelayMs(1), 2000);
  assert.equal(TraccarBridgeClient.computeReconnectDelayMs(2), 4000);
  assert.equal(TraccarBridgeClient.computeReconnectDelayMs(10), 30000);
});

test("3. Full-stack Supabase RLS tenant isolation, SMS state transitions, Traccar WebSocket bridge, and /ws/live real-time updates", async () => {
  const pglite = new PGlite();
  const db = new SupabaseDatabaseAdapter({ pglite });
  await db.applySchemaMigration();

  // Start a local Traccar HTTP + WebSocket server to verify real REST + WebSocket integration
  const traccarHttp = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/api/session") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": "JSESSIONID=live_tc_cookie_123; Path=/; HttpOnly"
      });
      res.end(JSON.stringify({ id: 1 }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/devices") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: 501, name: "Truck 01", uniqueId: "358739051122332" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/devices") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/positions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/reports/route") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify([
          {
            id: 9001,
            deviceId: 501,
            valid: true,
            latitude: 30.0561,
            longitude: 31.2394,
            speed: 20,
            course: 180,
            fixTime: "2026-04-08T10:00:00.000Z",
            attributes: { ignition: true }
          }
        ])
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const traccarWss = new WebSocketServer({ noServer: true });
  const traccarSockets = new Set();
  traccarHttp.on("upgrade", (req, socket, head) => {
    if (req.url === "/api/socket" && String(req.headers.cookie ?? "").includes("JSESSIONID=")) {
      traccarWss.handleUpgrade(req, socket, head, (ws) => {
        traccarSockets.add(ws);
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise((resolve) => traccarHttp.listen(0, "127.0.0.1", resolve));
  const traccarPort = traccarHttp.address().port;

  const authService = new SupabaseAuthService({
    supabaseJwtSecret: TEST_JWT_SECRET,
    dbAdapter: db
  });
  const traccarClient = new TraccarBridgeClient({
    baseUrl: `http://127.0.0.1:${traccarPort}`,
    adminEmail: "admin@velotrack.local",
    adminPassword: "traccar_password"
  });
  const smsGateway = {
    async sendSms() {
      return { gatewayMessageId: "gw-msg-501", initialStatus: "ACCEPTED" };
    }
  };
  const engine = new VeloTrackEngine({
    dbAdapter: db,
    authService,
    traccarClient,
    smsGateway
  });

  await engine.bootstrapInitialAdminIfNeeded({
    adminEmail: "admin@velotrack.local",
    adminUsername: "admin",
    adminPassword: "Admin@123456"
  });
  const initialSession = await engine.login("admin", "Admin@123456");
  const adminSession = await engine.changePassword(
    authService.verifyToken(initialSession.token),
    { currentPassword: "Admin@123456", newPassword: "AdminUpdatedPassword#2026" }
  );
  const adminClaims = authService.verifyToken(adminSession.token);

  // Create Customer A and Customer B
  const custA = await engine.createCustomerAccount(adminClaims, {
    username: "cust_a",
    email: "a@customer.local",
    phone: "01011112222",
    fullName: "Customer A",
    password: "CustomerAPass#123"
  });
  const custB = await engine.createCustomerAccount(adminClaims, {
    username: "cust_b",
    email: "b@customer.local",
    phone: "01233334444",
    fullName: "Customer B",
    password: "CustomerBPass#123"
  });

  const custASession = await engine.login("cust_a", "CustomerAPass#123");
  const custBSession = await engine.login("cust_b", "CustomerBPass#123");
  const custAClaims = authService.verifyToken(custASession.token);
  const custBClaims = authService.verifyToken(custBSession.token);

  // Register and verify GT06N profile
  const profile = await engine.registerDeviceProfile(adminClaims, {
    manufacturer: "Concox",
    model: "GT06N",
    firmwareVersion: "V4.2",
    serverHost: "gps.velotrack.local",
    serverPort: 5023,
    serverCommandTemplate: "SERVER,1,gps.velotrack.local,5023,0#"
  });
  await engine.markProfileVerifiedAfterPhysicalTest(adminClaims, profile.id);

  // Provision device for Customer A
  const provisioned = await engine.provisionAndActivateDevice(adminClaims, {
    profileId: profile.id,
    imei: "358739051122332",
    customerId: custA.id,
    vehicleName: "Customer A Van",
    plateNumber: "CA-101",
    planDuration: "MONTH_1",
    simLocalWithoutPlus20: "01012345678"
  });
  const deviceId = provisioned.device.id;

  // Verify SMS delivery and reply NEVER activate the device or start the subscription
  await engine.handleSmsDeliveryWebhook({
    gatewayMessageId: "gw-msg-501",
    deliveryStatus: "DELIVERED"
  });
  const afterReply = await engine.handleInboundSmsReply({
    fromE164: "+201012345678",
    replyText: "SERVER,OK!"
  });
  assert.equal(afterReply.device.activationStatus, "WAITING_FOR_DEVICE");

  // Verify PostgreSQL RLS tenant isolation: Customer B sees 0 devices, Customer A sees 1
  const listA = await engine.listAuthorizedDevices(custAClaims);
  const listB = await engine.listAuthorizedDevices(custBClaims);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].subscription.status, "AWAITING_FIRST_CONNECTION");
  assert.equal(listA[0].subscription.startedAtMs, null);
  assert.equal(listB.length, 0);

  // Direct authenticated SQL must not let a customer promote their own profile.
  const roleEscalation = await db.runTenantTransaction(custAClaims, async (tx) =>
    tx.query(
      `UPDATE public.users_profile SET role = 'ADMIN' WHERE id = $1 RETURNING role`,
      [custA.id]
    )
  );
  assert.equal(roleEscalation.rows.length, 0);
  const profileAfterAttempt = await db.runSystemTransaction(async (tx) =>
    tx.query(`SELECT role FROM public.users_profile WHERE id = $1`, [custA.id])
  );
  assert.equal(profileAfterAttempt.rows[0].role, "CUSTOMER");

  // Customer may edit display metadata but may not change device ownership/identity.
  const safeVehicleUpdate = await engine.updateVehicleMetadata(custAClaims, deviceId, {
    vehicleName: "Customer A Updated Van",
    plateNumber: "CA-102"
  });
  assert.equal(safeVehicleUpdate.vehicleName, "Customer A Updated Van");
  await assert.rejects(
    () => db.runTenantTransaction(custAClaims, async (tx) =>
      tx.query(
        `UPDATE public.devices SET imei = '358739051122333' WHERE id = $1`,
        [deviceId]
      )
    ),
    /CUSTOMER_DEVICE_PROTECTED_FIELD_UPDATE/
  );

  // Start VeloTrack HTTP + `/ws/live` server and connect Traccar live socket
  const apiServer = createVeloTrackHttpServer({
    engine,
    authService,
    traccarClient
  });
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const apiPort = apiServer.address().port;

  await traccarClient.connectLiveSocket({
    onUpdate: async (frame) => {
      await engine.ingestTraccarUpdate(frame);
    }
  });

  // Connect Customer A using a short-lived single-use WS ticket and Customer B via Bearer header
  const ticketA = authService.issueWebSocketTicket(custAClaims);
  const wsFramesA = [];
  const wsFramesB = [];
  const clientWsA = new WebSocket(`ws://127.0.0.1:${apiPort}/ws/live?ticket=${encodeURIComponent(ticketA.ticket)}`);
  const clientWsB = new WebSocket(`ws://127.0.0.1:${apiPort}/ws/live`, {
    headers: { Authorization: `Bearer ${custBSession.token}` }
  });

  await Promise.all([
    new Promise((resolve) => clientWsA.once("message", (msg) => {
      wsFramesA.push(JSON.parse(msg.toString()));
      resolve();
    })),
    new Promise((resolve) => clientWsB.once("message", (msg) => {
      wsFramesB.push(JSON.parse(msg.toString()));
      resolve();
    }))
  ]);

  assert.equal(wsFramesA[0].type, "SNAPSHOT");
  assert.equal(wsFramesA[0].devices.length, 1);
  assert.equal(wsFramesB[0].type, "SNAPSHOT");
  assert.equal(wsFramesB[0].devices.length, 0);

  // Broadcast a real GPS fix over the Traccar `/api/socket` WebSocket
  const updatePromiseA = new Promise((resolve) => {
    clientWsA.once("message", (msg) => {
      const parsed = JSON.parse(msg.toString());
      wsFramesA.push(parsed);
      resolve(parsed);
    });
  });

  for (const tcWs of traccarSockets) {
    tcWs.send(
      JSON.stringify({
        devices: [
          {
            id: 501,
            name: "Customer A Van",
            uniqueId: "358739051122332",
            status: "online",
            lastUpdate: "2026-04-08T10:05:00.000Z"
          }
        ],
        positions: [
          {
            id: 9002,
            deviceId: 501,
            valid: true,
            latitude: 30.0561,
            longitude: 31.2394,
            speed: 15,
            course: 90,
            fixTime: "2026-04-08T10:05:00.000Z",
            attributes: { ignition: true }
          }
        ]
      })
    );
  }

  const liveEvent = await updatePromiseA;
  assert.equal(liveEvent.type, "DEVICE_UPDATE");
  assert.equal(liveEvent.devices[0].device.activationStatus, "ACTIVATED");
  assert.equal(liveEvent.devices[0].device.connectionState, "ONLINE_GPS_FIX");
  assert.equal(liveEvent.devices[0].subscription.status, "ACTIVE");
  assert.notEqual(liveEvent.devices[0].subscription.startedAtMs, null);

  // Verify Customer B still received zero device updates for Customer A's vehicle
  assert.equal(wsFramesB.length, 1);

  // Verify subscription expiration blocks customer route history and redacts customer coordinates,
  // while ADMIN can still inspect expired vehicles and route history.
  const expiredNowMs = liveEvent.devices[0].subscription.expiresAtMs + 5000;
  await assert.rejects(
    () =>
      engine.getAuthorizedRouteHistory(custAClaims, {
        deviceId,
        fromIso: "2026-04-08T00:00:00.000Z",
        toIso: "2026-04-09T00:00:00.000Z",
        nowMs: expiredNowMs
      }),
    /SUBSCRIPTION_EXPIRED/
  );

  // Admin can inspect route history even when subscription is expired
  const adminHistory = await engine.getAuthorizedRouteHistory(adminClaims, {
    deviceId,
    fromIso: "2026-04-08T00:00:00.000Z",
    toIso: "2026-04-09T00:00:00.000Z",
    nowMs: expiredNowMs
  });
  assert.equal(adminHistory.length, 1);

  const expiredViewA = await engine.listAuthorizedDevices(custAClaims, expiredNowMs);
  assert.equal(expiredViewA[0].subscription.status, "EXPIRED");
  assert.equal(expiredViewA[0].device.lastLat, null);

  const adminViewExpired = await engine.listAuthorizedDevices(adminClaims, expiredNowMs);
  assert.equal(adminViewExpired[0].subscription.status, "EXPIRED");
  assert.equal(adminViewExpired[0].device.lastLat, 30.0561);

  // Reassign device to Customer B and renew subscription
  await engine.reassignCustomer(adminClaims, {
    deviceId,
    newCustomerId: custB.id,
    reason: "Fleet transfer to Customer B"
  });
  await engine.renewSubscription(adminClaims, {
    deviceId,
    planDuration: "MONTH_6",
    nowMs: expiredNowMs
  });

  const afterReassignA = await engine.listAuthorizedDevices(custAClaims, expiredNowMs + 1000);
  const afterReassignB = await engine.listAuthorizedDevices(custBClaims, expiredNowMs + 1000);
  assert.equal(afterReassignA.length, 0);
  assert.equal(afterReassignB.length, 1);
  assert.equal(afterReassignB[0].ownershipHistory.length, 1);

  clientWsA.close();
  clientWsB.close();
  traccarClient.disconnectLiveSocket();
  engine.clearAllTimers();
  apiServer.wsHub.close();
  await new Promise((resolve) => apiServer.close(resolve));
  for (const s of traccarSockets) s.close();
  traccarWss.close();
  await new Promise((resolve) => traccarHttp.close(resolve));
  await db.close();
});

test("4. PR #2 production hardening: fail-closed startup validation, /api/v1/health 200 vs 503 DB check, and GoTrue password hash preservation", async () => {
  const { getOrCreateVeloTrackRuntime, createVeloTrackRequestListener } = await import(
    "../src/server.mjs"
  );

  // 1) Fail closed when production Supabase env vars are missing
  await assert.rejects(
    () => getOrCreateVeloTrackRuntime(),
    /SUPABASE_PRODUCTION_CONFIGURATION_INCOMPLETE/
  );

  // 2) Verify Traccar private Docker DNS (`http://traccar:8082`) is accepted
  const sharedNetTraccar = new TraccarBridgeClient({
    baseUrl: "http://traccar:8082",
    adminEmail: "admin@velotrack.local",
    adminPassword: "secret",
    deploymentMode: "vps_local"
  });
  assert.equal(sharedNetTraccar.baseUrl, "http://traccar:8082");

  // 3) Verify /api/v1/health returns 200 OK when DB is reachable and 503 DEGRADED when DB fails
  const pglite = new PGlite();
  const db = new SupabaseDatabaseAdapter({ pglite });
  await db.applySchemaMigration();

  const authService = new SupabaseAuthService({
    supabaseJwtSecret: TEST_JWT_SECRET,
    dbAdapter: db
  });
  const engine = new VeloTrackEngine({
    dbAdapter: db,
    authService,
    traccarClient: sharedNetTraccar,
    smsGateway: { async sendSms() { return { gatewayMessageId: "m1", initialStatus: "ACCEPTED" }; } }
  });

  const listener = createVeloTrackRequestListener({
    engine,
    authService,
    traccarClient: sharedNetTraccar
  });
  const server = http.createServer(listener);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const healthyRes = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  assert.equal(healthyRes.status, 200);
  const healthyBody = await healthyRes.json();
  assert.equal(healthyBody.status, "OK");
  assert.equal(healthyBody.supabaseConnected, true);

  // Verify adminClient createUser / updateUserById never overwrites auth.users.encrypted_password
  const goTrueBcryptHash = "$2a$10$GoTrueBcryptHashThatMustNeverBeOverwritten1234567890";
  const remoteUserId = "11111111-2222-4333-8444-555555555555";
  await db.runSystemTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO auth.users (id, email, encrypted_password) VALUES ($1, $2, $3)`,
      [remoteUserId, "gotrue@velotrack.local", goTrueBcryptHash]
    );
  });

  authService.adminClient = {
    auth: {
      admin: {
        async createUser({ email }) {
          return { data: { user: { id: remoteUserId, email } }, error: null };
        },
        async updateUserById(id, { password }) {
          assert.equal(id, remoteUserId);
          assert.equal(password, "UpdatedPassword#2026");
          return { data: { user: { id } }, error: null };
        }
      }
    }
  };

  await authService.createAuthUser({
    email: "gotrue@velotrack.local",
    password: "InitialPassword#2026",
    role: "ADMIN",
    username: "gotrue_admin"
  });
  await authService.updateAuthUserPassword({
    userId: remoteUserId,
    newPassword: "UpdatedPassword#2026"
  });

  const storedHashRes = await db.runSystemTransaction(async (tx) =>
    tx.query(`SELECT encrypted_password FROM auth.users WHERE id = $1`, [remoteUserId])
  );
  assert.equal(storedHashRes.rows[0].encrypted_password, goTrueBcryptHash);

  // Close DB and confirm /api/v1/health returns HTTP 503 DEGRADED
  await db.close();
  engine.db.runSystemTransaction = async () => {
    throw new Error("CONNECTION_CLOSED");
  };

  const degradedRes = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  assert.equal(degradedRes.status, 503);
  const degradedBody = await degradedRes.json();
  assert.equal(degradedBody.status, "DEGRADED");
  assert.equal(degradedBody.supabaseConnected, false);
  assert.equal(degradedBody.databaseError, "CONNECTION_CLOSED");

  await new Promise((resolve) => server.close(resolve));
});

test("5. Complete User, Vehicle, Subscription & GPS Control System: phone/username accounts without email, customer details, multi-vehicle provisioning, idempotent SMS, Traccar rollback, vehicle icons, suspend/resume, and audited Traccar commands", async () => {
  const pglite = new PGlite();
  const db = new SupabaseDatabaseAdapter({ pglite });
  await db.applySchemaMigration();

  // Verify IMEI and Egyptian phone normalization helpers
  assert.equal(isValidImei("358739051122332"), true);
  assert.equal(isValidImei("12345"), false);
  assert.deepEqual(normalizeEgyptianPhone("01012345678"), {
    isValid: true,
    localNumber: "01012345678",
    e164Number: "+201012345678",
    errorReason: null
  });
  assert.deepEqual(normalizeEgyptianPhone("+201298765432"), {
    isValid: true,
    localNumber: "01298765432",
    e164Number: "+201298765432",
    errorReason: null
  });

  // Track Traccar REST calls (devices created, updated, deleted, commands sent)
  let nextTraccarId = 700;
  const traccarDevicesById = new Map();
  const sentTraccarCommands = [];

  const mockTraccarFetch = async (urlStr, options = {}) => {
    const url = new URL(urlStr);
    const method = options.method ?? "GET";

    if (method === "POST" && url.pathname === "/api/session") {
      return new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "set-cookie": "JSESSIONID=tc_cmd_session_777; Path=/; HttpOnly" }
      });
    }
    if (method === "POST" && url.pathname === "/api/devices") {
      const body = JSON.parse(options.body);
      const id = ++nextTraccarId;
      const dev = { id, name: body.name, uniqueId: body.uniqueId, category: body.category ?? "car" };
      traccarDevicesById.set(id, dev);
      return new Response(JSON.stringify(dev), { status: 200 });
    }
    if (method === "PUT" && url.pathname.startsWith("/api/devices/")) {
      const id = Number(url.pathname.split("/").pop());
      const body = JSON.parse(options.body);
      const updated = { id, name: body.name, uniqueId: body.uniqueId, category: body.category ?? "car" };
      traccarDevicesById.set(id, updated);
      return new Response(JSON.stringify(updated), { status: 200 });
    }
    if (method === "DELETE" && url.pathname.startsWith("/api/devices/")) {
      const id = Number(url.pathname.split("/").pop());
      traccarDevicesById.delete(id);
      return new Response("", { status: 204 });
    }
    if (method === "GET" && url.pathname === "/api/commands/types") {
      return new Response(
        JSON.stringify([
          { type: "positionSingle" },
          { type: "engineStop" },
          { type: "engineResume" },
          { type: "outputControl" },
          { type: "rebootDevice" },
          { type: "setTimezone" },
          { type: "custom" }
        ]),
        { status: 200 }
      );
    }
    if (method === "POST" && url.pathname === "/api/commands/send") {
      const body = JSON.parse(options.body);
      const cmdRecord = {
        id: 8000 + sentTraccarCommands.length + 1,
        deviceId: body.deviceId,
        type: body.type,
        attributes: body.attributes ?? {}
      };
      sentTraccarCommands.push(cmdRecord);
      return new Response(JSON.stringify(cmdRecord), { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  };

  const authService = new SupabaseAuthService({
    supabaseJwtSecret: TEST_JWT_SECRET,
    dbAdapter: db
  });
  const traccarClient = new TraccarBridgeClient({
    baseUrl: "http://127.0.0.1:8082",
    adminEmail: "admin@velotrack.local",
    adminPassword: "secret",
    fetchImpl: mockTraccarFetch
  });

  let smsSendCount = 0;
  const smsGateway = {
    async sendSms({ toE164, text }) {
      smsSendCount += 1;
      return {
        gatewayMessageId: `gw-sms-${smsSendCount}`,
        initialStatus: "ACCEPTED",
        toE164,
        text
      };
    }
  };

  const engine = new VeloTrackEngine({
    dbAdapter: db,
    authService,
    traccarClient,
    smsGateway
  });

  await engine.bootstrapInitialAdminIfNeeded({
    adminEmail: "admin@velotrack.local",
    adminUsername: "admin",
    adminPassword: "Admin@123456",
    adminPhone: "01000000001"
  });
  const firstLogin = await engine.login("admin", "Admin@123456");
  const adminSession = await engine.changePassword(
    authService.verifyToken(firstLogin.token),
    { currentPassword: "Admin@123456", newPassword: "AdminStrongPassword#2026" }
  );
  const adminClaims = authService.verifyToken(adminSession.token);

  // 1 & 2. Admin creation of ADMIN and CUSTOMER users with fullName, phone, username, password (NO email)
  const opsAdmin = await engine.createUserAccount(adminClaims, {
    fullName: "Operations Supervisor",
    phone: "01022223333",
    username: "ops_admin",
    password: "OpsPassword#2026",
    role: "ADMIN"
  });
  assert.equal(opsAdmin.role, "ADMIN");
  assert.equal(opsAdmin.email, null);
  assert.equal(opsAdmin.phone, "+201022223333");

  const customer1 = await engine.createUserAccount(adminClaims, {
    fullName: "Mahmoud Logistics",
    phone: "01144445555",
    username: "mahmoud_fleet",
    password: "FleetPassword#2026",
    role: "CUSTOMER"
  });
  assert.equal(customer1.role, "CUSTOMER");
  assert.equal(customer1.email, null);
  assert.equal(customer1.phone, "+201144445555");

  // 3 & 4. Login by username and login by phone (local 011... and E.164 +2011...)
  const loginByUsername = await engine.login("mahmoud_fleet", "FleetPassword#2026");
  assert.equal(loginByUsername.user.id, customer1.id);

  const loginByLocalPhone = await engine.login("01144445555", "FleetPassword#2026");
  assert.equal(loginByLocalPhone.user.id, customer1.id);

  const loginByE164Phone = await engine.login("+201144445555", "FleetPassword#2026");
  assert.equal(loginByE164Phone.user.id, customer1.id);

  const customer1Claims = authService.verifyToken(loginByUsername.token);

  // 5. Reject duplicate usernames and duplicate normalized phone numbers
  await assert.rejects(
    () =>
      engine.createUserAccount(adminClaims, {
        fullName: "Duplicate User",
        phone: "01566667777",
        username: "mahmoud_fleet",
        password: "Password#2026",
        role: "CUSTOMER"
      }),
    /DUPLICATE_USERNAME|USERNAME_ALREADY_EXISTS/
  );
  await assert.rejects(
    () =>
      engine.createUserAccount(adminClaims, {
        fullName: "Duplicate Phone",
        phone: "+201144445555",
        username: "unique_username",
        password: "Password#2026",
        role: "CUSTOMER"
      }),
    /DUPLICATE_PHONE|PHONE_ALREADY_EXISTS/
  );

  // 7. Non-admin forbidden access on admin endpoints
  await assert.rejects(
    () =>
      engine.createUserAccount(customer1Claims, {
        fullName: "Unauthorized Create",
        phone: "01099998888",
        username: "unauth_user",
        password: "Password#2026",
        role: "CUSTOMER"
      }),
    /FORBIDDEN_ADMIN_ONLY/
  );

  // 6. Edit user, deactivate, reactivate, and safe delete rules
  const editedAdmin = await engine.updateUserAccount(adminClaims, opsAdmin.id, {
    fullName: "Senior Ops Supervisor",
    phone: "01022224444"
  });
  assert.equal(editedAdmin.fullName, "Senior Ops Supervisor");
  assert.equal(editedAdmin.phone, "+201022224444");

  const deactivated = await engine.setUserActiveStatus(adminClaims, opsAdmin.id, { isActive: false });
  assert.equal(deactivated.isActive, false);
  await assert.rejects(
    () => engine.login("ops_admin", "OpsPassword#2026"),
    /ACCOUNT_DISABLED|ACCOUNT_DEACTIVATED/
  );

  const reactivated = await engine.setUserActiveStatus(adminClaims, opsAdmin.id, { isActive: true });
  assert.equal(reactivated.isActive, true);
  const opsLogin = await engine.login("ops_admin", "OpsPassword#2026");
  assert.equal(opsLogin.user.id, opsAdmin.id);

  // Primary bootstrapped administrator cannot be deleted
  await assert.rejects(
    () => engine.deleteUserAccount(adminClaims, adminSession.user.id),
    /CANNOT_DELETE_PRIMARY_ADMIN|PRIMARY_ADMIN_CANNOT_BE_DELETED/
  );

  // Register and verify GT06N profile
  const profile = await engine.registerDeviceProfile(adminClaims, {
    manufacturer: "Concox",
    model: "GT06N",
    firmwareVersion: "V5.0",
    serverHost: "gps.velotrack.local",
    serverPort: 5023,
    serverCommandTemplate: "SERVER,1,gps.velotrack.local,5023,0#"
  });
  await engine.markProfileVerifiedAfterPhysicalTest(adminClaims, profile.id);

  // 9. Add multiple vehicles under a single customer with independent subscriptions and staged SMS
  const v1 = await engine.provisionAndActivateDevice(adminClaims, {
    profileId: profile.id,
    imei: "358739051122332",
    serialNumber: "SN-GT06N-001",
    customerId: customer1.id,
    vehicleName: "Cairo Delivery Van 1",
    vehicleType: "VAN",
    vehicleIcon: "van",
    plateNumber: " أ ب ج 123 ",
    planDuration: "MONTH_3",
    simLocalWithoutPlus20: "01012345678",
    sendActivationSmsNow: false
  });
  assert.equal(v1.device.vehicleType, "VAN");
  assert.equal(v1.device.vehicleIcon, "van");
  assert.equal(v1.device.serialNumber, "SN-GT06N-001");
  assert.equal(v1.device.activationStatus, "PENDING");
  assert.equal(smsSendCount, 0);

  // 13. Send Activation Message button with idempotency protection (no duplicate SMS on repeated clicks)
  const smsDispatch1 = await engine.sendDeviceActivationSms(adminClaims, {
    deviceId: v1.device.id,
    idempotencyKey: "idem-v1-btn-click-1"
  });
  assert.equal(smsDispatch1.duplicatePrevented, false);
  assert.equal(smsSendCount, 1);

  const smsDispatchDuplicateKey = await engine.sendDeviceActivationSms(adminClaims, {
    deviceId: v1.device.id,
    idempotencyKey: "idem-v1-btn-click-1"
  });
  assert.equal(smsDispatchDuplicateKey.duplicatePrevented, true);
  assert.equal(smsSendCount, 1);

  const smsDispatchDuplicateActive = await engine.sendDeviceActivationSms(adminClaims, {
    deviceId: v1.device.id,
    idempotencyKey: "idem-v1-btn-click-2",
    forceResend: false
  });
  assert.equal(smsDispatchDuplicateActive.duplicatePrevented, true);
  assert.equal(smsSendCount, 1);

  // Provision second vehicle for the same customer with immediate SMS dispatch
  const v2 = await engine.provisionAndActivateDevice(adminClaims, {
    profileId: profile.id,
    imei: "358739059988775",
    serialNumber: "SN-GT06N-002",
    customerId: customer1.id,
    vehicleName: "Alexandria Heavy Truck 2",
    vehicleType: "TRUCK",
    vehicleIcon: "truck",
    plateNumber: " س ص ع 999 ",
    planDuration: "MONTH_12",
    simLocalWithoutPlus20: "01287654321",
    sendActivationSmsNow: true
  });
  assert.equal(v2.device.vehicleType, "TRUCK");
  assert.equal(v2.device.vehicleIcon, "truck");
  assert.equal(smsSendCount, 2);

  // 10. Duplicate IMEI rejection and Traccar rollback when PostgreSQL insert fails
  const traccarCountBeforeDup = traccarDevicesById.size;
  await assert.rejects(
    () =>
      engine.provisionAndActivateDevice(adminClaims, {
        profileId: profile.id,
        imei: "358739051122332",
        customerId: customer1.id,
        vehicleName: "Duplicate IMEI Vehicle",
        planDuration: "MONTH_1",
        simLocalWithoutPlus20: "01055556666"
      }),
    /DUPLICATE_IMEI|IMEI_ALREADY_REGISTERED/
  );
  assert.equal(traccarDevicesById.size, traccarCountBeforeDup);

  // Blocking deletion of a customer who still has assigned vehicles
  await assert.rejects(
    () => engine.deleteUserAccount(adminClaims, customer1.id),
    /USER_HAS_ASSIGNED_VEHICLES/
  );

  // Safe soft-delete of a user with 0 assigned vehicles preserves historical records
  const deletedOps = await engine.deleteUserAccount(adminClaims, opsAdmin.id);
  assert.equal(deletedOps.deleted, true);

  // 11. Vehicle metadata and icon update persistence
  const updatedV1 = await engine.updateVehicleMetadata(adminClaims, v1.device.id, {
    vehicleName: "Cairo Refrigerated Van 1",
    vehicleType: "VAN",
    vehicleIcon: "pickup",
    plateNumber: " أ ب ج 456 ",
    serialNumber: "SN-GT06N-001-REV2",
    simLocalWithoutPlus20: "01012345679"
  });
  assert.equal(updatedV1.device.vehicleName, "Cairo Refrigerated Van 1");
  assert.equal(updatedV1.device.vehicleIcon, "pickup");
  assert.equal(updatedV1.device.serialNumber, "SN-GT06N-001-REV2");
  assert.equal(updatedV1.device.simNumber, "+201012345679");

  // Activate v1 via real GPS fix and suspend v2 to test customer details summary counts
  await engine.ingestTraccarUpdate({
    traccarDevices: [
      {
        id: v1.device.traccarDeviceId,
        name: updatedV1.device.vehicleName,
        uniqueId: v1.device.imei,
        status: "online",
        lastUpdate: "2026-04-10T12:00:00.000Z"
      }
    ],
    traccarPositions: [
      {
        id: 9501,
        deviceId: v1.device.traccarDeviceId,
        valid: true,
        latitude: 30.0444,
        longitude: 31.2357,
        speed: 42,
        course: 120,
        fixTime: "2026-04-10T12:00:00.000Z",
        attributes: { ignition: true }
      }
    ]
  });

  // 16. Suspend and resume subscription transitions
  const suspendedV2 = await engine.suspendSubscription(adminClaims, {
    deviceId: v2.device.id,
    reason: "Temporary seasonal pause"
  });
  assert.equal(suspendedV2.subscription.status, "SUSPENDED");

  // 8. Customer details retrieval with accurate summary counts
  const customerDetails = await engine.getCustomerDetails(adminClaims, customer1.id);
  assert.equal(customerDetails.customer.id, customer1.id);
  assert.equal(customerDetails.summary.totalVehicles, 2);
  assert.equal(customerDetails.summary.totalSubscriptions, 2);
  assert.equal(customerDetails.summary.activeSubscriptionsCount, 1);
  assert.equal(customerDetails.summary.suspendedSubscriptionsCount, 1);
  assert.equal(customerDetails.summary.pendingSubscriptionsCount, 0);
  assert.equal(customerDetails.summary.expiredSubscriptionsCount, 0);

  // Resume v2 subscription
  const resumedV2 = await engine.resumeSubscription(adminClaims, {
    deviceId: v2.device.id,
    reason: "Customer resumed seasonal operations"
  });
  assert.equal(resumedV2.subscription.status, "AWAITING_FIRST_CONNECTION");

  // 14 & 15. Supported commands, unsupported command rejection, sensitive command confirmation & audit trail
  const supportedCmds = await engine.getSupportedDeviceCommands(customer1Claims, v1.device.id);
  assert.ok(supportedCmds.some((c) => c.type === "positionSingle"));
  assert.ok(supportedCmds.some((c) => c.type === "engineStop" && c.sensitive === true));

  // Non-sensitive command executes immediately
  const posCmd = await engine.sendAuthorizedDeviceCommand(customer1Claims, {
    deviceId: v1.device.id,
    type: "positionSingle"
  });
  assert.equal(posCmd.commandType, "positionSingle");
  assert.equal(posCmd.status, "SENT");

  // Sensitive command (engineStop) without confirmation must be rejected
  await assert.rejects(
    () =>
      engine.sendAuthorizedDeviceCommand(customer1Claims, {
        deviceId: v1.device.id,
        type: "engineStop",
        confirmedSensitive: false
      }),
    /SENSITIVE_COMMAND_CONFIRMATION_REQUIRED/
  );

  // Sensitive command with confirmation succeeds and is audited
  const stopCmd = await engine.sendAuthorizedDeviceCommand(customer1Claims, {
    deviceId: v1.device.id,
    type: "engineStop",
    confirmedSensitive: true
  });
  assert.equal(stopCmd.commandType, "engineStop");
  assert.equal(stopCmd.status, "SENT");

  // Unsupported command type must be rejected
  await assert.rejects(
    () =>
      engine.sendAuthorizedDeviceCommand(customer1Claims, {
        deviceId: v1.device.id,
        type: "selfDestructUnsupported",
        confirmedSensitive: true
      }),
    /UNSUPPORTED_DEVICE_COMMAND|UNSUPPORTED_COMMAND_TYPE/
  );

  const cmdHistory = await engine.listDeviceCommandHistory(customer1Claims, v1.device.id);
  assert.equal(cmdHistory.length, 2);
  assert.equal(cmdHistory[0].commandType, "engineStop");
  assert.equal(cmdHistory[1].commandType, "positionSingle");

  // 17. Verify one-shot ensureAdminCredentials never resets changed admin password,
  // verify forward-only schema_migrations registry, and verify GitHub release auto-update check
  const ensureRes = await engine.ensureAdminCredentials({
    adminUsername: "admin",
    adminPassword: "Admin@123456",
    mustChangePassword: false
  });
  assert.equal(ensureRes.bootstrapped, false);
  assert.equal(ensureRes.reason, "ALREADY_BOOTSTRAPPED");
  await assert.rejects(
    () => engine.login("admin", "Admin@123456"),
    /INVALID_CREDENTIALS/
  );
  const directAdminSession = await engine.login("admin", "AdminStrongPassword#2026");
  assert.equal(directAdminSession.user.username, "admin");
  assert.equal(directAdminSession.user.role, "ADMIN");
  assert.equal(directAdminSession.mustChangePassword, false);

  const migrationsRes = await db.runTenantTransaction(adminClaims, async (tx) => {
    return tx.query("SELECT version FROM public.schema_migrations ORDER BY version ASC");
  });
  assert.deepEqual(
    migrationsRes.rows.map((r) => r.version),
    [
      "001_initial_supabase_schema",
      "002_user_vehicle_commands_rls",
      "003_customer_device_guard_and_fleet_ops"
    ]
  );

  const { checkGitHubReleaseStatus } = await import("../src/core.mjs");
  const releaseStatus = await checkGitHubReleaseStatus({
    repo: "mahmoudhindam9-stack/gps",
    currentVersion: "1.2.0",
    autoUpdateEnabled: true,
    fetchImpl: async () =>
      Response.json({
        tag_name: "v1.3.0",
        name: "VeloTrack GPS v1.3.0",
        published_at: "2026-11-10T12:00:00Z",
        html_url: "https://github.com/mahmoudhindam9-stack/gps/releases/tag/v1.3.0",
        body: "Fleet Intelligence & Security Release",
        assets: [
          {
            name: "velotrack-android-v1.3.0.apk",
            browser_download_url: "https://github.com/mahmoudhindam9-stack/gps/releases/download/v1.3.0/velotrack-android-v1.3.0.apk"
          }
        ]
      })
  });
  assert.equal(releaseStatus.updateAvailable, true);
  assert.equal(releaseStatus.latestVersion, "1.3.0");
  assert.equal(releaseStatus.schemaVersion, "003_customer_device_guard_and_fleet_ops");

  engine.clearAllTimers();
  await db.close();
});

