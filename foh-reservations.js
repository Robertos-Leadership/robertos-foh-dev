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
// ── Per-reservation money (added 28 Jul 2026, asked for by Nicole) ────────────
// She needs what a table actually spent, gross AND net, plus the average per
// person. The gross is the SevenRooms check subtotal, which is the menu-price
// total the guest paid; net is that / 1.225, the verified stack (10% service +
// 7% municipality on net, 5% VAT on net+SC).
//
// THE THING TO NOT FORGET: these figures cover only the bookings SevenRooms has
// a linked check for. A walk-in served without a booking has no reservation to
// attach a check to, so the column NEVER sums to the night's revenue. Checked
// against rev_daily (Simphony, the revenue truth) for 20-25 Jul 2026 it came to
// 83-98% of net and the gap moved every night. That is why the footer states the
// coverage instead of quietly printing a total that contradicts the closing
// report. Simphony stays the only source for "what did we take".
//
// LT_GROSS_TO_NET is defined once in foh-core.js -- read it, never re-type 1.225.
function resGrossToNet(){ return (typeof LT_GROSS_TO_NET === 'number' && LT_GROSS_TO_NET > 0) ? LT_GROSS_TO_NET : 1.225; }
function resNet(gross){ return (Number(gross)||0) / resGrossToNet(); }
function resMoney0(n){ return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:0}); }
// The gross on a booking. Prefers the new `gross` field (check SUBTOTAL) and
// falls back to the old `spend` (check TOTAL, i.e. subtotal + tips) only while an
// app build is running against an edge function that predates the split -- a tip
// on top is a far smaller error than showing nothing at all.
function resGrossOf(r){ return Number(r && (r.gross != null ? r.gross : r.spend)) || 0; }
// How many people to divide by: the BOOKED party size, which is what SevenRooms
// calls covers and what the Covers column beside it shows.
//
// This used to prefer `arrived` and fall back to booked, on the reasoning that
// the people who actually ate are the truer denominator. Checked against the
// live book 28 Jul and that reasoning fails on the data: SevenRooms only carries
// `arrived` on about 20% of bookings (9 of 39 on 23 Jul, 14 of 66 on 24 Jul, 11
// of 56 on 25 Jul). So "arrived else booked" was never the arrived basis -- it
// was a HYBRID, four fifths booked and one fifth arrived, which is neither thing
// and reconciles to nothing.
//
// It also moved the answer: net per guest read 509.92 on 23 Jul against 487.08
// on the booked basis, and 349.74 vs 330.19 on 25 Jul -- up to 5.9% out, on the
// headline number Nicole reports. And it contradicted the screen, where the
// Covers column, the area headers and the night tile all count booked covers
// exactly as SevenRooms does.
//
// One basis, matching SevenRooms. The export still carries an Arrived column, so
// anyone who wants the arrived view can work it out from the file.
function resHeads(r){ return Number(r && r.pax) || 0; }
// The night's money, counted the SAME way the rows are.
//
// WHY THIS IS COMPUTED HERE and not read off totals.covers_with_money: the edge
// function counts heads as the BOOKED size, the rows count them as the ARRIVED
// size (resHeads). On 24 Jul that is 178 vs 176 people, which put two different
// "net per guest" figures on one screen -- 317.15 on the tile against 320.75 down
// the column. Small, and exactly the kind of drift that makes someone stop
// trusting the screen. One rule, applied once, used by the tile, the area lines
// and every row.
// Takes an explicit rows list so the date-range export can count a night that is
// NOT the one on screen. No argument = tonight's book, exactly as before.
function resNightMoney(rowsIn){
  var out = { gross:0, heads:0, bookings:0 };
  var rows = rowsIn || (RES.data && RES.data.reservations) || [];
  rows.forEach(function(r){
    var g = resGrossOf(r);
    if(!g) return;
    out.gross += g; out.heads += resHeads(r); out.bookings++;
  });
  out.net = resNet(out.gross);
  return out;
}
// One booking's money: gross, net, and the average per person.
function resSpendCell(r){
  var g = resGrossOf(r);
  // No linked check is NOT zero spend, and must never look like it. A dim dash
  // that says why beats both a blank cell (reads as "nothing here") and a 0
  // (reads as "they spent nothing").
  if(!g) return '<i class="res-sp-none" title="No check linked to this booking in SevenRooms yet">&mdash;</i>';
  var n = resNet(g), heads = resHeads(r);
  var pp = heads ? '<div class="res-sp-pp">'+resMoney0(g/heads)+' &middot; '+resMoney0(n/heads)+' per guest</div>' : '';
  return '<div class="res-sp" title="Gross AED '+resMoney0(g)+' (menu price, what the guest paid) &#10;Net AED '+resMoney0(n)+' (gross / '+resGrossToNet()+')'
    + (heads?' &#10;Over '+heads+' guest'+(heads===1?'':'s'):'')+'">'
    + '<div class="res-sp-g"><small>AED </small>'+resMoney0(g)+'</div>'
    + '<div class="res-sp-n"><small>AED </small>'+resMoney0(n)+' net</div>'
    + pp + '</div>';
}
function resNum(n){ return Number(n||0).toLocaleString('en-US'); }
function resToday(){ return (typeof chkToday==='function') ? chkToday().iso : new Date().toISOString().slice(0,10); }
function resDateLabel(iso){
  try{ return new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}); }
  catch(e){ return iso; }
}
// A past visit date, said so nobody can misread it. resDateLabel prints weekday
// + day + month with NO year, which is right for tonight but a lie for an old
// visit: "Friday 8 February" for a guest last in on 2024-02-08 reads as this
// year and is two and a half years out. Verified 28 Jul that tonight's own book
// holds last-visit dates in 2024, 2025 and 2026, so this is real, not theory.
// Same year -> weekday is useful ("Tuesday 3 February"). Any other year -> drop
// the weekday, which means nothing at that distance, and state the year.
function resVisitLabel(iso){
  var s = String(iso||'').slice(0,10);
  if(!s) return '';
  try{
    var d = new Date(s+'T12:00:00');
    if(isNaN(d.getTime())) return s;
    var thisYear = (typeof chkToday==='function' ? chkToday().iso : new Date().toISOString().slice(0,10)).slice(0,4);
    return (s.slice(0,4) === thisYear)
      ? d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})
      : d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  }catch(e){ return s; }
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
// One night, fetched and validated, with NO state touched. Split out of resLoad
// 28 Jul so the date-range export can read a night without hijacking the screen:
// the range export must never leave a different date on the book behind it.
async function resFetchDaysheet(d){
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
  return j;
}

async function resLoad(force){
  if(RES.loading) return;
  var d = RES.date || (RES.date = resToday());
  if(!force && RES.data && RES.data.date === d) return;
  RES.loading = true; RES.err = null;
  if(typeof renderMain==='function' && state.currentTab==='reservations') renderMain();
  try{
    var j = await resFetchDaysheet(d);
    RES.data = j;
    RES.loadedAt = new Date();
    RES.err = null;
    // Fetch the guests' history alongside, but never block the book on it: the
    // night has to be on screen whether or not SevenRooms answers for the
    // profiles. Only ids not already cached are requested.
    setTimeout(function(){ resEnsureHistory(); }, 0);
    // Same rule for the public-figure check: alongside, never in the way. It
    // is switched off by default and answers "off" in a single round trip, so
    // on most nights this costs one request and changes nothing on screen.
    setTimeout(function(){ resVipScan(); }, 0);
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
  // The guest panel lives on <body>, so it would outlive a tab change and
  // hang over an unrelated screen. Sweep it as soon as the tab moves.
  window._resGuestSweep = setInterval(function(){
    if(typeof RESG!=='undefined' && RESG.open && state && state.currentTab!=='reservations') resCloseGuest();
    // Same for the range dialog — but never while it is mid-download, or she
    // loses ten nights of reading for a stray tab tap.
    if(typeof RESR!=='undefined' && RESR.open && !RESR.busy && state && state.currentTab!=='reservations') resRangeClose();
  }, 400);
}

// ── GUEST PANEL ───────────────────────────────────────────────────────────
// Tap a name → their history. Asked for by Francesco 28 Jul 2026: the whole
// point of this screen is that a manager shouldn't need a SevenRooms seat, and
// "who is this guest" is the question the book can't answer on its own.
//
// The numbers come from the SevenRooms CLIENT record via the Kitchen edge
// function's ?guest= mode — NOT from the booking. Verified 28 Jul: reservation
// objects carry no linked check on any date tested, while the client record
// carries the real lifetime figures (of 25 guests on 27 Jul, all 8 repeat
// guests had spend; top AED42,386 / 145 visits). A first-timer legitimately
// reads 0, which is why this screen says "first visit" rather than "AED 0".
//
// The edge function returns counting fields, tags and the guest note only —
// no email, phone, address, birthday or loyalty id ever reaches the browser.
// Spend is additionally hidden from anyone without Revenue access, exactly
// like the Spend column and the Live-now strip.
var RESG = {
  open: false,
  id: null,          // SevenRooms client id being shown
  row: null,         // tonight's booking for that guest (already on screen)
  data: null,
  loading: false,
  err: null,
  cache: {}          // id → payload; a guest's lifetime total doesn't move
                     // during a service, so re-tapping a name is free.
};

function resGuestEl(){
  var el = document.getElementById('res-guest');
  if(!el){
    el = document.createElement('div');
    el.id = 'res-guest';
    document.body.appendChild(el);
    // Close on backdrop tap, but ONLY on the backdrop itself — a tap that
    // lands inside the card must never dismiss it.
    el.addEventListener('click', function(e){ if(e.target === el) resCloseGuest(); });
  }
  return el;
}

function resPaintGuest(){
  var el = resGuestEl();
  el.innerHTML = RESG.open ? resGuestHtml() : '';
  el.className = RESG.open ? 'rg-ov' : '';
}

function resOpenGuest(id, time){
  if(!id && !time) return;
  var list = (RES.data && RES.data.reservations) || [];
  // Match on time as well as id: a guest with two bookings tonight must open
  // the one whose row was actually tapped.
  RESG.row = null;
  if(!id){
    // No client record, but the table has a check on it — the panel opens on
    // the booking alone so the order is still readable. Matched on time, which
    // is all the row has to identify itself by. No history is fetched, and the
    // panel simply shows tonight rather than an empty history frame.
    for(var k=0;k<list.length;k++){ if(list[k].time === time && !list[k].client){ RESG.row = list[k]; break; } }
    if(!RESG.row) return;
    RESG.open = true; RESG.id = null; RESG.err = null; RESG.data = null; RESG.loading = false;
    resPaintGuest();
    return;
  }
  for(var i=0;i<list.length;i++){
    if(list[i].client === id && (!time || list[i].time === time)){ RESG.row = list[i]; break; }
  }
  if(!RESG.row){ for(var j=0;j<list.length;j++){ if(list[j].client === id){ RESG.row = list[j]; break; } } }
  RESG.open = true; RESG.id = id; RESG.err = null;
  // Keyed by id AND date: the visit list is "everything before this night", so
  // the same guest viewed on a different night is a different answer. Keying on
  // id alone would show last Tuesday's book a history that stops at Monday.
  if(RESG.cache[id + '|' + (RES.date||'')]){
    RESG.data = RESG.cache[id + '|' + (RES.date||'')]; RESG.loading = false; resPaintGuest(); return;
  }
  RESG.data = null; RESG.loading = true;
  resPaintGuest();
  // The venue comes off the booking, never from a constant here: the guest's
  // figures have to be read for the venue they're sitting in tonight.
  resLoadGuest(id, (RESG.row && RESG.row.venue) || '');
}

function resCloseGuest(){
  RESG.open = false; RESG.data = null; RESG.err = null; RESG.loading = false;
  resPaintGuest();
}

// Esc closes it, the way every other overlay in the app behaves. Registered
// once, and a no-op while the panel is shut.
if(!window._resGuestKey){
  window._resGuestKey = true;
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && RESG.open) resCloseGuest();
  });
}

