// ════════════════════════════════════════════════════════════
// manage-login — Supabase Edge Function (FOH project)
//
// Lets an Admin or the HR role create, re-password and remove app logins from
// Admin → People, without the Supabase dashboard. Built 14 Sep 2026 so HR
// (Leverina) owns who gets into the app.
//
// Actions (POST, signed-in caller's JWT required):
//   list    → [{ email, banned, last_sign_in_at }] for every auth login
//   create  → { email, password, name?, modules? } — creates the login, or on
//             an existing one sets the new password and lifts any removal
//   revoke  → { email } — bans the login, signs it out everywhere, empties
//             its modules and emails. The app_users row is KEPT: deleting it
//             would grant the default modules (loadFohAccess allow-default).
//
// Rules:
//   • Caller must be is_admin or is_hr in app_users.
//   • Only an Admin can touch a login whose row is Admin or HR.
//   • Nobody can remove their own login.
//   • Password minimum 8 characters, same as saveChangePassword().
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MIN_PASSWORD = 8;
const MODULE_KEYS = ["events", "privateevents", "operations", "revenue", "stocktake", "reviews", "reservations", "events_editor"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type SB = ReturnType<typeof admin>;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

async function allUsers(sb: SB) {
  const out = [];
  const PER = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: PER });
    if (error) throw error;
    const users = data?.users ?? [];
    out.push(...users);
    if (users.length < PER) break;
  }
  return out;
}

async function rowFor(sb: SB, email: string) {
  const { data, error } = await sb.from("app_users").select("*").ilike("email", email).limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

function isBanned(u: { banned_until?: string | null }) {
  return !!u.banned_until && new Date(u.banned_until).getTime() > Date.now();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const sb = admin();
  const { data: who, error: whoErr } = await sb.auth.getUser(jwt);
  if (whoErr || !who?.user?.email) return json({ ok: false, error: "Not signed in" }, 401);
  const callerEmail = norm(who.user.email);

  let caller;
  try { caller = await rowFor(sb, callerEmail); } catch { return json({ ok: false, error: "Could not check your access." }, 500); }
  const callerAdmin = !!caller?.is_admin;
  if (!callerAdmin && !caller?.is_hr) return json({ ok: false, error: "Only Admin or HR can manage logins." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Bad request" }, 400); }
  const action = String(body.action ?? "");

  try {
    if (action === "list") {
      const users = await allUsers(sb);
      return json({
        ok: true,
        logins: users.map((u) => ({ email: norm(u.email), banned: isBanned(u as { banned_until?: string }), last_sign_in_at: u.last_sign_in_at ?? null })),
      });
    }

    const email = norm(body.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "That email doesn't look right." }, 400);

    const row = await rowFor(sb, email);
    if (row && (row.is_admin || row.is_hr) && !callerAdmin) {
      return json({ ok: false, error: "Only an Admin can change an Admin or HR login." }, 403);
    }
    const existing = (await allUsers(sb)).find((u) => norm(u.email) === email);

    if (action === "create") {
      const password = String(body.password ?? "");
      if (password.length < MIN_PASSWORD) return json({ ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400);
      const name = String(body.name ?? "").trim();
      const mods = Array.isArray(body.modules)
        ? (body.modules as unknown[]).map(String).filter((m) => MODULE_KEYS.includes(m))
        : ["events", "operations"];

      let created = false;
      if (existing) {
        const { error } = await sb.auth.admin.updateUserById(existing.id, { password, ban_duration: "none" });
        if (error) return json({ ok: false, error: "Could not set the password: " + error.message }, 500);
      } else {
        const { error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: name ? { name } : {} });
        if (error) return json({ ok: false, error: "Could not create the login: " + error.message }, 500);
        created = true;
      }

      if (!row) {
        const { error } = await sb.from("app_users").insert({
          email, name: name || email, modules: mods, is_admin: false, is_hr: false, notify: [], updated_at: new Date().toISOString(),
        });
        if (error) return json({ ok: false, error: "Login made, but the access list could not be saved: " + error.message }, 500);
      } else if (!(row.modules ?? []).length && !row.is_admin) {
        // A mail-only or previously removed row: give it the modules chosen now.
        const { error } = await sb.from("app_users").update({ modules: mods, updated_at: new Date().toISOString() }).eq("email", row.email);
        if (error) return json({ ok: false, error: "Login made, but access could not be saved: " + error.message }, 500);
      }
      return json({ ok: true, created });
    }

    if (action === "revoke") {
      if (email === callerEmail) return json({ ok: false, error: "You can't remove your own login." }, 400);
      if (existing) {
        const { error } = await sb.auth.admin.updateUserById(existing.id, { ban_duration: "876000h" });
        if (error) return json({ ok: false, error: "Could not block the login: " + error.message }, 500);
        const { error: sErr } = await sb.rpc("fn_revoke_login_sessions", { p_uid: existing.id });
        if (sErr) return json({ ok: false, error: "Blocked, but could not sign them out: " + sErr.message }, 500);
      }
      if (row) {
        const { error } = await sb.from("app_users").update({ modules: [], notify: [], updated_at: new Date().toISOString() }).eq("email", row.email);
        if (error) return json({ ok: false, error: "Login blocked, but access list not cleared: " + error.message }, 500);
      }
      return json({ ok: true, hadLogin: !!existing });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: "Something went wrong: " + ((e as Error)?.message ?? e) }, 500);
  }
});
