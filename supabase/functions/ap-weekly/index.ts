// ════════════════════════════════════════════════════════════
// ap-weekly — Roberto's 3.0 Action Plan (FOH project paoaivwtkzujmrgrfjuq)
// Built 16 Oct 2026.
//
// ONE place computes the plan's numbers. The screen and the Wednesday email
// both read what this function stores in ap_measures / ap_snapshots, so they
// can never print two different figures for the same week.
//
// Modes (POST JSON):
//   { mode: "refresh" }  signed-in plan member  → recompute live measures, store them
//   { mode: "send" }     pg_cron (x-cron-secret) or an app Admin who is a member
//                        → refresh, then email ap_settings.recipients
//   { mode: "preview" }  plan member → refresh, return the email HTML, send nothing
//
// RECIPIENTS: only ap_settings.recipients. While testing that is Francesco
// only; he switches it to Amin himself. Nothing in here has another address.
//
// WHERE THE NUMBERS COME FROM (never typed by hand):
//   guests booked ahead (and walk-in share), bookings by channel, 2nd visits,
//   relaunch bookings → SevenRooms nightly book through the Kitchen
//     sevenrooms-sync ?daysheet= call, same rules as Reservation Reports
//     (foh-resreports.js): a booking = not cancelled / no-show; a visit = a
//     distinct night per client id; the anonymous "Guest" placeholder is not a guest.
//   Monday / Sunday net revenue and guests → rev_daily (closing report), venue robertos-difc.
//     A night with no row is "No data", never zero.
//   Google rating → google_reviews_daily, venue_key robertos.
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FROM = "Roberto's DIFC Operations <reports@kitchenteam.robertos.ae>";
const APP_URL = "https://robertos-leadership.github.io/robertos-foh/";
const KITCHEN_URL = "https://zrpglswalgjbtghudmhu.supabase.co";
// Public values: both already sit in the FOH page source (foh-core.js).
const KITCHEN_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpycGdsc3dhbGdqYnRnaHVkbWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTIyMjQsImV4cCI6MjA5NjQ4ODIyNH0.pfABN-so4xINK7nHxXUlVeTO4g0h0l6ILHVwpoKrbds";
const KITCHEN_PROXY_SECRET = "8c8223b1916d98aefb0d95018ac5e8e9fc11de64dec1ffc5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
type SB = ReturnType<typeof admin>;

// ── Dubai dates (UTC+4, no DST) ─────────────────────────────────────────
const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();          // 0 Sun … 6 Sat
const mondayOf = (d: string) => addDays(d, -((dow(d) + 6) % 7));
const monthEnd = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10); };
const label = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthName = (ym: string) => new Date(ym + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
const range = (a: string, b: string) => { const o: string[] = []; for (let d = a; d <= b; d = addDays(d, 1)) o.push(d); return o; };
const pct1 = (a: number, b: number) => b ? Math.round(a / b * 1000) / 10 : null;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// ── SevenRooms nightly book ─────────────────────────────────────────────
type Row = { state?: string; pax?: number; booked_by?: string; client?: string; name?: string };
const gone = (r: Row) => r.state === "cancelled" || r.state === "noshow";
const placeholder = (n?: string) => String(n || "").trim().toLowerCase() === "guest";
const isWalkin = (r: Row) => String(r.booked_by || "").trim().toLowerCase() === "walk in";

async function night(d: string): Promise<Row[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((ok) => setTimeout(ok, 800 * attempt));   // back off: the proxy throttles bursts
    try {
      const r = await fetch(`${KITCHEN_URL}/functions/v1/sevenrooms-sync?daysheet=${d}&include=all`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + KITCHEN_KEY, "x-proxy-secret": KITCHEN_PROXY_SECRET },
      });
      const j = await r.json();
      if (j?.ok && Array.isArray(j.reservations)) return j.reservations;
    } catch { /* retry */ }
  }
  throw new Error("SevenRooms night " + d + " could not be read");
}
async function nights(dates: string[], par = 4) {
  const out: Record<string, Row[]> = {}; const q = dates.slice(); const failed: string[] = [];
  await Promise.all(Array.from({ length: Math.min(par, q.length) }, async () => {
    while (q.length) { const d = q.shift()!; try { out[d] = await night(d); } catch { failed.push(d); } }
  }));
  return { out, failed };
}

