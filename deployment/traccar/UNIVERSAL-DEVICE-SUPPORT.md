# Universal Traccar device ingress

## Compatibility baseline

This deployment is pinned to the official Traccar Server **6.17.0** protocol registry. The inventory in `protocol-ports.json` is generated from the tagged upstream source:

- Source: https://github.com/traccar/traccar/blob/v6.17.0/src/main/java/org/traccar/config/ProtocolConfig.java
- Protocol classes in the registry: 268
- Classes with a non-zero inbound listener port: 267
- Network listener ports: 5001–5174 and 5176–5268
- Port 5175 is intentionally unused in this version.
- Orbcomm is listed with port 0 and has no default inbound socket listener.

Traccar's official device catalogue covers many manufacturers and thousands of device models. This configuration preserves the full protocol set shipped in the selected server version; it does not promise compatibility with every proprietary clone or firmware variant ever sold. Unknown or non-standard devices still require protocol identification and packet-level testing.

## How ingress works

1. Traccar's built-in protocol implementations determine which transport(s) they use. The ingress layer publishes TCP and UDP for every non-zero default listener port so that the matching protocol transport can reach the container.
2. `traccar.xml` deliberately does not set `protocols.enable`; adding a whitelist would silently disable other supported protocol listeners.
3. `compose.yaml` maps 5001–5174 and 5176–5268 for both TCP and UDP. The manifest records the protocol name and the default port from the pinned upstream source.
4. `configure-firewall.sh` adds additive OS firewall rules for those ranges and for the HTTPS reverse proxy. The VPS/cloud provider security list must also allow the same inbound ranges.
5. Traccar REST/Web UI port 8082 stays bound to 127.0.0.1 on the VPS. Backend port 3000 and the database port 5432 must not be publicly exposed.

## Device provisioning

- Identify the exact protocol from the device model/firmware documentation or a verified packet sample.
- Look up the protocol's default port in `protocol-ports.json` and the official device list at https://www.traccar.org/devices/.
- Configure the tracker with the VPS public IP/DNS name and that protocol's port. Keep the device's unique ID/IMEI consistent with the VeloTrack registration.
- Test real packets, reconnection, no-fix heartbeat, and valid GPS fix separately. A successful TCP connection alone is not proof that a packet was decoded or a device was activated.

## Validation

Run from the repository root:

    node deployment/traccar/verify-protocol-ports.mjs
    docker compose --env-file deployment/traccar/.env -f deployment/traccar/compose.yaml config

After deployment, inspect listeners on the VPS with:

    sudo ss -lntup

Do not infer UDP reachability from a TCP probe. Verify UDP packets with a real device or a controlled protocol-specific test, and verify decoded positions in Traccar.

## Railway trial limitation

The current Railway trial service is a temporary Traccar web/API and OsmAnd smoke-test environment. It is not the universal production ingress. A single TCP proxy on Railway cannot replace the full multi-port TCP/UDP listener range required by this VPS deployment.
