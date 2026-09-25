// ════════════════════════════════════════════════════════════
// send-stock-take — Supabase Edge Function (FOH / Leadership Hub project)
// Emails the monthly Stock Take (Beverage / Tobacco) to the cost controller +
// team via Resend. Key stays server-side. Recipients (to + cc) are passed from
// the app so Beverage and Tobacco can share one function, and an optional Excel
// attachment ([{ filename, content }] base64) is forwarded to Resend.
//
// ── v11, 20 Aug 2026 — one message PER RECIPIENT ────────────────────────────
// Same defect that took the Daily Closing Report off every inbox for two nights
// on 19 Aug 2026: Resend suppression is per-MESSAGE, not per-recipient, so one
// blocked address silently drops the mail for EVERYONE on it while the API
// still answers 200. The closing report was fixed by sending each recipient
// their own copy; this does the same, but with an ordinary loop rather than the
// batch endpoint, because batch supports neither attachments nor Cc and this
// email carries the .xlsx.
//
// Consequence, deliberate: everyone is now a direct recipient, so the old
// To-vs-Cc distinction is gone — an internal report where the alternative is
// the whole thing silently reaching nobody. Each send is independent, so one
// bad address costs one person and the rest still get the stock take.
//
// It reports every per-recipient failure instead of swallowing it, and answers
// 502 only when NOBODY could be reached, so the app can never say "sent" when
// nothing was.
//
// Deploy:  supabase functions deploy send-stock-take --project-ref paoaivwtkzujmrgrfjuq
// Secret:  RESEND_API_KEY (already set for send-closing-report — same project, reused.)
//
// FROM must be on a domain VERIFIED in your Resend account (kitchenteam.robertos.ae).
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FROM = "Roberto's DIFC FOH <reports@kitchenteam.robertos.ae>";   // verified Resend domain

// Write to the delivery ledger — what we ASKED FOR, so the watchdog can later
// notice an id that never produced a single delivery event. A silently
// suppressed address emits nothing at all, so absence-against-intent is the
// only signal that exists. Best-effort: never costs a send that already went.
async function ledger(rows: Record<string, unknown>[]) {
  try {
    if (!rows.length) return;
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await sb.from("email_events").insert(rows);
  } catch { /* the stock take matters more than the bookkeeping */ }
}

// Defaults if the app sends nothing (Beverage/Tobacco to Aung; plus Asarudeen; Manuel and Jad removed when they left).
const DEFAULT_TO = ["ahtwe@robertos.ae"];
const DEFAULT_CC = ["amohamed@robertos.ae"];

const RESEND = "https://api.resend.com/emails";
const MAX_RECIPIENTS = 40;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One send, with a single retry on Resend's rate limit (default 2 req/sec).
async function sendOne(key: string, payload: Record<string, unknown>) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(RESEND, {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, id: data?.id };
    if (r.status === 429 && attempt === 0) { await sleep(1100); continue; }   // rate limited — wait a beat
    return { ok: false, error: data?.message || ("Resend HTTP " + r.status) };
  }
  return { ok: false, error: "rate limited" };
}

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

    // Everyone who should receive it, de-duplicated so nobody gets two copies.
    const recipients = [...new Set(
      [...toList, ...ccList]
        .filter((x: unknown) => typeof x === "string" && String(x).includes("@"))
        .map((x: string) => String(x).trim()),
    )].slice(0, MAX_RECIPIENTS);
    if (!recipients.length) return json({ error: "No recipients" }, 400);

    // One independent message each — a blocked or bad address costs only that person.
    const sent: { email: string; id?: string }[] = [];
    const failed: { email: string; error: string }[] = [];
    for (const email of recipients) {
      const payload: Record<string, unknown> = { from: FROM, to: [email], subject, html };
      if (attList.length) payload.attachments = attList;
      const out = await sendOne(key, payload);
      if (out.ok) sent.push({ email, id: out.id });
      else failed.push({ email, error: String(out.error) });
      await sleep(550);   // stay under Resend's 2 req/sec
    }

    // Nobody reachable = a real failure. Never let the app report "sent".
    if (!sent.length) {
      return json({ error: "Could not send to any recipient", failed }, 502);
    }
    await ledger(sent.map((s) => (
      { event_type: "app.submitted", email_id: s.id ?? null, recipients: [s.email], subject }
    )));
    return json({ ok: true, sent: sent.length, recipients: recipients.length, failed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
