// learn — FOH Learning section, server side (2 Nov 2026). Same engine as the Food & Beverage test (fbtest):
// questions are BUILT here from the live Food Bible and wine list, the answer key never reaches a phone,
// the clock is the server's. A topic reaches the team only after it is checked (by the job title that owns it)
// and approved (an Admin). Pass = 4 of 5; retakes unlimited, best kept; Allergens expire after 12 months.
//   me | start | answer | result | resume | abandon     staff, by Employee ID (foh_staff only)
//   check (checker's Employee ID or app login) | approve | reopen (Admin app login) | board (manager app login)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildTopic, publicQ, isRight, QUESTIONS_PER_TEST, PASS_MARK } from "./gen.ts";
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
interface Book { data: Data; menus: Row[]; on: Record<string, string[]>; allWines: Row[] }
let CACHE: { at: number; book: Book } | null = null;
async function foodData(): Promise<Book> {
  if (CACHE && Date.now() - CACHE.at < 600000) return CACHE.book;
  const [main, all, links, wines, pairs, menus, rmenus] = await Promise.all([
    kall("recipes?kind=eq.main&archived=is.false&select=id,name,section,method,allergens&order=name"),
    kall("recipes?select=id,allergens&order=id"),
    kall("recipe_lines?child_recipe_id=not.is.null&select=recipe_id,child_recipe_id&order=id"),
    kall("fb_wines?select=id,style,name,region,grapes,notes,edition,active&order=position"),
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
      // the other things the Bible page shows a reader: the guest description, the story, the garnish, the service note
      desc: String(m.foh || "").trim(), story: String(m.story || "").trim(),
      garnish: String(m.garnish || "").split("\n").map((s) => s.trim()).filter(Boolean), more: String(m.more || "").trim(),
    });
  });
  const data: Data = { dishes, wines: wines as any, pairings: pairs as any };
  const on: Record<string, string[]> = {};
  rmenus.forEach((r) => (on[r.recipe_id] = (on[r.recipe_id] || []).concat(r.menu_id)));
  const book: Book = { data, menus, on, allWines: wines };
  CACHE = { at: Date.now(), book };
  return book;
}

// What the team could have read: the dishes on one menu (a month inside it counts, as in the Bible's own picker).
// The wines are the whole by-the-glass list, because the Bible's wine side shows all of it.
// ---- the wine test setup the sommelier keeps: which edition the Wine test is built from, and which wines are left out --
interface WineSet { edition: string; off: string[] }
async function wineSet(db: ReturnType<typeof sb>): Promise<WineSet> {
  const r = await db.from("learn_settings").select("key,val").in("key", ["wine_edition", "wine_off"]);
  const g = (k: string) => ((r.data || []).find((x: Row) => x.key === k) || {}).val;
  return { edition: typeof g("wine_edition") === "string" ? g("wine_edition") : "", off: Array.isArray(g("wine_off")) ? g("wine_off") : [] };
}
// no edition chosen = the Kitchen's own active wines, as before
function testWines(book: Book, set: WineSet): Row[] {
  return book.allWines.filter((w) => (set.edition ? w.edition === set.edition : w.active) && !set.off.includes(w.id));
}
function scoped(book: Book, menuId: string, set: WineSet): Data {
  const kid: Record<string, string> = {}; book.menus.forEach((m) => { if (m.parent_id) kid[m.id] = m.parent_id; });
  const dishes = book.data.dishes.filter((d) => (book.on[d.id] || []).some((id) => id === menuId || kid[id] === menuId));
  return { dishes, wines: testWines(book, set) as any, pairings: book.data.pairings };
}
function runningMenu(book: Book): Row | null {
  return book.menus.find((m) => m.running && !m.parent_id) || book.menus.find((m) => m.running) || null;
}
// ---- who is asking -------------------------------------------------------------------------------------------
const same = (a: unknown, raw: string) => {
  const s = String(a ?? "").trim(); if (!s) return false; if (s === raw) return true;
  const x = parseInt(s, 10), y = parseInt(raw, 10); return !isNaN(x) && !isNaN(y) && x === y;
};

