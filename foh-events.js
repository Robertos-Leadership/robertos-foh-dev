// ══════════════════════════════════════════════
//  foh-events.js — Events module (Leaders hub) + shared data/render/sync plumbing.
//  Slice 5 of the FOH file split — PURE RELOCATION from index.html (was the
//  "// -- DATA LOADING --" through "// -- LIVE SYNC --" sections), zero renames.
//  Classic (non-module) script: every function stays GLOBAL so inline onclick
//  handlers and the other slices keep working. Loaded AFTER the main inline
//  <script>, BEFORE foh-revenue.js (all cross-file calls resolve at call time).
//  Contains: loadAll/ensureWeekLoaded, renderMain/renderNav, dashboard + event
//  pages, week/task/finance actions, activity log, live sync (realtime).
// ══════════════════════════════════════════════
// -- DATA LOADING --
function upcomingWeeksSorted(weeks){
  const today = todayISO();
  return (weeks||[])
    .filter(w=>w.week_date && w.week_date >= today)
    .sort((a,b)=>a.week_date.localeCompare(b.week_date));
}

function pickDefaultWeekId(weeks){
  if(!weeks || !weeks.length) return null;
  const upcoming = upcomingWeeksSorted(weeks);
  if(upcoming.length) return upcoming[0].id;
  return weeks[0].id; // no upcoming: fall back to most recent
}

function setWeekScope(scope){
  state.weekScope = scope;
  for(const ev of state.events){
    const weeks = state.weeks[ev.id]||[];
    if(!weeks.length) continue;
    const upcoming = upcomingWeeksSorted(weeks);
    if(scope==='next'){
      // the week after this one, if it exists; otherwise stay on this week
      state.currentWeek[ev.id] = (upcoming[1] && upcoming[1].id) || (upcoming[0] && upcoming[0].id) || pickDefaultWeekId(weeks);
    } else if(scope==='last'){
      // most recent PAST week (week_date < today); else fall back to the default upcoming
      const past = (weeks||[]).filter(w=>w.week_date && String(w.week_date).slice(0,10) < todayISO()).sort((a,b)=>String(b.week_date).localeCompare(String(a.week_date)));
      state.currentWeek[ev.id] = (past[0] && past[0].id) || pickDefaultWeekId(weeks);
    } else {
      state.currentWeek[ev.id] = pickDefaultWeekId(weeks);
    }
  }
  renderMain();
}

// How far back tasks/finance are loaded up-front. Older weeks stay listed in the
// week dropdown and lazy-load on open (ensureWeekLoaded) \u2014 so the login payload
// stays flat as history grows and never brushes the 1000-row PostgREST cap
// (which would silently DROP task rows, the same row-cap bug class that hit the
// kitchen attendance load).
const EVENTS_ACTIVE_DAYS = 60;
async function loadAll(){
  const { data: events } = await sb.from('events').select('*').order('created_at');
  state.events = (events || []).slice().sort(eventSort);
  const evIds = state.events.map(e=>e.id);
  const allWeeks = evIds.length
    ? (await sb.from('weeks').select('*').in('event_id', evIds).order('week_date',{ascending:false})).data || []
    : [];
  for(const ev of state.events){
    state.weeks[ev.id] = allWeeks.filter(w=>w.event_id===ev.id);
    const stillExists = state.currentWeek[ev.id] && state.weeks[ev.id].some(w=>w.id===state.currentWeek[ev.id]);
    if(state.weeks[ev.id].length && !stillExists){
      state.currentWeek[ev.id] = pickDefaultWeekId(state.weeks[ev.id]);
    }
  }
  // Tasks + finance for ACTIVE weeks only (upcoming + last EVENTS_ACTIVE_DAYS).
  const _today = todayISO();
  const cutoffD = new Date(); cutoffD.setDate(cutoffD.getDate() - EVENTS_ACTIVE_DAYS);
  const cutoff = localISO(cutoffD);
  const activeWeeks = allWeeks.filter(w=>!w.week_date || String(w.week_date).slice(0,10) >= cutoff);
  const wIds = activeWeeks.map(w=>w.id);
  if(wIds.length){
    const [tRes, fRes] = await Promise.all([
      sb.from('tasks').select('*').in('week_id', wIds).order('sort_order'),
      sb.from('finance').select('*').in('week_id', wIds).order('created_at')
    ]);
    for(const w of activeWeeks){
      state.tasks[w.id] = (tRes.data||[]).filter(t=>t.week_id===w.id);
      state.finance[w.id] = (fRes.data||[]).filter(f=>f.week_id===w.id);
    }
  }
  // First paint BEFORE the auto-roll writes below \u2014 login lands on data
  // immediately instead of waiting on per-event inserts.
  state.currentTab = resolveTab(state.currentTab);
  renderNav();
  renderMain();
  // Auto-roll: every active recurring event always has its next occurrence ready.
  // When this week's night passes (or is completed), the next week's row is created
  // automatically on the following load - with the full task template seeded.
  let rolled = false;
  for(const ev of state.events){
    if((ev.status||'active')==='paused') continue;
    const hasUpcoming = (state.weeks[ev.id]||[]).some(w=>w.week_date && String(w.week_date).slice(0,10) >= _today);
    if(hasUpcoming) continue;
    const next = nextOccurrence(ev.day_of_week);
    const dateStr = localISO(next);
    // Guard against double-creation from a parallel session
    const dup = (await sb.from('weeks').select('id').eq('event_id',ev.id).eq('week_date',dateStr)).data||[];
    if(dup.length){ continue; }
    const label = next.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
    const { data, error } = await sb.from('weeks').insert({
      event_id: ev.id, week_date: dateStr, week_label: label, status: 'upcoming'
    }).select().single();
    if(error || !data) continue;
    await seedDefaultTasks(data.id, ev.id, ev.name, data.week_date);
    state.weeks[ev.id].unshift(data);
    state.currentWeek[ev.id] = data.id;
    logActivity('auto-created week', label + ' \u2014 ' + ev.name);
    rolled = true;
  }
  if(rolled){ renderNav(); renderMain(); }
}
// Lazy-load one older week's tasks + finance when it's opened from the dropdown.
// state.tasks[wid] === undefined means "not loaded yet" (vs [] = loaded, empty).
const _weekLoading = {};
async function ensureWeekLoaded(weekId){
  if(!weekId || state.tasks[weekId] !== undefined || _weekLoading[weekId]) return;
  _weekLoading[weekId] = true;
  try{
    const [tRes, fRes] = await Promise.all([
      sb.from('tasks').select('*').eq('week_id', weekId).order('sort_order'),
      sb.from('finance').select('*').eq('week_id', weekId).order('created_at')
    ]);
    if(!tRes.error) state.tasks[weekId] = tRes.data||[];
    if(!fRes.error) state.finance[weekId] = fRes.data||[];
  }catch(e){ console.warn('[ensureWeekLoaded]', e); }
  _weekLoading[weekId] = false;
  renderMain();
}
// Page an .in() fetch past the 1000-row PostgREST cap — same shape as
// revFetchAllDaily / peFetchAllPaged elsewhere in the app. Ordered by id because
// that is stable across page boundaries: sort_order and created_at repeat across
// weeks, so paging on them could skip or double rows at the seam.
async function evFetchAllPaged(makeQuery){
  var out=[], from=0, PAGE=1000;
  for(;;){
    const res = await makeQuery().range(from, from+PAGE-1);
    if(res && res.error) return { data:out, error:res.error };
    const batch = (res && res.data) || [];
    out = out.concat(batch);
    if(batch.length < PAGE) break;
    from += PAGE;
  }
  return { data:out, error:null };
}
// Load tasks + finance for every week passed in that isn't already in state, in
// ONE paged pair of queries (loadAll's .in() pattern) rather than one pair per
// week — a report spanning two years of a weekly event would otherwise fire a
// request per week. Paged, because that same bulk fetch is exactly what the
// EVENTS_ACTIVE_DAYS window exists to keep away from the 1000-row cap.
// Every week fetched is set to an array — [] when it genuinely has no rows — so
// "loaded and empty" stays distinguishable from "never loaded".
// Returns false if the load failed, so the caller can say so instead of
// rendering a zero it can't stand behind.
async function ensureWeeksLoaded(weeks){
  const missing = (weeks||[]).filter(function(w){ return w && (state.tasks[w.id]===undefined || state.finance[w.id]===undefined); });
  if(!missing.length) return true;
  const wIds = missing.map(function(w){ return w.id; });
  const [tRes, fRes] = await Promise.all([
    evFetchAllPaged(function(){ return sb.from('tasks').select('*').in('week_id', wIds).order('id'); }),
    evFetchAllPaged(function(){ return sb.from('finance').select('*').in('week_id', wIds).order('id'); })
  ]);
  if(tRes.error || fRes.error){ console.warn('[ensureWeeksLoaded] load failed', tRes.error||fRes.error); return false; }
  missing.forEach(function(w){
    // Re-sort in memory to the order the rest of the app renders in — the fetch
    // is id-ordered only so the paging above stays stable.
    state.tasks[w.id] = tRes.data.filter(function(t){ return t.week_id===w.id; }).sort(function(a,b){ return (a.sort_order||0)-(b.sort_order||0); });
    state.finance[w.id] = fRes.data.filter(function(f){ return f.week_id===w.id; }).sort(function(a,b){ return String(a.created_at||'').localeCompare(String(b.created_at||'')); });
  });
  return true;
}

// -- RENDER MAIN --
var _lastRenderTab = null, _lastRenderHTML = null;
function renderMain(){
  const el = document.getElementById('main-content');
  const sec = document.getElementById('topbar-section');
  const tab = state.currentTab;
  if(sec) sec.textContent = tab==='revenue' ? 'Revenue' : (tab==='operations' ? 'Closing Report' : (tab==='stocktake' ? 'Stock Take' : (tab==='admin' ? 'Admin' : (tab==='privateevents' ? 'Events' : (tab==='reviews' ? 'Guest Reviews' : (tab==='reservations' ? 'Reservations' : (tab==='dashboard' ? 'Leaders' : 'Activations')))))));
  // Build the HTML first, then only touch the DOM if it actually changed.
  // The realtime path reloads all tables and re-renders on ANY change from ANY
  // screen — most of which don't affect the current view. Skipping an identical
  // rewrite avoids the reflow, the scroll-jump/flicker on the always-on wall
  // screens, and needless listener re-attachment. renderMain is the sole writer
  // of #main-content, so the cached string always matches what's on screen.
  let html, needsListeners = false;
  if(tab==='revenue'){ html = renderRevenue(); }
  else if(tab==='operations'){ html = renderOperations(); }
  else if(tab==='stocktake'){ html = renderStockTake(); }
  else if(tab==='admin'){ html = renderAdmin(); }
  else if(tab==='privateevents'){ html = (typeof renderPrivateEvents==='function') ? renderPrivateEvents() : '<div class="loading">Loading\u2026</div>'; }
  else if(tab==='reviews'){ html = (typeof renderReviews==='function') ? renderReviews() : '<div class="loading">Loading\u2026</div>'; }
  else if(tab==='reservations'){ html = (typeof renderReservations==='function') ? renderReservations() : '<div class="loading">Loading\u2026</div>'; }
  else if(state.events.length===0){ html = '<div class="loading">Loading...</div>'; }
  else if(tab==='dashboard'){ html = renderDashboard(); needsListeners = true; }
  else { html = renderEventPage(state.events.find(e=>e.id===tabEventId(tab))); needsListeners = true; }
  if(tab===_lastRenderTab && html===_lastRenderHTML) return;
  _lastRenderTab = tab; _lastRenderHTML = html;
  el.innerHTML = html;
  if(needsListeners) attachEventListeners();
}

// -- DASHBOARD --
// Performance strip for an activation card. Reads ONLY from the weeks already
// loaded at login (revenue_actual / covers_actual / avg_spend_actual entered via
// the "Enter Results" screen) — no new table, no extra query. Shows the latest
// completed night's net sales, covers and spend-per-guest, a trend vs the prior
// weeks, a 5-week mini-bar, and turns red when a night drops hard so Francesco
// catches it before the leaders do.
// Chronological list of every week for an activation that has results entered,
// each normalised to { w, rev, covers, avg }. Shared by the card strip and the
// overview. Reads only the weeks already in memory — no query.
function activationResultWeeks(ev){
  return (state.weeks[ev.id] || []).map(w=>{
    const covers = Number(w.covers_actual)||0;
    const savedRev = Number(w.revenue_actual)||0;
    const savedAvg = Number(w.avg_spend_actual)||0;
    const rev = savedRev || (covers && savedAvg ? covers*savedAvg : 0);
    return { w, rev, covers, avg: savedAvg || (covers && rev ? rev/covers : 0) };
  })
  .filter(x=>x.rev>0)
  .sort((a,b)=>String(a.w.week_date||'').localeCompare(String(b.w.week_date||'')));
}

function activationPerf(ev){
  const weeks = state.weeks[ev.id] || [];
  const withNums = activationResultWeeks(ev);

  const past = weeks.filter(w=>w.week_date && String(w.week_date).slice(0,10) < todayISO())
                    .sort((a,b)=>String(b.week_date).localeCompare(String(a.week_date)));
  if(!withNums.length) return { empty:true, lastPast: past[0]||null };

  const latest = withNums[withNums.length-1];
  const prior = withNums.slice(-5,-1);                 // up to 4 weeks before latest
  const priorAvg = prior.length ? prior.reduce((s,x)=>s+x.rev,0)/prior.length : 0;
  const deltaPct = priorAvg ? Math.round((latest.rev-priorAvg)/priorAvg*100) : null;
  const prev = withNums.length>=2 ? withNums[withNums.length-2] : null;
  const dropVsPrev = (prev && prev.rev) ? Math.round((latest.rev-prev.rev)/prev.rev*100) : null;
  const attention = (dropVsPrev!==null && dropVsPrev<=-40) || (deltaPct!==null && deltaPct<=-40) || latest.rev<=0;
  return { empty:false, latest, prev, priorAvg, deltaPct, dropVsPrev, attention, bars: withNums.slice(-5) };
}