async function resLoadGuest(id, venue){
  try{
    // `before` is the night being viewed, not today: the edge function returns
    // visits strictly before it, so tonight never appears in its own history --
    // which is the entire point, since SevenRooms stamps today onto the guest
    // the moment they sit down.
    var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?guest=' + encodeURIComponent(id)
        + (venue ? '&venue=' + encodeURIComponent(venue) : '')
        + (RES.date ? '&before=' + encodeURIComponent(RES.date) : ''), {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    var j = await r.json();
    if(!j || !j.ok) throw new Error((j && j.error) || 'no data');
    RESG.cache[id + '|' + (RES.date||'')] = j;
    if(RESG.id === id){ RESG.data = j; RESG.err = null; }
  }catch(e){
    console.warn('[reservations] guest load failed', e);
    // The booking on screen is still true even when the profile won't load —
    // say what's missing, don't blank the panel.
    if(RESG.id === id) RESG.err = 'Could not read this guest’s history from SevenRooms just now.';
  }
  if(RESG.id === id){ RESG.loading = false; resPaintGuest(); }
}

function resMoney(n){ return '<small>AED </small>' + resNum(Math.round(Number(n)||0)); }

// ── THEIR LAST VISITS ─────────────────────────────────────────────────────
// The three nights before this one, from SevenRooms' own reservation history
// on the guest profile — the same list the hosts read in SevenRooms, not a
// ledger we built.
//
// TONIGHT IS EXCLUDED, and that is the entire point of the feature. Once a
// guest is seated SevenRooms writes today into their history and into the
// last-visit date, so the "Last here" column starts reading "today" for every
// guest in the room and the previous visit — the one a manager actually wants
// before they walk to the table — disappears from the screen. Filtering on the
// date being viewed (not on "today") also keeps this honest when a manager is
// looking back at a past night's book.
//
// Three, because that is what was asked for and because a host reads this
// standing next to a table. The edge function returns up to 12, so a longer
// list is a display change here and not another deploy.
function resVisitsHtml(g, money){
  if(!g || !g.visits_have){
    // "SevenRooms didn't send a list" and "this guest has never been" are the
    // same empty array, and printing "no previous visits" for a 63-visit guest
    // would be a lie the hosts would catch. Say nothing rather than say wrong.
    return '';
  }
  var here = (RES && RES.date) || '';
  var past = (g.visits_recent || []).filter(function(v){ return v.date && v.date !== here; });
  if(!past.length) return '';
  var h = ['<div class="rg-visits"><div class="rg-visits-h">Last visits</div>'];
  past.slice(0, 3).forEach(function(v){
    h.push('<div class="rg-visit' + (v.cancelled ? ' rg-visit-x' : '') + '">');
    h.push('<b>' + resEsc(resVisitLabel(v.date)) + '</b>');
    var bits = [];
    if(v.covers) bits.push(resNum(v.covers) + ' cover' + (v.covers === 1 ? '' : 's'));
    // SevenRooms' own table numbers carry trailing dots on historic bookings
    // ("137..", "22." on the live record, 1 Aug 2026) -- an artefact of how the
    // table was typed years ago, not part of the name. Trimmed here rather than
    // in the edge function so a cosmetic fix never needs a redeploy of it.
    var tbl = String(v.tables||'').replace(/[.\s]+$/, '').trim();
    if(tbl) bits.push('table ' + resEsc(tbl));
    // A cancelled night is shown as cancelled and never carries a spend figure
    // beside it — a host reading "24 Aug · AED 0" would take it as a guest who
    // came and spent nothing, which is a different guest entirely.
    if(v.cancelled) bits.push('cancelled');
    else if(money && Number(v.spend) > 0) bits.push(resMoney(v.spend));
    h.push('<span>' + bits.join(' &middot; ') + '</span>');
    h.push('</div>');
  });
  h.push('</div>');
  return h.join('');
}

// ── WHAT THEY ORDERED ─────────────────────────────────────────────────────
// The table's own Simphony check, line by line, on the booking a manager just
// tapped. It rides on the day-sheet payload the book already holds, so opening
// this costs no extra call and works the same on a phone on the floor.
//
// THE ONE THING THIS MUST NEVER DO IS SAY "NOTHING". SevenRooms links the
// Simphony check on a delay — measured 7 Aug 2026: 6 Aug's 39 tickets were all
// there by 05:49 the next morning, 2 Aug never posted one at all. So a booking
// with no list has an unlinked check, not an empty one, and a manager reading
// "no items" beside a table that has just eaten four courses would rightly stop
// trusting the screen. The edge function sends null for that case and this says
// the check hasn't come through — different words, different meaning.
//
// Prices follow the same rule as the spend column: hidden without Revenue
// access. The dishes themselves are not money and stay, because knowing what
// the table ate is the job of anyone standing in front of it.
function resOrderHtml(row, money){
  var items = (row && row.items) || null;
  if(!Array.isArray(items) || !items.length){
    // Only worth saying for a table that is actually here — a booking that
    // hasn't arrived yet has no check to link, and printing a caveat on every
    // upcoming row would be noise.
    if(row && (row.state === 'seated' || row.state === 'completed')){
      return '<div class="rg-ord"><div class="rg-ord-h">What they ordered</div>'
        + '<div class="rg-ord-none">The check hasn’t come through from Simphony yet.</div></div>';
    }
    return '';
  }
  var h = ['<div class="rg-ord"><div class="rg-ord-h">What they ordered'
    + (row.check_open ? '<span class="rg-ord-live">check still open</span>' : '')
    + '</div>'];
  var total = 0;
  items.forEach(function(it){
    // Simphony's price IS the line total — reconciled 7 Aug 2026 against checks
    // 18979 / 18968 / 18974, which tie to the sum of their prices exactly.
    // Multiplying it by the quantity put 983 on a 713 check. Do not multiply.
    var line = Number(it.price)||0;
    total += line;
    h.push('<div class="rg-ord-i">');
    h.push('<b>' + ((Number(it.qty)||1) > 1 ? resNum(it.qty) + '&times; ' : '') + resEsc(it.name) + '</b>');
    // Three cases, and collapsing them cost a real number on the first pass.
    // A zero-priced line is a real thing on the check — the bread basket, the
    // Arabic coffee, a comp — so it reads "incl." rather than "AED 0", which a
    // manager would take as a pricing error. But a DISCOUNT is also a check
    // line and it is NEGATIVE ("20% DIFC Disc", -102.80 on the 6 Aug bar
    // check): printing that as "incl." hides money coming off the bill, on the
    // one screen a manager would use to check a bill. It shows as a minus.
    h.push('<span>' + (money
      ? (line > 0 ? resMoney(line)
        : line < 0 ? '&minus;' + resMoney(-line)
        : '<i>incl.</i>')
      : '') + '</span>');
    var sub = [];
    if(it.mods && it.mods.length) sub.push(it.mods.join(', '));
    if(it.note) sub.push(it.note);
    if(sub.length) h.push('<em>' + resEsc(sub.join(' · ')) + '</em>');
    h.push('</div>');
  });
  if(money && total > 0){
    // The figure shown is the booking's own gross — the same number the spend
    // column and every export in this module already print — so one booking can
    // never carry two different check totals in one app. The item sum is the
    // fallback only when the booking has no gross of its own.
    var shown = resGrossOf(row) || total;
    h.push('<div class="rg-ord-t"><b>Check</b><span>' + resMoney(shown) + '</span></div>');
    // THE LINES DO NOT ALWAYS ADD UP TO THE CHECK, and pretending otherwise is
    // how a manager ends up arguing with a guest. Measured 7 Aug 2026 over two
    // real nights: 6 Aug, 30 of 37 tie exactly and the rest are off by -55, -25,
    // -15, -10, -5, +60, +525; 5 Aug, 20 of 27 tie and the rest by -40, -15,
    // -10, -5, +50, +60, +60. The big one is lines of 1,879 against a 1,354
    // check — what a voided or transferred item looks like from here.
    // The check figure above is the booking's own gross, the same number the
    // rest of the module prints, so the total is never in doubt. This line only
    // warns that the itemisation beneath it is not the whole story.
    if(Math.abs(total - shown) > 0.5){
      h.push('<div class="rg-ord-warn">These lines don’t add up to the check — items may have been moved or voided. Simphony has the final word.</div>');
    }
  }
  h.push('</div>');
  return h.join('');
}

function resGuestHtml(){
  var row = RESG.row || {};
  var g = RESG.data;
  var money = !fohBlocked('revenue');
  var h = ['<div class="rg-card" role="dialog" aria-modal="true" aria-label="Guest history">'];

  h.push('<div class="rg-head">');
  h.push('<div><div class="rg-kicker">'+(RESG.id?'Guest history':'This booking')+' &middot; SevenRooms</div>');
  h.push('<div class="rg-name">'+(row.vip?'<span class="res-vip">VIP</span> ':'')+resEsc(row.name||'Guest')+'</div></div>');
  h.push('<button class="rg-x" onclick="resCloseGuest()" aria-label="Close">&times;</button>');
  h.push('</div>');

  // ── Tonight first: the manager tapped this name because of tonight. ──
  h.push('<div class="rg-tonight">');
  h.push('<b>'+resEsc(row.time||'')+'</b> &middot; '+resNum(row.pax)+' cover'+(row.pax===1?'':'s')
    + (row.area?' &middot; '+resEsc(row.area):'')
    + ((row.tables&&row.tables.length)?' &middot; table '+resEsc(row.tables.join(', ')):''));
  if(row.notes) h.push('<div class="rg-tonight-n">'+resEsc(row.notes)+'</div>');
  h.push('</div>');

  // Their check sits directly under tonight's booking and above the lifetime
  // history: a manager walking to a seated table wants what is on THAT table
  // first. It needs no fetch — the day sheet already carries it.
  h.push(resOrderHtml(row, money));

  if(RESG.loading){
    h.push('<div class="rg-load">Reading their history…</div>');
  } else if(RESG.err){
    h.push('<div class="rg-err">'+resEsc(RESG.err)+'<div class="rg-err-s">Tonight’s booking above is unaffected.</div></div>');
  } else if(g){
    // Numbers ONLY when they came back scoped to this venue. The group-wide
    // totals are a different measure that disagrees with the profile the hosts
    // read in SevenRooms (verified 28 Jul: 70 visits / AED22,259 group against
    // 47 / AED62,715 on the page), so showing them would put a figure on the
    // floor that contradicts the hosts' own screen. Tags and the note still
    // stand on their own, so the panel is still worth opening.
    var scoped = g.scope === 'venue';
    var firstTime = (Number(g.visits)||0) <= 1;
    if(!scoped){
      h.push('<div class="rg-first">Their history for this venue isn’t available — tags and notes below still apply.</div>');
    } else if(firstTime && !(Number(g.spend)>0)){
      h.push('<div class="rg-first">First visit — no history yet.</div>');
    } else {
      // Only the figures we actually have. Spend disappears entirely without
      // Revenue access rather than showing a blank box that invites a question.
      var stats = [
        ['Visits', resNum(g.visits)],
        ['Covers', resNum(g.covers)]
      ];
      if(money){
        stats.push(['Total spend', resMoney(g.spend)]);
        if(Number(g.per_cover)>0) stats.push(['Avg per cover', resMoney(g.per_cover)]);
      }
      if(Number(g.noshows)>0) stats.push(['No-shows', resNum(g.noshows)]);
      if(Number(g.cancellations)>0) stats.push(['Cancelled', resNum(g.cancellations)]);
      h.push('<div class="rg-stats">');
      stats.forEach(function(s){ h.push('<div class="rg-stat"><b>'+s[1]+'</b><span>'+s[0]+'</span></div>'); });
      h.push('</div>');
      if(g.last_visit){
        h.push('<div class="rg-last">Last visit '+resEsc(resVisitLabel(g.last_visit))+'</div>');
      }
      h.push(resVisitsHtml(g, money));
    }
    if(g.note) h.push('<div class="rg-note"><span>Note on file</span>'+resEsc(g.note)+'</div>');
    if(g.tags && g.tags.length){
      h.push('<div class="rg-tags">');
      g.tags.forEach(function(t){ h.push('<span class="rg-tag">'+resEsc(t)+'</span>'); });
      h.push('</div>');
    }
  }

  h.push('<div class="rg-foot">Read-only from SevenRooms'
    + (money?'':' &middot; spend is hidden on your access')
    + '. To change anything about this guest, the hosts do it in SevenRooms.</div>');
  h.push('</div>');
  return h.join('');
}

// ── GUEST HISTORY FOR THE WHOLE BOOK ──────────────────────────────────────
// Asked for by Francesco 28 Jul: last visit and average spend per person on the
// book itself, and a printable version to brief the team before service.
//
// ONE call for the night, not one per booking. A busy Sunday carries 47
// bookings and firing 47 requests off a phone on the floor is exactly the kind
// of thing that makes an app feel broken. The edge function's ?guests= mode
// takes every id at once and answers with a map.
//
// The cache is keyed by GUEST, never by date: a lifetime total doesn't change
// because you looked at a different night, and the 90-second auto-refresh must
// not re-fetch 47 profiles every minute and a half. Only ids we've never seen
// are ever requested. A guest whose record can't be read is remembered as
// failed so the app doesn't retry them on a loop -- their row simply shows no
// history, which is honest.
// `pending` holds the in-flight fetch so a second caller can AWAIT it instead of
// being turned away. See resEnsureHistory for why that matters.
var RESH = { loading: false, err: null, got: {}, failed: {}, pending: null };

function resHistVenue(){
  var list = (RES.data && RES.data.reservations) || [];
  for (var i = 0; i < list.length; i++) if (list[i].venue) return list[i].venue;
  return '';
}

// Callers that need the history BEFORE they produce something (the print brief,
// the Excel export) must await this and actually get the data.
//
// THE BUG THIS FIXES (Nicole, 28 Jul): her exported file had Gross filled in but
// Visits, Lifetime net per cover and Last visit all blank -- and those three are
// the only columns that come from this second fetch. It was reported as "she's on
// a Mac"; the Mac had nothing to do with it. The screen kicks this off in the
// background as soon as the book lands, and the old first line was
// `if (RESH.loading) return;` -- so a caller arriving while that background fetch
// was still running was turned away IMMEDIATELY and carried on with an empty
// cache. Press Excel within the few seconds the profiles take (76 guests go out
// in chunks of 8, so ~10 round trips) and you got a file with those columns
// blank. Wait a moment first and it was fine, which is exactly why it looked like
// someone's machine rather than a race.
//
// Now the in-flight promise is handed back so a second caller waits for it, then
// re-checks in case the date changed under it and there are new ids to fetch.
// The Print brief button was never hit by this because it disables itself while
// RESH.loading; the Excel button had no such guard, which is on me.
async function resEnsureHistory(){
  if (RESH.pending){
    try{ await RESH.pending; }catch(e){}
    // A second pass only if genuinely new ids appeared while we waited.
    var still = ((RES.data && RES.data.reservations) || []).some(function(r){
      return r.client && !RESH.got[r.client] && !RESH.failed[r.client];
    });
    if (!still) return;
  }
  var list = (RES.data && RES.data.reservations) || [];
  var want = [];
  for (var i = 0; i < list.length; i++){
    var id = list[i].client;
    if (id && !RESH.got[id] && !RESH.failed[id] && want.indexOf(id) === -1) want.push(id);
  }
  if (!want.length) return;
  RESH.loading = true; RESH.err = null;
  if (typeof renderMain === 'function' && state.currentTab === 'reservations') renderMain();
  // The work is wrapped in a promise parked on RESH.pending, so anyone who calls
  // while it runs can await THIS rather than being sent away empty-handed.
  RESH.pending = (async function(){
    try {
      var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?guests=' + encodeURIComponent(want.join(','))
          + '&venue=' + encodeURIComponent(resHistVenue()), {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
      });
      if(!r.ok) throw new Error('HTTP '+r.status);
      var j = await r.json();
      if(!j || !j.ok) throw new Error((j && j.error) || 'no data');
      var map = j.guests || {};
      want.forEach(function(id){
        if (map[id]) RESH.got[id] = map[id];
        else RESH.failed[id] = 1;      // don't ask again for this one
      });
    } catch(e) {
      console.warn('[reservations] guest history failed', e);
      RESH.err = 'Guest history could not be read just now.';
      // NOT marked failed: a network blip shouldn't permanently blank the column,
      // so the next load of this screen tries again.
    }
  })();
  try{ await RESH.pending; } finally { RESH.pending = null; }
  RESH.loading = false;
  if (typeof renderMain === 'function' && state.currentTab === 'reservations') renderMain();
}

