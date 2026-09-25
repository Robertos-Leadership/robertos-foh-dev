// ════════════════════════════════════════════════════════════════════════════
//  resend-events — the delivery audit trail
//
//  Built 20 Aug 2026, out of the incident that made it necessary. On 19 Aug a
//  single spurious Microsoft bounce put one address on Resend's suppression
//  list. Because Resend suppression is per-MESSAGE, the Daily Closing Report
//  then reached NOBODY for two nights — while the app showed a tick and the
//  logs showed 200. Nothing in the system recorded whether an email had ever
//  arrived, so it took forensics to find, two days late.
//
//  Francesco's standard is reliability and accountability. We cannot stop mail
//  failing. We CAN stop it failing silently. That is what this does:
//
//    every delivered / bounced / complained event  ->  email_events table
//    the FIRST bounce or complaint                 ->  an email to the admins
//
//  So a bad address is known the first night, by name, with Microsoft's own
//  words attached — instead of being discovered when somebody notices months
//  of missing reports.
//
//  verify_jwt is FALSE — Resend cannot present a Supabase JWT. The gate is the
//  Svix signature, checked before anything is read or written, exactly as in
//  event-enquiry-inbound. An unsigned, stale or replayed POST dies at the door.
//
//  Secret: RESEND_EVENTS_SECRET — the signing secret of THIS webhook endpoint.
//  It is not the same value as RESEND_WEBHOOK_SECRET; Resend issues one secret
//  per endpoint, and the inbound-enquiry endpoint has its own.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FROM = "Roberto's DIFC Operations <reports@kitchenteam.robertos.ae>";

// Events worth waking somebody for. A bounce or a complaint means mail to that
// person is about to stop entirely — Resend suppresses the address after it.
const ALARMING = new Set(["email.bounced", "email.complained"]);

// ── Svix signature ──────────────────────────────────────────────────────────
// base64(HMAC-SHA256(secret, "<id>.<timestamp>.<body>")). The header may carry
// several space-separated "v1,<sig>" values during a secret rotation, so any
// one matching is a pass. Timestamp older than 5 minutes is refused — that is
// what stops a captured delivery being replayed later.
async function svixOk(raw: string, h: Headers, secret: string): Promise<boolean> {
  const id = h.get("svix-id"), ts = h.get("svix-timestamp"), sigs = h.get("svix-signature");
  if (!id || !ts || !sigs || !secret) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!isFinite(age) || age > 300) return false;

  const b64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const mine = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Constant-time-ish compare, so a wrong signature can't be narrowed by timing.
  for (const part of sigs.split(" ")) {
    const theirs = part.split(",")[1] || "";
    if (theirs.length === mine.length) {
      let diff = 0;
      for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ theirs.charCodeAt(i);
      if (diff === 0) return true;
    }
  }
  return false;
}

// Plain language, because the person reading it at 2am should not have to
// decode a bounce code to know what to do.
function alarmHtml(kind: string, who: string[], subject: string, why: string) {
  const bounced = kind === "email.bounced";
  return (
    `<p><b>${who.join(", ")}</b> did not receive an email from the app just now.</p>` +
    (subject ? `<p>The email was: <i>${subject}</i></p>` : "") +
    (why ? `<p>The mail server said:<br><code>${why}</code></p>` : "") +
    (bounced
      ? `<p><b>What happens next if nothing is done:</b> the email provider will now block that address, ` +
        `and because one blocked address used to drop the message for everyone, that is exactly how the ` +
        `closing report went missing for two nights in August. Each person now gets their own copy, so ` +
        `the rest of the team is unaffected — but that one person will keep receiving nothing.</p>`
      : `<p>They marked it as spam, so the provider will stop delivering to them.</p>`) +
    `<p><b>What to do:</b> check the address is right and that the person's mailbox is working. ` +
    `Then remove them from the blocked list at <a href="https://resend.com/settings/suppression-list">resend.com</a> ` +
    `and send a test to confirm it arrives. Only if that test fails again is there anything for IT to look at.</p>`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const raw = await req.text();

  // The gate. Nothing is parsed or written above this line.
  if (!(await svixOk(raw, req.headers, Deno.env.get("RESEND_EVENTS_SECRET") || ""))) {
    return json({ error: "bad signature" }, 401);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const hook = JSON.parse(raw);
    const type = String(hook?.type || "");
    const d = hook?.data || {};
    const recipients: string[] = Array.isArray(d.to) ? d.to : (d.to ? [String(d.to)] : []);

    // Resend retries on any non-2xx, so the same event can arrive more than
    // once. svix-id is unique per delivery attempt of a given event, and the
    // unique index makes the second insert a no-op rather than a duplicate row.
    const row = {
      svix_id: req.headers.get("svix-id"),
      event_type: type,
      email_id: typeof d.email_id === "string" ? d.email_id : (typeof d.id === "string" ? d.id : null),
      recipients,
      subject: d.subject ?? null,
      bounce_type: d?.bounce?.type ?? null,
      bounce_message: d?.bounce?.message ?? (Array.isArray(d?.bounce?.diagnosticCode) ? d.bounce.diagnosticCode.join(" | ") : null),
      occurred_at: hook?.created_at ?? null,
      raw: hook,
    };

    const ins = await sb.from("email_events").insert(row).select("id").maybeSingle();
    // 23505 = the unique index doing its job on a retry. Anything else is real.
    if (ins.error && ins.error.code !== "23505") {
      // 500 makes Resend retry — losing a delivery record is the one outcome
      // worth retrying for, since the whole point here is a complete ledger.
      return json({ ok: false, error: ins.error.message }, 500);
    }
    const duplicate = !!ins.error;

    // ── the alarm ───────────────────────────────────────────────────────────
    // Only on a first-time bounce or complaint, and never allowed to fail the
    // webhook: the ledger row is already safe by this point.
    let alerted = 0;
    if (!duplicate && ALARMING.has(type)) {
      try {
        const { data } = await sb.from("app_users").select("email").eq("is_admin", true);
        const to = (data || []).map((r: { email: string }) => r.email).filter(Boolean);
        if (to.length) {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + Deno.env.get("RESEND_API_KEY"),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: FROM,
              to,
              subject: `⚠ Email not delivered — ${recipients.join(", ") || "unknown recipient"}`,
              html: alarmHtml(type, recipients, String(d.subject || ""), String(row.bounce_message || "")),
            }),
          });
          if (r.ok) alerted = to.length;
        }
      } catch (_) { /* the ledger row matters more than the alarm */ }
    }

    return json({ ok: true, type, duplicate, alerted });
  } catch (err) {
    return json({ ok: false, error: String(err).slice(0, 300) }, 500);
  }
});