// ---- who is asking: FOH staff only (the Kitchen's own Learning is separate) -------------------------------------
async function fohStaff(db: ReturnType<typeof sb>, raw: string): Promise<{ name: string; role: string } | null> {
  raw = String(raw ?? "").trim(); if (!raw) return null;
  const f = await db.from("foh_staff").select("name,emp_id,role").eq("active", true);
  const hit = (f.data || []).find((s: Row) => same(s.emp_id, raw));
  return hit ? { name: String(hit.name), role: String(hit.role ?? "") } : null;
}
// the master codes open every module for viewing (Francesco's standing rule): 1212 and the personal codes checked in
// the database. A master code READS (the team board); it never takes a test, checks or approves.
async function masterName(db: ReturnType<typeof sb>, raw: unknown): Promise<string | null> {
  const c = String(raw ?? "").trim(); if (!c) return null;
  if (c === "1212") return "Admin";
  try { const r = await db.rpc("foh_master_check", { p_code: c }); return r && typeof r.data === "string" && r.data ? r.data : null; } catch (_e) { return null; }
}
async function appUser(db: ReturnType<typeof sb>, jwt: unknown): Promise<{ name: string; title: string; admin: boolean; manager: boolean } | null> {
  const t = String(jwt ?? "").trim(); if (t.length < 20) return null;
  const u = await db.auth.getUser(t);
  const email = String(u.data?.user?.email ?? "").trim().toLowerCase(); if (!email) return null;
  const r = await db.from("app_users").select("name,title,is_admin").eq("email", email).limit(1);
  const row = ((r.data && r.data[0]) || undefined) as Row | undefined; if (!row) return null;
  const title = String(row.title ?? "");
  return { name: String(row.name || email), title, admin: !!row.is_admin, manager: !!row.is_admin || /manager/i.test(title) };
}

// ---- who must pass what (Alessandro, 2 Nov 2026: compulsory for ALL FOH staff) -------------------------------------
// Everyone on the floor passes the menu and the allergens. Wine by the glass is also required of everyone who
// serves or pours it: waiters, supervisors, managers, sommeliers and the bar. Hosts, reservations, reception,
// runners and the cashier are not asked for wine. Housekeeping, security, maintenance, consultants and the
// chairman are not floor staff, so nothing is required of them (they can still take any topic).
export function requiredFor(role: string): string[] {
  const r = role.toLowerCase();
  if (/housekeep|security|maintenance|consultant|chairman/.test(r)) return [];
  const out = ["alacarte", "allergens"];
  if (!/host|reserv|reception|runner|cashier/.test(r)) out.push("wine");
  return out;
}

const PASS_VALID = (t: Row, at: string) => !t.expires_months || Date.now() < new Date(at).setMonth(new Date(at).getMonth() + t.expires_months);

// a topic's state for one person, from their finished attempts
function stateOf(t: Row, atts: Row[]) {
  const mine = atts.filter((a) => a.topic === t.key && a.finished_at);
  const passes = mine.filter((a) => a.passed).sort((x, y) => new Date(y.finished_at).getTime() - new Date(x.finished_at).getTime());
  const best = mine.slice().sort((x, y) => (y.score ?? 0) - (x.score ?? 0) || (x.total_ms ?? 1e12) - (y.total_ms ?? 1e12))[0] || null;
  const last = passes[0] || null;
  let state = "not_yet";
  if (last) state = PASS_VALID(t, last.finished_at) ? "passed" : "expired";
  else if (mine.length) state = "tried";
  const expires = last && t.expires_months ? new Date(new Date(last.finished_at).setMonth(new Date(last.finished_at).getMonth() + t.expires_months)).toISOString() : null;
  return { state, tries: mine.length, best: best ? { score: best.score, ms: best.total_ms } : null, passed_at: last ? last.finished_at : null, expires };
}

