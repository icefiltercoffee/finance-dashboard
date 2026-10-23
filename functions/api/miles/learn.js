import { json, milesService, MIGRATION_KEY } from "../../_lib/miles.js";

/* POST /api/miles/learn — {rules:[{phrase, category}], migration?:true}
   A correction (or a confirmed Claude guess) on Joseph's statement review teaches the shared
   engine: Miles Pilot saves it to his private profile and files it as a shared-rule suggestion
   for admin approval. Miles Pilot validates every rule with the engine's own sanitiser.

   migration:true is the one-time move of the old KV merchantRules. When Miles Pilot confirms
   it, a record of what moved is kept under its own KV key; the old rules themselves are left in
   place (Melissa's tab still reads them). */
const PHRASE = /^.{3,60}$/s;

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad-json" }, 400); }
  const rules = Array.isArray(body && body.rules) ? body.rules
    .filter(r => r && typeof r.phrase === "string" && PHRASE.test(r.phrase.trim()) && typeof r.category === "string" && r.category.length <= 40)
    .map(r => ({ phrase: r.phrase.trim(), category: r.category })) : [];
  if (!rules.length || rules.length > 250) return json({ error: "invalid-request" }, 400);
  const migration = body.migration === true;
  const { status, data } = await milesService(env, "/service/learn", {
    method: "POST",
    body: JSON.stringify({ rules, evidence: migration ? "Moved from earlier statement corrections." : "Taught from a card statement review." })
  });
  if (status !== 200 || !data || data.ok !== true) return json({ error: data && data.error || "miles-failed", detail: data }, status >= 400 && status < 500 ? status : 502);
  if (migration && env.FINANCE_STATE) {
    try {
      await env.FINANCE_STATE.put(MIGRATION_KEY, JSON.stringify({ at: data.observed_at || new Date().toISOString(),
        moved: rules.length, learned: data.learned, submitted: data.submitted, refused: (data.refused || []).length }));
    } catch { /* the rules moved; only the record failed — the page offers the move again, which is idempotent */ }
  }
  return json(data);
}