function activationPerfStrip(ev){
  const p = activationPerf(ev);
  if(p.empty){
    return `<div class="perf-strip" style="margin-top:12px;padding-top:12px;border-top:1px dashed rgba(107,31,42,.25);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--text-light)">No results entered yet</span>
      ${p.lastPast ? `<button class="btn btn-outline btn-sm" onclick="openWeekActuals('${p.lastPast.id}')">Enter ${fmtDate(p.lastPast.week_date)} numbers</button>` : ''}
    </div>`;
  }
  const L = p.latest;
  const perGuest = L.avg || (L.covers ? L.rev/L.covers : 0);
  const money = n => Math.round(n).toLocaleString();
  const chip = p.deltaPct===null ? '' : (()=>{
    const up = p.deltaPct>=0;
    const col = up ? 'var(--green)' : 'var(--red)';
    const bg = up ? '#e9f3ee' : '#fbeaea';
    const ico = up ? 'trending-up' : 'trending-down';
    return `<span style="font-size:11px;color:${col};background:${bg};border-radius:999px;padding:3px 9px;white-space:nowrap"><i class="ti ti-${ico}" style="vertical-align:-2px"></i> ${up?'up':'down'} ${Math.abs(p.deltaPct)}% vs ${p.bars.length>2?p.bars.length-1+'-wk':'prev'} avg</span>`;
  })();
  const maxRev = Math.max(...p.bars.map(x=>x.rev), 1);
  const bars = p.bars.map((x,i)=>{
    const last = i===p.bars.length-1;
    const h = Math.max(Math.round(x.rev/maxRev*100), 6);
    return `<div title="${fmtDate(x.w.week_date)} · AED ${money(x.rev)}" style="flex:1;height:${h}%;background:${last?'var(--vino)':'#e3d3d6'};border-radius:3px 3px 0 0"></div>`;
  }).join('');
  const tile = (label,val)=>`<div style="background:var(--surface2);border-radius:8px;padding:9px 10px"><div style="font-size:10px;color:var(--vino);text-transform:uppercase;letter-spacing:.06em">${label}</div><div style="font-size:20px;font-weight:500;color:${p.attention?'var(--red)':'var(--vino-dark)'};line-height:1.2">${val}</div></div>`;
  const flag = p.attention && p.prev
    ? `<div style="font-size:12px;color:var(--red);margin-top:9px"><i class="ti ti-alert-triangle" style="vertical-align:-2px"></i> Down ${Math.abs(p.dropVsPrev)}% vs last week (${money(p.prev.rev)} &rarr; ${money(L.rev)}). Worth a look before the leaders see it.</div>`
    : '';
  return `<div class="perf-strip" style="margin-top:12px;padding-top:12px;border-top:1px dashed rgba(107,31,42,.25)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;flex-wrap:wrap">
      <span style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-dim)">Last result · ${fmtDate(L.w.week_date)}</span>
      ${chip}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px">
      ${tile('Net sales', money(L.rev))}
      ${tile('Covers', L.covers||'—')}
      ${tile('Per guest', perGuest?money(perGuest):'—')}
    </div>
    ${p.bars.length>1 ? `<div style="display:flex;align-items:flex-end;gap:5px;height:30px;margin-top:11px">${bars}</div><div style="font-size:10px;color:var(--vino-light);margin-top:4px">Last ${p.bars.length} results · AED net · latest highlighted</div>` : ''}
    ${flag}
  </div>`;
}

// ---- Week stepper (view one week at a time, as far back as data goes) ----
// A single global offset from each activation's default (upcoming) week: 0 = this
// week, -1 = last week, -2 = two weeks ago, +1 = next week. Each activation steps
// through ITS OWN occurrences, so cadence differences don't matter.
function weekOffsetLabel(off){
  if(off===0) return 'This week';
  if(off===-1) return 'Last week';
  if(off===1) return 'Next week';
  return off<0 ? Math.abs(off)+' weeks ago' : off+' weeks ahead';
}
function eventChron(ev){
  return (state.weeks[ev.id]||[]).filter(w=>w.week_date)
    .slice().sort((a,b)=>String(a.week_date).localeCompare(String(b.week_date)));
}
function eventDefaultIdx(ev){
  const chron = eventChron(ev);
  const def = pickDefaultWeekId(state.weeks[ev.id]||[]);
  let idx = chron.findIndex(w=>w.id===def);
  return idx<0 ? chron.length-1 : idx;
}
function weekOffsetBounds(){
  let back=0, fwd=0;
  for(const ev of state.events){
    if((ev.status||'active')==='paused') continue;
    const chron = eventChron(ev);
    if(!chron.length) continue;
    const idx = eventDefaultIdx(ev);
    back = Math.max(back, idx);
    fwd = Math.max(fwd, chron.length-1-idx);
  }
  return { back, fwd };
}
function applyWeekOffset(){
  const off = state.weekOffset||0;
  for(const ev of state.events){
    const chron = eventChron(ev);
    if(!chron.length) continue;
    const t = Math.min(Math.max(eventDefaultIdx(ev)+off, 0), chron.length-1);
    state.currentWeek[ev.id] = chron[t].id;
    ensureWeekLoaded(chron[t].id);   // older weeks' tasks aren't loaded at login
  }
}
function setWeekStep(delta){
  const b = weekOffsetBounds();
  state.weekOffset = Math.min(Math.max((state.weekOffset||0)+delta, -b.back), b.fwd);
  applyWeekOffset();
  renderMain();
}
function resetWeekOffset(){ state.weekOffset = 0; applyWeekOffset(); renderMain(); }

// ---- Activations overview (all activations, several weeks, one lens) ----
function setActivationsView(v){ state.activationsView = v; renderMain(); }
function setOverviewPeriod(p){ state.overviewPeriod = p; renderMain(); }
function toggleOverviewEvent(id){
  state.overviewExpanded = state.overviewExpanded || {};
  state.overviewExpanded[id] = !state.overviewExpanded[id];
  renderMain();
}
const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Distinct calendar months (YYYY-MM) that have results, most recent first.
function overviewMonths(){
  const set = new Set();
  state.events.filter(e=>(e.status||'active')!=='paused')
    .forEach(ev=>activationResultWeeks(ev).forEach(x=>{
      const ym = String(x.w.week_date||'').slice(0,7);
      if(ym.length===7) set.add(ym);
    }));
  return [...set].sort().reverse();
}
function monthChipLabel(ym, multiYear){
  const [y,m] = ym.split('-');
  const name = MONTH_NAMES[Number(m)-1] || ym;
  return multiYear ? name+" '"+y.slice(2) : name;   // "Jul '26" only when data spans >1 year
}
function renderActivationsOverview(){
  const months = overviewMonths();
  // Scope is a calendar month (YYYY-MM) or 'all'. Old numeric values (the former
  // rolling week-count chips) migrate to the most recent month with data.
  let period = state.overviewPeriod;
  if(period===undefined || typeof period==='number') period = months[0] || 'all';
  const money = n => Math.round(n).toLocaleString();
  const expanded = state.overviewExpanded || {};
  const acts = state.events.filter(e=>(e.status||'active')!=='paused');

  let grandTotal = 0, best = null, attentionNames = [];
  let nightCount = 0, totCovers = 0, coversNights = 0, revWithCovers = 0;   // for averages
  const rows = acts.map(ev=>{
    const all = activationResultWeeks(ev);
    const wks = period==='all' ? all : all.filter(x=>String(x.w.week_date||'').slice(0,7)===period);
    if(!wks.length){
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--vino-dark)">${ev.name}</div>
        <div style="font-size:12px;color:var(--text-light)">No results yet</div></div>`;
    }
    const latest = wks[wks.length-1];
    const total = wks.reduce((s,x)=>s+x.rev,0);
    grandTotal += total;
    nightCount += wks.length;
    for(const x of wks){
      if(!best || x.rev>best.rev) best = { rev:x.rev, name:ev.name, date:x.w.week_date };
      if(x.covers){ totCovers += x.covers; coversNights++; revWithCovers += x.rev; }
    }
    // this activation's own averages (shown when its row is expanded)
    const evCoversNights = wks.filter(x=>x.covers).length;
    const evCovers = wks.reduce((s,x)=>s+(x.covers||0),0);
    const evAvgRev = total / wks.length;
    const evAvgCovers = evCoversNights ? evCovers/evCoversNights : null;
    const evAvgSpend = evCovers ? wks.filter(x=>x.covers).reduce((s,x)=>s+x.rev,0)/evCovers : null;
    const prior = wks.slice(0,-1);
    const priorAvg = prior.length ? prior.reduce((s,x)=>s+x.rev,0)/prior.length : 0;
    const deltaPct = priorAvg ? Math.round((latest.rev-priorAvg)/priorAvg*100) : null;
    const prev = wks.length>=2 ? wks[wks.length-2] : null;
    const dropVsPrev = (prev&&prev.rev) ? Math.round((latest.rev-prev.rev)/prev.rev*100) : null;
    const attention = (dropVsPrev!==null && dropVsPrev<=-40) || latest.rev<=0;
    if(attention) attentionNames.push(ev.name);

    const maxRev = Math.max(...wks.map(x=>x.rev), 1);
    const bars = wks.map((x,i)=>{
      const last = i===wks.length-1;
      const h = Math.max(Math.round(x.rev/maxRev*100), 6);
      return `<div title="${fmtDate(x.w.week_date)} · AED ${money(x.rev)}" style="flex:1;height:${h}%;background:${last?(attention?'var(--red)':'var(--vino)'):'#e3d3d6'};border-radius:2px 2px 0 0"></div>`;
    }).join('');
    const barsHtml = wks.length>1
      ? `<div style="display:flex;align-items:flex-end;gap:4px;height:32px;width:90px;flex:none">${bars}</div>`
      : `<div style="width:90px;flex:none;text-align:center;font-size:11px;color:var(--text-light)">1 result</div>`;
    const arrow = deltaPct===null ? '' :
      `<span style="font-size:12px;color:${deltaPct>=0?'var(--green)':'var(--red)'};white-space:nowrap"><i class="ti ti-trending-${deltaPct>=0?'up':'down'}" style="vertical-align:-2px"></i> ${deltaPct>=0?'+':''}${deltaPct}%</span>`;
    const isOpen = !!expanded[ev.id];
    const detail = isOpen ? `
      <div style="margin-top:12px;border-top:1px dashed rgba(107,31,42,.2);padding-top:10px">
        <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:6px 14px;font-size:12px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--gold-dim)">Week</div>
          <div style="font-size:10px;text-transform:uppercase;color:var(--gold-dim);text-align:right">Net</div>
          <div style="font-size:10px;text-transform:uppercase;color:var(--gold-dim);text-align:right">Covers</div>
          <div style="font-size:10px;text-transform:uppercase;color:var(--gold-dim);text-align:right">Per guest</div>
          ${wks.slice().reverse().map((x,i)=>{
            const bad = i===0 && attention;
            const c = bad ? 'var(--red)' : 'var(--text)';
            return `<div style="color:${bad?'var(--red)':'var(--vino-dark)'}">${fmtDate(x.w.week_date)}</div>
              <div style="text-align:right;color:${c}">${money(x.rev)}</div>
              <div style="text-align:right;color:${c}">${x.covers||'—'}</div>
              <div style="text-align:right;color:${c}">${x.avg?money(x.avg):'—'}</div>`;
          }).join('')}
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--vino)">${wks.length} night${wks.length===1?'':'s'} · avg net AED ${money(evAvgRev)}${evAvgCovers?` · avg ${Math.round(evAvgCovers)} covers`:''}${evAvgSpend?` · avg spend AED ${money(evAvgSpend)}`:''}</div>
      </div>` : '';
    return `<div style="background:var(--surface);border:1px solid ${attention?'var(--red)':'var(--border)'};${attention?'border-left:4px solid var(--red);border-radius:0 8px 8px 0':'border-radius:8px'};padding:14px 16px;margin-bottom:8px;cursor:pointer" onclick="toggleOverviewEvent('${ev.id}')">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="flex:1;min-width:0">
          <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--vino-dark)">${ev.name}</div>
          <div style="font-size:12px;color:${attention?'var(--red)':'var(--vino)'}">latest ${money(latest.rev)} · total ${money(total)}${attention?' · needs attention':''}</div>
        </div>
        ${barsHtml}
        ${arrow}
        <i class="ti ti-chevron-${isOpen?'down':'right'}" style="color:var(--vino-light);flex:none"></i>
      </div>
      ${detail}
    </div>`;
  }).join('');

  const multiYear = new Set(months.map(m=>m.slice(0,4))).size>1;
  const periodChip = (val,label)=>`<span onclick="setOverviewPeriod(${typeof val==='string'?`'${val}'`:val})" style="cursor:pointer;font-size:12px;padding:5px 12px;border-radius:999px;${period===val?'background:var(--vino);color:#fff':'background:var(--surface);border:1px solid var(--border-strong);color:var(--vino)'}">${label}</span>`;
  const periodWord = period==='all' ? 'all time' : monthChipLabel(period, multiYear);
  const avgRev = nightCount ? grandTotal/nightCount : 0;
  const avgCovers = coversNights ? totCovers/coversNights : null;
  const avgSpend = totCovers ? revWithCovers/totCovers : null;
  const metric = (label,val,strong)=>`<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 13px">
      <div style="font-size:10px;color:var(--vino);text-transform:uppercase;letter-spacing:.06em">${label}</div>
      <div style="font-size:${strong?22:19}px;font-weight:500;color:var(--vino-dark);line-height:1.2;margin-top:2px">${val}</div></div>`;
  const tiles = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;margin-bottom:10px">
      ${metric('Total events · '+periodWord, nightCount, true)}
      ${metric('Total net', 'AED '+money(grandTotal), true)}
      ${metric('Avg net / event', 'AED '+money(avgRev))}
      ${metric('Avg covers / event', avgCovers?Math.round(avgCovers):'—')}
      ${metric('Avg spend / guest', avgSpend?'AED '+money(avgSpend):'—')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
        <div style="font-size:11px;color:var(--vino);text-transform:uppercase;letter-spacing:.06em">Best night</div>
        <div style="font-size:14px;font-weight:500;color:var(--green);line-height:1.25;margin-top:4px">${best?`${best.name} · ${fmtDate(best.date)}<br><span style="font-size:13px;color:var(--vino-dark)">AED ${money(best.rev)}</span>`:'—'}</div></div>
      <div style="background:var(--surface);border:1px solid ${attentionNames.length?'var(--red)':'var(--border)'};border-radius:10px;padding:12px 14px">
        <div style="font-size:11px;color:${attentionNames.length?'var(--red)':'var(--vino)'};text-transform:uppercase;letter-spacing:.06em">Needs attention</div>
        <div style="font-size:14px;font-weight:500;color:${attentionNames.length?'var(--red)':'var(--text-light)'};line-height:1.25;margin-top:4px">${attentionNames.length?attentionNames.join(', '):'None · all steady'}</div></div>
    </div>`;

  return `
    <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:14px">
      ${months.map(m=>periodChip(m, monthChipLabel(m, multiYear))).join('')}${periodChip('all','All')}
    </div>
    ${tiles}
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:8px">All activations · tap one to open its weeks</div>
    ${rows || '<div class="empty-state">No activations yet.</div>'}`;
}

