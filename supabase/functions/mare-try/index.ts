// ════════════════════════════════════════════════════════════
// mare-try — Supabase Edge Function (Leadership Hub project)
// One-click test link for the Roberto's Mare app: mare.html?try=<token>.
// Turns a personal, expiring token into a sign-in for THAT person's own login,
// so a reviewer never types a password. Also {master: code}: a master code signs in its holder. No JWT needed (he is not signed in yet);
// the token IS the check: stored only as a sha256 hash, expiring, revocable, and
// only for a login that has Mare access (or is Admin).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (built in).
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    // A master code (1212, Andrea Sacchi's) signs in as its holder (Francesco, 9 Oct 2026: master codes
    // open everything). The code is checked against its hash; the holder's login must have Mare access.
    if (body.master != null) {
      const code = String(body.master).trim();
      const sbm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
      const { data: mc } = /^[0-9A-Za-z]{3,20}$/.test(code)
        ? await sbm.from("master_codes").select("name,email").eq("code_hash", await sha256("robertos-master:" + code)).maybeSingle()
        : { data: null };
      if (!mc || !mc.email) { await new Promise((r) => setTimeout(r, 800)); return json({ ok: false, error: "code" }, 403); }
      const { data: mu } = await sbm.from("app_users").select("email,modules,is_admin").ilike("email", mc.email).maybeSingle();
      if (!mu || !(mu.is_admin || (mu.modules || []).includes("mare"))) return json({ ok: false, error: "access" }, 403);
      const { data: mg, error: me } = await sbm.auth.admin.generateLink({ type: "magiclink", email: mc.email });
      if (me || !mg?.properties?.hashed_token) return json({ ok: false, error: "signin" }, 500);
      return json({ ok: true, token_hash: mg.properties.hashed_token, name: mc.name });
    }
    const token = String(body.token || "");
    if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return json({ ok: false, error: "link" }, 400);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: l } = await sb.from("mare_try_links").select("*").eq("token_hash", await sha256(token)).maybeSingle();
    if (!l || l.revoked || new Date(l.expires_at) < new Date()) return json({ ok: false, error: "link" }, 403);
    const { data: u } = await sb.from("app_users").select("email,modules,is_admin").ilike("email", l.email).maybeSingle();
    if (!u || !(u.is_admin || (u.modules || []).includes("mare"))) return json({ ok: false, error: "access" }, 403);
    const { data: g, error } = await sb.auth.admin.generateLink({ type: "magiclink", email: l.email });
    if (error || !g?.properties?.hashed_token) return json({ ok: false, error: "signin" }, 500);
    await sb.from("mare_try_links").update({ uses: (l.uses || 0) + 1, last_used_at: new Date().toISOString() }).eq("token_hash", l.token_hash);
    return json({ ok: true, token_hash: g.properties.hashed_token });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 200) }, 500);
  }
});
