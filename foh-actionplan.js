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

var AP = { loaded: false, loading: false, noAccess: false, err: null, open: null, filter: 'dash',
           settings: null, points: [], steps: [], measures: [], snaps: [], results: [], comments: [], changes: [], weeks: [],
           busy: {}, moving: null, msg: null, refreshing: false };

var AP_NAMES = { 'fguarracino@robertos.ae': 'Francesco', 'onafid@robertos.ae': 'Ouafaa', 'akadrie@skelmore.com': 'Amin', 'justin@skelmore.com': 'Justin', 'asacchi@skelmore.com': 'Andrea', 'ndragan@robertos.ae': 'Nicole' };
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
      sb.from('ap_snapshots').select('*').order('week_start', { ascending: false }).limit(5000),
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
    AP.settings = r[0].data[0]; AP.points = r[1].data; AP.steps = r[2].data; AP.measures = r[3].data.filter(function(m){ return !m.hidden; });   // hidden = taken off the plan, kept in the table
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
  AP.askChanges = false;
  AP.weeks = AP.weeks.filter(function(w){ return w.week_start !== r.data[0].week_start; }); AP.weeks.unshift(r.data[0]); apSay(status === 'approved' ? 'Week approved' : 'Changes requested');
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
  if(AP.err) return '<div class="ap-wrap"><div class="ap-sheet"><div class="ap-card ap-msg-bad">The plan could not be read: ' + apEsc(AP.err) + ' <button class="ap-btn" onclick="AP.err=null;apLoad()">Try again</button></div></div></div>';
  if(!AP.loaded) return '<div class="ap-wrap"><div class="ap-sheet"><div class="loading">Reading the plan&hellip;</div></div></div>';
  if(AP.noAccess) return '<div class="ap-wrap"><div class="ap-head"><div class="ap-kick">FOH App &middot; Executive</div><div class="ap-title">No access</div>'
    + '<div class="ap-sub">The Roberto\'s 3.0 action plan is private. Your login is not on its list &mdash; ask Francesco if you should be.</div></div></div>';
  // Errors stay until closed; a "Saved" goes by itself.
  var msg = AP.msg ? '<div class="ap-toast ' + (AP.msg.bad ? 'ap-msg-bad' : 'ap-msg-ok') + '" role="status">' + apEsc(AP.msg.text)
    + (AP.msg.bad ? ' <button class="ap-x" onclick="apDismiss()" aria-label="Close">&times;</button>' : '') + '</div>' : '';
  return '<div class="ap-wrap">' + apOwnersList() + '<div class="ap-sheet">' + (AP.open ? apPointPage(AP.open, '') : apOverview('')) + '</div>' + msg + '</div>';
}

// The plan week: Monday–Sunday, numbered from ap_settings.plan_start.
function apWeekInfo(){
  var wk = apMonday(apToday()), start = (AP.settings && AP.settings.plan_start) || wk;
  var n = Math.floor((Date.parse(wk) - Date.parse(start)) / (7 * 86400e3)) + 1;
  var end = apAdd(wk, 6), a = new Date(wk + 'T12:00:00Z'), b = new Date(end + 'T12:00:00Z');
  var range = a.getUTCMonth() === b.getUTCMonth() ? a.getUTCDate() + '–' + apDate(end) : apDate(wk) + ' – ' + apDate(end);
  return { wk: wk, n: n, range: range, start: start, w: AP.weeks.filter(function(x){ return x.week_start === wk; })[0] };
}
function apWeekPill(){
  var W = apWeekInfo(), w = W.w;
  var st = w ? ({ approved: 'approved', changes: 'changes asked', pending: 'awaiting approval' }[w.status]) : 'awaiting approval';
  return '<span class="ap-weekpill' + (w && w.status === 'approved' ? '' : ' ap-weekpill-wait') + '">' + (W.n >= 1 ? 'Week ' + W.n : 'Before week 1') + ' &middot; ' + st + '</span>';
}
// One slim line: which week, whether it is approved. Amin (ap_settings.approver)
// gets the two buttons; the note box opens only when he asks for changes.
function apApproveBar(){
  var W = apWeekInfo(), w = W.w, who = apName((AP.settings && AP.settings.approver) || '');
  var txt = W.n >= 1 ? '<b>Week ' + W.n + '</b> &middot; ' + W.range + ' &middot; ' : '<b>Before week 1</b> &middot; the plan starts ' + apDate(W.start) + ' &middot; ';
  if(w && w.status === 'approved') txt += 'approved by ' + apEsc(apName(w.approved_by)) + ', ' + apDoneDate(w.approved_at) + (w.note ? ' &mdash; &ldquo;' + apEsc(w.note) + '&rdquo;' : '');
  else if(w && w.status === 'changes') txt += '<span class="ap-red">changes asked</span> by ' + apEsc(apName(w.approved_by)) + ', ' + apDoneDate(w.approved_at) + (w.note ? ' &mdash; &ldquo;' + apEsc(w.note) + '&rdquo;' : '');
  else txt += 'waiting for ' + apEsc(who) + '\'s approval';
  var btns = '';
  if(apIsApprover() && !(w && w.status === 'approved')){
    btns = AP.askChanges
      ? '<div class="ap-ab-ask"><input id="ap-week-note" class="ap-in" placeholder="What needs to change?" autocomplete="off"><button class="btn-q" onclick="AP.askChanges=false;apRepaint()">Cancel</button><button class="btn-q main" onclick="apWeek(\'changes\')">Send</button></div>'
      : '<div class="ap-ab-btns"><button class="btn-q" onclick="AP.askChanges=true;apRepaint();setTimeout(function(){var e=document.getElementById(\'ap-week-note\');if(e)e.focus();},0)">Request changes</button><button class="btn-q main" onclick="apWeek(\'approved\')">Approve week</button></div>';
  }
  return '<div class="ap-approve"><div>' + txt + '</div>' + btns + '</div>';
}

