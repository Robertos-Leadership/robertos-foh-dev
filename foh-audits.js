// ─────────────────────────────────────────────────────────────────────────────
// AUDITS (au*) — 22 Oct 2026.
//
// Francesco: the people we pick can send the audit link to anyone they want; that person
// opens it, types their name and when they visited, does the audit (anything not seen can be
// N/A), and the report is kept here for the people we choose. "Don't put send to Francesco":
// a finished audit goes to Roberto's management team, which means it shows up in this list.
//
// TWO TICKS in Admin → People (Admin only), stored in app_users.modules:
//   audit_send  — the Audits card, and THEIR OWN link to share (every audit says who sent it).
//   audit_read  — the same, plus every audit and each report. FOH Admins have both.
// The lock is not here: every call goes to the Kitchen audit-api with this login's token, and
// the function checks the login and the ticks against the FOH project itself.
//
// The audits live in the Kitchen database (audit_* tables, the Bartolini audit). The report shown
// here is the same report Amin gets by email, built by the function, notes in English.
// ─────────────────────────────────────────────────────────────────────────────

var AU = { me: null, list: null, err: null, loading: false, open: null, report: null, reportErr: null,
           copied: false, replacing: false, showHow: false, filter: 'all', kind: 'all', table: false, tip: null };
// Three kinds of audit (22 Oct 2026). Colours checked for colour-blind separation (dataviz validator).
var AU_KINDS = [
  { k: 'restaurant', n: 'Restaurant visit', short: 'Restaurant', c: '#0093B0' },
  { k: 'scala',      n: 'Scala visit',      short: 'Scala',      c: '#B8860B' },
  { k: 'venue',      n: 'Whole venue',      short: 'Whole venue', c: '#A8283E' }
];
function auKind(k){ for(var i = 0; i < AU_KINDS.length; i++) if(AU_KINDS[i].k === k) return AU_KINDS[i]; return AU_KINDS[2]; }

function auEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
// The audit page lives in this app (moved from the Kitchen app 22 Oct 2026), next to index.html:
// DEV hands out the DEV page, LIVE the LIVE one. The function only accepts our own pages.
function auPage(){ return new URL('audit.html', location.origin + location.pathname).href; }
async function auApi(action, payload){
  var s = await sb.auth.getSession();
  var jwt = s && s.data && s.data.session && s.data.session.access_token;
  if(!jwt) throw new Error('Please sign in again.');
  var r = await fetch(KITCHEN_URL + '/functions/v1/audit-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KITCHEN_KEY, Authorization: 'Bearer ' + KITCHEN_KEY },
    body: JSON.stringify(Object.assign({ action: action, foh: jwt, page: auPage() }, payload || {}))
  });
  var j = await r.json().catch(function(){ return {}; });
  if(!r.ok) throw new Error(j.error || ('Error ' + r.status));
  return j;
}
function auRepaint(){ if(typeof state === 'object' && state.currentTab === 'audits' && typeof renderMain === 'function') renderMain(); }

async function auLoad(quiet){
  if(AU.loading) return;
  AU.loading = true;
  try {
    if(!AU.me) AU.me = await auApi('me');
    if(AU.me.read){ var l = await auApi('list'); AU.list = l.audits || []; }
    AU.err = null;
  } catch(e){ if(!quiet || !AU.me) AU.err = e.message || String(e); }
  AU.loading = false;
  auRepaint();
}

// ── formatting ──
function auDate(d){ if(!d) return ''; try { return new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); } catch(e){ return d; } }
function auAgo(ts){
  var d = new Date(ts); if(isNaN(d)) return '';
  var m = Math.floor((Date.now() - d.getTime()) / 60000);
  if(m < 1) return 'just now'; if(m < 60) return m + ' min ago';
  var h = Math.floor(m / 60); if(h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });
}
// "sent by Andrea Sacchi", but "via the shared link" (the one link from before 22 Oct, no sender).
function auVia(s){ s = String(s || 'Shared link'); return s === 'Shared link' ? 'via the shared link' : /link$/i.test(s) ? 'via ' + s : 'sent by ' + s; }
function auState(a){
  if(a.status === 'sent') return { k: 'done', t: 'Sent to Amin' };
  if(a.status === 'submitted') return { k: 'done', t: 'Finished' };
  return { k: 'open', t: 'In progress · ' + a.done + ' of ' + a.total };
}

