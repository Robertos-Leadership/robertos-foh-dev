// mare-kreport-notify — mails the Mare kitchen closing report (9 Oct 2026). Francesco: the Mare chefs
// send him a closing report. Laid out as the Dubai Kitchen closing report email: Complaints, 86,
// Operation issues, Team issues, General feedback.
// Same shape as mare-rq-notify: mare_s_kreport_save queues a row in mare_kreport_mail (recipients
// chosen by the DATABASE, mare_settings 'kitchen_report_to') and calls this through pg_net with
// {mail: <id>}. A caller can only ask for an already-queued row to be sent, once.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "Roberto's Mare <no-reply@kitchenteam.robertos.ae>";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
// The team answers three yes/no questions (9 Oct 2026, "easy to fill, not too complicated").
const SECTIONS: [string, string, string][] = [
  ["unavailable", "Ran out", "Nothing ran out"],
  ["complaint", "Guest complaints", "No complaints"],
  ["operation", "Problems (equipment, deliveries, team)", "No problems"],
];
const FACES = ["😖", "😕", "😐", "🙂", "🔥"];
type Row = Record<string, any>;

function build(k: Row, resend: boolean) {
  const day = new Date(k.date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const ents: Row[] = Array.isArray(k.entries) ? k.entries : [];
  const n = (t: string) => ents.filter((e) => e.type === t).length;
  const subject = (resend ? "Updated: " : "") + "Mare kitchen closing report · " + day +
    (ents.length ? " · " + SECTIONS.filter((x) => n(x[0])).map((x) => x[1].split(" (")[0].toLowerCase()).join(", ") : " · all good");
  const rows: [string, string][] = [
    ["Service", k.rating ? FACES[k.rating - 1] + " (" + k.rating + "/5)" : "—"],
    ["Chefs on duty", (k.chefs_on || []).join(", ") || "—"],
    ["Report by", k.sent_by || k.written_by || "—"],
  ];
  const sec = (title: string, inner: string) => '<h3 style="font-family:Georgia,serif;color:#0E4A50;margin:18px 0 6px;font-size:16px">' + esc(title) + "</h3>" + inner;
  const list = (t: string, empty: string) => {
    const l = ents.filter((e) => e.type === t);
    if (!l.length) return '<p style="margin:2px 0;color:#285C36;font-size:14px">✓ ' + esc(empty) + "</p>";
    return l.map((e) => '<p style="margin:4px 0;font-size:14px;color:#1B2426">' + (e.category ? "<strong>[" + esc(e.category) + "]</strong> " : "") +
      (e.item ? "<em>" + esc(e.item) + "</em>" + (e.detail ? " — " : "") : "") + esc(e.detail || "").replace(/\n/g, "<br>") +
      (e.action ? '<br><span style="color:#4B5557;font-size:13px">Action: ' + esc(e.action) + "</span>" : "") + "</p>").join("");
  };
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;background:#F6F1EA;padding:24px;border-radius:12px">' +
    '<h2 style="font-family:Georgia,serif;color:#0E4A50;margin:0 0 2px">Roberto\'s Mare · Kitchen closing report</h2>' +
    '<p style="margin:0 0 14px;color:#A8834B;font-size:14px">' + esc(day) + (resend ? " · updated" : "") + "</p>" +
    '<table style="width:100%;font-size:14px;color:#1B2426;border-collapse:collapse">' +
    rows.map((r) => '<tr><td style="padding:3px 0;width:150px;color:#0E4A50"><strong>' + esc(r[0]) + "</strong></td><td>" + esc(r[1]) + "</td></tr>").join("") + "</table>" +
    SECTIONS.map((s) => sec(s[1], list(s[0], s[2]))).join("") +
    (k.feedback ? sec("General feedback", '<p style="margin:2px 0;font-size:14px;white-space:pre-wrap">' + esc(k.feedback) + "</p>") : "") +
    '<p style="margin-top:20px;font-size:11px;color:#4B5557">Sent from the Roberto\'s Mare app. Please do not reply to this email.</p></div>';
  const text = "Roberto's Mare · Kitchen closing report\n" + day + (resend ? " (updated)" : "") + "\n\n" +
    rows.map((r) => r[0] + ": " + r[1]).join("\n") + "\n\n" +
    SECTIONS.map((s) => {
      const l = ents.filter((e) => e.type === s[0]);
      return s[1].toUpperCase() + "\n" + (l.length ? l.map((e) => "- " + (e.category ? "[" + e.category + "] " : "") + (e.item ? e.item + (e.detail ? " — " : "") : "") + (e.detail || "") + (e.action ? " (Action: " + e.action + ")" : "")).join("\n") : "✓ " + s[2]);
    }).join("\n\n") + (k.feedback ? "\n\nGENERAL FEEDBACK\n" + k.feedback : "") + "\n\nSent from the Roberto's Mare app.";
  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }
  const id = Number(body?.mail);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "no mail id" }, 400);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const claim = await sb.from("mare_kreport_mail").select("*").eq("id", id).maybeSingle();
  if (claim.error || !claim.data) return json({ error: "no such mail" }, 404);
  const m = claim.data;
  if (!(m.status === "queued" || (m.status === "failed" && m.tries < 3))) return json({ ok: true, skipped: m.status });
  const upd = await sb.from("mare_kreport_mail").update({ status: "sending", tries: m.tries + 1 }).eq("id", id).eq("status", m.status).select("id");
  if (upd.error || !upd.data || !upd.data.length) return json({ ok: true, skipped: "taken" });

  const k = await sb.from("mare_kreport").select("*").eq("date", m.date).maybeSingle();
  if (k.error || !k.data) {
    await sb.from("mare_kreport_mail").update({ status: "failed", error: "report not found" }).eq("id", id);
    return json({ error: "report not found" }, 404);
  }
  const mail = build(k.data, !!m.resend);
  if (m.is_test) mail.subject = "[TEST] " + mail.subject;
  if (!RESEND_API_KEY) {
    await sb.from("mare_kreport_mail").update({ status: "failed", error: "no RESEND_API_KEY" }).eq("id", id);
    return json({ error: "no key" }, 500);
  }
  let resendId: string | null = null, err = "";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: m.to_list, subject: mail.subject, text: mail.text, html: mail.html }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.id) resendId = d.id; else err = (d && (d.message || d.error)) ? String(d.message || d.error) : "HTTP " + r.status;
  } catch (e) { err = String((e as Error).message || e); }
  await sb.from("mare_kreport_mail").update(resendId ? { status: "sent", resend_id: resendId, sent_at: new Date().toISOString(), error: null }
                                                    : { status: "failed", error: err.slice(0, 500) }).eq("id", id);
  console.log("mare-kreport-notify", id, resendId ? "sent " + resendId : "FAILED " + err);
  return resendId ? json({ ok: true, id: resendId }) : json({ error: err }, 502);
});
