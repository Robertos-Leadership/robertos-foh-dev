// ════════════════════════════════════════════════════════════
// mare-logins — Supabase Edge Function (FOH project), verify_jwt ON.
// A Mare admin adds and removes the logins of the Roberto's Mare management app
// (12 Oct 2026, Francesco: Milica is the admin and adds logins herself).
//
// Who may call: the FOH Admin, or a login with 'mare' + 'mare_admin' in app_users.modules
// (checked here against the caller's own JWT), or the service role.
//
// What it may do, and no more:
//   add    — give an email Mare access. A new email gets a Roberto's login with ONLY Mare,
//            and a personal no-password link. An email that already has a Roberto's login
//            only gains the 'mare' tick; it keeps signing in with its own password.
//   link   — make a new no-password link (the old ones stop).
//   remove — take Mare access away and stop the links. The login itself is never deleted.
//   admin  — make a login a Mare admin, or not.
//   mail   — email a login its own link (a new one is made; only the link's owner gets it).
// It never touches any other module, and never the FOH Admin flag.
//
// A link signs its holder in to their WHOLE Roberto's account, so a Mare admin can only make
// one for a Mare-only login (modules ⊆ mare, mare_admin). Only the FOH Admin can make one for
// a login that also opens Dubai modules.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (built in), RESEND_API_KEY.
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = `Roberto's Mare <no-reply@kitchenteam.robertos.ae>`;
// Mare runs on FOH dev only (12 Oct 2026). Change this when it goes live.
const APP = "https://robertos-foh-dev.pages.dev/mare.html";
const TEST_TO = "fguarracino@robertos.ae";
const MARE = ["mare", "mare_admin"];

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const a = new Uint8Array(30); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const mareOnly = (u: any) => !u.is_admin && (u.modules || []).every((m: string) => MARE.includes(m));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE, { auth: { persistSession: false } });
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

    // ── who is calling ──
    let me = "", fohAdmin = false;
    // verify_jwt is ON, so the gateway has already checked this token's signature: its role can be trusted.
    let role = "";
    try { role = JSON.parse(atob(bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role || ""; } catch (_) { /* not a JWT */ }
    if (bearer === SERVICE || role === "service_role") { me = "system"; fohAdmin = true; }
    else {
      const { data: au } = await sb.auth.getUser(bearer);
      me = (au?.user?.email || "").toLowerCase();
      if (!me) return json({ ok: false, error: "signin" }, 401);
      const { data: cu } = await sb.from("app_users").select("email,modules,is_admin").ilike("email", me).maybeSingle();
      const mods = cu?.modules || [];
      if (!cu || !(cu.is_admin || (mods.includes("mare") && mods.includes("mare_admin")))) return json({ ok: false, error: "admin" }, 403);
      fohAdmin = !!cu.is_admin;
    }

    const body = await req.json().catch(() => ({}));
    const act = String(body.action || "");
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s.]{2,}$/.test(email)) return json({ ok: false, error: "email" });
    const { data: u } = await sb.from("app_users").select("email,name,title,modules,is_admin").ilike("email", email).maybeSingle();

    // A new personal link; every older one for this email stops.
    const mint = async () => {
      await sb.from("mare_try_links").update({ revoked: true }).ilike("email", email).eq("revoked", false);
      const tok = randomToken();
      const ins = await sb.from("mare_try_links").insert({ token_hash: await sha256(tok), email, expires_at: "2100-01-01T00:00:00Z", created_by: me });
      if (ins.error) throw new Error(ins.error.message);
      return APP + "?try=" + tok;
    };
    const send = async (name: string, link: string, note: string, copyMe: boolean, extraCc: string[], sign: string, after: string) => {
      if (!RESEND_API_KEY) return "no mail key";
      const test = /^zz/.test(email) || /^zz/i.test(name);
      const first = name.trim().split(/\s+/)[0] || "";
      const lines = [
        "This is your own link to the Roberto's Mare app. Open it and choose your password. The link works only until you have chosen it.",
        "After that you sign in at https://robertos-foh-dev.pages.dev/mare.html with your email (" + email + ") and your password, on the laptop and on the phone. On the phone you can add it to the home screen.",
        "The link is yours only. Please do not forward it.",
      ];
      const noteT = note.trim().slice(0, 3000), signT = sign.trim().slice(0, 200), afterT = after.trim().slice(0, 8000);
      const text = "Dear " + first + ",\n\n" + (noteT ? noteT + "\n\n" : "") + lines[0] + "\n" + link + "\n\n" + lines[1] + "\n\n" + lines[2] + "\n" + (afterT ? "\n" + afterT + "\n" : "") + (signT ? "\n" + signT + "\n" : "");
      const p = (t: string) => '<p style="margin:0 0 14px">' + esc(t).replace(/\n/g, "<br>") + "</p>";
      const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1B2426;max-width:560px">' +
        p("Dear " + first + ",") + (noteT ? p(noteT) : "") + p(lines[0]) +
        '<p style="margin:0 0 18px"><a href="' + esc(link) + '" style="display:inline-block;background:#0E4A50;color:#fff;padding:12px 20px;border-radius:10px;font-weight:bold;text-decoration:none">Choose my password</a></p>' +
        '<p style="margin:0 0 14px;font-size:13px;color:#4B5557;word-break:break-all">' + esc(link) + "</p>" + p(lines[1]) + p(lines[2]) +
        afterT.split(/\n{2,}/).filter((x) => x.trim()).map((para) => '<p style="margin:0 0 14px">' + para.split("\n").map((ln) => { const m = /^([A-Z][A-Za-z&' -]{1,28}): (.+)$/.exec(ln); return m ? "<b>" + esc(m[1]) + "</b> &ndash; " + esc(m[2]) : esc(ln); }).join("<br>") + "</p>").join("") +
        (signT ? p(signT) : "") + "</div>";
      // A copy to the admin who sent it; the FOH Admin (or the system) may name the copies instead.
      const cc = test ? [] : extraCc.length ? extraCc.filter((x) => x !== email) : copyMe && me.includes("@") && me !== email ? [me] : [];
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [test ? TEST_TO : email], ...(cc.length ? { cc } : {}), subject: (test ? "[TEST] " : "") + "Your Roberto's Mare app", text, html }),
      });
      const d = await r.json().catch(() => null);
      console.log("mare-logins mail", email, r.ok ? "sent " + d?.id : "FAILED " + r.status);
      return r.ok && d?.id ? "" : String(d?.message || d?.error || "HTTP " + r.status).slice(0, 200);
    };

    if (act === "add") {
      const name = String(body.name || "").trim().slice(0, 80);
      const title = String(body.title || "").trim().slice(0, 80) || null;
      const wantAdmin = body.admin === true;
      if (u) {
        // An existing Roberto's login only gains the Mare tick(s).
        const mods = Array.from(new Set([...(u.modules || []), "mare", ...(wantAdmin ? ["mare_admin"] : [])]));
        const up = await sb.from("app_users").update({ modules: mods, updated_at: new Date().toISOString() }).eq("email", u.email);
        if (up.error) throw new Error(up.error.message);
        if (!mareOnly({ ...u, modules: mods }) && !fohAdmin) return json({ ok: true, existing: true, name: u.name || email });
      } else {
        if (!name) return json({ ok: false, error: "name" });
        const cr = await sb.auth.admin.createUser({ email, email_confirm: true, password: randomToken() + "aA1!" });
        if (cr.error && !/already|registered|exists/i.test(cr.error.message)) throw new Error(cr.error.message);
        const ins = await sb.from("app_users").insert({ email, name, title, modules: wantAdmin ? MARE : ["mare"], is_admin: false, notify: [] });
        if (ins.error) throw new Error(ins.error.message);
      }
      // (an existing Mare-only row may have no sign-in yet)
      if (u) { const cr = await sb.auth.admin.createUser({ email, email_confirm: true, password: randomToken() + "aA1!" }); if (cr.error && !/already|registered|exists/i.test(cr.error.message)) throw new Error(cr.error.message); }
      return json({ ok: true, link: await mint(), name: (u && u.name) || name });
    }

    if (!u || !(u.is_admin || (u.modules || []).includes("mare"))) return json({ ok: false, error: "nologin" });

    if (act === "link" || act === "mail") {
      if (!mareOnly(u) && !fohAdmin) return json({ ok: false, error: "dubai" });
      const link = await mint();
      if (act === "link") return json({ ok: true, link });
      const extraCc = fohAdmin && Array.isArray(body.cc) ? body.cc.map((x: unknown) => String(x).trim().toLowerCase()).filter((x: string) => /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(x)).slice(0, 5) : [];
      // Only the FOH Admin (or the system) may add words of his own above the link.
      const err = await send(u.name || email, link, fohAdmin ? String(body.note || "") : "", body.copy_me !== false, extraCc, fohAdmin ? String(body.sign || "") : "", fohAdmin ? String(body.after || "") : "");
      return err ? json({ ok: false, error: "mail: " + err, link }) : json({ ok: true, mailed: true, test: /^zz/.test(email) || /^zz/i.test(u.name || "") });
    }
    if (act === "remove") {
      if (email === me) return json({ ok: false, error: "self" });
      if (u.is_admin) return json({ ok: false, error: "fohadmin" });
      const mods = (u.modules || []).filter((m: string) => !MARE.includes(m));
      const up = await sb.from("app_users").update({ modules: mods, updated_at: new Date().toISOString() }).eq("email", u.email);
      if (up.error) throw new Error(up.error.message);
      await sb.from("mare_try_links").update({ revoked: true }).ilike("email", email).eq("revoked", false);
      // A removed login stops getting the Mare emails and loses its module ticks. If it is the ONLY
      // person on an email, it stays there (a report must not go to nobody) and the admin is told.
      let keptMail = false;
      const { data: st } = await sb.from("mare_settings").select("key,value").in("key", ["kitchen_report_to", "recipe_question_to", "link_mail_cc", "mgr_modules"]);
      for (const row of st || []) {
        if (row.key === "mgr_modules") {
          if (row.value && typeof row.value === "object" && email in row.value) { const v = { ...row.value }; delete v[email]; await sb.from("mare_settings").update({ value: v }).eq("key", row.key); }
        } else if (Array.isArray(row.value) && row.value.some((x: unknown) => String(x).toLowerCase() === email)) {
          const next = row.value.filter((x: unknown) => String(x).toLowerCase() !== email);
          if (next.length) await sb.from("mare_settings").update({ value: next }).eq("key", row.key); else keptMail = true;
        }
      }
      return json({ ok: true, kept_mail: keptMail });
    }
    if (act === "admin") {
      if (email === me) return json({ ok: false, error: "self" });
      if (u.is_admin) return json({ ok: false, error: "fohadmin" });
      const mods = (u.modules || []).filter((m: string) => m !== "mare_admin").concat(body.on === true ? ["mare_admin"] : []);
      const up = await sb.from("app_users").update({ modules: mods, updated_at: new Date().toISOString() }).eq("email", u.email);
      if (up.error) throw new Error(up.error.message);
      return json({ ok: true });
    }
    return json({ ok: false, error: "action" }, 400);
  } catch (e) {
    console.error("mare-logins", e);
    return json({ ok: false, error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
});