function apOverview(msg){
  var all = AP.steps, done = all.filter(function(s){ return s.done_at; }).length, pct = apPct(all);
  var late = all.filter(apStepLate).length;
  var since = new Date(Date.now() - 7 * 86400e3).toISOString();
  var thisWeek = all.filter(function(s){ return s.done_at && s.done_at >= since && s.done_by !== 'seed'; }).length;
  var rel = (AP.settings && AP.settings.relaunch_date) || '2026-11-02';
  var days = Math.round((Date.parse(rel) - Date.parse(apToday())) / 86400e3);
  var members = ((AP.settings && AP.settings.members) || []).map(apName).join(' &middot; ');
  var h = [];
  h.push('<div class="ap-head"><div class="ap-head-row"><div><div class="ap-kick">FOH App &middot; Executive</div><div class="ap-title">Roberto\'s 3.0 action plan</div>'
    + '<div class="ap-sub">Private: ' + members + '</div></div>' + apWeekPill() + '</div></div>');
  h.push(msg);
  h.push('<div class="ap-kpis">'
    + '<div class="ap-kpi"><div class="l">Plan progress</div><div class="v">' + pct + '%</div>' + apBar(pct) + '</div>'
    + '<div class="ap-kpi"><div class="l">Steps done</div><div class="v">' + done + ' / ' + all.length + '</div><div class="s">' + thisWeek + ' this week</div></div>'
    + '<div class="ap-kpi"><div class="l">Late</div><div class="v' + (late ? ' ap-red' : '') + '">' + late + '</div><div class="s">steps past their date</div></div>'
    + '<div class="ap-kpi"><div class="l">Relaunch</div><div class="v">' + apDate(rel) + '</div><div class="s">'
    + (days > 0 ? days + ' day' + (days === 1 ? '' : 's') + ' to go' : (days === 0 ? 'today' : 'done')) + '</div></div></div>');
  h.push(apApproveBar());
  var f = AP.filter;
  var tab = (f === 'all' || f === 'mine' || f === 'late' || f === 'week') ? 'points' : f;
  h.push('<div class="ap-tabs" role="tablist">' + [['dash', 'Dashboard'], ['points', 'Points'], ['plan', 'Owners &amp; dates'], ['numbers', 'Data']].map(function(x){
    return '<button role="tab" class="' + (tab === x[0] ? 'on' : '') + '" onclick="apFilter(\'' + (x[0] === 'points' ? 'all' : x[0]) + '\')">' + x[1] + '</button>'; }).join('') + '</div>');
  if(tab === 'points'){
    h.push('<div class="ap-subtabs">' + [['all', 'All'], ['mine', 'My steps'], ['late', 'Late'], ['week', 'This week']].map(function(x){
      return '<button class="' + (f === x[0] ? 'on' : '') + '" onclick="apFilter(\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('') + '</div>');
    if(f === 'all'){
      h.push('<div class="ap-card ap-list">');
      AP.points.slice().sort(function(a, b){ return a.num - b.num; }).forEach(function(p){
        var st = apPointSteps(p.id), pc = apPct(st);
        h.push('<button class="ap-row" onclick="apOpen(\'' + p.id + '\')"><span class="ap-num">' + p.num + '</span><span class="ap-ptitle">' + apEsc(p.title)
          + '<span class="ap-gtag">' + apEsc(p.group) + '</span></span>'
          + '<span class="ap-rowbar">' + apBar(pc) + '</span><span class="ap-pct">' + pc + '%</span>' + apPill(apPointStatus(st)) + '</button>');
      });
      h.push('</div>');
    } else h.push(apStepList(f));
  } else if(f === 'dash'){
    h.push(apDashboard());
  } else if(f === 'numbers'){
    h.push(apNumbersView() + apAdminStrip());
  } else if(f === 'plan'){
    h.push(apPlanList());
  }
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
// ── Data ─────────────────────────────────────────────────────────────────
// Every figure in the plan, pulled whenever someone opens it. Three groups, so
// the live figures are not buried under measures that do not exist yet:
//   Live      — automatic and read at least once (a night with no closing
//               report shows "No data", never 0)
//   Typed in  — no system holds it; a plan member types it, the app says who
//   Coming    — automatic, but its module or its date has not arrived
function apMeasureKind(m){
  if(m.input !== 'auto') return 'manual';
  return m.updated_at ? 'live' : 'coming';
}
function apValue(m){
  if(m.current == null) return null;
  return apNumText(m, Number(m.current));
}
// One number in its unit. Money (point 7 from 19 Oct 2026) reads AED 25.0k.
function apNumText(m, v){
  var u = m.unit;
  if(u === 'AED') return 'AED ' + (Math.round(v / 100) / 10).toFixed(1) + 'k';
  return u === '%' ? (Math.round(v * 10) / 10) + '%' : (u === 'rating' ? v.toFixed(1) : String(Math.round(v * 10) / 10));
}
// One figure as a card. withPoint: show which of the 10 points it belongs to.
function apMeasureCard(m, withPoint){
  var kind = apMeasureKind(m), p = withPoint ? AP.points.filter(function(x){ return x.id === m.point_id; })[0] : null;
  var tag = kind === 'manual' ? '<span class="ap-mtag ap-tag-man">Typed in</span>' : '<span class="ap-mtag ap-tag-auto">Automatic</span>';
  var val = apValue(m), body;
  if(kind === 'manual'){
    body = '<div class="ap-mval"><input class="ap-in ap-mval-in" inputmode="decimal" value="' + (m.current == null ? '' : m.current) + '" placeholder="&mdash;" onchange="apSetManual(\'' + m.id + '\',this.value)" aria-label="' + apEsc(m.label) + '"></div>'
      + (m.current_label ? '<div class="ap-mctx">' + apEsc(m.current_label) + '</div>' : '');
  } else {
    body = val == null ? '<div class="ap-mval ap-mval-none">No data</div><div class="ap-mctx">' + apEsc(m.current_label || '') + '</div>'
      : '<div class="ap-mval">' + val + '</div>' + (m.current_label ? '<div class="ap-mctx">' + apEsc(m.current_label) + '</div>' : '') + apChartSVG(m);
  }
  var src = kind === 'manual'
    ? (m.updated_by ? 'Typed in by ' + apEsc(apName(m.updated_by)) + ' &middot; ' + apAgo(m.updated_at) : 'Not typed in yet') + ' &middot; ' + apEsc((m.frequency || '').toLowerCase())
    : apEsc(m.source || '') + ' &middot; ' + apEsc((m.frequency || '').toLowerCase()) + ' &middot; read ' + apAgo(m.updated_at);
  return '<div class="ap-mcard">'
    + '<div class="ap-mtop">' + (p ? '<button class="ap-mpoint" onclick="apOpen(\'' + p.id + '\')">' + p.num + ' &middot; ' + apEsc(p.title) + '</button>' : '<span></span>') + tag + '</div>'
    + '<div class="ap-mlabel">' + apEsc(m.label) + '</div>' + body
    + '<div class="ap-mfoot"><div><span>Target</span><b>' + apEsc(m.target || '&mdash;') + '</b></div><div><span>Baseline</span><b>' + apEsc(m.baseline || '&mdash;') + '</b></div></div>'
    + '<div class="ap-msrc">' + src + '</div></div>';
}
function apComingRow(m, withPoint){
  var p = AP.points.filter(function(x){ return x.id === m.point_id; })[0];
  return '<div class="ap-crow"><div><div class="ap-clabel">' + apEsc(m.label) + '</div>'
    + (withPoint && p ? '<div class="ap-small">' + p.num + ' &middot; ' + apEsc(p.title) + ' &middot; target ' + apEsc(m.target || '&mdash;') + '</div>' : '<div class="ap-small">Target ' + apEsc(m.target || '&mdash;') + '</div>') + '</div>'
    + '<div class="ap-cwhen">' + apEsc(m.current_label || 'Not available yet') + '</div></div>';
}
function apMeasureBlock(list, withPoint){
  var live = list.filter(function(m){ return apMeasureKind(m) === 'live'; });
  var man = list.filter(function(m){ return apMeasureKind(m) === 'manual'; });
  var coming = list.filter(function(m){ return apMeasureKind(m) === 'coming'; });
  var h = [];
  if(live.length) h.push((withPoint ? '<div class="ap-dsec">Live figures</div>' : '') + '<div class="ap-mgrid">' + live.map(function(m){ return apMeasureCard(m, withPoint); }).join('') + '</div>');
  if(man.length) h.push((withPoint ? '<div class="ap-dsec">Typed in</div>' : '') + '<div class="ap-mgrid">' + man.map(function(m){ return apMeasureCard(m, withPoint); }).join('') + '</div>');
  if(coming.length) h.push('<div class="ap-dsec">Coming soon</div><div class="ap-card ap-coming">' + coming.map(function(m){ return apComingRow(m, withPoint); }).join('') + '</div>');
  return h.join('');
}
function apNumbersView(){
  var t = apAutoRead();
  var ordered = [];
  AP.points.slice().sort(function(a, b){ return a.num - b.num; }).forEach(function(p){
    AP.measures.filter(function(m){ return m.point_id === p.id; }).forEach(function(m){ ordered.push(m); });
  });
  var h = ['<div class="ap-datahead"><div><div class="ap-dtitle">Data</div>'
    + '<div class="ap-small">Live figures read ' + apAgo(t) + ' &middot; they refresh by themselves when the plan opens</div></div>'
    + '<button class="ap-btn" ' + (AP.refreshing ? 'disabled' : '') + ' onclick="apCallWeekly(\'refresh\')">' + (AP.refreshing === 'refresh' ? 'Reading&hellip;' : 'Refresh') + '</button></div>'];
  h.push(apMeasureBlock(ordered, true));
  h.push('<details class="ap-more"><summary>What is automatic and what is typed in</summary><div class="ap-small">'
    + '<b>Automatic</b>: the app reads it itself &mdash; SevenRooms (guests booked ahead, channels, guests coming back), the closing report (Monday and Sunday revenue and guests) and, as each module arrives, the FOH App (SOP sign-off, training, the audit score). Nobody types these. They refresh when the plan opens if they are over 3 hours old, and every Wednesday before the email.<br>'
    + '<b>Typed in</b>: roles filled, catering requests, and press and Instagram for the relaunch (Nicole) &mdash; no system holds them, so a plan member types the number and the app records who and when.<br>'
    + '<b>Steps, owners, dates, comments and approvals</b> are always people.</div></details>');
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
  if(p.lead) h.push('<div class="ap-lead"><span>Lead</span>' + apEsc(p.lead) + '</div>');
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
  h.push('<div class="ap-sec">How we check</div>' + apMeasureBlock(ms, false));

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
      return apEsc(m ? m.label : '') + ': <b>' + (s.value == null ? 'No data' : m ? apNumText(m, Number(s.value)) : String(Math.round(Number(s.value) * 10) / 10)) + '</b>';
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

// ── DASHBOARD (18 Oct 2026) ─────────────────────────────────────────────────
// Francesco: Amin is data-driven — one screen, everything about THIS plan and
// its 10 points, easy to pull and download, with graphs and notes. Nothing
// here is a business-wide figure: every number belongs to one of the points.
// Each point: progress, status, next step, its figures with a trend line
// against target and baseline, what is still coming, and the latest note.
// The same chart geometry draws the screen (SVG), the PDF (SVG) and the Excel
// images (canvas), so the three can never show different lines.

// A figure's target and baseline as numbers, read from their own text, so
// nothing is typed twice. null when the target is words ("Up every week").
function apTargetNum(m){
  var t = String(m.target || ''), r = t.match(/^\s*([\d.]+)\s*%?\s*(\([^)]*\))?\s*$/);
  if(r) return Number(r[1]);
  // money: the first figure is the next target ("AED 30k by end Nov · 50k by Dec" = 30000)
  r = m.unit === 'AED' && t.match(/([\d.]+)\s*k\b/i);
  if(r) return Number(r[1]) * 1000;
  r = t.match(/\(([^)]*?)([\d.]+)%?\)/);
  return r ? Number(r[2]) : null;
}
function apBaseNum(m){ var r = String(m.baseline || '').match(/(\d+(?:\.\d+)?)(\s*k\b)?/i); return r ? Number(r[1]) * (r[2] ? 1000 : 1) : null; }
// Stored weekly (or monthly) figures, oldest first. Closed nights stay in as gaps.
function apHist(m){
  return AP.snaps.filter(function(s){ return s.measure_id === m.id && !(s.detail && s.detail.superseded); })
    .sort(function(a, b){ return a.week_start < b.week_start ? -1 : 1; })
    .map(function(s){ return { d: s.week_start, v: s.value == null ? null : Number(s.value), closed: !!(s.detail && s.detail.closed), label: s.label || '' }; });
}
function apMonthly(m){ return /month/i.test(m.frequency || ''); }
function apPointLabel(m, d){
  var x = new Date(d + 'T12:00:00Z');
  return apMonthly(m) ? x.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : apDate(d);
}
// Better = moving towards the target from the baseline.
// Monday and Sunday guests: the baseline is an AVERAGE of many nights, so one
// night is compared like-for-like only through an average too — the change is
// worked on the last 4 nights recorded (18 Oct 2026: a single 97 read "▲ 31",
// the last-4 average of 76 is "▲ 10").
var AP_AVG4 = { monday_guests: 1, sunday_guests: 1, monday_net: 1, sunday_net: 1 };
function apAvg4(m){
  var vals = apHist(m).filter(function(h){ return h.v != null; }).map(function(h){ return h.v; }).slice(-4);
  return vals.length ? { avg: Math.round(vals.reduce(function(a, b){ return a + b; }, 0) / vals.length), n: vals.length } : null;
}
function apDelta(m){
  var v = m.current == null ? null : Number(m.current), b = apBaseNum(m), t = apTargetNum(m), basis = '';
  if(AP_AVG4[m.key]){ var a4 = apAvg4(m); if(a4){ v = a4.avg; basis = (a4.n === 1 ? '1 night' : 'last ' + a4.n + ' avg ' + apNumText(m, a4.avg)) + ' · '; } }
  if(v == null || b == null || m.unit === 'text') return null;
  var diff = Math.round((v - b) * 10) / 10;
  var lowerBetter = (t != null) ? t < b : false;
  var good = diff === 0 ? null : (lowerBetter ? diff < 0 : diff > 0);
  return { diff: diff, good: good, text: basis + (diff === 0 ? 'same as baseline' : (diff > 0 ? '▲ ' : '▼ ') + apDiffText(m, diff) + ' vs baseline') };
}
function apDiffText(m, diff){
  var a = Math.abs(diff);
  return m.unit === 'AED' ? (Math.round(a / 100) / 10).toFixed(1) + 'k' : a + (m.unit === '%' ? ' pts' : '');
}
function apChartGeom(m, W, H){
  var hs = apHist(m);
  while(hs.length && hs[0].v == null) hs.shift();   // start at the first recorded value
  var vals = hs.filter(function(p){ return p.v != null; }).map(function(p){ return p.v; });
  if(vals.length < 2) return null;
  var t = apTargetNum(m), b = apBaseNum(m), all = vals.slice();
  if(t != null) all.push(t); if(b != null) all.push(b);
  var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo) * 0.12 || 1;
  lo = Math.max(0, lo - pad); hi = hi + pad;
  var L = 8, R = 8, T = 12, B = 18, n = hs.length;
  var X = function(i){ return L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)); };
  var Y = function(v){ return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
  return { pts: hs.map(function(p, i){ return { x: X(i), y: p.v == null ? null : Y(p.v), v: p.v, d: p.d, closed: p.closed }; }),
           tY: t == null ? null : Y(t), bY: b == null ? null : Y(b), W: W, H: H, B: B, first: hs[0].d, last: hs[n - 1].d };
}
function apChartSVG(m){
  var g = apChartGeom(m, 320, 96); if(!g) return '';
  var seg = [], cur = [];
  g.pts.forEach(function(p){ if(p.y == null){ if(cur.length) seg.push(cur); cur = []; } else cur.push(p.x.toFixed(1) + ',' + p.y.toFixed(1)); });
  if(cur.length) seg.push(cur);
  var last = null; g.pts.forEach(function(p){ if(p.y != null) last = p; });
  var s = '<svg class="ap-chart" viewBox="0 0 ' + g.W + ' ' + g.H + '" preserveAspectRatio="none" role="img" aria-label="' + apEsc(m.label) + ' trend">';
  if(g.bY != null) s += '<line x1="8" x2="' + (g.W - 8) + '" y1="' + g.bY.toFixed(1) + '" y2="' + g.bY.toFixed(1) + '" class="ap-ch-base"/>';
  if(g.tY != null) s += '<line x1="8" x2="' + (g.W - 8) + '" y1="' + g.tY.toFixed(1) + '" y2="' + g.tY.toFixed(1) + '" class="ap-ch-target"/>';
  seg.forEach(function(pp){ s += pp.length > 1 ? '<polyline points="' + pp.join(' ') + '" class="ap-ch-line"/>' : ''; });
  g.pts.forEach(function(p){ if(p.y != null) s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (p === last ? 3.4 : 2) + '" class="' + (p === last ? 'ap-ch-last' : 'ap-ch-dot') + '"/>'; });
  s += '<text x="8" y="' + (g.H - 4) + '" class="ap-ch-x">' + apEsc(apPointLabel(m, g.first)) + '</text>';
  s += '<text x="' + (g.W - 8) + '" y="' + (g.H - 4) + '" text-anchor="end" class="ap-ch-x">' + apEsc(apPointLabel(m, g.last)) + '</text></svg>';
  return s + '<div class="ap-ch-key"><span class="k-line"></span>actual' + (g.tY != null ? '<span class="k-target"></span>target' : '') + (g.bY != null ? '<span class="k-base"></span>baseline' : '') + '</div>';
}
function apNextStep(p){
  var open = apPointSteps(p.id).filter(function(s){ return !s.done_at; });
  var dated = open.filter(function(s){ return s.due_date; }).sort(function(a, b){ return a.due_date < b.due_date ? -1 : 1; });
  return dated[0] || open[0] || null;
}
function apFigureBlock(m){
  var kind = apMeasureKind(m), v = apValue(m), dl = apDelta(m);
  return '<div class="ap-dfig"><div class="ap-dfig-top"><div class="ap-dfig-label">' + apEsc(m.label) + '</div>'
    + (kind === 'manual' ? '<span class="ap-mtag ap-tag-man">Typed in</span>' : '') + '</div>'
    + '<div class="ap-dfig-row"><div class="ap-dfig-val' + (v == null ? ' ap-mval-none' : '') + '">' + (v == null ? (kind === 'manual' ? '&mdash;' : 'No data') : v) + '</div>'
    + (dl ? '<div class="ap-delta ' + (dl.good === true ? 'good' : dl.good === false ? 'bad' : '') + '">' + dl.text + '</div>' : '') + '</div>'
    + (m.current_label ? '<div class="ap-mctx">' + apEsc(m.current_label) + '</div>' : '')
    + apChartSVG(m)
    + '<div class="ap-dfig-foot">Target <b>' + apEsc(m.target || '—') + '</b> &middot; Baseline <b>' + apEsc(m.baseline || '—') + '</b></div>'
    + '<div class="ap-msrc">' + (kind === 'manual' ? (m.updated_by ? 'Typed in by ' + apEsc(apName(m.updated_by)) + ' &middot; ' + apAgo(m.updated_at) : 'Not typed in yet')
        : apEsc(m.source || '') + ' &middot; ' + apEsc((m.frequency || '').toLowerCase()) + ' &middot; read ' + apAgo(m.updated_at)) + '</div></div>';
}
// One line per figure for the closed card: name, value, change. Nothing else.
function apFigureLine(m){
  var kind = apMeasureKind(m), v = apValue(m), dl = apDelta(m);
  return '<div class="ap-fline"><span class="ap-fl-lbl">' + apEsc(m.label) + '</span>'
    + '<span class="ap-fl-val">' + (v == null ? (kind === 'manual' ? '&mdash;' : 'No data') : v) + '</span>'
    + (dl ? '<span class="ap-delta ' + (dl.good === true ? 'good' : dl.good === false ? 'bad' : '') + '">' + dl.text + '</span>' : '<span></span>') + '</div>';
}
// The card stays short: title, status, progress, next step, one line per
// figure. Tapping it opens the detail in place — charts, target and baseline,
// source, what is coming, the latest note (Francesco 18 Oct: "keep the initial
// screen clean and tidy; if you click it gives the info"). Print = expanded.
function apDashToggle(pid){ AP.dashOpen = AP.dashOpen || {}; AP.dashOpen[pid] = !AP.dashOpen[pid]; apRepaint(); }
function apDashTile(p, forceOpen){
  var open = forceOpen || !!(AP.dashOpen && AP.dashOpen[p.id]);
  var st = apPointSteps(p.id), pc = apPct(st), done = st.filter(function(s){ return s.done_at; }).length;
  var nx = apNextStep(p), late = st.filter(apStepLate).length;
  var ms = AP.measures.filter(function(m){ return m.point_id === p.id; });
  var figs = ms.filter(function(m){ return apMeasureKind(m) !== 'coming'; });
  var coming = ms.filter(function(m){ return apMeasureKind(m) === 'coming'; });
  var note = AP.results.filter(function(r){ return r.point_id === p.id; })[0];
  var cm = AP.comments.filter(function(c){ return c.point_id === p.id; })[0];
  var h = '<div class="ap-tile' + (open ? ' open' : '') + '">'
    + '<button class="ap-tile-hit" onclick="apDashToggle(\'' + p.id + '\')" aria-expanded="' + open + '">'
    + '<span class="ap-tile-head"><span class="ap-tile-title"><span class="ap-num">' + p.num + '</span>' + apEsc(p.title) + '</span>' + apPill(apPointStatus(st)) + '</span>'
    + '<span class="ap-tile-prog">' + apBar(pc) + '<span>' + pc + '% &middot; ' + done + '/' + st.length + (late ? ' &middot; <b class="ap-red">' + late + ' late</b>' : '') + '</span></span>'
    + '<span class="ap-tile-next">' + (nx ? 'Next: ' + apEsc(nx.title) + (nx.due_date ? ' &middot; ' + (apStepLate(nx) ? '<b class="ap-red">was due ' + apDate(nx.due_date) + '</b>' : apDate(nx.due_date)) : '') : 'All steps done') + '</span>'
    + (figs.length ? '<span class="ap-tile-lines">' + figs.map(apFigureLine).join('') + '</span>' : '')
    + '<span class="ap-tile-more">' + (open ? 'Less ▴' : 'Details ▾') + '</span></button>';
  if(open){
    h += '<div class="ap-tile-detail">'
      + (nx ? '<div class="ap-tile-next2">Next step: <b>' + apEsc(nx.title) + '</b> &middot; ' + (nx.owner ? apEsc(nx.owner) : '<i>no owner</i>') + ' &middot; ' + (nx.due_date ? (apStepLate(nx) ? '<b class="ap-red">was due ' + apDate(nx.due_date) + '</b>' : 'due ' + apDate(nx.due_date)) : '<i>no date</i>') + '</div>' : '')
      + (figs.length ? '<div class="ap-tile-figs">' + figs.map(apFigureBlock).join('') + '</div>' : '')
      + (coming.length ? '<div class="ap-tile-coming">Coming: ' + coming.map(function(m){ return apEsc(m.label) + ' <i>(' + apEsc(m.current_label || 'not available yet') + ')</i>'; }).join(' &middot; ') + '</div>' : '')
      + (note ? '<div class="ap-tile-note"><span>Week of ' + apDate(note.week_start) + ' &middot; ' + apEsc(apName(note.author_email)) + '</span>' + apEsc(note.note) + '</div>'
        : cm ? '<div class="ap-tile-note"><span>Comment &middot; ' + apEsc(apName(cm.author_email)) + ' &middot; ' + apDoneDate(cm.created_at) + '</span>' + apEsc(cm.body) + '</div>' : '')
      + (forceOpen ? '' : '<button class="ap-linkbtn ap-tile-open" onclick="apOpen(\'' + p.id + '\')">Open point ' + p.num + ' &rsaquo;</button>')
      + '</div>';
  }
  return h + '</div>';
}
function apDashboard(){
  var pts = AP.points.slice().sort(function(a, b){ return a.num - b.num; });
  var h = ['<div class="ap-secbar"><div><div class="ap-sect">The 10 points</div><div class="ap-secsub">Tap a card for its charts and notes &middot; figures read ' + apAgo(apAutoRead()) + '</div></div>'
    + '<div class="ap-ab-btns"><button class="btn-q" ' + (AP.busyDl ? 'disabled' : '') + ' onclick="apExcel()">' + (AP.busyDl === 'xlsx' ? 'Building&hellip;' : 'Download Excel') + '</button>'
    + '<button class="btn-q" onclick="apPdf()">PDF</button></div></div>'];
  h.push('<div class="ap-cgrid">' + pts.map(apCard).join('') + '</div>');
  return h.join('');
}
// ── The card (mock-up B): every card the same size, the same four slots ──
//   title + status · progress · next step · one figure (or what is coming)
function apSpark(m){
  var hs = apHist(m); while(hs.length && hs[0].v == null) hs.shift();
  var vals = hs.filter(function(x){ return x.v != null; }).map(function(x){ return x.v; });
  if(vals.length < 2) return '';
  var t = apTargetNum(m), b = apBaseNum(m), all = vals.slice(); if(t != null) all.push(t); if(b != null) all.push(b);
  var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
  var W = 84, H = 28, n = hs.length;
  var X = function(i){ return 3 + i * (W - 6) / (n - 1); }, Y = function(v){ return 3 + (H - 6) * (1 - (v - lo) / (hi - lo)); };
  var seg = [], cur = [], last = null;
  hs.forEach(function(x, i){ if(x.v == null){ if(cur.length) seg.push(cur); cur = []; } else { cur.push(X(i).toFixed(1) + ',' + Y(x.v).toFixed(1)); last = [X(i), Y(x.v)]; } });
  if(cur.length) seg.push(cur);
  return '<svg class="ap-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">'
    + (t != null ? '<line x1="2" x2="' + (W - 2) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '" stroke="#C9A84C" stroke-dasharray="4 3" stroke-width="1"/>' : '')
    + seg.map(function(pp){ return pp.length > 1 ? '<polyline points="' + pp.join(' ') + '" fill="none" stroke="#6B1F2A" stroke-width="1.6"/>' : ''; }).join('')
    + (last ? '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.4" fill="#6B1F2A"/>' : '') + '</svg>';
}
function apCardValue(m){
  if(m.input !== 'auto'){
    var of = String(m.target || '').match(/of\s+(\d+)/);
    return m.current == null ? '&mdash;' : (of ? Number(m.current) + ' of ' + of[1] : apValue(m));
  }
  if(AP_AVG4[m.key]){ var a4 = apAvg4(m); if(a4) return apNumText(m, a4.avg); }
  var v = apValue(m); return v == null ? 'No data' : v;
}
function apCardLabel(m){
  var l = m.short_label || m.label;
  if(m.key === 'visits3' && m.detail && m.detail.month) l += ' (' + new Date(m.detail.month + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }) + ')';
  return l;
}
function apCardFigure(p){
  var ms = AP.measures.filter(function(m){ return m.point_id === p.id; }).sort(function(a, b){ return (a.sort || 0) - (b.sort || 0); });
  var shown = ms.filter(function(m){ return apMeasureKind(m) !== 'coming'; });
  if(!shown.length){
    var coming = ms.filter(function(m){ return apMeasureKind(m) === 'coming'; });
    var t = coming.map(function(m){ return apEsc(m.short_label || m.label) + ' &middot; ' + apEsc(m.available_from || m.current_label || 'not yet'); }).join(' &middot; ');
    return '<span class="ap-cfig none">' + (t || 'No figure for this point') + '</span>';
  }
  var m = shown[0], two = shown[1], dl = apDelta(m);
  var d = m.input !== 'auto' ? '<span class="ap-cd muted">typed in</span>'
    : dl ? '<span class="ap-cd ' + (dl.good === true ? 'good' : dl.good === false ? 'bad' : 'muted') + '">' + (dl.diff === 0 ? '=' : (dl.diff > 0 ? '▲ ' : '▼ ') + apDiffText(m, dl.diff)) + '</span>' : '';
  var extra = two ? ' <span class="ap-c2">+ ' + apEsc(two.short_label || two.label) + ' ' + (apValue(two) == null ? '&mdash;' : apValue(two)) + '</span>' : '';
  return '<span class="ap-cfig"><span class="ap-cfig-l"><span class="t">' + apEsc(apCardLabel(m)) + extra + '</span><span class="v">' + apCardValue(m) + ' ' + d + '</span></span>' + apSpark(m) + '</span>';
}
function apCard(p){
  var st = apPointSteps(p.id), pc = apPct(st), done = st.filter(function(s){ return s.done_at; }).length, nx = apNextStep(p);
  var sub = nx ? (nx.owner ? apEsc(nx.owner) : 'No owner') + ' &middot; ' + (nx.due_date ? (apStepLate(nx) ? '<b class="ap-red">was due ' + apDate(nx.due_date) + '</b>' : 'due ' + apDate(nx.due_date)) : 'no date') : '';
  return '<button class="ap-c" onclick="apOpen(\'' + p.id + '\')" aria-label="Point ' + p.num + ': ' + apEsc(p.title) + '">'
    + '<span class="ap-c-top"><span class="ap-c-title"><span class="ap-num">' + p.num + '</span>' + apEsc(p.title) + '</span>' + apPill(apPointStatus(st)) + '</span>'
    + '<span class="ap-c-prog">' + apBar(pc) + '<span>' + pc + '% &middot; ' + done + '/' + st.length + '</span></span>'
    + '<span class="ap-c-next">' + (nx ? 'Next: ' + apEsc(nx.title) + '<small>' + sub + '</small>' : 'All steps done<small>&nbsp;</small>') + '</span>'
    + apCardFigure(p) + '</button>';
}