// ── screen ──
function auCss(){
  if(document.getElementById('au-css')) return;
  var c = document.createElement('style'); c.id = 'au-css';
  c.textContent =
    '.au-wrap{padding:4px 4px 60px;font-family:Inter,system-ui,sans-serif;color:#2a1a10}' +
    '.au-card{background:#fff;border:1px solid #e6dacb;border-radius:12px;padding:16px 18px;margin-bottom:14px}' +
    '.au-lbl{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#410207;font-weight:700;margin-bottom:8px}' +
    '.au-link{font:14px/1.4 ui-monospace,Menlo,Consolas,monospace;background:#fbf7f1;border:1px solid #e6dacb;border-radius:8px;padding:10px 12px;word-break:break-all;color:#4a3a30}' +
    '.au-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}' +
    '.au-btn{border:1px solid #410207;background:#fff;color:#410207;border-radius:9px;padding:10px 16px;font:600 14px Inter,system-ui,sans-serif;cursor:pointer;min-height:44px}' +
    '.au-btn.pri{background:#410207;color:#fff}' +
    '.au-btn.quiet{border-color:#cfc0ad;color:#6b5b50}' +
    '.au-hint{font-size:13px;color:#6b5b50;margin-top:10px;line-height:1.5}' +
    '.au-how{font-size:13px;color:#6b5b50;line-height:1.55;margin-top:10px;padding-top:10px;border-top:1px solid #f0e8dc}' +
    '.au-more{background:none;border:0;color:#410207;font:600 13px Inter,system-ui,sans-serif;padding:8px 0 0;cursor:pointer;text-decoration:underline}' +
    '.au-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:6px 2px 10px}' +
    '.au-chips{display:flex;gap:6px;flex-wrap:wrap}' +
    '.au-chip{border:1px solid #cfc0ad;background:#fff;border-radius:16px;padding:6px 12px;font:600 12.5px Inter,system-ui,sans-serif;color:#6b5b50;cursor:pointer;min-height:34px}' +
    '.au-chip.on{background:#410207;border-color:#410207;color:#fff}' +
    '.au-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#fff;border:1px solid #e6dacb;border-radius:12px;padding:14px 16px;margin-bottom:8px;cursor:pointer;font-family:inherit;color:inherit}' +
    '.au-row:hover{border-color:#cfc0ad}' +
    '.au-main{flex:1;min-width:0}' +
    '.au-name{font:600 16px "Playfair Display",Georgia,serif;color:#410207}' +
    '.au-sub{font-size:13px;color:#6b5b50;margin-top:3px}' +
    '.au-pct{font:700 20px Inter,system-ui,sans-serif;min-width:56px;text-align:right}' +
    '.au-tag{display:inline-block;font:700 11px Inter,system-ui,sans-serif;padding:3px 8px;border-radius:10px;margin-top:6px}' +
    '.au-tag.done{background:#e4ecd9;color:#2f5d1e}.au-tag.open{background:#f6e6cc;color:#7a4200}.au-tag.past{background:#ede5d8;color:#6b5b50}' +
    '.au-empty{color:#6b5b50;font-size:14px;padding:18px 4px}' +
    '.au-bad{background:#fbe9e6;border:1px solid #e9b8ae;color:#8f1d12;border-radius:10px;padding:12px 14px;margin-bottom:12px}' +
    '.au-ktag{display:inline-flex;align-items:center;gap:6px;font:600 12px Inter,system-ui,sans-serif;color:#4a3a30;margin-right:8px}' +
    '.au-ktag i{width:9px;height:9px;border-radius:50%;display:inline-block}' +
    '.au-chart{position:relative}' +
    '.au-chart svg{width:100%;height:auto;display:block;overflow:visible}' +
    '.au-legend{display:flex;flex-wrap:wrap;gap:14px;margin:4px 0 8px;font-size:13px;color:#4a3a30}' +
    '.au-legend span{display:inline-flex;align-items:center;gap:6px}.au-legend i{width:16px;height:2px;display:inline-block;border-radius:1px}' +
    '.au-tip{position:absolute;pointer-events:none;background:#2a1a10;color:#fff;font:12.5px/1.4 Inter,system-ui,sans-serif;padding:7px 10px;border-radius:8px;white-space:nowrap;transform:translate(-50%,-110%)}' +
    '.au-table{width:100%;border-collapse:collapse;font-size:13px}.au-table th,.au-table td{padding:6px 8px;border-bottom:1px solid #f0e8dc;text-align:right}.au-table th:first-child,.au-table td:first-child{text-align:left}' +
    '.au-frame{width:100%;border:0;border-radius:12px;background:#fbf7f1;min-height:400px;display:block}' +
    '@media (max-width:600px){.au-card{padding:14px}.au-row{padding:12px}.au-pct{font-size:17px;min-width:46px}}';
  document.head.appendChild(c);
}

