// ════════════════════════════════════════════════════════════
// event-brief — Supabase Edge Function (FOH project paoaivwtkzujmrgrfjuq)
// Serves the saved branded Event Brief as its own printable web page, so the
// team can open it from the email and print it for the wall. Token-gated by
// brief_token (separate from the guest client_token — the brief shows internal
// costs/contacts, so it must never be reachable from a guest link).
//
//   GET ?t=<brief_token>  →  the branded brief HTML + a floating Print button.
//
// Deploy with verify_jwt=false (public, token-gated).
// Uses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected secrets).
// ════════════════════════════════════════════════════════════
const cors = { "Access-Control-Allow-Origin": "*" };

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const t = url.searchParams.get("t") || "";
    const page = (body: string, status = 200) =>
      new Response(body, { status, headers: { ...cors, "content-type": "text/html; charset=utf-8" } });

    if (!t) return page("<p style='font-family:Georgia,serif;text-align:center;margin-top:60px'>This link is not valid.</p>", 404);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const r = await fetch(
      supaUrl + "/rest/v1/events_desk?brief_token=eq." + encodeURIComponent(t) + "&select=brief_html&limit=1",
      { headers: { apikey: svc, Authorization: "Bearer " + svc } },
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length || !rows[0].brief_html) {
      return page("<p style='font-family:Georgia,serif;text-align:center;margin-top:60px'>This brief is no longer available.</p>", 404);
    }

    // Return the saved branded brief as-is. The print button is added by the
    // print-brief.html page that renders this (kept here to a single button).
    return page(rows[0].brief_html);
  } catch (e) {
    return new Response("Error: " + String((e as Error)?.message || e).slice(0, 200), { status: 500, headers: cors });
  }
});