// Compact date for a table cell. Same year-trap as the panel: never print a day
// and month alone for a visit in another year.
function resVisitShort(iso){
  var s = String(iso||'').slice(0,10);
  if(!s) return '';
  try{
    var d = new Date(s+'T12:00:00');
    if(isNaN(d.getTime())) return s;
    var thisYear = (typeof chkToday==='function' ? chkToday().iso : new Date().toISOString().slice(0,10)).slice(0,4);
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})
      + (s.slice(0,4) === thisYear ? '' : ' ' + s.slice(0,4));
  }catch(e){ return s; }
}

// resHistLine() lived here until 31 Jul 2026: the one-line history that used to
// sit under a guest's name -- "15 visits · AED 177 net/cover · last 23 Jan
// 2025". It is now five columns (resHistCells) under the "Been with us" band,
// because a line you have to read is not a column you can scan. Deleted rather
// than left behind: the guest panel builds its own stats block, so nothing else
// called it.
//
// The one thing that must not be lost with it -- SevenRooms' per-cover figure is
// NET. Checked 28 Jul against three live profiles: spend/covers reproduces it to
// the fils (780.83, 463.58) and gross/covers does not (921.39, 481.50). That is
// why the band says net and the Tonight column beside it says gross · net.

// ── THE GUEST'S HISTORY, AS COLUMNS ───────────────────────────────────────
// Five cells: when they were last here, how many times, and SevenRooms'
// lifetime total / per guest / per table for this venue. Same three money
// figures and the same names as the printed brief, so the screen and the sheet
// cannot teach two different vocabularies.
//
// All five are SevenRooms' own numbers, passed through untouched. They are NET
// (verified 28 Jul: spend/covers reproduces SevenRooms' per-cover to the fils
// on the net basis, gross/covers does not), which is why the band says so --
// the Tonight column beside them prints gross AND net, and two money figures on
// one row with different bases and no labels is how the wrong pair gets
// compared. They also do not multiply out against each other: SevenRooms' own
// per-cover x covers does not reconcile to its own total (193,691 vs 212,811 on
// the biggest guest), so no total here is ever derived from another.
function resHistCells(r, money){
  var g = (r.client && RESH.got[r.client] && RESH.got[r.client].scope === 'venue') ? RESH.got[r.client] : null;
  var first = g && (Number(g.visits) || 0) <= 1 && !(Number(g.spend) > 0);
  // A dash means "SevenRooms holds nothing here", which is worth a column
  // position on the desktop grid — an empty cell in a row of numbers reads as a
  // rendering fault. On the phone card there is no column to hold open, and
  // "With us: AED —" is just noise, so those cells carry rm-none and the card
  // layout drops them.
  var cell = function(cls, v, bold){
    var has = g && Number(v) > 0;
    var body = has ? resNum(Math.round(v)) : '<i>&mdash;</i>';
    return '<div class="res-right ' + cls + (has ? '' : ' rm-none') + '">'
      + (bold && has ? '<b>' + body + '</b>' : body) + '</div>';
  };
  var lastKnown = !first && g && g.last_visit;
  // TAPPING "Last here" OPENS THE VISITS. Asked for by Francesco 1 Aug 2026,
  // and the reason is a real failure of this cell: SevenRooms moves the guest's
  // last-visit date to TODAY the moment they are seated, so from mid-service
  // onwards this column tells a host "last here: today" -- which they can see --
  // and the visit that actually mattered is gone from the screen. The panel
  // behind the tap keeps the previous ones.
  //
  // Only where there is history to open: a first-timer's cell is not a button,
  // because a button that opens "nothing here" is worse than plain text.
  var lvBody = first ? '<i>first visit</i>'
    : (lastKnown ? resEsc(resVisitShort(g.last_visit)) : '<i>&mdash;</i>');
  if(lastKnown && r.client){
    lvBody = '<button class="res-lv-btn" onclick="resOpenGuest(\''
      + String(r.client).replace(/[^A-Za-z0-9_-]/g,'') + '\',\'' + resEsc(r.time||'')
      + '\')" title="See their last visits">' + lvBody + '</button>';
  }
  // Blank, not "0", on a first visit: the cell beside it already says "first
  // visit", and "first visit / 0" reads as two different facts.
  return '<div class="res-lv' + ((first || lastKnown) ? '' : ' rm-none') + '">'
      + lvBody + '</div>'
    + '<div class="res-vc">' + ((g && !first) ? resNum(g.visits) : '') + '</div>'
    + (money ? cell('res-m1', g && g.spend, true)
             + cell('res-m2', g && g.per_cover)
             + cell('res-m3', g && g.per_visit) : '');
}

// ── VIP NAME MATCH ────────────────────────────────────────────────────────
// Checks tonight's guests against public-figure records and shows a chip on
// the row when a name belongs to somebody notable.
//
// READ THE WORDING ON THE CHIP BEFORE CHANGING ANYTHING HERE. It says
// "possible public figure - verify", never "VIP", and that is not timidity --
// it is the only honest claim available. A name match cannot tell you the
// Jennifer Lopez on table 21 is THE Jennifer Lopez. A host who greets the
// wrong guest as a celebrity has done more damage than the feature could ever
// repay, so the app surfaces and a manager decides. Once they decide, the
// answer is remembered forever: confirmed shows as a real VIP on every future
// booking, dismissed never asks again.
//
// The scan itself runs in the vip-scan edge function -- the notability rules
// and the reasoning behind the thresholds live there.
var RESV = {
  rows: {},          // client id -> notability row
  loading: false,
  loaded: false,
  enabled: null,     // null = not yet known, from the admin switch
  source: '',        // which lookup source answered
  busy: {}           // client id -> true while a decision is saving
};

// Called once per night-load. Silent by design: this is a garnish on a screen
// whose job is the book, so every failure path here ends in "show no chips"
// rather than an error the manager has to read past.
async function resVipScan(){
  if(RESV.loading) return;
  var list = (RES.data && RES.data.reservations) || [];
  var seen = {}, guests = [];
  list.forEach(function(r){
    if(!r.client || !r.name || seen[r.client]) return;
    seen[r.client] = true;
    guests.push({ client: String(r.client), name: String(r.name) });
  });
  if(!guests.length) return;
  RESV.loading = true;
  try{
    var res = await sb.functions.invoke('vip-scan', { body: { guests: guests } });
    if(res.error) throw res.error;
    var j = res.data || {};
    RESV.enabled = j.enabled !== false;
    RESV.source = j.source || '';
    (j.rows || []).forEach(function(row){ if(row && row.client_id) RESV.rows[row.client_id] = row; });
    RESV.loaded = true;
  }catch(e){
    console.warn('[reservations] VIP scan unavailable', e);
    RESV.enabled = false;
  }
  RESV.loading = false;
  if(state.currentTab === 'reservations') renderMain();
}

// The chip under the guest's name. Three states and no fourth: an unverified
// match, a confirmed VIP, and nothing at all -- which is what the great
// majority of rows show, and is the point.
function resVipChip(r){
  if(!r || !r.client) return '';
  var v = RESV.rows[r.client];
  if(!v) return '';
  var id = String(r.client).replace(/[^A-Za-z0-9_-]/g,'');
  if(v.status === 'confirmed'){
    return '<i class="res-vipchip res-vipchip-on" title="'+resEsc(v.description||'')+'">'
      + 'VIP' + (v.decided_by ? ' &middot; confirmed' : '') + '</i>';
  }
  if(v.status === 'match'){
    return '<button class="res-vipchip res-vipchip-q" onclick="resVipOpen(\''+id+'\')" '
      + 'title="A public figure shares this name - tap to check">Possible public figure &mdash; verify</button>';
  }
  return '';
}

// ── The verify panel ──────────────────────────────────────────────────────
var RESVP = { open: false, id: null };

function resVipEl(){
  var el = document.getElementById('res-vipv');
  if(!el){
    el = document.createElement('div');
    el.id = 'res-vipv';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){ if(e.target === el) resVipClose(); });
  }
  return el;
}
function resVipPaint(){
  var el = resVipEl();
  el.innerHTML = RESVP.open ? resVipHtml() : '';
  el.className = RESVP.open ? 'rg-ov' : '';
}
function resVipOpen(id){ if(!id) return; RESVP.open = true; RESVP.id = id; resVipPaint(); }
function resVipClose(){ RESVP.open = false; RESVP.id = null; resVipPaint(); }

if(!window._resVipKey){
  window._resVipKey = true;
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && RESVP.open) resVipClose();
  });
}

function resVipHtml(){
  var v = RESV.rows[RESVP.id];
  if(!v) return '';
  var list = (RES.data && RES.data.reservations) || [];
  var row = null;
  for(var i=0;i<list.length;i++){ if(list[i].client === RESVP.id){ row = list[i]; break; } }
  row = row || {};
  var busy = !!RESV.busy[RESVP.id];

  var h = ['<div class="rg-card" role="dialog" aria-modal="true" aria-label="Verify possible public figure">'];
  h.push('<div class="rg-head"><div>');
  h.push('<div class="rg-kicker">Possible public figure</div>');
  h.push('<div class="rg-name">'+resEsc(row.name || v.guest_name || 'Guest')+'</div>');
  h.push('</div><button class="rg-x" onclick="resVipClose()" aria-label="Close">&times;</button></div>');

  if(row.time){
    h.push('<div class="rvp-sub">'+resEsc(row.time)+' &middot; '+resNum(row.pax)+' cover'+(row.pax===1?'':'s')
      + (row.tables && row.tables.length ? ' &middot; table '+resEsc(row.tables.join(', ')) : '')
      + (row.booked_by ? ' &middot; booked via '+resEsc(row.booked_by) : '')+'</div>');
  }

  h.push('<div class="rvp-lab">One name match found</div>');
  h.push('<div class="rvp-hit">');
  h.push('<div class="rvp-hit-t">'+resEsc(v.title||'')+'</div>');
  if(v.description) h.push('<div class="rvp-hit-d">'+resEsc(v.description)+'</div>');
  if(v.source_url){
    h.push('<a class="rvp-hit-l" href="'+resEsc(v.source_url)+'" target="_blank" rel="noopener noreferrer">'
      + (v.source === 'google-kg' ? 'Open the source page' : 'Open the Wikipedia page') + ' &#8599;</a>');
  }
  h.push('</div>');

  // Said plainly, above the buttons, every single time. The manager is being
  // asked to make a judgement the app cannot make, so the app has to be
  // straight about what it does and does not know.
  h.push('<div class="rvp-warn">This is a name match only. It may not be your guest &mdash; '
    + 'check before treating them as a VIP.</div>');

  h.push('<div class="rvp-acts">');
  h.push('<button class="res-btn" onclick="resVipDecide(\'dismissed\')"'+(busy?' disabled':'')+'>Not them</button>');
  h.push('<button class="res-btn res-btn-go" onclick="resVipDecide(\'confirmed\')"'+(busy?' disabled':'')+'>'
    + (busy ? 'Saving...' : 'Confirm VIP') + '</button>');
  h.push('</div>');
  h.push('<div class="rvp-foot">Either answer is remembered for this guest, so nobody is asked twice.</div>');
  h.push('</div>');
  return h.join('');
}

async function resVipDecide(status){
  var id = RESVP.id;
  if(!id || RESV.busy[id]) return;
  var v = RESV.rows[id];
  if(!v) return;
  RESV.busy[id] = true; resVipPaint();
  var who = (state.userEmail || '').toLowerCase() || null;
  var patch = { status: status, decided_by: who, decided_at: new Date().toISOString() };
  var res = await sb.from('guest_notability').update(patch).eq('client_id', id);
  RESV.busy[id] = false;
  if(res.error){
    console.warn('[reservations] could not save VIP decision', res.error);
    toast('Could not save that just now - the booking is unchanged. Try again.', true);
    resVipPaint();
    return;
  }
  RESV.rows[id] = Object.assign({}, v, patch);
  resVipClose();
  toast(status === 'confirmed'
    ? 'Marked as VIP - it will show on every future booking.'
    : 'Dismissed - this guest will not be flagged again.');
  renderMain();
}

// ── PRINT BRIEF ───────────────────────────────────────────────────────────
// A pre-service sheet for the team: the night in order, with who each guest is.
// Follows the roster print pattern already in the app -- a self-contained
// document in a new window -- so nothing about the live screen has to be hidden
// or restyled for print.
//
// SevenRooms' automatic tags are left off the sheet. "Upcoming Reservation in
// 30 Days", "Group All Guests" and the marketing segments are true but tell a
// section waiter nothing, and on a 16-booking night they bury the three tags
// that matter. What a brief needs is the standing preferences and the VIP
// markers. The footer says they were left off, so nobody thinks the guest has
// no tags.
var RES_AUTO_TAG = /^(upcoming reservation|reservation within|group |visits=|custom |copycustomautotag|activation re-engagement|first timer|repeat guest|cancellation|no show)/i;

