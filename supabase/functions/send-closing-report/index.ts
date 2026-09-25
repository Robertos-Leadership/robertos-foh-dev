// ════════════════════════════════════════════════════════════
// send-closing-report — Supabase Edge Function (Leadership Hub project)
// Emails the Daily Closing Report via Resend. Recipients come from the
// app_users table (anyone with 'closing_report' in their notify list), managed
// from the app's Admin screen. Falls back to the fixed list if none are set,
// so the email never goes to nobody.
//
// ── v16, 20 Aug 2026 — one message PER RECIPIENT ────────────────────────────
// On 19 Aug 2026 the whole report silently reached NOBODY for two nights.
// One recipient had been put on Resend's suppression list by a single spurious
// Microsoft bounce, and Resend suppression is per-MESSAGE, not per-recipient:
// one blocked address drops the message for everyone else on it. The API still
// answered 200, so the app showed a tick and the logs looked clean.
//
// So the report is now sent as one independent message per recipient through
// Resend's batch endpoint — a single call, but a blocked or bad address can
// only ever cost that one person. If the batch endpoint is unavailable we fall
// back to the old single send rather than sending nothing, so this change can
// never make a night worse than it already was.
//
// It also reports which recipients are blocked and tells the admins, because
// the original failure was invisible from every angle: green tick, 200 in the
// logs, nothing delivered. That reporting needs a Resend key with read access
// to the suppression list; with a sending-only key it degrades quietly and the
// sending itself is unaffected.
//
// Deploy:  supabase functions deploy send-closing-report --project-ref paoaivwtkzujmrgrfjuq
// Secret:  RESEND_API_KEY (already set). SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-provided.
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FROM = "Roberto's DIFC Operations <reports@kitchenteam.robertos.ae>";   // verified Resend domain
// Fallback recipients (used only if nobody is ticked for closing_report in app_users)
const FALLBACK_TO = [
  "fguarracino@robertos.ae", "asacchi@skelmore.com", "justin@skelmore.com",
  "musti@robertos.ae", "umavila@skelmore.com",
  "kvukotic@robertos.ae",
  "dvalla@robertos.ae", "jthomas@robertos.ae",
];

const RESEND = "https://api.resend.com";
const BATCH_MAX = 100;   // Resend's cap on one batch call

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Write to the delivery ledger. Best-effort and always last: a ledger failure
// must never cost us a report that has already gone out.
async function ledger(rows: Record<string, unknown>[]) {
  try {
    if (!rows.length) return;
    await admin().from("email_events").insert(rows);
  } catch { /* the report matters more than the bookkeeping */ }
}

// Addresses Resend is silently dropping. Best-effort and REPORTING ONLY — it
// never decides who gets sent to, so a key without permission to read this
// (or an outage here) cannot stop the report going out. null = "couldn't tell".
async function blockedAddresses(key: string): Promise<Set<string> | null> {
  try {
    const r = await fetch(RESEND + "/suppressions", { headers: { Authorization: "Bearer " + key } });
    if (!r.ok) return null;                       // sending-only key answers 401/403 here
    const d = await r.json();
    if (!Array.isArray(d?.data)) return null;
    const out = new Set<string>();
    for (const e of d.data) if (e?.email) out.add(String(e.email).trim().toLowerCase());
    return out;
  } catch { return null; }
}