// The house frame: the burgundy header card and the ~980px column, as on the Closing Report.
function auHero(){
  return '<div class="ops-hero"><div class="ops-hero-k">Standards</div><div class="ops-hero-t">Audits</div>'
    + '<div class="ops-hero-s">' + (AU.me && AU.me.read ? 'Send your audit link, and read every audit as it comes in.' : 'Send your audit link to whoever should audit us.') + '</div></div>';
}
function renderAudits(){ return '<div class="ops-wrap">' + auHero() + auBody() + '</div>'; }
function auBody(){
  auCss();
  if(!AU.me && !AU.loading && !AU.err) setTimeout(auLoad, 0);
  if(AU.me && AU.me.read && AU.list === null && !AU.loading) setTimeout(function(){ auLoad(true); }, 0);   // after a remove / put back
  if(AU.err && !AU.me) return '<div class="au-wrap"><div class="au-bad">Audits could not be read: ' + auEsc(AU.err) + ' <button class="au-btn quiet" onclick="AU.err=null;auLoad()">Try again</button></div></div>';
  if(!AU.me) return '<div class="au-wrap"><div class="loading">Reading the audits&hellip;</div></div>';
  if(AU.open) return '<div class="au-wrap">' + auReportView() + '</div>';
  return '<div class="au-wrap">' + (AU.err ? '<div class="au-bad">' + auEsc(AU.err) + '</div>' : '') + auLinkCard() + (AU.me.read ? auListView() : '') + '</div>';
}

function auLinkCard(){
  var link = AU.me.link || '';
  var h = '<div class="au-card"><div class="au-lbl">Your audit link</div>'
    + '<div class="au-link">' + auEsc(link) + '</div>'
    + '<div class="au-btns">'
    + (navigator.share ? '<button class="au-btn pri" onclick="auShare()">Share</button>' : '')
    + '<button class="au-btn' + (navigator.share ? '' : ' pri') + '" onclick="auCopy()">' + (AU.copied ? 'Copied &#10003;' : 'Copy link') + '</button>'
    + '<a class="au-btn" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(auShareText() + '\n' + link) + '">WhatsApp</a>'
    + '</div>'
    + '<div class="au-hint">Send it to anyone. Every audit started from it says it came from you.</div>';
  if(AU.showHow) h += '<div class="au-how">Whoever opens it types their name and the date and time of their visit, then scores what they saw, 1 to 5. Anything they did not see can be N/A (a whole area in one tap); N/A never counts in the %. Notes can be typed or spoken, and photos added. When they send it, it goes to Roberto\'s management team: it appears in the list here, nobody gets an email.'
    + '<div class="au-btns">' + (AU.replacing
        ? '<button class="au-btn" style="border-color:#8f1d12;color:#8f1d12" onclick="auReplace()">Tap again: old link stops working</button><button class="au-btn quiet" onclick="AU.replacing=false;auRepaint()">Cancel</button>'
        : '<button class="au-btn quiet" onclick="AU.replacing=true;auRepaint()">Replace my link</button>')
      + '</div></div>';
  h += '<button class="au-more" onclick="AU.showHow=!AU.showHow;AU.replacing=false;auRepaint()">' + (AU.showHow ? 'Hide' : 'How it works') + '</button>';
  return h + '</div>';
}
function auShareText(){ return "Roberto's DIFC audit: open the link, type your name and when you visited, then score what you saw. Anything you didn't see can be N/A."; }
function auShare(){
  try { navigator.share({ title: "Roberto's DIFC audit", text: auShareText(), url: AU.me.link }).catch(function(){}); } catch(e){ auCopy(); }
}
function auCopy(){
  var done = function(){ AU.copied = true; auRepaint(); setTimeout(function(){ AU.copied = false; auRepaint(); }, 2500); };
  try { navigator.clipboard.writeText(AU.me.link).then(done, function(){ auCopyOld(); done(); }); } catch(e){ auCopyOld(); done(); }
}
function auCopyOld(){
  var t = document.createElement('textarea'); t.value = AU.me.link; t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch(e){} t.remove();
}
async function auReplace(){
  AU.replacing = false;
  try { AU.me = await auApi('new_link'); toast('New link ready. The old one no longer works.'); }
  catch(e){ toast('Could not replace the link: ' + (e.message || e), true); }
  auRepaint();
}

