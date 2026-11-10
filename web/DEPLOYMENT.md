# Deployment

## Frontend hosting

Build this repository as a static Vite site:

- Build command: npm run build
- Output directory: dist
- Environment variable: VITE_API_BASE_URL=https://YOUR_REAL_BACKEND_HOSTNAME

Do not configure Supabase service-role keys, PostgreSQL connection strings, Traccar credentials, or JWT signing secrets in the frontend host. Vite variables are public and become part of the browser bundle.

## Backend requirements

The backend API must be reachable over HTTPS from the browser. Its CORS policy must allow the exact deployed website origin (not only localhost). The current backend implementation returns Access-Control-Allow-Origin: *; production should replace that wildcard with an allowlist of the actual web origin(s), especially before adding cookie-based authentication.

The backend must expose the current VeloTrack routes for health, login, password change, authenticated profile, devices, customers, device profiles, device provisioning, renewals, ownership reassignment, audited activation override, route history, Traccar sync, and the JWT-authenticated /ws/live WebSocket.

## Realtime authentication

The current backend supports a token query parameter for browser WebSocket clients because the browser WebSocket API cannot set an Authorization header. This app keeps the token in sessionStorage and passes it to the WebSocket only for the connection. Configure reverse-proxy and access logs to redact query parameters on /ws/live; a future backend change should exchange the browser JWT for a short-lived, single-use WebSocket ticket.

## Supabase Studio / database console

Do not publish the Supabase Studio or PostgreSQL port publicly just to let this app work. Keep database access private. Administrators who need Studio should use the existing VPS access method (VPN or SSH tunnel) and the actual Studio port configured on that VPS. No Studio hostname or port is assumed by this repository.

## Deployment checks

1. Confirm the backend HTTPS URL and configure it as VITE_API_BASE_URL.
2. Add the exact website origin to the backend CORS allowlist before production hardening.
3. Run npm run build.
4. Publish dist/ to the already-approved static website host.
5. Verify login, forced password change, admin/customer authorization, real device list, live updates, route history, and admin writes against the production backend.
6. Confirm no browser bundle or source map includes privileged secrets.
7. Keep production data; do not seed demo customers, devices, positions, or routes.
