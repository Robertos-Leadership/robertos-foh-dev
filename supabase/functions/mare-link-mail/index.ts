// mare-link-mail — emails a Mare team member their own phone link (8 Oct 2026, Francesco: the kitchen
// team get their login on their own email). Same shape as mare-rq-notify: an ADMIN queues a row in
// mare_link_mail (no grants, no RPC — only the service role or the Management API can), then pg_net
// calls this with {mail: <id>}. A caller can only ask for an already-queued row to be sent, once:
// the row is claimed (queued|failed -> sending) first. The link is the person's own phone_token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = `Roberto's Mare <no-reply@kitchenteam.robertos.ae>`;
// Mare runs on FOH dev only (8 Oct 2026). Change this when it goes live.
const APP = "https://robertos-foh-dev.pages.dev/mare-clock.html";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function build(name: string, link: string) {
  const first = name.trim().split(/\s+/)[0];
  const subject = "Your Roberto's Mare app";
  const paras = [
    `Dear ${first},`,
    "This is your own link to the Roberto's Mare team app:",
    "Open it on your phone. The first time, choose a 4-digit code and type it again; after that the app asks for your code each time. Keep the link and the code to yourself.",
    "Inside you see your rota, today's briefing and the recipes, and under every recipe you can ask the chef a question.",
    "Thanks\nChef Francesco",
  ];
  const text = paras[0] + "\n\n" + paras[1] + "\n" + link + "\n\n" + paras.slice(2).join("\n\n");
  const p = (t: string) => '<p style="margin:0 0 14px">' + esc(t).replace(/\n/g, "<br>") + "</p>";
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1B2426;max-width:560px">' +
    p(paras[0]) + p(paras[1]) +
    '<p style="margin:0 0 18px"><a href="' + esc(link) + '" style="display:inline-block;background:#0E4A50;color:#fff;padding:12px 20px;border-radius:10px;font-weight:bold;text-decoration:none">Open my Mare app</a></p>' +
    '<p style="margin:0 0 14px;font-size:13px;color:#4B5557;word-break:break-all">' + esc(link) + "</p>" +
    paras.slice(2).map(p).join("") + "</div>";
  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }
  const id = Number(body?.mail);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "no mail id" }, 400);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const claim = await sb.from("mare_link_mail").select("*").eq("id", id).maybeSingle();
  if (claim.error || !claim.data) return json({ error: "no such mail" }, 404);
  const m = claim.data;
  if (!(m.status === "queued" || (m.status === "failed" && m.tries < 3))) return json({ ok: true, skipped: m.status });
  const upd = await sb.from("mare_link_mail").update({ status: "sending", tries: m.tries + 1 }).eq("id", id).eq("status", m.status).select("id");
  if (upd.error || !upd.data || !upd.data.length) return json({ ok: true, skipped: "taken" });

  const st = await sb.from("mare_staff").select("name, phone_token, active").eq("id", m.staff_id).maybeSingle();
  if (st.error || !st.data || !st.data.active) {
    await sb.from("mare_link_mail").update({ status: "failed", error: "person not found or not active" }).eq("id", id);
    return json({ error: "person not found" }, 404);
  }
  const mail = build(st.data.name, APP + "?me=" + st.data.phone_token);
  if (m.is_test) mail.subject = "[TEST] " + mail.subject;
  if (!RESEND_API_KEY) {
    await sb.from("mare_link_mail").update({ status: "failed", error: "no RESEND_API_KEY" }).eq("id", id);
    return json({ error: "no key" }, 500);
  }
  let resendId: string | null = null, err = "";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [m.email], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.id) resendId = d.id; else err = (d && (d.message || d.error)) ? String(d.message || d.error) : "HTTP " + r.status;
  } catch (e) { err = String((e as Error).message || e); }
  await sb.from("mare_link_mail").update(resendId ? { status: "sent", resend_id: resendId, sent_at: new Date().toISOString(), error: null }
                                                 : { status: "failed", error: err.slice(0, 500) }).eq("id", id);
  console.log("mare-link-mail", id, resendId ? "sent " + resendId : "FAILED " + err);
  return resendId ? json({ ok: true, id: resendId }) : json({ error: err }, 502);
});
