// ════════════════════════════════════════════════════════════
// password-reset — Supabase Edge Function (Leadership Hub / FOH project)
//
// Self-serve password recovery for the FOH app. Sends a 6-digit code to the
// address already registered against the account, then sets the new password.
//
// ── WHY THIS EXISTS AND NOT Supabase's OWN RESET ───────────────────────────
// Reported 10 Sep 2026 by Chef Andrea: "Forgot my log in credential, my usual
// password doesn't work." The login screen had no way out at all — the only
// recovery was Francesco running reset-foh-password.ps1 by hand.
//
// The obvious fix, sb.auth.resetPasswordForEmail(), is BROKEN THREE WAYS on
// this project, all verified against the Management API on 12 Sep 2026:
//   1. smtp_host = null        → no custom SMTP. Supabase's built-in sender
//                                only delivers to project TEAM MEMBERS, so a
//                                @robertos.ae address would never receive it.
//   2. rate_limit_email_sent=2 → two auth emails per HOUR for the whole app.
//   3. site_url = http://localhost:3000, uri_allow_list = ""
//                              → the recovery link would land the user on
//                                localhost:3000. Nothing would open.
// Any of those three fails SILENTLY from the user's side: the app says "check
// your email" and no email ever comes. So recovery is built on Resend, the
// transport that already delivers the closing report and the event emails, and
// on a typed CODE rather than a clicked link — a code works on the phone, the
// tablet and the laptop, and cannot be broken by a redirect allow-list.
//
// ── WHERE THE CODE LIVES ───────────────────────────────────────────────────
// In the user's auth `app_metadata`, NOT `user_metadata`. user_metadata is
// writable by the signed-in user via auth.updateUser(); app_metadata is
// service-role only. Storing the challenge somewhere the challenger can edit
// would defeat the whole thing. Salted SHA-256, never the digits themselves.
//
// ── THE RULES IT ENFORCES ──────────────────────────────────────────────────
//   • 15-minute expiry, 5 wrong tries, single use (cleared on success).
//   • 60-second cooldown between sends, so the button cannot be used to
//     hammer somebody's inbox.
//   • The response NEVER says whether an address has an account. An unknown
//     address gets the same {ok:true} and no email. Otherwise this endpoint
//     becomes a way to enumerate who works here.
//   • New password minimum 8 characters — matches saveChangePassword() in
//     foh-core.js, so the rule a user meets once is the rule everywhere.
//
// Secrets: RESEND_API_KEY (already set). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// verify_jwt MUST be false — the caller is by definition not signed in.
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FROM = "Roberto's DIFC <reports@kitchenteam.robertos.ae>"; // verified Resend domain
const RESEND = "https://api.resend.com/emails";

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_TRIES = 5;
const MIN_PASSWORD = 8;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashCode(code: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + ":" + code);
  return hex(await crypto.subtle.digest("SHA-256", data));
}

// Rejection must not leak WHICH part was wrong, and must not be faster for a
// wrong code than a right one in a way that is measurable. Fixed-length hex
// compared in constant time.
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sixDigits(): string {
  // Rejection-sampled so every code from 000000-999999 is equally likely.
  // (A plain modulo of a 32-bit value very slightly favours the low codes.)
  const buf = new Uint32Array(1);
  const LIMIT = 4294000000; // largest multiple of 1e6 under 2^32
  do { crypto.getRandomValues(buf); } while (buf[0] >= LIMIT);
  return String(buf[0] % 1000000).padStart(6, "0");
}

// The address the person typed, reduced to the form auth.users stores.
function normalise(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

// Find the account WITHOUT a public lookup endpoint. 20-odd users today; the
// page size is well clear of that and the loop stops when a page is short, so
// it stays correct if the team doubles.
async function findUser(sb: ReturnType<typeof admin>, email: string) {
  const PER = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: PER });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (users.length < PER) return null;
  }
  return null;
}

// Best-effort delivery ledger — same table the email watchdog reads, so a
// reset that Resend accepted but never delivered is visible later. The code
// itself is NEVER written here.
async function ledger(sb: ReturnType<typeof admin>, row: Record<string, unknown>) {
  try { await sb.from("email_events").insert([row]); } catch { /* the send matters more */ }
}

function emailHtml(code: string): string {
  return `<div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#2b2b2b">
  <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a8a8a">Roberto's &middot; Dubai DIFC</div>
  <h2 style="font-weight:normal;color:#400207;margin:12px 0 4px">Reset your password</h2>
  <p style="font-size:15px;line-height:1.6">Someone asked to reset the password for this email address on the Roberto's Leadership app. Enter this code in the app:</p>
  <div style="font-size:34px;letter-spacing:.32em;font-weight:bold;color:#400207;background:#E8D9C7;border-radius:8px;padding:18px 12px;text-align:center;margin:20px 0">${code}</div>
  <p style="font-size:15px;line-height:1.6">The code stops working in 15 minutes. Once you have typed it, you choose the new password yourself &mdash; nobody else ever sees it.</p>
  <p style="font-size:14px;line-height:1.6;color:#6b6b6b">If this wasn't you, you can ignore this email. Your password has not changed, and nobody can change it without this code.</p>
</div>`;
}