// ── Excel: summary, steps, figures, history, charts and notes ──────────────
function apStepStatus(s){ return s.done_at ? 'Done' : apStepLate(s) ? 'Late' : apStepSoon(s) ? 'Due this week' : s.due_date ? 'Open' : 'No date'; }
function apChartPNG(m){
  var g = apChartGeom(m, 640, 240); if(!g) return null;
  var c = document.createElement('canvas'); c.width = 640; c.height = 270;
  var x = c.getContext('2d'); x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, 640, 270);
  x.font = 'bold 15px Arial'; x.fillStyle = '#6B1F2A'; x.fillText(m.label, 10, 20);
  x.save(); x.translate(0, 26);
  var line = function(y, col, dash){ if(y == null) return; x.setLineDash(dash || []); x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); x.moveTo(8, y); x.lineTo(632, y); x.stroke(); x.setLineDash([]); };
  line(g.bY, '#B9A58C', [3, 4]); line(g.tY, '#C9A84C', [7, 5]);
  x.strokeStyle = '#6B1F2A'; x.lineWidth = 2.5; x.beginPath(); var on = false;
  g.pts.forEach(function(p){ if(p.y == null){ on = false; return; } if(!on){ x.moveTo(p.x, p.y); on = true; } else x.lineTo(p.x, p.y); });
  x.stroke(); x.fillStyle = '#6B1F2A';
  g.pts.forEach(function(p){ if(p.y != null){ x.beginPath(); x.arc(p.x, p.y, 3, 0, 7); x.fill(); } });
  x.font = '11px Arial'; x.fillStyle = '#8B7355';
  g.pts.forEach(function(p, i){ if(i === 0 || i === g.pts.length - 1 || g.pts.length <= 12){ x.textAlign = 'center'; x.fillText(apPointLabel(m, p.d), Math.min(612, Math.max(28, p.x)), 236); } });
  x.restore(); x.textAlign = 'left'; x.font = '11px Arial'; x.fillStyle = '#8B7355';
  x.fillText('Line: actual   Dashed gold: target ' + (m.target || '') + '   Dotted: baseline', 10, 266);
  return c.toDataURL('image/png');
}
async function apExcel(){
  if(AP.busyDl) return;
  AP.busyDl = 'xlsx'; apRepaint();
  try{
    if(typeof resLoadExcelJS !== 'function') throw new Error('the spreadsheet helper is not loaded');
    await resLoadExcelJS();
    var X = (typeof RES_XL === 'object') ? RES_XL : { VINO: '6B1F2A', SABBIA: 'F5F0E8', GOLD: 'C9A84C' };
    var wb = new ExcelJS.Workbook(); wb.creator = "Roberto's FOH App";
    var asOf = 'As of ' + apDate(apToday()) + ' ' + new Date().getFullYear() + ' · figures read ' + apAgo(apAutoRead());
    var mk = function(name, title, head, widths){
      var ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
      ws.columns = widths.map(function(w){ return { width: w }; });
      ws.getCell('A1').value = title; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF' + X.VINO } };
      ws.getCell('A2').value = asOf; ws.getCell('A2').font = { size: 9, color: { argb: 'FF8B7355' } };
      var hr = ws.getRow(3); hr.values = head; hr.height = 20;
      hr.eachCell(function(c){ c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + X.VINO } }; c.alignment = { vertical: 'middle', wrapText: true }; });
      return ws;
    };
    var add = function(ws, vals){ var r = ws.addRow(vals); r.eachCell({ includeEmpty: true }, function(c){ c.alignment = { vertical: 'top', wrapText: true }; c.border = { bottom: { style: 'thin', color: { argb: 'FFE6DED2' } } }; }); return r; };
    var pts = AP.points.slice().sort(function(a, b){ return a.num - b.num; });
    var pt = function(id){ return AP.points.filter(function(p){ return p.id === id; })[0] || {}; };
    // 1. Summary
    var all = AP.steps, done = all.filter(function(s){ return s.done_at; }).length;
    var ws = mk('Summary', "Roberto's 3.0 action plan — summary", ['#', 'Point', 'Lead', 'Status', 'Progress', 'Steps done', 'Late', 'Next step', 'Owner', 'Due', 'Latest note'], [5, 32, 34, 14, 10, 11, 7, 34, 14, 12, 50]);
    pts.forEach(function(p){
      var st = apPointSteps(p.id), nx = apNextStep(p), note = AP.results.filter(function(r){ return r.point_id === p.id; })[0];
      var r = add(ws, [p.num, p.title, p.lead || '', AP_PILL[apPointStatus(st)][0], apPct(st) / 100, st.filter(function(s){ return s.done_at; }).length + ' of ' + st.length, st.filter(apStepLate).length,
        nx ? nx.title : 'All done', nx && nx.owner || '', nx && nx.due_date ? new Date(nx.due_date + 'T12:00:00') : '', note ? note.note : '']);
      r.getCell(5).numFmt = '0%'; r.getCell(10).numFmt = 'd mmm';
    });
    var tr = add(ws, ['', 'Whole plan', '', '', all.length ? done / all.length : 0, done + ' of ' + all.length, all.filter(apStepLate).length, '', '', '', '']);
    tr.font = { bold: true }; tr.getCell(5).numFmt = '0%';
    // 2. Steps
    ws = mk('Steps', 'Every step, with owner, date and status', ['#', 'Point', 'Step', 'Owner', 'Due', 'Status', 'Done on', 'Done by'], [5, 30, 44, 16, 12, 14, 12, 16]);
    pts.forEach(function(p){ apPointSteps(p.id).forEach(function(s){
      var r = add(ws, [p.num, p.title, s.title, s.owner || '', s.due_date ? new Date(s.due_date + 'T12:00:00') : '', apStepStatus(s), s.done_at ? new Date(s.done_at) : '', s.done_by && s.done_by !== 'seed' ? apName(s.done_by) : '']);
      r.getCell(5).numFmt = 'd mmm'; r.getCell(7).numFmt = 'd mmm';
      if(apStepLate(s)) r.getCell(6).font = { bold: true, color: { argb: 'FFB3261E' } };
    }); });
    // 3. Figures
    ws = mk('Figures', 'Figures: today, target, baseline and where each comes from', ['#', 'Point', 'Figure', 'Today', 'Detail', 'Target', 'Baseline', 'Change vs baseline', 'How it gets its number', 'Source', 'How often', 'Read / typed'], [5, 28, 34, 10, 40, 22, 30, 18, 16, 20, 12, 20]);
    pts.forEach(function(p){ AP.measures.filter(function(m){ return m.point_id === p.id; }).forEach(function(m){
      var kind = apMeasureKind(m), dl = apDelta(m);
      var r = add(ws, [p.num, p.title, m.label, m.current == null ? '' : Number(m.current), m.current_label || '', m.target || '', m.baseline || '', dl ? dl.text : '',
        kind === 'manual' ? 'Typed in' : kind === 'coming' ? 'Automatic — coming' : 'Automatic', m.source || '', m.frequency || '',
        kind === 'manual' ? (m.updated_by ? apName(m.updated_by) + ', ' + apAgo(m.updated_at) : 'not typed yet') : (m.updated_at ? apAgo(m.updated_at) : 'not read yet')]);
      if(m.unit === '%' && m.current != null){ r.getCell(4).value = Number(m.current) / 100; r.getCell(4).numFmt = '0.0%'; }
      if(m.unit === 'AED') r.getCell(4).numFmt = '"AED "#,##0';
    }); });
    // 4. History
    ws = mk('Weekly history', 'Weekly (and monthly) history of every figure',   // "History" is a reserved sheet name in Excel
    ['#', 'Point', 'Figure', 'Week / month', 'Value', 'Detail'], [5, 28, 34, 14, 10, 50]);
    pts.forEach(function(p){ AP.measures.filter(function(m){ return m.point_id === p.id; }).forEach(function(m){ apHist(m).forEach(function(h){
      var r = add(ws, [p.num, p.title, m.label, apMonthly(m) ? new Date(h.d + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'w/c ' + apDate(h.d),
        h.v == null ? '' : (m.unit === '%' ? h.v / 100 : h.v), h.closed ? 'Closed (Sundays until October)' : h.label]);
      if(m.unit === '%') r.getCell(5).numFmt = '0.0%';
      if(m.unit === 'AED') r.getCell(5).numFmt = '"AED "#,##0';
    }); }); });
    // 5. Charts
    ws = wb.addWorksheet('Charts'); ws.getCell('A1').value = 'Trend charts — actual against target and baseline'; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF' + X.VINO } };
    ws.getCell('A2').value = asOf; ws.getCell('A2').font = { size: 9, color: { argb: 'FF8B7355' } };
    var row = 3;
    pts.forEach(function(p){ AP.measures.filter(function(m){ return m.point_id === p.id; }).forEach(function(m){
      var png = apChartPNG(m); if(!png) return;
      ws.getCell('A' + (row + 1)).value = p.num + '. ' + p.title; ws.getCell('A' + (row + 1)).font = { bold: true, color: { argb: 'FF8B7355' } };
      var id = wb.addImage({ base64: png, extension: 'png' });
      ws.addImage(id, { tl: { col: 0, row: row + 1 }, ext: { width: 640, height: 270 } });
      row += 16;
    }); });
    // 6. Notes
    ws = mk('Notes', 'Weekly notes, comments, proposed changes and approvals', ['#', 'Point', 'Type', 'Date', 'Who', 'Text', 'Status'], [5, 28, 16, 12, 14, 70, 22]);
    var notes = [];
    AP.results.forEach(function(r){ notes.push([r.point_id, 'Weekly note', r.week_start, r.author_email, r.note, '']); });
    AP.comments.forEach(function(c){ notes.push([c.point_id, 'Comment', String(c.created_at).slice(0, 10), c.author_email, c.body, '']); });
    AP.changes.forEach(function(c){ notes.push([c.point_id, 'Proposed change', String(c.created_at).slice(0, 10), c.proposed_by, c.proposal, c.status + (c.decided_by ? ' by ' + apName(c.decided_by) : '')]); });
    AP.weeks.forEach(function(w){ notes.push([null, 'Week ' + w.status, w.week_start, w.approved_by, w.note || '', '']); });
    notes.sort(function(a, b){ return (pt(a[0]).num || 0) - (pt(b[0]).num || 0) || (a[2] < b[2] ? -1 : 1); });
    if(!notes.length) add(ws, ['', '', '', '', '', 'Nothing written yet', '']);
    notes.forEach(function(n){ var p = pt(n[0]); var r = add(ws, [p.num || '', p.title || 'Whole plan', n[1], n[2] ? new Date(n[2] + 'T12:00:00') : '', apName(n[3]), n[4], n[5]]); r.getCell(4).numFmt = 'd mmm'; });
    var buf = await wb.xlsx.writeBuffer();
    var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = "Roberto's 3.0 action plan " + apToday() + '.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    apSay('Excel downloaded.');
  }catch(e){ apFail('Excel not built', e); }
  finally{ AP.busyDl = false; apRepaint(); }
}