function resBriefTags(g){
  if(!g || !g.tags) return [];
  return g.tags.filter(function(t){ return !RES_AUTO_TAG.test(String(t).trim()); });
}

// The booking note as a brief should carry it. Two bits of pure noise come off:
//   "Selected: "  — every row says it, so it is a label, not information
//   "DINNER"      — the default service. "JAZZ NIGHT", "APERITIVO · SCALA" and
//                   "Roberto's Restaurant Week" all survive, because those DO
//                   tell the team something about the night.
// What is left is the actual request ("Table away from the Entrance", "Female
// birthday"). Long notes are cut at a sentence-ish length: the sheet has to fit
// an A4 page, and the untrimmed version is one tap away on the screen.
function resBriefNote(s){
  var n = String(s||'').replace(/^\s*Selected:\s*/i, '').replace(/^DINNER\b[\s·-]*/i, '').trim();
  if(n.length > 150) n = n.slice(0, 148).replace(/[\s·,;-]+\S*$/, '') + '…';
  return n;
}

// ── WHAT THE FLOOR HAS TO SEE ─────────────────────────────────────────────
// Measured on the live book (150 bookings over 31 / 25 / 18 Jul, 149 guest
// profiles) before this was written:
//
//   * There is NO allergy field in SevenRooms. Across 149 profiles exactly one
//     diet-related guest tag exists ("Pork") and no guest note mentions an
//     allergy. Hosts record it inside the booking's own tag list, which reaches
//     us as `reservation_type` — "Allergy, Birthday, Alcohol-free, Non-smoking
//     area requested, Confirmed via call" — appended at the END of the note.
//   * 17 of 150 notes are longer than the old 150-character cut, and that cut
//     is what destroyed the allergy: on 25 Jul the sheet for Awatif Aljesmi (4
//     covers) printed the birthday request and dropped BOTH "Allergy" and
//     "Alcohol-free", because they sat past character 150. One for one of the
//     allergy bookings in the sample, lost.
//
// So the flag is read out of the note and printed FIRST, where it cannot be
// truncated. The free text is still capped — one long request must not push the
// sheet onto a second page — but it can only ever cost us wording, never a
// dietary requirement.
//
// Ordered the way a waiter needs them: what they cannot eat, then what we are
// celebrating, then what the table needs.
var RES_FLAGS = [
  [/allerg\w*/i,                            'ALLERGY',         'crit'],
  [/gluten[- ]?free|coeliac|celiac/i,       'GLUTEN-FREE',     'crit'],
  [/\bvegan\b/i,                            'VEGAN',           'crit'],
  [/\bvegetarian\b/i,                       'VEGETARIAN',      'crit'],
  [/alcohol[- ]?free|no alcohol|non[- ]?alcoholic/i, 'ALCOHOL-FREE', 'crit'],
  [/\bbirthday\b/i,                         'BIRTHDAY',        'occ'],
  [/anniversar\w*/i,                        'ANNIVERSARY',     'occ'],
  [/congratulat\w*/i,                       'CONGRATULATIONS', 'occ'],
  [/propos\w*|getting married|engagement/i, 'CELEBRATION',     'occ'],
  [/high ?chair|baby ?seat|\bkids?\b|children/i, 'HIGH CHAIR',  'warn'],
  [/wheelchair|accessib\w*/i,               'ACCESS',          'warn'],
  [/do ?n.?.?t move|do not move/i,          'DO NOT MOVE',     'warn'],
  [/restaurant week/i,                      'SET MENU',        'menu']
];
// Internal host codes. They print in bold as "worth knowing" today — the 17:30
// row on 31 Jul reads "DC INFO, Booked Via call, TH INFO, SEAT INFO" — and they
// tell a section waiter nothing.
// NOTE: "DINNER" / "LUNCH" are deliberately NOT stripped as words. They arrive
// as a whole segment ("Selected: DINNER"), which RES_DEAD_TAG drops below. An
// earlier version removed them anywhere and turned Fatma Ahmad's 25 Jul note
// into "bring after immediately" -- the same sentence damage the flag words
// caused. Only remove a word when the word IS the whole segment.
var RES_NOISE = [
  /\bSelected Google Seating Area:[^·]*/ig,   // the area already has its own column
  // "Selected: DINNER" is the service, and SevenRooms drops it INSIDE the
  // sentence ("...when they arrive Selected: DINNER Custom question response:
  // Table on corner..."). Label and value have to come off together, or the
  // sheet prints a bare "DINNER" in the middle of a guest's request. It is
  // matched only behind "Selected:", so a guest writing "our first dinner
  // date" keeps their words.
  /\bSelected:\s*(?:DINNER|LUNCH|BRUNCH)\b[\s;:·,-]*/ig,
  /\bSelected:\s*/ig, /\bCustom question response:\s*/ig, /\bClient notes:\s*/ig,
  /\b(?:DC|TH|SEAT|CC|LO|TA|AGE) INFO\b/ig
];
// Whole segments / tags that are internal host bookkeeping. Verified against
// 150 real bookings: these are the ones that actually occur.
var RES_DEAD_TAG = /^(?:(?:dc|th|seat|cc|lo|ta|age) info|booked\s*(?:by|via)\b.*|confirmed\s*(?:via call|online)|dinner|lunch|special event|selected|managment booking|management booking|a la carte)$/i;

function resTidy(t){
  return String(t||'').replace(/\s*[·,;]\s*(?=[·,;])/g, ' ')
    .replace(/^[\s·,;.-]+|[\s·,;-]+$/g, '').replace(/\s{2,}/g, ' ');
}

// Splits one SevenRooms note into { flags, text, asked }.
//
// The note arrives as ' · '-joined parts and the LAST part is SevenRooms' own
// comma-separated tag list. Flag words are matched against the WHOLE note but
// only ever deleted from that tag list or from a segment that holds nothing
// else — an early version stripped "birthday" wherever it appeared and left the
// sheet saying "a dessert for the and inform the note", which is worse than the
// problem it was fixing. A real sentence is never edited.
function resReadNote(s){
  var raw = String(s||'');
  var segs = raw.split('·').map(function(x){ return x.trim(); }).filter(Boolean);

  var taglist = [];
  var last = segs.length ? segs[segs.length-1] : '';
  if(last.indexOf(',') !== -1 && last.split(',').every(function(p){ return p.trim().length <= 40; })){
    taglist = segs.pop().split(',').map(function(p){ return p.trim(); }).filter(Boolean);
  }

  var flags = [], seen = {};
  RES_FLAGS.forEach(function(f){
    if(f[0].test(raw) && !seen[f[1]]){ seen[f[1]] = 1; flags.push({ label:f[1], kind:f[2] }); }
  });
  // "Getting married" already reads as a celebration — two chips is noise.
  if(seen['CELEBRATION'] && flags.filter(function(f){ return f.kind === 'occ'; }).length > 1){
    flags = flags.filter(function(f){ return f.label !== 'CELEBRATION'; });
  }

  var strip = function(t){
    RES_NOISE.forEach(function(re){ t = t.replace(re, ' '); });
    return t;
  };
  var keep = [];
  segs.forEach(function(sg){
    var t = strip(sg);
    if(RES_DEAD_TAG.test(t.trim())) return;                     // "Booked Via call"
    RES_FLAGS.forEach(function(f){ if(seen[f[1]]) t = t.replace(f[0], ' '); });
    if(/[A-Za-z0-9]/.test(t)) keep.push(sg);                    // a real sentence survives whole
  });

  // What is left of the tag list once the flags are chips and the codes are gone
  // — "Non-smoking · Corner · Window". The word "requested" is dropped: on a
  // sheet of requests it is on every line.
  var asked = [];
  taglist.forEach(function(t){
    if(RES_DEAD_TAG.test(t)) return;
    for(var i=0; i<RES_FLAGS.length; i++) if(seen[RES_FLAGS[i][1]] && RES_FLAGS[i][0].test(t)) return;
    var v = t.replace(/\s*(area\s+)?requested$/i, '').trim();
    if(v) asked.push(v);
  });

  return { flags: flags, text: resTidy(strip(keep.join(' · '))), asked: asked };
}

function resFlagChips(flags){
  return flags.map(function(f){
    return '<span class="fl ' + f.kind + '">' + resEsc(f.label) + '</span>';
  }).join('');
}
function resClamp(s, n){
  s = String(s||'');
  return s.length > n ? s.slice(0, n-2).replace(/[\s·,;-]+\S*$/, '') + '…' : s;
}

// ── THE NOTE ON SCREEN ────────────────────────────────────────────────────
// The note column is one line with an ellipsis (.res-note in foh-styles.css),
// so what a manager actually saw on 31 Jul was "Selected: DINNER · DC INFO, …"
// — internal host codes filling the line while the guest's request sat past the
// cut. The full text existed only in a title tooltip, which a phone cannot show
// at all, and the same truncation that hid an allergy on the printed sheet was
// hiding it here too, harder.
//
// Now the cell carries the printed brief's flags first, then the cleaned
// request. Francesco's call (31 Jul): the team taps a note to open it in place
// rather than the row growing for everyone, so a long request costs no width
// until somebody wants to read it.
//
// Which notes are open is held OUTSIDE the render: this screen re-renders itself
// every 90 seconds while it is tonight, and a note that closed itself mid-read
// would be worse than one that never opened.
var RES_OPEN_NOTES = {};
function resNoteKey(r){
  return String((r && (r.client || r.name) || '') + '|' + ((r && r.time) || ''))
    .replace(/[^A-Za-z0-9_|-]/g, '');
}
function resNoteCell(r){
  var d = resReadNote(r.notes);
  // Collapsed, the cell is one line with an ellipsis, so a chip past the edge is
  // simply cut in half. Measured on the real stylesheet at a 116px column: TWO
  // chips already overflow — "ALLERGY · ALCOHOL-FREE" lost the alcohol-free.
  // So exactly ONE chip rides the collapsed line, and because RES_FLAGS is
  // ordered dietary-first that one is always the most serious thing on the
  // booking. The others are counted, not hidden, and arrive with the tap.
  var lead = d.flags.slice(0, 1), rest = d.flags.slice(1);
  var body = resFlagChips(lead)
    + (rest.length ? '<span class="rn-more">' + resFlagChips(rest) + '</span>'
                   + '<span class="rn-n">+' + rest.length + '</span>' : '')
    + (d.text ? '<span class="rn-t">' + resEsc(d.text) + '</span>' : '')
    + (d.asked.length ? '<span class="rn-q">' + d.asked.map(resEsc).join(' &middot; ') + '</span>' : '');
  if(!body) return '<div class="res-note"></div>';
  var key = resNoteKey(r);
  return '<div class="res-note rn-tap' + (RES_OPEN_NOTES[key] ? ' rn-open' : '') + '"'
    + ' role="button" tabindex="0" aria-label="Show the whole note"'
    + ' data-k="' + resEsc(key) + '" onclick="resNoteToggle(this)"'
    + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();resNoteToggle(this);}"'
    + ' title="' + resEsc(d.text || '') + '">' + body + '</div>';
}
function resNoteToggle(el){
  var k = el.getAttribute('data-k');
  if(RES_OPEN_NOTES[k]) delete RES_OPEN_NOTES[k]; else RES_OPEN_NOTES[k] = 1;
  el.classList.toggle('rn-open');
}

