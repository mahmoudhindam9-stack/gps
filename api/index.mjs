import { getOrCreateVeloTrackRuntime } from "../backend/src/server.mjs";

export default async function handler(req, res) {
  const runtime = await getOrCreateVeloTrackRuntime();
  return runtime.requestListener(req, res);
}
