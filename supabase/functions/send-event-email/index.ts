// ════════════════════════════════════════════════════════════
// send-event-email — Supabase Edge Function (Leadership Hub project)
// Sends Events-desk emails (coordination email on confirm, proposals) via
// Resend, same transport as send-closing-report. Recipients must ALWAYS be
// explicit in the request — this function has no team fallback list, so a
// test can never blast the whole company.
// Secret: RESEND_API_KEY (already set for send-closing-report).
//
// from_name (optional): the logged-in person who is sending. The guest then
// sees "Katarina · Roberto's DIFC Events" and the reply reaches that person,
// while the actual send-address stays on the verified domain so Resend still
// delivers. Missing/blank → the plain house sender, exactly as before.
// ════════════════════════════════════════════════════════════
const FROM_ADDR = "reports@kitchenteam.robertos.ae";
const HOUSE = "Roberto's DIFC Events";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// A display name goes into the From header, so strip anything that could break
// or inject into that header (quotes, angle brackets, newlines) and keep it short.
function cleanName(s: string): string {
  return s.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "RESEND_API_KEY secret not set" }, 500);
    const body = await req.json();
    const subject = String(body.subject || "").slice(0, 200);
    const html = body.html;
    const to = Array.isArray(body.to) ? body.to.filter((x: unknown) => typeof x === "string" && String(x).includes("@")).slice(0, 25) : [];
    if (!subject || !html) return json({ error: "subject and html required" }, 400);
    if (!to.length) return json({ error: "explicit recipients required" }, 400);
    // Client-facing sends set reply_to so answers reach a real person, not the send-only domain.
    const replyTo = typeof body.reply_to === "string" && body.reply_to.includes("@") ? body.reply_to.slice(0, 120) : null;
    // Personalise the visible sender to whoever is logged in, keeping the trusted send-address.
    const fromName = typeof body.from_name === "string" ? cleanName(body.from_name) : "";
    const from = fromName ? `${fromName} · ${HOUSE} <${FROM_ADDR}>` : `${HOUSE} <${FROM_ADDR}>`;

    const payload: Record<string, unknown> = { from, to, subject, html };
    if (replyTo) payload.reply_to = replyTo;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok) return json({ error: "Resend failed", detail: data }, 502);
    return json({ ok: true, id: data.id, recipients: to.length });
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
