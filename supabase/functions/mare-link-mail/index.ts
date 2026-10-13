// mare-link-mail — emails a Mare team member their own phone link (8 Oct 2026, Francesco: the kitchen
// team get their login on their own email). Same shape as mare-rq-notify: an ADMIN queues a row in
// mare_link_mail (no grants, no RPC — only the service role or the Management API can), then pg_net
// calls this with {mail: <id>}. A caller can only ask for an already-queued row to be sent, once:
// the row is claimed (queued|failed -> sending) first. The link is the person's own phone_token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = `Roberto's Mare <no-reply@kitchenteam.robertos.ae>`;
// Mare runs on FOH dev only (8 Oct 2026). Change this when it goes live.
const APP = "https://robertos-leadership.github.io/robertos-foh/mare-clock.html";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// Wording agreed with Francesco on 12 Oct 2026: what the Kitchen team actually has (Schedule,
// Recipes, Report, Learning). canRota = the person who fills the schedule (Vinay).
function build(name: string, link: string, canRota: boolean) {
  const first = name.trim().split(/\s+/)[0];
  const subject = "Your Roberto's Mare app";
  const head = [
    `Dear ${first},`,
    "This is your own link to the Roberto's Mare team app. Open it on your phone:",
  ];
  const first_time = "The first time, choose a 4-digit code and type it again. After that the app asks for your code each time. Keep the link and the code to yourself.";
  const items: [string, string][] = [
    ["Schedule", canRota ? "the kitchen schedule for the week. You are the one who fills it; everyone else can see it."
                         : "the kitchen schedule for the week. Vinay fills it; everyone can see it."],
    ["Recipes", "the Roberto's Dubai recipe cards, under \"From Dubai\". Tap a dish to open it. Tap a batch recipe line to open that recipe. Tap the photo to see the plate bigger. Use Previous and Next to move to another dish. If something is not clear, write your question under the recipe: it goes to Chef Andrea and the answer comes back on the same card within 24 hours."],
    ["Report", "the closing report, at the end of every service. Write the guests served and the total revenue, answer the three questions and press Send. It comes to me and Chef Andrea."],
    ["Learning", "under \"More\". Read the topics, then take the test: 20 questions, you pass with 80%."],
  ];
  const tail = [
    "You can change the language at the top: EN or ME.",
    "Please open it today and tell me if something does not work.",
    "Thanks\nChef Francesco",
  ];
  const text = head[0] + "\n\n" + head[1] + "\n" + link + "\n\n" + first_time + "\n\nInside you find:\n\n" +
    items.map((i) => i[0] + " - " + i[1]).join("\n\n") + "\n\n" + tail.join("\n\n");
  const p = (t: string) => '<p style="margin:0 0 14px">' + esc(t).replace(/\n/g, "<br>") + "</p>";
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1B2426;max-width:560px">' +
    p(head[0]) + p(head[1]) +
    '<p style="margin:0 0 18px"><a href="' + esc(link) + '" style="display:inline-block;background:#0E4A50;color:#fff;padding:12px 20px;border-radius:10px;font-weight:bold;text-decoration:none">Open my Mare app</a></p>' +
    '<p style="margin:0 0 14px;font-size:13px;color:#4B5557;word-break:break-all">' + esc(link) + "</p>" +
    p(first_time) + p("Inside you find:") +
    items.map((i) => '<p style="margin:0 0 14px"><b>' + esc(i[0]) + "</b> &ndash; " + esc(i[1]) + "</p>").join("") +
    tail.map(p).join("") + "</div>";
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

  const st = await sb.from("mare_staff").select("name, phone_token, active, can_rota").eq("id", m.staff_id).maybeSingle();
  if (st.error || !st.data || !st.data.active) {
    await sb.from("mare_link_mail").update({ status: "failed", error: "person not found or not active" }).eq("id", id);
    return json({ error: "person not found" }, 404);
  }
  const mail = build(st.data.name, APP + "?me=" + st.data.phone_token, !!st.data.can_rota);
  // Copy (Francesco, 12 Oct 2026: "copying myself and chef Andrea"): mare_settings link_mail_cc.
  // A test mail copies no one.
  let cc: string[] = [];
  if (!m.is_test) {
    const cs = await sb.from("mare_settings").select("value").eq("key", "link_mail_cc").maybeSingle();
    if (Array.isArray(cs.data?.value)) cc = cs.data!.value.filter((x: unknown) => typeof x === "string" && /^[^@\s]+@[^@\s]+$/.test(x as string) && (x as string).toLowerCase() !== String(m.email).toLowerCase());
  }
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
      body: JSON.stringify({ from: FROM, to: [m.email], ...(cc.length ? { cc } : {}), subject: mail.subject, text: mail.text, html: mail.html }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.id) resendId = d.id; else err = (d && (d.message || d.error)) ? String(d.message || d.error) : "HTTP " + r.status;
  } catch (e) { err = String((e as Error).message || e); }
  await sb.from("mare_link_mail").update(resendId ? { status: "sent", resend_id: resendId, sent_at: new Date().toISOString(), error: null }
                                                 : { status: "failed", error: err.slice(0, 500) }).eq("id", id);
  console.log("mare-link-mail", id, resendId ? "sent " + resendId : "FAILED " + err);
  return resendId ? json({ ok: true, id: resendId }) : json({ error: err }, 502);
});
