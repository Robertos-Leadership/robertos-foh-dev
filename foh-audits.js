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

var AU = { me: null, list: null, total: 0, err: null, loading: false, open: null, report: null, reportErr: null,
           copied: false, replacing: false, showHow: false, filter: 'all' };

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
    if(AU.me.read){ var l = await auApi('list'); AU.list = l.audits || []; AU.total = l.total || 0; }
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
  if(a.status === 'archived') return { k: 'past', t: 'Past visit' };
  return { k: 'open', t: 'In progress · ' + a.done + ' of ' + AU.total };
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
  var all = AU.list || [];
  var n = { all: all.length, open: 0, done: 0 };
  all.forEach(function(a){ var k = auState(a).k; if(k === 'open') n.open++; if(k === 'done') n.done++; });
  var rows = all.filter(function(a){ var k = auState(a).k; return AU.filter === 'all' || k === AU.filter; });
  var chip = function(k, label){ return '<button class="au-chip' + (AU.filter === k ? ' on' : '') + '" onclick="AU.filter=\'' + k + '\';auRepaint()">' + label + ' &middot; ' + n[k] + '</button>'; };
  var h = '<div class="au-head"><div class="au-lbl" style="margin:0">Audits</div><div class="au-chips">' + chip('all', 'All') + chip('open', 'In progress') + chip('done', 'Finished') + '</div></div>';
  if(AU.list === null) return h + '<div class="loading">Reading the audits&hellip;</div>';
  if(!rows.length) return h + '<div class="au-empty">' + (all.length ? 'None here.' : 'No audits yet. Share your link and they appear here as people fill them in.') + '</div>';
  rows.forEach(function(a){
    var st = auState(a), pct = a.overall_pct;
    h += '<button class="au-row" onclick="auOpen(\'' + auEsc(a.id) + '\')">'
      + '<div class="au-main"><div class="au-name">' + auEsc(a.auditor) + '</div>'
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
    f.style.height = (d.documentElement.scrollHeight + 8) + 'px';
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
