const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY) return json({ error: "llm-unavailable" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad-json" }, 400); }
  const categories = Array.isArray(body.categories) ? body.categories.filter(x => typeof x === "string").slice(0, 30) : [];
  const merchants = Array.isArray(body.merchants) ? body.merchants.filter(x => typeof x === "string" && x.length <= 180).slice(0, 24) : [];
  const examples = Array.isArray(body.examples) ? body.examples.slice(0, 12) : [];
  if (!categories.length || !merchants.length) return json({ error: "invalid-request" }, 400);
  const prompt = `Classify only these merchant descriptions. Return strict JSON {"items":[{"merchant":"exact input","category":"one supplied category or Needs Review"}]}. Do not invent categories. Use Needs Review when unsure. Categories: ${JSON.stringify(categories)}. Relevant human corrections: ${JSON.stringify(examples)}. Merchants: ${JSON.stringify(merchants)}.`;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5-mini", input: prompt, text: { format: { type: "json_object" } } })
    });
    if (!response.ok) return json({ error: "llm-failed" }, 502);
    const payload = await response.json();
    const parsed = JSON.parse(payload.output_text || "{}");
    const items = Array.isArray(parsed.items) ? parsed.items.filter(x => merchants.includes(x.merchant) && (categories.includes(x.category) || x.category === "Needs Review")) : [];
    return json({ items });
  } catch { return json({ error: "llm-failed" }, 502); }
}