function renderDashboard(){
  const _view = state.activationsView || 'weekly';
  const _viewToggle = `<div class="view-toggle" style="display:inline-flex;border:1px solid var(--border-strong);border-radius:999px;overflow:hidden">
    <button onclick="setActivationsView('weekly')" style="border:none;cursor:pointer;font-size:12px;padding:6px 14px;background:${_view==='weekly'?'var(--vino)':'transparent'};color:${_view==='weekly'?'#fff':'var(--vino)'}">Weekly</button>
    <button onclick="setActivationsView('overview')" style="border:none;cursor:pointer;font-size:12px;padding:6px 14px;background:${_view==='overview'?'var(--vino)':'transparent'};color:${_view==='overview'?'#fff':'var(--vino)'}">Overview</button>
  </div>`;
  if(_view==='overview'){
    return `
    <div class="dashboard-header">
      <div><div class="page-title">Activations</div><div class="page-sub">Every activation, several weeks, one view.</div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${_viewToggle}
        <button class="btn btn-gold btn-sm" onclick="openAddResult()">+ Add night's numbers</button>
        <button class="btn btn-outline btn-sm" onclick="openActivity()">Activity</button></div>
    </div>
    ${renderActivationsOverview()}`;
  }
  let allTasks = [];
  const eventCards = [];
  const tonightEvents = [];
  const eventOptions = [];
  const activeLeader = state.ownerFilter || 'All';

  for(const ev of state.events){
    if((ev.status||'active')==='paused'){
      eventCards.push(`
      <div class="event-journey-card" style="opacity:.55">
        <div class="event-card-top">
          <div class="event-card-title">${ev.name}</div>
          <div class="event-card-date">${ev.day_of_week} | Paused</div>
        </div>
        <div class="event-card-note">Paused - no new weeks will be created until resumed.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-gold btn-sm" onclick="toggleEventPause('${ev.id}')">Resume</button>
        </div>
      </div>`);
      continue;
    }
    const wid = state.currentWeek[ev.id];
    if(!wid) continue;
    const week = (state.weeks[ev.id]||[]).find(w=>w.id===wid);
    if(week && week.status==='cancelled'){
      eventCards.push(`
      <div class="event-journey-card" style="opacity:.6">
        <div class="event-card-top">
          <div class="event-card-title">${ev.name}</div>
          <div class="event-card-date">${week.week_label||week.week_date} | Cancelled</div>
        </div>
        <div class="event-card-note">Cancelled for this week only - the activation runs as normal every other week.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-gold btn-sm" onclick="restoreWeek('${week.id}','${ev.id}')">Restore this week</button>
        </div>
      </div>`);
      continue;
    }
    const tasks = state.tasks[wid]||[];
    const readiness = readinessForTasks(tasks);
    const currentStage = state.selectedStage[ev.id] || currentStageForTasks(tasks);
    const stage = STAGES[currentStage] || STAGES.prepare;
    const nonOpen = tasks.filter(t=>getPriority(t)==='non_negotiable' && t.status!=='done').length;
    const blocked = tasks.filter(t=>t.status==='blocked').length;
    const nextDue = tasks.filter(t=>t.status!=='done' && t.due_date).sort((a,b)=>a.due_date.localeCompare(b.due_date))[0];
    const dleft = week ? daysUntil(week.week_date) : null;
    const when = dleft===0 ? 'Tonight' : dleft===1 ? 'Tomorrow' : (dleft>1 ? `In ${dleft} days` : '');
    const doneCt = tasks.filter(t=>t.status==='done').length;
    const cardPct = tasks.length ? Math.round(doneCt/tasks.length*100) : 0;
    allTasks = allTasks.concat(tasks.map(t=>({...t, eventName:ev.name, eventId:ev.id, weekId:wid})));
    eventOptions.push(`<option value="${ev.id}">${ev.name}</option>`);
    if(dleft===0) tonightEvents.push(ev);
    eventCards.push(`
      <div class="event-journey-card">
        <div class="event-card-top">
          <div class="event-card-title">${ev.name}</div>
          <div class="event-card-date">${week?.week_label || week?.week_date || ev.day_of_week}${when ? ' | '+when : ''}</div>
        </div>
        <div class="event-card-stage">Stage ${stage.rank+1} of 4: ${stage.label}</div>
        <div style="margin:8px 0 4px"><div class="progress-bar" style="height:8px"><div class="progress-fill ${readiness.status}" style="width:${cardPct}%"></div></div></div>
        <div class="event-card-note"><strong>${tasks.length-doneCt} remaining</strong> | ${doneCt}/${tasks.length} done | ${readiness.label}${nonOpen ? ` | ${nonOpen} non-negotiable open` : ''}${blocked ? ` | ${blocked} blocked` : ''}${nextDue ? ` | Next: ${fmtDate(nextDue.due_date)}` : ''}</div>
        ${activationPerfStrip(ev)}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-gold btn-sm" onclick="openJourney('${ev.id}','full')">Open Journey</button>
          <button class="btn btn-outline btn-sm" onclick="openJourney('${ev.id}','pending')">Pending Journey</button>
          <button class="btn btn-outline btn-sm" onclick="cancelWeek('${wid}','${ev.id}')">Cancel this week</button>
        </div>
      </div>`);
  }

  const tonightBanner = tonightEvents.map(ev=>`
    <div class="tonight-banner">
      <div><div class="tb-title">Tonight: ${ev.name}</div><div class="tb-sub">Showtime. Open the Execute stage for the run-of-night checklist.</div></div>
      <button class="btn btn-gold" onclick="openTonight('${ev.id}')">Open Execute</button>
    </div>`).join('');

  const leaderTasks = allTasks
    .filter(t=>ownerMatches(t, activeLeader))
    .filter(t=>t.status!=='done')
    .filter(t=>state.leaderPriorityFilter==='All' || getPriority(t)===state.leaderPriorityFilter)
    .sort(taskSort)
    .slice(0,60);
  const leaderList = leaderTasks.length
    ? renderLeaderTaskGroups(leaderTasks)
    : '<div class="empty-state" style="background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow)">No pending tasks for this leader.</div>';

  const urgent = leaderTasks
    .filter(t=>t.status==='blocked' || (getPriority(t)==='non_negotiable' && isOverdue(t.due_date)) || isDueToday(t.due_date))
    .slice(0,6);
  const attention = urgent.length
    ? urgent.map(t=>`
      <div class="attention-card ${t.status==='blocked'?'blocked':''}">
        <div>
          <div class="attention-title">${t.title}</div>
          <div class="attention-meta">${t.eventName} | ${stageLabel(getStage(t))} | ${priorityLabel(t)} | ${t.assigned_to||'Unassigned'} | ${fmtDate(t.due_date)}</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="switchTab('${eventTab(state.events.find(e=>e.id===t.eventId))}')">Open</button>
      </div>`).join('')
    : '<div class="empty-state" style="background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow)">No urgent action. Activations are on track.</div>';

  // all-time done counts across every loaded week
  const allTimeDone = {};
  for(const wid in state.tasks){
    for(const t of state.tasks[wid]){
      if(t.status!=='done') continue;
      TEAM.forEach(name=>{ if(ownerMatches(t, name)) allTimeDone[name] = (allTimeDone[name]||0) + 1; });
    }
  }
  const leaderSummary = TEAM.map(name=>{
    const tasks = allTasks.filter(t=>ownerMatches(t, name) && t.status!=='done');
    const doneWeek = allTasks.filter(t=>ownerMatches(t, name) && t.status==='done').length;
    const doneAll = allTimeDone[name]||0;
    const counts = Object.keys(PRIORITIES).reduce((acc,p)=>{ acc[p]=tasks.filter(t=>getPriority(t)===p).length; return acc; }, {});
    return `
      <div class="leader-summary-card ${state.ownerFilter===name?'active':''}" onclick="setOwnerFilter(state.ownerFilter==='${name}' ? 'All' : '${name}')">
        <div class="leader-summary-name">${name}</div>
        <div class="leader-summary-total">${tasks.length} pending</div>
        <div class="leader-summary-done">&check; ${doneWeek} done this week &middot; ${doneAll} total</div>
        <div class="leader-summary-breakdown">
          <span class="priority-pill non_negotiable">${counts.non_negotiable} Non</span>
          <span class="priority-pill important">${counts.important} Important</span>
          <span class="priority-pill enhancement">${counts.enhancement} Enhance</span>
        </div>
      </div>`;
  }).join('');
  const priorityChips = ['All', ...Object.keys(PRIORITIES)].map(priority=>{
    const label = priority==='All' ? 'All Priorities' : PRIORITIES[priority].label;
    const cls = priority==='All' ? '' : ' pr-'+priority;
    return `<button class="filter-chip${cls} ${state.leaderPriorityFilter===priority?'active':''}" onclick="setLeaderPriorityFilter('${priority}')">${label}</button>`;
  }).join('');

  const off = state.weekOffset||0;
  const bounds = weekOffsetBounds();
  const stepper = `
      <div class="week-scope" style="display:flex;align-items:center;gap:8px">
        <button class="week-scope-btn" ${off<=-bounds.back?'disabled style="opacity:.4;cursor:default"':''} onclick="setWeekStep(-1)" title="Previous week">&#9664; Prev</button>
        <span style="min-width:92px;text-align:center;font-size:12px;font-weight:500;color:var(--vino)">${weekOffsetLabel(off)}</span>
        <button class="week-scope-btn" ${off>=bounds.fwd?'disabled style="opacity:.4;cursor:default"':''} onclick="setWeekStep(1)" title="Next week">Next &#9654;</button>
        ${off!==0?`<button class="week-scope-btn" onclick="resetWeekOffset()">This week</button>`:''}
      </div>`;
  return `
  <div class="dashboard-header">
    <div><div class="page-title">Activations</div><div class="page-sub">One clear action list by person, across every event.</div></div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${_viewToggle}
      ${stepper}
      <button class="btn btn-gold btn-sm" onclick="openAddResult()">+ Add night's numbers</button>
      <button class="btn btn-outline btn-sm" onclick="openActivity()">Activity</button>
    </div>
  </div>
  ${tonightBanner}
  <div class="section-header"><div class="section-title">${off===0?'This Week':weekOffsetLabel(off)}</div></div>
  <div class="home-card-grid">${eventCards.join('')}</div>
  <div class="section-header" style="margin-top:26px"><div class="section-title">Team</div></div>
  <div class="leader-summary-grid">${leaderSummary}</div>
  <div class="leader-actions-row">
    <div class="section-title">Pending Jobs${activeLeader!=='All' ? ' | '+activeLeader : ''}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${activeLeader!=='All' ? `<button class="btn btn-outline btn-sm" onclick="setOwnerFilter('All')">Show All</button>` : ''}
      <button class="btn btn-gold btn-sm" onclick="openLeaderAddTask()">+ Add Task</button>
      <button class="btn btn-outline btn-sm" onclick="openLeaderActions('${activeLeader}')">More Actions</button>
    </div>
  </div>
  <div class="owner-filter" style="margin-bottom:12px">${priorityChips}</div>
  <div class="leader-task-list">${leaderList}</div>
  <div class="section-header"><div class="section-title">Needs Attention${activeLeader!=='All' ? ' | '+activeLeader : ''}</div></div>
  <div class="attention-list">${attention}</div>`;
}
function openTonight(eventId){
  const ev = state.events.find(e=>e.id===eventId);
  if(!ev) return;
  state.selectedStage[eventId] = 'execute';
  switchTab(eventTab(ev));
}

function renderLeaderTaskGroups(tasks){
  const groups = [];
  for(const t of tasks){
    let group = groups.find(g=>g.eventId===t.eventId);
    if(!group){
      group = { eventId:t.eventId, eventName:t.eventName, tasks:[] };
      groups.push(group);
    }
    group.tasks.push(t);
  }
  return groups.map(group=>`
    <div class="leader-event-group">
      <div class="leader-event-group-head">
        <div class="leader-event-group-title">${group.eventName}</div>
        <div class="leader-event-group-count">${group.tasks.length} pending</div>
      </div>
      ${group.tasks.map(t=>renderLeaderTaskRow(t)).join('')}
    </div>`).join('');
}

function renderLeaderTaskRow(t){
  const over = t.status!=='done' && isOverdue(t.due_date);
  const ev = state.events.find(e=>e.id===t.eventId);
  return `
  <div class="leader-task-card s-${t.status} ${over?'overdue':''}">
    <div>
      <div class="task-card-title editable" onclick="openEditTask('${t.id}')">${t.title}</div>
      <div class="task-card-meta">
        <span>${stageLabel(getStage(t))}</span>
        <span class="priority-pill ${getPriority(t)}">${priorityLabel(t)}</span>
        <span>${t.assigned_to||'Unassigned'}</span>
        ${t.champion ? `<span>Champion: ${t.champion}</span>` : ''}
        ${t.due_date ? `<span class="${over?'task-date overdue':''}">Due: ${fmtDate(t.due_date)}</span>` : ''}
        <span class="status-pill ${t.status}">${t.status.replace('_',' ')}</span>
      </div>
    </div>
    <div class="task-actions">
      ${t.status==='not_started' ? `<button class="quick-action" onclick="updateTaskStatus('${t.id}','in_progress')">Start</button>` : ''}
      ${t.status!=='done' ? `<button class="quick-action" onclick="updateTaskStatus('${t.id}','done')">Done</button>` : ''}
      <button class="quick-action more-btn" onclick="toggleTaskMenu(event,'leader-${t.id}')" title="More actions">...</button>
      <div class="task-menu" id="task-menu-leader-${t.id}">
        ${t.status!=='blocked' && t.status!=='done' ? `<button onclick="updateTaskStatus('${t.id}','blocked')">Block</button>` : ''}
        ${t.status==='blocked' ? `<button onclick="updateTaskStatus('${t.id}','in_progress')">Unblock</button>` : ''}
        <button onclick="openEditTask('${t.id}')">Edit Details</button>
        <button onclick="switchTab('${eventTab(ev)}')">Open Event</button>
      </div>
    </div>
  </div>`;
}

