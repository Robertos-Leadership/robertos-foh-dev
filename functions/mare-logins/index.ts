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
const APP = "https://robertos-leadership.github.io/robertos-foh/mare.html";
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
    // The email a login gets with its link. One clean layout (tables and inline styles only, so
    // Outlook and Gmail draw it the same): a teal header, the greeting, three numbered steps, one
    // button, then (when given) the modules as a two-column list, and the sign-off.
    // extra = { note, modules: [{ group, items: [[name, text], …] }], outro, sign } — only the FOH Admin
    // or the system may pass it; a Mare admin's mail is the standard one.
    const send = async (name: string, link: string, copyMe: boolean, extraCc: string[], extra: any) => {
      if (!RESEND_API_KEY) return "no mail key";
      const test = /^zz/.test(email) || /^zz/i.test(name);
      const first = name.trim().split(/\s+/)[0] || "";
      const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
      const note = str(extra?.note, 3000), outro = str(extra?.outro, 2000), sign = str(extra?.sign, 200);
      const groups: { group: string; items: [string, string][] }[] = Array.isArray(extra?.modules)
        ? extra.modules.slice(0, 12).map((g: any) => ({ group: str(g?.group, 60), items: (Array.isArray(g?.items) ? g.items : []).slice(0, 20).map((i: any) => [str(i?.[0], 60), str(i?.[1], 600)] as [string, string]) }))
        : [];
      const SITE = APP.replace(/^https:\/\//, "");
      const steps = [
        "Press the button below and choose your password.",
        "From then on, sign in at " + SITE + " with your email (" + email + ") and your password.",
        "It works on the laptop and on the phone. On the phone you can add it to the home screen.",
      ];
      const foot = "The button works one time only, to choose your password. It is yours: please do not forward this email.";

      // ── plain text ──
      const paras = (t: string) => t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
      let text = "Dear " + first + ",\n\n" + (note ? paras(note).join("\n\n") + "\n\n" : "") +
        "HOW TO START\n" + steps.map((s, i) => (i + 1) + ". " + s).join("\n") + "\n\nChoose your password here:\n" + link + "\n\n";
      if (groups.length) text += "WHAT IS INSIDE\n\n" + groups.map((g) => g.group.toUpperCase() + "\n" + g.items.map((i) => "- " + i[0] + ": " + i[1]).join("\n")).join("\n\n") + "\n\n";
      if (outro) text += paras(outro).join("\n\n") + "\n\n";
      if (sign) text += sign + "\n\n";
      text += foot + "\n";

      // ── html ──
      const F = "font-family:Arial,Helvetica,sans-serif;", S = "font-family:Georgia,'Times New Roman',serif;";
      const P = (t: string) => paras(t).map((x) => '<p style="' + F + 'margin:0 0 14px;font-size:15px;line-height:23px;color:#1B2426">' + esc(x).replace(/\n/g, "<br>") + "</p>").join("");
      const H = (t: string) => '<p style="' + F + 'margin:0 0 12px;font-size:11px;line-height:16px;letter-spacing:2.5px;font-weight:bold;color:#A8834B;text-transform:uppercase">' + esc(t) + "</p>";
      const stepRows = steps.map((s, i) =>
        '<tr><td width="34" valign="top" style="padding:0 0 10px"><div style="' + F + 'width:24px;height:24px;line-height:24px;border-radius:12px;background:#0E4A50;color:#ffffff;font-size:13px;font-weight:bold;text-align:center">' + (i + 1) + "</div></td>" +
        '<td valign="top" style="' + F + 'padding:1px 0 10px;font-size:15px;line-height:22px;color:#1B2426">' + esc(s) + "</td></tr>").join("");
      const modRows = groups.map((g) =>
        '<tr><td colspan="2" style="' + F + 'padding:18px 0 6px;font-size:11px;line-height:16px;letter-spacing:2px;font-weight:bold;color:#0E4A50;text-transform:uppercase;border-bottom:1px solid #E4DBCD">' + esc(g.group) + "</td></tr>" +
        g.items.map((i) => '<tr><td width="150" valign="top" style="' + F + 'padding:9px 12px 9px 0;font-size:14px;line-height:20px;font-weight:bold;color:#1B2426;border-bottom:1px solid #EFE8DD">' + esc(i[0]) + "</td>" +
          '<td valign="top" style="' + F + 'padding:9px 0;font-size:14px;line-height:20px;color:#4B5557;border-bottom:1px solid #EFE8DD">' + esc(i[1]) + "</td></tr>").join("")).join("");
      const html = '<!doctype html><html><body style="margin:0;padding:0;background:#F6F1EA">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F1EA"><tr><td align="center" style="padding:24px 12px">' +
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #E4DBCD">' +
        '<tr><td align="center" style="background:#0E3B3F;padding:26px 24px 22px"><div style="' + S + 'font-size:26px;line-height:30px;color:#ffffff">Roberto&rsquo;s Mare</div>' +
        '<div style="' + F + 'margin-top:6px;font-size:10px;line-height:14px;letter-spacing:3.5px;color:#C9A46A">PORTO MONTENEGRO</div></td></tr>' +
        '<tr><td style="padding:30px 32px 8px">' + P("Dear " + first + ",") + (note ? P(note) : "") + "</td></tr>" +
        '<tr><td style="padding:8px 32px 0">' + H("How to start") + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + stepRows + "</table></td></tr>" +
        '<tr><td align="center" style="padding:14px 32px 6px"><a href="' + esc(link) + '" style="' + F + 'display:inline-block;background:#0E4A50;color:#ffffff;padding:14px 30px;border-radius:6px;font-size:14px;letter-spacing:1px;font-weight:bold;text-decoration:none">CHOOSE MY PASSWORD</a></td></tr>' +
        '<tr><td align="center" style="' + F + 'padding:8px 32px 22px;font-size:12px;line-height:18px;color:#6B7375">If the button does not open, copy this address into your browser:<br><span style="word-break:break-all;color:#0E4A50">' + esc(link) + "</span></td></tr>" +
        (groups.length ? '<tr><td style="padding:8px 32px 6px;border-top:1px solid #E4DBCD"><div style="height:18px;line-height:18px;font-size:0">&nbsp;</div>' + H("What is inside") +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:-12px">' + modRows + "</table></td></tr>" : "") +
        ((outro || sign) ? '<tr><td style="padding:22px 32px 10px">' + (outro ? P(outro) : "") + (sign ? P(sign) : "") + "</td></tr>" : "") +
        '<tr><td style="' + F + 'background:#FBF7F1;border-top:1px solid #E4DBCD;padding:16px 32px;font-size:12px;line-height:18px;color:#6B7375">' + esc(foot) + "</td></tr>" +
        "</table></td></tr></table></body></html>";

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
      // Only the FOH Admin (or the system) may add words of his own and the list of modules.
      const err = await send(u.name || email, link, body.copy_me !== false, extraCc, fohAdmin ? body.extra : null);
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
