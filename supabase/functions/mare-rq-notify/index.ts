// mare-rq-notify — mails the chef a team member's recipe question (8 Oct 2026, Andrea Falcone, Tell us 2bf15403).
// Same shape as foh-maint-notify: the DATABASE decides who gets what. mare_s_rq_ask queues a row in
// mare_rq_mail (thread, message, recipients) and calls this through pg_net with {mail: <id>}.
// The app never calls it, so a caller can only ask for an already-queued row to be sent — once:
// the row is claimed (queued|failed -> sending) before anything goes out.
// A test question (is_test) was already addressed to Francesco only; the subject gets [TEST] here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = `Roberto's Mare <no-reply@kitchenteam.robertos.ae>`;
// Mare runs on FOH dev only (8 Oct 2026). Change this when it goes live.
const APP = "https://robertos-foh-dev.pages.dev/mare-answer.html";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const when = (t: string | null) => t ? new Date(t).toLocaleString("en-GB", { timeZone: "Europe/Podgorica", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "";

type Row = Record<string, any>;

function build(q: Row, msgs: Row[], msgId: number) {
  const now = msgs.find((m) => m.id === msgId) || msgs[msgs.length - 1];
  const before = msgs.filter((m) => m.id !== now.id && m.at <= now.at);
  const follow = before.length > 0;
  const kind = q.recipe_kind === "mare" ? "Mare recipe" : q.recipe_kind === "batch" ? "Dubai batch recipe" : "Dubai recipe card";
  const subject = (follow ? "Follow-up on " : "Recipe question: ") + q.recipe_name + " (" + now.author + ")";
  const link = APP + "?q=" + q.answer_token;
  const intro = follow
    ? `${now.author} wrote again about ${q.recipe_name} (${kind}).`
    : `${now.author} has a question about ${q.recipe_name} (${kind}) in the Roberto's Mare app.`;
  const line = (m: Row) => `${m.from_chef ? "You" : m.author}, ${when(m.at)}:\n${m.text}`;
  const text = intro + "\n\n" + now.text + "\n\n" + (follow ? "Earlier in this conversation:\n\n" + before.map(line).join("\n\n") + "\n\n" : "") +
    "Answer here (no password needed): " + link + "\nYour answer shows under the question on the recipe card, for the whole team.\n\nRoberto's Mare app. This is an automated message; please do not reply to the email.";
  const bubble = (m: Row) => '<div style="margin:8px 0;padding:10px 12px;border-radius:10px;background:' + (m.from_chef ? "#e6f1f1" : "#f5efe6") + '">' +
    '<div style="font-size:12px;color:#5f4c3d">' + esc(m.from_chef ? "You" : m.author) + " · " + esc(when(m.at)) + "</div>" + esc(m.text).replace(/\n/g, "<br>") + "</div>";
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1e2a2c;max-width:560px">' +
    '<div style="background:#0E4A50;color:#fff;padding:14px 18px;font-family:Georgia,serif;font-size:21px">' + esc(follow ? "Follow-up · " : "Recipe question · ") + esc(q.recipe_name) + "</div>" +
    '<p style="margin:14px 18px">' + esc(intro) + "</p>" +
    '<div style="margin:0 18px;padding:12px 14px;border-left:4px solid #0E4A50;background:#f7f4ee;font-size:16px">' + esc(now.text).replace(/\n/g, "<br>") + "</div>" +
    (follow ? '<p style="margin:16px 18px 4px;font-size:13px;color:#5f4c3d">Earlier in this conversation</p><div style="margin:0 18px">' + before.map(bubble).join("") + "</div>" : "") +
    '<p style="margin:18px"><a href="' + esc(link) + '" style="display:inline-block;background:#0E4A50;color:#fff;padding:11px 18px;border-radius:10px;font-weight:bold;text-decoration:none">Answer here</a></p>' +
    '<p style="margin:0 18px;font-size:13px;color:#5f4c3d">No password needed. Your answer shows under the question on the recipe card, for the whole team.</p>' +
    '<p style="margin:18px;font-size:12px;color:#5f4c3d">Roberto\'s Mare app. This is an automated message; please do not reply to the email.</p></div>';
  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }
  const id = Number(body?.mail);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "no mail id" }, 400);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const claim = await sb.from("mare_rq_mail").select("*").eq("id", id).maybeSingle();
  if (claim.error || !claim.data) return json({ error: "no such mail" }, 404);
  const m = claim.data;
  if (!(m.status === "queued" || (m.status === "failed" && m.tries < 3))) return json({ ok: true, skipped: m.status });
  const upd = await sb.from("mare_rq_mail").update({ status: "sending", tries: m.tries + 1 }).eq("id", id).eq("status", m.status).select("id");
  if (upd.error || !upd.data || !upd.data.length) return json({ ok: true, skipped: "taken" });

  const q = await sb.from("mare_rq").select("*").eq("id", m.q_id).maybeSingle();
  const msgs = await sb.from("mare_rq_msgs").select("*").eq("q_id", m.q_id).order("at").order("id");
  if (q.error || !q.data || msgs.error || !msgs.data || !msgs.data.length) {
    await sb.from("mare_rq_mail").update({ status: "failed", error: "thread not found" }).eq("id", id);
    return json({ error: "thread not found" }, 404);
  }
  const mail = build(q.data, msgs.data, m.msg_id);
  if (m.is_test) mail.subject = "[TEST] " + mail.subject;
  if (!RESEND_API_KEY) {
    await sb.from("mare_rq_mail").update({ status: "failed", error: "no RESEND_API_KEY" }).eq("id", id);
    return json({ error: "no key" }, 500);
  }
  let resendId: string | null = null, err = "";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: m.to_list, subject: mail.subject, text: mail.text, html: mail.html }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.id) resendId = d.id; else err = (d && (d.message || d.error)) ? String(d.message || d.error) : "HTTP " + r.status;
  } catch (e) { err = String((e as Error).message || e); }
  await sb.from("mare_rq_mail").update(resendId ? { status: "sent", resend_id: resendId, sent_at: new Date().toISOString(), error: null }
                                               : { status: "failed", error: err.slice(0, 500) }).eq("id", id);
  console.log("mare-rq-notify", id, resendId ? "sent " + resendId : "FAILED " + err);
  return resendId ? json({ ok: true, id: resendId }) : json({ error: err }, 502);
});
