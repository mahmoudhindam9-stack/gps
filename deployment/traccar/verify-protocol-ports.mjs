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

assert.ok(!/key=['\"]protocols\.enable['\"]/.test(traccarXml), "Do not add a protocol whitelist; all Traccar defaults must remain enabled");
console.log("PASS: Traccar 6.17.0 protocol inventory verified (267 network listeners; TCP/UDP ingress ranges complete; port 5175 excluded; Orbcomm has no inbound port).");
