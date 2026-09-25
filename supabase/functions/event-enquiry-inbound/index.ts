// ════════════════════════════════════════════════════════════════════════════
//  event-enquiry-inbound — an enquiry email becomes a booking on the desk
//
//  Francesco, 12 Aug 2026: enquiries land on info@robertos.ae, Nicole forwards
//  them on. This is the address she forwards to. One forward and the enquiry is
//  on the events desk, matched to a client, and checked against SevenRooms —
//  before anyone has typed a word.
//
//  Flow:  Resend receives  ->  webhook (metadata)  ->  fetch the body
//         ->  read it      ->  match/create event_clients
//         ->  draft in events_desk  ->  SevenRooms "have they dined with us?"
//
//  THE ONE THING THAT MAKES THIS HARD. The mail is a FORWARD, so `from` is
//  Nicole, not the client. Taking the envelope sender at face value would put
//  Nicole's address on every enquiry and poison the client database inside a
//  week. The original sender is inside the forwarded body, so the read below is
//  told, in the prompt and again in the schema, to return the ORIGINAL enquirer
//  and to ignore anyone at our own domains.
//
//  verify_jwt is FALSE — Resend cannot present a Supabase JWT. The gate is the
//  Svix signature instead, checked before anything is read or written. An
//  unsigned or stale POST is rejected at the door.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Anyone at these domains is US, not the client — never the enquirer.
const OUR_DOMAINS = ["robertos.ae", "skelmore.com"];

const VENUE = "robertos-difc";

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

// ── read the enquiry ────────────────────────────────────────────────────────
// Everything comes back as a STRING, empty when unknown. Nullable JSON-schema
// unions are the kind of detail a strict schema rejects on a bad day, and an
// enquiry silently failing to land is worse than parsing "40" ourselves.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_event_enquiry", "client_name", "company", "contact_name", "email", "phone",
    "event_date", "guests", "event_type", "area_hint", "occasion", "min_spend",
    "lead_source", "summary",
  ],
  properties: {
    is_event_enquiry: { type: "string", enum: ["yes", "no"] },
    client_name: { type: "string", description: "Person or company the booking is for" },
    company: { type: "string" },
    contact_name: { type: "string", description: "Person who wrote the enquiry" },
    email: { type: "string", description: "ORIGINAL enquirer's email. Never one of our own staff." },
    phone: { type: "string" },
    event_date: { type: "string", description: "YYYY-MM-DD, or empty if no date given" },
    guests: { type: "string", description: "Digits only, or empty" },
    event_type: { type: "string", enum: ["", "Gathering", "Private gathering", "Dinner", "Lunch", "Reception", "Full buyout"] },
    area_hint: { type: "string", description: "Room they asked for, in their words. Empty if none." },
    occasion: { type: "string" },
    min_spend: { type: "string", description: "Digits only if a budget or minimum spend is stated" },
    lead_source: { type: "string", enum: ["", "Walk-in", "Phone call", "WhatsApp", "Email", "Instagram / social", "Website", "Referral", "Promoter", "Repeat guest", "Call centre"] },
    summary: { type: "string", description: "One sentence, what they are asking for" },
  },
} as const;

const SYSTEM = `You read private-event enquiries for Roberto's DIFC, a fine-dining restaurant in Dubai, and turn them into structured fields.

The email you are given has almost always been FORWARDED to you by a member of Roberto's own staff. The person who forwarded it is NOT the client. Read past the forward and find the ORIGINAL enquirer — their name, their email address, their phone number — from the quoted message inside.

Never return an address at any of these domains as the enquirer: ${OUR_DOMAINS.join(", ")}. Those are our own people. If the only address you can find is one of ours, leave the email field empty rather than using it.

Rules for the fields:
- Return every field. Use an empty string for anything the email does not say. Never guess a date, a headcount, or a budget that is not there.
- event_date: resolve relative dates ("next Thursday", "the 12th") against the date given in the user message. If the year is not stated, choose the next occurrence in the future.
- guests, min_spend: digits only, no currency symbols or words.
- lead_source: how the enquiry reached us, if the email says. It arrived by email, so "Email" is the sensible default unless the text says otherwise (they walked in, called, messaged on Instagram).
- is_event_enquiry: "no" if this is not somebody asking about hosting an event — a supplier, a newsletter, a reservation for a normal table, an internal note.`;