// EVENT PAGE
function renderEventPage(ev){
  if(!ev) return '<div class="loading">Activation not found</div>';
  const weeks = state.weeks[ev.id]||[];
  const wid = state.currentWeek[ev.id];
  const week = weeks.find(w=>w.id===wid);
  const weekOptions = weeks.map(w=>`<option value="${w.id}" ${w.id===wid?'selected':''}>${w.week_label||w.week_date}${w.status==='completed'?' &check;':''}</option>`).join('');
  // undefined = this (older) week's tasks aren't loaded yet — kick the lazy load
  // and show a loading note instead of a false "no tasks" empty state.
  if(wid && state.tasks[wid]===undefined){ ensureWeekLoaded(wid); return '<div class="loading">Loading week…</div>'; }
  const tasks = wid ? (state.tasks[wid]||[]) : [];
  const fin = wid ? (state.finance[wid]||[]) : [];
  const targetRev = (Number(ev.avg_spend_target)||0) * (Number(ev.capacity)||0);
  const committed = fin.reduce((s,f)=>s+(Number(f.amount)||0),0);
  const readiness = readinessForTasks(tasks);
  const selectedStage = state.selectedStage[ev.id] || currentStageForTasks(tasks);
  state.selectedStage[ev.id] = selectedStage;
  const dleft = week ? daysUntil(week.week_date) : null;
  const doneCount = tasks.filter(t=>t.status==='done').length;
  const pct = tasks.length ? Math.round(doneCount/tasks.length*100) : 0;
  const cdLabel = dleft===null ? '' : (dleft>1 ? dleft+' days to go' : dleft===1 ? 'Tomorrow' : dleft===0 ? 'Tonight' : 'Activation passed');
  const countdown = week ? `
  <div class="event-countdown">
    <div class="countdown-days ${dleft===0?'tonight':''}">${cdLabel}</div>
    <div class="countdown-progress">
      <div class="countdown-progress-label"><span>${doneCount} of ${tasks.length} tasks done${tasks.length-doneCount>0 ? ` \u00b7 <strong>${tasks.length-doneCount} remaining</strong>` : ' \u00b7 all done'}</span><span>${pct}%</span></div>
      <div class="progress-bar"><div class="progress-fill ${readiness.status}" style="width:${pct}%"></div></div>
    </div>
    <span class="readiness-value ${readiness.status}" style="font-size:18px">${readiness.label}</span>
  </div>` : '';
  const reviewPanel = wid ? renderReviewPanel(ev, week, tasks, fin, wid) : '';

  const view = (state.journeyView && state.journeyView[ev.id]) || 'full';
  const activeOwner = 'All';

  const fullJourneyView = STAGE_KEYS.map(stage=>{
    const items = tasks.filter(t=>getStage(t)===stage && ownerMatches(t, activeOwner)).sort(taskSort);
    const doneN = items.filter(t=>t.status==='done').length;
    return `<div class="stage-panel">
      <div class="stage-heading">
        <div><div class="stage-title">Stage ${STAGES[stage].rank+1} \u00b7 ${STAGES[stage].label}</div></div>
        <span class="journey-step-meta">${items.length ? `${doneN}/${items.length} done` : 'No tasks'}</span>
      </div>
      ${items.length ? items.map(t=>renderTaskRow(t)).join('') : '<div class="empty-state">No tasks in this stage.</div>'}
      ${renderAddTaskBar('stage_'+stage, wid, ev.id, stage)}
    </div>`;
  }).join('');

  const pendingTasks = tasks.filter(t=>t.status!=='done' && ownerMatches(t, activeOwner))
    .sort((a,b)=> (stageRank(a)-stageRank(b)) || taskSort(a,b));
  const pendingGroups = STAGE_KEYS.map(stage=>{
    const items = pendingTasks.filter(t=>getStage(t)===stage);
    if(!items.length) return '';
    return `<div class="priority-heading">${STAGES[stage].label}</div>${items.map(t=>renderTaskRow(t)).join('')}`;
  }).join('');
  const pendingJourneyView = `<div class="stage-panel">
    <div class="stage-heading">
      <div>
        <div class="stage-title">Pending Journey</div>
        <div class="stage-sub">Every open item across all stages, in sequence. Clear this list and the night is ready.</div>
      </div>
      <span class="readiness-value ${readiness.status}" style="font-size:20px">${pendingTasks.length} open</span>
    </div>
    ${pendingTasks.length ? pendingGroups : '<div class="empty-state">Nothing pending. Perfect.</div>'}
  </div>`;

  return `
  <div class="event-header">
    <div class="event-header-top">
      <div class="event-title-block">
        <div class="event-eyebrow">Journey to event | ${ev.day_of_week}s</div>
        <h2>${ev.name}</h2>
        <p>${week?.week_label || week?.week_date || 'Select or create a week'} | Stage ${STAGES[selectedStage].rank+1} of 4: ${STAGES[selectedStage].label}</p>
        <button class="btn btn-gold btn-sm" style="margin-top:12px" onclick="goToReview('${ev.id}')">Go to Review &#8595;</button>
      </div>
      <div class="event-kpis">
        <div class="kpi"><div class="kpi-label">Tasks Remaining</div><div class="kpi-value" style="${tasks.length-doneCount>0?'color:var(--vino)':''}">${tasks.length ? tasks.length-doneCount : '\u2014'}</div></div>
        <div class="kpi"><div class="kpi-label">Readiness</div><div class="kpi-value">${readiness.label}</div></div>
        <div class="kpi"><div class="kpi-label">Target Covers</div><div class="kpi-value">${ev.capacity}</div></div>
        <div class="kpi"><div class="kpi-label">Target Revenue</div><div class="kpi-value">${fmt(targetRev)}</div></div>
        <div class="kpi"><div class="kpi-label">Artist Budget</div><div class="kpi-value">${fmt(ev.entertainment_cost)}</div></div>
      </div>
    </div>
  </div>

  <div class="overview-card">
    <div class="overview-head">
      <span class="overview-title">Activation Brief</span>
      <button class="overview-edit" onclick="openEditOverview('${ev.id}')">Edit</button>
    </div>
    <div class="overview-grid">
      <div>
        <div class="overview-label">Time</div>
        <div class="overview-value ${ev.time_start ? '' : 'muted'}">${ev.time_start ? `${ev.time_start} – ${ev.time_end||''}` : 'Set event time'}</div>
      </div>
      <div>
        <div class="overview-label">F&amp;B Offer</div>
        <div class="overview-value ${ev.fb_offer ? '' : 'muted'}">${ev.fb_offer || 'Set F&amp;B offer'}</div>
      </div>
      <div>
        <div class="overview-label">Artist · This Week</div>
        <div class="overview-value ${week?.artist ? '' : 'muted'}">${week?.artist || 'To confirm'}</div>
      </div>
    </div>
  </div>

  ${countdown}

  <div class="week-bar">
    <select class="week-select" onchange="selectWeek('${ev.id}', this.value)">
      <option value="">Select week</option>
      ${weekOptions}
    </select>
    <div class="task-actions" style="position:relative">
      <button class="btn btn-outline btn-sm more-btn" onclick="toggleTaskMenu(event,'weekbar-${ev.id}')" title="More actions">&#8943;</button>
      <div class="task-menu" id="task-menu-weekbar-${ev.id}" style="top:36px;min-width:240px">
        <button onclick="toggleEventPause('${ev.id}')">${(ev.status||'active')==='paused' ? 'Resume Activation' : 'Pause Activation'}</button>
        <button onclick="newWeek('${ev.id}')">New Week (manual)</button>
        <button onclick="openEditEvent('${ev.id}')">Targets &amp; Budget</button>
        ${wid ? `<button onclick="resetEventTasks('${ev.id}')">Reset Tasks</button>` : ''}
        ${wid ? `<button onclick="resetEventTasks('${ev.id}', true)">Reset Tasks + Responsibilities</button>` : ''}
        ${wid ? `<button class="danger" onclick="deleteWeek('${wid}','${ev.id}')">Delete Week</button>` : ''}
      </div>
    </div>
  </div>

  ${!wid ? '<div class="empty-state" style="padding:60px;text-align:center">No week selected. Create a week to start the journey.</div>' : `
    <div class="week-scope" style="margin-bottom:14px">
      <button class="week-scope-btn ${view==='full'?'active':''}" onclick="setJourneyView('${ev.id}','full')">Open Journey</button>
      <button class="week-scope-btn ${view==='pending'?'active':''}" onclick="setJourneyView('${ev.id}','pending')">Pending Journey</button>
      <button class="week-scope-btn" onclick="goToReview('${ev.id}')" style="margin-left:auto">Go to Review &#8595;</button>
    </div>
    ${view==='pending' ? pendingJourneyView : `${fullJourneyView}${reviewPanel}`}`}`;
}

function renderTaskRow(t){
  const over = t.status!=='done' && isOverdue(t.due_date);
  const priority = getPriority(t);
  const done = t.status==='done';
  const meta = [`<span class="priority-pill ${priority}">${priorityLabel(t)}</span>`];
  if(t.assigned_to) meta.push(`<span>${t.assigned_to}</span>`);
  if(t.champion) meta.push(`<span>Champion: ${t.champion}</span>`);
  if(t.due_date) meta.push(`<span class="${over?'task-date overdue':''}">Due: ${fmtDate(t.due_date)}</span>`);
  if(t.status==='in_progress' || t.status==='blocked') meta.push(`<span class="status-pill ${t.status}">${t.status.replace('_',' ')}</span>`);
  return `
  <div class="task-card s-${t.status} ${over?'overdue':''}" data-task-id="${t.id}">
    <button class="task-check ${done?'done':''}" onclick="toggleDone('${t.id}')" title="${done?'Mark as not done':'Mark as done'}">&check;</button>
    <div>
      <div class="task-card-title editable" onclick="openEditTask('${t.id}')">${t.title}</div>
      <div class="task-card-meta">${meta.join('')}</div>
      ${t.notes ? `<div class="task-notes-preview" style="margin-top:6px">${t.notes}</div>` : ''}
    </div>
    <div class="task-actions">
      <button class="quick-action more-btn" onclick="toggleTaskMenu(event,'${t.id}')" title="More actions">...</button>
      <div class="task-menu" id="task-menu-${t.id}">
        ${t.status==='not_started' ? `<button onclick="updateTaskStatus('${t.id}','in_progress')">Start</button>` : ''}
        ${t.status!=='blocked' && t.status!=='done' ? `<button onclick="updateTaskStatus('${t.id}','blocked')">Block</button>` : ''}
        ${t.status==='blocked' ? `<button onclick="updateTaskStatus('${t.id}','in_progress')">Unblock</button>` : ''}
        <button onclick="openEditTask('${t.id}')">Edit Details</button>
        <button class="danger" onclick="deleteTask('${t.id}')">Delete</button>
      </div>
    </div>
  </div>`;
}

function toggleDone(taskId){
  let task = null;
  for(const wid in state.tasks){ task = state.tasks[wid].find(x=>x.id===taskId); if(task) break; }
  if(!task) return;
  updateTaskStatus(taskId, task.status==='done' ? 'not_started' : 'done');
}

function toggleTaskMenu(e, taskId){
  e.stopPropagation();
  const menu = document.getElementById('task-menu-'+taskId);
  if(!menu) return;
  const wasOpen = menu.classList.contains('open');
  document.querySelectorAll('.task-menu.open').forEach(m=>m.classList.remove('open'));
  if(!wasOpen) menu.classList.add('open');
}
document.addEventListener('click', ()=>{
  document.querySelectorAll('.task-menu.open').forEach(m=>m.classList.remove('open'));
});

function renderAddTaskBar(track, weekId, eventId, forcedStage=null){
  const key = track;
  const label = forcedStage ? `Add to ${STAGES[forcedStage].label}` : 'Type a task and press Enter';
  return `
  <div class="add-task-bar">
    <input type="text" placeholder="${label}" id="new-task-${key}" onkeydown="if(event.key==='Enter') addTask('${key}','${weekId}','${eventId}')">
    <select id="new-assign-${key}">
      <option value="">Who?</option>
      ${TEAM.map(m=>`<option value="${m}">${m}</option>`).join('')}
    </select>
    <select id="new-priority-${key}">
      <option value="important" selected>Important</option>
      <option value="non_negotiable">Non-negotiable</option>
      <option value="enhancement">Enhancement</option>
    </select>
    <select id="new-status-${key}">
      <option value="not_started" selected>Not Started</option>
      <option value="in_progress">In Progress</option>
      <option value="done">Done</option>
      <option value="blocked">Blocked</option>
    </select>
    <button class="btn btn-gold btn-sm" onclick="addTask('${key}','${weekId}','${eventId}')">Add Task</button>
  </div>`;
}