async function resPrintBrief(){
  // Never print a sheet with the history column silently empty.
  await resEnsureHistory();
  var money = !fohBlocked('revenue');
  var rows = resRows();
  if(!rows.length){ alert('Nothing to brief — there are no bookings on this night.'); return; }

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

  var t = RES.data.totals || {};
  var h = '<div class="hd"><div class="ttl">Service brief</div>'
    + '<div class="dt">' + resEsc(resDateLabel(RES.date)) + '</div>'
    + '<div class="tot">' + resNum(t.reservations) + ' reservations &middot; ' + resNum(t.covers) + ' covers</div></div>';

  order.forEach(function(k){
    var list = byArea[k];
    var cov = list.reduce(function(s,r){ return s+(r.pax||0); },0);
    h += '<div class="area">' + resEsc(k) + ' &mdash; ' + list.length + ' reservation' + (list.length===1?'':'s') + ', ' + cov + ' covers</div>';
    // The money block is banded and given plain-English sub-headings because
    // "Avg/cover" was ambiguous at a glance: SevenRooms keeps TWO averages and
    // the sheet was printing the per-PERSON one under a heading a manager reads
    // as the average bill. On the top guest they are 831 and 1,862 — reading one
    // as the other is a factor of two. Now all three figures sit together under
    // one band, named the way they'd be said out loud.
    // ⚠ COLGROUP, NOT th WIDTHS. With table-layout:fixed the browser takes every
    // column width from the FIRST row only. The banded header puts Total / Per
    // guest / Per table in the SECOND row, so their widths were silently ignored
    // and the colspan="3" group swallowed a third of the page while "Worth
    // knowing" was crushed into a ribbon. A colgroup is read independently of
    // the rows, so it is the only thing that can size a banded table.
    // The last column is deliberately left unsized: it takes everything that is
    // left, which is what the guest's request deserves.
    var cols = '<colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4">'
      + '<col class="c5"><col class="c6">'
      + (money ? '<col class="c7"><col class="c8"><col class="c9">' : '')
      + '<col></colgroup>';
    var span = money ? ' rowspan="2"' : '';
    h += '<table>' + cols + '<thead><tr>'
      + '<th class="w1"' + span + '>Time</th><th class="w2"' + span + '>Pax</th>'
      + '<th class="w3"' + span + '>Guest</th><th class="w4"' + span + '>Table</th>'
      + '<th class="w5"' + span + '>Last here</th><th class="w6"' + span + '>Visits</th>'
      + (money ? '<th class="grp" colspan="3">Been with us &middot; net</th>' : '')
      + '<th' + span + '>Worth knowing</th></tr>'
      + (money ? '<tr><th class="w7">Total</th><th class="w8">Per guest</th><th class="w9">Per table</th></tr>' : '')
      + '</thead><tbody>';
    list.forEach(function(r){
      var g = r.client ? RESH.got[r.client] : null;
      var venueScoped = g && g.scope === 'venue';
      var firstTime = venueScoped && (Number(g.visits)||0) <= 1 && !(Number(g.spend) > 0);
      var know = [];
      // Flags first — see RES_FLAGS. A dietary requirement can never be cut.
      var rd = resReadNote(r.notes);
      var gd = (g && g.note) ? resReadNote(g.note) : null;
      if(gd) gd.flags.forEach(function(f){
        for(var i=0;i<rd.flags.length;i++) if(rd.flags[i].label === f.label) return;
        rd.flags.push(f);
      });
      var head = resFlagChips(rd.flags);
      if(rd.text) head += '<b>' + resEsc(resClamp(rd.text, 115)) + '</b>';
      if(head) know.push(head);
      if(rd.asked.length) know.push('<span class="rq">' + rd.asked.map(resEsc).join(' &middot; ') + '</span>');
      if(gd && gd.text) know.push('<span class="gn">' + resEsc(resClamp(gd.text, 90)) + '</span>');
      // NOT PRINTED: previous no-shows. 20 of 147 guests carry one, which is
      // exactly the kind of thing a manager wants before doors -- but 3 of those
      // 20 have MORE no-shows than visits (one guest: 18 no-shows against 16
      // visits, 0 cancellations, AED 8,980 spent with us). Whatever that field
      // counts, it is not "times this guest failed to turn up", and a printed
      // sheet that tells the team a paying regular is an 18-time no-show is an
      // accusation we cannot stand behind. It goes on only when we know how the
      // hosts use the NO_SHOW status.
      // Tags capped so one heavily-tagged regular can't push the row over a
      // page. The count says what was left off rather than hiding it.
      // A tag that just repeats a flag chip ("Birthday") is dropped — the same
      // word twice on one row is noise.
      var tg = resBriefTags(g).filter(function(t){
        for(var i=0;i<rd.flags.length;i++) if(String(t).trim().toLowerCase() === rd.flags[i].label.toLowerCase()) return false;
        return true;
      });
      if(tg.length){
        var show = tg.slice(0, 6);
        know.push('<span class="tg">' + show.map(resEsc).join(' &middot; ')
          + (tg.length > show.length ? ' <span class="more">+' + (tg.length - show.length) + ' more</span>' : '') + '</span>');
      }
      h += '<tr>'
        + '<td class="w1">' + resEsc(r.time||'') + '</td>'
        + '<td class="w2">' + resNum(r.pax) + '</td>'
        + '<td class="w3">' + (r.vip ? '<span class="vip">VIP</span> ' : '') + resEsc(r.name||'') + '</td>'
        + '<td class="w4">' + ((r.tables&&r.tables.length) ? resEsc(r.tables.join(', ')) : '') + '</td>'
        + '<td class="w5">' + (firstTime ? '<i>first visit</i>' : (venueScoped && g.last_visit ? resEsc(resVisitShort(g.last_visit)) : '')) + '</td>'
        // Blank, not "0", on a first visit: the column beside it already says
        // "first visit", and "first visit / 0" reads as two different facts.
        + '<td class="w6">' + (venueScoped && !firstTime ? resNum(g.visits) : '') + '</td>'
        // Three figures, asked for 31 Jul: lifetime total, then SevenRooms' two
        // averages -- per_cover is per PERSON, per_visit is the average BILL.
        // All three come STRAIGHT from SevenRooms and none is computed here:
        // SevenRooms' own per-cover x covers does not reconcile to its own total
        // (top guest 212,811 vs 193,691), so these columns are not meant to tie
        // out and must never be multiplied against each other.
        + (money ? '<td class="w7">' + (venueScoped && Number(g.spend)>0 ? '<b>' + resNum(Math.round(g.spend)) + '</b>' : '') + '</td>'
                 + '<td class="w8">' + (venueScoped && Number(g.per_cover)>0 ? resNum(Math.round(g.per_cover)) : '') + '</td>'
                 + '<td class="w9">' + (venueScoped && Number(g.per_visit)>0 ? resNum(Math.round(g.per_visit)) : '') + '</td>' : '')
        + '<td>' + know.join('<br>') + '</td>'
        + '</tr>';
    });
    h += '</tbody></table>';
  });

  h += '<div class="ft">Read-only from SevenRooms &middot; printed '
    + resEsc(new Date().toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))
    + (money ? '' : ' &middot; spend hidden on this login')
    + '.<br>SevenRooms’ automatic tags (upcoming and recent reservations, group segments, marketing) are left off this sheet. '
    + 'A red flag is a dietary requirement — check it with the guest before the order goes to the pass. '
    + '“Been with us” is SevenRooms’ own lifetime record for this venue — total, average per guest, average per table, all NET. '
    + 'They are three separate SevenRooms figures and do not multiply out against each other. '
    + 'To change a booking, the hosts do it in SevenRooms.</div>';

  var css = '@page{size:A4 landscape;margin:8mm}'
    // 11px, not 10: this is read standing up, at arm's length, under service
    // light. The width for it comes from keeping every other column tight.
    + 'html,body{margin:0}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#1c1c1c}'
    + '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    + '.hd{border-bottom:2px solid #6B1F2A;padding-bottom:4px;margin-bottom:7px}'
    + '.ttl{font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#6B1F2A;font-weight:700}'
    + '.dt{font-size:17px;margin-top:2px}.tot{font-size:11px;color:#555;margin-top:2px}'
    + '.area{margin:7px 0 3px;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#6B1F2A;font-weight:700}'
    // table-layout:fixed is the whole fix for the sheet running off the page.
    // Without it the browser widens the table to fit the longest note on the
    // night -- one guest's "Custom question response: We are celebrating 2
    // different people..." pushed the last column past the paper edge and the
    // page would not print. Fixed layout holds every column to its declared
    // width and wraps the text instead.
    + 'table{width:100%;table-layout:fixed;border-collapse:collapse}'
    + 'th{background:#6B1F2A;color:#fff;font-size:8px;letter-spacing:1px;text-transform:uppercase;text-align:left;padding:4px 5px}'
    + 'td{border-bottom:1px solid #ddd;padding:4px 5px;vertical-align:top;line-height:1.28;'
    +   'word-wrap:break-word;overflow-wrap:break-word}'
    + 'tr{page-break-inside:avoid}'
    // Column widths live here, on the colgroup. Everything is kept tight so the
    // last column — the guest's actual request — gets the rest of the page: on
    // A4 landscape at 8mm margins that leaves it roughly 600px, more than half
    // the sheet, which is the right way round for a service brief.
    // c5 is 68px because "23 Jan 2025" measures 67px at 11px Arial. At 58 it was
    // nowrap-overflowing into the Visits column — measured, not guessed.
    + '.c1{width:30px}.c2{width:22px}.c3{width:100px}.c4{width:34px}.c5{width:70px}.c6{width:34px}'
    + '.c7{width:50px}.c8{width:42px}.c9{width:42px}'
    + '.w2{text-align:center}.w3{font-weight:700}'
    // The history pair used to read as one blurred phrase -- "Last visit" and
    // "Visits" share a word, and left-aligned text sat hard against the number
    // beside it. Now: different words, the count right-aligned so the digits
    // pull away from the date, and a hairline holding the pair together.
    + '.w6{text-align:right;font-variant-numeric:tabular-nums}'
    + 'th.w5,td.w5{border-left:1px solid #ddd;padding-left:7px}'
    + 'th.w6,td.w6{padding-right:7px}'
    + 'th{white-space:nowrap}'
    + '.w5{white-space:nowrap}'                       // "23 Jan 2025" must not wrap onto two lines
    + '.w7,.w8,.w9{text-align:right;font-size:9px;font-variant-numeric:tabular-nums}'
    // The band over the three money columns, and a hairline down each side of
    // the block so the eye can find it without reading a single heading.
    + 'th.grp{text-align:center;letter-spacing:1.5px;border-bottom:1px solid rgba(255,255,255,.45)}'
    + 'th.w7,td.w7{border-left:1px solid #bbb}'
    + 'th.grp,td.w9{border-right:1px solid #bbb}'
    + 'th.w7,th.w8,th.w9{padding:3px 5px;letter-spacing:0}'
    + 'td.w7,td.w8,td.w9{background:#faf7f4;padding:4px 5px}'
    + '.vip{background:#6B1F2A;color:#fff;font-size:7px;font-weight:700;padding:1px 3px;border-radius:2px;vertical-align:1px}'
    + '.tg{color:#6B1F2A}.more{color:#4F4535}'
    // The flags. Read at arm's length across a pass, so: colour before words.
    // Red is only ever a dietary requirement -- if it is red, it goes to the
    // kitchen. Amber is something the table needs. Cream is a celebration.
    + '.fl{display:inline-block;font-size:8px;font-weight:700;letter-spacing:.6px;padding:1px 4px;'
    +   'border-radius:2px;margin:0 4px 2px 0;vertical-align:1px}'
    + '.fl.crit{background:#B00020;color:#fff}'
    + '.fl.warn{background:#8a5a00;color:#fff}'
    + '.fl.occ{background:#f0e6d8;color:#5a4326;border:1px solid #d8c5a8}'
    + '.fl.menu{background:#26413c;color:#fff}'
    + '.rq{color:#555}.gn{color:#444;font-style:italic}.ns{color:#B00020;font-weight:700}'
    + '.ft{margin-top:12px;padding-top:6px;border-top:1px solid #ccc;font-size:8px;color:#4F4535;line-height:1.5}';

  var doc = '<!doctype html><html><head><meta charset="utf-8"><title>Service brief — '
    + resEsc(resDateLabel(RES.date)) + '</title><style>' + css + '</style></head><body>' + h + '</body></html>';

  var w = window.open('', '_blank');
  if(!w){ alert('Pop-up blocked — allow pop-ups for this site and press Print brief again.'); return; }
  w.document.open(); w.document.write(doc); w.document.close();
  w.focus();
  setTimeout(function(){ try{ w.print(); }catch(e){} }, 300);
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

// ── EXCEL EXPORT ──────────────────────────────────────────────────────────
// Asked for by Nicole 28 Jul: she needs to take the night's data away, not just
// read it on screen.
//
// Exports exactly what is on screen -- the same resRows() the print brief uses,
// so a shift chip or a search narrows the file the same way it narrows the page.
// Anything else would be a trap: you filter to one shift, export, and silently
// get the whole night.
//
// SheetJS is fetched on demand from the same CDN and the same version the stock
// take already pulls, so the app carries one spreadsheet library rather than
// two, and nothing is downloaded until somebody presses the button.
//
// TWO SHEETS, DELIBERATELY. The warning that the money only covers bookings with
// a linked check is on the screen -- but a file travels. It gets mailed, pasted
// into a deck, and read by someone who never saw the screen and has no idea the
// total is 12% short of Simphony. So the Summary sheet carries the coverage, the
// filter that was applied, and the gross-to-net rule alongside the numbers.
// Don't tidy it away.
// ExcelJS, not SheetJS. The stock take uses SheetJS, which is fine for a plain
// grid, but its community build cannot style a cell at all -- that is a paid
// feature -- so every file it makes is naked Calibri on white. The roster
// download already solves this with ExcelJS (foh-core.js), so this uses the same
// library, the same CDN pattern and the SAME brand palette, and the two exports
// look like they came from one company.
function resLoadExcelJS(){
  if(window.ExcelJS) return Promise.resolve();
  return new Promise(function(res, rej){
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = res;
    s.onerror = function(){ rej(new Error('the spreadsheet library could not be reached')); };
    document.body.appendChild(s);
  });
}

// Same values the roster export uses. Don't re-pick these per module -- that is
// how two "branded" files end up two different shades of red.
var RES_XL = { VINO:'6B1F2A', SABBIA:'F5F0E8', GOLD:'C9A84C', DARK:'3D0F15', LIGHT:'F0EBE2' };
function resXlBorder(colour, weight){
  var c = {style: weight || 'thin', color:{argb:'FF'+colour}};
  return {top:c, bottom:c, left:c, right:c};
}

// Money goes in as NUMBERS, never as "AED 1,234" strings -- the whole point of
// an export is that she can sum and pivot it. The AED lives in the column name.
function resExportSheets(rows, money){
  // The money columns are DROPPED, not blanked, for a user without Revenue
  // access -- same rule as the Spend column and the history line. An empty
  // column headed "AED" invites someone to ask why their file is broken.
  var head = ['Time','Covers','Arrived','Guest','Phone (last 4)','Table','Seating area','Shift',
              'Status','Note','Booked by','Booked on','Visits'];
  // Lifetime TOTAL as well as per-cover. Both are SevenRooms' own figures for
  // this guest AT THIS VENUE, passed through untouched so they reconcile to the
  // SevenRooms profile page exactly -- which is the whole point of them.
  //
  // Deliberately NOT exporting SevenRooms' `gross` lifetime field. It is not the
  // same thing as the Gross column on a booking: ours is the menu-price check
  // total and divides by 1.225 to net, whereas SevenRooms' lifetime gross/net
  // ratio runs anywhere from 1.0000 to 1.2764 across the 71 profiles on 24 Jul,
  // so it is some other basis. Two columns both called "gross" meaning two
  // different things in one file is how a report gets quietly misread.
  if(money) head.push('Lifetime spend (AED)', 'Lifetime net per cover (AED)');
  head.push('Last visit');
  if(money) head = head.concat(['Gross (AED)','Net (AED)','Gross per guest (AED)','Net per guest (AED)']);
  var body = rows.map(function(r){
    var g = money ? resGrossOf(r) : 0;
    var heads = resHeads(r);
    var hist = (r.client && RESH.got[r.client] && RESH.got[r.client].scope === 'venue') ? RESH.got[r.client] : null;
    var line = [
      r.time || '', Number(r.pax) || 0, r.arrived != null ? Number(r.arrived) : null,
      r.name || '', r.phone_last4 || '', (r.tables || []).join(', '),
      r.area || '', r.shift || '', r.status_display || r.status || '',
      r.notes || '', r.booked_by || '', String(r.created || '').slice(0, 10),
      hist ? (Number(hist.visits) || 0) : null
    ];
    if(money){
      line.push((hist && Number(hist.spend) > 0) ? Math.round(hist.spend * 100) / 100 : null);
      line.push((hist && Number(hist.per_cover) > 0) ? Math.round(hist.per_cover * 100) / 100 : null);
    }
    line.push(hist && hist.last_visit ? String(hist.last_visit).slice(0, 10) : '');
    if(money){
      // Blank, not zero, when no check is linked -- a 0 here would drag her
      // averages down and read as "this table spent nothing".
      line = line.concat(g ? [
        Math.round(g * 100) / 100,
        Math.round(resNet(g) * 100) / 100,
        heads ? Math.round(g / heads * 100) / 100 : null,
        heads ? Math.round(resNet(g) / heads * 100) / 100 : null
      ] : [null, null, null, null]);
    }
    return line;
  });
  return [head].concat(body);
}

function resExportSummary(rows, money){
  var nm = resNightMoney();
  var t = (RES.data && RES.data.totals) || {};
  var filter = [];
  if(RES.shift !== 'all') filter.push('shift: ' + RES.shift);
  if(RES.q) filter.push('search: "' + RES.q + '"');
  var s = [
    ["Roberto's DIFC - Reservations"],
    ['Night', resDateLabel(RES.date)],
    ['Date', RES.date],
    ['Exported', new Date().toLocaleString('en-GB')],
    ['Rows in this file', rows.length],
    ['Filter applied', filter.length ? filter.join(' | ') : 'none - the whole night'],
    [],
    ['Bookings in the book', Number(t.reservations) || rows.length],
    ['Covers', Number(t.covers) || 0]
  ];
  if(money && nm.gross){
    s = s.concat([
      [],
      ['Bookings with a linked check', nm.bookings],
      ['Guests on those bookings', nm.heads],
      ['Gross (AED)', Math.round(nm.gross * 100) / 100],
      ['Net (AED)', Math.round(nm.net * 100) / 100],
      ['Net per guest (AED)', nm.heads ? Math.round(nm.net / nm.heads * 100) / 100 : null],
      [],
      ['READ THIS BEFORE USING THE TOTALS'],
      ['', 'These figures cover only the ' + nm.bookings + ' booking(s) with a check linked in SevenRooms.'],
      ['', 'A walk-in served without a booking has nothing to attach a check to, so this is NOT the night’s takings.'],
      ['', 'Measured against Simphony it runs roughly 83-98% of the real net, and the gap moves night to night.'],
      ['', 'For what the venue actually took, use the Revenue module or the closing report.'],
      ['', 'The average PER GUEST is reliable (within about 2% of Simphony); the TOTAL is not.'],
      [],
      ['How net is worked out', 'Net = gross ÷ ' + resGrossToNet() + '  (10% service + 7% municipality on net, then 5% VAT)'],
      ['What gross means', 'The menu-price total on the guest’s check - what they actually paid.'],
      [],
      ['The Lifetime columns', 'Visits, Lifetime spend and Lifetime net per cover are SevenRooms’ own figures for that guest AT THIS VENUE across their whole history - not this night.'],
      ['', 'They belong to the GUEST, not the booking, so they must never be added up down the sheet: anyone who booked twice tonight appears twice. That is why the TOTAL row leaves them blank.'],
      ['', 'They come from SevenRooms untouched and match the guest’s SevenRooms profile page. SevenRooms works out per-cover on its own basis, so it will not always equal Lifetime spend divided by covers.']
    ]);
  } else if(money){
    s = s.concat([
      [],
      ['No spend in this file'],
      ['', 'SevenRooms has no checks linked to this night yet. It posts them on a delay, so the newest night usually fills in later.'],
      ['', 'Blank means not posted yet - not that nobody spent anything.']
    ]);
  }
  return s;
}

// Column widths, in the header order resExportSheets() builds. Keyed by header
// text rather than by index so adding a column can't silently shift every width
// one to the left.
var RES_XL_W = {
  'Time':8, 'Covers':8, 'Arrived':9, 'Guest':26, 'Phone (last 4)':13, 'Table':14,
  'Seating area':17, 'Shift':13, 'Status':15, 'Note':46, 'Booked by':18, 'Booked on':12,
  'Visits':8, 'Lifetime spend (AED)':16, 'Lifetime net per cover (AED)':16, 'Last visit':12,
  'Gross (AED)':13, 'Net (AED)':13, 'Gross per guest (AED)':15, 'Net per guest (AED)':15
};

// ONE night as a styled worksheet. Lifted verbatim out of resExportExcel 28 Jul
// when the date-range export arrived: two copies of this drift, and six months
// from now Nicole's range file and her single-night file look like they came from
// two different companies. One builder, both callers.
//   wb      - the ExcelJS workbook to add to
//   name    - the sheet tab name (must be unique in the workbook)
//   rows    - the bookings, already filtered by the caller
//   money   - false hides every money column (no Revenue access)
//   subText - the italic line under the title: which night, how many, filters
function resXlDaySheet(wb, name, rows, money, subText){
  var C = RES_XL;
  var aoa = resExportSheets(rows, money);
  var head = aoa[0], body = aoa.slice(1);

  var ws = wb.addWorksheet(name, {
    views: [{ state:'frozen', ySplit:4 }],          // title+sub+spacer+header stay put
    pageSetup: { orientation:'landscape', fitToPage:true, fitToWidth:1 }
  });
  ws.columns = head.map(function(h){ return { width: RES_XL_W[h] || 14 }; });
  var n = head.length;

  var title = ws.addRow(["ROBERTO'S DIFC  —  Reservations"]);
  title.height = 34;
  ws.mergeCells(title.number, 1, title.number, n);
  title.getCell(1).style = {
    font:{bold:true, size:16, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
    fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
    alignment:{horizontal:'center', vertical:'middle'}
  };
  var sub = ws.addRow([subText]);
  sub.height = 18;
  ws.mergeCells(sub.number, 1, sub.number, n);
  sub.getCell(1).style = {
    font:{size:9, italic:true, color:{argb:'FF'+C.VINO}, name:'Calibri'},
    fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.SABBIA}},
    alignment:{horizontal:'center', vertical:'middle'}
  };
  ws.addRow([]);

  var hdr = ws.addRow(head);
  hdr.height = 30;
  hdr.eachCell(function(cell){
    cell.style = {
      font:{bold:true, size:9, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
      fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
      alignment:{horizontal:'center', vertical:'middle', wrapText:true},
      border: resXlBorder(C.GOLD)
    };
  });
  var headerRowNo = hdr.number;

  // Which columns are money / whole numbers, worked out from the header text so
  // this survives a column being added or the money block being dropped for a
  // user without Revenue access.
  var isMoney = head.map(function(h){ return /\(AED\)/.test(h); });
  var isCount = head.map(function(h){ return h==='Covers' || h==='Arrived' || h==='Visits'; });

  body.forEach(function(r, i){
    var row = ws.addRow(r);
    row.height = 15;
    row.eachCell({includeEmpty:true}, function(cell, ci){
      var z = i % 2 === 1;
      cell.style = {
        font:{size:9, name:'Calibri', color:{argb:'FF'+C.DARK}},
        fill: z ? {type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.LIGHT}} : undefined,
        border: resXlBorder('E2D9C9', 'hair'),
        alignment:{ vertical:'top',
          horizontal: isMoney[ci-1] ? 'right' : (isCount[ci-1] ? 'center' : 'left'),
          wrapText: head[ci-1] === 'Note' }
      };
      // Two decimals on money, none on counts. Without this Excel shows
      // 127.35000000000001 on some rows and 78 on others, in the same column.
      if(isMoney[ci-1]) cell.numFmt = '#,##0.00';
      else if(isCount[ci-1]) cell.numFmt = '0';
    });
  });

  // Filter + total row: she is going to slice this by area and by shift, and a
  // SUBTOTAL (not SUM) re-totals itself as she filters, so the number under the
  // column always matches the rows she is looking at.
  ws.autoFilter = { from:{row:headerRowNo, column:1}, to:{row:headerRowNo + body.length, column:n} };
  if(body.length){
    // ONLY the night's own two money columns are summable. Everything else that
    // happens to carry (AED) must stay blank:
    //   * per-guest columns are averages -- adding them up means nothing
    //   * the lifetime columns belong to the GUEST, not the booking. Summing
    //     lifetime spend down a night double-counts anyone who booked twice and
    //     produces a number that looks like revenue and is nothing of the sort.
    // This was previously driven off "does the header say (AED)", which totalled
    // the lifetime per-cover column -- a meaningless figure sitting in a bold
    // TOTAL row, which is exactly where a wrong number gets believed.
    var SUMMABLE = { 'Gross (AED)':1, 'Net (AED)':1 };
    var totals = head.map(function(h, ci){
      if(!SUMMABLE[h]) return null;
      var col = ws.getColumn(ci+1).letter;
      return { formula:'SUBTOTAL(109,' + col + (headerRowNo+1) + ':' + col + (headerRowNo+body.length) + ')' };
    });
    totals[0] = 'TOTAL';
    var tr = ws.addRow(totals);
    tr.height = 20;
    tr.eachCell({includeEmpty:true}, function(cell, ci){
      cell.style = {
        font:{bold:true, size:9.5, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
        fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
        border: resXlBorder(C.GOLD),
        alignment:{horizontal: isMoney[ci-1] ? 'right' : 'left', vertical:'middle'}
      };
      if(isMoney[ci-1]) cell.numFmt = '#,##0.00';
    });
  }
  return ws;
}

async function resExportExcel(){
  var btn = document.getElementById('res-xls-btn');
  try{
    var rows = resRows();
    if(!rows.length){ alert('Nothing to export - there are no bookings on this night.'); return; }
    if(btn){ btn.disabled = true; btn.textContent = 'Building…'; }
    // Same as the brief: never hand over a file with the history columns
    // silently empty just because the profiles hadn't arrived yet.
    await resEnsureHistory();
    // Belt as well as braces. The await above fixes the race that blanked
    // Nicole's Visits / Last visit columns, but SevenRooms can still simply fail
    // to answer for the profiles. If that happens the file is still useful --
    // every money column is fine -- but she must be TOLD before she downloads it,
    // not left to notice three blank columns later and doubt the whole report.
    var wantHist = rows.filter(function(r){ return r.client; });
    var gotHist = wantHist.filter(function(r){ return RESH.got[r.client]; });
    if(wantHist.length && gotHist.length < wantHist.length * 0.5){
      var go = confirm('Guest history has not loaded for '
        + (wantHist.length - gotHist.length) + ' of ' + wantHist.length + ' bookings, so Visits, '
        + 'Lifetime net per cover and Last visit will be blank for them.\n\n'
        + 'Everything else — covers, gross, net and the per-guest averages — is complete.\n\n'
        + 'Download anyway?');
      if(!go) return;
    }
    await resLoadExcelJS();
    var money = !fohBlocked('revenue');
    var filter = [];
    if(RES.shift !== 'all') filter.push('shift: ' + RES.shift);
    if(RES.q) filter.push('search: "' + RES.q + '"');

    var wb = new ExcelJS.Workbook();
    wb.creator = "Roberto's DIFC"; wb.created = new Date();
    resXlDaySheet(wb, 'Reservations', rows, money,
      resDateLabel(RES.date) + '   |   ' + rows.length + ' booking' + (rows.length===1?'':'s')
      + (filter.length ? '   |   filtered by ' + filter.join(', ') : '')
      + '   |   exported ' + new Date().toLocaleString('en-GB'));
    var C = RES_XL;

    // ── Summary ──
    var sws = wb.addWorksheet('Summary', { pageSetup:{orientation:'portrait', fitToPage:true, fitToWidth:1} });
    sws.columns = [{width:34},{width:88}];
    var srows = resExportSummary(rows, money);
    var stitle = sws.addRow(["ROBERTO'S DIFC  —  Reservations summary"]);
    stitle.height = 30; sws.mergeCells(stitle.number,1,stitle.number,2);
    stitle.getCell(1).style = {
      font:{bold:true, size:14, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
      fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
      alignment:{horizontal:'center', vertical:'middle'}
    };
    sws.addRow([]);
    var warned = false;
    srows.slice(1).forEach(function(r){
      var label = r[0] == null ? '' : String(r[0]);
      var row = sws.addRow([r[0] == null ? '' : r[0], r.length > 1 && r[1] != null ? r[1] : '']);
      if(/^READ THIS|^No spend/.test(label)){
        warned = true;
        row.height = 22;
        sws.mergeCells(row.number, 1, row.number, 2);
        row.getCell(1).style = {
          font:{bold:true, size:10, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
          fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF8C2F1E'}},   // amber-red: a caution, not a heading
          alignment:{horizontal:'left', vertical:'middle', indent:1}
        };
        return;
      }
      // Everything after the warning banner is the warning body -- keep it
      // visually attached to the banner instead of looking like more data.
      row.getCell(1).style = { font:{bold:true, size:9.5, color:{argb:'FF'+C.VINO}, name:'Calibri'}, alignment:{vertical:'top'} };
      row.getCell(2).style = {
        font:{size:9.5, name:'Calibri', color:{argb:'FF'+C.DARK}, italic:warned},
        alignment:{vertical:'top', wrapText:true}
      };
      if(typeof r[1] === 'number'){
        row.getCell(2).numFmt = /AED/.test(label) ? '#,##0.00' : '0';
        row.getCell(2).alignment = {horizontal:'left', vertical:'top'};
      }
      if(warned) row.height = 15;
    });

    var buf = await wb.xlsx.writeBuffer();
    var blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = "Roberto's Reservations " + RES.date + ".xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  }catch(e){
    console.warn('[reservations] excel export failed', e);
    alert('Could not build the Excel file: ' + (e && e.message ? e.message : e) + '\n\nNothing was lost - the book is still on screen.');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Excel'; }
  }
}

// ── DATE-RANGE EXPORT ─────────────────────────────────────────────────────
// Asked for by Francesco 28 Jul 2026 for Nicole: she compiles the chairman's
// report every 10 days and was exporting each night one at a time, then pasting
// ten files together by hand. This gives her ONE workbook: a Summary sheet with
// a line per date, then one full sheet per date behind it.
//
// HOW IT WORKS: exactly the same single call per night the screen already makes
// (resFetchDaysheet), run one date at a time, plus the guest-history call per
// night. Sequential on purpose -- firing 31 nights at the edge function at once
// is how you get rate-limited half way through and end up with a file that is
// quietly missing four days.
//
// WHAT IT DELIBERATELY DOES NOT DO:
//   * It ignores the shift chip and the search box. A range report is a report,
//     not the screen; a filter silently applied across 10 nights is a trap. The
//     dialog says so, and so does the Summary sheet.
//   * It does not touch RES.date / RES.data, so the book on screen is exactly
//     where she left it when the download finishes.
//   * A night that fails is NEVER dropped in silence -- it is named on the
//     Summary sheet under "Nights that could not be read", because a missing
//     night in a chairman's report is worse than no report.
var RES_RANGE_MAX = 31;      // one month at a time; 31 nights is ~62 round trips
var RESR = { open:false, from:'', to:'', busy:false, done:0, total:0, note:'', err:'' };

function resRangeEl(){
  var el = document.getElementById('res-range');
  if(!el){
    el = document.createElement('div');
    el.id = 'res-range';
    document.body.appendChild(el);
    // Backdrop closes it, but never while a download is running -- a half-built
    // workbook thrown away by a stray tap is exactly the kind of small cruelty
    // that stops people using a feature.
    el.addEventListener('click', function(e){ if(e.target === el && !RESR.busy) resRangeClose(); });
  }
  return el;
}
function resRangePaint(){
  var el = resRangeEl();
  el.innerHTML = RESR.open ? resRangeHtml() : '';
  el.className = RESR.open ? 'rg-ov' : '';
}
function resRangeOpen(){
  RESR.open = true; RESR.err = ''; RESR.note = ''; RESR.done = 0; RESR.total = 0;
  // Sensible default: the ten nights ending on the night she is looking at,
  // which is the shape of the report she actually writes.
  if(!RESR.to) RESR.to = RES.date || resToday();
  if(!RESR.from) RESR.from = resShiftDate(RESR.to, -9);
  resRangePaint();
}
function resRangeClose(){ if(RESR.busy) return; RESR.open = false; resRangePaint(); }
function resRangeSet(which, v){
  if(!v) return;
  RESR[which] = v;
  RESR.err = '';
  resRangePaint();
}
if(!window._resRangeKey){
  window._resRangeKey = true;
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && RESR.open && !RESR.busy) resRangeClose();
  });
}

