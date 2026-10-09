// mare-learn — Roberto's Mare Learning, server side (9 Oct 2026).
// Francesco: Mare's Learning = its six Montenegrin health & safety topics + the ten Dubai topics that
// also fit Mare ("yes add 10 shared topic"); each test = 20 questions from 5 random topics.
// The shared topics live in the Kitchen project (one place of truth: Danilo/Antonio check, Francesco
// approves). This function fetches them with a key (learn_mare_pool), so no answer ever reaches a
// phone, and builds the test with mare_learn_start_srv (service role only).
//   {action:'home',  device|token, pin} -> the topics to read (no answers) + my results
//   {action:'start', device|token, pin} -> one test (questions without answers)
// Hand-in stays the RPC mare_s_learn_finish.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const K_URL = Deno.env.get("KITCHEN_URL") ?? "";
const K_ANON = Deno.env.get("KITCHEN_ANON") ?? "";
const K_KEY = Deno.env.get("MARE_LEARN_KEY") ?? "";

type Row = Record<string, any>;

async function sharedPool(): Promise<{ ok: boolean; topics: Row[] }> {
  if (!K_URL || !K_ANON || !K_KEY) return { ok: false, topics: [] };
  try {
    const r = await fetch(K_URL + "/rest/v1/rpc/learn_mare_pool", {
      method: "POST",
      headers: { apikey: K_ANON, Authorization: "Bearer " + K_ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: K_KEY }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || !d.ok) { console.log("mare-learn pool failed", r.status, d && d.error); return { ok: false, topics: [] }; }
    return { ok: true, topics: d.topics || [] };
  } catch (e) { console.log("mare-learn pool error", String(e)); return { ok: false, topics: [] }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let b: Row = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "body" }, 400); }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const args = { p_device: b.device ?? null, p_token: b.token ?? null, p_staff: null, p_pin: b.pin ?? null };

  if (b.action === "home") {
    const [home, pool] = await Promise.all([sb.rpc("mare_s_learn_home", args), sharedPool()]);
    if (home.error) return json({ ok: false, error: "error" }, 500);
    const h = home.data as Row;
    if (!h || !h.ok) return json(h || { ok: false, error: "error" });
    const shared = pool.topics.filter((t) => (t.questions || []).length >= 4 || (t.pages || []).length > 0).map((t) => ({
      id: t.id, title: t.title, summary: t.summary, pages: t.pages || [], in_test: (t.questions || []).length >= 4,
    }));
    return json({ ...h, shared, shared_ok: pool.ok });
  }

  if (b.action === "start") {
    const auth = await sb.rpc("mare_s_auth", args);
    if (auth.error) return json({ ok: false, error: "error" }, 500);
    const a = auth.data as Row;
    if (!a || !a.ok) return json(a || { ok: false, error: "error" });
    if (!a.id) return json({ ok: false, error: "staff" });
    const pool = await sharedPool();
    const st = await sb.rpc("mare_learn_start_srv", { p_staff: a.id, p_shared: pool.topics.map((t) => ({ id: t.id, title: t.title, questions: t.questions || [] })) });
    if (st.error) { console.log("mare-learn start error", st.error.message); return json({ ok: false, error: "error" }, 500); }
    return json({ ...(st.data as Row), shared_ok: pool.ok });
  }
  return json({ ok: false, error: "action" }, 400);
});
