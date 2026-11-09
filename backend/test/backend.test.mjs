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
  VeloTrackEngine
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

  // Connect Customer A and Customer B to `/ws/live`
  const wsFramesA = [];
  const wsFramesB = [];
  const clientWsA = new WebSocket(`ws://127.0.0.1:${apiPort}/ws/live`, {
    headers: { Authorization: `Bearer ${custASession.token}` }
  });
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

  // Verify subscription expiration blocks route history and redacts customer coordinates
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

  const expiredViewA = await engine.listAuthorizedDevices(custAClaims, expiredNowMs);
  assert.equal(expiredViewA[0].subscription.status, "EXPIRED");
  assert.equal(expiredViewA[0].device.lastLat, null);

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
  apiServer.wsHub.close();
  await new Promise((resolve) => apiServer.close(resolve));
  for (const s of traccarSockets) s.close();
  traccarWss.close();
  await new Promise((resolve) => traccarHttp.close(resolve));
  await db.close();
});