async function readEnquiry(key: string, subject: string, body: string, today: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: SYSTEM,
      // Low effort: this is extraction, not reasoning. Thinking stays ON —
      // disabling it on this model can leak <thinking> tags into the output.
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: `Today's date is ${today} (Dubai).\n\nSubject: ${subject}\n\n${body.slice(0, 40000)}`,
      }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return JSON.parse(text);
}

// ── SevenRooms: have they dined with us before? ─────────────────────────────
// Runs on the Kitchen project. Returns a verdict only — the guest's phone and
// email never come back across, which is the whole point of doing it there.
async function srCheck(value: string, kind: string) {
  const base = Deno.env.get("KITCHEN_URL") || "https://zrpglswalgjbtghudmhu.supabase.co";
  const r = await fetch(
    `${base}/functions/v1/sevenrooms-sync?clientcheck=${encodeURIComponent(value)}&kind=${kind}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("KITCHEN_ANON_KEY")}`,
        "x-proxy-secret": Deno.env.get("KITCHEN_PROXY_SECRET") || "",
      },
    },
  );
  if (!r.ok) throw new Error(`sevenrooms ${r.status}`);
  return await r.json();
}

const digits = (s: string) => String(s || "").replace(/\D/g, "");
const phoneKey = (s: string) => digits(s).slice(-9);
const nameKey = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const raw = await req.text();

  // The gate. Nothing is read, parsed or written above this line.
  if (!(await svixOk(raw, req.headers, Deno.env.get("RESEND_WEBHOOK_SECRET") || ""))) {
    return new Response(JSON.stringify({ error: "bad signature" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const log = (stage: string, detail: unknown) =>
    console.log(`[enquiry-inbound] ${stage}: ${String(detail).slice(0, 300)}`);

  try {
    const hook = JSON.parse(raw);
    if (hook?.type !== "email.received") {
      return new Response(JSON.stringify({ ok: true, ignored: hook?.type }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const emailId = hook?.data?.id;
    if (!emailId) throw new Error("webhook carried no email id");

    // Resend retries on any non-2xx, so the same enquiry can arrive twice. The
    // send log is the ledger: if we already created a booking for this email id,
    // say so and stop. Cheaper and more honest than a second draft on the desk.
    const seen = await sb.from("event_log").select("event_id").eq("action", "created")
      .like("detail", `%inbound:${emailId}%`).limit(1);
    if (!seen.error && seen.data?.length) {
      return new Response(JSON.stringify({ ok: true, duplicate: true, event_id: seen.data[0].event_id }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // The webhook is metadata only — the body is a second call.
    const mailRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}` },
    });
    if (!mailRes.ok) throw new Error(`resend fetch ${mailRes.status}`);
    const mail = await mailRes.json();

    const subject = mail.subject || "";
    const body = mail.text || String(mail.html || "").replace(/<[^>]+>/g, " ");
    const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10); // Dubai

    const p = await readEnquiry(Deno.env.get("ANTHROPIC_API_KEY")!, subject, body, today);
    log("read", JSON.stringify(p));

    if (p.is_event_enquiry !== "yes") {
      return new Response(JSON.stringify({ ok: true, skipped: "not an event enquiry", summary: p.summary }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Belt and braces: even if the read slips, one of our own addresses never
    // becomes the client's.
    let email = String(p.email || "").trim().toLowerCase();
    if (email && OUR_DOMAINS.some((d) => email.endsWith("@" + d))) email = "";

    const displayName = (p.company || p.client_name || p.contact_name || "Enquiry").trim();
    const ek = email || null;
    const pk = phoneKey(p.phone) || null;
    const nk = nameKey(p.company || displayName) || null;

    // ── the client: match, or create ────────────────────────────────────────
    // Same precedence the desk's own seed uses — email, then phone, then name —
    // so a client created here and one created by hand collapse to one record.
    let client: any = null;
    if (ek) {
      const r = await sb.from("event_clients").select("*").eq("venue_id", VENUE).eq("email_key", ek).maybeSingle();
      client = r.data;
    }
    if (!client && pk) {
      const r = await sb.from("event_clients").select("*").eq("venue_id", VENUE).eq("phone_key", pk).maybeSingle();
      client = r.data;
    }
    if (!client && !ek && !pk && nk) {
      const r = await sb.from("event_clients").select("*").eq("venue_id", VENUE).eq("name_key", nk).limit(1);
      client = r.data?.[0] || null;
    }
    if (!client) {
      const ins = await sb.from("event_clients").insert({
        venue_id: VENUE, display_name: displayName,
        company: p.company || null, contact_name: p.contact_name || null,
        email: email || null, phone: p.phone || null,
        created_by: "inbound enquiry",
      }).select().single();
      if (ins.error) throw new Error(`client insert: ${ins.error.message}`);
      client = ins.data;
      log("client", `created ${client.id}`);
    } else {
      // Fill gaps on an existing client without overwriting what a human typed.
      const patch: Record<string, unknown> = {};
      if (!client.email && email) patch.email = email;
      if (!client.phone && p.phone) patch.phone = p.phone;
      if (!client.company && p.company) patch.company = p.company;
      if (Object.keys(patch).length) await sb.from("event_clients").update(patch).eq("id", client.id);
      log("client", `matched ${client.id}`);
    }

    // ── the booking ─────────────────────────────────────────────────────────
    // A DRAFT, deliberately. Nothing here is quoted, nothing is sent, and the
    // desk's own "next step" logic picks it up from there.
    const guests = parseInt(digits(p.guests), 10);
    const minSpend = parseInt(digits(p.min_spend), 10);
    const note = [
      p.occasion && `Occasion: ${p.occasion}`,
      p.area_hint && `Asked about: ${p.area_hint}`,
      `— read from the forwarded enquiry, ${today}`,
    ].filter(Boolean).join(" · ");

    const evIns = await sb.from("events_desk").insert({
      venue_id: VENUE, status: "draft", client_id: client.id,
      client_name: p.client_name || displayName,
      company: p.company || null,
      contact_name: p.contact_name || null,
      contact_email: email || null,
      contact_phone: p.phone || null,
      event_date: /^\d{4}-\d{2}-\d{2}$/.test(p.event_date) ? p.event_date : null,
      guests: isFinite(guests) && guests > 0 ? guests : null,
      event_type: p.event_type || null,
      min_spend: isFinite(minSpend) && minSpend > 0 ? minSpend : null,
      lead_source: p.lead_source || "Email",
      lead_source_note: note,
      updated_by: "inbound enquiry",
    }).select().single();
    if (evIns.error) throw new Error(`event insert: ${evIns.error.message}`);
    const ev = evIns.data;
    log("event", `created ${ev.id}`);

    // The idempotency ledger AND the desk's own audit line, in one row.
    await sb.from("event_log").insert({
      event_id: ev.id, action: "created", actor: "inbound enquiry",
      detail: `inbound:${emailId} — forwarded enquiry${subject ? ` · "${subject.slice(0, 90)}"` : ""}`,
    });

    // ── have they dined with us before? ─────────────────────────────────────
    // Best effort. A SevenRooms wobble must never cost us the enquiry, so this
    // is the last thing done and its failure is recorded, not thrown.
    let sr: any = { status: "unchecked" };
    try {
      const value = pk ? pk : (email || nameKey(displayName) ? (email || displayName) : "");
      const kind = pk ? "phone" : (email ? "email" : "name");
      if (value) {
        const res = await srCheck(pk || email || displayName, kind);
        const best = (res.matches || [])[0];
        sr = {
          sr_status: res.status === "known" ? "known" : res.status === "new" ? "new" : "error",
          sr_matched_on: res.matched_on || null,
          sr_client_id: best?.sr_client_id || null,
          sr_visits: best?.visits ?? null,
          sr_last_visit: best?.last_visit || null,
          sr_checked_at: new Date().toISOString(),
        };
        await sb.from("event_clients").update(sr).eq("id", client.id);
        if (res.status === "known" && best) {
          await sb.from("event_log").insert({
            event_id: ev.id, action: "followup", actor: "inbound enquiry",
            detail: `Known guest in SevenRooms — ${best.visits ?? "?"} visit(s)${best.last_visit ? `, last ${best.last_visit}` : ""}${best.name ? ` (${best.name})` : ""}`,
          });
        }
      }
    } catch (e) {
      sr = { sr_status: "error", note: String(e).slice(0, 120) };
      await sb.from("event_clients").update({ sr_status: "error", sr_checked_at: new Date().toISOString() }).eq("id", client.id);
      log("sevenrooms", e);
    }

    return new Response(JSON.stringify({ ok: true, event_id: ev.id, client_id: client.id, sevenrooms: sr, read: p }, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    log("FAILED", err);
    // 500 so Resend retries — a dropped enquiry is the one outcome worth a retry.
    return new Response(JSON.stringify({ ok: false, error: String(err).slice(0, 400) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