function mark(qs: Q[], ans: Row[]) {
  let score = 0, total = 0, away = 0;
  qs.forEach((q, i) => {
    const a = ans[i] || { pick: null, ms: q.secs * 1000, out: true, away: 0 };
    total += a.ms; away += a.away || 0;
    if (!a.out && isRight(q, a.pick)) score++;
  });
  return { score, total_ms: total, away, passed: score >= PASS_MARK };
}
function review(qs: Q[], ans: Row[]) {
  return qs.map((q, i) => {
    const a = ans[i] || { pick: null, ms: 0, out: true };
    return { ...publicQ(q), correct: q.correct, note: q.note, pick: a.pick, ms: a.ms, out: !!a.out, right: !a.out && isRight(q, a.pick) };
  });
}
function resultOf(at: Row, topic: Row, m: ReturnType<typeof mark>, ans: Row[]) {
  return { attempt: at.id, topic: topic.key, topic_name: topic.name, name: at.name, score: m.score, total: at.qs.length, pass_mark: PASS_MARK, passed: m.passed, total_ms: m.total_ms, review: review(at.qs, ans) };
}
function frame(at: Row, topic: Row, resumed: boolean) {
  const q: Q = at.qs[at.cur];
  const left = Math.max(0, q.secs * 1000 - (Date.now() - new Date(at.sent_at).getTime()));
  return { ok: true, attempt: at.id, topic: topic.key, topic_name: topic.name, resumed, idx: at.cur, total: at.qs.length, left_ms: left, q: publicQ(q) };
}

