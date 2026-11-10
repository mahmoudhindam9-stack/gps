import assert from "node:assert/strict";
import test from "node:test";
import { TraccarBridgeClient } from "../src/core.mjs";

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

test("fleet reports validate device IDs and read Traccar events and mileage summaries", async () => {
  const { client, calls } = makeClient(async (url) => {
    if (url.includes("/api/reports/events?")) {
      return Response.json([{ id: 7, type: "ignitionOn", deviceId: 42 }]);
    }
    if (url.includes("/api/reports/summary?")) {
      return Response.json([{ deviceId: 42, distance: 1200 }]);
    }
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

test("geofence operations use Traccar's REST permissions endpoints", async () => {
  const { client, calls } = makeClient(async (url, options) => {
    if (url.includes("/api/geofences?deviceId=")) return Response.json([{ id: 9, name: "Depot" }]);
    if (url.endsWith("/api/geofences") && options.method === "POST") {
      return Response.json({ id: 9, name: "Depot" });
    }
    if (url.includes("/api/permissions?")) return Response.json([{ deviceId: 42, geofenceId: 9 }]);
    if (url.endsWith("/api/permissions") && ["POST", "DELETE"].includes(options.method)) {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/api/geofences/9") && options.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected request " + url + " " + options.method);
  });
  const zones = await client.fetchGeofencesForDevice(42);
  assert.equal(zones[0].id, 9);
  assert.equal((await client.createGeofence({ name: "Depot", area: "CIRCLE (31 30, 250)" })).id, 9);
  await client.linkGeofenceToDevice(42, 9);
  assert.equal((await client.fetchGeofencePermissions(9))[0].deviceId, 42);
  await client.unlinkGeofenceFromDevice(42, 9);
  await client.deleteGeofence(9);
  assert.ok(calls.some((call) => call.url.endsWith("/api/permissions") && call.options.method === "POST"));
});

test("temporary sharing posts a device ID and exact expiration as form data", async () => {
  const { client } = makeClient(async (url, options) => {
    assert.equal(url, "http://127.0.0.1:8082/api/share/device");
    assert.match(options.headers["Content-Type"], /application\\/x-www-form-urlencoded/);
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