// The nights between two dates, inclusive. Returns [] if the range is backwards
// or longer than the cap -- the caller says why, this just answers.
function resRangeDates(from, to){
  var out = [];
  if(!from || !to || from > to) return out;
  var d = from;
  while(d <= to){
    out.push(d);
    d = resShiftDate(d, 1);
    if(out.length > RES_RANGE_MAX) break;
  }
  return out;
}

function resRangeHtml(){
  var days = resRangeDates(RESR.from, RESR.to);
  var bad = '';
  if(RESR.from && RESR.to && RESR.from > RESR.to) bad = 'The "from" date is after the "to" date.';
  else if(days.length > RES_RANGE_MAX) bad = 'That is ' + days.length + ' nights. Please pick ' + RES_RANGE_MAX + ' or fewer — a longer range takes too long and SevenRooms starts refusing.';
  var h = ['<div class="rg-card" role="dialog" aria-modal="true" aria-label="Export a date range">'];
  h.push('<div class="rg-head"><div>');
  h.push('<div class="rg-kicker">Excel &middot; date range</div>');
  h.push('<div class="rg-name">Several nights, one file</div></div>');
  if(!RESR.busy) h.push('<button class="rg-x" onclick="resRangeClose()" aria-label="Close">&times;</button>');
  h.push('</div>');

  h.push('<div class="rvp-sub">One Summary sheet with a line per night, then a full sheet for each night — the same layout as the single-night export.</div>');

  h.push('<div class="resr-row"><label>From<input class="res-date" type="date" value="'+resEsc(RESR.from)+'" '
    + (RESR.busy?'disabled ':'') + 'onchange="resRangeSet(\'from\', this.value)"></label>');
  h.push('<label>To<input class="res-date" type="date" value="'+resEsc(RESR.to)+'" '
    + (RESR.busy?'disabled ':'') + 'onchange="resRangeSet(\'to\', this.value)"></label></div>');

  if(bad){
    h.push('<div class="resr-bad">'+resEsc(bad)+'</div>');
  }else if(days.length){
    h.push('<div class="resr-note">'+days.length+' night'+(days.length===1?'':'s')
      + ' &middot; about '+Math.max(1, Math.round(days.length*3/60*10)/10)+' min to build</div>');
  }
  h.push('<div class="resr-note resr-quiet">The shift chips and the search box are ignored — a range file always carries the whole of every night.</div>');

  if(RESR.busy){
    h.push('<div class="resr-prog"><b>'+resEsc(RESR.note||'Working…')+'</b>'
      + '<div class="resr-bar"><i style="width:'+(RESR.total?Math.round(RESR.done/RESR.total*100):0)+'%"></i></div>'
      + '<span>'+RESR.done+' of '+RESR.total+' nights read</span></div>');
    h.push('<div class="resr-note resr-quiet">Keep this window open until the file downloads.</div>');
  }
  if(RESR.err) h.push('<div class="resr-bad">'+resEsc(RESR.err)+'</div>');

  h.push('<div class="rvp-acts">');
  h.push('<button class="res-btn" onclick="resRangeClose()"'+(RESR.busy?' disabled':'')+'>Close</button>');
  h.push('<button class="res-btn res-btn-go" onclick="resRangeRun()"'
    + ((RESR.busy || bad || !days.length) ? ' disabled title="'+resEsc(bad || 'Pick a from and a to date')+'"' : '')
    + '>'+(RESR.busy?'Building…':'Download Excel')+'</button>');
  h.push('</div></div>');
  return h.join('');
}