function auListView(){
  var all = (AU.list || []).filter(function(a){ return AU.kind === 'all' || a.kind === AU.kind; });
  var n = { all: all.length, open: 0, done: 0 };
  all.forEach(function(a){ var k = auState(a).k; if(k === 'open') n.open++; if(k === 'done') n.done++; });
  var rows = all.filter(function(a){ var k = auState(a).k; return AU.filter === 'all' || k === AU.filter; });
  var kchip = function(k, label){ return '<button class="au-chip' + (AU.kind === k ? ' on' : '') + '" onclick="AU.kind=\'' + k + '\';auRepaint()">' + label + '</button>'; };
  var kinds = '<div class="au-chips" style="margin:0 2px 10px">' + kchip('all', 'All types') + AU_KINDS.map(function(x){ return kchip(x.k, x.short); }).join('') + '</div>';
  var chip = function(k, label){ return '<button class="au-chip' + (AU.filter === k ? ' on' : '') + '" onclick="AU.filter=\'' + k + '\';auRepaint()">' + label + ' &middot; ' + n[k] + '</button>'; };
  var h = auChartCard() + '<div class="au-head"><div class="au-lbl" style="margin:0">Audits</div><div class="au-chips">' + chip('all', 'All') + chip('open', 'In progress') + chip('done', 'Finished') + '</div></div>' + kinds;
  if(AU.list === null) return h + '<div class="loading">Reading the audits&hellip;</div>';
  if(!rows.length) return h + '<div class="au-empty">' + (all.length ? 'None here.' : 'No audits yet. Share your link and they appear here as people fill them in.') + '</div>';
  rows.forEach(function(a){
    var st = auState(a), pct = a.overall_pct;
    h += '<button class="au-row" onclick="auOpen(\'' + auEsc(a.id) + '\')">'
      + '<div class="au-main"><div class="au-name">' + auEsc(a.auditor) + '</div>'
      + '<div class="au-sub"><span class="au-ktag"><i style="background:' + auKind(a.kind).c + '"></i>' + auEsc(auKind(a.kind).n) + '</span></div>'
      + '<div class="au-sub">' + auEsc(a.visit_date ? auDate(a.visit_date) : (a.title || 'Date not given')) + (a.visit_time ? ' &middot; ' + auEsc(a.visit_time) : '') + ' &middot; ' + auEsc(auVia(a.sent_by)) + '</div>'
      + '<span class="au-tag ' + st.k + '">' + auEsc(st.t) + '</span>'
      + (st.k === 'open' && a.updated_at ? ' <span class="au-sub" style="display:inline">&middot; last change ' + auEsc(auAgo(a.updated_at)) + '</span>' : '')
      + '</div><div class="au-pct">' + (pct != null ? pct + '%' : '<span style="color:#cfc0ad">&mdash;</span>') + '</div></button>';
  });
  return h;
}