// ── The measures ────────────────────────────────────────────────────────
// `at` = the date the snapshot is filed under (Monday of the week; the 1st of
// the month for a monthly figure). Defaults to the week being reported.
// transient = a read that failed this time: never overwrite a good figure with it.
type M = { value: number | null; label: string | null; detail?: unknown; at?: string; transient?: boolean };

// ── The SevenRooms night cache (ap_sr_nights) ──────────────────────────────
// Every SevenRooms figure in the plan — this week's and its history — is
// counted from the same cached nights, so a trend line and today's number can
// never disagree. Only SETTLED nights (before yesterday) are cached; at most
// `max` missing ones are read per call (the Kitchen proxy throttles bursts and
// an edge function has 150 s).
type Night = { clients: string[]; bookings: number; walkin_bookings: number | null; covers: number | null; walkin_covers: number | null };
async function ensureNights(sb: SB, dates: string[], max = 40) {
  const cached: Record<string, Night> = {};
  if (dates.length) {
    const { data } = await sb.from("ap_sr_nights").select("night,clients,bookings,walkin_bookings,covers,walkin_covers")
      .gte("night", dates[0]).lte("night", dates[dates.length - 1]);
    (data || []).forEach((r: Night & { night: string }) => { cached[r.night] = r; });
  }
  // a night cached before 18 Oct has no walk-in counts yet: read it again
  const missing = dates.filter((d) => !cached[d] || cached[d].walkin_bookings == null).slice(0, max);
  if (missing.length) {
    const got = await nights(missing, 4);
    const rows = Object.entries(got.out).map(([d, rs]) => {
      const live = rs.filter((r) => !gone(r));
      const row = {
        night: d,
        clients: [...new Set(live.filter((r) => r.client && !placeholder(r.name)).map((r) => String(r.client)))],
        bookings: live.length,
        walkin_bookings: live.filter(isWalkin).length,
        covers: live.reduce((s, r) => s + (Number(r.pax) || 0), 0),
        walkin_covers: live.filter(isWalkin).reduce((s, r) => s + (Number(r.pax) || 0), 0),
        read_at: new Date().toISOString(),
      };
      cached[d] = row;
      return row;
    });
    if (rows.length) await sb.from("ap_sr_nights").upsert(rows, { onConflict: "night" });
  }
  const still = dates.filter((d) => !cached[d] || cached[d].walkin_bookings == null).length;
  return { cached, still };
}

// Walk-in share for one Mon–Sun week, from the cache. null = not all 7 nights read.
function walkinWeek(cached: Record<string, Night>, wkStart: string) {
  let b = 0, w = 0, c = 0, wc = 0;
  for (const d of range(wkStart, addDays(wkStart, 6))) {
    const n = cached[d]; if (!n || n.walkin_bookings == null) return null;
    b += n.bookings; w += n.walkin_bookings; c += n.covers || 0; wc += n.walkin_covers || 0;
  }
  return { b, w, c, wc };
}