function renderReviewPanel(ev, week, tasks, fin, weekId){
  const targetCovers = Number(ev.capacity)||0;
  const targetAvg = Number(ev.avg_spend_target)||0;
  const targetRev = targetCovers * targetAvg;
  const actualCovers = Number(week?.covers_actual)||0;
  const savedRevenue = Number(week?.revenue_actual)||0;
  const savedAvg = Number(week?.avg_spend_actual)||0;
  const fnbRev = Number(week?.fnb_revenue)||0;
  const compRev = Number(week?.complimentary)||0;
  const actualRevenue = savedRevenue || (actualCovers && savedAvg ? actualCovers * savedAvg : 0);
  const actualAvg = savedAvg || (actualCovers && actualRevenue ? actualRevenue / actualCovers : 0);
  const expenses = fin.reduce((s,f)=>s+(Number(f.amount)||0),0);
  const fbCost = actualRevenue * FB_COST_PCT;
  const grossProfit = actualRevenue - fbCost;
  const net = grossProfit - expenses;
  const grossClass = grossProfit >= 0 ? 'good' : 'bad';
  const revenueDelta = actualRevenue - targetRev;
  const taskDone = tasks.filter(t=>t.status==='done').length;
  const taskBlocked = tasks.filter(t=>t.status==='blocked').length;
  const taskPct = tasks.length ? Math.round(taskDone/tasks.length*100) : 0;
  const expenseShare = actualRevenue ? Math.round(expenses/actualRevenue*100) : 0;
  const netClass = net >= 0 ? 'good' : 'bad';
  const revenueClass = actualRevenue >= targetRev && targetRev ? 'good' : (actualRevenue ? 'warn' : '');
  const taskClass = taskBlocked ? 'bad' : (taskPct===100 ? 'good' : 'warn');
  const actualNote = actualRevenue
    ? `${actualCovers || '-'} covers at ${fmt(actualAvg)} average spend`
    : 'Enter results to calculate actual revenue';

  const pctOfTarget = actualRevenue && targetRev ? Math.round(actualRevenue/targetRev*100) : 0;
  let heroClass = 'empty', heroTag = 'Awaiting Results';
  if(actualRevenue){
    if(pctOfTarget >= 100){ heroClass='good'; heroTag='Target Achieved'; }
    else if(pctOfTarget >= 85){ heroClass='warn'; heroTag='Just Below Target'; }
    else { heroClass='bad'; heroTag='Below Target'; }
  }
  const trackPct = Math.min(pctOfTarget, 100);
  const gapTxt = !actualRevenue ? '' : (revenueDelta>=0
    ? `+AED ${Math.round(revenueDelta).toLocaleString()} over`
    : `−AED ${Math.abs(Math.round(revenueDelta)).toLocaleString()} short`);

  return `
    <div id="review-panel" class="budget-panel">
      <div class="section-header" style="margin-bottom:8px">
        <div>
          <div class="section-title">Review Summary</div>
          <div class="section-sub">How the night performed against target, and the bottom line.</div>
        </div>
      </div>
      <div class="review-actions">
        <button class="btn btn-gold btn-sm" onclick="openWeekActuals('${weekId}')">Enter Results</button>
        <button class="btn btn-outline btn-sm" onclick="openAddFinance('${weekId}','${ev.id}')">Add Expense</button>
        <button class="btn btn-outline btn-sm" onclick="openWeekReport('${ev.id}')">Report</button>
      </div>

      <div class="rv2-hero ${heroClass}">
        <div class="rv2-tag">${heroTag}${actualRevenue?` · ${pctOfTarget}% of target`:''}</div>
        <div class="rv2-bignum">
          <div class="n">${actualRevenue ? fmt(actualRevenue) : '—'}</div>
          <div class="of">${actualRevenue ? `of <b>${fmt(targetRev)}</b> target · ${gapTxt}` : 'No results entered yet'}</div>
        </div>
        <div class="rv2-track ${heroClass}"><i style="width:${trackPct}%"></i></div>
        <div class="rv2-track-marks"><span>0</span><span>Target ${fmt(targetRev)}</span></div>
      </div>

      <div class="rv2-stats">
        <div class="rv2-stat"><div class="l">Covers</div><div class="v">${actualCovers||'—'}<span style="font-size:11px;color:var(--text-light);font-weight:400"> / ${targetCovers} target</span></div></div>
        <div class="rv2-stat"><div class="l">Avg Spend</div><div class="v">${actualRevenue?fmt(actualAvg):'—'}<span style="font-size:11px;color:var(--text-light);font-weight:400"> / ${fmt(targetAvg)}</span></div></div>
        <div class="rv2-stat"><div class="l">F&amp;B Sales</div><div class="v">${fnbRev?fmt(fnbRev):'—'}</div></div>
        <div class="rv2-stat"><div class="l">Complimentary</div><div class="v">${compRev?fmt(compRev):'—'}</div></div>
      </div>

      <div class="rv2-pl">
        <div class="rv2-pl-row"><span>Revenue · Scala (Lounge)</span><span class="v">${fmt(actualRevenue)}</span></div>
        <div class="rv2-pl-row sub"><span>Less F&amp;B cost <span class="mut">(${Math.round(FB_COST_PCT*100)}% of revenue)</span></span><span class="v neg">− ${fmt(Math.round(fbCost))}</span></div>
        <div class="rv2-pl-row gross ${actualRevenue?grossClass:''}"><span>Gross Profit</span><span class="v">${actualRevenue ? fmt(Math.round(grossProfit)) : '—'}<span class="mut" style="font-weight:400"> ${actualRevenue?'· '+Math.round(grossProfit/actualRevenue*100)+'% margin':''}</span></span></div>
        <div class="rv2-pl-row sub"><span>Less expenses <span class="mut">(${fin.length} item${fin.length===1?'':'s'})</span></span><span class="v neg">− ${fmt(expenses)}</span></div>
        <div class="rv2-pl-row net ${actualRevenue?netClass:''}"><span>Net After Expenses</span><span class="v">${actualRevenue ? fmt(Math.round(net)) : '—'}</span></div>
      </div>

      ${week?.notes ? `<div style="margin-top:14px;padding:13px 15px;border:1px solid var(--border);background:var(--surface)"><div style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-light);margin-bottom:6px">Review Notes</div><div style="font-size:12px;color:var(--text-mid);line-height:1.5">${week.notes}</div></div>` : ''}
      <div class="section-header" style="margin:18px 0 8px"><div class="section-title">Expenses</div></div>
      ${renderFinanceTrack(fin, weekId, ev.id)}
    </div>`;
}

function renderFinanceTrack(items, weekId, eventId){
  const total = items.reduce((s,f)=>s+(f.amount||0),0);
  const rows = items.length===0
    ? '<div class="empty-state">No expenses yet.</div>'
    : items.map(f=>`
      <div class="finance-row" data-fin-id="${f.id}">
        <div>
          <div style="font-size:13px;color:var(--text)">${f.supplier_name}</div>
          ${f.description ? `<div style="font-size:11px;color:var(--text-light)">${f.description}</div>` : ''}
        </div>
        <div class="amount-cell">${fmt(f.amount)}</div>
        <div><span class="contract-pill ${f.contract_status}">${f.contract_status.replace('_',' ')}</span></div>
        <div><span class="status-pill ${f.payment_status}">${f.payment_status}</span></div>
        <div style="font-size:11px;color:var(--text-light)">${f.approved_by||'-'}</div>
        <div class="task-actions">
          <button class="icon-btn" onclick="openEditFinance('${f.id}')" title="Edit">Edit</button>
          <button class="icon-btn" onclick="deleteFinance('${f.id}')" style="color:rgba(192,57,43,0.5)" title="Delete">Delete</button>
        </div>
      </div>`).join('');

  return `
  <div class="finance-row-header">
    <span>Supplier / Artist</span><span>Amount</span><span>Contract</span><span>Payment</span><span>Approved By</span><span></span>
  </div>
  ${rows}
  <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--text-light)">Total Committed</div>
    <div style="font-family:'Playfair Display',serif;font-size:20px;color:var(--vino)">${fmt(total)}</div>
  </div>
  ${weekId ? `<div style="padding:0 20px 12px"><button class="btn btn-outline btn-sm" onclick="openAddFinance('${weekId}','${eventId}')">+ Add Expense</button></div>` : ''}`;
}

// -- TOGGLE TRACK --
async function openWeekReport(eventId){
  const ev = state.events.find(e=>e.id===eventId);
  if(!ev) return;
  const weeks = (state.weeks[eventId]||[]).slice().sort((a,b)=>(a.week_date||'').localeCompare(b.week_date||''));
  // Only the active window's tasks/finance are loaded at login (EVENTS_ACTIVE_DAYS).
  // Without this, every older week read as state.tasks[w.id]||[] — zero tasks and
  // AED 0 expenses, indistinguishable from a night that genuinely had none, in the
  // one screen built to compare nights over time.
  const loadedOk = await ensureWeeksLoaded(weeks);
  const targetRev = (Number(ev.capacity)||0) * (Number(ev.avg_spend_target)||0);
  const rows = weeks.map(w=>{
    // A week we couldn't load shows "—", never a 0 we can't stand behind.
    const loaded = state.tasks[w.id]!==undefined && state.finance[w.id]!==undefined;
    const tasks = state.tasks[w.id] || [];
    const fin = state.finance[w.id] || [];
    const covers = Number(w.covers_actual)||0;
    const savedRevenue = Number(w.revenue_actual)||0;
    const savedAvg = Number(w.avg_spend_actual)||0;
    const revenue = savedRevenue || (covers && savedAvg ? covers * savedAvg : 0);
    const avg = savedAvg || (covers && revenue ? revenue / covers : 0);
    const expenses = fin.reduce((s,f)=>s+(Number(f.amount)||0),0);
    const fbCost = revenue * FB_COST_PCT;
    const net = revenue - fbCost - expenses;
    const done = tasks.filter(t=>t.status==='done').length;
    const pct = tasks.length ? Math.round(done/tasks.length*100) : 0;
    return `
      <div class="report-row">
        <strong>${w.week_label || w.week_date}</strong>
        <span>${covers || '-'}</span>
        <span>${revenue ? fmt(revenue) : '-'}</span>
        <span>${avg ? fmt(avg) : '-'}</span>
        <span>${loaded ? fmt(expenses) : '—'}</span>
        <span>${(loaded && revenue) ? fmt(net) : '-'}</span>
        <span>${loaded ? `${done}/${tasks.length} (${pct}%)` : '—'}</span>
      </div>`;
  }).join('') || '<div class="empty-state">No weeks to compare yet.</div>';

  document.getElementById('modal-title').textContent = ev.name + ' Report';
  document.getElementById('modal-body').innerHTML = `
    <div class="review-grid" style="margin-top:0">
      <div class="review-card"><div class="review-label">Target Revenue</div><div class="review-value">${fmt(targetRev)}</div></div>
      <div class="review-card"><div class="review-label">Weeks</div><div class="review-value">${weeks.length}</div></div>
    </div>
    <div class="report-row header">
      <span>Week</span><span>Covers</span><span>Revenue</span><span>Avg Spend</span><span>Expenses</span><span>Net</span><span>Tasks</span>
    </div>
    ${rows}
    ${!loadedOk ? '<div class="report-note" style="color:#B00020"><b>Some weeks could not be loaded.</b> Their “—” cells are unknown, not zero. Close and reopen the report to try again.</div>' : ''}
    <div class="report-note">Use Enter Results in each Review section to add covers and revenue. Expenses are pulled from the expense list for each week.</div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-gold" onclick="closeModal()">Done</button>`;
  document.getElementById('modal').classList.add('wide');
  document.getElementById('modal-overlay').classList.add('open');
}

function toggleTrack(header){
  const body = header.nextElementSibling;
  const arrow = header.querySelector('span:last-child');
  body.classList.toggle('collapsed');
  arrow.textContent = body.classList.contains('collapsed') ? '>' : 'v';
}

// -- WEEK ACTIONS --
function selectWeek(eventId, weekId){
  state.currentWeek[eventId] = weekId;
  ensureWeekLoaded(weekId);   // older weeks aren't loaded at login — fetch on open
  renderMain();
}

function newWeek(eventId){
  const wid = state.currentWeek[eventId];
  if(wid) duplicateWeek(eventId, wid); else createNewWeek(eventId);
}

async function toggleEventPause(eventId){
  const ev = state.events.find(e=>e.id===eventId);
  if(!ev) return;
  const next = (ev.status||'active')==='paused' ? 'active' : 'paused';
  const { error } = await sb.from('events').update({ status: next }).eq('id', eventId);
  if(error){ toast('Could not update - add the status column in Supabase first', true); return; }
  ev.status = next;
  logActivity(next==='paused' ? 'paused event' : 'resumed event', ev.name);
  toast(ev.name + (next==='paused' ? ' paused' : ' resumed'));
  if(next==='active'){ loadAll(); } else { renderMain(); }
}

// Cancel ONE week only (e.g. this Saturday) without pausing the whole series.
async function cancelWeek(weekId, eventId){
  const ev = state.events.find(e=>e.id===eventId);
  const wk = (state.weeks[eventId]||[]).find(w=>w.id===weekId);
  if(!wk) return;
  if(!confirm('Cancel ' + (ev ? ev.name + ' — ' : '') + (wk.week_label||wk.week_date) + ' for this week only?\n\nThe event keeps running every other week.')) return;
  const { error } = await sb.from('weeks').update({ status:'cancelled' }).eq('id', weekId);
  if(error){ toast('Could not cancel the week', true); return; }
  wk.status = 'cancelled';
  logActivity('cancelled week', (wk.week_label||wk.week_date) + ' — ' + (ev?ev.name:''));
  toast((ev?ev.name+' ':'') + 'cancelled for ' + (wk.week_label||wk.week_date));
  renderMain();
}
async function restoreWeek(weekId, eventId){
  const ev = state.events.find(e=>e.id===eventId);
  const wk = (state.weeks[eventId]||[]).find(w=>w.id===weekId);
  if(!wk) return;
  const { error } = await sb.from('weeks').update({ status:'upcoming' }).eq('id', weekId);
  if(error){ toast('Could not restore the week', true); return; }
  wk.status = 'upcoming';
  logActivity('restored week', (wk.week_label||wk.week_date) + ' — ' + (ev?ev.name:''));
  toast((ev?ev.name+' ':'') + 'restored');
  renderMain();
}

async function createNewWeek(eventId){
  const ev = state.events.find(e=>e.id===eventId);
  const next = nextOccurrence(ev.day_of_week);
  const dateStr = localISO(next);
  const label = next.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});

  const { data, error } = await sb.from('weeks').insert({
    event_id: eventId,
    week_date: dateStr,
    week_label: label,
    status: 'upcoming'
  }).select().single();

  if(error){ toast('Error creating week',true); return; }

  // seed default tasks
  await seedDefaultTasks(data.id, eventId, ev.name, data.week_date);

  if(!state.weeks[eventId]) state.weeks[eventId]=[];
  state.weeks[eventId].unshift(data);
  state.currentWeek[eventId] = data.id;
  const { data: tasks } = await sb.from('tasks').select('*').eq('week_id',data.id).order('sort_order');
  state.tasks[data.id] = tasks||[];
  state.finance[data.id] = [];
  logActivity('created week', label + ' \u2014 ' + ev.name);
  toast('New week created - '+label);
  renderMain();
}

async function deleteWeek(weekId, eventId){
  const week = (state.weeks[eventId]||[]).find(w=>w.id===weekId);
  if(!week) return;
  const tCount = (state.tasks[weekId]||[]).length;
  const fCount = (state.finance[weekId]||[]).length;
  const label = week.week_label || week.week_date;
  if(!confirm(`Delete week "${label}"?\n\nThis permanently deletes ${tCount} task(s) and ${fCount} finance item(s) for this week. This cannot be undone.`)) return;
  const t = await sb.from('tasks').delete().eq('week_id', weekId);
  if(t.error){ toast('Error deleting week tasks', true); return; }
  const f = await sb.from('finance').delete().eq('week_id', weekId);
  if(f.error){ toast('Error deleting week finance', true); return; }
  const w = await sb.from('weeks').delete().eq('id', weekId);
  if(w.error){ toast('Error deleting week', true); return; }
  state.weeks[eventId] = (state.weeks[eventId]||[]).filter(x=>x.id!==weekId);
  delete state.tasks[weekId];
  delete state.finance[weekId];
  state.currentWeek[eventId] = pickDefaultWeekId(state.weeks[eventId]);
  logActivity('deleted week', label, tCount + ' tasks, ' + fCount + ' finance items');
  toast('Week deleted');
  renderMain();
}