// ── PDF / Print: the dashboard, then one page per point ────────────────────
// Printed from a dedicated block so the app's bars, chips and buttons never
// reach the paper. "Save as PDF" in the print dialog gives the PDF.
function apPdf(){
  try{
    apCss();
    var pts = AP.points.slice().sort(function(a, b){ return a.num - b.num; });
    var all = AP.steps, done = all.filter(function(s){ return s.done_at; }).length;
    var h = '<div class="ap-print-head"><div class="ap-kick">Roberto\'s DIFC &middot; Executive</div><h1>Roberto\'s 3.0 action plan</h1>'
      + '<div>As of ' + apDate(apToday()) + ' ' + new Date().getFullYear() + ' &middot; plan progress <b>' + apPct(all) + '%</b> &middot; ' + done + ' of ' + all.length + ' steps done &middot; ' + all.filter(apStepLate).length + ' late</div></div>';
    h += '<div class="ap-tiles">' + pts.map(function(p){ return apDashTile(p, true); }).join('') + '</div>';
    pts.forEach(function(p){
      h += '<div class="ap-print-point"><h2>' + p.num + '. ' + apEsc(p.title) + '</h2><div class="ap-small">' + apEsc(p.goal || '') + '</div>' + (p.lead ? '<div class="ap-small"><b>Lead:</b> ' + apEsc(p.lead) + '</div>' : '')
        + '<table class="ap-print-table"><thead><tr><th>Step</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>'
        + apPointSteps(p.id).map(function(s){ return '<tr><td>' + apEsc(s.title) + '</td><td>' + apEsc(s.owner || '') + '</td><td>' + (s.due_date ? apDate(s.due_date) : '') + '</td><td>' + apStepStatus(s) + (s.done_at ? ' ' + apDoneDate(s.done_at) : '') + '</td></tr>'; }).join('')
        + '</tbody></table>';
      var ns = AP.results.filter(function(r){ return r.point_id === p.id; }).map(function(r){ return '<li><b>Week of ' + apDate(r.week_start) + ', ' + apEsc(apName(r.author_email)) + ':</b> ' + apEsc(r.note) + '</li>'; })
        .concat(AP.comments.filter(function(c){ return c.point_id === p.id; }).map(function(c){ return '<li><b>' + apEsc(apName(c.author_email)) + ', ' + apDoneDate(c.created_at) + ':</b> ' + apEsc(c.body) + '</li>'; }));
      if(ns.length) h += '<div class="ap-print-notes"><b>Notes</b><ul>' + ns.join('') + '</ul></div>';
      h += '</div>';
    });
    var el = document.getElementById('ap-print');
    if(!el){ el = document.createElement('div'); el.id = 'ap-print'; document.body.appendChild(el); }
    el.innerHTML = h;
    // Only while the plan is printing: any other module's print stays as it was.
    document.body.classList.add('ap-printing');
    var done = function(){ document.body.classList.remove('ap-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function(){ window.print(); }, 50);
  }catch(e){ apFail('PDF not built', e); }
}

function apCss(){
  if(document.getElementById('ap-css')) return;
  var s = document.createElement('style'); s.id = 'ap-css';
  s.textContent = [
    // The room behind, a wine wash over it, everything on a cream sheet — the same
    // device as Private Events. Day room (light rooms only); a slow connection
    // shows the sand colour, never a grey hole.
    '.ap-wrap{max-width:1080px;margin:0 auto;padding:6px 0 48px;font-family:var(--font-sans);color:var(--text);position:relative;isolation:isolate}',
    '.ap-wrap::before,.ap-wrap::after{content:"";position:fixed;inset:0;pointer-events:none}',
    '.ap-wrap::before{z-index:-2;background:#cdbba6 url(venue-chandelier.jpg) center/cover}',
    '.ap-wrap::after{z-index:-1;background:linear-gradient(180deg,rgba(43,1,4,.58) 0,rgba(43,1,4,.42) 10%,rgba(43,1,4,.38) 62%,rgba(43,1,4,.56) 100%)}',
    '.ap-sheet{background:#F4EDE1;border-radius:16px;padding:20px 22px 24px;box-shadow:0 34px 76px -34px rgba(20,4,4,.94)}',
    '@media print{.ap-wrap::before,.ap-wrap::after{display:none}.ap-sheet{box-shadow:none}}',
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
    '.ap-lead{font-size:14px;color:var(--text-dark,#2C1810);margin:-6px 4px 14px;line-height:1.45}.ap-lead span{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B1F2A;margin-right:8px}',
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
    '.ap-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}',
    '.ap-kpi{background:#fff;border:1px solid #E9E1D6;border-radius:12px;padding:14px 18px;min-height:96px}',
    '.ap-kpi .l{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-light);font-weight:600}',
    '.ap-kpi .v{font-family:var(--font-serif);font-size:32px;line-height:1.1;margin-top:8px;color:var(--text);font-feature-settings:"lnum"}',
    '.ap-kpi .s{font-size:12px;color:var(--text-light);margin-top:4px}.ap-kpi .ap-bar{margin-top:10px;height:6px}.ap-kpi .ap-bar div{height:6px}',
    '.ap-approve{display:flex;justify-content:space-between;align-items:center;gap:12px;background:#fff;border:1px solid #E9E1D6;border-radius:12px;padding:12px 16px;margin-top:12px;font-size:14px;color:var(--text)}',
    '.ap-approve b{font-weight:600}.ap-ab-btns{display:flex;gap:8px;flex:none}.ap-ab-ask{display:flex;gap:8px;flex:1;max-width:520px}.ap-ab-ask .ap-in{flex:1;min-height:38px;font-size:14px}',
    '.btn-q{font:inherit;font-size:13px;font-weight:600;border-radius:9px;padding:9px 14px;border:1px solid #D9CBB9;background:#fff;color:var(--vino);cursor:pointer;white-space:nowrap;min-height:38px}',
    '.btn-q.main{background:var(--vino);border-color:var(--vino);color:#fff}.btn-q:disabled{opacity:.55;cursor:default}',
    '.ap-tabs{display:flex;gap:2px;background:#EDE5DA;border-radius:10px;padding:3px;margin-top:20px;width:max-content;max-width:100%;overflow-x:auto}',
    '.ap-tabs button{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;border:0;background:none;color:var(--text-mid);cursor:pointer;white-space:nowrap;min-height:34px}',
    '.ap-tabs button.on{background:#fff;color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}',
    '.ap-subtabs{display:flex;gap:6px;margin:14px 0 10px;flex-wrap:wrap}.ap-subtabs button{font:inherit;font-size:12px;padding:6px 12px;border-radius:999px;border:1px solid #DDD0BF;background:#fff;color:var(--text-mid);cursor:pointer;min-height:32px}.ap-subtabs button.on{background:var(--vino);border-color:var(--vino);color:#fff}',
    '.ap-secbar{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:22px 2px 10px}',
    '.ap-sect{font-family:var(--font-serif);font-size:22px;color:var(--vino)}.ap-secsub{font-size:12px;color:var(--text-light);margin-top:2px}',
    '.ap-cgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
    '.ap-c{all:unset;box-sizing:border-box;background:#fff;border:1px solid #E9E1D6;border-radius:12px;padding:16px 18px;display:grid;grid-template-rows:28px 22px 40px 64px;row-gap:8px;height:206px;cursor:pointer;min-width:0;transition:border-color .15s,box-shadow .15s}',
    '.ap-c:hover{border-color:#D9CBB9;box-shadow:0 6px 18px -10px rgba(44,24,16,.25)}.ap-c:focus-visible{outline:2px solid var(--gold);outline-offset:3px}',
    '.ap-c>*{min-width:0}',
    '.ap-c-top{display:flex;justify-content:space-between;align-items:center;gap:10px}',
    '.ap-c-title{font-family:var(--font-serif);font-size:18px;color:var(--text);display:flex;gap:10px;align-items:baseline;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.ap-c-top .ap-pill{min-width:92px;flex:none}',
    '.ap-c-prog{display:grid;grid-template-columns:1fr 64px;gap:10px;align-items:center;font-size:12px;color:var(--text-light);text-align:right}.ap-c-prog .ap-bar{height:6px}.ap-c-prog .ap-bar div{height:6px}',
    '.ap-c-next{font-size:13px;color:var(--text-mid);border-top:1px solid #E9E1D6;padding-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}',
    '.ap-c-next small{display:block;font-size:12px;color:var(--text-light);overflow:hidden;text-overflow:ellipsis}',
    '.ap-cfig{display:grid;grid-template-columns:minmax(0,1fr) 96px;align-items:center;gap:12px;background:#FBF8F3;border-radius:9px;padding:8px 12px;min-width:0}',
    '.ap-cfig-l{display:block;min-width:0}.ap-cfig .t{display:block;font-size:12px;color:var(--text-mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ap-cfig .v{display:block;font-family:var(--font-serif);font-size:22px;line-height:1.15;color:var(--text);white-space:nowrap;font-feature-settings:"lnum"}',
    '.ap-cfig.none{display:flex;align-items:center;color:#A8957F;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ap-c2{color:#A8957F}.ap-cd{font-family:var(--font-sans);font-size:12px;font-weight:600}.ap-cd.good{color:#1E6B3A}.ap-cd.bad{color:#A1231B}.ap-cd.muted{color:#A8957F;font-weight:500}',
    '.ap-spark{width:84px;height:28px;display:block;margin-left:auto}',
    '@media (max-width:820px){.ap-cgrid{grid-template-columns:minmax(0,1fr)}.ap-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '@media (max-width:600px){.ap-c{grid-template-rows:46px 22px 40px 64px;height:226px}.ap-c-title{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.25;font-size:17px;align-items:flex-start}.ap-c-title .ap-num{flex:none;margin-right:8px}.ap-c2{display:none}.ap-cfig.none{white-space:normal;line-height:1.4}.ap-tabs{display:flex;width:100%;overflow:visible}.ap-tabs button{flex:1 1 auto;padding:7px 6px;font-size:12px;text-align:center}.ap-approve{flex-direction:column;align-items:stretch}.ap-ab-btns .btn-q{flex:1}.ap-ab-ask{max-width:none}.ap-secbar{flex-direction:column;align-items:flex-start}.ap-cfig{grid-template-columns:minmax(0,1fr) 70px}.ap-spark{width:70px}.ap-kpi .v{font-size:26px}.ap-kpi{min-height:86px}}',
    '.ap-dl{margin-top:0}',
    '.ap-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}',
    '.ap-tile-hit{all:unset;box-sizing:border-box;display:flex;flex-direction:column;gap:9px;width:100%;cursor:pointer}',
    '.ap-tile-hit:focus-visible{outline:2px solid var(--gold);outline-offset:4px;border-radius:8px}',
    '.ap-tile-lines{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border);padding-top:9px}',
    '.ap-fline{display:grid;grid-template-columns:1fr auto;column-gap:10px;align-items:baseline}',
    '.ap-fl-lbl{font-size:13px;color:var(--text-mid)}.ap-fl-val{font-family:var(--font-serif);font-size:20px;color:var(--text);text-align:right}',
    '.ap-fline .ap-delta{grid-column:1 / -1;font-size:11px;margin-top:-2px}',
    '.ap-tile-more{font-size:12px;color:var(--vino);font-weight:600;align-self:flex-end}',
    '.ap-tile-detail{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--border);padding-top:12px}',
    '.ap-tile-next2{font-size:13px;color:var(--text-mid);line-height:1.5}.ap-tile-open{font-size:13px;font-weight:600;align-self:flex-start}',
    '.ap-tile{background:#fff;border:1px solid var(--border);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;break-inside:avoid}',
    '.ap-tile-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}',
    '.ap-tile-title{font-family:var(--font-serif);font-size:19px;color:var(--text);display:flex;gap:10px;align-items:baseline}',
    '.ap-tile-title .ap-num{font-size:20px}',
    '.ap-tile-prog{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;font-size:13px;color:var(--text-light)}',
    '.ap-tile-next{font-size:13px;color:var(--text-mid);line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ap-tile-figs{display:flex;flex-direction:column;gap:14px}',
    '.ap-dfig-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.ap-dfig-label{font-size:14px;color:var(--text-mid)}',
    '.ap-dfig-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}',
    '.ap-dfig-val{font-family:var(--font-serif);font-size:30px;line-height:1.15;color:var(--text)}',
    '.ap-delta{font-size:12px;font-weight:600;color:var(--text-light)}.ap-delta.good{color:#1E6B3A}.ap-delta.bad{color:#A1231B}',
    '.ap-chart{width:100%;height:84px;display:block;margin-top:6px}',
    '.ap-ch-line{fill:none;stroke:#6B1F2A;stroke-width:2;vector-effect:non-scaling-stroke}.ap-ch-dot{fill:#6B1F2A}.ap-ch-last{fill:#6B1F2A;stroke:#fff;stroke-width:1.5}',
    '.ap-ch-target{stroke:#C9A84C;stroke-width:1.5;stroke-dasharray:6 4;vector-effect:non-scaling-stroke}.ap-ch-base{stroke:#B9A58C;stroke-width:1;stroke-dasharray:2 3;vector-effect:non-scaling-stroke}',
    '.ap-ch-x{font-size:10px;fill:#8B7355;font-family:var(--font-sans)}',
    '.ap-ch-key{display:flex;gap:12px;align-items:center;font-size:11px;color:var(--text-light);margin-top:2px}.ap-ch-key span{display:inline-block;width:16px;margin-right:-6px;vertical-align:middle;border-top:2px solid #6B1F2A}.ap-ch-key .k-target{border-top:2px dashed #C9A84C}.ap-ch-key .k-base{border-top:2px dotted #B9A58C}',
    '.ap-dfig-foot{font-size:12px;color:var(--text-mid);margin-top:6px;line-height:1.5}.ap-dfig-foot b{font-weight:500;color:var(--text)}',
    '.ap-tile-coming{font-size:12px;color:var(--text-light);border-top:1px solid var(--border);padding-top:8px;line-height:1.5}',
    '.ap-tile-note{font-size:13px;color:var(--text);background:var(--surface2);border-radius:10px;padding:10px 12px;line-height:1.5}.ap-tile-note span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-light);margin-bottom:2px}',
    '#ap-print{display:none}',
    '@media print{@page{size:A4;margin:12mm}body.ap-printing>*:not(#ap-print){display:none!important}body.ap-printing #ap-print{display:block!important;font-family:Arial,sans-serif;color:#2C1810}#ap-print .ap-tiles{grid-template-columns:1fr 1fr;gap:8px}#ap-print .ap-tile{border:1px solid #DDD3C6;padding:10px 12px;gap:6px}#ap-print .ap-tile-title{font-size:15px}#ap-print .ap-dfig-val{font-size:22px}#ap-print .ap-chart{height:60px}.ap-print-head{margin-bottom:10px}.ap-print-head h1{font-family:Georgia,serif;color:#6B1F2A;font-size:24px;margin:4px 0}.ap-print-point{break-inside:avoid;margin-top:16px}#ap-print .ap-tile-more{display:none}.ap-print-point h2{font-family:Georgia,serif;color:#6B1F2A;font-size:18px;margin:0 0 4px}.ap-print-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}.ap-print-table th{text-align:left;background:#6B1F2A;color:#fff;padding:5px 6px}.ap-print-table td{border-bottom:1px solid #E6DED2;padding:5px 6px;vertical-align:top}.ap-print-notes{font-size:11px;margin-top:10px}.ap-print-notes ul{margin:4px 0 0 16px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}',
    '@media (max-width:820px){.ap-tiles{grid-template-columns:1fr}.ap-datahead{flex-wrap:wrap}}',
    '.ap-datahead{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin:6px 2px 14px}',
    '.ap-dtitle{font-family:var(--font-serif);font-size:26px;color:var(--vino);line-height:1.1}',
    '.ap-dsec{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-light);font-weight:600;margin:18px 4px 10px}',
    '.ap-mgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:6px}',
    '.ap-mcard{background:#fff;border:1px solid var(--border);border-radius:14px;padding:16px 18px 14px;display:flex;flex-direction:column}',
    '.ap-mtop{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:22px}',
    '.ap-mpoint{background:none;border:0;padding:0;font:inherit;font-size:12px;letter-spacing:.06em;color:var(--vino);cursor:pointer;text-align:left}',
    '.ap-mtag{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:3px 9px;white-space:nowrap}',
    '.ap-tag-auto{background:#EEF3F6;color:#2F5A73}.ap-tag-man{background:#FBF1DC;color:#7A4B00}',
    '.ap-mlabel{font-size:15px;color:var(--text-mid);margin-top:8px}',
    '.ap-mval{font-family:var(--font-serif);font-size:36px;line-height:1.15;color:var(--text);margin-top:4px}',
    '.ap-mval-none{font-size:22px;color:var(--text-light)}',
    '.ap-mval-in{font-family:var(--font-serif);font-size:24px;width:120px;margin-top:4px}',
    '.ap-mctx{font-size:13px;color:var(--text-light);margin-top:2px;line-height:1.45}',
    '.ap-mfoot{display:grid;grid-template-columns:1fr 1fr;gap:12px;border-top:1px solid var(--border);margin-top:14px;padding-top:10px}',
    '.ap-mfoot span{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-light)}',
    '.ap-mfoot b{display:block;font-weight:500;font-size:13px;color:var(--text);margin-top:2px;line-height:1.4}',
    '.ap-msrc{font-size:12px;color:var(--text-light);margin-top:10px}',
    '.ap-coming{padding:4px 18px}',
    '.ap-crow{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--border)}.ap-crow:last-child{border-bottom:0}',
    '.ap-clabel{font-size:15px;color:var(--text)}.ap-cwhen{font-size:13px;color:var(--text-light);text-align:right;max-width:46%}',
    '@media (max-width:820px){.ap-mgrid{grid-template-columns:1fr}.ap-sheet{padding:16px 14px 20px;border-radius:14px}}',
    '@media (max-width:480px){.ap-wrap{padding-top:0}.ap-crow{flex-direction:column;align-items:flex-start;gap:4px}.ap-cwhen{text-align:left;max-width:none}}',
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