// The 3-visit ladder for first-time guests of month `ym`, rule A: 2nd visit
// within 30 days of the 1st, 3rd within 30 days of the 2nd. First-time = no
// visit in the 3 months before. Same rule as the "3 visits" report.
const VISIT_W = 30;
function visitsLadder(cached: Record<string, Night>, ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const lookFrom = new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10);
  const to = addDays(monthEnd(ym), 2 * VISIT_W);
  const G: Record<string, string[]> = {};
  for (const d of range(lookFrom, to)) { const n = cached[d]; if (!n) return null; n.clients.forEach((id) => { (G[id] || (G[id] = [])).push(d); }); }
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  let n = 0, s2 = 0, s3 = 0;
  Object.values(G).forEach((ds) => {
    if (ds[0].slice(0, 7) !== ym) return;
    n++;
    const second = ds.length > 1 && days(ds[0], ds[1]) <= VISIT_W;
    if (second) { s2++; if (ds.length > 2 && days(ds[1], ds[2]) <= VISIT_W) s3++; }
  });
  return { n, s2, s3 };
}
// Latest month whose whole rule-A window (month end + 60 days) has passed.
function lastLadderMonth(yday: string) {
  let ym = yday.slice(0, 7);
  while (addDays(monthEnd(ym), 2 * VISIT_W) > yday) { const [y, m] = ym.split("-").map(Number); ym = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); }
  return ym;
}
function ladderValue(L: { n: number; s2: number; s3: number }, ym: string): M {
  return { value: pct1(L.s2, L.n), label: `${L.s2} of ${L.n.toLocaleString("en-GB")} came a 2nd time · ${L.s3} a 3rd (${pct1(L.s3, L.n)}%) — ${monthName(ym)} first-timers`,
    detail: { month: ym, first_timers: L.n, second: L.s2, third: L.s3, third_pct: pct1(L.s3, L.n), rule: "2nd within 30 days of the 1st, 3rd within 30 days of the 2nd" }, at: ym + "-01" };
}

// Guests on a given night from the closing report. No row = No data, never zero.
async function guestsOn(sb: SB, d: string): Promise<M> {
  const { data } = await sb.from("rev_daily").select("service_date,rest_covers_actual,lounge_covers_actual").eq("venue_id", "robertos-difc").eq("service_date", d).limit(1);
  const r = data?.[0];
  const cov = r ? (Number(r.rest_covers_actual) || 0) + (Number(r.lounge_covers_actual) || 0) : null;
  // Filed under the Mon–Sun week the night belongs to (a Sunday closes its week).
  const at = mondayOf(d);
  if (r && cov) return { value: cov, label: label(d), detail: { date: d }, at };
  // Roberto's opened on Sundays from October 2026 (Decision Log, 1 Oct); an
  // earlier Sunday is a closed night, not a missing report.
  if (dow(d) === 0 && d < SUNDAYS_FROM) return { value: null, label: "Closed on Sundays until October", detail: { date: d, closed: true }, at };
  return { value: null, label: "No data — no closing report for " + label(d), detail: { date: d }, at };
}
const SUNDAYS_FROM = "2026-10-01";

// Net revenue on a given night from the closing report (point 7, from 19 Oct
// 2026: the goal is AED 3M a month, Monday and Sunday 30k a night by end of
// November, 50k by December). No row = No data, never zero.
async function netOn(sb: SB, d: string): Promise<M> {
  const { data } = await sb.from("rev_daily").select("service_date,net_actual,rest_covers_actual,lounge_covers_actual").eq("venue_id", "robertos-difc").eq("service_date", d).limit(1);
  const r = data?.[0];
  const net = r ? Number(r.net_actual) || 0 : null;
  const at = mondayOf(d);
  if (r && net) {
    const cov = (Number(r.rest_covers_actual) || 0) + (Number(r.lounge_covers_actual) || 0);
    return { value: Math.round(net), label: `${label(d)} · ${cov} guests`, detail: { date: d, guests: cov }, at };
  }
  if (dow(d) === 0 && d < SUNDAYS_FROM) return { value: null, label: "Closed on Sundays until October", detail: { date: d, closed: true }, at };
  return { value: null, label: "No data — no closing report for " + label(d), detail: { date: d }, at };
}

// The week a weekly figure reports: the last full Mon–Sun, but never a week
// whose Sunday is yesterday or later (that night is not settled yet).
function reportWeek(today: string) {
  let wk = addDays(mondayOf(today), -7);
  if (addDays(wk, 6) >= addDays(today, -1)) wk = addDays(wk, -7);
  return wk;
}