// Guest history for a night that is NOT on screen. Deliberately separate from
// resEnsureHistory: that one owns the screen's loading flag and its in-flight
// promise, and the range export must not make the book look like it is loading.
// Shares the same RESH.got cache, so a guest who ate on four of the ten nights
// is fetched once. Never throws -- a night with no history is still a good sheet.
async function resHistoryForRows(rows){
  var want = [], venue = '';
  (rows || []).forEach(function(r){
    if(!venue && r.venue) venue = r.venue;
    var id = r.client;
    if(id && !RESH.got[id] && !RESH.failed[id] && want.indexOf(id) === -1) want.push(id);
  });
  if(!want.length) return;
  try{
    var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?guests=' + encodeURIComponent(want.join(','))
        + '&venue=' + encodeURIComponent(venue), {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    var j = await r.json();
    if(!j || !j.ok) throw new Error((j && j.error) || 'no data');
    var map = j.guests || {};
    want.forEach(function(id){ if(map[id]) RESH.got[id] = map[id]; else RESH.failed[id] = 1; });
  }catch(e){
    console.warn('[reservations] range history failed', e);
  }
}

async function resRangeRun(){
  if(RESR.busy) return;
  var days = resRangeDates(RESR.from, RESR.to);
  if(!days.length || days.length > RES_RANGE_MAX) return;
  RESR.busy = true; RESR.err = ''; RESR.done = 0; RESR.total = days.length;
  RESR.note = 'Starting…';
  resRangePaint();
  try{
    await resLoadExcelJS();
    var money = !fohBlocked('revenue');
    var C = RES_XL;
    var wb = new ExcelJS.Workbook();
    wb.creator = "Roberto's DIFC"; wb.created = new Date();

    // Summary first so it is the tab that opens, filled in at the end once every
    // night is counted.
    var sws = wb.addWorksheet('Summary', { pageSetup:{orientation:'landscape', fitToPage:true, fitToWidth:1} });

    var lines = [], problems = [], anyRows = false;
    for(var i=0;i<days.length;i++){
      var d = days[i];
      RESR.note = 'Reading ' + resDateLabel(d);
      resRangePaint();
      try{
        var pay = await resFetchDaysheet(d);
        var rows = (pay && pay.reservations) || [];
        if(rows.length){
          await resHistoryForRows(rows);
          anyRows = true;
        }
        var t = (pay && pay.totals) || {};
        var nm = resNightMoney(rows);
        lines.push({
          date: d,
          bookings: Number(t.reservations) || rows.length,
          covers: Number(t.covers) || rows.reduce(function(a,r){ return a + (Number(r.pax)||0); }, 0),
          withCheck: nm.bookings, heads: nm.heads, gross: nm.gross, net: nm.net
        });
        // An empty night still gets its own sheet, so nobody wonders whether a
        // missing tab means "closed" or "the export skipped it".
        resXlDaySheet(wb, d, rows, money,
          resDateLabel(d) + '   |   ' + rows.length + ' booking' + (rows.length===1?'':'s')
          + '   |   whole night, no filters   |   exported ' + new Date().toLocaleString('en-GB'));
      }catch(e){
        console.warn('[reservations] range: night failed', d, e);
        problems.push({ date: d, why: (e && e.message) ? String(e.message) : 'could not be read' });
      }
      RESR.done = i + 1;
      resRangePaint();
    }

    if(!lines.length){
      RESR.err = 'None of those nights could be read from SevenRooms. Nothing was downloaded.';
      return;
    }

    // ── Summary sheet ──
    RESR.note = 'Building the file…';
    resRangePaint();
    var head = ['Date','Day','Bookings','Covers'];
    if(money) head = head.concat(['Bookings with a check','Guests on those','Gross (AED)','Net (AED)','Net per guest (AED)']);
    var W = {'Date':13,'Day':12,'Bookings':11,'Covers':10,'Bookings with a check':17,'Guests on those':14,
             'Gross (AED)':14,'Net (AED)':14,'Net per guest (AED)':16};
    sws.columns = head.map(function(h){ return { width: W[h] || 14 }; });
    var n = head.length;

    var stitle = sws.addRow(["ROBERTO'S DIFC  —  Reservations"]);
    stitle.height = 34; sws.mergeCells(stitle.number, 1, stitle.number, n);
    stitle.getCell(1).style = {
      font:{bold:true, size:16, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
      fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
      alignment:{horizontal:'center', vertical:'middle'}
    };
    var ssub = sws.addRow([resDateLabel(days[0]) + '  to  ' + resDateLabel(days[days.length-1])
      + '   |   ' + lines.length + ' night' + (lines.length===1?'':'s')
      + '   |   whole night, no filters   |   exported ' + new Date().toLocaleString('en-GB')]);
    ssub.height = 18; sws.mergeCells(ssub.number, 1, ssub.number, n);
    ssub.getCell(1).style = {
      font:{size:9, italic:true, color:{argb:'FF'+C.VINO}, name:'Calibri'},
      fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.SABBIA}},
      alignment:{horizontal:'center', vertical:'middle'}
    };
    sws.addRow([]);

    var shdr = sws.addRow(head);
    shdr.height = 30;
    shdr.eachCell(function(cell){
      cell.style = {
        font:{bold:true, size:9, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
        fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
        alignment:{horizontal:'center', vertical:'middle', wrapText:true},
        border: resXlBorder(C.GOLD)
      };
    });
    var isM = head.map(function(h){ return /\(AED\)/.test(h); });
    var tot = { bookings:0, covers:0, withCheck:0, heads:0, gross:0, net:0 };
    lines.forEach(function(L, i){
      tot.bookings += L.bookings; tot.covers += L.covers;
      tot.withCheck += L.withCheck; tot.heads += L.heads;
      tot.gross += L.gross; tot.net += L.net;
      var vals = [L.date, resWeekday(L.date), L.bookings, L.covers];
      if(money) vals = vals.concat([
        L.withCheck, L.heads,
        L.gross ? Math.round(L.gross*100)/100 : null,
        L.gross ? Math.round(L.net*100)/100 : null,
        (L.gross && L.heads) ? Math.round(L.net/L.heads*100)/100 : null
      ]);
      var row = sws.addRow(vals);
      row.height = 16;
      row.eachCell({includeEmpty:true}, function(cell, ci){
        cell.style = {
          font:{size:9.5, name:'Calibri', color:{argb:'FF'+C.DARK}},
          fill: (i % 2 === 1) ? {type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.LIGHT}} : undefined,
          border: resXlBorder('E2D9C9', 'hair'),
          alignment:{ vertical:'middle', horizontal: isM[ci-1] ? 'right' : (ci<=2 ? 'left' : 'center') }
        };
        if(isM[ci-1]) cell.numFmt = '#,##0.00';
        else if(ci > 2) cell.numFmt = '0';
      });
    });
    // Plain numbers, not SUBTOTAL: this sheet has no filter on it, and the total
    // of the per-guest column is an AVERAGE (total net / total guests), which a
    // SUM would get wrong.
    var trow = ['TOTAL','', tot.bookings, tot.covers];
    if(money) trow = trow.concat([
      tot.withCheck, tot.heads,
      Math.round(tot.gross*100)/100, Math.round(tot.net*100)/100,
      tot.heads ? Math.round(tot.net/tot.heads*100)/100 : null
    ]);
    var tr = sws.addRow(trow);
    tr.height = 20;
    tr.eachCell({includeEmpty:true}, function(cell, ci){
      cell.style = {
        font:{bold:true, size:10, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
        fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
        border: resXlBorder(C.GOLD),
        alignment:{horizontal: isM[ci-1] ? 'right' : (ci<=2 ? 'left' : 'center'), vertical:'middle'}
      };
      if(isM[ci-1]) cell.numFmt = '#,##0.00';
      else if(ci > 2) cell.numFmt = '0';
    });

    // Anything that did not make it into the file, named. Never silent.
    if(problems.length){
      sws.addRow([]);
      var pb = sws.addRow(['NIGHTS THAT COULD NOT BE READ — they are NOT in this file']);
      pb.height = 22; sws.mergeCells(pb.number, 1, pb.number, n);
      pb.getCell(1).style = {
        font:{bold:true, size:10, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
        fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF8C2F1E'}},
        alignment:{horizontal:'left', vertical:'middle', indent:1}
      };
      problems.forEach(function(p){
        var r = sws.addRow([p.date, p.why]);
        sws.mergeCells(r.number, 2, r.number, n);
        r.getCell(1).style = { font:{bold:true, size:9.5, color:{argb:'FF'+C.VINO}, name:'Calibri'} };
        r.getCell(2).style = { font:{size:9.5, italic:true, name:'Calibri', color:{argb:'FF'+C.DARK}} };
      });
    }

    // The same warning the single-night file carries. A range file travels
    // further, not less far, so it needs it more.
    if(money){
      sws.addRow([]);
      var wb1 = sws.addRow(['READ THIS BEFORE USING THE TOTALS']);
      wb1.height = 22; sws.mergeCells(wb1.number, 1, wb1.number, n);
      wb1.getCell(1).style = {
        font:{bold:true, size:10, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
        fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF8C2F1E'}},
        alignment:{horizontal:'left', vertical:'middle', indent:1}
      };
      [
        'These figures cover only the bookings with a check linked in SevenRooms.',
        'A walk-in served without a booking has nothing to attach a check to, so this is NOT what the venue took.',
        'Measured against Simphony it runs roughly 83-98% of the real net, and the gap moves night to night.',
        'For what the venue actually took, use the Revenue module or the closing report.',
        'The average PER GUEST is reliable (within about 2% of Simphony); the TOTAL is not.',
        'Net = gross ÷ ' + resGrossToNet() + '  (10% service + 7% municipality on net, then 5% VAT). Gross is the menu-price total on the guest’s check.',
        'Covers and Bookings are SevenRooms’ own counts for the night. Guests on those counts only the bookings that carry a check.'
      ].forEach(function(t){
        var r = sws.addRow(['', t]);
        sws.mergeCells(r.number, 2, r.number, n);
        r.getCell(2).style = { font:{size:9.5, italic:true, name:'Calibri', color:{argb:'FF'+C.DARK}}, alignment:{vertical:'top', wrapText:true} };
        r.height = 15;
      });
    }
    if(!anyRows) RESR.note = 'No bookings on any of those nights.';

    var buf = await wb.xlsx.writeBuffer();
    var blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = "Roberto's Reservations " + days[0] + " to " + days[days.length-1] + ".xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    RESR.busy = false;
    RESR.open = false;                       // done — get out of her way
    resRangePaint();
    return;
  }catch(e){
    console.warn('[reservations] range export failed', e);
    RESR.err = 'Could not build the file: ' + ((e && e.message) ? e.message : e) + '. Nothing was lost — the book on screen is untouched.';
  }finally{
    RESR.busy = false;
    resRangePaint();
  }
}

// "Wednesday" for the Summary sheet. Its own helper because resDateLabel prints
// the whole date and the Summary already has a Date column beside it.
function resWeekday(iso){
  try{ return new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'}); }
  catch(e){ return ''; }
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
  // Disabled while the history is still arriving, and it says why — a brief
  // printed with an empty history column is worse than waiting three seconds.
  h.push('<button class="res-btn res-btn-go" onclick="resPrintBrief()"'
    + (RESH.loading?' disabled title="Reading guest history…"':' title="Print a pre-service brief for the team"')
    + '>'+(RESH.loading?'Reading guests…':'Print brief')+'</button>');
  h.push('<button class="res-btn" id="res-xls-btn" onclick="resExportExcel()" title="Download this night as an Excel file">Excel</button>');
  h.push('<button class="res-btn" onclick="resRangeOpen()" title="Download several nights as ONE Excel file — a summary line per night plus a full sheet for each">Excel: date range</button>');
  // The way across to the Reports module. It is a separate module (Nicole's
  // call, round res-reports / f-module) and has its own card on the landing
  // page — this is just so somebody already looking at the book does not have
  // to go back out to the hub to ask a question about the last three months.
  h.push('<button class="res-btn" onclick="enterApp(\'resreports\')" title="Guests, channels, walk-ins, no-shows and win-back lists across a period">Reports</button>');
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
    // Two money tiles, only once the night actually has checks. Net per guest is
    // the one Nicole reads, so it gets its own tile rather than being buried in a
    // tooltip. Both are labelled "linked checks" on the tile itself -- the tile
    // sits beside Covers, and without the label it would be read as the night's
    // revenue, which it is not (see resNet's note).
    + (function(){
        if(!money) return '';
        var nm = resNightMoney();
        if(!nm.gross) return '';
        return '<div class="res-tot-i"><b><small>AED </small>'+resMoney0(nm.gross)+'</b><span>Gross &middot; linked checks</span></div>'
          + '<div class="res-tot-i"><b><small>AED </small>'+resMoney0(nm.net)+'</b><span>Net &middot; linked checks</span></div>'
          + (nm.heads
              ? '<div class="res-tot-i"><b><small>AED </small>'+resMoney0(nm.net/nm.heads)+'</b><span>Net per guest</span></div>'
              : '');
      })()
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
      // Area money: only the bookings in THIS area that carry a check, and it says
      // how many that was. "AED 24,436 over 12 of 22 bookings" is a figure a
      // manager can act on; the same number with the coverage hidden is one they
      // would wrongly read as the room's takings.
      var aGross = 0, aHeads = 0, aN = 0;
      if(money) list.forEach(function(r){ var g = resGrossOf(r); if(!g) return; aGross += g; aHeads += resHeads(r); aN++; });
      h.push('<div class="res-area">'+resEsc(k)+' <span>'+list.length+' reservation'+(list.length===1?'':'s')+' &middot; '+cov+' covers'
        + (aGross ? ' &middot; <b>AED '+resMoney0(aGross)+'</b> gross &middot; AED '+resMoney0(resNet(aGross))+' net'
                    + (aHeads?' &middot; AED '+resMoney0(resNet(aGross)/aHeads)+' net per guest':'')
                    + ' <i>(' + aN + ' of ' + list.length + ' with a check)</i>' : '')
        + '</span></div>');
      h.push('<div class="res-tbl">');
      // TWO header rows, banded like the printed brief. The guest's history used
      // to live as one small italic line under their name -- "15 visits · AED
      // 177 net/cover · last 23 Jan 2025" -- which is readable but not SCANNABLE:
      // you cannot run your eye down a column that does not exist. It is five
      // columns now, grouped under one band so nobody mistakes a lifetime
      // average for tonight's bill.
      // Both rows sit in .res-stick so they FREEZE under the topbar while the
      // list scrolls (asked for 31 Jul: on a 40-booking night you lose track of
      // which number is which). The band travels with them on purpose -- freezing
      // "Total / Per guest / Per table" without "Been with us" over it is exactly
      // how a lifetime average gets read as tonight's bill.
      h.push('<div class="res-stick">');
      h.push('<div class="res-r res-hdr res-band">'
        + '<div class="rb-skip"></div>'
        // The band names the basis, because the column beside this block
        // prints tonight's check as gross AND net. Two money figures on one
        // row with different bases and no labels is how the wrong pair gets
        // compared. SevenRooms' lifetime figures are net -- verified 28 Jul,
        // spend/covers reproduces their per-cover to the fils, gross/covers
        // does not.
        + '<div class="rb-hist">Been with us' + (money ? ' &middot; net' : '') + '</div>'
        + '<div class="rb-rest"></div>'
        + '</div>');
      h.push('<div class="res-r res-hdr">'
        + '<div>Time</div><div>Covers</div><div>Guest</div><div>Table</div>'
        + '<div>Status</div>'
        + '<div class="res-lv">Last here</div><div class="res-vc">Visits</div>'
        + (money?'<div class="res-right res-m1">Total</div>'
                +'<div class="res-right res-m2">Per guest</div>'
                +'<div class="res-right res-m3">Per table</div>':'')
        + '<div>Note</div><div>Booked by</div>'
        + (money?'<div class="res-right">Tonight<i>gross &middot; net</i></div>':'')
        + '</div>');
      h.push('</div>');
      list.forEach(function(r){
        var st = (r.state==='seated') ? 'seated' : (r.state==='completed' ? 'done' : 'due');
        h.push('<div class="res-r res-'+st+'">'
          + '<div class="res-time">'+resEsc(r.time||'')+'</div>'
          + '<div class="res-pax">'+resNum(r.pax)+(r.arrived?'<i> · '+resNum(r.arrived)+' in</i>':'')+'</div>'
          // The name is a button when SevenRooms has a client record for it —
          // tapping opens their history. A booking with no client id (rare, and
          // real: some walk-ins are logged without one) stays plain text rather
          // than offering a tap that would open an empty panel. The id is
          // stripped to id-safe characters before it goes near an onclick.
          + '<div class="res-name">'+(r.vip?'<span class="res-vip" title="VIP">VIP</span> ':'')
              + (r.client
                  ? '<button class="res-guest-btn" onclick="resOpenGuest(\''+String(r.client).replace(/[^A-Za-z0-9_-]/g,'')+'\',\''+resEsc(r.time||'')+'\')" title="See this guest’s history">'+resEsc(r.name)+'</button>'
                  // No client record, but a linked check — the tap is still
                  // worth offering, because what the table ordered is on the
                  // booking itself and needs no guest profile to read.
                  : (r.items && r.items.length
                      ? '<button class="res-guest-btn" onclick="resOpenGuest(\'\',\''+resEsc(r.time||'')+'\')" title="See what they ordered">'+resEsc(r.name)+'</button>'
                      : resEsc(r.name)))
              + (r.phone_last4?'<i class="res-phone">••• '+resEsc(r.phone_last4)+'</i>':'')
              // The history line that used to sit here is now five real columns
              // (resHistCells) -- see the banded header above.
              // Under the history line, not beside the name: the name column is
              // already the widest thing on the row and a chip inline with it
              // would push the table number off small screens.
              + resVipChip(r)+'</div>'
          // Blank, not "not assigned": verified 23 Jul that SevenRooms' API only
          // returns a table once the hosts LOCK it (10 of 13 bookings that night
          // came back empty while the SevenRooms screen showed an auto-suggested
          // table beside a scissors icon). The kitchen floorplan feed counts the
          // same 10 as unassigned, so this is the API, not this screen. Claiming
          // "not assigned" would contradict what the hosts can see.
          + '<div class="res-tbls">'+((r.tables&&r.tables.length)?resEsc(r.tables.join(', ')):'<i>&mdash;</i>')+'</div>'
          + '<div><span class="res-pill res-pill-'+st+'">'+resEsc(r.status_display||r.status||'')+'</span></div>'
          + resHistCells(r, money)
          + resNoteCell(r)
          + '<div class="res-by">'+resEsc(r.booked_by||'')+(r.created?'<i>'+resEsc(resWhen(r.created))+'</i>':'')+'</div>'
          + (money?'<div class="res-right">'+resSpendCell(r)+'</div>':'')
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

  // The money caveat, stated where the money is -- not in a tooltip somebody has
  // to go looking for. Two separate cases, and they need different sentences:
  //   * checks exist but cover only part of the night -> say what fraction, and
  //     say plainly that Revenue/the closing report is the real figure. Walk-ins
  //     served without a booking have no reservation to carry a check.
  //   * no checks at all -> almost always the newest night, which SevenRooms
  //     posts on a delay. Saying "no spend" there would be a lie.
  if(money && RES.data){
    var ft = RES.data.totals || {};
    var nm = resNightMoney();
    var totalRes = Number(ft.reservations)||0, withMoney = nm.bookings;
    if(nm.gross){
      h.push('<div class="res-foot res-foot-money">Spend covers the '+resNum(withMoney)+' of '+resNum(totalRes)
        + ' booking'+(totalRes===1?'':'s')+' with a check linked in SevenRooms, so it is <b>not</b> the night&rsquo;s takings &mdash; a walk-in with no booking has nothing to attach a check to. '
        + 'For what the venue actually took, use Revenue or the closing report. Net = gross &divide; '+resGrossToNet()
        + ' (10% service + 7% municipality, then 5% VAT).</div>');
    } else if(totalRes){
      h.push('<div class="res-foot res-foot-money">No checks are linked to this night in SevenRooms yet &mdash; it posts them on a delay, so the newest night usually fills in later. '
        + 'Blank here means <b>not posted yet</b>, not that nobody spent anything.</div>');
    }
  }

  h.push('</div>');
  return h.join('');
}
