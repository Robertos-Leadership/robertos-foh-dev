// ════════════════════════════════════════════════════════════
// revenue-assistant — Supabase Edge Function (Leadership Hub project)
// AI report agent for the FOH Revenue module. Keeps the Anthropic key
// server-side (never in the app/repo). Mirrors the Kitchen survey-assistant.
//
// Deploy:  supabase functions deploy revenue-assistant --project-ref paoaivwtkzujmrgrfjuq
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref paoaivwtkzujmrgrfjuq
//
// The app calls it with the anon JWT (verify_jwt on = only valid keys reach it).
// Body: { action:'chat', model, max_tokens, system, messages:[{role,content}] }
// Returns: { text }
// ════════════════════════════════════════════════════════════
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY secret not set" }, 500);

    const body = await req.json();
    const model = body.model || "claude-sonnet-4-6";
    const max_tokens = Math.min(body.max_tokens || 1100, 4000);
    const system = body.system || "You are a precise F&B revenue analyst. Use only the figures provided.";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return json({ error: "No messages provided" }, 400);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens, system, messages }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || ("Anthropic HTTP " + r.status) }, 502);

    const text = (data.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    return json({ text });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
