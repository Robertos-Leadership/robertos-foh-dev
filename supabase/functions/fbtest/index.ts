// fbtest — Food & Beverage Test, server side (31 Oct 2026).
// Alessandro asked for a knowledge test on the Food & Beverage Bible that measures basic to advanced and
// cannot be copied. So: the 20 questions are BUILT HERE from the live Food Bible data (gen.ts), the answer
// key stays in fbt_attempts and never reaches a phone, questions are sent one at a time, and the clock for
// each question is this server's. Nothing is hand-written, so nothing goes stale when a recipe changes.
//   {action:'me',     emp?, jwt?}              -> who am I, am I a manager (signed-in app login)
//   {action:'start',  emp, code?}              -> start (or resume) one test; a session code makes it official
//   {action:'answer', emp, attempt, pick, away}-> lock the answer, get the next question or the result
//   {action:'result', emp, attempt}            -> the full review of a FINISHED test (own, or admin)
//   {action:'resume', emp}                     -> the unfinished test, if any, clock still running
//   {action:'abandon',emp, attempt}            -> leave a practice test
//   manager (signed-in app login, jwt): 'board' | 'sitting_open' | 'sitting_close'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildTest, publicQ, isRight, rate, CUT } from "./gen.ts";
import type { Data, Q, Dish } from "./gen.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
type Row = Record<string, any>;

const K_URL = Deno.env.get("KITCHEN_URL") ?? "https://zrpglswalgjbtghudmhu.supabase.co";
const K_ANON = Deno.env.get("KITCHEN_ANON") ?? "";
const GRACE_MS = 2500;          // network time between the server sending a question and the phone showing it
const SAT_PRACTICE_STALE_MS = 2 * 3600 * 1000;