async function handleRequest(body: Record<string, unknown>) {
  const email = normalise(body.email);
  // Everything below returns the SAME shape whatever happens, on purpose.
  const silentOk = json({ ok: true });
  if (!email || !email.includes("@")) return silentOk;

  const sb = admin();
  let user;
  try {
    user = await findUser(sb, email);
  } catch (_e) {
    return json({ ok: false, error: "Could not reach the account system. Try again in a moment." }, 500);
  }
  if (!user) return silentOk; // unknown address — say nothing, send nothing

  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const prev = meta.pwreset as { sent?: number } | undefined;
  if (prev?.sent && Date.now() - prev.sent < RESEND_COOLDOWN_MS) {
    return silentOk; // a second press within the minute is a no-op, not a second email
  }

  const code = sixDigits();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const pwreset = {
    hash: await hashCode(code, salt),
    salt,
    exp: Date.now() + CODE_TTL_MS,
    sent: Date.now(),
    tries: 0,
  };

  const { error: metaErr } = await sb.auth.admin.updateUserById(user.id, {
    app_metadata: { ...meta, pwreset },
  });
  // If the challenge could not be stored, the code in the email would be
  // unusable. Never send a code we cannot honour.
  if (metaErr) {
    return json({ ok: false, error: "Could not start the reset. Try again in a moment." }, 500);
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ ok: false, error: "Email is not configured. Tell Francesco." }, 500);

  const subject = "Your Roberto's app reset code";
  const r = await fetch(RESEND, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [user.email], subject, html: emailHtml(code) }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Clear the challenge again — leaving a live code nobody received would
    // silently burn the 60-second cooldown on every retry.
    await sb.auth.admin.updateUserById(user.id, { app_metadata: { ...meta, pwreset: null } });
    return json({ ok: false, error: "Could not send the email. Try again, or tell Francesco." }, 502);
  }

  await ledger(sb, {
    event_type: "requested",
    email_id: data?.id ?? null,
    recipients: [user.email],
    subject,
    received_at: new Date().toISOString(),
    raw: { source: "password-reset" },
  });

  return silentOk;
}

async function handleConfirm(body: Record<string, unknown>) {
  const email = normalise(body.email);
  const code = String(body.code ?? "").replace(/\D/g, "");
  const password = String(body.password ?? "");

  if (password.length < MIN_PASSWORD) {
    return json({ ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400);
  }
  // One message for every way the challenge can fail, so a wrong code and an
  // address with no account are indistinguishable from outside.
  const bad = json({ ok: false, error: "That code is wrong or has expired. Ask for a new one." }, 400);
  if (!email || code.length !== 6) return bad;

  const sb = admin();
  let user;
  try {
    user = await findUser(sb, email);
  } catch (_e) {
    return json({ ok: false, error: "Could not reach the account system. Try again in a moment." }, 500);
  }
  if (!user) return bad;

  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const ch = meta.pwreset as
    | { hash?: string; salt?: string; exp?: number; tries?: number }
    | null
    | undefined;
  if (!ch?.hash || !ch?.salt || !ch?.exp) return bad;
  if (Date.now() > ch.exp) {
    await sb.auth.admin.updateUserById(user.id, { app_metadata: { ...meta, pwreset: null } });
    return bad;
  }
  if ((ch.tries ?? 0) >= MAX_TRIES) {
    await sb.auth.admin.updateUserById(user.id, { app_metadata: { ...meta, pwreset: null } });
    return bad;
  }

  const attempt = await hashCode(code, ch.salt);
  if (!sameHash(attempt, ch.hash)) {
    await sb.auth.admin.updateUserById(user.id, {
      app_metadata: { ...meta, pwreset: { ...ch, tries: (ch.tries ?? 0) + 1 } },
    });
    return bad;
  }

  // Right code. Set the password and burn the challenge in the same write, so
  // it can never be replayed.
  const { error } = await sb.auth.admin.updateUserById(user.id, {
    password,
    app_metadata: { ...meta, pwreset: null },
  });
  if (error) {
    return json({ ok: false, error: "Could not set the new password. Try again in a moment." }, 500);
  }
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad request" }, 400);
  }

  const action = String(body.action ?? "");
  if (action === "request") return await handleRequest(body);
  if (action === "confirm") return await handleConfirm(body);
  return json({ ok: false, error: "Unknown action" }, 400);
});