async function auOpen(id){
  var a = (AU.list || []).filter(function(x){ return x.id === id; })[0];
  AU.open = a || { id: id, auditor: '' }; AU.report = null; AU.reportErr = null;
  auRepaint(); try { window.scrollTo(0, 0); } catch(e){}
  try { var r = await auApi('report', { id: id }); if(AU.open && AU.open.id === id) AU.report = r.html; }
  catch(e){ if(AU.open && AU.open.id === id) AU.reportErr = e.message || String(e); }
  auRepaint();
}
function auBack(){ AU.open = null; AU.report = null; auRepaint(); auLoad(true); }
function auReportView(){
  var a = AU.open;
  var h = '<div class="au-btns" style="margin:0 0 12px"><button class="au-btn quiet" onclick="auBack()">&lsaquo; All audits</button></div>';
  if(AU.reportErr) return h + '<div class="au-bad">The report could not be read: ' + auEsc(AU.reportErr) + ' <button class="au-btn quiet" onclick="auOpen(\'' + auEsc(a.id) + '\')">Try again</button></div>';
  if(!AU.report) return h + '<div class="loading">Preparing the report' + (a.auditor ? ' for ' + auEsc(a.auditor) : '') + '&hellip; notes are put into English first, which can take a few seconds.</div>';
  // The report is the function's own HTML (the same as Amin's email), shown in a frame with no scripts.
  return h + '<iframe class="au-frame" id="au-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcdoc="' + auEsc(AU.report) + '" onload="auFit(this)" title="Audit report"></iframe>';
}
function auFit(f){
  try {
    var d = f.contentDocument; if(!d) return;
    d.querySelectorAll('a').forEach(function(x){ x.target = '_blank'; x.rel = 'noopener'; });
    // The report grows after its fonts and photos arrive (3,025 -> 3,085 px, which left an inner
    // scrollbar hiding the logo): follow the content's height whenever it changes.
    var fit = function(){ f.style.height = (d.documentElement.scrollHeight + 8) + 'px'; try { f.contentWindow.scrollTo(0, 0); } catch(e){} };
    fit();
    if (window.ResizeObserver) new ResizeObserver(fit).observe(d.body);
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(fit);
    d.querySelectorAll('img').forEach(function(im){ if(!im.complete) im.addEventListener('load', fit); });
  } catch(e){}
}

// Live: while the list is on screen, it re-reads every 30 seconds (not when the tab is hidden).
setInterval(function(){
  if(typeof state === 'object' && state.currentTab === 'audits' && !document.hidden && AU.me && AU.me.read && !AU.open && !AU.loading) auLoad(true);
}, 30000);

// ── Admin → People: the two ticks (Admin only) ──
function admAuditSection(email){
  if(typeof fohIsAdmin !== 'function' || !fohIsAdmin()) return '';
  var u = (typeof adminFind === 'function') ? adminFind(String(email || '').toLowerCase()) : null;
  if(!u) return '';
  var mods = u.modules || [], read = mods.indexOf('audit_read') > -1, send = read || mods.indexOf('audit_send') > -1;
  var e = auEsc(String(email || '').toLowerCase());
  var tick = function(on, key, label){ return '<button class="px-acc' + (on ? ' on' : '') + '" onclick="admAuditToggle(\'' + e + '\',\'' + key + '\')"><i>' + (on ? '&#10003;' : '') + '</i><span>' + label + '</span></button>'; };
  return '<div class="px-pslbl" style="margin-top:14px;">Audits</div><div class="px-accgrid">'
    + tick(send, 'audit_send', 'Send audit link') + tick(read, 'audit_read', 'See audit reports') + '</div>'
    + '<div class="px-dhint">' + (read ? 'Has their own link and sees every audit.' : send ? 'Has their own link to share; does not see the reports.' : 'Tick to give them their own audit link.') + '</div>';
}
async function admAuditToggle(email, key){
  if(!fohIsAdmin()) return;
  var u = adminFind(String(email || '').toLowerCase()); if(!u) return;
  var m = (u.modules || []).slice(), read = m.indexOf('audit_read') > -1, send = m.indexOf('audit_send') > -1;
  var drop = function(k){ m = m.filter(function(x){ return x !== k; }); };
  if(key === 'audit_read'){ if(read) drop('audit_read'); else { m.push('audit_read'); if(!send) m.push('audit_send'); } }
  else { if(send || read){ drop('audit_send'); drop('audit_read'); } else m.push('audit_send'); }   // no reports without sending
  var before = u.modules; u.modules = m;
  renderMain();
  if(!(await adminSave(u))){ u.modules = before; renderMain(); return; }
  if(String(email).toLowerCase() === String(state.userEmail || '').toLowerCase() && typeof loadFohAccess === 'function') loadFohAccess();
}