const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ---- the Food Bible data, from the Kitchen project, cached for ten minutes -----------------------------------
async function kget(path: string): Promise<Row[]> {
  const r = await fetch(K_URL + "/rest/v1/" + path, { headers: { apikey: K_ANON, Authorization: "Bearer " + K_ANON } });
  if (!r.ok) throw new Error("kitchen " + r.status);
  return await r.json();
}
async function kall(path: string): Promise<Row[]> {
  const out: Row[] = []; const sep = path.includes("?") ? "&" : "?";
  for (let off = 0; off < 20000; off += 1000) {
    const rows = await kget(path + sep + "limit=1000&offset=" + off);
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}
interface Book { data: Data; menus: Row[]; on: Record<string, string[]> }
let CACHE: { at: number; book: Book } | null = null;
async function foodData(): Promise<Book> {
  if (CACHE && Date.now() - CACHE.at < 600000) return CACHE.book;
  const [main, all, links, wines, pairs, menus, rmenus] = await Promise.all([
    kall("recipes?kind=eq.main&archived=is.false&select=id,name,section,method,allergens&order=name"),
    kall("recipes?select=id,allergens&order=id"),
    kall("recipe_lines?child_recipe_id=not.is.null&select=recipe_id,child_recipe_id&order=id"),
    kall("fb_wines?active=is.true&select=id,style,name,region,grapes&order=position"),
    kall("fb_wine_pairings?select=wine_id,recipe_id,rank,why&order=recipe_id"),
    // the menus the Bible lets a reader open: this is what decides which dishes they could have read
    kall("menus?venue_id=eq.robertos-difc&archived=is.false&active=is.true&select=id,name,running,position,parent_id&order=position,name"),
    kall("recipe_menus?select=recipe_id,menu_id&order=recipe_id"),
  ]);
  const ALL: Record<string, Row> = {}; all.forEach((r) => (ALL[r.id] = r));
  const LINKS: Record<string, string[]> = {}; links.forEach((l) => (LINKS[l.recipe_id] = (LINKS[l.recipe_id] || []).concat(l.child_recipe_id)));
  // allergens a dish carries = its own ticks + every sub-recipe's, exactly as food-bible.html withInherited()
  const inherited = (id: string, own: string[]) => {
    const out = (own || []).slice(); const seen: Record<string, number> = {};
    (function walk(i: string) {
      if (!i || seen[i]) return; seen[i] = 1;
      ((ALL[i] && ALL[i].allergens) || []).forEach((k: string) => { if (!out.includes(k)) out.push(k); });
      (LINKS[i] || []).forEach(walk);
    })(id);
    return out;
  };
  const dishes: Dish[] = [];
  main.forEach((r) => {
    const m = r.method || {};
    // no ticks = not used: an untouched allergen row looks the same as "no allergens"
    if (!r.name || !Array.isArray(r.allergens) || !r.allergens.length || !m.ing) return;
    dishes.push({
      id: r.id, name: String(r.name).trim(), section: r.section || "", diet: m.diet === "vegan" || m.diet === "vegetarian" ? m.diet : "",
      all: inherited(r.id, r.allergens), ing: String(m.ing).split("\n").map((s) => s.trim()).filter(Boolean),
    });
  });
  const data: Data = { dishes, wines: wines as any, pairings: pairs as any };
  const on: Record<string, string[]> = {};
  rmenus.forEach((r) => (on[r.recipe_id] = (on[r.recipe_id] || []).concat(r.menu_id)));
  const book: Book = { data, menus, on };
  CACHE = { at: Date.now(), book };
  return book;
}

// What the team could have read: the dishes on one menu (a month inside it counts, as in the Bible's own picker).
// The wines are the whole by-the-glass list, because the Bible's wine side shows all of it.
function scoped(book: Book, menuId: string): Data {
  const kid: Record<string, string> = {}; book.menus.forEach((m) => { if (m.parent_id) kid[m.id] = m.parent_id; });
  const dishes = book.data.dishes.filter((d) => (book.on[d.id] || []).some((id) => id === menuId || kid[id] === menuId));
  return { dishes, wines: book.data.wines, pairings: book.data.pairings };
}
function runningMenu(book: Book): Row | null {
  return book.menus.find((m) => m.running && !m.parent_id) || book.menus.find((m) => m.running) || null;
}
// A menu can be tested on only if a full test can be built from it (small menus cannot)
function eligible(book: Book): Row[] {
  return book.menus.filter((m) => !m.parent_id).filter((m) => {
    const d = scoped(book, m.id);
    if (d.dishes.length < 25) return false;
    try { return buildTest(d, 7).length === 20; } catch (_e) { return false; }
  }).map((m) => ({ id: m.id, name: m.name, running: !!m.running, dishes: scoped(book, m.id).dishes.length }));
}

// ---- who is asking -------------------------------------------------------------------------------------------
const same = (a: unknown, raw: string) => {
  const s = String(a ?? "").trim(); if (!s) return false; if (s === raw) return true;
  const x = parseInt(s, 10), y = parseInt(raw, 10); return !isNaN(x) && !isNaN(y) && x === y;
};
async function staffName(db: ReturnType<typeof sb>, raw: string): Promise<string | null> {
  raw = String(raw ?? "").trim(); if (!raw) return null;
  const f = await db.from("foh_staff").select("name,emp_id").eq("active", true);
  const hit = (f.data || []).find((s: Row) => same(s.emp_id, raw));
  if (hit) return hit.name;
  try { const k = await kget("staff?select=name,emp_id&active=eq.true"); const h2 = k.find((s) => same(s.emp_id, raw)); if (h2) return h2.name; } catch (_e) { /* FOH list already answered */ }
  return null;
}
// A manager is whoever is signed in to the FOH app (their own email + password, the same login as the rest of
// the app) AND is an Admin or has "manager" in their title in app_users. The phone sends its session token;
// it is checked here against Supabase auth, so a typed-in code or a guessed ID opens nothing.
async function adminName(db: ReturnType<typeof sb>, jwt: unknown): Promise<string | null> {
  const t = String(jwt ?? "").trim(); if (t.length < 20) return null;
  const u = await db.auth.getUser(t);
  const email = String(u.data?.user?.email ?? "").trim().toLowerCase(); if (!email) return null;
  const r = await db.from("app_users").select("name,title,is_admin").eq("email", email).limit(1);
  const row: Row | undefined = r.data && r.data[0]; if (!row) return null;
  return row.is_admin || /manager/i.test(String(row.title ?? "")) ? String(row.name || email) : null;
}

// ---- scoring --------------------------------------------------------------------------------------------------
function finish(qs: Q[], ans: Row[]) {
  const by: Record<string, { n: number; r: number; ms: number }> = { Basic: { n: 0, r: 0, ms: 0 }, Intermediate: { n: 0, r: 0, ms: 0 }, Advanced: { n: 0, r: 0, ms: 0 } };
  const area: Record<string, { n: number; r: number }> = {};
  let score = 0, total = 0, away = 0; const flags: string[] = [];
  const late: number[] = [], rushed: number[] = [];
  qs.forEach((q, i) => {
    const a = ans[i] || { pick: null, ms: q.secs * 1000, out: true, away: 0 };
    const right = !a.out && isRight(q, a.pick);
    by[q.level].n++; by[q.level].ms += a.ms; total += a.ms; away += a.away || 0;
    (area[q.area] = area[q.area] || { n: 0, r: 0 }).n++;
    if (right) { score++; by[q.level].r++; area[q.area].r++; if (a.ms > q.secs * 900) late.push(i + 1); if (q.level !== "Basic" && a.ms < 1500) rushed.push(i + 1); }
  });
  if (late.length >= 3) flags.push(`Right in the last 10% of the time on ${late.length} questions (${late.join(", ")}).`);
  if (rushed.length >= 2) flags.push(`Right in under 1.5 seconds on ${rushed.length} harder questions (${rushed.join(", ")}): too fast to have read them.`);
  if (away >= 3) flags.push(`Left the test screen ${away} times.`);
  return { score, by, area, total_ms: total, away, flags, rating: rate(by) };
}

function review(qs: Q[], ans: Row[]) {
  return qs.map((q, i) => {
    const a = ans[i] || { pick: null, ms: 0, out: true };
    return { ...publicQ(q), correct: q.correct, note: q.note, pick: a.pick, ms: a.ms, out: !!a.out, right: !a.out && isRight(q, a.pick) };
  });
}

// ---- the handler ----------------------------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let b: Row = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "body" }, 400); }
  const db = sb();
  const emp = String(b.emp ?? "").trim();
  const action = String(b.action ?? "");

  try {
    if (action === "me") {
      const [name, admin] = await Promise.all([staffName(db, emp), adminName(db, b.jwt)]);
      return json({ ok: true, name: name ?? admin, staff: !!name, admin: !!admin });
    }

    // ------------------------------------------------------------------ manager (app login)
    if (action === "board" || action === "sitting_open" || action === "sitting_close") {
      const who = await adminName(db, b.jwt);
      if (!who) return json({ ok: false, error: "not_admin" }, 403);
      if (action === "sitting_open") {
        const mins = Math.min(480, Math.max(15, parseInt(b.minutes, 10) || 120));
        await db.from("fbt_sittings").update({ active: false }).eq("active", true);
        const code = String(Math.floor(100000 + Math.random() * 900000));
        // the menu the team was trained on: the test draws only from its dishes
        const book = await foodData(); const ok = eligible(book);
        const menu = ok.find((m) => m.id === b.menu) || ok.find((m) => m.running) || ok[0];
        if (!menu) return json({ ok: false, error: "not_ready" });
        const ins = await db.from("fbt_sittings").insert({ code, label: String(b.label ?? "").slice(0, 60) || null, created_by: who, closes_at: new Date(Date.now() + mins * 60000).toISOString(), menu_id: menu.id, menu_name: menu.name }).select("id,code,closes_at,label,menu_name").single();
        if (ins.error) return json({ ok: false, error: "db" }, 500);
        return json({ ok: true, sitting: ins.data });
      }
      if (action === "sitting_close") {
        await db.from("fbt_sittings").update({ active: false }).eq("active", true);
        return json({ ok: true });
      }
      const sit = await db.from("fbt_sittings").select("id,code,label,created_by,created_at,closes_at,active,menu_name").order("created_at", { ascending: false }).limit(10);
      const menus = eligible(await foodData());
      const cur = (sit.data || []).find((s: Row) => s.active && new Date(s.closes_at) > new Date()) || null;
      const pick = b.sitting || (sit.data && sit.data[0] && sit.data[0].id) || null;
      const att = await db.from("fbt_attempts").select("id,emp_id,name,mode,sitting_id,started_at,finished_at,score,by_level,rating,total_ms,away,flags")
        .eq("mode", "official").eq("sitting_id", pick ?? "00000000-0000-0000-0000-000000000000").order("score", { ascending: false });
      const rows = (att.data || []).slice().sort((x: Row, y: Row) => (y.score ?? -1) - (x.score ?? -1) || (x.total_ms ?? 1e12) - (y.total_ms ?? 1e12));
      const staff = await db.from("foh_staff").select("name,emp_id").eq("active", true);
      const sat = new Set(rows.map((r: Row) => String(r.emp_id)));
      const notYet = (staff.data || []).filter((s: Row) => !sat.has(String(s.emp_id).trim())).map((s: Row) => s.name);
      const prac = await db.from("fbt_attempts").select("emp_id,name,score,rating,started_at").eq("mode", "practice").not("finished_at", "is", null).order("started_at", { ascending: false }).limit(40);
      return json({ ok: true, by: who, current: cur, sittings: sit.data || [], menus, viewing: pick, rows, not_yet: notYet, practice: prac.data || [], cut: CUT });
    }

    // an admin reads any finished test; a person reads their own (below)
    if (action === "result" && b.jwt) {
      const adm = await adminName(db, b.jwt);
      if (!adm) return json({ ok: false, error: "not_admin" }, 403);
      const got = await db.from("fbt_attempts").select("*").eq("id", String(b.attempt ?? "")).limit(1);
      const at: Row | undefined = got.data && got.data[0];
      if (!at || !at.finished_at) return json({ ok: false, error: "no_attempt" });
      return json({ ok: true, result: resultOf(at, finish(at.qs, at.answers), at.answers) });
    }

    // ------------------------------------------------------------------ staff
    const name = await staffName(db, emp);
    if (!name) return json({ ok: false, error: "no_emp" });

    if (action === "resume") {
      // page reload in the middle of a test: same question, the clock has kept running
      const open = await db.from("fbt_attempts").select("*").eq("emp_id", emp).is("finished_at", null).order("started_at", { ascending: false }).limit(1);
      const at: Row | undefined = open.data && open.data[0];
      if (!at || (at.mode === "practice" && Date.now() - new Date(at.started_at).getTime() > SAT_PRACTICE_STALE_MS)) return json({ ok: true, resumed: false });
      return json(frame(at, true));
    }

    if (action === "start") {
      // one unfinished test at a time: asking again gives the same one back, with the clock still running
      const open = await db.from("fbt_attempts").select("*").eq("emp_id", emp).is("finished_at", null).order("started_at", { ascending: false }).limit(1);
      let at: Row | null = (open.data && open.data[0]) || null;
      if (at && at.mode === "practice" && Date.now() - new Date(at.started_at).getTime() > SAT_PRACTICE_STALE_MS) {
        await db.from("fbt_attempts").update({ finished_at: new Date().toISOString(), rating: "Abandoned" }).eq("id", at.id); at = null;
      }
      if (at) return json(frame(at, true));
      let mode = "practice", sittingId: string | null = null, menuId: string | null = null;
      const code = String(b.code ?? "").trim();
      if (code) {
        const s = await db.from("fbt_sittings").select("id,code,closes_at,menu_id").eq("active", true).eq("code", code).gt("closes_at", new Date().toISOString()).limit(1);
        if (!s.data || !s.data[0]) return json({ ok: false, error: "bad_code" });
        const dup = await db.from("fbt_attempts").select("id").eq("emp_id", emp).eq("sitting_id", s.data[0].id).limit(1);
        if (dup.data && dup.data[0]) return json({ ok: false, error: "already_sat" });
        mode = "official"; sittingId = s.data[0].id; menuId = s.data[0].menu_id;
      }
      const book = await foodData();
      const menu = book.menus.find((m) => m.id === menuId) || runningMenu(book);
      if (!menu) return json({ ok: false, error: "not_ready" });
      const data = scoped(book, menu.id);
      if (data.dishes.length < 25 || data.wines.length < 8) return json({ ok: false, error: "not_ready" });
      const qs = buildTest(data, Math.floor(Math.random() * 4294967295));
      if (qs.length !== 20) return json({ ok: false, error: "not_ready" });
      const ins = await db.from("fbt_attempts").insert({ emp_id: emp, name, mode, sitting_id: sittingId, menu_id: menu.id, menu_name: menu.name, qs }).select("*").single();
      if (ins.error) { console.log("fbtest insert", ins.error.message); return json({ ok: false, error: "db" }, 500); }
      return json(frame(ins.data, false));
    }

    if (action === "answer") {
      const got = await db.from("fbt_attempts").select("*").eq("id", String(b.attempt ?? "")).limit(1);
      const at: Row | undefined = got.data && got.data[0];
      if (!at || String(at.emp_id) !== emp) return json({ ok: false, error: "no_attempt" });
      if (at.finished_at) return json({ ok: false, error: "finished" });
      // the phone says which question it is answering; a late or repeated request for an earlier one is refused
      if (b.idx !== undefined && Number(b.idx) !== at.cur) return json({ ok: false, error: "stale" });
      const qs: Q[] = at.qs; const i: number = at.cur; const q = qs[i];
      const ms = Date.now() - new Date(at.sent_at).getTime();
      const out = ms > q.secs * 1000 + GRACE_MS;
      const entry = { pick: out ? null : (b.pick ?? null), ms: Math.min(ms, q.secs * 1000), out, away: Math.min(20, Math.max(0, parseInt(b.away, 10) || 0)) };
      const ans = (at.answers as Row[]).concat(entry);
      if (i + 1 < qs.length) {
        // optimistic: only the request that still sees this question on screen may move it on
        const up = await db.from("fbt_attempts").update({ answers: ans, cur: i + 1, sent_at: new Date().toISOString() }).eq("id", at.id).eq("cur", i).select("*");
        if (up.error || !up.data || !up.data[0]) return json({ ok: false, error: "stale" });
        return json({ ...frame(up.data[0], false), prev: { out } });
      }
      const f = finish(qs, ans);
      const up = await db.from("fbt_attempts").update({
        answers: ans, cur: qs.length, finished_at: new Date().toISOString(), score: f.score, by_level: { ...f.by, area: f.area }, rating: f.rating, total_ms: f.total_ms, away: f.away, flags: f.flags,
      }).eq("id", at.id).eq("cur", i).select("id");
      if (up.error || !up.data || !up.data[0]) return json({ ok: false, error: "stale" });
      return json({ ok: true, done: true, prev: { out }, result: resultOf(at, f, ans) });
    }

    if (action === "result") {
      const got = await db.from("fbt_attempts").select("*").eq("id", String(b.attempt ?? "")).limit(1);
      const at: Row | undefined = got.data && got.data[0];
      const adm = at ? await adminName(db, b.jwt) : null;
      if (!at || (String(at.emp_id) !== emp && !adm)) return json({ ok: false, error: "no_attempt" });
      if (!at.finished_at) return json({ ok: false, error: "not_finished" });
      const f = finish(at.qs, at.answers);
      return json({ ok: true, result: resultOf(at, f, at.answers) });
    }

    if (action === "abandon") {
      const got = await db.from("fbt_attempts").select("id,emp_id,mode,finished_at").eq("id", String(b.attempt ?? "")).limit(1);
      const at: Row | undefined = got.data && got.data[0];
      if (!at || String(at.emp_id) !== emp || at.finished_at) return json({ ok: false, error: "no_attempt" });
      if (at.mode !== "practice") return json({ ok: false, error: "official" });   // an official test cannot be re-rolled by walking away
      await db.from("fbt_attempts").update({ finished_at: new Date().toISOString(), rating: "Abandoned" }).eq("id", at.id);
      return json({ ok: true });
    }
    return json({ ok: false, error: "action" }, 400);
  } catch (e) {
    console.log("fbtest error", String(e));
    return json({ ok: false, error: "error" }, 500);
  }
});

// the question on screen, without its answer, and how long it has left by the server's clock
function frame(at: Row, resumed: boolean) {
  const q: Q = at.qs[at.cur];
  const left = Math.max(0, q.secs * 1000 - (Date.now() - new Date(at.sent_at).getTime()));
  return { ok: true, attempt: at.id, mode: at.mode, menu: at.menu_name || null, resumed, idx: at.cur, total: at.qs.length, left_ms: left, q: publicQ(q) };
}
function resultOf(at: Row, f: ReturnType<typeof finish>, ans: Row[]) {
  return { attempt: at.id, mode: at.mode, menu: at.menu_name || null, name: at.name, score: f.score, total: at.qs.length, rating: f.rating, by: f.by, area: f.area, total_ms: f.total_ms, cut: CUT, review: review(at.qs, ans) };
}
