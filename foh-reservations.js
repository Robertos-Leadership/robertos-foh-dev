// ──────────────────────────────────────────────────────────────────────────
// RESERVATIONS module (res*) — tonight's book, straight from SevenRooms.
// Asked for by Francesco 23 Jul 2026: the managers who need to see the night
// shouldn't have to open SevenRooms separately, and shouldn't need a
// SevenRooms seat to do it.
//
// WHAT IT IS — read before "improving" it:
//   A READ-ONLY window on the SevenRooms day view. It never books, moves,
//   cancels or edits anything: the hosts' system stays the single place a
//   reservation is changed, so there is no way for this screen to create a
//   conflicting truth. If a manager needs to change a booking, they call the
//   host — same as before.
//
//   Every field is computed server-side by the Kitchen `sevenrooms-sync` edge
//   function's ?daysheet= mode (the same function the closing report and the
//   Live-now strip already use). ONE call per date, one aggregated payload —
//   the browser never talks to SevenRooms and never holds a page of raw guest
//   records.
//
// PRIVACY (deliberate, don't widen it):
//   The feed returns guest NAME and the LAST 4 DIGITS of the phone only. Email,
//   address and loyalty data are dropped server-side and never reach the app.
//   Access is per-user: 'reservations' in app_users.modules, ticked by
//   Francesco in Admin → Users & Access. Default-deny — a user with no row
//   does NOT get this module (see FOH_DEFAULT_MODULES in foh-core.js).
//   Spend is additionally hidden from anyone without Revenue access, exactly
//   like the Live-now strip.
//
// Loaded as a classic <script> so its functions stay global for the inline
// onclick handlers. Uses the shared globals: state, renderMain, chkToday,
// KITCHEN_URL / KITCHEN_KEY / KITCHEN_PROXY_SECRET, fohBlocked.
// ──────────────────────────────────────────────────────────────────────────

var RES = {
  date: null,        // YYYY-MM-DD being viewed (defaults to the operational night)
  loading: false,
  data: null,        // last good payload — kept on screen while a refresh runs
  err: null,
  loadedAt: null,
  shift: 'all',      // all | the shift_category values present in the data
  q: ''              // search text
};

function resEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function resNum(n){ return Number(n||0).toLocaleString('en-US'); }
function resToday(){ return (typeof chkToday==='function') ? chkToday().iso : new Date().toISOString().slice(0,10); }
function resDateLabel(iso){
  try{ return new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}); }
  catch(e){ return iso; }
}
function resShiftDate(iso, days){
  var d = new Date(iso+'T12:00:00'); d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}