// ---- the handler -----------------------------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let b: Row = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "body" }, 400); }
  const db = sb();
  const emp = String(b.emp ?? "").trim();
  const action = String(b.action ?? "");
  try {
    const topicsQ = await db.from("learn_topics").select("*").order("position");
    const TOPICS: Row[] = topicsQ.data || [];
    const topicOf = (k: unknown) => TOPICS.find((t) => t.key === String(k ?? ""));
    const open = (t: Row) => t.built && t.status === "approved";

    // ----------------------------------------------------------------- who am I, and what is on my list
    if (action === "me") {
      const [st, au, mn] = await Promise.all([fohStaff(db, emp), appUser(db, b.jwt), masterName(db, emp)]);
      if (!st && !au && !mn) return json({ ok: false, error: "no_emp" });
      const out: Row = { ok: true, name: st ? st.name : au ? au.name : mn, staff: !!st, manager: !!au?.manager || (!st && !!mn), admin: !!au?.admin, master: !st && !!mn };
      if (st) {
        const at = await db.from("learn_attempts").select("topic,finished_at,score,passed,total_ms").eq("emp_id", emp).not("finished_at", "is", null);
        const need = requiredFor(st.role);
        out.role = st.role;
        out.topics = TOPICS.map((t) => ({ key: t.key, name: t.name, blurb: t.blurb, open: open(t), required: need.includes(t.key), expires_months: t.expires_months, ...stateOf(t, at.data || []) }));
      }
      // a checker (by job title) sees the topics waiting for their check; an Admin sees the ones waiting for approval
      const mayCheck = (t: Row) => !!((st && new RegExp(t.checker_re, "i").test(st.role)) || (au && new RegExp(t.checker_re, "i").test(au.title)));
      out.wine_editor = !!((st && /sommelier/i.test(st.role)) || (au && (au.admin || /sommelier/i.test(au.title))));
      out.review = TOPICS.filter((t) => t.built).map((t) => ({ key: t.key, name: t.name, status: t.status, checker_for: t.checker_for, checked_by: t.checked_by, approved_by: t.approved_by,
        mine: mayCheck(t), can_check: mayCheck(t) && t.status === "draft", can_approve: !!au?.admin && t.status === "checked", can_reopen: !!au?.admin && t.status !== "draft" })).filter((x) => x.can_check || x.can_approve || x.can_reopen || x.mine || (au && au.manager));
      return json(out);
    }

    // ----------------------------------------------------------------- the gate: check, approve, reopen
    if (action === "check" || action === "approve" || action === "reopen") {
      const t = topicOf(b.topic); if (!t || !t.built) return json({ ok: false, error: "no_topic" });
      const [st, au] = await Promise.all([fohStaff(db, emp), appUser(db, b.jwt)]);
      const re = new RegExp(t.checker_re, "i");
      if (action === "check") {
        const who = st && re.test(st.role) ? st.name : au && re.test(au.title) ? au.name : null;
        if (!who) return json({ ok: false, error: "not_checker" }, 403);
        if (t.status !== "draft") return json({ ok: false, error: "state" });
        const up = await db.from("learn_topics").update({ status: "checked", checked_by: who, checked_at: new Date().toISOString() }).eq("key", t.key).eq("status", "draft").select("key");
        return json({ ok: !!(up.data && up.data[0]) });
      }
      if (!au || !au.admin) return json({ ok: false, error: "not_admin" }, 403);
      if (action === "approve") {
        if (t.status !== "checked") return json({ ok: false, error: "state" });
        const up = await db.from("learn_topics").update({ status: "approved", approved_by: au.name, approved_at: new Date().toISOString() }).eq("key", t.key).eq("status", "checked").select("key");
        return json({ ok: !!(up.data && up.data[0]) });
      }
      const up = await db.from("learn_topics").update({ status: "draft", checked_by: null, checked_at: null, approved_by: null, approved_at: null }).eq("key", t.key).select("key");
      return json({ ok: !!(up.data && up.data[0]) });
    }

    // ----------------------------------------------------------------- a checker (or Admin) reads a fresh sample WITH the answers
    if (action === "sample") {
      const t = topicOf(b.topic); if (!t || !t.built) return json({ ok: false, error: "no_topic" });
      const [st, au] = await Promise.all([fohStaff(db, emp), appUser(db, b.jwt)]);
      const re = new RegExp(t.checker_re, "i");
      if (!((st && re.test(st.role)) || (au && (au.admin || re.test(au.title))))) return json({ ok: false, error: "not_checker" }, 403);
      const book = await foodData();
      const menu = book.menus.find((m) => m.running && /a la carte/i.test(String(m.name))) || runningMenu(book);
      if (!menu) return json({ ok: false, error: "not_ready" });
      const qs = buildTopic(scoped(book, menu.id, await wineSet(db)), t.key, Math.floor(Math.random() * 4294967295), 10);
      return json({ ok: true, topic: t.key, topic_name: t.name, menu: menu.name, review: qs.map((q) => ({ ...publicQ(q), correct: q.correct, note: q.note })) });
    }

    // ----------------------------------------------------------------- the sommelier keeps the wine test setup
    if (action === "wines" || action === "wine_set") {
      const [st, au] = await Promise.all([fohStaff(db, emp), appUser(db, b.jwt)]);
      const who = st && /sommelier/i.test(st.role) ? st.name : au && (au.admin || /sommelier/i.test(au.title)) ? au.name : null;
      if (!who) return json({ ok: false, error: "not_sommelier" }, 403);
      const book = await foodData();
      const eds = Array.from(new Set(book.allWines.map((w) => String(w.edition)))).sort();
      const activeEd = (book.allWines.find((w) => w.active) || {}).edition || "";
      let reset = false;
      if (action === "wine_set") {
        const cur = await wineSet(db);
        const now = new Date().toISOString();
        if (typeof b.edition === "string" && b.edition !== (cur.edition || activeEd)) {
          if (!eds.includes(b.edition)) return json({ ok: false, error: "no_edition" });
          const w = await db.from("learn_settings").upsert({ key: "wine_edition", val: b.edition, by: who, at: now });
          if (w.error) return json({ ok: false, error: "db" }, 500);
          // a different list is new content: it has to be checked again before the team sees it
          const t = TOPICS.find((x) => x.key === "wine");
          if (t && t.status !== "draft") { await db.from("learn_topics").update({ status: "draft", checked_by: null, checked_at: null, approved_by: null, approved_at: null }).eq("key", "wine"); t.status = "draft"; reset = true; }
        }
        if (Array.isArray(b.off)) {
          const ids = new Set(book.allWines.map((w) => w.id));
          const off = b.off.map(String).filter((id: string) => ids.has(id));
          const w = await db.from("learn_settings").upsert({ key: "wine_off", val: off, by: who, at: now });
          if (w.error) return json({ ok: false, error: "db" }, 500);
        }
        CACHE = null;
      }
      const set = await wineSet(db);
      const ed = set.edition || activeEd;
      const inTest = testWines(book, set);
      const pairCount = (id: string) => book.data.pairings.filter((p: Row) => p.wine_id === id).length;
      let can = false;
      const menu = book.menus.find((m) => m.running && /a la carte/i.test(String(m.name))) || runningMenu(book);
      if (menu) { try { can = inTest.length >= 8 && buildTopic(scoped(book, menu.id, set), "wine", 1).length === QUESTIONS_PER_TEST; } catch (_e) { can = false; } }
      const wt = TOPICS.find((x) => x.key === "wine");
      return json({ ok: true, by: who, edition: ed, editions: eds.map((e) => ({ edition: e, n: book.allWines.filter((w) => w.edition === e).length, active: book.allWines.some((w) => w.edition === e && w.active) })),
        status: wt ? wt.status : "draft", reset, can_build: can, in_test: inTest.length, off: set.off,
        wines: book.allWines.filter((w) => w.edition === ed).map((w) => ({ id: w.id, name: w.name, style: w.style, region: w.region, pairs: pairCount(w.id), out: set.off.includes(w.id) })) });
    }

    // ----------------------------------------------------------------- managers: who has passed what, scores and times
    if (action === "board") {
      const au = await appUser(db, b.jwt);
      const mn = au ? null : await masterName(db, emp);
      if ((!au || !au.manager) && !mn) return json({ ok: false, error: "not_manager" }, 403);
      const [sf, at] = await Promise.all([
        db.from("foh_staff").select("name,emp_id,role").eq("active", true).order("name"),
        db.from("learn_attempts").select("emp_id,topic,finished_at,score,passed,total_ms").not("finished_at", "is", null),
      ]);
      const live = TOPICS.filter(open);
      const rows = (sf.data || []).map((s: Row) => {
        const mine = (at.data || []).filter((a: Row) => String(a.emp_id) === String(s.emp_id).trim());
        const need = requiredFor(String(s.role ?? ""));
        return { name: s.name, role: s.role, topics: live.map((t) => ({ key: t.key, required: need.includes(t.key), ...stateOf(t, mine) })) };
      }).filter((r: Row) => r.topics.some((t: Row) => t.required || t.state !== "not_yet"));
      return json({ ok: true, by: au ? au.name : mn, topics: live.map((t) => ({ key: t.key, name: t.name })), rows, waiting: TOPICS.filter((t) => t.built && !open(t)).map((t) => ({ key: t.key, name: t.name, status: t.status })) });
    }

    // ----------------------------------------------------------------- staff taking a test
    const st = await fohStaff(db, emp);
    if (!st) return json({ ok: false, error: "no_emp" });

    if (action === "resume") {
      const o = await db.from("learn_attempts").select("*").eq("emp_id", emp).is("finished_at", null).order("started_at", { ascending: false }).limit(1);
      const at: Row | undefined = o.data && o.data[0]; if (!at) return json({ ok: true, resumed: false });
      const t = topicOf(at.topic); if (!t) return json({ ok: true, resumed: false });
      return json(frame(at, t, true));
    }

    if (action === "start") {
      const o = await db.from("learn_attempts").select("*").eq("emp_id", emp).is("finished_at", null).order("started_at", { ascending: false }).limit(1);
      const cur: Row | undefined = o.data && o.data[0];
      if (cur) { const t0 = topicOf(cur.topic); if (t0) return json(frame(cur, t0, true)); }
      const t = topicOf(b.topic); if (!t) return json({ ok: false, error: "no_topic" });
      if (!open(t)) return json({ ok: false, error: "coming_soon" });   // nothing unchecked reaches the team
      const book = await foodData();
      const menu = book.menus.find((m) => m.running && /a la carte/i.test(String(m.name))) || runningMenu(book);
      if (!menu) return json({ ok: false, error: "not_ready" });
      const data = scoped(book, menu.id, await wineSet(db));
      if (data.dishes.length < 25 || data.wines.length < 8) return json({ ok: false, error: "not_ready" });
      const qs = buildTopic(data, t.key, Math.floor(Math.random() * 4294967295));
      if (qs.length !== QUESTIONS_PER_TEST) return json({ ok: false, error: "not_ready" });
      const ins = await db.from("learn_attempts").insert({ emp_id: emp, name: st.name, role: st.role, topic: t.key, qs }).select("*").single();
      if (ins.error) { console.log("learn insert", ins.error.message); return json({ ok: false, error: "db" }, 500); }
      return json(frame(ins.data, t, false));
    }

    if (action === "answer") {
      const got = await db.from("learn_attempts").select("*").eq("id", String(b.attempt ?? "")).limit(1);
      const at = ((got.data && got.data[0]) || undefined) as Row | undefined;
      if (!at || String(at.emp_id) !== emp) return json({ ok: false, error: "no_attempt" });
      if (at.finished_at) return json({ ok: false, error: "finished" });
      if (b.idx !== undefined && Number(b.idx) !== at.cur) return json({ ok: false, error: "stale" });
      const t = topicOf(at.topic)!;
      const qs: Q[] = at.qs; const i: number = at.cur; const q = qs[i];
      const ms = Date.now() - new Date(at.sent_at).getTime();
      const out = ms > q.secs * 1000 + GRACE_MS;
      const entry = { pick: out ? null : (b.pick ?? null), ms: Math.min(ms, q.secs * 1000), out, away: Math.min(20, Math.max(0, parseInt(b.away, 10) || 0)) };
      const ans = (at.answers as Row[]).concat(entry);
      if (i + 1 < qs.length) {
        const up = await db.from("learn_attempts").update({ answers: ans, cur: i + 1, sent_at: new Date().toISOString() }).eq("id", at.id).eq("cur", i).select("*");
        if (up.error || !up.data || !up.data[0]) return json({ ok: false, error: "stale" });
        return json({ ...frame(up.data[0], t, false), prev: { out } });
      }
      const m = mark(qs, ans);
      const up = await db.from("learn_attempts").update({ answers: ans, cur: qs.length, finished_at: new Date().toISOString(), score: m.score, passed: m.passed, total_ms: m.total_ms, away: m.away }).eq("id", at.id).eq("cur", i).select("id");
      if (up.error || !up.data || !up.data[0]) return json({ ok: false, error: "stale" });
      return json({ ok: true, done: true, prev: { out }, result: resultOf(at, t, m, ans) });
    }

    if (action === "result") {
      const got = await db.from("learn_attempts").select("*").eq("id", String(b.attempt ?? "")).limit(1);
      const at = ((got.data && got.data[0]) || undefined) as Row | undefined;
      if (!at || String(at.emp_id) !== emp) return json({ ok: false, error: "no_attempt" });
      if (!at.finished_at) return json({ ok: false, error: "not_finished" });
      return json({ ok: true, result: resultOf(at, topicOf(at.topic)!, mark(at.qs, at.answers), at.answers) });
    }

    if (action === "abandon") {
      const got = await db.from("learn_attempts").select("id,emp_id,finished_at").eq("id", String(b.attempt ?? "")).limit(1);
      const at = ((got.data && got.data[0]) || undefined) as Row | undefined;
      if (!at || String(at.emp_id) !== emp || at.finished_at) return json({ ok: false, error: "no_attempt" });
      await db.from("learn_attempts").update({ finished_at: new Date().toISOString(), score: 0, passed: false, total_ms: 0 }).eq("id", at.id);
      return json({ ok: true });
    }
    return json({ ok: false, error: "action" }, 400);
  } catch (e) {
    console.log("learn error", String(e));
    return json({ ok: false, error: "error" }, 500);
  }
});
