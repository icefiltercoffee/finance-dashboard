const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

const SYSTEM = `You are the Finance Intern inside Steven, Joseph's AI chief-of-staff system, analysing spending
patterns for a "Spending habits" section on his household finance dashboard. Joseph and his partner Melissa
live and work in Singapore; all figures are SGD.

You will be given month-by-month spending BY CATEGORY (never individual transactions or merchant names — those
never leave the browser). Your job has two parts:
1. Reflect back what the pattern actually is — which categories are largest, which are trending up or down,
   anything volatile or unusual. Be specific and use the real numbers given. Do not moralise or nag about small
   discretionary spend ("coffee") — focus on what's actually material.
2. Suggest concrete things to cut or reduce, each with a realistic estimated monthly saving. Ground every
   suggestion in a category that is actually in the data — never invent a category, merchant, or amount that
   wasn't given to you.

Rules:
- If only one month of data is given, say so plainly and describe that month only — do not claim a "trend" from
  a single data point.
- If a category looks unusually large or small for its kind by ordinary Singapore cost-of-living expectations,
  you may say so, but label it as general knowledge, not something read from Joseph's own history.
- Keep the summary to 2-3 sentences. Patterns: up to 4 short bullet points. Cuts: up to 4, each concrete and
  specific enough to act on this month, not generic advice like "spend less."

Reply as strict JSON: {"summary": "...", "patterns": ["...", ...], "cuts": [{"area": "...", "note": "...",
"estMonthlySaving": number|null}, ...]}`;

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY) return json({ error: "llm-unavailable" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad-json" }, 400); }
  const scope = typeof body.scope === "string" ? body.scope.slice(0, 40) : "household";
  const months = Array.isArray(body.months) ? body.months.slice(0, 24) : [];
  const clean = months
    .filter(m => m && typeof m.month === "string" && Array.isArray(m.rows))
    .map(m => ({
      month: m.month.slice(0, 24),
      source: m.source === "statement" ? "statement" : "sheet",
      rows: m.rows.filter(r => r && typeof r.name === "string" && Number.isFinite(Number(r.amount)))
        .slice(0, 30).map(r => ({ name: r.name.slice(0, 60), amount: Math.round(Number(r.amount) * 100) / 100 }))
    }))
    .filter(m => m.rows.length);
  if (!clean.length) return json({ error: "invalid-request" }, 400);

  const prompt = `Scope: ${scope}\nMonths of category spending (JSON): ${JSON.stringify(clean)}`;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        instructions: SYSTEM,
        input: prompt,
        text: { format: { type: "json_object" } }
      })
    });
    if (!response.ok) return json({ error: "llm-failed" }, 502);
    const payload = await response.json();
    const parsed = JSON.parse(payload.output_text || "{}");
    const summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 800) : null;
    if (!summary) return json({ error: "llm-empty" }, 502);
    const patterns = Array.isArray(parsed.patterns) ? parsed.patterns.filter(x => typeof x === "string").slice(0, 6) : [];
    const cuts = Array.isArray(parsed.cuts) ? parsed.cuts
      .filter(x => x && typeof x.area === "string")
      .slice(0, 6)
      .map(x => ({
        area: x.area.slice(0, 60),
        note: typeof x.note === "string" ? x.note.slice(0, 300) : "",
        estMonthlySaving: Number.isFinite(Number(x.estMonthlySaving)) ? Math.round(Number(x.estMonthlySaving)) : null
      })) : [];
    return json({ summary, patterns, cuts, monthsUsed: clean.length });
  } catch { return json({ error: "llm-failed" }, 502); }
}
