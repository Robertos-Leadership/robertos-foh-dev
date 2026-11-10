// sop — FOH "How we work": the SOPs and policies, read and signed (10 Nov 2026).
// A sign-off = the person opened the document and stayed long enough for its length (server clock), answered its
// two questions right, and typed their Employee ID again. Each position has its own list, rolled out week by week.
// The answer key never reaches a phone. Questions are draft until a manager checks them; until then nobody can sign.
//   me | doc | sign                         staff, by Employee ID (foh_staff, active)
//   me | doc | check | qsave | board        checker: Management-section Employee ID, a manager's app login, or a master code
//   seed                                    the SOP pack import (first fill of an empty library, then Admin app login only)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
type Row = Record<string, any>;
const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type DB = ReturnType<typeof sb>;

// ---- who is asking ----------------------------------------------------------------------------------------------
const same = (a: unknown, raw: string) => {
  const s = String(a ?? "").trim(); if (!s) return false; if (s === raw) return true;
  const x = parseInt(s, 10), y = parseInt(raw, 10); return !isNaN(x) && !isNaN(y) && x === y;
};
async function fohStaff(db: DB, raw: string): Promise<Row | null> {
  raw = String(raw ?? "").trim(); if (!raw) return null;
  const f = await db.from("foh_staff").select("name,emp_id,role,section,end_date").eq("active", true);
  const hit = (f.data || []).find((s: Row) => same(s.emp_id, raw) && !s.end_date);
  return hit ? { name: String(hit.name), emp: String(hit.emp_id), role: String(hit.role ?? ""), section: String(hit.section ?? "") } : null;
}
// 1212 and the personal master codes open every module with full rights (Francesco's standing rule).
async function masterName(db: DB, raw: unknown): Promise<string | null> {
  const c = String(raw ?? "").trim(); if (!c) return null;
  if (c === "1212") return "Admin";
  try { const r = await db.rpc("foh_master_check", { p_code: c }); return r && typeof r.data === "string" && r.data ? r.data : null; } catch (_e) { return null; }
}
async function appUser(db: DB, jwt: unknown): Promise<Row | null> {
  const t = String(jwt ?? "").trim(); if (t.length < 20) return null;
  const u = await db.auth.getUser(t);
  const email = String(u.data?.user?.email ?? "").trim().toLowerCase(); if (!email) return null;
  const r = await db.from("app_users").select("name,title,is_admin").eq("email", email).limit(1);
  const row = (r.data && r.data[0]) as Row | undefined; if (!row) return null;
  const title = String(row.title ?? "");
  return { name: String(row.name || email), title, admin: !!row.is_admin, manager: !!row.is_admin || /manager/i.test(title) };
}

// ---- position → list (sop_map.grp), from the staff list's section and job title ----------------------------------
export function grpOf(section: string, role: string): string | null {
  const s = section.toLowerCase(), r = role.toLowerCase();
  if (/management/.test(s)) return "manager";
  if (/hostess|reception/.test(s)) return "host";
  if (/head waiter/.test(s) || /supervisor/.test(r) && /restaurant/.test(s)) return "service_lead";
  if (/waiter|waitress|restaurant/.test(s)) return "service";
  if (/runner/.test(s)) return "runner";
  if (/bar/.test(s)) {
    if (/sommelier/.test(r)) return "sommelier";
    if (/barista|barback/.test(r)) return "barista";
    if (/supervisor/.test(r)) return "bar_lead";
    return "bar";
  }
  if (/cashier/.test(s)) return "cashier";
  if (/security/.test(s)) return "security";
  return null;   // housekeeping and anyone else: nothing required, they can still read
}
export const GRP_NAME: Record<string, string> = {
  host: "Hostess and reservations", service: "Dining room", service_lead: "Head waiters and supervisors", runner: "Runners",
  bar: "Bar", bar_lead: "Bar supervisor", sommelier: "Sommeliers", barista: "Baristas and barbacks", cashier: "Cashiers",
  security: "Security", manager: "Managers",
};

