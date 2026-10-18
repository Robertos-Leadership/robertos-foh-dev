// ──────────────────────────────────────────────────────────────────────────
// ROBERTO'S 3.0 ACTION PLAN (ap*) — 16 Oct 2026.
//
// Amin's 10 points, the steps under each, who and when, and how we check every
// week that it is working. Built to the approved mock-up in
// "Robertos-3.0-Action-Plan.pptx" (16 Oct): overview, point page, Wednesday email.
//
// WHO SEES IT: the four emails in ap_settings.members (Francesco, Ouafaa, Amin,
// Justin). The LOCK is in the database — every ap_* table has RLS keyed on the
// signed-in email (actionplan-001-schema.sql). The 'actionplan' grant in
// app_users.modules only shows the card. Anyone else who reaches this screen
// reads zero rows and is told "No access".
//
// THE RULES (same in the email, ap-weekly):
//   point % = steps done ÷ steps in the point · plan % = all done ÷ all steps
//   Done = every step done · Late = an open step whose date has passed ·
//   Due this week = an open step due in the next 7 days · Not started = nothing
//   done and no date set · On track = otherwise.
//   A late step's date can only move with a reason (ap_move_date writes it as a
//   comment). Only Amin (ap_settings.approver) approves changes and the week.
//
// NUMBERS: never typed, except measures whose source is "Manual". The live ones
// are computed by the ap-weekly edge function (SevenRooms through the Kitchen
// sevenrooms-sync, rev_daily, google_reviews_daily) and stored in ap_measures +
// ap_snapshots, so the screen and the email always show the same figure.
// ──────────────────────────────────────────────────────────────────────────

var AP = { loaded: false, loading: false, noAccess: false, err: null, open: null, filter: 'all',
           settings: null, points: [], steps: [], measures: [], snaps: [], results: [], comments: [], changes: [], weeks: [],
           busy: {}, moving: null, msg: null, refreshing: false };

var AP_NAMES = { 'fguarracino@robertos.ae': 'Francesco', 'onafid@robertos.ae': 'Ouafaa', 'akadrie@skelmore.com': 'Amin', 'justin@skelmore.com': 'Justin', 'asacchi@skelmore.com': 'Andrea' };
var AP_GROUPS = ['Standards', 'People', 'Business growth', 'Relaunch'];

function apEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
function apMe(){ return String(state.userEmail || '').toLowerCase(); }
function apName(e){ e = String(e || '').toLowerCase(); return AP_NAMES[e] || e.split('@')[0]; }
function apToday(){ return new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10); }   // Dubai calendar date
function apAdd(d, n){ var x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function apMonday(d){ var w = new Date(d + 'T12:00:00Z').getUTCDay(); return apAdd(d, -((w + 6) % 7)); }
function apDate(d){ if(!d) return ''; return new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function apDoneDate(ts){ return ts ? apDate(new Date(new Date(ts).getTime() + 4 * 3600e3).toISOString().slice(0, 10)) : ''; }
function apIsApprover(){ return !!(AP.settings && String(AP.settings.approver || '').toLowerCase() === apMe()); }
// A repaint rewrites the whole screen (renderMain). Anything half-typed would be
// lost — a comment draft, or an owner being typed when the auto-refresh lands —
// so every textarea draft, and the field that has focus, is carried across.
function apRepaint(){
  if(!(typeof state === 'object' && state.currentTab === 'actionplan' && typeof renderMain === 'function')) return;
  var keep = {}, act = document.activeElement, focusId = (act && act.id && act.id.indexOf('ap-') === 0) ? act.id : null, caret = null;
  document.querySelectorAll('.ap-wrap textarea[id^="ap-"]').forEach(function(el){ if(el.value) keep[el.id] = el.value; });
  if(focusId && act.tagName === 'INPUT'){ keep[focusId] = act.value; try{ caret = act.selectionStart; }catch(e){} }
  if(focusId && act.tagName === 'TEXTAREA'){ try{ caret = act.selectionStart; }catch(e){} }
  renderMain();
  Object.keys(keep).forEach(function(id){ var el = document.getElementById(id); if(el) el.value = keep[id]; });
  if(focusId){ var f = document.getElementById(focusId); if(f){ try{ f.focus(); if(caret != null && f.setSelectionRange) f.setSelectionRange(caret, caret); }catch(e){} } }
}

// ── status ────────────────────────────────────────────────────────────────
function apStepLate(s){ return !s.done_at && s.due_date && s.due_date < apToday(); }
function apStepSoon(s){ var t = apToday(); return !s.done_at && s.due_date && s.due_date >= t && s.due_date <= apAdd(t, 7); }
function apPointSteps(pid){ return AP.steps.filter(function(s){ return s.point_id === pid; }).sort(function(a, b){ return a.sort - b.sort; }); }
function apPointStatus(steps){
  var done = steps.filter(function(s){ return s.done_at; }).length;
  if(steps.length && done === steps.length) return 'done';
  if(steps.some(apStepLate)) return 'late';
  if(steps.some(apStepSoon)) return 'soon';
  if(!done && !steps.some(function(s){ return s.due_date; })) return 'none';
  return 'ok';
}
var AP_PILL = { done: ['Done', 'ap-p-done'], late: ['Late', 'ap-p-late'], soon: ['Due this week', 'ap-p-soon'], ok: ['On track', 'ap-p-ok'], none: ['Not started', 'ap-p-none'] };
function apPill(st){ var p = AP_PILL[st]; return '<span class="ap-pill ' + p[1] + '">' + p[0] + '</span>'; }
function apPct(steps){ return steps.length ? Math.round(steps.filter(function(s){ return s.done_at; }).length / steps.length * 100) : 0; }
function apBar(pct){ return '<div class="ap-bar"><div style="width:' + pct + '%"></div></div>'; }

// ── load ──────────────────────────────────────────────────────────────────
async function apLoad(silent){
  if(AP.loading) return;
  AP.loading = true; if(!silent) AP.err = null;
  try{
    var r = await Promise.all([
      sb.from('ap_settings').select('*').eq('id', 1),
      sb.from('ap_points').select('*').order('num'),
      sb.from('ap_steps').select('*').order('sort'),
      sb.from('ap_measures').select('*').order('sort'),
      sb.from('ap_snapshots').select('*').order('week_start', { ascending: false }).limit(500),
      sb.from('ap_results').select('*').order('created_at', { ascending: false }),
      sb.from('ap_comments').select('*').order('created_at', { ascending: false }),
      sb.from('ap_changes').select('*').order('created_at', { ascending: false }),
      sb.from('ap_weeks').select('*').order('week_start', { ascending: false })
    ]);
    var bad = r.filter(function(x){ return x.error; })[0];
    // Signed out (anon key) the tables refuse outright; that is the same answer.
    if(bad && (bad.error.code === '42501' || /permission denied/i.test(bad.error.message || ''))){ AP.noAccess = true; AP.loaded = true; return; }
    if(bad) throw new Error(bad.error.message);
    // RLS returns zero rows (not an error) to anyone not on the list.
    if(!r[0].data || !r[0].data.length){ AP.noAccess = true; AP.loaded = true; return; }
    AP.noAccess = false;
    AP.settings = r[0].data[0]; AP.points = r[1].data; AP.steps = r[2].data; AP.measures = r[3].data;
    AP.snaps = r[4].data; AP.results = r[5].data; AP.comments = r[6].data; AP.changes = r[7].data; AP.weeks = r[8].data;
    AP.loaded = true;
    setTimeout(apMaybeRefresh, 0);
  }catch(e){
    if(!silent || !AP.loaded) AP.err = (e && e.message) ? e.message : String(e);   // a failed background refresh keeps what is on screen
  }finally{
    AP.loading = false; apRepaint();
  }
}
function apFail(where, error){ AP.msg = { bad: true, text: where + ': ' + (error && error.message ? error.message : error) }; apRepaint(); }
function apDismiss(){ AP.msg = null; apRepaint(); }
function apSay(text, ms){ var m = { bad: false, text: text }; AP.msg = m; apRepaint(); setTimeout(function(){ if(AP.msg === m){ AP.msg = null; apRepaint(); } }, ms || 2500); }

// ── writes ────────────────────────────────────────────────────────────────
// Every write goes to the database first and the screen follows what it says.
async function apTick(id, on){
  var s = AP.steps.filter(function(x){ return x.id === id; })[0]; if(!s) return;
  var r = await sb.from('ap_steps').update({ done_at: on ? new Date().toISOString() : null }).eq('id', id).select();
  if(r.error || !r.data || !r.data.length) return apFail('Could not save the tick', r.error || 'no row changed');
  Object.assign(s, r.data[0]); apSay(on ? 'Marked done' : 'Marked not done');
}
async function apSetOwner(id, v){
  var r = await sb.from('ap_steps').update({ owner: String(v || '').trim() || null }).eq('id', id).select();
  if(r.error || !r.data || !r.data.length) return apFail('Could not save the owner', r.error || 'no row changed');
  var s = AP.steps.filter(function(x){ return x.id === id; })[0]; Object.assign(s, r.data[0]); apSay('Owner saved');
}
async function apSetDate(id, v){
  var s = AP.steps.filter(function(x){ return x.id === id; })[0]; if(!s) return;
  if(apStepLate(s)){ AP.moving = { id: id, date: v || '' }; apRepaint(); return; }   // late → needs a reason
  var r = await sb.from('ap_steps').update({ due_date: v || null }).eq('id', id).select();
  if(r.error || !r.data || !r.data.length) return apFail('Could not save the date', r.error || 'no row changed');
  Object.assign(s, r.data[0]); apSay('Date saved');
}
async function apMoveLate(){
  var m = AP.moving; if(!m) return;
  var d = document.getElementById('ap-move-date'), w = document.getElementById('ap-move-why');
  var date = d ? d.value : '', why = w ? w.value.trim() : '';
  if(!date){ return apFail('New date', 'pick the new date'); }
  if(!why){ return apFail('Reason', 'a late step needs a reason before its date can move'); }
  var r = await sb.rpc('ap_move_date', { p_step: m.id, p_date: date, p_reason: why });
  if(r.error) return apFail('Could not move the date', r.error);
  AP.moving = null; await apLoad(); apSay('Date moved and the reason saved as a comment.');
}
function apCancelMove(){ AP.moving = null; apRepaint(); }
async function apAddComment(pid){
  var el = document.getElementById('ap-c-' + pid); var body = el ? el.value.trim() : ''; if(!body) return;
  var r = await sb.from('ap_comments').insert({ point_id: pid, author_email: apMe(), body: body }).select();
  if(r.error || !r.data || !r.data.length) return apFail('Could not save the comment', r.error || 'nothing saved');
  if(el) el.value = ''; AP.comments.unshift(r.data[0]); apSay('Comment added');
}
async function apPropose(pid){
  var el = document.getElementById('ap-x-' + pid); var p = el ? el.value.trim() : ''; if(!p) return;
  var r = await sb.from('ap_changes').insert({ point_id: pid, proposal: p, proposed_by: apMe() }).select();
  if(r.error || !r.data || !r.data.length) return apFail('Could not save the proposal', r.error || 'nothing saved');
  if(el) el.value = ''; AP.changes.unshift(r.data[0]); apSay('Sent to Amin for his OK');
}
async function apDecide(id, status){
  var r = await sb.from('ap_changes').update({ status: status }).eq('id', id).select();
  if(r.error || !r.data || !r.data.length) return apFail('Could not record the decision', r.error || 'only Amin can decide');
  var c = AP.changes.filter(function(x){ return x.id === id; })[0]; Object.assign(c, r.data[0]); apRepaint();
}
async function apAddResult(pid){
  var el = document.getElementById('ap-r-' + pid); var note = el ? el.value.trim() : ''; if(!note) return;
  var r = await sb.from('ap_results').insert({ point_id: pid, week_start: apMonday(apToday()), note: note, author_email: apMe() }).select();
  if(r.error || !r.data || !r.data.length) return apFail('Could not save the note', r.error || 'nothing saved');
  if(el) el.value = ''; AP.results.unshift(r.data[0]); apSay('Added to this week');
}
async function apSetManual(mid, v){
  var n = String(v).trim() === '' ? null : Number(v);
  if(n !== null && !isFinite(n)) return apFail('Number', 'that is not a number');
  var r = await sb.from('ap_measures').update({ current: n, updated_at: new Date().toISOString() }).eq('id', mid).select();
  if(r.error || !r.data || !r.data.length) return apFail('Could not save the number', r.error || 'only manual measures can be typed');
  var m = AP.measures.filter(function(x){ return x.id === mid; })[0]; Object.assign(m, r.data[0]); apSay('Number saved');
}
async function apWeek(status){
  var el = document.getElementById('ap-week-note'); var note = el ? el.value.trim() : '';
  if(status === 'changes' && !note) return apFail('Request changes', 'say what needs to change in the note');
  var r = await sb.from('ap_weeks').upsert({ week_start: apMonday(apToday()), status: status, note: note || null }, { onConflict: 'week_start' }).select();
  if(r.error || !r.data || !r.data.length) return apFail('Could not record the week', r.error || 'only Amin can approve the week');
  AP.weeks = AP.weeks.filter(function(w){ return w.week_start !== r.data[0].week_start; }); AP.weeks.unshift(r.data[0]); apRepaint();
}
// opts.olderThan: only re-read the sources if the numbers are older than this
// many minutes (the function enforces it, floor 2). opts.quiet: no toast unless
// it fails — used when the plan opens and refreshes itself.
async function apCallWeekly(mode, opts){
  opts = opts || {};
  if(AP.refreshing) return;
  AP.refreshing = mode; apRepaint();
  try{
    var body = { mode: mode };
    if(opts.olderThan) body.ifOlderThanMinutes = opts.olderThan;
    var r = await sb.functions.invoke('ap-weekly', { body: body });
    if(r.error) throw r.error;
    if(!r.data || !r.data.ok) throw new Error((r.data && r.data.error) || 'no answer');
    if(mode === 'send') apSay('Weekly email sent to ' + (r.data.to || []).join(', ') + '.', 5000);
    else if(r.data.skipped){ if(!opts.quiet) apSay('Numbers are already up to date (read ' + apAgo(r.data.updated_at) + ').'); }
    else if(!opts.quiet) apSay('Numbers updated from the sources.');
    if(!r.data.skipped) await apLoad(true);
  }catch(e){ apFail(mode === 'send' ? 'Email not sent' : 'Numbers not updated', e); }
  finally{ AP.refreshing = false; apRepaint(); }
}
function apAgo(ts){
  if(!ts) return 'never';
  var m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if(m < 1) return 'just now'; if(m < 60) return m + ' min ago';
  var h = Math.round(m / 60); if(h < 24) return h + ' h ago';
  return apDoneDate(ts) + ' ' + new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
}
// Newest moment the automatic numbers were read from their sources.
function apAutoRead(){ return AP.measures.filter(function(m){ return m.input === 'auto' && m.updated_at; }).map(function(m){ return m.updated_at; }).sort().pop() || null; }
// Opening the plan pulls fresh automatic numbers if they are over 3 hours old.
var AP_STALE_MIN = 180;
function apMaybeRefresh(){
  if(AP.autoAsked || AP.noAccess || AP.refreshing) return;
  AP.autoAsked = true;
  var t = apAutoRead();
  if(!t || Date.now() - new Date(t).getTime() > AP_STALE_MIN * 60000) apCallWeekly('refresh', { olderThan: AP_STALE_MIN, quiet: true });
}
function apOpen(pid){ AP.open = pid; AP.moving = null; AP.msg = null; apRepaint(); try{ window.scrollTo(0, 0); }catch(e){} }
function apFilter(f){ AP.filter = f; apRepaint(); }

// ── render ────────────────────────────────────────────────────────────────
function renderActionPlan(){
  apCss();
  if(!AP.loaded && !AP.loading && !AP.err) setTimeout(apLoad, 0);
  if(AP.err) return '<div class="ap-wrap"><div class="ap-card ap-msg-bad">The plan could not be read: ' + apEsc(AP.err) + ' <button class="ap-btn" onclick="AP.err=null;apLoad()">Try again</button></div></div>';
  if(!AP.loaded) return '<div class="ap-wrap"><div class="loading">Reading the plan&hellip;</div></div>';
  if(AP.noAccess) return '<div class="ap-wrap"><div class="ap-head"><div class="ap-kick">FOH App &middot; Executive</div><div class="ap-title">No access</div>'
    + '<div class="ap-sub">The Roberto\'s 3.0 action plan is private. Your login is not on its list &mdash; ask Francesco if you should be.</div></div></div>';
  // Errors stay until closed; a "Saved" goes by itself.
  var msg = AP.msg ? '<div class="ap-toast ' + (AP.msg.bad ? 'ap-msg-bad' : 'ap-msg-ok') + '" role="status">' + apEsc(AP.msg.text)
    + (AP.msg.bad ? ' <button class="ap-x" onclick="apDismiss()" aria-label="Close">&times;</button>' : '') + '</div>' : '';
  return '<div class="ap-wrap">' + apOwnersList() + (AP.open ? apPointPage(AP.open, '') : apOverview('')) + msg + '</div>';
}

function apWeekPill(){
  var wk = apMonday(apToday()), start = (AP.settings && AP.settings.plan_start) || wk;
  var n = Math.floor((Date.parse(wk) - Date.parse(start)) / (7 * 86400e3)) + 1;
  var w = AP.weeks.filter(function(x){ return x.week_start === wk; })[0];
  var st = w ? ({ approved: 'approved', changes: 'changes asked', pending: 'pending' }[w.status]) : 'not approved yet';
  var label = (n >= 1 ? 'Week ' + n : 'Before week 1') + ' &middot; ' + st;
  return '<span class="ap-weekpill' + (w && w.status === 'approved' ? '' : ' ap-weekpill-wait') + '">' + label + '</span>';
}

function apOverview(msg){
  var all = AP.steps, done = all.filter(function(s){ return s.done_at; }).length, pct = apPct(all);
  var late = all.filter(apStepLate).length;
  var rel = (AP.settings && AP.settings.relaunch_date) || '2026-11-02';
  var days = Math.round((Date.parse(rel) - Date.parse(apToday())) / 86400e3);
  var members = ((AP.settings && AP.settings.members) || []).map(apName).join(' &middot; ');
  var h = [];
  h.push('<div class="ap-head"><div class="ap-head-row"><div><div class="ap-kick">FOH App &middot; Executive</div><div class="ap-title">Roberto\'s 3.0 action plan</div>'
    + '<div class="ap-sub">Private: ' + members + '</div></div>' + apWeekPill() + '</div></div>');
  h.push(msg);
  h.push('<div class="ap-cards">'
    + '<div class="ap-card ap-stat"><div class="ap-lbl">Plan progress</div><div class="ap-big">' + pct + '%</div>' + apBar(pct) + '</div>'
    + '<div class="ap-card ap-stat"><div class="ap-lbl">Steps done</div><div class="ap-big">' + done + ' / ' + all.length + '</div></div>'
    + '<div class="ap-card ap-stat"><div class="ap-lbl">Late</div><div class="ap-big' + (late ? ' ap-red' : '') + '">' + late + '</div></div>'
    + '<div class="ap-card ap-stat"><div class="ap-lbl">Relaunch</div><div class="ap-big">' + apDate(rel) + '</div><div class="ap-small">'
    + (days > 0 ? days + ' day' + (days === 1 ? '' : 's') + ' to go' : (days === 0 ? 'Today' : 'Done')) + '</div></div>'
    + '</div>');
  h.push(apWeekPanel());
  var f = AP.filter;
  h.push('<div class="ap-filters">' + [['all', 'All'], ['mine', 'My steps'], ['late', 'Late'], ['week', 'This week'], ['plan', 'Owners & dates'], ['numbers', 'Numbers']].map(function(x){
    return '<button class="ap-chip' + (f === x[0] ? ' on' : '') + '" onclick="apFilter(\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('') + '</div>');
  if(f === 'all'){
    // Straight 1-10, in Amin's order (his email of 16 Oct). Listed by group the
    // numbers ran 1, 2, 3, 6, 4, 5, 7, 10, 8, 9 and read as if points were
    // missing (Francesco, 18 Oct), so the group is a label on each row instead.
    h.push('<div class="ap-card ap-list">');
    AP.points.slice().sort(function(a, b){ return a.num - b.num; }).forEach(function(p){
      var st = apPointSteps(p.id), pc = apPct(st);
      h.push('<button class="ap-row" onclick="apOpen(\'' + p.id + '\')"><span class="ap-num">' + p.num + '</span><span class="ap-ptitle">' + apEsc(p.title)
        + '<span class="ap-gtag">' + apEsc(p.group) + '</span></span>'
        + '<span class="ap-rowbar">' + apBar(pc) + '</span><span class="ap-pct">' + pc + '%</span>' + apPill(apPointStatus(st)) + '</button>');
    });
    h.push('</div>');
  } else if(f === 'numbers'){
    h.push(apNumbersView());
  } else if(f === 'plan'){
    h.push(apPlanList());
  } else {
    h.push(apStepList(f));
  }
  h.push(apAdminStrip());
  return h.join('');
}

// Owner is free text (a step can belong to anyone), but typing the same person
// three ways breaks "My steps", so the box suggests the plan's people and every
// name already used.
function apOwnersList(){
  var seen = {}, out = [];
  ((AP.settings && AP.settings.members) || []).map(apName).concat(AP.steps.map(function(s){ return s.owner; }))
    .forEach(function(n){ n = String(n || '').trim(); if(n && !seen[n.toLowerCase()]){ seen[n.toLowerCase()] = 1; out.push(n); } });
  return '<datalist id="ap-owners">' + out.map(function(n){ return '<option value="' + apEsc(n) + '">'; }).join('') + '</datalist>';
}
function apEditors(s){
  return '<div class="ap-sedit"><label>Owner <input id="ap-o-' + s.id + '" class="ap-in" list="ap-owners" autocomplete="off" value="' + apEsc(s.owner || '') + '" placeholder="Who" onchange="apSetOwner(\'' + s.id + '\',this.value)"></label>'
    + '<label>Date <input id="ap-d-' + s.id + '" class="ap-in" type="date" value="' + apEsc(s.due_date || '') + '" onchange="apSetDate(\'' + s.id + '\',this.value)"></label></div>';
}
function apMovePanel(s){
  if(!(AP.moving && AP.moving.id === s.id)) return '';
  return '<div class="ap-move"><div class="ap-small"><b>This step is late.</b> Give it a new date and say why. The reason is saved as a comment.</div>'
    + '<label>New date <input id="ap-move-date" class="ap-in" type="date" value="' + apEsc(AP.moving.date) + '"></label>'
    + '<textarea id="ap-move-why" class="ap-in ap-ta" rows="2" placeholder="Why it moved"></textarea>'
    + '<div class="ap-btns"><button class="ap-btn ap-btn-main" onclick="apMoveLate()">Move the date</button><button class="ap-btn" onclick="apCancelMove()">Cancel</button></div></div>';
}
// Every step on one page, so owners and dates can be filled in one sitting.
function apPlanList(){
  var open = AP.steps.filter(function(s){ return !s.done_at; });
  var set = open.filter(function(s){ return s.owner && s.due_date; }).length;
  var h = ['<div class="ap-card ap-plan-head"><b>' + set + ' of ' + open.length + '</b> open steps have an owner and a date.'
    + (set < open.length ? ' <span class="ap-small">Each box saves as soon as you leave it.</span>' : '') + '</div>'];
  [0].forEach(function(){   // one pass, points in 1-10 order (same as the overview)
    AP.points.slice().sort(function(a, b){ return a.num - b.num; }).forEach(function(p){
      h.push('<div class="ap-group">' + p.num + '. ' + apEsc(p.title) + '</div><div class="ap-card ap-steps">');
      apPointSteps(p.id).forEach(function(s){
        var late = apStepLate(s);
        h.push('<div class="ap-step"><div class="ap-sbody"><div class="ap-stitle">' + apEsc(s.title) + (s.is_app ? ' <span class="ap-app">App</span>' : '') + '</div>'
          + (s.done_at ? '<div class="ap-ssub">Done ' + apDoneDate(s.done_at) + '</div>'
                       : (late ? '<div class="ap-ssub"><b class="ap-red">Late &middot; was due ' + apDate(s.due_date) + '</b></div>' : '') + apEditors(s) + apMovePanel(s))
          + '</div></div>');
      });
      h.push('</div>');
    });
  });
  return h.join('');
}

function apStepList(f){
  var me = String((state.access && state.access.name) || apName(apMe())).toLowerCase().split(/\s+/)[0];
  var t = apToday();
  var pick = AP.steps.filter(function(s){
    if(f === 'late') return apStepLate(s);
    if(f === 'week') return !s.done_at && s.due_date && s.due_date <= apAdd(t, 7);
    if(f === 'mine') return !!me && String(s.owner || '').toLowerCase().indexOf(me) !== -1;
    return true;
  });
  if(!pick.length){
    var none = { late: 'Nothing is late.', week: 'No open step is due in the next 7 days.', mine: 'No step has your name as owner yet. Owners are set in <b>Owners &amp; dates</b>.' }[f];
    return '<div class="ap-card ap-empty">' + none + '</div>';
  }
  var h = ['<div class="ap-card ap-list">'];
  AP.points.forEach(function(p){
    pick.filter(function(s){ return s.point_id === p.id; }).sort(function(a, b){ return a.sort - b.sort; }).forEach(function(s){
      h.push('<div class="ap-srow"><input type="checkbox" class="ap-check" ' + (s.done_at ? 'checked ' : '') + 'onchange="apTick(\'' + s.id + '\',this.checked)" aria-label="Done">'
        + '<button class="ap-slink" onclick="apOpen(\'' + p.id + '\')"><span class="ap-stitle">' + apEsc(s.title) + '</span><span class="ap-ssub">' + p.num + '. ' + apEsc(p.title)
        + (s.owner ? ' &middot; ' + apEsc(s.owner) : '') + (s.due_date ? ' &middot; ' + (apStepLate(s) ? '<b class="ap-red">was due ' + apDate(s.due_date) + '</b>' : 'due ' + apDate(s.due_date)) : '') + '</span></button></div>');
    });
  });
  h.push('</div>');
  return h.join('');
}

function apWeekPanel(){
  var wk = apMonday(apToday());
  var w = AP.weeks.filter(function(x){ return x.week_start === wk; })[0];
  var said = w ? '<div class="ap-small">' + ({ approved: 'Approved', changes: 'Changes requested', pending: 'Pending' }[w.status]) + ' by ' + apEsc(apName(w.approved_by)) + ' &middot; '
    + apDoneDate(w.approved_at) + (w.note ? ' &mdash; &ldquo;' + apEsc(w.note) + '&rdquo;' : '') + '</div>' : '';
  if(!apIsApprover()) return w ? '<div class="ap-card ap-week">' + said + '</div>' : '';
  return '<div class="ap-card ap-week"><div class="ap-lbl">This week &middot; ' + apDate(wk) + '</div>' + said
    + '<textarea id="ap-week-note" class="ap-in ap-ta" rows="2" placeholder="Note (needed for Request changes)"></textarea>'
    + '<div class="ap-btns"><button class="ap-btn ap-btn-main" onclick="apWeek(\'approved\')">Approve week</button><button class="ap-btn" onclick="apWeek(\'changes\')">Request changes</button></div></div>';
}

function apAdminStrip(){
  var rec = ((AP.settings && AP.settings.recipients) || []).join(', ');
  var upd = AP.measures.map(function(m){ return m.updated_at; }).filter(Boolean).sort().pop();
  var h = '<details class="ap-more"><summary>Numbers and the Wednesday email</summary><div class="ap-small">'
    + 'Live numbers last updated ' + (upd ? apDoneDate(upd) + ' ' + new Date(upd).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : 'never') + '. '
    + 'They update every Wednesday at 08:00 before the email, or now with the button. '
    + 'The Wednesday email goes to: <b>' + apEsc(rec || 'nobody') + '</b>.</div><div class="ap-btns">'
    + '<button class="ap-btn" ' + (AP.refreshing ? 'disabled' : '') + ' onclick="apCallWeekly(\'refresh\')">' + (AP.refreshing === 'refresh' ? 'Updating&hellip;' : 'Update numbers now') + '</button>';
  if(typeof fohIsAdmin === 'function' && fohIsAdmin())
    h += '<button class="ap-btn" ' + (AP.refreshing ? 'disabled' : '') + ' onclick="apCallWeekly(\'send\')">' + (AP.refreshing === 'send' ? 'Sending&hellip;' : 'Send this week\'s email now') + '</button>';
  return h + '</div></details>';
}

// How a number gets onto the screen. Automatic = read by the app from the
// source named; Typed in = a person typed it here (and who, and when).
function apInputBadge(m){
  if(m.input === 'auto'){
    var read = m.updated_at ? 'read ' + apAgo(m.updated_at) : 'not read yet';
    return '<span class="ap-badge ap-auto">Automatic</span><div class="ap-small">' + apEsc(m.source || '') + ' &middot; ' + read + '</div>';
  }
  return '<span class="ap-badge ap-man">Typed in</span><div class="ap-small">'
    + (m.updated_by ? 'by ' + apEsc(apName(m.updated_by)) + ' &middot; ' + apAgo(m.updated_at) : 'nobody has typed it yet') + '</div>';
}
function apManualInput(m){
  return '<input class="ap-in ap-num-in" inputmode="decimal" value="' + (m.current == null ? '' : m.current) + '" placeholder="&mdash;" onchange="apSetManual(\'' + m.id + '\',this.value)">'
    + (m.current_label ? '<div class="ap-small">' + apEsc(m.current_label) + '</div>' : '');
}
// Every number in the plan on one page, so it can be pulled any time.
function apNumbersView(){
  var t = apAutoRead();
  var h = ['<div class="ap-card ap-numhead"><div><b>Automatic numbers read ' + apAgo(t) + '.</b>'
    + '<div class="ap-small">They refresh themselves when the plan opens if they are over 3 hours old, and every Wednesday before the email. Tap Refresh to read the sources now.</div></div>'
    + '<button class="ap-btn ap-btn-main" ' + (AP.refreshing ? 'disabled' : '') + ' onclick="apCallWeekly(\'refresh\')">' + (AP.refreshing === 'refresh' ? 'Reading the sources&hellip;' : 'Refresh now') + '</button></div>'];
  h.push('<div class="ap-card ap-tablewrap"><table class="ap-table ap-numtable"><thead><tr><th>Point</th><th>Measure</th><th>Today</th><th>Target</th><th>Baseline</th><th>How it gets its number</th><th>How often</th></tr></thead><tbody>');
  AP.points.slice().sort(function(a, b){ return a.num - b.num; }).forEach(function(p){
    AP.measures.filter(function(m){ return m.point_id === p.id; }).forEach(function(m){
      h.push('<tr><td><button class="ap-linkbtn" onclick="apOpen(\'' + p.id + '\')">' + p.num + '. ' + apEsc(p.title) + '</button></td><td>' + apEsc(m.label) + '</td>'
        + '<td>' + (m.input === 'auto' ? apFmt(m) : apManualInput(m)) + '</td><td>' + apEsc(m.target || '') + '</td><td>' + apEsc(m.baseline || '') + '</td>'
        + '<td>' + apInputBadge(m) + '</td><td>' + apEsc(m.frequency || '') + '</td></tr>');
    });
  });
  h.push('</tbody></table></div>');
  h.push('<details class="ap-more" open><summary>What is automatic and what is typed in</summary><div class="ap-small">'
    + '<b>Automatic</b>: the app reads it itself &mdash; SevenRooms (walk-ins, channels, guests coming back, relaunch bookings), the closing report (Monday and Sunday guests), Google (rating) and, as each module arrives, the FOH App (SOP sign-off, training, mystery shopper, guest survey). Nobody types these.<br>'
    + '<b>Typed in</b>: roles filled and catering requests &mdash; there is no system that holds them, so a plan member types the number and the app records who and when.<br>'
    + '<b>Steps, owners, dates, comments and approvals</b> are always people: they tick, type and approve in the plan.</div></details>');
  return h.join('');
}

function apFmt(m){
  if(m.current == null) return '<span class="ap-nodata">' + apEsc(m.current_label || 'No data') + '</span>';
  var v = Number(m.current), u = m.unit;
  var s = u === '%' ? (Math.round(v * 10) / 10) + '%' : (u === 'rating' ? v.toFixed(1) : String(Math.round(v * 10) / 10));
  return '<b>' + s + '</b>' + (m.current_label ? '<div class="ap-small">' + apEsc(m.current_label) + '</div>' : '');
}

function apPointPage(pid, msg){
  var p = AP.points.filter(function(x){ return x.id === pid; })[0];
  if(!p){ AP.open = null; return apOverview(msg); }
  var st = apPointSteps(pid), pc = apPct(st), done = st.filter(function(s){ return s.done_at; }).length;
  var h = [];
  h.push('<button class="ap-back" onclick="apOpen(null)">&lsaquo; All 10 points</button>');
  h.push('<div class="ap-head"><div class="ap-kick">Point ' + p.num + '</div><div class="ap-title">' + apEsc(p.title) + '</div><div class="ap-sub">' + done + ' of ' + st.length + ' steps done</div></div>');
  h.push(msg);
  h.push('<div class="ap-goal">' + apEsc(p.goal || '') + '</div>');
  h.push('<div class="ap-card"><div class="ap-head-row"><div class="ap-big">' + pc + '%</div>' + apPill(apPointStatus(st)) + '</div>' + apBar(pc) + '</div>');

  // Steps
  h.push('<div class="ap-card ap-steps">');
  st.forEach(function(s){
    var late = apStepLate(s);
    var sub = s.done_at ? 'Done ' + apDoneDate(s.done_at) + (s.done_by && s.done_by !== 'seed' ? ' &middot; ' + apEsc(apName(s.done_by)) : '')
      : (s.due_date ? (late ? '<b class="ap-red">Late &middot; was due ' + apDate(s.due_date) + '</b>' : 'Due ' + apDate(s.due_date)) : 'No date yet');
    h.push('<div class="ap-step"><input type="checkbox" class="ap-check" ' + (s.done_at ? 'checked ' : '') + 'onchange="apTick(\'' + s.id + '\',this.checked)" aria-label="Done">'
      + '<div class="ap-sbody"><div class="ap-stitle">' + apEsc(s.title) + (s.is_app ? ' <span class="ap-app">App</span>' : '') + '</div><div class="ap-ssub">' + sub + '</div>'
      + apEditors(s) + apMovePanel(s));
    h.push('</div></div>');
  });
  h.push('</div>');

  // How we check
  var ms = AP.measures.filter(function(m){ return m.point_id === pid; });
  h.push('<div class="ap-sec">How we check</div><div class="ap-card ap-tablewrap"><table class="ap-table"><thead><tr><th>Measure</th><th>Today</th><th>Target</th><th>Baseline</th><th>How it gets its number</th><th>How often</th></tr></thead><tbody>');
  ms.forEach(function(m){
    var today = m.input === 'auto' ? apFmt(m) : apManualInput(m);
    h.push('<tr><td>' + apEsc(m.label) + '</td><td>' + today + '</td><td>' + apEsc(m.target || '') + '</td><td>' + apEsc(m.baseline || '') + '</td><td>' + apInputBadge(m) + '</td><td>' + apEsc(m.frequency || '') + '</td></tr>');
  });
  h.push('</tbody></table></div>');

  // Weekly results log: the stored weekly numbers + what people wrote about the week.
  var mids = ms.map(function(m){ return m.id; });
  var weeks = {};
  AP.snaps.filter(function(s){ return mids.indexOf(s.measure_id) !== -1; }).forEach(function(s){ (weeks[s.week_start] = weeks[s.week_start] || { n: [], r: [] }).n.push(s); });
  AP.results.filter(function(r){ return r.point_id === pid; }).forEach(function(r){ (weeks[r.week_start] = weeks[r.week_start] || { n: [], r: [] }).r.push(r); });
  var wkeys = Object.keys(weeks).sort().reverse();
  h.push('<div class="ap-sec">Weekly results</div><div class="ap-card">');
  if(!wkeys.length) h.push('<div class="ap-small">Nothing logged yet.</div>');
  wkeys.forEach(function(w){
    var nums = weeks[w].n.map(function(s){
      var m = ms.filter(function(x){ return x.id === s.measure_id; })[0];
      return apEsc(m ? m.label : '') + ': <b>' + (s.value == null ? 'No data' : (Math.round(Number(s.value) * 10) / 10) + (m && m.unit === '%' ? '%' : '')) + '</b>';
    }).join(' &middot; ');
    h.push('<div class="ap-wk"><div class="ap-lbl">Week of ' + apDate(w) + '</div>' + (nums ? '<div>' + nums + '</div>' : '')
      + weeks[w].r.map(function(r){ return '<div class="ap-note">' + apEsc(r.note) + ' <span class="ap-small">&mdash; ' + apEsc(apName(r.author_email)) + '</span></div>'; }).join('') + '</div>');
  });
  h.push('<textarea id="ap-r-' + pid + '" class="ap-in ap-ta" rows="2" placeholder="This week: what worked, what didn\'t"></textarea><div class="ap-btns"><button class="ap-btn" onclick="apAddResult(\'' + pid + '\')">Add to this week</button></div></div>');

  // Proposed changes
  var ch = AP.changes.filter(function(c){ return c.point_id === pid; });
  h.push('<div class="ap-sec">Proposed changes</div><div class="ap-card">');
  if(!ch.length) h.push('<div class="ap-small">No changes proposed.</div>');
  ch.forEach(function(c){
    var stl = { pending: '<span class="ap-pill ap-p-soon">Waiting for Amin</span>', approved: '<span class="ap-pill ap-p-ok">Approved</span>', rejected: '<span class="ap-pill ap-p-late">Rejected</span>' }[c.status];
    h.push('<div class="ap-change"><div>' + apEsc(c.proposal) + '<div class="ap-small">' + apEsc(apName(c.proposed_by)) + ' &middot; ' + apDoneDate(c.created_at)
      + (c.decided_by ? ' &middot; decided by ' + apEsc(apName(c.decided_by)) + ' ' + apDoneDate(c.decided_at) : '') + '</div></div><div>' + stl
      + (c.status === 'pending' && apIsApprover() ? '<div class="ap-btns"><button class="ap-btn ap-btn-main" onclick="apDecide(\'' + c.id + '\',\'approved\')">Approve</button><button class="ap-btn" onclick="apDecide(\'' + c.id + '\',\'rejected\')">Reject</button></div>' : '')
      + '</div></div>');
  });
  h.push('<textarea id="ap-x-' + pid + '" class="ap-in ap-ta" rows="2" placeholder="Propose a change to this point"></textarea><div class="ap-btns"><button class="ap-btn" onclick="apPropose(\'' + pid + '\')">Propose</button></div></div>');

  // Comments
  var cm = AP.comments.filter(function(c){ return c.point_id === pid; });
  h.push('<div class="ap-sec">Comments</div><div class="ap-card">');
  cm.forEach(function(c){ h.push('<div class="ap-comment"><div class="ap-lbl">Comment &middot; ' + apEsc(apName(c.author_email)) + ' &middot; ' + apDoneDate(c.created_at) + '</div><div>' + apEsc(c.body) + '</div></div>'); });
  h.push('<textarea id="ap-c-' + pid + '" class="ap-in ap-ta" rows="2" placeholder="Add a comment"></textarea><div class="ap-btns"><button class="ap-btn" onclick="apAddComment(\'' + pid + '\')">Comment</button></div></div>');
  return h.join('');
}

// ── The Wednesday email's "Open the plan" button: …/robertos-foh/#actionplan ──
// The app normally opens on the staff page, even when signed in, and a fresh
// sign-in lands on the module grid. So: remember the link here; if nobody is
// signed in, open the sign-in box straight away; once access has loaded
// (loadFohAccess calls apHashOpen) go straight into the plan.
var AP_WANT = false;
try{ AP_WANT = location.hash === '#actionplan'; }catch(e){}
function apHashOpen(){
  if(!AP_WANT || !state || !state.access) return;
  AP_WANT = false;
  try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
  ['foh-public', 'foh-nav'].forEach(function(id){ var el = document.getElementById(id); if(el) el.style.display = 'none'; });
  var lg = document.getElementById('login'); if(lg) lg.classList.remove('open');
  if(typeof fohBlocked === 'function' && fohBlocked('actionplan')){ showManagerLanding(); return; }
  enterApp('actionplan');
}
(function apHashBoot(){
  if(!AP_WANT) return;
  var go = async function(){
    try{
      var r = await sb.auth.getSession();
      if(!(r && r.data && r.data.session) && typeof showLogin === 'function') showLogin();
    }catch(e){}
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(go, 0); }, { once: true });
  else setTimeout(go, 0);
})();

// ── Keep the screen current while it is open ──
// Five people edit the same plan. While the plan is on screen and the tab is
// visible it re-reads every minute and whenever the tab comes back to the front.
// A failed refresh leaves the screen as it was (apLoad silent).
function apAutoRefresh(){
  if(typeof state === 'object' && state.currentTab === 'actionplan' && !document.hidden && AP.loaded && !AP.noAccess && !AP.loading) apLoad(true);
}
setInterval(apAutoRefresh, 60000);
document.addEventListener('visibilitychange', apAutoRefresh);

function apCss(){
  if(document.getElementById('ap-css')) return;
  var s = document.createElement('style'); s.id = 'ap-css';
  s.textContent = [
    '.ap-wrap{max-width:1040px;margin:0 auto;padding:4px 0 40px;font-family:var(--font-sans);color:var(--text)}',
    '.ap-head{background:var(--vino);color:#fff;border-radius:16px;padding:22px 26px;margin-bottom:16px}',
    '.ap-head-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}',
    '.ap-kick{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--gold-light);font-weight:500}',
    '.ap-title{font-family:var(--font-serif);font-size:32px;line-height:1.15;margin-top:6px}',
    '.ap-sub{font-size:14px;color:#EBDCCB;margin-top:6px}',
    '.ap-weekpill{background:var(--gold-light);color:var(--text);border-radius:999px;padding:7px 16px;font-size:14px;font-weight:600;white-space:nowrap}',
    '.ap-weekpill-wait{background:#F3E7C6}',
    '.ap-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:16px}',
    '.ap-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 20px;margin-bottom:14px}',
    '.ap-cards .ap-card{margin-bottom:0}',
    '.ap-lbl{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-light);font-weight:500}',
    '.ap-big{font-family:var(--font-serif);font-size:34px;line-height:1.2;margin:6px 0 8px;color:var(--text)}',
    '.ap-red{color:#B3261E}',
    '.ap-small{font-size:13px;color:var(--text-light);margin-top:4px;line-height:1.5}',
    '.ap-bar{background:#EDE4D6;border-radius:4px;height:8px;overflow:hidden}',
    '.ap-bar div{background:var(--vino);height:8px;border-radius:4px}',
    '.ap-filters{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px}',
    '.ap-chip{border:1px solid var(--border-strong);background:var(--surface);color:var(--text);border-radius:999px;padding:8px 16px;font-size:14px;cursor:pointer;min-height:40px}',
    '.ap-chip.on{background:var(--vino);color:#fff;border-color:var(--vino)}',
    '.ap-group{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-light);font-weight:600;margin:16px 4px 8px}',
    '.ap-list{padding:4px 0}',
    '.ap-row{display:grid;grid-template-columns:40px 1fr 220px 52px 128px;align-items:center;gap:12px;width:100%;background:none;border:0;border-bottom:1px solid var(--border);padding:14px 20px;text-align:left;cursor:pointer;font:inherit;color:inherit;min-height:56px}',
    '.ap-row:last-child{border-bottom:0}.ap-row:hover{background:var(--surface2)}',
    '.ap-num{font-family:var(--font-serif);font-size:22px;color:var(--vino)}',
    '.ap-ptitle{font-size:17px}.ap-pct{font-size:15px;color:var(--text-light)}',
    '.ap-gtag{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-light);margin-top:3px}',
    '.ap-pill{display:inline-block;border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600;white-space:nowrap;text-align:center}',
    '.ap-p-ok{background:#E3F0E6;color:#1E6B3A}.ap-p-done{background:#1E6B3A;color:#fff}.ap-p-soon{background:#FBEFD5;color:#8A5300}.ap-p-late{background:#F8E1E0;color:#A1231B}.ap-p-none{background:#EEE8DE;color:#5C4A36}',
    '.ap-week textarea{margin-top:10px}',
    '.ap-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
    '.ap-btn{border:1px solid var(--border-strong);background:var(--surface);color:var(--vino);border-radius:10px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;min-height:44px}',
    '.ap-btn:disabled{opacity:.55;cursor:default}',
    '.ap-btn-main{background:var(--vino);color:#fff;border-color:var(--vino)}',
    '.ap-in{border:1px solid var(--border-strong);border-radius:8px;padding:9px 10px;font:inherit;font-size:15px;color:var(--text);background:#fff;min-height:42px}',
    '.ap-ta{width:100%;resize:vertical;margin-top:8px}',
    '.ap-back{background:none;border:0;color:var(--vino);font-size:15px;font-weight:600;padding:8px 0 12px;cursor:pointer;min-height:44px}',
    '.ap-goal{font-size:16px;color:var(--text-mid);margin:0 4px 14px;line-height:1.5}',
    '.ap-steps{padding:6px 20px}',
    '.ap-step{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--border)}.ap-step:last-child{border-bottom:0}',
    '.ap-check{width:26px;height:26px;accent-color:#1E6B3A;flex:none;margin-top:2px;cursor:pointer}',
    '.ap-sbody{flex:1;min-width:0}.ap-stitle{font-size:17px}.ap-ssub{font-size:14px;color:var(--text-light);margin-top:3px}',
    '.ap-app{font-size:11px;letter-spacing:.08em;text-transform:uppercase;background:#F3E7C6;color:#7A5A12;border-radius:6px;padding:2px 6px;vertical-align:middle}',
    '.ap-sedit{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}.ap-sedit label,.ap-move label{font-size:13px;color:var(--text-light);display:flex;align-items:center;gap:6px}',
    '.ap-move{background:#FBF3EE;border:1px solid #EBC9C2;border-radius:10px;padding:12px;margin-top:10px}',
    '.ap-sec{font-family:var(--font-serif);font-size:21px;color:var(--vino);margin:20px 4px 10px}',
    '.ap-tablewrap{overflow-x:auto;padding:6px 10px}',
    '.ap-table{width:100%;border-collapse:collapse;font-size:14px;min-width:640px}',
    '.ap-table th{text-align:left;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-light);font-weight:600;padding:10px;border-bottom:1px solid var(--border)}',
    '.ap-table td{padding:12px 10px;border-bottom:1px solid var(--border);vertical-align:top}.ap-table tr:last-child td{border-bottom:0}',
    '.ap-num-in{width:90px}.ap-nodata{color:var(--text-light);font-style:italic}',
    '.ap-wk{padding:10px 0;border-bottom:1px solid var(--border)}.ap-note{margin-top:4px}',
    '.ap-change{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap}',
    '.ap-comment{padding:10px 0;border-bottom:1px solid var(--border)}',
    '.ap-srow{display:flex;gap:12px;align-items:flex-start;padding:12px 20px;border-bottom:1px solid var(--border)}.ap-srow:last-child{border-bottom:0}',
    '.ap-slink{background:none;border:0;text-align:left;font:inherit;color:inherit;cursor:pointer;padding:0;display:flex;flex-direction:column}',
    '.ap-empty{color:var(--text-light)}',
    '.ap-msg-bad{background:#F8E1E0;color:#7E1A14;border-color:#EBC0BC}.ap-msg-ok{background:#E3F0E6;color:#1E5B33;border-color:#BFDCC8}',
    '.ap-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9000;max-width:min(560px,calc(100vw - 32px));border:1px solid;border-radius:12px;padding:12px 18px;font-size:15px;box-shadow:0 6px 24px rgba(44,24,16,.18);display:flex;gap:12px;align-items:center}',
    '.ap-x{background:none;border:0;font-size:22px;line-height:1;color:inherit;cursor:pointer;min-width:32px;min-height:32px}',
    '.ap-plan-head{font-size:15px}',
    '.ap-badge{display:inline-block;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600;letter-spacing:.02em}',
    '.ap-auto{background:#E3EEF5;color:#1F4E6B}.ap-man{background:#FBEFD5;color:#7A4B00}',
    '.ap-numhead{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}',
    '.ap-numtable{min-width:900px}.ap-linkbtn{background:none;border:0;padding:0;font:inherit;color:var(--vino);cursor:pointer;text-align:left}',
    '.ap-more{margin-top:18px;padding:0 4px}.ap-more summary{cursor:pointer;color:var(--text-light);font-size:14px;min-height:40px;display:flex;align-items:center}',
    '@media (max-width:820px){.ap-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.ap-row{grid-template-columns:32px 1fr auto;grid-template-areas:"n t p" "n b s"}.ap-num{grid-area:n}.ap-ptitle{grid-area:t}.ap-pct{grid-area:p;text-align:right}.ap-rowbar{grid-area:b}.ap-row .ap-pill{grid-area:s;justify-self:end}.ap-title{font-size:26px}}',
    '@media (max-width:480px){.ap-head{padding:18px}.ap-card{padding:14px 16px}.ap-big{font-size:28px}.ap-row{padding:12px 14px;grid-template-columns:28px 1fr auto}.ap-steps{padding:4px 14px}}'
  ].join('\n');
  document.head.appendChild(s);
}