// "22 Jul" from a SevenRooms created timestamp. Never throws on a bad value —
// a missing created date shows blank, not "Invalid Date".
function resWhen(ts){
  if(!ts) return '';
  try{
    var d = new Date(String(ts).slice(0,19)+(String(ts).indexOf('Z')>-1?'':'Z'));
    if(isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  }catch(e){ return ''; }
}

// ── LOAD ──────────────────────────────────────────────────────────────────
// One POST to the Kitchen edge function per date. The previous payload stays
// on screen while this runs, so a refresh never blanks the night. Any failure
// leaves a plain sentence and a Try again button — never an error object.
async function resLoad(force){
  if(RES.loading) return;
  var d = RES.date || (RES.date = resToday());
  if(!force && RES.data && RES.data.date === d) return;
  RES.loading = true; RES.err = null;
  if(typeof renderMain==='function' && state.currentTab==='reservations') renderMain();
  try{
    var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?daysheet=' + d, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    var j = await r.json();
    if(!j || !j.ok) throw new Error((j && j.error) || 'no data');
    // An edge function that predates the ?daysheet= mode ignores the parameter
    // and answers with its normal-mode payload — which is ok:true but carries no
    // reservations. Without this check that reads as "empty night", which is a
    // lie. Treat a payload with no reservations array as not-deployed-yet.
    if(!Array.isArray(j.reservations)) throw new Error('daysheet mode not deployed');
    RES.data = j;
    RES.loadedAt = new Date();
    RES.err = null;
  }catch(e){
    console.warn('[reservations] load failed', e);
    RES.err = (String(e && e.message).indexOf('not deployed') > -1)
      ? 'This screen is waiting on the SevenRooms connection being switched on.'
      : 'Could not reach SevenRooms just now.';
  }
  RES.loading = false;
  if(typeof renderMain==='function' && state.currentTab==='reservations') renderMain();
}

function resGo(days){ RES.date = resShiftDate(RES.date || resToday(), days); RES.data = null; resLoad(true); }
function resSetDate(v){ if(!v) return; RES.date = v; RES.data = null; resLoad(true); }
function resToTonight(){ RES.date = resToday(); RES.data = null; resLoad(true); }
function resRefresh(){ resLoad(true); }
function resSetShift(s){ RES.shift = s; renderMain(); }
function resSearch(v){ RES.q = String(v||'').toLowerCase(); renderMain(); }

// Auto-refresh: only while this screen is open AND only for tonight — a past
// date can't change, so polling it would be pure waste. Registered once.
if(!window._resTimer){
  window._resTimer = setInterval(function(){
    if(state && state.currentTab==='reservations' && RES.date===resToday() && !RES.loading) resLoad(true);
  }, 90000);
}

// ── FILTERING ─────────────────────────────────────────────────────────────
function resRows(){
  var rows = (RES.data && RES.data.reservations) ? RES.data.reservations : [];
  if(RES.shift !== 'all') rows = rows.filter(function(r){ return (r.shift||'') === RES.shift; });
  if(RES.q){
    rows = rows.filter(function(r){
      var hay = [r.name, (r.tables||[]).join(' '), r.notes, r.booked_by, r.area, r.status_display, r.phone_last4]
        .join(' ').toLowerCase();
      return hay.indexOf(RES.q) !== -1;
    });
  }
  return rows;
}
function resShifts(){
  var seen = {}, out = [];
  ((RES.data && RES.data.reservations) || []).forEach(function(r){
    if(r.shift && !seen[r.shift]){ seen[r.shift] = 1; out.push(r.shift); }
  });
  return out;
}

// ── RENDER ────────────────────────────────────────────────────────────────
function renderReservations(){
  if(!RES.date) RES.date = resToday();
  if(!RES.data && !RES.loading && !RES.err){ setTimeout(function(){ resLoad(true); }, 0); }

  var money = !fohBlocked('revenue');           // spend hidden without Revenue
  var isTonight = RES.date === resToday();
  // The money column changes the grid, so the flag rides on the wrapper —
  // one class, not a second copy of the column widths.
  var h = ['<div class="res-wrap'+(money?' res-money':'')+'">'];

  // ── Header: which night, and how to move between nights ──
  h.push('<div class="res-head">');
  h.push('<div class="res-head-l">');
  h.push('<div class="res-kicker">SevenRooms &middot; live</div>');
  h.push('<div class="res-title">'+resEsc(resDateLabel(RES.date))+(isTonight?' <span class="res-tonight">tonight</span>':'')+'</div>');
  h.push('</div>');
  h.push('<div class="res-head-r">');
  h.push('<button class="res-nav" onclick="resGo(-1)" title="Previous day">&#8249;</button>');
  h.push('<input class="res-date" type="date" value="'+resEsc(RES.date)+'" onchange="resSetDate(this.value)">');
  h.push('<button class="res-nav" onclick="resGo(1)" title="Next day">&#8250;</button>');
  if(!isTonight) h.push('<button class="res-btn" onclick="resToTonight()">Tonight</button>');
  h.push('<button class="res-btn" onclick="resRefresh()"'+(RES.loading?' disabled':'')+'>'+(RES.loading?'Refreshing…':'Refresh')+'</button>');
  h.push('</div></div>');

  if(RES.err){
    h.push('<div class="res-problem"><div class="res-problem-t">'+resEsc(RES.err)+'</div>'
      + '<div class="res-problem-s">Nothing is broken in the app — this screen only reads SevenRooms, so it will fill in as soon as the connection is back.</div>'
      + '<button class="res-btn" onclick="resRefresh()">Try again</button></div>');
    h.push('</div>'); return h.join('');
  }
  if(!RES.data){
    h.push('<div class="res-loading">Reading the book from SevenRooms…</div>');
    h.push('</div>'); return h.join('');
  }

  // ── The night in numbers ──
  var t = RES.data.totals || {};
  h.push('<div class="res-tot">'
    + '<div class="res-tot-i"><b>'+resNum(t.reservations)+'</b><span>Reservations</span></div>'
    + '<div class="res-tot-i"><b>'+resNum(t.covers)+'</b><span>Covers</span></div>'
    + '<div class="res-tot-i"><b>'+resNum(t.seated)+'</b><span>In now</span></div>'
    + '<div class="res-tot-i"><b>'+resNum(t.upcoming)+'</b><span>Still to come</span></div>'
    + '<div class="res-tot-i"><b>'+resNum(t.completed)+'</b><span>Finished</span></div>'
    + '</div>');

  // ── Filters: shift chips (only when the night actually has more than one)
  //    and a search that covers name, table, note and who booked it. ──
  var shifts = resShifts();
  h.push('<div class="res-tools">');
  if(shifts.length > 1){
    h.push('<div class="res-chips">');
    h.push('<button class="res-chip'+(RES.shift==='all'?' on':'')+'" onclick="resSetShift(\'all\')">All day</button>');
    shifts.forEach(function(s){
      h.push('<button class="res-chip'+(RES.shift===s?' on':'')+'" onclick="resSetShift(\''+resEsc(s).replace(/'/g,"\\'")+'\')">'+resEsc(s)+'</button>');
    });
    h.push('</div>');
  }
  h.push('<input class="res-srch" type="search" placeholder="Search guest, table, note or who booked it" value="'+resEsc(RES.q)+'" oninput="resSearch(this.value)">');
  h.push('</div>');

  var rows = resRows();
  if(!rows.length){
    h.push('<div class="res-empty">'
      + (RES.q || RES.shift!=='all'
          ? 'No booking matches that.'
          : 'No reservations in the book for '+resEsc(resDateLabel(RES.date))+'.')
      + '</div>');
  } else {
    // ── Grouped by seating area, biggest room first — the way the hosts read
    //    the day view. Each area header carries its own count. ──
    var byArea = {}, order = [];
    rows.forEach(function(r){
      var k = r.area || 'Any Seating Area';
      if(!byArea[k]){ byArea[k] = []; order.push(k); }
      byArea[k].push(r);
    });
    order.sort(function(a,b){
      var ca = byArea[a].reduce(function(s,r){ return s+(r.pax||0); },0);
      var cb = byArea[b].reduce(function(s,r){ return s+(r.pax||0); },0);
      return cb-ca;
    });
    order.forEach(function(k){
      var list = byArea[k];
      var cov = list.reduce(function(s,r){ return s+(r.pax||0); },0);
      h.push('<div class="res-area">'+resEsc(k)+' <span>'+list.length+' reservation'+(list.length===1?'':'s')+' &middot; '+cov+' covers</span></div>');
      h.push('<div class="res-tbl">');
      h.push('<div class="res-r res-hdr">'
        + '<div>Time</div><div>Covers</div><div>Guest</div><div>Table</div>'
        + '<div>Status</div><div>Note</div><div>Booked by</div>'
        + (money?'<div class="res-right">Spend</div>':'')
        + '</div>');
      list.forEach(function(r){
        var st = (r.state==='seated') ? 'seated' : (r.state==='completed' ? 'done' : 'due');
        h.push('<div class="res-r res-'+st+'">'
          + '<div class="res-time">'+resEsc(r.time||'')+'</div>'
          + '<div class="res-pax">'+resNum(r.pax)+(r.arrived?'<i> · '+resNum(r.arrived)+' in</i>':'')+'</div>'
          + '<div class="res-name">'+(r.vip?'<span class="res-vip" title="VIP">VIP</span> ':'')+resEsc(r.name)
              + (r.phone_last4?'<i class="res-phone">••• '+resEsc(r.phone_last4)+'</i>':'')+'</div>'
          // Blank, not "not assigned": verified 23 Jul that SevenRooms' API only
          // returns a table once the hosts LOCK it (10 of 13 bookings that night
          // came back empty while the SevenRooms screen showed an auto-suggested
          // table beside a scissors icon). The kitchen floorplan feed counts the
          // same 10 as unassigned, so this is the API, not this screen. Claiming
          // "not assigned" would contradict what the hosts can see.
          + '<div class="res-tbls">'+((r.tables&&r.tables.length)?resEsc(r.tables.join(', ')):'<i>&mdash;</i>')+'</div>'
          + '<div><span class="res-pill res-pill-'+st+'">'+resEsc(r.status_display||r.status||'')+'</span></div>'
          + '<div class="res-note" title="'+resEsc(r.notes||'')+'">'+resEsc(r.notes||'')+'</div>'
          + '<div class="res-by">'+resEsc(r.booked_by||'')+(r.created?'<i>'+resEsc(resWhen(r.created))+'</i>':'')+'</div>'
          + (money?'<div class="res-right">'+(r.spend?('<small>AED </small>'+resNum(Math.round(r.spend))):'')+'</div>':'')
          + '</div>');
      });
      h.push('</div>');
    });
  }

  // ── Footer: what this screen is, so nobody expects it to book a table. ──
  h.push('<div class="res-foot">Read-only view of SevenRooms'
    + (RES.loadedAt? ' &middot; updated '+RES.loadedAt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '')
    + (isTonight ? ' &middot; refreshes on its own every 90 seconds' : '')
    + '. To add, move or cancel a booking, the hosts do it in SevenRooms.</div>');

  h.push('</div>');
  return h.join('');
}