// ---- discounts and comps: supervisors, managers and cashiers only (everyone else does not see them in the library)
export const RESTRICTED = ["RBT-RST-POL-005", "RBT-LNG-POL-007"];
const SEES_RESTRICTED = ["manager", "service_lead", "bar_lead", "cashier"];

// ---- the reading clock: long enough for the text, never silly -------------------------------------------------------
export const minReadMs = (words: number) => Math.min(120000, Math.max(15000, Math.round(words * 120)));

// ---- Dubai dates and the weekly roll-out ----------------------------------------------------------------------------
const dubaiToday = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function weeksOf(start: string, today: string, rows: { week: number; done: boolean }[]) {
  const n = rows.reduce((m, r) => Math.max(m, r.week), 0);
  const out: Row[] = []; let prevDone: boolean = true;
  for (let w = 1; w <= n; w++) {
    const mine = rows.filter((r) => r.week === w);
    const opens = addDays(start, 7 * (w - 1)), due = addDays(start, 7 * w - 1);
    const open: boolean = today >= opens || prevDone;              // a week opens on its date, or early once the one before is done
    const done = mine.filter((r) => r.done).length;
    out.push({ n: w, opens, due, open, done, total: mine.length, late: open && today > due && done < mine.length });
    prevDone = prevDone && done === mine.length && open;
  }
  return out;
}

const shuffle = <T,>(a: T[]) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const validQs = (qs: unknown) => Array.isArray(qs) && qs.length === 2 && qs.every((q: any) => Array.isArray(q) && typeof q[0] === "string" && q[0].trim() &&
  Array.isArray(q[1]) && q[1].length === 4 && q[1].every((o: any) => typeof o === "string" && o.trim()) && new Set(q[1].map((o: string) => o.trim())).size === 4 && typeof q[2] === "string");

