import { json, milesOrigin, milesService, MIGRATION_KEY } from "../../_lib/miles.js";

/* GET /api/miles/rules — Joseph's learned merchant rules, the approved shared rules, his
   suggestions awaiting review and his card settings, read live from Miles Pilot's D1.
   Also reports whether the old Finance KV merchant rules have been moved across yet. */
export async function onRequestGet({ env }) {
  const { status, data } = await milesService(env, "/service/rules");
  let migration = null;
  try { migration = env.FINANCE_STATE ? JSON.parse(await env.FINANCE_STATE.get(MIGRATION_KEY) || "null") : null; } catch { migration = null; }
  if (status !== 200) return json({ error: data && data.error || "miles-failed", migration }, status === 503 ? 503 : 502);
  return json({ ...data, engine_source: milesOrigin(env) + "/engine.js", migration });
}
