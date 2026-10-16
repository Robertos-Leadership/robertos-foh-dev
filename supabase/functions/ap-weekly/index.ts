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
//   walk-in share, bookings by channel, first-time guests back within 90 days,
//   relaunch bookings → SevenRooms nightly book through the Kitchen
//     sevenrooms-sync ?daysheet= call, same rules as Reservation Reports
//     (foh-resreports.js): a booking = not cancelled / no-show; a visit = a
//     distinct night per client id; the anonymous "Guest" placeholder is not a guest.
//   Monday / Sunday guests → rev_daily (closing report), venue robertos-difc.
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
type M = { value: number | null; label: string | null; detail?: unknown };

async function computeMeasures(sb: SB, existing: Record<string, { detail?: { month?: string } | null; current?: number | null }>) {
  const today = dubaiToday();
  const yday = addDays(today, -1);
  const wkStart = addDays(mondayOf(today), -7);          // last full Mon–Sun
  const wkEnd = addDays(wkStart, 6);
  const res: Record<string, M> = {};

  // Walk-in share + channels, last full week
  const wk = await nights(range(wkStart, wkEnd));
  if (wk.failed.length) {
    res.walkin_share = { value: null, label: "SevenRooms did not answer for " + wk.failed.length + " night(s) — not counted" };
    res.channels = res.walkin_share;
  } else {
    let b = 0, w = 0, c = 0, wc = 0; const ch: Record<string, number> = {};
    Object.values(wk.out).forEach((rows) => rows.forEach((r) => {
      if (gone(r)) return; const p = Number(r.pax) || 0; b++; c += p;
      const k = String(r.booked_by || "").trim() || "Not recorded"; ch[k] = (ch[k] || 0) + 1;
      if (isWalkin(r)) { w++; wc += p; }
    }));
    const top = Object.entries(ch).sort((x, y) => y[1] - x[1]).slice(0, 8);
    res.walkin_share = { value: pct1(w, b), label: `${w} of ${b} bookings · ${pct1(wc, c)}% of covers`, detail: { week: wkStart, walkins: w, bookings: b, covers: c, walkin_covers: wc } };
    res.channels = { value: b - w, label: `booked ahead (${b} bookings, ${w} walk-ins)`, detail: { week: wkStart, top } };
  }

  // First-time guests back within 90 days — the latest month whose window is complete.
  let ym = today.slice(0, 7);
  while (addDays(monthEnd(ym), 90) > yday) { const [y, m] = ym.split("-").map(Number); ym = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); }
  const prev = existing.return90;
  if (prev?.detail?.month === ym && prev.current != null) {
    const pd = prev.detail as { month: string; first_timers?: number; back?: number };   // already measured this month
    res.return90 = { value: prev.current, label: `${pd.back} of ${pd.first_timers} first-time guests in ${monthName(pd.month)}`, detail: prev.detail };
  } else {
    const [y, m] = ym.split("-").map(Number);
    const lookFrom = new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10);   // 3 months before
    const to = addDays(monthEnd(ym), 90);
    // ~7 months of nights is too many SevenRooms calls for one run (150 s limit),
    // so settled nights are cached in ap_sr_nights (client ids only) and at most
    // NIGHTS_PER_RUN missing ones are read per call. Until the cache covers the
    // window the measure says so instead of printing a partial number.
    const NIGHTS_PER_RUN = 40;
    const need = range(lookFrom, to);
    const { data: have } = await sb.from("ap_sr_nights").select("night,clients").gte("night", lookFrom).lte("night", to);
    const cached: Record<string, string[]> = {};
    (have || []).forEach((h: { night: string; clients: string[] }) => { cached[h.night] = h.clients || []; });
    const missing = need.filter((d) => !cached[d]).slice(0, NIGHTS_PER_RUN);
    if (missing.length) {
      const got = await nights(missing, 4);
      const rows = Object.entries(got.out).map(([d, rs]) => {
        const ids = [...new Set(rs.filter((r) => !gone(r) && r.client && !placeholder(r.name)).map((r) => String(r.client)))];
        cached[d] = ids;
        return { night: d, clients: ids, bookings: rs.filter((r) => !gone(r)).length };
      });
      if (rows.length) await sb.from("ap_sr_nights").upsert(rows, { onConflict: "night" });
    }
    const still = need.filter((d) => !cached[d]).length;
    if (still) {
      res.return90 = { value: prev?.current ?? null, label: `Building the 90-day history: ${need.length - still} of ${need.length} nights read`, detail: prev?.detail ?? null };
    } else {
      const G: Record<string, string[]> = {};
      need.forEach((d) => cached[d].forEach((id) => { (G[id] || (G[id] = [])).push(d); }));
      let n = 0, back = 0;
      Object.values(G).forEach((ds) => { const f = ds[0]; if (f.slice(0, 7) !== ym) return; n++; if (ds.some((d) => d > f && d <= addDays(f, 90))) back++; });
      res.return90 = { value: pct1(back, n), label: `${back} of ${n} first-time guests in ${monthName(ym)}`, detail: { month: ym, first_timers: n, back } };
    }
  }

  // Monday / Sunday guests — closing report (rev_daily). No row = No data, never zero.
  const lastDow = (want: number) => { let d = yday; while (dow(d) !== want) d = addDays(d, -1); return d; };
  for (const [key, want] of [["monday_guests", 1], ["sunday_guests", 0]] as const) {
    const d = lastDow(want);
    const { data } = await sb.from("rev_daily").select("service_date,rest_covers_actual,lounge_covers_actual").eq("venue_id", "robertos-difc").eq("service_date", d).limit(1);
    const r = data?.[0];
    const cov = r ? (Number(r.rest_covers_actual) || 0) + (Number(r.lounge_covers_actual) || 0) : null;
    res[key] = (r && cov) ? { value: cov, label: label(d), detail: { date: d } } : { value: null, label: "No data — no closing report for " + label(d), detail: { date: d } };
  }

  // Google rating
  const { data: g } = await sb.from("google_reviews_daily").select("snapshot_date,rating,user_rating_count").eq("venue_key", "robertos").order("snapshot_date", { ascending: false }).limit(1);
  if (g?.[0]) res.google_rating = { value: Number(g[0].rating), label: `${g[0].user_rating_count} reviews · ${label(g[0].snapshot_date)}` };

  // Relaunch: bookings 2–15 Nov vs 19 Oct–1 Nov (SevenRooms), once the after-window has closed.
  if (yday >= "2026-11-15") {
    const a = await nights(range("2026-10-19", "2026-11-15"));
    if (!a.failed.length) {
      const cnt = (f: string, t: string) => range(f, t).reduce((s, d) => s + (a.out[d] || []).filter((r) => !gone(r)).length, 0);
      const before = cnt("2026-10-19", "2026-11-01"), after = cnt("2026-11-02", "2026-11-15");
      res.relaunch_bookings = { value: after, label: `${after} after vs ${before} before (${after >= before ? "+" : ""}${after - before})`, detail: { before, after } };
    }
  }
  return { res, wkStart };
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
const NAMES: Record<string, string> = { "fguarracino@robertos.ae": "Francesco", "onafid@robertos.ae": "Ouafaa", "akadrie@skelmore.com": "Amin", "justin@skelmore.com": "Justin" };
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
    const { data: ms } = await sb.from("ap_measures").select("id,key,current,detail").not("key", "is", null);
    const byKey: Record<string, { id: string; current: number | null; detail: { month?: string } | null }> = {};
    (ms || []).forEach((m: { id: string; key: string; current: number | null; detail: { month?: string } | null }) => { byKey[m.key] = m; });
    const { res, wkStart } = await computeMeasures(sb, byKey);
    const now = new Date().toISOString();
    for (const [key, v] of Object.entries(res)) {
      const m = byKey[key]; if (!m) continue;
      await sb.from("ap_measures").update({ current: v.value, current_label: v.label, detail: v.detail ?? null, updated_at: now }).eq("id", m.id);
      await sb.from("ap_snapshots").upsert({ measure_id: m.id, week_start: wkStart, value: v.value, label: v.label, detail: v.detail ?? null, recorded_at: now }, { onConflict: "measure_id,week_start" });
    }
    if (mode === "refresh") return json({ ok: true, refreshed: Object.keys(res), week: wkStart });

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
    return json({ ok: true, sent: to.length, to, subject, by: isCron ? "schedule" : caller });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
