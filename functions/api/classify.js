const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

/* Statement merchant lines are read by Claude only (Joseph, 2026-10-10: "Do not use OpenAI to
   read it"). This endpoint is stateless: the merchants are sent to Claude for this one request,
   the answer comes back, and nothing here logs, caches or stores them. There is deliberately no
   fallback to any other provider — without ANTHROPIC_API_KEY it returns llm-unavailable and the
   lines stay in Needs Review for Joseph to sort by hand. */
export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "llm-unavailable" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad-json" }, 400); }
  const categories = Array.isArray(body.categories) ? body.categories.filter(x => typeof x === "string").slice(0, 30) : [];
  const merchants = Array.isArray(body.merchants) ? body.merchants.filter(x => typeof x === "string" && x.length <= 180).slice(0, 24) : [];
  const examples = Array.isArray(body.examples) ? body.examples.slice(0, 12) : [];
  if (!categories.length || !merchants.length) return json({ error: "invalid-request" }, 400);
  const prompt = `Classify only these merchant descriptions. Return strict JSON {"items":[{"merchant":"exact input","category":"one supplied category or Needs Review"}]} and nothing else. Do not invent categories. Use Needs Review when unsure. Categories: ${JSON.stringify(categories)}. Relevant human corrections: ${JSON.stringify(examples)}. Merchants: ${JSON.stringify(merchants)}.`;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 2048, messages: [{ role: "user", content: prompt }] })
    });
    if (!response.ok) return json({ error: "llm-failed" }, 502);
    const payload = await response.json();
    const text = (payload.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1) || "{}");
    const items = Array.isArray(parsed.items) ? parsed.items.filter(x => merchants.includes(x.merchant) && (categories.includes(x.category) || x.category === "Needs Review")) : [];
    return json({ items });
  } catch { return json({ error: "llm-failed" }, 502); }
}
