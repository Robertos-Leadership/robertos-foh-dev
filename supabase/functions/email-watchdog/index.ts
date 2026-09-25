// ════════════════════════════════════════════════════════════════════════════
//  email-watchdog — catches the failure that makes no noise
//
//  Built 20 Aug 2026, the last piece of the incident that started it. A bounce
//  is loud: Resend fires email.bounced and resend-events alarms within seconds.
//  A SUPPRESSED address is the opposite — measured, not assumed, on 20 Aug:
//
//      POST /emails  ->  200, with an id that looks exactly like success
//      webhook       ->  NOTHING. Not delivered, not bounced, not even sent.
//
//  Silence is the whole signal. You cannot alarm on an event that never comes,
//  so the senders now record what they ASKED FOR as an `app.submitted` row, and
//  this reconciles intent against reality: any submitted id that has produced
//  no event at all after a grace period was never really sent, and somebody is
//  quietly receiving nothing. That is precisely how the Daily Closing Report
//  went missing for two nights without a single thing looking wrong.
//
//  Runs on pg_cron. Idempotent: every row it reports is stamped alerted_at, so
//  a recurring problem is raised once, not every quarter of an hour.
//
//  ?minutes=N  overrides the grace period (default 15) — used to test without
//              waiting. ?dry=1 reports without alerting or stamping.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FROM = "Roberto's DIFC Operations <reports@kitchenteam.robertos.ae>";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type Row = {
  id: number;
  email_id: string | null;
  recipients: string[] | null;
  subject: string | null;
  received_at: string;
};

const dubai = (iso: string) =>
  new Date(new Date(iso).getTime() + 4 * 3600 * 1000)
    .toISOString().replace("T", " ").slice(0, 16);

function alarmHtml(rows: Row[], minutes: number) {
  const items = rows.map((r) => {
    const who = (r.recipients || []).join(", ") || "unknown recipient";
    return `<li><b>${who}</b>${r.subject ? ` — <i>${r.subject}</i>` : ""}<br>` +
           `<span style="color:#666">sent ${dubai(r.received_at)} Dubai</span></li>`;
  }).join("");
  const people = [...new Set(rows.flatMap((r) => r.recipients || []))];
  return (
    `<p>The app sent ${rows.length} email(s) more than ${minutes} minutes ago and the email provider ` +
    `has <b>never confirmed what happened to them</b> — not delivered, not bounced, nothing at all.</p>` +
    `<ul>${items}</ul>` +
    `<p><b>What this almost always means:</b> the address is on the provider's blocked list. ` +
    `A blocked address is accepted and then silently thrown away, which is why nothing looks wrong ` +
    `anywhere — the app shows a tick and the logs show success. It is exactly how the closing report ` +
    `reached nobody for two nights in August before anyone noticed.</p>` +
    `<p><b>What to do:</b> open <a href="https://resend.com/settings/suppression-list">the blocked list</a> ` +
    `and look for ${people.map((p) => `<code>${p}</code>`).join(", ")}. Remove the address, then send a test ` +
    `and check it arrives. Only if that test bounces again is there anything for IT to look at.</p>`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const url = new URL(req.url);
    const minutes = Math.max(0, Number(url.searchParams.get("minutes") ?? 15) || 0);
    const dry = url.searchParams.get("dry") === "1";

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

    // Submitted, old enough to have been confirmed, never alerted on.
    const { data: pending, error } = await sb
      .from("email_events")
      .select("id, email_id, recipients, subject, received_at")
      .eq("event_type", "app.submitted")
      .is("alerted_at", null)
      .lt("received_at", cutoff)
      .order("received_at")
      .limit(200);
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!pending?.length) return json({ ok: true, checked: 0, silent: 0 });

    // Which of those ids has the provider said ANYTHING about?
    const ids = pending.map((r: Row) => r.email_id).filter(Boolean) as string[];
    const heard = new Set<string>();
    if (ids.length) {
      const { data: ev } = await sb
        .from("email_events")
        .select("email_id")
        .neq("event_type", "app.submitted")
        .in("email_id", ids);
      for (const e of ev || []) if (e.email_id) heard.add(e.email_id);
    }

    // Silence = an id we recorded sending, that produced no event whatsoever.
    // A row with no id at all cannot be reconciled, so it is left alone rather
    // than reported as a false alarm.
    const silent = (pending as Row[]).filter((r) => r.email_id && !heard.has(r.email_id));

    if (dry) return json({ ok: true, dry: true, checked: pending.length, silent: silent.length, rows: silent });
    if (!silent.length) return json({ ok: true, checked: pending.length, silent: 0 });

    // Stamp FIRST. If the alarm send fails we would rather miss one warning
    // than send the same warning every fifteen minutes forever.
    await sb.from("email_events").update({ alerted_at: new Date().toISOString() })
      .in("id", silent.map((r) => r.id));

    let alerted = 0;
    try {
      const { data: admins } = await sb.from("app_users").select("email").eq("is_admin", true);
      const to = (admins || []).map((r: { email: string }) => r.email).filter(Boolean);
      if (to.length) {
        const people = [...new Set(silent.flatMap((r) => r.recipients || []))];
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + Deno.env.get("RESEND_API_KEY"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM,
            to,
            subject: `⚠ ${people.length} address(es) are receiving nothing — ${people.join(", ").slice(0, 90)}`,
            html: alarmHtml(silent, minutes),
          }),
        });
        if (r.ok) alerted = to.length;
      }
    } catch (_) { /* the stamp is already safe */ }

    return json({ ok: true, checked: pending.length, silent: silent.length, alerted,
                  addresses: [...new Set(silent.flatMap((r) => r.recipients || []))] });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