// ── The chart: average score per month, one line per kind (finished audits only) ──
// The score of an audit is its overall % (scored questions only, N/A left out). A month's point is
// the average of the audits of that kind finished for visits in that month. Last 12 months.
function auMonths(){
  var d = new Date(Date.now() + 4 * 3600e3), y = d.getUTCFullYear(), m = d.getUTCMonth(), out = [];
  for(var i = 11; i >= 0; i--){ var x = new Date(Date.UTC(y, m - i, 1)); out.push(x.toISOString().slice(0, 7)); }
  return out;
}
function auSeries(){
  var months = auMonths(), done = (AU.list || []).filter(function(a){ return (a.status === 'submitted' || a.status === 'sent') && a.overall_pct != null && a.visit_date; });
  return { months: months, n: done.length, series: AU_KINDS.map(function(k){
    var pts = months.map(function(mo){
      var xs = done.filter(function(a){ return a.kind === k.k && String(a.visit_date).slice(0, 7) === mo; });
      if(!xs.length) return null;
      var sum = xs.reduce(function(t, a){ return t + Number(a.overall_pct); }, 0);
      return { v: Math.round(sum / xs.length), n: xs.length };
    });
    return { k: k, pts: pts, has: pts.some(function(p){ return p; }) };
  }) };
}
function auMonthName(mo, long){ return new Date(mo + '-15T12:00:00Z').toLocaleDateString('en-GB', long ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' }); }
function auChartCard(){
  var D2 = auSeries(), shown = D2.series.filter(function(s){ return s.has; });
  var h = '<div class="au-card"><div class="au-head" style="margin:0 0 4px"><div class="au-lbl" style="margin:0">Score by month</div>'
    + (D2.n ? '<button class="au-more" style="padding:0" onclick="AU.table=!AU.table;auRepaint()">' + (AU.table ? 'Show the chart' : 'Show as a table') + '</button>' : '') + '</div>';
  if(!D2.n) return h + '<div class="au-hint" style="margin-top:4px">No finished audits yet. Each one appears here, by type, in the month of the visit.</div></div>';
  if(AU.table){
    h += '<table class="au-table"><tr><th>Month</th>' + shown.map(function(s){ return '<th>' + auEsc(s.k.short) + '</th>'; }).join('') + '</tr>';
    D2.months.forEach(function(mo, i){
      if(!shown.some(function(s){ return s.pts[i]; })) return;
      h += '<tr><td>' + auEsc(auMonthName(mo, true)) + '</td>' + shown.map(function(s){ var p = s.pts[i]; return '<td>' + (p ? p.v + '% <span style="color:#8a7a62">(' + p.n + ')</span>' : '&mdash;') + '</td>'; }).join('') + '</tr>';
    });
    return h + '</table><div class="au-hint">Average overall score of the finished audits; how many in brackets.</div></div>';
  }
  var W = 640, H = 220, L = 34, R = 10, T = 10, B = 26, iw = W - L - R, ih = H - T - B;
  var x = function(i){ return L + i * iw / (D2.months.length - 1); };
  var y = function(v){ return T + ih - v / 100 * ih; };
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average audit score by month, by type">';
  [0, 25, 50, 75, 100].forEach(function(v){
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#efe6da" stroke-width="1"/>'
      + '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="#8a7a62">' + v + '%</text>';
  });
  // The Roberto's 3.0 target (85%), so a point reads as above or below it at a glance.
  svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(85) + '" y2="' + y(85) + '" stroke="#B23A00" stroke-width="1.2" stroke-dasharray="5 4"/>'
    + '<text x="' + (L + 6) + '" y="' + (y(85) - 5) + '" text-anchor="start" font-size="11" fill="#B23A00">Target 85%</text>';   // left end: the newest points sit on the right
  D2.months.forEach(function(mo, i){ if((D2.months.length - 1 - i) % 2 === 0) svg += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="#8a7a62">' + auMonthName(mo) + '</text>'; });
  shown.forEach(function(s){
    var d = '';
    s.pts.forEach(function(p, i){ if(!p) return; d += (i > 0 && s.pts[i - 1] ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1); });
    svg += '<path d="' + d + '" fill="none" stroke="' + s.k.c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    s.pts.forEach(function(p, i){ if(p) svg += '<circle cx="' + x(i) + '" cy="' + y(p.v) + '" r="5" fill="' + s.k.c + '" stroke="#fff" stroke-width="2"/>'; });
  });
  // Hover or tap: one wide target per month, bigger than the dots.
  var w = iw / (D2.months.length - 1);
  D2.months.forEach(function(mo, i){
    svg += '<rect x="' + (x(i) - w / 2) + '" y="' + T + '" width="' + w + '" height="' + ih + '" fill="transparent" onmouseenter="auTip(' + i + ')" onclick="auTip(' + i + ')" onmouseleave="auTip(null)"/>';
  });
  svg += '</svg>';
  var tip = '';
  if(AU.tip != null && shown.some(function(s){ return s.pts[AU.tip]; })){
    var on = shown.filter(function(s){ return s.pts[AU.tip]; });
    var top = Math.min.apply(null, on.map(function(s){ return y(s.pts[AU.tip].v); }));
    tip = '<div class="au-tip" style="left:' + Math.max(12, Math.min(88, x(AU.tip) / W * 100)) + '%;top:' + (top / H * 100) + '%"><b>' + auEsc(auMonthName(D2.months[AU.tip], true)) + '</b>'
      + on.map(function(s){ var p = s.pts[AU.tip]; return '<br>' + auEsc(s.k.short) + ': ' + p.v + '% (' + p.n + (p.n === 1 ? ' audit' : ' audits') + ')'; }).join('') + '</div>';
  }
  h += '<div class="au-legend">' + shown.map(function(s){ var last = null; s.pts.forEach(function(p){ if(p) last = p; }); return '<span><i style="background:' + s.k.c + '"></i>' + auEsc(s.k.short) + (last ? ' &middot; latest ' + last.v + '%' : '') + '</span>'; }).join('') + '</div>';
  return h + '<div class="au-chart">' + svg + tip + '</div></div>';
}
function auTip(i){ if(AU.tip === i) return; AU.tip = i; auRepaint(); }

// ── Admin → Audits: remove a test or a mistake, put it back. Nothing is deleted. ──
var AUA = { list: null, removed: null, err: null, loading: false, asking: null, busy: null };
async function admAuditsLoad(){
  if(AUA.loading) return; AUA.loading = true;
  try { var a = await auApi('list'), r = await auApi('removed'); AUA.list = a.audits || []; AUA.removed = r.audits || []; AUA.err = null; }
  catch(e){ AUA.err = e.message || String(e); }
  AUA.loading = false;
  if(state.currentTab === 'admin' && state.adminView === 'audits') renderMain();
}
function admAuditsHTML(){
  auCss();
  if(!fohIsAdmin()) return '<div class="adm-wrap"><div class="au-bad">Admins only.</div></div>';
  if(!AUA.list && !AUA.loading && !AUA.err) setTimeout(admAuditsLoad, 0);
  var h = '<div class="adm-wrap"><div class="au-wrap">';
  if(AUA.err) return h + '<div class="au-bad">Audits could not be read: ' + auEsc(AUA.err) + ' <button class="au-btn quiet" onclick="AUA.err=null;admAuditsLoad()">Try again</button></div></div></div>';
  if(!AUA.list) return h + '<div class="loading">Reading the audits&hellip;</div></div></div>';
  h += '<div class="au-hint" style="margin:0 2px 12px">Remove a test or a mistake. It leaves the Audits list and the chart, and stays below with who removed it and why, so it can be put back.</div>';
  h += '<div class="au-lbl">In use &middot; ' + AUA.list.length + '</div>';
  AUA.list.forEach(function(a){
    var ask = AUA.asking === a.id;
    h += '<div class="au-card" style="padding:12px 14px;margin-bottom:8px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
      + '<div class="au-main"><div class="au-name">' + auEsc(a.auditor) + '</div><div class="au-sub"><span class="au-ktag"><i style="background:' + auKind(a.kind).c + '"></i>' + auEsc(auKind(a.kind).n) + '</span>'
      + auEsc(auDate(a.visit_date)) + ' &middot; ' + auEsc(auState(a).t) + '</div></div>'
      + (ask ? '' : '<button class="au-btn quiet" onclick="admAuditAsk(\'' + auEsc(a.id) + '\')">Remove</button>') + '</div>'
      + (ask ? '<div class="au-btns"><input id="aua-why" class="au-link" style="flex:1;min-width:200px;font-family:Inter,system-ui,sans-serif" placeholder="Why? e.g. a test" maxlength="300" autocomplete="off">'
          + '<button class="au-btn" style="border-color:#8f1d12;color:#8f1d12"' + (AUA.busy ? ' disabled' : '') + ' onclick="admAuditRemove(\'' + auEsc(a.id) + '\')">Remove it</button>'
          + '<button class="au-btn quiet" onclick="AUA.asking=null;renderMain()">Cancel</button></div>' : '')
      + '</div>';
  });
  var rem = AUA.removed || [];
  h += '<div class="au-lbl" style="margin-top:22px">Removed &middot; ' + rem.length + '</div>';
  if(!rem.length) h += '<div class="au-empty">Nothing removed.</div>';
  rem.forEach(function(a){
    h += '<div class="au-card" style="padding:12px 14px;margin-bottom:8px;background:#fbf7f1"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
      + '<div class="au-main"><div class="au-name" style="color:#6b5b50">' + auEsc(a.auditor) + '</div><div class="au-sub">' + auEsc(a.visit_date ? auDate(a.visit_date) : a.title) + ' &middot; ' + auEsc(auKind(a.kind).n) + '</div>'
      + '<div class="au-sub">Removed by ' + auEsc(admAuditWho(a.removed_by)) + ', ' + auEsc(auAgo(a.removed_at)) + (a.removed_reason ? ' &middot; &ldquo;' + auEsc(a.removed_reason) + '&rdquo;' : '') + '</div></div>'
      + '<button class="au-btn quiet"' + (AUA.busy ? ' disabled' : '') + ' onclick="admAuditRestore(\'' + auEsc(a.id) + '\')">Put back</button></div></div>';
  });
  return h + '</div></div>';
}
function admAuditAsk(id){ AUA.asking = id; renderMain(); setTimeout(function(){ var e = document.getElementById('aua-why'); if(e) e.focus(); }, 0); }
function admAuditWho(e){ var u = (typeof adminFind === 'function') ? adminFind(String(e || '').toLowerCase()) : null; return (u && u.name) || String(e || '').split('@')[0]; }
async function admAuditRemove(id){
  var el = document.getElementById('aua-why'), why = ((el || {}).value || '').trim();
  if(!why){ toast('Say why it is being removed.', true); if(el) el.focus(); return; }
  AUA.busy = id; renderMain();
  try { await auApi('remove', { id: id, reason: why }); AUA.asking = null; toast('Removed. It is kept below and can be put back.'); }
  catch(e){ toast('Could not remove it: ' + (e.message || e), true); }
  AUA.busy = null; AU.list = null; await admAuditsLoad();
}
async function admAuditRestore(id){
  AUA.busy = id; renderMain();
  try { await auApi('restore', { id: id }); toast('Put back.'); }
  catch(e){ toast('Could not put it back: ' + (e.message || e), true); }
  AUA.busy = null; AU.list = null; await admAuditsLoad();
}