// ---- the handler -----------------------------------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let b: Row = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "body" }, 400); }
  const db = sb();
  const action = String(b.action ?? "");
  const emp = String(b.emp ?? "").trim();
  try {
    // ------------------------------------------------------------- the pack import (from the Managers' folder)
    if (action === "seed") {
      // the first import fills an empty library; every later one needs an Admin's own app login
      const old = await db.from("sop_docs").select("code,ver,q_status,questions");
      if ((old.data || []).length) { const ad = await appUser(db, b.jwt); if (!ad || !ad.admin) return json({ ok: false, error: "not_admin" }, 403); }
      const docs: Row[] = Array.isArray(b.docs) ? b.docs : [];
      const byCode: Record<string, Row> = {}; (old.data || []).forEach((r: Row) => (byCode[r.code] = r));
      let added = 0, changed = 0, kept = 0;
      for (const d of docs) {
        if (!d.code || !d.title || !Array.isArray(d.blocks) || !validQs(d.questions)) return json({ ok: false, error: "bad_doc", code: d.code }, 400);
        const prev = byCode[d.code];
        if (prev && prev.ver === d.ver) { kept++; continue; }
        const row: Row = { code: d.code, title: d.title, folder: d.folder, ver: d.ver, blocks: d.blocks, words: d.words | 0, updated_at: new Date().toISOString() };
        if (!prev) { row.questions = d.questions; added++; } else changed++;   // a checked question set is never overwritten by an import
        const up = await db.from("sop_docs").upsert(row, { onConflict: "code" });
        if (up.error) return json({ ok: false, error: up.error.message, code: d.code }, 500);
      }
      const map: Row[] = Array.isArray(b.map) ? b.map : [];
      if (map.length) { const m = await db.from("sop_map").upsert(map, { onConflict: "grp,code", ignoreDuplicates: true }); if (m.error) return json({ ok: false, error: m.error.message }, 500); }
      if (b.start) await db.from("sop_settings").upsert({ key: "start_date", val: b.start, by: "seed" }, { onConflict: "key", ignoreDuplicates: true });
      return json({ ok: true, added, changed, kept, map: map.length });
    }

    const [st, au, mn] = await Promise.all([fohStaff(db, emp), appUser(db, b.jwt), emp ? masterName(db, emp) : Promise.resolve(null)]);
    const checker = (st && /management/i.test(st.section) ? st.name : null) || (au && au.manager ? au.name : null) || (!st && mn ? mn : null);
    if (!st && !checker) return json({ ok: false, error: "no_emp" });

    const docsQ = await db.from("sop_docs").select("code,title,folder,ver,words,q_status,checked_by,checked_at").eq("active", true).order("code");
    const myGrp = st ? grpOf(st.section, st.role) : null;
    const seesAll = !!checker || (!!myGrp && SEES_RESTRICTED.includes(myGrp));
    const DOCS: Row[] = (docsQ.data || []).filter((d: Row) => seesAll || !RESTRICTED.includes(d.code));
    const docOf = (c: unknown) => DOCS.find((d) => d.code === String(c ?? ""));
    const setQ = await db.from("sop_settings").select("val").eq("key", "start_date").limit(1);
    const START = String((setQ.data && setQ.data[0] && setQ.data[0].val) || dubaiToday());
    const today = dubaiToday();

    // what one person must read, and where they are with it
    async function listFor(person: Row) {
      const grp = grpOf(person.section, person.role);
      const [mp, sg] = await Promise.all([
        grp ? db.from("sop_map").select("code,week").eq("grp", grp) : Promise.resolve({ data: [] as Row[] }),
        db.from("sop_signs").select("code,ver,signed_at").eq("emp_id", person.emp).order("signed_at", { ascending: false }),
      ]);
      const signs: Record<string, Row> = {}; (sg.data || []).forEach((s: Row) => { if (!signs[s.code]) signs[s.code] = s; });
      const tasks = (mp.data || []).filter((m: Row) => docOf(m.code)).map((m: Row) => {
        const d = docOf(m.code)!, s = signs[m.code];
        const state = !s ? "todo" : s.ver === d.ver ? "done" : "again";
        return { code: m.code, week: m.week, state, signed_at: s ? s.signed_at : null };
      });
      const weeks = weeksOf(START, today, tasks.map((t: Row) => ({ week: t.week, done: t.state === "done" })));
      const extra = Object.keys(signs).filter((c) => !tasks.some((t: Row) => t.code === c)).map((c) => {
        const d = docOf(c); return d ? { code: c, state: signs[c].ver === d.ver ? "done" : "again", signed_at: signs[c].signed_at } : null;
      }).filter(Boolean);
      return { grp, grp_name: grp ? GRP_NAME[grp] : null, tasks, weeks, extra };
    }

    // ------------------------------------------------------------- who am I, the library, my list
    if (action === "me") {
      const out: Row = {
        ok: true, name: st ? st.name : checker, staff: !!st, checker: !!checker, master: !st && !!mn && !au,
        start: START, today,
        docs: DOCS.map((d) => ({ code: d.code, title: d.title, folder: d.folder, words: d.words, ready: d.q_status === "checked", checked_by: d.checked_by })),
      };
      if (st) { out.role = st.role; Object.assign(out, await listFor(st)); }
      if (checker) out.to_check = DOCS.filter((d) => d.q_status !== "checked").length;
      return json(out);
    }

    // ------------------------------------------------------------- open a document (starts the reading clock)
    if (action === "doc") {
      const d0 = docOf(b.code); if (!d0) return json({ ok: false, error: "no_doc" });
      const full = await db.from("sop_docs").select("*").eq("code", d0.code).limit(1);
      const d = (full.data && full.data[0]) as Row;
      const out: Row = { ok: true, code: d.code, title: d.title, folder: d.folder, ver: d.ver, blocks: d.blocks, words: d.words, ready: d.q_status === "checked", checked_by: d.checked_by, checked_at: d.checked_at };
      if (st) {
        await db.from("sop_reads").upsert({ emp_id: st.emp, code: d.code, opened_at: new Date().toISOString() }, { onConflict: "emp_id,code" });
        out.min_read_ms = minReadMs(d.words);
        const s = await db.from("sop_signs").select("ver,signed_at").eq("emp_id", st.emp).eq("code", d.code).order("signed_at", { ascending: false }).limit(1);
        const last = s.data && s.data[0];
        out.signed = last ? { at: last.signed_at, current: last.ver === d.ver } : null;
        // the two questions, options shuffled, no answer and no hint
        if (out.ready) out.questions = (d.questions as Row[]).map((q) => ({ q: q[0], opts: shuffle(q[1]) }));
      }
      if (checker) out.key = (d.questions as Row[]).map((q) => ({ q: q[0], right: q[1][0], wrong: q[1].slice(1), why: q[2] }));
      return json(out);
    }

    // ------------------------------------------------------------- search the full text of every page this person may see
    if (action === "find") {
      const words = String(b.q ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
      if (!words.length) return json({ ok: true, hits: [] });
      const all = await db.from("sop_docs").select("code,blocks").eq("active", true);
      const hits: Row[] = [];
      for (const r of all.data || []) {
        if (!docOf(r.code)) continue;
        const text = (r.blocks as Row[]).map((x) => x.h ?? x.p ?? (x.row || []).join(" — ")).join("  ").replace(/\s+/g, " ");
        const low = text.toLowerCase(); const t = docOf(r.code)!.title.toLowerCase();
        if (!words.every((w) => low.includes(w) || t.includes(w))) continue;
        const at = Math.max(0, low.indexOf(words[0]));
        const from = Math.max(0, at - 50);
        hits.push({ code: r.code, snip: (from ? "…" : "") + text.slice(from, from + 150).trim() + "…", inTitle: words.every((w) => t.includes(w)) });
      }
      hits.sort((x, y) => Number(y.inTitle) - Number(x.inTitle));
      return json({ ok: true, hits: hits.slice(0, 25) });
    }

    // ------------------------------------------------------------- sign: both answers right, read long enough, ID typed again
    if (action === "sign") {
      if (!st) return json({ ok: false, error: "staff_only" });
      if (!same(st.emp, String(b.idn ?? "").trim())) return json({ ok: false, error: "id_mismatch" });
      const full = await db.from("sop_docs").select("*").eq("code", String(b.code ?? "")).limit(1);
      const d = full.data && full.data[0] as Row; if (!d) return json({ ok: false, error: "no_doc" });
      if (d.q_status !== "checked") return json({ ok: false, error: "not_ready" });
      if (String(b.ver ?? "") !== d.ver) return json({ ok: false, error: "changed" });
      const rd = await db.from("sop_reads").select("opened_at").eq("emp_id", st.emp).eq("code", d.code).limit(1);
      const opened = rd.data && rd.data[0] ? new Date(rd.data[0].opened_at).getTime() : 0;
      const readMs = opened ? Date.now() - opened : 0, need = minReadMs(d.words);
      if (!opened || readMs < need) return json({ ok: false, error: "too_fast", wait_ms: Math.max(0, need - readMs) });
      const ans: unknown[] = Array.isArray(b.answers) ? b.answers : [];
      const qs = d.questions as Row[];
      const right = qs.map((q, i) => String(ans[i] ?? "").trim() === String(q[1][0]).trim());
      const allRight = right.every(Boolean);
      await db.from("sop_tries").insert({ emp_id: st.emp, code: d.code, ok: allRight });
      if (!allRight) return json({ ok: false, error: "wrong", right, why: qs.map((q, i) => (right[i] ? null : q[2])) });
      const tr = await db.from("sop_tries").select("id", { count: "exact", head: true }).eq("emp_id", st.emp).eq("code", d.code).gte("at", new Date(opened).toISOString());
      const ins = await db.from("sop_signs").insert({ emp_id: st.emp, name: st.name, role: st.role, code: d.code, ver: d.ver, read_ms: readMs, tries: tr.count || 1 }).select("signed_at");
      if (ins.error) return json({ ok: false, error: "save" }, 500);
      return json({ ok: true, signed_at: ins.data && ins.data[0] && ins.data[0].signed_at });
    }

    // ------------------------------------------------------------- managers: check the questions, fix them, see the team
    if (!checker) return json({ ok: false, error: "not_checker" }, 403);

    if (action === "qsave") {
      const d = docOf(b.code); if (!d) return json({ ok: false, error: "no_doc" });
      const qs = (Array.isArray(b.questions) ? b.questions : []).map((q: Row) => [String(q.q ?? "").trim(), [String(q.right ?? "").trim(), ...(Array.isArray(q.wrong) ? q.wrong : []).map((w: unknown) => String(w ?? "").trim())], String(q.why ?? "").trim()]);
      if (!validQs(qs)) return json({ ok: false, error: "bad_questions" });
      // a changed question set must be checked again (by whoever saved it, if they tick it)
      const up = await db.from("sop_docs").update({ questions: qs, q_status: "draft", checked_by: null, checked_at: null }).eq("code", d.code).select("code");
      return json({ ok: !!(up.data && up.data[0]) });
    }
    if (action === "check" || action === "uncheck") {
      const d = docOf(b.code); if (!d) return json({ ok: false, error: "no_doc" });
      const v = action === "check" ? { q_status: "checked", checked_by: checker, checked_at: new Date().toISOString() } : { q_status: "draft", checked_by: null, checked_at: null };
      const up = await db.from("sop_docs").update(v).eq("code", d.code).select("code");
      return json({ ok: !!(up.data && up.data[0]) });
    }
    if (action === "board") {
      const [staff, signs, map] = await Promise.all([
        db.from("foh_staff").select("name,emp_id,role,section,end_date,in_schedule").eq("active", true),
        db.from("sop_signs").select("emp_id,code,ver,signed_at").order("signed_at", { ascending: false }),
        db.from("sop_map").select("grp,code,week"),
      ]);
      const verOf: Record<string, string> = {}; DOCS.forEach((d) => (verOf[d.code] = d.ver));
      const last: Record<string, Row> = {};
      (signs.data || []).forEach((s: Row) => { const k = String(s.emp_id) + "|" + s.code; if (!last[k]) last[k] = s; });
      const people = (staff.data || []).filter((p: Row) => !p.end_date && p.in_schedule !== false && p.emp_id).map((p: Row) => {
        const grp = grpOf(String(p.section ?? ""), String(p.role ?? "")); if (!grp) return null;
        const mine = (map.data || []).filter((m: Row) => m.grp === grp && verOf[m.code]);
        const rows = mine.map((m: Row) => { const s = last[String(p.emp_id) + "|" + m.code]; return { week: m.week, done: !!s && s.ver === verOf[m.code], again: !!s && s.ver !== verOf[m.code] }; });
        const weeks = weeksOf(START, today, rows);
        const dueNow = weeks.filter((w) => w.open && today > w.due).reduce((n, w) => n + (w.total - w.done), 0);
        const lastAt = Object.keys(last).filter((k) => k.startsWith(String(p.emp_id) + "|")).map((k) => last[k].signed_at).sort().pop() || null;
        return { name: p.name, role: p.role, grp, grp_name: GRP_NAME[grp], done: rows.filter((r) => r.done).length, again: rows.filter((r) => r.again).length, total: rows.length, behind: dueNow, last: lastAt };
      }).filter(Boolean);
      const tries = await db.from("sop_tries").select("code,ok");
      const miss: Record<string, number> = {}; (tries.data || []).forEach((t: Row) => { if (!t.ok) miss[t.code] = (miss[t.code] || 0) + 1; });
      return json({ ok: true, start: START, today, people, to_check: DOCS.filter((d) => d.q_status !== "checked").map((d) => d.code), hard: Object.keys(miss).sort((a, b) => miss[b] - miss[a]).slice(0, 8).map((c) => ({ code: c, title: docOf(c)?.title, wrong: miss[c] })) });
    }
    if (action === "start") {
      const v = String(b.start ?? ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return json({ ok: false, error: "bad_date" });
      const up = await db.from("sop_settings").upsert({ key: "start_date", val: v, by: checker, at: new Date().toISOString() }, { onConflict: "key" });
      return json({ ok: !up.error });
    }
    return json({ ok: false, error: "action" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
