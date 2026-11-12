import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, "protocol-ports.json"), "utf8"));
const compose = readFileSync(resolve(root, "compose.yaml"), "utf8");
const traccarXml = readFileSync(resolve(root, "traccar.xml"), "utf8");

assert.equal(manifest.traccarVersion, "6.17.0");
assert.equal(manifest.protocolCount, 268);
assert.equal(manifest.networkListenerCount, 267);
assert.equal(manifest.entries.length, 267);
assert.equal(manifest.nonNetworkProtocols.length, 1);
assert.equal(manifest.nonNetworkProtocols[0].protocol, "orbcomm");
assert.equal(manifest.nonNetworkProtocols[0].defaultPort, 0);

const ports = manifest.entries.map((entry) => entry.defaultPort).sort((a, b) => a - b);
assert.equal(new Set(ports).size, 267, "Protocol ports must be unique");
const expectedPorts = Array.from({ length: 268 }, (_, index) => 5001 + index).filter((port) => port !== 5175);
assert.deepEqual(ports, expectedPorts, "Protocol manifest must match the complete 6.17.0 default listener range");

for (const mapping of [
  "5001-5174:5001-5174/tcp",
  "5001-5174:5001-5174/udp",
  "5176-5268:5176-5268/tcp",
  "5176-5268:5176-5268/udp",
]) {
  assert.ok(compose.includes(mapping), `Missing Compose mapping: ${mapping}`);
}

assert.ok(compose.includes("127.0.0.1:8082:8082"), "Traccar web/API 8082 must remain bound to 127.0.0.1 loopback");
assert.ok(!compose.includes("5432:5432"), "Traccar database port 5432 must remain private with no host port mapping");
assert.ok(!compose.includes("5175:5175"), "Port 5175 is unassigned in Traccar 6.17.0 and must not be mapped");

const firewallScript = readFileSync(resolve(root, "../configure-firewall.sh"), "utf8");
for (const token of ["5001:5174", "5176:5268", "5001-5174/tcp", "5001-5174/udp", "5176-5268/tcp", "5176-5268/udp"]) {
  assert.ok(firewallScript.includes(token), `Missing firewall range in configure-firewall.sh: ${token}`);
}
assert.ok(!/ufw\s+reset|iptables\s+-F/i.test(firewallScript), "Firewall script must be additive and never reset existing rules");

const backendEnvExample = readFileSync(resolve(root, "../../backend/.env.example"), "utf8");
assert.ok(
  backendEnvExample.includes("https://ixazqslcmqjmndhiyhux.supabase.co"),
  "backend/.env.example must reference verified Supabase project ixazqslcmqjmndhiyhux"
);
assert.ok(
  !backendEnvExample.includes("wtbyarkiizmncjnuomti"),
  "backend/.env.example must not reference stale project wtbyarkiizmncjnuomti"
);

assert.ok(!/key=['\"]protocols\.enable['\"]/.test(traccarXml), "Do not add a protocol whitelist; all Traccar defaults must remain enabled");
console.log("PASS: Traccar 6.17.0 protocol inventory verified (267 network listeners; TCP/UDP ingress ranges complete; port 5175 excluded; Orbcomm has no inbound port; loopback & firewall verified).");

