import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  SupabaseAuthService,
  SupabaseDatabaseAdapter,
  TraccarBridgeClient,
  VeloTrackEngine
} from "../src/core.mjs";

function makeClient(handler) {
  const calls = [];
  const client = new TraccarBridgeClient({
    baseUrl: "http://127.0.0.1:8082",
    adminEmail: "test@velotrack.local",
    adminPassword: "test-password",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/api/session")) {
        return new Response("", {
          status: 200,
          headers: { "set-cookie": "JSESSIONID=test-session; Path=/; HttpOnly" }
        });
      }
      return handler(String(url), options);
    }
  });
  return { client, calls };
}

test("fleet reports validate IDs and query Traccar events and mileage", async () => {
  const { client, calls } = makeClient(async (url) => {
    if (url.includes("/api/reports/events?")) return Response.json([{ id: 7, type: "ignitionOn", deviceId: 42 }]);
    if (url.includes("/api/reports/summary?")) return Response.json([{ deviceId: 42, distance: 1200 }]);
    throw new Error("Unexpected request " + url);
  });
  const events = await client.fetchEvents([42], "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z");
  const summary = await client.fetchMileageSummary([42], "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z");
  assert.equal(events[0].type, "ignitionOn");
  assert.equal(summary[0].distance, 1200);
  assert.equal(calls.filter((call) => call.url.includes("/api/reports/")).length, 2);
  await assert.rejects(
    () => client.fetchEvents(["bad-id"], "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"),
    /TRACCAR_DEVICE_IDS_REQUIRED/
  );
});

