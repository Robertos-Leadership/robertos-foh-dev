// ════════════════════════════════════════════════════════════
// send-stock-take — Supabase Edge Function (FOH / Leadership Hub project)
// Emails the monthly Stock Take (Beverage / Tobacco) to the cost controller +
// team via Resend. Key stays server-side. Recipients (to + cc) are passed from
// the app so Beverage and Tobacco can share one function, and an optional Excel
// attachment ([{ filename, content }] base64) is forwarded to Resend.
//
// Deploy:  supabase functions deploy send-stock-take --project-ref paoaivwtkzujmrgrfjuq
// Secret:  supabase secrets set RESEND_API_KEY=re_... --project-ref paoaivwtkzujmrgrfjuq
//          (already set for send-closing-report — same project, reused.)
//
// FROM must be on a domain VERIFIED in your Resend account (kitchenteam.robertos.ae).
// ════════════════════════════════════════════════════════════
const FROM = "Roberto's DIFC FOH <reports@kitchenteam.robertos.ae>";   // verified Resend domain

// Defaults if the app sends nothing (Beverage/Tobacco to Aung; cc Asarudeen, Manuel).
// Jad Ballout removed 12 Sep 2026 (left the company).
const DEFAULT_TO = ["ahtwe@robertos.ae"];
const DEFAULT_CC = ["amohamed@robertos.ae", "mpetrosino@robertos.ae"];

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
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "RESEND_API_KEY secret not set" }, 500);

    const body = await req.json();

    // accept a string or an array for both to + cc; fall back to the FOH defaults
    const toList = Array.isArray(body.to) ? body.to : (body.to ? [body.to] : DEFAULT_TO);
    const ccList = Array.isArray(body.cc) ? body.cc : (body.cc ? [body.cc] : DEFAULT_CC);
    const subject = body.subject || "Stock Take";
    const html = body.html || "";
    // attachments: [{ filename, content }] where content is a base64 string (.xlsx)
    const attList = Array.isArray(body.attachments) ? body.attachments : [];

    const payload: Record<string, unknown> = { from: FROM, to: toList, cc: ccList, subject, html };
    if (attList.length) payload.attachments = attList;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.message || ("Resend HTTP " + r.status) }, 502);
    return json({ ok: true, id: data?.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
