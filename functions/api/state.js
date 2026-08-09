/**
 * Finance Intern — shared dashboard state.
 *
 * Stores the numbers Joseph and Melissa type into the dashboard (the balance
 * fields and any edited goal amounts) so they survive a refresh and follow you
 * to any device behind the same PIN.
 *
 * This route sits behind functions/_middleware.js, which runs first and 401s
 * every unauthenticated request. By the time onRequest here is reached the
 * caller already holds a valid session cookie, so there is no separate auth
 * check — but there is also no per-user identity: anyone with the PIN reads and
 * writes the same record. That is the intent (it is a household dashboard), and
 * it is why the PIN is the only thing protecting it.
 *
 *   GET   /api/state   -> {values, goalAmt, updatedAt}
 *   PATCH /api/state   -> merge {set:{k:v}, unset:[k]} into the record
 *
 * PATCH rather than whole-document PUT is deliberate: two devices editing
 * different fields both survive. A whole-document write from a stale tab would
 * silently revert whatever the other device had just entered.
 *
 * Binding: FINANCE_STATE (KV), declared in wrangler.toml. If it is missing the
 * route says so plainly instead of pretending to save — the client then falls
 * back to this-device-only storage and tells the user which mode it is in.
 */

const KEY = "dashboard-state-v1";
const MAX_FIELDS = 60;
const MAX_BODY_BYTES = 16 * 1024;
const KEY_RE = /^[A-Za-z0-9_]{1,48}$/;

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status: status || 200,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

const empty = () => ({ values: {}, goalAmt: {}, updatedAt: null });

async function read(kv) {
  const raw = await kv.get(KEY);
  if (!raw) return empty();
  try {
    const p = JSON.parse(raw);
    return {
      values:   p && typeof p.values   === "object" && p.values   ? p.values   : {},
      goalAmt:  p && typeof p.goalAmt  === "object" && p.goalAmt  ? p.goalAmt  : {},
      updatedAt: p ? p.updatedAt || null : null
    };
  } catch {
    return empty();                    // corrupt record: start clean, never throw
  }
}

/** Only finite numbers under sane keys are storable. Anything else is dropped
 *  rather than coerced, so a bad client can't poison the record. */
function sanitiseSet(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!KEY_RE.test(k)) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = n;
  }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.FINANCE_STATE;

  if (!kv) {
    return json({
      error: "storage-unbound",
      message: "The FINANCE_STATE KV binding is not attached to this deployment, so nothing can be saved server-side."
    }, 501);
  }

  if (request.method === "GET") {
    return json(await read(kv));
  }

  if (request.method === "PATCH") {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return json({ error: "too-large" }, 413);

    let parsed;
    try { parsed = JSON.parse(body); } catch { return json({ error: "bad-json" }, 400); }

    const cur = await read(kv);
    const setVals  = sanitiseSet(parsed?.set);
    const setGoals = sanitiseSet(parsed?.goalAmt);
    const unset    = Array.isArray(parsed?.unset) ? parsed.unset.filter(k => KEY_RE.test(k)) : [];
    const unsetG   = Array.isArray(parsed?.unsetGoalAmt) ? parsed.unsetGoalAmt.filter(k => KEY_RE.test(k)) : [];

    const next = {
      values:  Object.assign({}, cur.values,  setVals),
      goalAmt: Object.assign({}, cur.goalAmt, setGoals),
      updatedAt: new Date().toISOString()
    };
    unset.forEach(k => { delete next.values[k]; });
    unsetG.forEach(k => { delete next.goalAmt[k]; });

    if (Object.keys(next.values).length + Object.keys(next.goalAmt).length > MAX_FIELDS)
      return json({ error: "too-many-fields" }, 400);

    await kv.put(KEY, JSON.stringify(next));
    return json(next);
  }

  return json({ error: "method-not-allowed" }, 405);
}