// Tell whoever administers the app that someone is being dropped, so this can
// never again be invisible. Wrapped whole: a failure here must not affect the
// report, which has already been sent by the time we get here.
async function warnAdmins(key: string, blocked: string[], suppressed: Set<string>) {
  try {
    const { data } = await admin().from("app_users").select("email").eq("is_admin", true);
    const to = (data || [])
      .map((r: { email: string }) => r.email)
      .filter((e: string) => e && !suppressed.has(String(e).trim().toLowerCase()));
    if (!to.length) return;
    const rows = blocked.map((b) => `<li><code>${b}</code></li>`).join("");
    await fetch(RESEND + "/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to,
        subject: `Closing report — ${blocked.length} recipient(s) did not receive it`,
        html:
          `<p>Tonight's Daily Closing Report went out, but these recipients did <b>not</b> receive it:</p>` +
          `<ul>${rows}</ul>` +
          `<p>Their address is on the email provider's blocked list, usually after one bounce. ` +
          `Everyone else got the report normally — since 20 Aug 2026 each recipient is sent their own copy, ` +
          `so a blocked address no longer stops anyone else's.</p>` +
          `<p>To clear it: remove the address from the suppression list at ` +
          `<a href="https://resend.com/settings/suppression-list">resend.com</a>, then send a test to check it delivers. ` +
          `Only if that test bounces again is there anything for IT to look at.</p>`,
      }),
    });
  } catch { /* never let the warning break the report */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "RESEND_API_KEY secret not set" }, 500);

    const body = await req.json();
    const subject = body.subject || "Roberto's DIFC — Daily Closing Report";
    const html = body.html;
    if (!html) return json({ error: "No html provided" }, 400);

    // Optional explicit recipient(s) — e.g. a one-off test send to a single person.
    // When present, these win and we skip the app_users lookup entirely, so a test
    // never reaches the whole team.
    const overrideTo: string[] = Array.isArray(body.to)
      ? body.to.filter((x: unknown): x is string => typeof x === "string" && x.includes("@"))
      : [];

    // Recipients = everyone ticked for the closing-report email in app_users.
    let to: string[] = FALLBACK_TO;
    if (overrideTo.length) {
      to = overrideTo;
    } else try {
      const { data } = await admin().from("app_users").select("email").contains("notify", ["closing_report"]);
      const emails = (data || []).map((r: { email: string }) => r.email).filter(Boolean);
      if (emails.length) to = emails;
    } catch (_) { /* keep fallback */ }

    // De-duplicate: the same address twice would send that person two copies.
    to = [...new Set(to.map((e) => String(e).trim()).filter(Boolean))].slice(0, BATCH_MAX);
    if (!to.length) return json({ error: "No recipients" }, 400);

    const auth = { Authorization: "Bearer " + key, "Content-Type": "application/json" };

    // ── The send. One independent message per recipient. ─────────────────────
    let r = await fetch(RESEND + "/emails/batch", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(to.map((addr) => ({ from: FROM, to: [addr], subject, html }))),
    });
    let data = await r.json();
    let mode = "batch";

    // Safety net: if batch is unavailable, send the old way rather than nothing.
    if (!r.ok) {
      mode = "single";
      r = await fetch(RESEND + "/emails", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ from: FROM, to, subject, html }),
      });
      data = await r.json();
    }
    // Still failing = a real failure. Keep answering 502 so the app alerts and
    // nobody is told the report went out when it did not.
    if (!r.ok) return json({ error: data?.message || ("Resend HTTP " + r.status), mode }, 502);

    const sent = Array.isArray(data?.data) ? data.data.length : 1;

    // ── The intent ledger. ───────────────────────────────────────────────────
    // Records WHAT WE ASKED FOR, against which the delivery events are later
    // reconciled. This is the only way a silently suppressed address can ever
    // be noticed: Resend answers 200 with an id and then emits no event at all
    // — not even email.sent — so the absence of an event is the only signal
    // there is, and absence can only be measured against a recorded intent.
    await ledger(
      mode === "batch" && Array.isArray(data?.data)
        ? data.data.map((d: { id?: string }, i: number) =>
            ({ event_type: "app.submitted", email_id: d?.id ?? null, recipients: [to[i]], subject }))
        : [{ event_type: "app.submitted", email_id: data?.id ?? null, recipients: to, subject }],
    );

    // ── Reporting only, after the report is safely away. ─────────────────────
    let blocked: string[] = [];
    const suppressed = await blockedAddresses(key);
    if (suppressed) {
      blocked = to.filter((e) => suppressed.has(e.toLowerCase()));
      if (blocked.length) await warnAdmins(key, blocked, suppressed);
    }

    return json({
      ok: true,
      mode,
      sent,
      recipients: to.length,
      blocked,
      // null = the key cannot read the suppression list, so "blocked" is not conclusive
      blocked_known: suppressed !== null,
      id: mode === "single" ? data?.id : undefined,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