test("geofences are created and linked through Traccar REST permissions", async () => {
  const { client, calls } = makeClient(async (url, options) => {
    if (url.includes("/api/geofences?deviceId=")) return Response.json([{ id: 9, name: "Depot" }]);
    if (url.endsWith("/api/geofences") && options.method === "POST") return Response.json({ id: 9, name: "Depot" });
    if (url.includes("/api/permissions?")) return Response.json([{ deviceId: 42, geofenceId: 9 }]);
    if (url.endsWith("/api/permissions") && ["POST", "DELETE"].includes(options.method)) return new Response(null, { status: 204 });
    if (url.endsWith("/api/geofences/9") && options.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error("Unexpected request " + url);
  });
  assert.equal((await client.fetchGeofencesForDevice(42))[0].id, 9);
  assert.equal((await client.createGeofence({ name: "Depot", area: "CIRCLE (31 30, 250)" })).id, 9);
  await client.linkGeofenceToDevice(42, 9);
  assert.equal((await client.fetchGeofencePermissions(9))[0].deviceId, 42);
  await client.unlinkGeofenceFromDevice(42, 9);
  await client.deleteGeofence(9);
  assert.ok(calls.some((call) => call.url.endsWith("/api/permissions") && call.options.method === "POST"));
});

test("temporary sharing posts device and expiration as form data", async () => {
  const { client } = makeClient(async (url, options) => {
    assert.equal(url, "http://127.0.0.1:8082/api/share/device");
    assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
    const form = new URLSearchParams(options.body);
    assert.equal(form.get("deviceId"), "42");
    assert.equal(form.get("expiration"), "2026-11-10T15:00:00.000Z");
    return new Response("temporary-share-token", { status: 200 });
  });
  assert.equal(
    await client.createDeviceShare(42, "2026-11-10T15:00:00Z"),
    "temporary-share-token"
  );
});

test("fleet intelligence modules enforce tenant isolation, subscription expiry, admin geofence rules, real sensor filtering, and HTTPS share URLs", async () => {
  const pglite = new PGlite();
  const db = new SupabaseDatabaseAdapter({ pglite });
  await db.applySchemaMigration();

  const authService = new SupabaseAuthService({
    dbAdapter: db,
    supabaseJwtSecret: "fleet-ops-jwt-secret-key-2026-production-grade-0001"
  });

  let nextTraccarDeviceId = 800;
  const traccarGeofences = new Map();
  const traccarPermissions = []; // { deviceId, geofenceId }
  let nextGeofenceId = 50;

  const { client: traccarClient } = makeClient(async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/devices" && options.method === "POST") {
      const body = JSON.parse(options.body);
      const id = nextTraccarDeviceId++;
      return Response.json({ id, name: body.name, uniqueId: body.uniqueId, status: "offline" });
    }
    if (parsed.pathname === "/api/devices" && (!options.method || options.method === "GET")) {
      return Response.json([
        { id: 800, name: "CustA Van", uniqueId: "358739051122332", status: "online" },
        { id: 801, name: "CustB Truck", uniqueId: "358739059988775", status: "online" }
      ]);
    }
    if (parsed.pathname === "/api/positions") {
      return Response.json([
        {
          id: 9901,
          deviceId: 800,
          valid: true,
          latitude: 30.0444,
          longitude: 31.2357,
          speed: 20,
          course: 90,
          fixTime: "2026-11-10T10:00:00.000Z",
          attributes: {
            ignition: true,
            batteryLevel: 88,
            satellites: 11,
            rssi: 4,
            unsupportedBogusObject: { nested: true }
          }
        },
        {
          id: 9902,
          deviceId: 801,
          valid: true,
          latitude: 31.2001,
          longitude: 29.9187,
          speed: 10,
          course: 45,
          fixTime: "2026-11-10T10:05:00.000Z",
          attributes: {
            ignition: false,
            fuelLevel: 64
          }
        }
      ]);
    }
    if (parsed.pathname === "/api/reports/events") {
      const deviceIds = parsed.searchParams.getAll("deviceId").map(Number);
      const allEvents = [
        {
          id: 301,
          type: "geofenceEnter",
          deviceId: 800,
          eventTime: "2026-11-10T09:30:00.000Z",
          positionId: 9901,
          geofenceId: 50,
          attributes: {}
        },
        {
          id: 302,
          type: "overspeed",
          deviceId: 801,
          eventTime: "2026-11-10T09:45:00.000Z",
          positionId: 9902,
          geofenceId: null,
          attributes: { speed: 68 }
        }
      ];
      return Response.json(allEvents.filter((e) => deviceIds.includes(e.deviceId)));
    }
    if (parsed.pathname === "/api/reports/summary") {
      const deviceIds = parsed.searchParams.getAll("deviceId").map(Number);
      const summaries = [
        {
          deviceId: 800,
          distance: 45250, // meters -> 45.25 km
          averageSpeed: 20, // knots -> 37.04 km/h
          maxSpeed: 40, // knots -> 74.08 km/h
          spentFuel: 4.6,
          engineHours: 2.5
        },
        {
          deviceId: 801,
          distance: 12000,
          averageSpeed: 10,
          maxSpeed: 25,
          spentFuel: 1.5,
          engineHours: 1.0
        }
      ];
      return Response.json(summaries.filter((s) => deviceIds.includes(s.deviceId)));
    }
    if (parsed.pathname === "/api/geofences" && (!options.method || options.method === "GET")) {
      const devId = Number(parsed.searchParams.get("deviceId"));
      if (Number.isInteger(devId) && devId > 0) {
        const linkedIds = traccarPermissions
          .filter((p) => p.deviceId === devId)
          .map((p) => p.geofenceId);
        return Response.json(
          linkedIds.map((gid) => traccarGeofences.get(gid)).filter(Boolean)
        );
      }
      return Response.json([...traccarGeofences.values()]);
    }
    if (parsed.pathname === "/api/geofences" && options.method === "POST") {
      const body = JSON.parse(options.body);
      const id = nextGeofenceId++;
      const created = {
        id,
        name: body.name,
        description: body.description ?? "",
        area: body.area,
        attributes: body.attributes ?? {}
      };
      traccarGeofences.set(id, created);
      return Response.json(created);
    }
    if (parsed.pathname === "/api/permissions" && (!options.method || options.method === "GET")) {
      const gid = Number(parsed.searchParams.get("geofenceId"));
      return Response.json(
        traccarPermissions.filter((p) => p.geofenceId === gid)
      );
    }
    if (parsed.pathname === "/api/permissions" && options.method === "POST") {
      const body = JSON.parse(options.body);
      traccarPermissions.push({
        deviceId: Number(body.deviceId),
        geofenceId: Number(body.geofenceId)
      });
      return new Response(null, { status: 204 });
    }
    if (parsed.pathname === "/api/permissions" && options.method === "DELETE") {
      const body = JSON.parse(options.body);
      const idx = traccarPermissions.findIndex(
        (p) => p.deviceId === Number(body.deviceId) && p.geofenceId === Number(body.geofenceId)
      );
      if (idx >= 0) traccarPermissions.splice(idx, 1);
      return new Response(null, { status: 204 });
    }
    const geoDeleteMatch = /^\/api\/geofences\/(\d+)$/.exec(parsed.pathname);
    if (geoDeleteMatch && options.method === "DELETE") {
      const gid = Number(geoDeleteMatch[1]);
      traccarGeofences.delete(gid);
      return new Response(null, { status: 204 });
    }
    if (parsed.pathname === "/api/share/device" && options.method === "POST") {
      return new Response("share-token-xyz-987", { status: 200 });
    }
    throw new Error("Unhandled Traccar URL: " + url);
  });

  const smsGateway = {
    async sendSms({ toE164, text }) {
      return {
        gatewayMessageId: "gw-fleet-1",
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
  const firstClaims = authService.verifyToken(firstLogin.token);
  const adminSession = await engine.changePassword(firstClaims, {
    currentPassword: "Admin@123456",
    newPassword: "AdminFleetPassword#2026"
  });
  const adminClaims = authService.verifyToken(adminSession.token);

  const custA = await engine.createCustomerAccount(adminClaims, {
    fullName: "Customer Alpha",
    phone: "01011223344",
    username: "cust_alpha",
    password: "AlphaPassword#2026"
  });
  const custB = await engine.createCustomerAccount(adminClaims, {
    fullName: "Customer Beta",
    phone: "01122334455",
    username: "cust_beta",
    password: "BetaPassword#2026"
  });

  const sessionA = await engine.login("cust_alpha", "AlphaPassword#2026");
  const claimsA = authService.verifyToken(sessionA.token);
  const sessionB = await engine.login("cust_beta", "BetaPassword#2026");
  const claimsB = authService.verifyToken(sessionB.token);

  const profile = await engine.registerDeviceProfile(adminClaims, {
    manufacturer: "Concox",
    model: "GT06N",
    firmwareVersion: "V2.4",
    traccarProtocol: "gt06",
    serverHost: "gps.velotrack.local",
    serverPort: 5023,
    serverCommandTemplate: "SERVER,1,{HOST},{PORT},0#",
    isVerified: true
  });

  const devA = await engine.provisionAndActivateDevice(adminClaims, {
    profileId: profile.id,
    imei: "358739051122332",
    customerId: custA.id,
    vehicleName: "CustA Van",
    vehicleType: "VAN",
    vehicleIcon: "van",
    plateNumber: "CAI-111",
    planDuration: "MONTH_1",
    simLocalWithoutPlus20: "01012345678",
    autoSendSms: false
  });

  const devB = await engine.provisionAndActivateDevice(adminClaims, {
    profileId: profile.id,
    imei: "358739059988775",
    customerId: custB.id,
    vehicleName: "CustB Truck",
    vehicleType: "TRUCK",
    vehicleIcon: "truck",
    plateNumber: "ALEX-222",
    planDuration: "MONTH_3",
    simLocalWithoutPlus20: "01287654321",
    autoSendSms: false
  });

  // Activate both via real Traccar update
  await engine.ingestTraccarUpdate({
    traccarDevices: [
      { id: 800, name: "CustA Van", uniqueId: "358739051122332", status: "online" },
      { id: 801, name: "CustB Truck", uniqueId: "358739059988775", status: "online" }
    ],
    traccarPositions: [
      {
        id: 9901,
        deviceId: 800,
        valid: true,
        latitude: 30.0444,
        longitude: 31.2357,
        speed: 20,
        course: 90,
        fixTime: "2026-11-10T10:00:00.000Z",
        attributes: { ignition: true, batteryLevel: 88, satellites: 11, rssi: 4 }
      },
      {
        id: 9902,
        deviceId: 801,
        valid: true,
        latitude: 31.2001,
        longitude: 29.9187,
        speed: 10,
        course: 45,
        fixTime: "2026-11-10T10:05:00.000Z",
        attributes: { ignition: false, fuelLevel: 64 }
      }
    ]
  });

  // 1) Events & Alerts: Customer A only sees devA events; cross-tenant query for devB is rejected
  const eventsA = await engine.getAuthorizedFleetEvents(claimsA, {
    fromIso: "2026-11-10T00:00:00.000Z",
    toIso: "2026-11-10T12:00:00.000Z"
  });
  assert.equal(eventsA.length, 1);
  assert.equal(eventsA[0].deviceId, devA.device.id);
  assert.equal(eventsA[0].type, "geofenceEnter");

  await assert.rejects(
    () =>
      engine.getAuthorizedFleetEvents(claimsA, {
        deviceId: devB.device.id,
        fromIso: "2026-11-10T00:00:00.000Z",
        toIso: "2026-11-10T12:00:00.000Z"
      }),
    /FORBIDDEN_TENANT_ISOLATION/
  );

  // 2) Mileage Summary: Converts meters->km and knots->km/h accurately
  const mileageA = await engine.getAuthorizedMileageSummary(claimsA, {
    fromIso: "2026-11-10T00:00:00.000Z",
    toIso: "2026-11-10T12:00:00.000Z"
  });
  assert.equal(mileageA.length, 1);
  assert.equal(mileageA[0].deviceId, devA.device.id);
  assert.equal(mileageA[0].distanceKm, 45.25);
  assert.equal(mileageA[0].averageSpeedKmh, 37.04);
  assert.equal(mileageA[0].maxSpeedKmh, 74.08);
  assert.equal(mileageA[0].spentFuelLiters, 4.6);
  assert.equal(mileageA[0].engineHours, 2.5);

  // 3) Sensor Telemetry: Only real reported attributes are returned; missing sensors are NOT fabricated
  const telemetryA = await engine.getAuthorizedFleetTelemetry(claimsA);
  assert.equal(telemetryA.length, 1);
  assert.equal(telemetryA[0].deviceId, devA.device.id);
  assert.equal(telemetryA[0].values.batteryLevel, 88);
  assert.equal(telemetryA[0].values.satellites, 11);
  assert.equal(telemetryA[0].values.ignition, true);
  assert.equal("fuelLevel" in telemetryA[0].values, false);
  assert.equal("unsupportedBogusObject" in telemetryA[0].values, false);

  // 4) Geofences: Customer cannot create or delete geofences; Admin can create & link
  await assert.rejects(
    () =>
      engine.createAuthorizedGeofence(claimsA, {
        name: "Unauthorized Zone",
        area: "CIRCLE (31.2357 30.0444, 250)",
        deviceIds: [devA.device.id]
      }),
    /FORBIDDEN_ADMIN_ONLY/
  );

  await assert.rejects(
    () =>
      engine.createAuthorizedGeofence(adminClaims, {
        name: "Invalid WKT",
        area: "NOT_A_VALID_WKT",
        deviceIds: [devA.device.id]
      }),
    /INVALID_GEOFENCE_INPUT/
  );

  const createdGeo = await engine.createAuthorizedGeofence(adminClaims, {
    name: "Cairo Hub",
    description: "Main warehouse zone",
    area: "CIRCLE (31.2357 30.0444, 300)",
    deviceIds: [devA.device.id]
  });
  assert.equal(createdGeo.name, "Cairo Hub");
  assert.deepEqual(createdGeo.deviceIds, [devA.device.id]);

  // Customer A sees the geofence linked to devA; Customer B does not
  const zonesA = await engine.listAuthorizedGeofences(claimsA);
  const zonesB = await engine.listAuthorizedGeofences(claimsB);
  assert.equal(zonesA.length, 1);
  assert.equal(zonesA[0].name, "Cairo Hub");
  assert.equal(zonesB.length, 0);

  // Customer A cannot delete the geofence
  await assert.rejects(
    () => engine.deleteAuthorizedGeofence(claimsA, createdGeo.id),
    /FORBIDDEN_ADMIN_ONLY/
  );

  // If a geofence is also linked to an unowned external Traccar device (e.g. 9999), deletion is blocked
  traccarPermissions.push({ deviceId: 9999, geofenceId: createdGeo.id });
  await assert.rejects(
    () => engine.deleteAuthorizedGeofence(adminClaims, createdGeo.id),
    /GEOFENCE_SHARED_WITH_OTHER_TRACCAR_DEVICES/
  );
  // Remove external link and delete cleanly
  const extIdx = traccarPermissions.findIndex((p) => p.deviceId === 9999);
  traccarPermissions.splice(extIdx, 1);
  const deletedGeo = await engine.deleteAuthorizedGeofence(adminClaims, createdGeo.id);
  assert.equal(deletedGeo.deleted, true);

  // 5) Temporary Location Sharing: Requires HTTPS TRACCAR_PUBLIC_URL and active subscription
  engine.traccarPublicUrl = "";
  await assert.rejects(
    () =>
      engine.createAuthorizedDeviceShare(claimsA, {
        deviceId: devA.device.id,
        expiresInHours: 12
      }),
    /TRACCAR_PUBLIC_URL_NOT_CONFIGURED/
  );

  engine.traccarPublicUrl = "http://insecure.velotrack.local";
  await assert.rejects(
    () =>
      engine.createAuthorizedDeviceShare(claimsA, {
        deviceId: devA.device.id,
        expiresInHours: 12
      }),
    /TRACCAR_PUBLIC_URL_MUST_USE_HTTPS/
  );

  engine.traccarPublicUrl = "https://track.velotrack.org";
  const shareResult = await engine.createAuthorizedDeviceShare(claimsA, {
    deviceId: devA.device.id,
    expiresInHours: 24
  });
  assert.equal(shareResult.shareUrl, "https://track.velotrack.org/?token=share-token-xyz-987");
  assert.equal(shareResult.deviceId, devA.device.id);

  // 6) Subscription Suspension / Expiry Enforcement across Fleet Intelligence modules
  await engine.suspendSubscription(adminClaims, {
    deviceId: devA.device.id,
    reason: "Billing verification"
  });
  await assert.rejects(
    () =>
      engine.getAuthorizedFleetEvents(claimsA, {
        deviceId: devA.device.id,
        fromIso: "2026-11-10T00:00:00.000Z",
        toIso: "2026-11-10T12:00:00.000Z"
      }),
    /SUBSCRIPTION_EXPIRED/
  );
  await assert.rejects(
    () =>
      engine.createAuthorizedDeviceShare(claimsA, {
        deviceId: devA.device.id,
        expiresInHours: 6
      }),
    /SUBSCRIPTION_EXPIRED/
  );
  // Admin can still query events and create shares even when customer subscription is suspended/expired
  const adminEventsOnSuspended = await engine.getAuthorizedFleetEvents(adminClaims, {
    deviceId: devA.device.id,
    fromIso: "2026-11-10T00:00:00.000Z",
    toIso: "2026-11-10T12:00:00.000Z"
  });
  assert.equal(adminEventsOnSuspended.length, 1);

  engine.clearAllTimers();
  await db.close();
});