async function computeMeasures(sb: SB) {
  const today = dubaiToday(), yday = addDays(today, -1);
  const wkStart = reportWeek(today), wkEnd = addDays(wkStart, 6);
  const res: Record<string, M> = {};

  // Point 5 — walk-in share, last settled week, bookings AND covers
  const wk = await ensureNights(sb, range(wkStart, wkEnd), 7);
  const W = walkinWeek(wk.cached, wkStart);
  if (!W) {
    const why = { value: null, label: "SevenRooms did not answer for every night of " + label(wkStart) + " week — not counted", transient: true };
    res.walkin_share = why; res.walkin_covers = why; res.booked_share = why;
  } else {
    const det = { week: wkStart, bookings: W.b, walkins: W.w, covers: W.c, walkin_covers: W.wc };
    res.walkin_share = { value: pct1(W.w, W.b), label: `${W.w} of ${W.b} bookings · week of ${label(wkStart)}`, detail: det };
    res.walkin_covers = { value: pct1(W.wc, W.c), label: `${W.wc} of ${W.c} covers · week of ${label(wkStart)}`, detail: det };
    // From 19 Oct the point is judged on guests booked ahead (Amin: a strong business books 70–80% ahead)
    res.booked_share = { value: pct1(W.c - W.wc, W.c), label: `${W.c - W.wc} of ${W.c} guests booked ahead · week of ${label(wkStart)}`, detail: det };
  }

  // Point 6 — 3-visit ladder for the latest month whose window has closed
  const ym = lastLadderMonth(yday);
  const [y, m] = ym.split("-").map(Number);
  const need = range(new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10), addDays(monthEnd(ym), 2 * VISIT_W));
  const lad = await ensureNights(sb, need, 40);
  const L = lad.still ? null : visitsLadder(lad.cached, ym);
  res.visits3 = L ? ladderValue(L, ym) : { value: null, label: `Reading SevenRooms: ${need.length - lad.still} of ${need.length} nights so far`, transient: true };

  // Point 7 — Monday and Sunday guests (closing report)
  const lastDow = (want: number) => { let d = yday; while (dow(d) !== want) d = addDays(d, -1); return d; };
  res.monday_guests = await guestsOn(sb, lastDow(1));
  res.sunday_guests = await guestsOn(sb, lastDow(0));
  res.monday_net = await netOn(sb, lastDow(1));
  res.sunday_net = await netOn(sb, lastDow(0));

  // Point 8 — bookings 2–15 Nov vs 19 Oct–1 Nov, once the after-window has closed
  if (yday >= "2026-11-15") {
    const a = await ensureNights(sb, range("2026-10-19", "2026-11-15"), 40);
    if (!a.still) {
      const cnt = (f: string, t: string) => range(f, t).reduce((s, d) => s + (a.cached[d]?.bookings || 0), 0);
      const before = cnt("2026-10-19", "2026-11-01"), after = cnt("2026-11-02", "2026-11-15");
      res.relaunch_bookings = { value: after, label: `${after} after vs ${before} before (${after >= before ? "+" : ""}${after - before})`, detail: { before, after } };
    }
  }
  return { res, wkStart };
}

