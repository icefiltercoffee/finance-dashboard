/**
 * Bridge to Miles Pilot's spending engine (Joseph, 2026-10-18: one engine, one learning store).
 *
 * The engine itself and the learned merchant rules live on Miles Pilot (milespilot.net, its D1).
 * Finance reaches them server-to-server only:
 *   MILES_PILOT_ORIGIN    where Miles Pilot is served (default https://milespilot.net; a local
 *                         `wrangler pages dev` origin in development)
 *   MILES_SERVICE_TOKEN   bearer token Miles Pilot checks on /service/*; must equal its
 *                         FINANCE_SERVICE_TOKEN. A secret: never sent to the browser.
 * Every route that uses this sits behind functions/_middleware.js (the PIN gate).
 */
export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export function milesOrigin(env) {
  return String(env.MILES_PILOT_ORIGIN || "https://milespilot.net").replace(/\/+$/, "");
}

/** Calls a Miles Pilot /service route. Returns {status, data} — never throws. */
export async function milesService(env, path, init = {}) {
  if (!env.MILES_SERVICE_TOKEN) return { status: 503, data: { error: "miles-unconfigured" } };
  try {
    const response = await fetch(milesOrigin(env) + path, {
      ...init,
      headers: { "Authorization": `Bearer ${env.MILES_SERVICE_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) }
    });
    let data = null;
    try { data = await response.json(); } catch { data = { error: "miles-bad-response" }; }
    return { status: response.status, data };
  } catch {
    return { status: 502, data: { error: "miles-unreachable" } };
  }
}

/* One-time move of the old KV merchant rules into Miles Pilot (see api/miles/learn.js). */
export const MIGRATION_KEY = "miles-migration-v1";