async function duplicateWeek(eventId, sourceWeekId){
  const ev = state.events.find(e=>e.id===eventId);
  const sourceWeek = state.weeks[eventId]?.find(w=>w.id===sourceWeekId);
  if(!sourceWeek) return;

  // calculate next week date
  const dateStr = isoDateFromOffset(sourceWeek.week_date, 7);
  const label = parseLocalDate(dateStr).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});

  const { data: newWeek, error } = await sb.from('weeks').insert({
    event_id: eventId,
    week_date: dateStr,
    week_label: label,
    status: 'upcoming'
  }).select().single();
  if(error){ toast('Error duplicating week',true); return; }

  // copy tasks
  const sourceTasks = state.tasks[sourceWeekId]||[];
  if(sourceTasks.length){
    const newTasks = sourceTasks.map(t=>({
      week_id: newWeek.id,
      event_id: eventId,
      track: t.track,
      title: t.title,
      description: taskDescription(getPriority(t), getStage(t)),
      assigned_to: t.assigned_to,
      champion: t.champion,
      status: 'not_started',
      due_date: t.due_date ? isoDateFromOffset(t.due_date, 7) : isoDateFromOffset(newWeek.week_date, DUE_BY_TRACK[t.track] ?? -1),
      notes: null,
      sort_order: t.sort_order
    }));
    await sb.from('tasks').insert(newTasks);
  }

  // copy expenses (reset status)
  const sourceFin = state.finance[sourceWeekId]||[];
  if(sourceFin.length){
    const newFin = sourceFin.map(f=>({
      week_id: newWeek.id,
      event_id: eventId,
      supplier_name: f.supplier_name,
      description: f.description,
      amount: f.amount,
      currency: f.currency,
      contract_status: f.contract_status,
      payment_status: 'pending',
      payment_method: f.payment_method,
      approved_by: null
    }));
    await sb.from('finance').insert(newFin);
  }

  if(!state.weeks[eventId]) state.weeks[eventId]=[];
  state.weeks[eventId].unshift(newWeek);
  state.currentWeek[eventId] = newWeek.id;
  const { data: tasks } = await sb.from('tasks').select('*').eq('week_id',newWeek.id).order('sort_order');
  state.tasks[newWeek.id] = tasks||[];
  const { data: fin } = await sb.from('finance').select('*').eq('week_id',newWeek.id);
  state.finance[newWeek.id] = fin||[];
  toast('Next week created - '+label);
  renderMain();
}

// -- SEED DEFAULT TASKS --
async function seedDefaultTasks(weekId, eventId, eventName, eventDate){
  const isJazz = eventName.includes('Jazz');
  const firstDate = isJazz ? '16 June 2026' : '15 June 2026';
  const recurrence = isJazz ? 'Weekly on Tuesdays' : 'Weekly on Mondays';
  const defaults = [
    // Marketing
    { track:'marketing', title:'Launch date and time', priority:'non_negotiable', stage:'promote', assigned_to:'Manuel', champion:'Alessandro', notes:`First launch: ${firstDate}. Confirm exact public time.`, sort_order:1 },
    { track:'marketing', title:'Recurrence', priority:'non_negotiable', stage:'promote', assigned_to:'Manuel', champion:'Alessandro', notes:recurrence, sort_order:2 },
    { track:'marketing', title:'Artist stage name', stage:'promote', assigned_to:'Manuel', champion:'Alessandro', sort_order:3 },
    { track:'marketing', title:'High resolution artist imagery sent via WeTransfer link', stage:'promote', assigned_to:'Manuel', champion:'Alessandro', sort_order:4 },
    { track:'marketing', title:'Artist audio or reference music links for marketing', stage:'promote', assigned_to:'Manuel', champion:'Alessandro', sort_order:5 },
    // Champion
    { track:'champion', title: isJazz ? 'Confirm artist rotation (Ryan Gibbs / Salt N Pepper / Jazz Trio)' : 'Confirm vinyl selector for the week', priority:'non_negotiable', stage:'prepare', assigned_to:'Manuel', champion:'Alessandro', sort_order:1 },
    { track:'champion', title:'Artist briefed on format and timing', priority:'non_negotiable', stage:'prepare', assigned_to:'Manuel', champion:'Alessandro', sort_order:2 },
    { track:'champion', title:'Technical rider received and reviewed', priority:'non_negotiable', stage:'prepare', assigned_to:'Manuel', champion:'Alessandro', sort_order:3 },
    // Technical
    { track:'technical', title:'Sound check scheduled', priority:'non_negotiable', stage:'prepare', assigned_to:'Danilo', champion:'Manuel', sort_order:1 },
    { track:'technical', title:'Equipment confirmed and tested', priority:'non_negotiable', stage:'prepare', assigned_to:'Danilo', champion:'Manuel', sort_order:2 },
    { track:'technical', title:'Stage setup briefed', stage:'prepare', assigned_to:'Danilo', champion:'Manuel', sort_order:3 },
    { track:'technical', title:'Lighting briefed for atmosphere', stage:'prepare', assigned_to:'Danilo', champion:'Manuel', sort_order:4 },
    // Guest & Revenue
    { track:'guest_revenue', title:'Covers target confirmed (50 guests)', priority:'non_negotiable', stage:'plan', assigned_to:'Alessandro', champion:'Francesco', sort_order:1 },
    { track:'guest_revenue', title:'Invitations sent', stage:'prepare', assigned_to:'Alessandro', champion:'Francesco', sort_order:2 },
    { track:'guest_revenue', title:'Ladies/atmosphere confirmed', priority:'enhancement', stage:'prepare', assigned_to:'Alessandro', champion:'Manuel', sort_order:3 },
    { track:'guest_revenue', title:'Reservations tracking updated', stage:'prepare', assigned_to:'Alessandro', champion:'Francesco', sort_order:4 },
    // Service
    { track:'service', title:'Sequence of service briefed to team', priority:'non_negotiable', stage:'execute', assigned_to:'Manuel', champion:'Francesco', sort_order:1 },
    { track:'service', title:'Service leader assigned for the night', priority:'non_negotiable', stage:'execute', assigned_to:'Manuel', champion:'Francesco', sort_order:2 },
    { track:'service', title:'Casuals confirmed if required', priority:'enhancement', stage:'prepare', assigned_to:'Manuel', champion:'Francesco', sort_order:3 },
    { track:'service', title:'Sommelier briefed on pairing narrative', stage:'execute', assigned_to:'Manuel', champion:'Francesco', sort_order:4 },
    // Documents
    { track:'documents', title:'Contract uploaded', priority:'non_negotiable', stage:'prepare', assigned_to:'Manuel', champion:'Alessandro', sort_order:1 },
    { track:'documents', title:'Permit/visa check completed', priority:'non_negotiable', stage:'prepare', assigned_to:'Manuel', champion:'Alessandro', sort_order:2 },
  ];

  const rows = defaults.map(d=>({
    ...d,
    week_id: weekId,
    event_id: eventId,
    status:'not_started',
    due_date: isoDateFromOffset(eventDate, DUE_BY_TRACK[d.track] ?? -1),
    description: taskDescription(d.priority || inferPriority(d), d.stage || inferStage(d))
  }));
  await sb.from('tasks').insert(rows);
}

// -- TASK ACTIONS --
async function addTask(track, weekId, eventId){
  const titleEl = document.getElementById('new-task-'+track);
  const assignEl = document.getElementById('new-assign-'+track);
  const statusEl = document.getElementById('new-status-'+track);
  const champEl = document.getElementById('new-champion-'+track);
  const dateEl = document.getElementById('new-date-'+track);
  const priorityEl = document.getElementById('new-priority-'+track);
  const stageEl = document.getElementById('new-stage-'+track);
  const title = titleEl?.value?.trim();
  if(!title){ toast('Please enter a task name',true); return; }
  const stage = stageEl?.value || (track.startsWith('stage_') ? track.replace('stage_','') : inferStage({track, title}));
  const dbTrack = track.startsWith('stage_') ? 'champion' : track;

  const wk = Object.values(state.weeks).flat().find(w=>w.id===weekId);
  const due = dateEl?.value || (wk ? isoDateFromOffset(wk.week_date, DUE_BY_TRACK[dbTrack] ?? -1) : null);
  const { data, error } = await sb.from('tasks').insert({
    week_id: weekId, event_id: eventId, track: dbTrack,
    title, assigned_to: assignEl?.value||null,
    champion: champEl?.value||null,
    description: taskDescription(priorityEl?.value||'important', stage),
    due_date: due,
    status: statusEl?.value || 'not_started',
    sort_order: (state.tasks[weekId]||[]).filter(t=>t.track===dbTrack).length+1
  }).select().single();

  if(error){ toast('Error adding task',true); return; }
  if(!state.tasks[weekId]) state.tasks[weekId]=[];
  state.tasks[weekId].push(data);
  logActivity('added task', data.title);
  toast('Task added');
  renderMain();
  const again = document.getElementById('new-task-'+track);
  if(again) again.focus();
}