// ── History: weekly figures back to the start of the baselines (3 Aug) ─────
// Fills ap_snapshots so every figure opens with a trend line. Same cache and
// the same counting as the live figure. Reads at most 40 missing nights per
// call; call again until `remaining` is 0.
const HISTORY_FROM = "2026-08-03";   // first Monday of the baseline period
async function fillHistory(sb: SB, byKey: Record<string, { id: string }>) {
  const today = dubaiToday(), yday = addDays(today, -1);
  const lastWk = reportWeek(today);
  const weeks: string[] = []; for (let w = HISTORY_FROM; w <= lastWk; w = addDays(w, 7)) weeks.push(w);
  const all = range(HISTORY_FROM, addDays(lastWk, 6));
  const nc = await ensureNights(sb, all, 40);
  const now = new Date().toISOString(); let written = 0;
  const put = async (key: string, at: string, v: M) => {
    const m = byKey[key]; if (!m) return;
    await sb.from("ap_snapshots").upsert({ measure_id: m.id, week_start: at, value: v.value, label: v.label, detail: v.detail ?? null, recorded_at: now }, { onConflict: "measure_id,week_start" });
    written++;
  };
  for (const w of weeks) {
    const W = walkinWeek(nc.cached, w);
    if (W) {
      const det = { week: w, bookings: W.b, walkins: W.w, covers: W.c, walkin_covers: W.wc };
      await put("walkin_share", w, { value: pct1(W.w, W.b), label: `${W.w} of ${W.b} bookings`, detail: det });
      await put("walkin_covers", w, { value: pct1(W.wc, W.c), label: `${W.wc} of ${W.c} covers`, detail: det });
      await put("booked_share", w, { value: pct1(W.c - W.wc, W.c), label: `${W.c - W.wc} of ${W.c} guests booked ahead`, detail: det });
    }
    // Monday and Sunday of that week, from the closing report
    await put("monday_guests", w, await guestsOn(sb, w));
    if (addDays(w, 6) <= yday) await put("sunday_guests", w, await guestsOn(sb, addDays(w, 6)));
    await put("monday_net", w, await netOn(sb, w));
    if (addDays(w, 6) <= yday) await put("sunday_net", w, await netOn(sb, addDays(w, 6)));
  }
  // 3-visit ladder: every month from June whose window has closed
  const lastYm = lastLadderMonth(yday);
  for (let ym = "2026-06"; ym <= lastYm; ym = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1)).toISOString().slice(0, 7)) {
    const [y, m] = ym.split("-").map(Number);
    const need = range(new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10), addDays(monthEnd(ym), 2 * VISIT_W));
    const lad = await ensureNights(sb, need, nc.still ? 0 : 40);
    if (!lad.still) { const L = visitsLadder(lad.cached, ym); if (L) await put("visits3", ym + "-01", ladderValue(L, ym)); }
  }
  return { weeks: weeks.length, written, remaining: nc.still };
}

// ── Plan status (same rules as the screen) ──────────────────────────────
// Steps seeded as already done (done_by 'seed': press release, Aperitivo prices)
// were finished before the plan started, so they count in the total but never
// as "done this week" or as this week's progress.
type Step = { id: string; point_id: string; title: string; owner: string | null; due_date: string | null; done_at: string | null; done_by: string | null };
function planFacts(points: { id: string; num: number; title: string }[], steps: Step[], since: string) {
  const today = dubaiToday();
  const total = steps.length, done = steps.filter((s) => s.done_at).length;
  const thisWeek = (s: Step) => !!s.done_at && s.done_at >= since && s.done_by !== "seed";
  const doneBefore = steps.filter((s) => s.done_at && !thisWeek(s)).length;
  const pnum = (id: string) => points.find((p) => p.id === id);
  const late = steps.filter((s) => !s.done_at && s.due_date && s.due_date < today)
    .map((s) => ({ point: pnum(s.point_id), title: s.title, owner: s.owner, due: s.due_date! }));
  const doneThisWeek = steps.filter(thisWeek).map((s) => ({ point: pnum(s.point_id), title: s.title }));
  return {
    total, done, pct: total ? Math.round(done / total * 100) : 0,
    pctBefore: total ? Math.round(doneBefore / total * 100) : 0, late, doneThisWeek,
  };
}

