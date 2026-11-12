import { getOrCreateVeloTrackRuntime } from "../backend/src/server.mjs";

export default async function handler(req, res) {
  try {
    const runtime = await getOrCreateVeloTrackRuntime();
    return await runtime.requestListener(req, res);
  } catch (err) {
    const message = err?.message ?? "BACKEND_RUNTIME_UNAVAILABLE";
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: message }));
  }
}