function openLeaderAddTask(){
  const activeLeader = state.ownerFilter || 'All';
  const eventOptions = state.events.map(ev=>`<option value="${ev.id}">${ev.name}</option>`).join('');
  document.getElementById('modal-title').textContent = 'Add Task';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label class="form-label">Task</label>
      <input class="form-input" id="leader-task-title" placeholder="What needs to be done?">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Activation</label>
        <select class="form-select" id="leader-task-event">${eventOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Section</label>
        <select class="form-select" id="leader-task-stage">${STAGE_KEYS.map(stage=>`<option value="${stage}">${STAGES[stage].label}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Assigned To</label>
        <select class="form-select" id="leader-task-assignee">
          <option value="">-</option>
          ${TEAM.map(m=>`<option value="${m}" ${activeLeader===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Priority</label>
        <select class="form-select" id="leader-task-priority">
          <option value="important" selected>Important</option>
          <option value="non_negotiable">Non-negotiable</option>
          <option value="enhancement">Enhancement</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Status</label>
      <select class="form-select" id="leader-task-status">
        <option value="not_started" selected>Not Started</option>
        <option value="in_progress">In Progress</option>
        <option value="blocked">Blocked</option>
        <option value="done">Done</option>
      </select>
    </div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-gold" onclick="addLeaderTask()">Add Task</button>`;
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(()=>document.getElementById('leader-task-title')?.focus(), 0);
}

async function addLeaderTask(){
  const titleEl = document.getElementById('leader-task-title');
  const eventEl = document.getElementById('leader-task-event');
  const stageEl = document.getElementById('leader-task-stage');
  const assignEl = document.getElementById('leader-task-assignee');
  const priorityEl = document.getElementById('leader-task-priority');
  const statusEl = document.getElementById('leader-task-status');
  const title = titleEl?.value?.trim();
  const eventId = eventEl?.value;
  if(!title){ toast('Please enter a task name',true); return; }
  const ev = state.events.find(e=>e.id===eventId);
  if(!ev){ toast('Please choose an event',true); return; }
  const weekId = state.currentWeek[eventId];
  const wk = (state.weeks[eventId]||[]).find(w=>w.id===weekId);
  if(!weekId || !wk){ toast('Create a week for this activation first',true); return; }
  const stage = stageEl?.value || 'prepare';
  const track = 'champion';
  const due = wk ? isoDateFromOffset(wk.week_date, DUE_BY_TRACK[track] ?? -1) : null;
  const { data, error } = await sb.from('tasks').insert({
    week_id: weekId,
    event_id: eventId,
    track,
    title,
    assigned_to: assignEl?.value||null,
    champion: assignEl?.value||null,
    description: taskDescription(priorityEl?.value||'important', stage),
    due_date: due,
    status: statusEl?.value || 'not_started',
    sort_order: (state.tasks[weekId]||[]).filter(t=>t.track===track).length+1
  }).select().single();
  if(error){ toast('Error adding task',true); return; }
  if(!state.tasks[weekId]) state.tasks[weekId]=[];
  state.tasks[weekId].push(data);
  closeModal();
  toast('Task added');
  renderMain();
}

async function updateTaskStatus(taskId, status){
  const { error } = await sb.from('tasks').update({ status, updated_at: new Date().toISOString() }).eq('id',taskId);
  if(error){ toast('Error updating status',true); return; }
  for(const wid in state.tasks){
    const t = state.tasks[wid].find(t=>t.id===taskId);
    if(t){ t.status=status; logActivity('marked task ' + status.replace('_',' '), t.title); break; }
  }
  renderMain();
}

function openLeaderActions(owner){
  document.getElementById('modal-title').textContent = 'Leader Actions';
  document.getElementById('modal-body').innerHTML = `
    <div class="review-card" style="margin-bottom:14px">
      <div class="review-label">Current View</div>
      <div class="review-value" style="font-size:22px">${owner==='All' ? 'All Leaders' : owner}</div>
      <div class="review-note">Reset returns matching tasks to Not Started. You will be asked to confirm before anything changes.</div>
    </div>
    <div class="form-group">
      <button class="btn btn-outline" style="width:100%" onclick="closeModal(); resetLeaderTasks('${owner}')">${owner==='All' ? 'Reset All Leaders' : 'Reset '+owner}</button>
    </div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-gold" onclick="closeModal()">Done</button>`;
  document.getElementById('modal-overlay').classList.add('open');
}

async function resetTasksByIds(taskIds, label, clearResponsibilities=false){
  if(!taskIds.length){ toast('No tasks to reset'); return; }
  const message = clearResponsibilities
    ? `Reset ${taskIds.length} task${taskIds.length===1?'':'s'} for ${label} to Not Started and remove assigned people/champions?`
    : `Reset ${taskIds.length} task${taskIds.length===1?'':'s'} for ${label} to Not Started?`;
  if(!confirm(message)) return;
  const updates = { status:'not_started', updated_at: new Date().toISOString() };
  if(clearResponsibilities){
    updates.assigned_to = null;
    updates.champion = null;
  }
  const { error } = await sb.from('tasks').update(updates).in('id', taskIds);
  if(error){ toast('Error resetting tasks',true); return; }
  for(const wid in state.tasks){
    state.tasks[wid] = state.tasks[wid].map(t=> taskIds.includes(t.id) ? {...t, ...updates} : t);
  }
  toast(clearResponsibilities ? 'Tasks and responsibilities reset' : 'Tasks reset');
  renderMain();
}

function resetLeaderTasks(owner){
  const ids = [];
  for(const wid in state.tasks){
    (state.tasks[wid]||[]).forEach(t=>{
      if(ownerMatches(t, owner)) ids.push(t.id);
    });
  }
  resetTasksByIds(ids, owner==='All' ? 'all leaders' : owner);
}

function resetEventTasks(eventId, clearResponsibilities=false){
  const ev = state.events.find(e=>e.id===eventId);
  const ids = [];
  for(const wid in state.tasks){
    (state.tasks[wid]||[]).forEach(t=>{
      if(t.event_id===eventId) ids.push(t.id);
    });
  }
  resetTasksByIds(ids, ev?.name || 'this activation', clearResponsibilities);
}

async function deleteTask(taskId){
  if(!confirm('Delete this task?')) return;
  let _delTitle = null;
  for(const wid in state.tasks){ const t = state.tasks[wid].find(x=>x.id===taskId); if(t){ _delTitle = t.title; break; } }
  const { error } = await sb.from('tasks').delete().eq('id',taskId);
  if(error){ toast('Error deleting task',true); return; }
  for(const wid in state.tasks){
    state.tasks[wid] = state.tasks[wid].filter(t=>t.id!==taskId);
  }
  logActivity('deleted task', _delTitle);
  toast('Task deleted');
  renderMain();
}

function openEditTask(taskId){
  let task = null;
  for(const wid in state.tasks){
    task = state.tasks[wid].find(t=>t.id===taskId);
    if(task) break;
  }
  if(!task) return;

  document.getElementById('modal-title').textContent = 'Edit Task';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label class="form-label">Task Name</label>
      <input class="form-input" id="edit-title" value="${task.title||''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Assigned To</label>
        <select class="form-select" id="edit-assign">
          <option value="">-</option>
          ${TEAM.map(m=>`<option value="${m}" ${task.assigned_to===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Champion</label>
        <select class="form-select" id="edit-champion">
          <option value="">-</option>
          ${CHAMPIONS.map(m=>`<option value="${m}" ${task.champion===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Due Date</label>
        <input class="form-input" id="edit-date" type="date" value="${task.due_date||''}">
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="edit-status">
          <option value="not_started" ${task.status==='not_started'?'selected':''}>Not Started</option>
          <option value="in_progress" ${task.status==='in_progress'?'selected':''}>In Progress</option>
          <option value="done" ${task.status==='done'?'selected':''}>Done</option>
          <option value="blocked" ${task.status==='blocked'?'selected':''}>Blocked</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Priority</label>
      <select class="form-select" id="edit-priority">
        <option value="non_negotiable" ${getPriority(task)==='non_negotiable'?'selected':''}>Non-Negotiable</option>
        <option value="important" ${getPriority(task)==='important'?'selected':''}>Important</option>
        <option value="enhancement" ${getPriority(task)==='enhancement'?'selected':''}>Enhancement</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Journey Stage</label>
      <select class="form-select" id="edit-stage">
        ${STAGE_KEYS.map(stage=>`<option value="${stage}" ${getStage(task)===stage?'selected':''}>${STAGES[stage].label}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="edit-notes">${task.notes||''}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Document / Link URL</label>
      <input class="form-input" id="edit-doc" value="${task.doc_url||''}" placeholder="https://...">
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-gold" onclick="saveEditTask('${taskId}')">Save Changes</button>`;

  document.getElementById('modal-overlay').classList.add('open');
}

async function saveEditTask(taskId){
  const updates = {
    title: document.getElementById('edit-title').value.trim(),
    assigned_to: document.getElementById('edit-assign').value||null,
    champion: document.getElementById('edit-champion').value||null,
    due_date: document.getElementById('edit-date').value||null,
    status: document.getElementById('edit-status').value,
    notes: document.getElementById('edit-notes').value||null,
    description: taskDescription(document.getElementById('edit-priority').value, document.getElementById('edit-stage').value),
    doc_url: document.getElementById('edit-doc').value||null,
    updated_at: new Date().toISOString()
  };
  // If the due date changed, clear the notification stamp so the task
  // earns exactly one fresh email when the new date arrives
  let _prevDue = null;
  for(const wid in state.tasks){ const t = state.tasks[wid].find(x=>x.id===taskId); if(t){ _prevDue = t.due_date; break; } }
  if((_prevDue||null) !== (updates.due_date||null)){ updates.due_notified_at = null; }
  const { error } = await sb.from('tasks').update(updates).eq('id',taskId);
  if(error){ toast('Error saving task',true); return; }
  for(const wid in state.tasks){
    const idx = state.tasks[wid].findIndex(t=>t.id===taskId);
    if(idx>-1){ state.tasks[wid][idx]={...state.tasks[wid][idx],...updates}; break; }
  }
  logActivity('edited task', updates.title);
  closeModal(); toast('Task saved'); renderMain();
}

// -- FINANCE ACTIONS --
function openAddFinance(weekId, eventId){
  document.getElementById('modal-title').textContent = 'Add Expense';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label class="form-label">Supplier / Artist Name</label>
      <input class="form-input" id="fin-supplier" placeholder="e.g. Ryan Gibbs">
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input class="form-input" id="fin-desc" placeholder="Solo Piano Performance">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Amount (AED)</label>
        <input class="form-input" id="fin-amount" type="number" placeholder="5000">
      </div>
      <div class="form-group">
        <label class="form-label">Payment Method</label>
        <input class="form-input" id="fin-method" placeholder="Bank Transfer / Cash">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Contract Status</label>
        <select class="form-select" id="fin-contract">
          <option value="not_sent">Not Sent</option>
          <option value="sent">Sent</option>
          <option value="signed">Signed</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Payment Status</label>
        <select class="form-select" id="fin-payment">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="paid">Paid</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Approved By</label>
        <select class="form-select" id="fin-approved">
          <option value="">-</option>
          ${CHAMPIONS.map(m=>`<option value="${m}">${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Invoice / Contract URL</label>
        <input class="form-input" id="fin-invoice" placeholder="https://...">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="fin-notes"></textarea>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-gold" onclick="saveAddFinance('${weekId}','${eventId}')">Add Expense</button>`;

  document.getElementById('modal-overlay').classList.add('open');
}

async function saveAddFinance(weekId, eventId){
  const item = {
    week_id: weekId, event_id: eventId,
    supplier_name: document.getElementById('fin-supplier').value.trim(),
    description: document.getElementById('fin-desc').value||null,
    amount: parseFloat(document.getElementById('fin-amount').value)||0,
    payment_method: document.getElementById('fin-method').value||null,
    contract_status: document.getElementById('fin-contract').value,
    payment_status: document.getElementById('fin-payment').value,
    approved_by: document.getElementById('fin-approved').value||null,
    invoice_url: document.getElementById('fin-invoice').value||null,
    notes: document.getElementById('fin-notes').value||null,
  };
  if(!item.supplier_name){ toast('Please enter a supplier name',true); return; }
  const { data, error } = await sb.from('finance').insert(item).select().single();
  if(error){ toast('Error adding expense',true); return; }
  if(!state.finance[weekId]) state.finance[weekId]=[];
  state.finance[weekId].push(data);
  logActivity('added expense', data.supplier_name, data.amount ? 'AED ' + data.amount : null);
  closeModal(); toast('Expense added'); renderMain();
}

function openEditFinance(finId){
  let fin = null;
  for(const wid in state.finance){
    fin = state.finance[wid].find(f=>f.id===finId);
    if(fin) break;
  }
  if(!fin) return;

  document.getElementById('modal-title').textContent = 'Edit Expense';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label class="form-label">Supplier / Artist Name</label>
      <input class="form-input" id="fin-supplier" value="${fin.supplier_name||''}">
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input class="form-input" id="fin-desc" value="${fin.description||''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Amount (AED)</label>
        <input class="form-input" id="fin-amount" type="number" value="${fin.amount||0}">
      </div>
      <div class="form-group">
        <label class="form-label">Payment Method</label>
        <input class="form-input" id="fin-method" value="${fin.payment_method||''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Contract Status</label>
        <select class="form-select" id="fin-contract">
          <option value="not_sent" ${fin.contract_status==='not_sent'?'selected':''}>Not Sent</option>
          <option value="sent" ${fin.contract_status==='sent'?'selected':''}>Sent</option>
          <option value="signed" ${fin.contract_status==='signed'?'selected':''}>Signed</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Payment Status</label>
        <select class="form-select" id="fin-payment">
          <option value="pending" ${fin.payment_status==='pending'?'selected':''}>Pending</option>
          <option value="approved" ${fin.payment_status==='approved'?'selected':''}>Approved</option>
          <option value="paid" ${fin.payment_status==='paid'?'selected':''}>Paid</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Approved By</label>
        <select class="form-select" id="fin-approved">
          <option value="">-</option>
          ${CHAMPIONS.map(m=>`<option value="${m}" ${fin.approved_by===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Invoice / Contract URL</label>
        <input class="form-input" id="fin-invoice" value="${fin.invoice_url||''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="fin-notes">${fin.notes||''}</textarea>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-gold" onclick="saveEditFinance('${finId}')">Save Changes</button>`;

  document.getElementById('modal-overlay').classList.add('open');
}

async function saveEditFinance(finId){
  const updates = {
    supplier_name: document.getElementById('fin-supplier').value.trim(),
    description: document.getElementById('fin-desc').value||null,
    amount: parseFloat(document.getElementById('fin-amount').value)||0,
    payment_method: document.getElementById('fin-method').value||null,
    contract_status: document.getElementById('fin-contract').value,
    payment_status: document.getElementById('fin-payment').value,
    approved_by: document.getElementById('fin-approved').value||null,
    invoice_url: document.getElementById('fin-invoice').value||null,
    notes: document.getElementById('fin-notes').value||null,
    updated_at: new Date().toISOString()
  };
  const { error } = await sb.from('finance').update(updates).eq('id',finId);
  if(error){ toast('Error saving',true); return; }
  for(const wid in state.finance){
    const idx = state.finance[wid].findIndex(f=>f.id===finId);
    if(idx>-1){ state.finance[wid][idx]={...state.finance[wid][idx],...updates}; break; }
  }
  logActivity('edited expense', updates.supplier_name, updates.amount ? 'AED ' + updates.amount : null);
  closeModal(); toast('Expense saved'); renderMain();
}

async function deleteFinance(finId){
  if(!confirm('Delete this expense?')) return;
  let _delFin = null;
  for(const wid in state.finance){ const f = state.finance[wid].find(x=>x.id===finId); if(f){ _delFin = f.supplier_name; break; } }
  const { error } = await sb.from('finance').delete().eq('id',finId);
  if(error){ toast('Error deleting',true); return; }
  for(const wid in state.finance){
    state.finance[wid] = state.finance[wid].filter(f=>f.id!==finId);
  }
  logActivity('deleted expense', _delFin);
  toast('Deleted'); renderMain();
}

// -- WEEK ACTUALS MODAL --

// EVENT TARGETS MODAL
function timeOptions(selected){
  const opts = ['<option value="">Select time</option>'];
  // 12:00 PM through 3:00 AM in 30-minute steps
  for(let m=12*60; m<=27*60; m+=30){
    const h24 = Math.floor(m/60)%24;
    const min = m%60;
    const ampm = h24>=12 ? 'PM' : 'AM';
    let h12 = h24%12; if(h12===0) h12=12;
    const label = `${h12}:${min===0?'00':'30'} ${ampm}`;
    opts.push(`<option value="${label}" ${label===selected?'selected':''}>${label}</option>`);
  }
  return opts.join('');
}

function openEditOverview(eventId){
  const ev = state.events.find(e=>e.id===eventId);
  if(!ev) return;
  const wid = state.currentWeek[ev.id];
  const week = (state.weeks[ev.id]||[]).find(w=>w.id===wid);
  document.getElementById('modal-title').textContent = 'Edit Activation Brief';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Start Time</label>
        <select class="form-select" id="ov-start">${timeOptions(ev.time_start||'')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">End Time</label>
        <select class="form-select" id="ov-end">${timeOptions(ev.time_end||'')}</select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">F&B Offer</label>
      <textarea class="form-textarea" id="ov-fb" placeholder="e.g. Aperitivo offer extended until 11 PM">${ev.fb_offer||''}</textarea>
    </div>
    ${week ? `
    <div class="form-group">
      <label class="form-label">Artist · ${week.week_label||week.week_date}</label>
      <input class="form-input" id="ov-artist" value="${week.artist||''}" placeholder="Artist name for this week">
    </div>` : `<div class="form-group"><label class="form-label">Artist</label><div style="font-size:12px;color:var(--text-light)">Select or create a week to set this week's artist.</div></div>`}`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-gold" onclick="saveEditOverview('${eventId}')">Save Brief</button>`;
  document.getElementById('modal-overlay').classList.add('open');
}

async function saveEditOverview(eventId){
  const updates = {
    time_start: document.getElementById('ov-start').value.trim()||null,
    time_end: document.getElementById('ov-end').value.trim()||null,
    fb_offer: document.getElementById('ov-fb').value.trim()||null
  };
  const { error } = await sb.from('events').update(updates).eq('id',eventId);
  if(error){ toast('Error saving brief',true); return; }
  const idx = state.events.findIndex(e=>e.id===eventId);
  if(idx>-1) state.events[idx] = {...state.events[idx], ...updates};

  const artistEl = document.getElementById('ov-artist');
  const wid = state.currentWeek[eventId];
  if(artistEl && wid){
    const artist = artistEl.value.trim()||null;
    const { error: wErr } = await sb.from('weeks').update({ artist }).eq('id',wid);
    if(wErr){ toast('Saved, but artist failed to save',true); }
    else {
      const wIdx = (state.weeks[eventId]||[]).findIndex(w=>w.id===wid);
      if(wIdx>-1) state.weeks[eventId][wIdx] = {...state.weeks[eventId][wIdx], artist};
    }
  }
  logActivity('updated event brief', (state.events.find(e=>e.id===eventId)||{}).name);
  closeModal(); toast('Brief saved'); renderMain();
}

function openEditEvent(eventId){
  const ev = state.events.find(e=>e.id===eventId);
  if(!ev) return;
  document.getElementById('modal-title').textContent = 'Edit Targets / Budget';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label class="form-label">Activation Name</label>
      <input class="form-input" id="event-name" value="${ev.name||''}">
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea class="form-textarea" id="event-desc">${ev.description||''}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Target Covers</label>
        <input class="form-input" id="event-capacity" type="number" value="${ev.capacity||0}">
      </div>
      <div class="form-group">
        <label class="form-label">Average Spend Target (AED)</label>
        <input class="form-input" id="event-avg" type="number" value="${ev.avg_spend_target||0}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Artist / Entertainment Budget (AED)</label>
        <input class="form-input" id="event-entertainment" type="number" value="${ev.entertainment_cost||0}">
      </div>
      <div class="form-group">
        <label class="form-label">Activation Day</label>
        <select class="form-select" id="event-day">
          ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d=>`<option value="${d}" ${ev.day_of_week===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
    </div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-gold" onclick="saveEditEvent('${eventId}')">Save Targets</button>`;
  document.getElementById('modal-overlay').classList.add('open');
}

async function saveEditEvent(eventId){
  const updates = {
    name: document.getElementById('event-name').value.trim(),
    description: document.getElementById('event-desc').value||null,
    capacity: parseInt(document.getElementById('event-capacity').value)||0,
    avg_spend_target: parseFloat(document.getElementById('event-avg').value)||0,
    entertainment_cost: parseFloat(document.getElementById('event-entertainment').value)||0,
    day_of_week: document.getElementById('event-day').value
  };
  const { error } = await sb.from('events').update(updates).eq('id',eventId);
  if(error){ toast('Error saving event targets',true); return; }
  const idx = state.events.findIndex(e=>e.id===eventId);
  if(idx>-1) state.events[idx] = {...state.events[idx], ...updates};
  logActivity('updated targets', updates.name);
  closeModal(); toast('Targets saved'); renderMain();
}

function openWeekActuals(weekId){
  let week = null, ev = null;
  for(const eid in state.weeks){
    week = state.weeks[eid].find(w=>w.id===weekId);
    if(week){ ev = state.events.find(e=>e.id===eid) || {}; break; }
  }
  if(!week) return;
  ev = ev || {};

  document.getElementById('modal-title').textContent = 'Enter Results · '+week.week_label;
  document.getElementById('modal-body').innerHTML = `
    <div class="fin-sheet">

      <div class="fin-section">
        <div class="fin-section-head"><span>Revenue Breakdown</span><span class="hint">Net of VAT</span></div>
        <div class="fin-line">
          <label>F&amp;B Sales<span class="sub">Food + beverage combined</span></label>
          <div class="fin-input-wrap"><span class="cur">AED</span>
            <input class="fin-input" id="act-fnb" type="number" inputmode="decimal" placeholder="0" value="${week.fnb_revenue||''}" oninput="recalcActuals()"></div>
        </div>
        <div class="fin-line">
          <label>Complimentary<span class="sub">Comp value (memo)</span></label>
          <div class="fin-input-wrap"><span class="cur">AED</span>
            <input class="fin-input" id="act-comp" type="number" inputmode="decimal" placeholder="0" value="${week.complimentary||''}"></div>
        </div>
      </div>

      <div class="fin-section">
        <div class="fin-section-head"><span>Total · Scala (Lounge)</span><span class="hint">Source of truth</span></div>
        <div class="fin-line">
          <label>Scala (Lounge) Revenue<span class="sub">Net total for the night</span></label>
          <div class="fin-input-wrap"><span class="cur">AED</span>
            <input class="fin-input" id="act-revenue" type="number" inputmode="decimal" placeholder="0" value="${week.revenue_actual||''}" oninput="recalcActuals()"></div>
        </div>
        <div id="act-check" class="fin-check empty"></div>
      </div>

      <div class="fin-section">
        <div class="fin-section-head"><span>Covers &amp; Average Spend</span></div>
        <div class="fin-line">
          <label>Total Covers<span class="sub">Guest count</span></label>
          <div class="fin-input-wrap">
            <input class="fin-input plain" id="act-covers" type="number" inputmode="numeric" placeholder="0" value="${week.covers_actual||''}" oninput="recalcActuals()"></div>
        </div>
        <div class="fin-line">
          <label>Average Spend<span class="sub">Auto: revenue ÷ covers · editable</span></label>
          <div class="fin-input-wrap"><span class="cur">AED</span>
            <input class="fin-input" id="act-avg" type="number" inputmode="decimal" placeholder="0" value="${week.avg_spend_actual||''}"></div>
        </div>
      </div>

      <div class="fin-readout">
        <div class="fin-readout-row"><span>Target Revenue</span><span class="v" id="ro-target">—</span></div>
        <div class="fin-readout-row"><span>Variance to Target</span><span class="v" id="ro-var">—</span></div>
        <div class="fin-readout-row total"><span>Actual · Scala (Lounge)</span><span class="v" id="ro-actual">—</span></div>
      </div>

      <div class="form-row" style="margin-top:22px">
        <div class="form-group">
          <label class="form-label">Week Status</label>
          <select class="form-select" id="act-status">
            <option value="upcoming" ${week.status==='upcoming'?'selected':''}>Upcoming</option>
            <option value="active" ${week.status==='active'?'selected':''}>Active</option>
            <option value="completed" ${week.status==='completed'?'selected':''}>Completed</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Covers Target</label>
          <input class="form-input" type="number" value="${ev.capacity||''}" disabled style="opacity:.6">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-textarea" id="act-notes" placeholder="Service notes, comps context, anything for the report…">${week.notes||''}</textarea>
      </div>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-gold" onclick="saveActuals('${weekId}')">Save Results</button>`;

  document.getElementById('modal-overlay').classList.add('open');
  window._actualsEv = ev;
  recalcActuals(ev);
}

function recalcActuals(ev){
  ev = ev || window._actualsEv || {};
  const num = id => parseFloat(document.getElementById(id)?.value)||0;
  const covers = num('act-covers');
  const revenue = num('act-revenue');
  const fnb = num('act-fnb');
  const avgEl = document.getElementById('act-avg');
  // auto avg spend if not manually diverged
  if(avgEl && covers && revenue) avgEl.value = (revenue / covers).toFixed(2);

  // F&B sales check vs total
  const comp = num('act-comp');
  const checkEl = document.getElementById('act-check');
  if(checkEl){
    const sum = fnb;
    if(!revenue || !sum){
      checkEl.className = 'fin-check empty';
      checkEl.textContent = 'F&B Sales will reconcile against the Scala (Lounge) total here.';
    } else {
      const diff = revenue - sum;
      const pct = Math.abs(diff)/revenue*100;
      if(pct <= 1.5){
        checkEl.className = 'fin-check ok';
        checkEl.textContent = `F&B Sales = AED ${sum.toLocaleString()} · reconciles to total (${diff>=0?'+':''}${Math.round(diff).toLocaleString()})`;
      } else {
        checkEl.className = 'fin-check off';
        checkEl.textContent = `F&B Sales = AED ${sum.toLocaleString()} · ${diff>=0?'short by':'over by'} AED ${Math.abs(Math.round(diff)).toLocaleString()} vs total`;
      }
    }
  }

  // readout strip
  const roA = document.getElementById('ro-actual');
  const roT = document.getElementById('ro-target');
  const roV = document.getElementById('ro-var');
  if(roA){
    const targetRev = (Number(ev.capacity)||0) * (Number(ev.avg_spend_target)||0);
    roA.textContent = revenue ? 'AED '+revenue.toLocaleString() : '—';
    roT.textContent = targetRev ? 'AED '+targetRev.toLocaleString() : '—';
    if(revenue && targetRev){
      const v = revenue - targetRev;
      roV.textContent = (v>=0?'+':'−')+'AED '+Math.abs(v).toLocaleString()+'  ('+Math.round(revenue/targetRev*100)+'%)';
      roV.style.color = v>=0 ? 'var(--green)' : 'var(--amber)';
    } else { roV.textContent='—'; roV.style.color=''; }
  }
}

async function saveActuals(weekId){
  recalcActuals();
  const updates = {
    covers_actual: parseInt(document.getElementById('act-covers').value)||null,
    revenue_actual: parseFloat(document.getElementById('act-revenue').value)||null,
    fnb_revenue: parseFloat(document.getElementById('act-fnb').value)||null,
    complimentary: parseFloat(document.getElementById('act-comp').value)||null,
    avg_spend_actual: parseFloat(document.getElementById('act-avg').value)||null,
    status: document.getElementById('act-status').value,
    notes: document.getElementById('act-notes').value||null
  };
  const { error } = await sb.from('weeks').update(updates).eq('id',weekId);
  if(error){ toast('Error saving results',true); return; }
  for(const eid in state.weeks){
    const idx = state.weeks[eid].findIndex(w=>w.id===weekId);
    if(idx>-1){ state.weeks[eid][idx]={...state.weeks[eid][idx],...updates}; break; }
  }
  logActivity('entered results', null, (updates.covers_actual||0) + ' covers, AED ' + (updates.revenue_actual||0));
  closeModal(); toast('Results saved'); renderMain();
}

// Enter a night's numbers AGAINST THE DATE IT HAPPENED — for backfilling history
// and for activations whose dates aren't a fixed weekly cadence (e.g. Cigar).
// Finds the week row for that event+date, or creates a completed one, then saves
// revenue/covers. No task template is seeded — these are results-only nights.
function openAddResult(preEventId){
  const opts = state.events.filter(e=>(e.status||'active')!=='paused')
    .map(e=>`<option value="${e.id}" ${e.id===preEventId?'selected':''}>${e.name}</option>`).join('');
  document.getElementById('modal-title').textContent = 'Add a night’s numbers';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label class="form-label">Activation</label>
      <select class="form-select" id="ar-event">${opts}</select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Date it took place</label>
        <input class="form-input" id="ar-date" type="date" max="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label">Net revenue (AED)</label>
        <input class="form-input" id="ar-rev" type="number" inputmode="decimal" placeholder="0">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Covers <span style="color:var(--text-light);font-weight:400">(optional)</span></label>
      <input class="form-input" id="ar-covers" type="number" inputmode="numeric" placeholder="Guest count">
    </div>
    <div style="font-size:12px;color:var(--text-light);margin-top:6px;line-height:1.5">Enter each night on the date it actually happened. If that date already has numbers, this updates them. Average spend is worked out for you.</div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-gold" onclick="saveAddResult()">Save night</button>`;
  document.getElementById('modal-overlay').classList.add('open');
}

async function saveAddResult(){
  const eventId = document.getElementById('ar-event').value;
  const dateStr = document.getElementById('ar-date').value;               // YYYY-MM-DD
  const rev = parseFloat(document.getElementById('ar-rev').value)||0;
  const covers = parseInt(document.getElementById('ar-covers').value)||null;
  if(!eventId){ toast('Pick an activation', true); return; }
  if(!dateStr){ toast('Pick the date it took place', true); return; }
  if(!rev){ toast('Enter the net revenue', true); return; }
  const ev = state.events.find(e=>e.id===eventId);
  const avg = covers ? +(rev/covers).toFixed(2) : null;
  const fields = { revenue_actual: rev, covers_actual: covers, avg_spend_actual: avg, status: 'completed' };
  let wk = (state.weeks[eventId]||[]).find(w=> String(w.week_date||'').slice(0,10)===dateStr);
  if(wk){
    const { error } = await sb.from('weeks').update(fields).eq('id', wk.id);
    if(error){ toast('Could not save', true); return; }
    Object.assign(wk, fields);
  } else {
    const label = parseLocalDate(dateStr).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
    const { data, error } = await sb.from('weeks').insert({ event_id: eventId, week_date: dateStr, week_label: label, ...fields }).select().single();
    if(error){ toast('Could not save the night', true); return; }
    if(!state.weeks[eventId]) state.weeks[eventId] = [];
    state.weeks[eventId].push(data);
    state.tasks[data.id] = []; state.finance[data.id] = [];
  }
  logActivity('entered result by date', (ev?ev.name:'') + ' — ' + dateStr, 'AED ' + Math.round(rev).toLocaleString() + (covers?', '+covers+' covers':''));
  closeModal(); toast('Saved ' + (ev?ev.name:'') + ' — ' + fmtDate(dateStr)); renderMain();
}

// -- MODAL --
function closeModal(){
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal').classList.remove('wide');
}
function closeModalOnOverlay(e){
  if(e.target===document.getElementById('modal-overlay')) closeModal();
}

// -- EVENT LISTENERS --
function attachEventListeners(){ /* delegated via onclick */ }

// -- ACTIVITY LOG --
function logActivity(action, label, details){
  try{
    sb.from('activity').insert({
      user_email: state.userEmail || null,
      action: action,
      entity_label: label || null,
      details: details || null
    }).then(()=>{});
  }catch(e){}
}

function actorName(email){
  if(!email) return 'Someone';
  const n = email.split('@')[0];
  return n.charAt(0).toUpperCase() + n.slice(1);
}

async function openActivity(){
  document.getElementById('modal-title').textContent = 'Activity Log';
  document.getElementById('modal-body').innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-gold" onclick="closeModal()">Close</button>`;
  document.getElementById('modal').classList.add('wide');
  document.getElementById('modal-overlay').classList.add('open');
  const { data, error } = await sb.from('activity').select('*').order('created_at', { ascending: false }).limit(120);
  if(error){ document.getElementById('modal-body').innerHTML = '<div class="empty-state">Could not load activity.</div>'; return; }
  if(!data || !data.length){ document.getElementById('modal-body').innerHTML = '<div class="empty-state">No activity recorded yet.</div>'; return; }
  let lastDay = '';
  const rows = data.map(a=>{
    const d = new Date(a.created_at);
    const day = d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
    const time = d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    const head = day !== lastDay ? `<div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--text-light);margin:16px 0 8px">${day}</div>` : '';
    lastDay = day;
    return `${head}
      <div style="display:flex;gap:12px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span style="color:var(--text-light);font-size:11px;white-space:nowrap">${time}</span>
        <span><b style="color:var(--vino)">${actorName(a.user_email)}</b> ${a.action}${a.entity_label ? ' \u2014 <b>'+a.entity_label+'</b>' : ''}${a.details ? ' <span style="color:var(--text-light)">('+a.details+')</span>' : ''}</span>
      </div>`;
  }).join('');
  document.getElementById('modal-body').innerHTML = rows;
}

// -- LIVE SYNC --
let syncChannel = null;
let reloadTimer = null;
let lastLoad = 0;
let syncListenersAttached = false;

function safeToRefresh(){
  // Don't wipe the screen while someone is typing or has a modal open
  const overlay = document.getElementById('modal-overlay');
  if(overlay && overlay.classList.contains('open')) return false;
  const ae = document.activeElement;
  const main = document.getElementById('main-content');
  if(ae && main && main.contains(ae) && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.tagName==='SELECT')) return false;
  return true;
}

function scheduleReload(){
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(()=>{
    if(!safeToRefresh()){ scheduleReload(); return; }
    lastLoad = Date.now();
    loadAll();
  }, 500);
}

function startRealtime(){
  stopRealtime();
  try{
    syncChannel = sb.channel('hub-sync-' + Math.random().toString(36).slice(2));
    ['events','weeks','tasks','finance'].forEach(t=>{
      syncChannel.on('postgres_changes', { event:'*', schema:'public', table:t }, scheduleReload);
    });
    syncChannel.subscribe();
  }catch(e){}
}

function stopRealtime(){
  if(syncChannel){ try{ sb.removeChannel(syncChannel); }catch(e){} syncChannel = null; }
}

function maybeRefreshOnReturn(){
  if(Date.now() - lastLoad < 15000) return;
  if(!safeToRefresh()) return;
  lastLoad = Date.now();
  loadAll();
}

function attachSyncListeners(){
  if(syncListenersAttached) return;
  syncListenersAttached = true;
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) maybeRefreshOnReturn(); });
  window.addEventListener('focus', maybeRefreshOnReturn);
}