// ── The email ───────────────────────────────────────────────────────────
// Built to the approved mock-up (deck slide 14): a white card, one bordered
// box per section, the plan bar, one wine button. TABLES ONLY, styles inline,
// colours also as bgcolor attributes: Outlook desktop renders with Word, which
// ignores padding/height/radius on <div> (16 Oct: the first version arrived as
// torn colour strips with no bar and a purple-on-wine button). Padding lives on
// <td>; the bar is two cells; the button is a filled cell around the link.
const NAMES: Record<string, string> = { "fguarracino@robertos.ae": "Francesco", "onafid@robertos.ae": "Ouafaa", "akadrie@skelmore.com": "Amin", "justin@skelmore.com": "Justin", "asacchi@skelmore.com": "Andrea", "ndragan@robertos.ae": "Nicole" };
const SANS = "Arial,Helvetica,sans-serif";
function emailHtml(f: ReturnType<typeof planFacts>, weekNo: number, pending: { point?: { num: number; title: string }; proposal: string }[],
  comments: { point?: { num: number; title: string }; author_email: string; body: string }[], weekLabel: string, toLabel: string) {
  const box = (inner: string) =>
    `<tr><td style="padding:0 0 12px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="border:1px solid #E6DFE0;border-radius:12px;border-collapse:separate;">`
    + `<tr><td style="padding:16px 20px;">${inner}</td></tr></table></td></tr>`;
  const head = (t: string, colour = "#2C1810") => `<div style="font-family:${SANS};font-size:16px;line-height:22px;font-weight:bold;color:${colour};">${t}</div>`;
  const sub = (t: string) => `<div style="font-family:${SANS};font-size:14px;line-height:21px;color:#8B7355;padding-top:3px;">${t}</div>`;
  const join = (rows: string[], none: string) => rows.length ? rows.join(" &middot; ") : none;
  const delta = f.pct - f.pctBefore;
  const pct = Math.max(0, Math.min(100, f.pct));
  // Two-cell bar. A 0% or 100% bar must not leave a zero-width cell (Word draws it 1px wide).
  const bar = pct <= 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="8" bgcolor="#EDE4D6" style="height:8px;line-height:8px;font-size:0;border-radius:4px;">&nbsp;</td></tr></table>`
    : pct >= 100
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="8" bgcolor="#6B1F2A" style="height:8px;line-height:8px;font-size:0;border-radius:4px;">&nbsp;</td></tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`
      + `<td width="${pct}%" height="8" bgcolor="#6B1F2A" style="width:${pct}%;height:8px;line-height:8px;font-size:0;border-radius:4px 0 0 4px;">&nbsp;</td>`
      + `<td width="${100 - pct}%" height="8" bgcolor="#EDE4D6" style="width:${100 - pct}%;height:8px;line-height:8px;font-size:0;border-radius:0 4px 4px 0;">&nbsp;</td></tr></table>`;
  const weekTitle = weekNo >= 1 ? `Week ${weekNo} update` : "Before week 1";
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Roberto's 3.0</title></head>
<body style="margin:0;padding:0;background:#F5F0E8;" bgcolor="#F5F0E8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F0E8"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;border:1px solid #E6DFE0;border-radius:16px;border-collapse:separate;">
<tr><td style="padding:22px 28px 18px 28px;border-bottom:1px solid #EFE8E4;">
  <div style="font-family:${SANS};font-size:14px;line-height:20px;color:#6E6259;">${esc(toLabel)}</div>
  <div style="font-family:${SANS};font-size:21px;line-height:28px;font-weight:bold;color:#2C1810;padding-top:2px;">Roberto's 3.0 &middot; ${weekTitle}</div>
</td></tr>
<tr><td style="padding:20px 24px 8px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${box(`<div style="font-family:${SANS};font-size:12px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:#8B7355;">Plan progress</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="bottom" style="font-family:Georgia,'Times New Roman',serif;font-size:44px;line-height:54px;color:#2C1810;padding:4px 0 10px 0;">${f.pct}%</td>
<td valign="bottom" align="right" style="font-family:${SANS};font-size:14px;line-height:20px;color:#8B7355;padding:0 0 16px 0;">${delta > 0 ? "+" + delta + "% this week" : "No change this week"}<br>${f.done} of ${f.total} steps done</td>
</tr></table>${bar}`)}
${box(head(`Done this week &middot; ${n(f.doneThisWeek.length, "step", "steps")}`) + sub(join(f.doneThisWeek.map((s) => esc(s.title)), "Nothing ticked off this week")))}
${box(head(`Late &middot; ${f.late.length}`, f.late.length ? "#B3261E" : "#2C1810") + sub(join(f.late.map((s) => `${esc(s.point?.title)}: ${esc(s.title)} (${esc(s.owner || "no owner")}, due ${esc(label(s.due))})`), "Nothing is late")))}
${box(head(`Needs your OK &middot; ${pending.length}`) + sub(join(pending.map((c) => `${esc(c.point?.title)}: ${esc(c.proposal)}`), "Nothing waiting")))}
${box(head(`New comments &middot; ${comments.length}`) + sub(join(comments.slice(0, 6).map((c) => `${esc(NAMES[c.author_email] || c.author_email)} on ${esc(c.point?.title)}: &ldquo;${esc(c.body)}&rdquo;`), "No new comments")))}
<tr><td align="center" style="padding:8px 0 22px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td align="center" bgcolor="#6B1F2A" style="background:#6B1F2A;border-radius:10px;padding:14px 34px;mso-padding-alt:14px 34px;">
    <a href="${APP_URL}#actionplan" target="_blank" style="display:inline-block;font-family:${SANS};font-size:16px;line-height:20px;font-weight:bold;color:#FFFFFF;text-decoration:none;"><span style="color:#FFFFFF;">Open the plan</span></a>
  </td></tr></table>
</td></tr>
</table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
<div style="font-family:${SANS};font-size:12px;line-height:18px;color:#9A8B7C;padding-top:12px;">${esc(weekLabel)} &middot; Roberto's DIFC FOH App</div>
</td></tr></table>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const sb = admin();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body = refresh */ }
  const mode = String(body.mode || "refresh");

  // Who is calling: the scheduler (secret) or a signed-in plan member.
  const { data: cronRow } = await sb.from("ap_cron").select("secret").eq("id", 1).single();
  const isCron = !!cronRow?.secret && req.headers.get("x-cron-secret") === cronRow.secret;
  const { data: settings } = await sb.from("ap_settings").select("*").eq("id", 1).single();
  if (!settings) return json({ ok: false, error: "ap_settings missing" }, 500);
  let caller = "";
  if (!isCron) {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await sb.auth.getUser(jwt);
    caller = String(who?.user?.email || "").toLowerCase();
    const members = (settings.members as string[]).map((x) => x.toLowerCase());
    if (!caller || !members.includes(caller)) return json({ ok: false, error: "No access" }, 403);
    if (mode === "send") {
      const { data: u } = await sb.from("app_users").select("is_admin").ilike("email", caller).limit(1);
      if (!u?.[0]?.is_admin) return json({ ok: false, error: "Only an Admin can send the weekly email by hand." }, 403);
    }
  }

  try {
    // 1. Refresh the live measures and store this week's snapshot.
    const { data: ms } = await sb.from("ap_measures").select("id,key,current,detail,updated_at,hidden").not("key", "is", null).eq("hidden", false);
    // On-demand pulls (opening the plan, the Refresh button) skip the SevenRooms
    // read when the numbers are fresher than the caller's limit, so five people
    // opening the plan in the same minute cost one read, not five. Floor 2 min.
    // The Wednesday send always refreshes.
    if (!isCron && mode === "refresh") {
      const limitMin = Math.max(2, Number(body.ifOlderThanMinutes) || 2);
      const newest = (ms || []).map((m: { updated_at: string | null }) => m.updated_at ? Date.parse(m.updated_at) : 0).reduce((a: number, b: number) => Math.max(a, b), 0);
      if (newest && Date.now() - newest < limitMin * 60e3) return json({ ok: true, skipped: true, updated_at: new Date(newest).toISOString() });
    }
    const byKey: Record<string, { id: string; current: number | null; detail: { month?: string } | null }> = {};
    (ms || []).forEach((m: { id: string; key: string; current: number | null; detail: { month?: string } | null }) => { byKey[m.key] = m; });
    // History back to August — the scheduler or an Admin; call until remaining = 0.
    if (mode === "history") {
      if (!isCron) {
        const { data: u } = await sb.from("app_users").select("is_admin").ilike("email", caller).limit(1);
        if (!u?.[0]?.is_admin) return json({ ok: false, error: "Only an Admin can rebuild the history." }, 403);
      }
      return json({ ok: true, ...(await fillHistory(sb, byKey)) });
    }
    // A failed read must never stop the Wednesday email: on 'send' the refresh is
    // best-effort and the email goes out on the last good figures.
    let res: Record<string, M> = {}, wkStart = "", refreshError: string | null = null;
    try { ({ res, wkStart } = await computeMeasures(sb)); }
    catch (e) { refreshError = e instanceof Error ? e.message : String(e); if (mode !== "send") throw e; }
    const now = new Date().toISOString();
    for (const [key, v] of Object.entries(res)) {
      const m = byKey[key]; if (!m) continue;
      if (v.transient && m.current != null) continue;   // keep the last good figure, and its snapshot
      await sb.from("ap_measures").update({ current: v.value, current_label: v.label, detail: v.detail ?? null, updated_at: now }).eq("id", m.id);
      await sb.from("ap_snapshots").upsert({ measure_id: m.id, week_start: v.at || wkStart, value: v.value, label: v.label, detail: v.detail ?? null, recorded_at: now }, { onConflict: "measure_id,week_start" });
    }
    if (mode === "refresh") return json({ ok: true, refreshed: Object.keys(res), week: wkStart });
    // Wednesday: fill any week the history is missing (a run that failed, a
    // Monday with a late closing report). Best-effort, never stops the email.
    if (mode === "send") { try { await fillHistory(sb, byKey); } catch { /* history waits for next week */ } }

    // 2. Build the email from the stored plan.
    const since = new Date(Date.now() - 7 * 86400e3).toISOString();
    const [{ data: points }, { data: steps }, { data: changes }, { data: comments }] = await Promise.all([
      sb.from("ap_points").select("id,num,title").order("num"),
      sb.from("ap_steps").select("id,point_id,title,owner,due_date,done_at,done_by"),
      sb.from("ap_changes").select("point_id,proposal").eq("status", "pending").order("created_at"),
      sb.from("ap_comments").select("point_id,author_email,body,created_at").gte("created_at", since).order("created_at", { ascending: false }),
    ]);
    const P = (points || []) as { id: string; num: number; title: string }[];
    const pt = (id: string) => P.find((p) => p.id === id);
    const f = planFacts(P, (steps || []) as Step[], since);
    const thisMonday = mondayOf(dubaiToday());
    const weekNo = Math.floor((Date.parse(thisMonday) - Date.parse(settings.plan_start)) / (7 * 86400e3)) + 1;
    const html = emailHtml(f, weekNo,
      (changes || []).map((c: { point_id: string; proposal: string }) => ({ point: pt(c.point_id), proposal: c.proposal })),
      (comments || []).map((c: { point_id: string; author_email: string; body: string }) => ({ point: pt(c.point_id), author_email: c.author_email, body: c.body })),
      "Week of " + label(thisMonday) + " · sent " + label(dubaiToday()),
      "To: " + ((settings.recipients as string[]) || []).map((e) => NAMES[String(e).toLowerCase()] || e).join(", ") + " · Wednesday 8:00");
    const subject = `Roberto's 3.0 · ${weekNo >= 1 ? "Week " + weekNo + " update" : "Before week 1"} · ${f.pct}%`;
    if (mode === "preview") return json({ ok: true, subject, html, facts: f });

    // 3. Send — one message per recipient (closing-report pattern), only to ap_settings.recipients.
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ ok: false, error: "RESEND_API_KEY secret not set" }, 500);
    const to = [...new Set(((settings.recipients as string[]) || []).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
    if (!to.length) return json({ ok: false, error: "No recipients in ap_settings" }, 400);
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(to.map((addr) => ({ from: FROM, to: [addr], subject, html }))),
    });
    const d = await r.json();
    if (!r.ok) return json({ ok: false, error: d?.message || "Resend HTTP " + r.status }, 502);
    try {
      await sb.from("email_events").insert((Array.isArray(d?.data) ? d.data : []).map((x: { id?: string }, i: number) =>
        ({ event_type: "app.submitted", email_id: x?.id ?? null, recipients: [to[i]], subject })));
    } catch { /* ledger is best-effort */ }
    return json({ ok: true, sent: to.length, to, subject, by: isCron ? "schedule" : caller, refreshError });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
