import { milesOrigin } from "../../../_lib/miles.js";

/* GET /api/miles/script/engine.js | profile.js
   Serves Miles Pilot's own engine module and card-settings schema, fetched from Miles Pilot each
   time, so this dashboard always runs the same engine milespilot.net does. Proxied (rather than a
   cross-origin <script>) so local development can point at a local Miles Pilot and the browser
   only ever talks to this origin. Only these two files can be fetched. */
const FILES = { "engine.js": "/engine.js", "profile.js": "/lib/profile.js" };

export async function onRequestGet({ params, env }) {
  const path = FILES[params.name];
  if (!path) return new Response("Not found", { status: 404 });
  try {
    const upstream = await fetch(milesOrigin(env) + path, { cf: { cacheTtl: 0 } });
    const type = upstream.headers.get("Content-Type") || "";
    if (!upstream.ok || !/javascript/.test(type)) throw new Error("bad upstream");
    return new Response(await upstream.text(), {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store",
        "X-Engine-Source": milesOrigin(env) + path, "X-Content-Type-Options": "nosniff" }
    });
  } catch {
    // The page checks for window.MilesEngine and says the engine is unavailable.
    return new Response("/* Miles Pilot engine unavailable */", { status: 502,
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
  }
}
