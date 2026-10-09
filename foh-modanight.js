// ── MODA NIGHT (7 Oct 2026) ───────────────────────────────────────────────────
// Wednesday in Scala, 8 PM to 1 AM, sold with a package. Francesco, 7 Oct 2026: track it the
// way Business Lunch is tracked — read from the checks, nothing typed — not the old
// Activations pattern (tasks, stages, team cards). It took the Activations card's place;
// Activations stays hidden (FOH_HIDE_ACTIVATIONS) and every old row is kept.
//
// WHERE THE NUMBERS COME FROM: the Simphony check SevenRooms attaches to each booking, read
// through the Kitchen `sevenrooms-sync ?daysheet=` call (same as Business Lunch). On the till:
//   ModaNight@230      one package (a zero-priced marker line)
//   MN Fd / MN (Alc) / MN (Wine)   the package price, split 80 / 75 / 75 per package
//   MN …               what the guest had inside the package (zero-priced)
// The first night on the checks is Wed 30 Sep 2026 (22 packages); 16 and 23 Sep have none.
// SCALA = every area that is not PIEMONTE (the closing report's own rule). A Scala booking
// counts for the night when it has a package or was booked for 8 PM or later.
// MONEY: line prices are menu prices; net = ÷ fohSubtotalToNetDiv (1.155 since 16 Sep). The
// check SUBTOTAL is the table total (some discounts never reach the item list).
// THE GAP: a walk-in rung with no booking is not here. The closing report's Scala figure for
// the whole night is shown beside it, so the gap shows as a difference.
//
// COMPS (9 Oct 2026): SevenRooms' copy of a check NEVER carries its discounts. On 7 Oct 14 of
// 16 packages were comped 100% (check 20331, "MODA NIGHT C/O MS OUAFA", total 0.00) and this
// screen counted them at full price: 3,385 package net against Simphony's real 398. So every
// Thursday night a scheduled task reads Simphony and writes the night into `moda_night_sim`
// (FOH db, authenticated read). When that row exists, the money and the package counts on this
// screen come from it — paid vs comped, with the comp reason — and SevenRooms only supplies the
// table list and what was eaten. Until it exists the night is marked "not checked yet".

var MN = { pick: null, nights: {}, loading: {}, failed: {}, sim: {}, simph: {}, open: {}, list: null };
var MN_FIRST = '2026-09-30';

function mnIsPackage(n){ return /^moda\s*night/i.test(String(n||'')); }
function mnIsSplit(n){ return /^MN\s+(Fd|\(Alc\)|\(Wine\))\s*$/i.test(String(n||'').trim()); }
function mnIsItem(n){ return /^MN\s/.test(String(n||'')) && !mnIsSplit(n); }
function mnSplitKind(n){ var m = String(n||'').match(/^MN\s+(Fd|\(Alc\)|\(Wine\))/i); return m ? (m[1].toLowerCase()==='fd' ? 'food' : 'drink') : null; }
function mnNice(n){ var s = String(n||'').replace(/^MN\s+/,'').replace(/\s+GL$/i,' (glass)').trim(); return s.charAt(0).toUpperCase()+s.slice(1); }
function mnIsScala(r){ return String(r.area||'').toUpperCase() !== 'PIEMONTE'; }
function mnWednesdays(){
  var t = blToday(), d = blAdd(t, -((blDow(t) - 2 + 7) % 7)), a = [];   // the latest Wednesday on or before today
  while(d >= MN_FIRST){ a.push(d); d = blAdd(d, -7); }
  return a;                                                               // newest first
}

function mnDigest(iso, j){
  var out = { date: iso, packages: 0, pkgFood: 0, pkgDrink: 0, checks: 0, other: 0, tables: 0, guests: 0, items: {}, rows: [], price: null };
  (j.reservations||[]).forEach(function(r){
    if(r.state === 'cancelled' || r.state === 'noshow' || !mnIsScala(r)) return;
    var items = r.items || [], pk = 0, pf = 0, pd = 0, its = {};
    items.forEach(function(it){
      var q = Number(it.qty)||0, p = Number(it.price)||0;
      if(mnIsPackage(it.name)){ pk += q; var m = String(it.name).match(/@\s*(\d+(?:\.\d+)?)/); if(m) out.price = Number(m[1]); }
      else if(mnIsSplit(it.name)){ if(mnSplitKind(it.name)==='food') pf += p; else pd += p; }
      else if(mnIsItem(it.name)){ var k = mnNice(it.name); its[k] = (its[k]||0) + q; }
    });
    var hh = parseInt(String(r.time||'').slice(0,2), 10);
    var inWindow = pk > 0 || (hh >= 20 || hh < 1);
    if(!inWindow) return;
    var cg = (typeof r.gross === 'number') ? r.gross : items.reduce(function(s, it){ return s + (Number(it.price)||0); }, 0);
    out.packages += pk; out.pkgFood += pf; out.pkgDrink += pd; out.checks += cg; out.other += cg - pf - pd;
    out.tables++; out.guests += Number(r.pax)||0;
    Object.keys(its).forEach(function(k){ out.items[k] = (out.items[k]||0) + its[k]; });
    out.rows.push({ time: r.time||'', guest: String(r.name||'').trim(), vip: !!r.vip, walkin: /walk\s*in/i.test(String(r.booked_by||'')),
      tables: (r.tables||[]).join(', '), area: r.area||'', pax: Number(r.pax)||0, packages: pk, check: cg, items: its });
  });
  out.rows.sort(function(a,b){ return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0); });
  return out;
}
async function mnFetch(iso){
  var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?daysheet=' + iso + '&include=all', {
    method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET } });
  if(!r.ok) throw new Error('HTTP '+r.status);
  var j = await r.json();
  if(!j || !j.ok || !Array.isArray(j.reservations)) throw new Error((j && j.error) || 'no data');
  return mnDigest(iso, j);
}
async function mnLoad(dates, force){
  var t = blToday(), want = dates.filter(function(d){ return d <= t && !MN.loading[d] && (force || !MN.nights[d] || d >= blAdd(t, -1)); });
  if(!want.length) return;
  want.forEach(function(d){ MN.loading[d] = true; }); mnRepaint();
  var q = want.slice();
  async function worker(){ while(q.length){ var d = q.shift();
    try { MN.nights[d] = await mnFetch(d); delete MN.failed[d]; } catch(e){ MN.failed[d] = String(e && e.message || e); }
    delete MN.loading[d]; mnRepaint(); } }
  await Promise.all([worker(), worker(), worker()]);
}
async function mnLoadSim(dates){
  if(typeof sb === 'undefined' || MN.simAsked) return;
  MN.simAsked = true;
  try {
    var res = await sb.from('rev_daily').select('service_date,lounge_net,lounge_covers_actual,lounge_dinner_net').in('service_date', dates);
    (res.data||[]).forEach(function(r){ MN.sim[String(r.service_date).slice(0,10)] = { net: r.lounge_net==null ? null : Number(r.lounge_net), covers: r.lounge_covers_actual }; });
  } catch(e){}
  try {
    var sp = await sb.from('moda_night_sim').select('night,packages,packages_paid,packages_comp,package_net,comp_value,comps,items,checks,scala_window_net,scala_day_net,note,read_at').in('night', dates);
    MN.simph = {};
    (sp.data||[]).forEach(function(r){ MN.simph[String(r.night).slice(0,10)] = r; });
  } catch(e){}
  mnRepaint();
}
function mnRepaint(){ if(typeof state === 'object' && state && state.currentTab === 'modanight' && typeof renderMain === 'function') renderMain(); }
function mnPickNight(d){ MN.pick = d; MN.open = {}; mnRepaint(); mnLoad([d]); }
function mnToggle(i){ MN.open[i] = !MN.open[i]; mnRepaint(); }
function mnRefresh(){ MN.simAsked = false; var w = mnWednesdays(); mnLoad(w, true); mnLoadSim(w); }

function renderModaNight(){
  blCss(); mnCss();
  var weds = mnWednesdays(), t = blToday(), money = blMoney();
  if(!MN.pick || weds.indexOf(MN.pick) < 0) MN.pick = weds[0];
  var need = weds.some(function(d){ return !MN.nights[d] && !MN.loading[d] && !MN.failed[d]; }) || (MN.pick === t && !MN.loading[t] && Date.now() - (MN.kick||0) > 120000);
  if(need){ MN.kick = Date.now(); setTimeout(function(){ mnLoad(weds); }, 0); }
  if(!MN.simAsked) setTimeout(function(){ mnLoadSim(weds); }, 0);
  var d = MN.pick, N = MN.nights[d], sim = MN.sim[d] || {}, busy = weds.some(function(x){ return MN.loading[x]; });
  var price = (N && N.price) || 230;
  var h = ['<div class="res-wrap bl-wrap mn-wrap">'];

  h.push('<div class="res-head"><div class="res-head-l"><div class="res-kicker">Scala &middot; Wednesday &middot; 8 PM &ndash; 1 AM &middot; package AED '+blN(price)+'</div>'
    + '<div class="res-title">Moda Night</div></div><div class="res-head-r">');
  var i = weds.indexOf(d);
  h.push('<button class="res-btn" onclick="mnPickNight(\''+(weds[i+1]||d)+'\')"'+(i >= weds.length-1?' disabled':'')+' aria-label="Earlier night">&lsaquo;</button>');
  h.push('<span class="bl-week">'+blDayName(d)+' '+blDateLabel(d)+'</span>');
  h.push('<button class="res-btn" onclick="mnPickNight(\''+(weds[i-1]||d)+'\')"'+(i <= 0?' disabled':'')+' aria-label="Later night">&rsaquo;</button>');
  h.push('<button class="res-btn" onclick="mnRefresh()"'+(busy?' disabled':'')+'>'+(busy?'Reading&hellip;':'Refresh')+'</button></div></div>');

  if(MN.failed[d]) h.push('<div class="rr-bad bl-bad">'+blEsc(blDayName(d)+' '+blDateLabel(d))+' could not be read. Press Refresh to try again.</div>');

  // hero: packages that night — Simphony's count once the Thursday check has run
  var S = MN.simph[d] || null, hasPaid = S && S.packages_paid != null;
  var heroN = S ? S.packages : (N ? N.packages : null);
  h.push('<div class="rv2-hero '+(heroN ? 'good' : 'empty')+'"><div class="rv2-tag">'+(d===t ? 'Tonight' : blDayName(d, true)+' '+blDateLabel(d))+' &middot; packages sold'
    + (S ? ' &middot; checked in Simphony' : '')+'</div>');
  h.push('<div class="rv2-bignum"><span class="n">'+(heroN != null ? blN(heroN) : '&hellip;')+'</span><span class="of">'
    + (S ? (hasPaid ? '<b>'+blN(S.packages_paid)+' paid</b> &middot; <b>'+blN(S.packages_comp)+' comped</b>' : 'comps not read yet')
         : (N ? blN(N.guests)+' guests at '+blN(N.tables)+' Scala table'+(N.tables===1?'':'s')+' from 8 PM' : 'reading the book&hellip;'))
    + (!S && sim.covers ? ' &middot; closing report Scala covers '+blN(sim.covers) : '')+'</span></div>');
  if(d === t) h.push('<div class="bl-hero-days"><span class="today">The night is still running &mdash; Refresh to read the latest checks.</span></div>');
  else if(!S) h.push('<div class="bl-hero-days"><span class="today">Not checked in Simphony yet &mdash; until Thursday night&rsquo;s check, comped packages show here at full price.</span></div>');
  h.push('</div>');

  if(S){
    if(money) h.push('<div class="rv2-stats">'
      + '<div class="rv2-stat"><div class="l">Paid packages net</div><div class="v">'+blN(S.package_net)+'</div></div>'
      + '<div class="rv2-stat"><div class="l">Comped (menu price)</div><div class="v">'+(S.comp_value != null ? blN(S.comp_value) : '&ndash;')+'</div></div>'
      + '<div class="rv2-stat"><div class="l">Scala 8 PM &ndash; 1 AM</div><div class="v">'+blN(S.scala_window_net)+'</div></div>'
      + '<div class="rv2-stat"><div class="l">Scala whole night</div><div class="v">'+blN(S.scala_day_net)+'</div></div>'
      + '</div>');
    var cs = Array.isArray(S.comps) ? S.comps : [];
    if(cs.length) h.push('<div class="bl-note mn-sim mn-comps"><b>Comped</b>'+cs.map(function(c){
      return '<div>'+blN(c.packages)+' package'+(c.packages==1?'':'s')+' &middot; table '+blEsc(c.table)+' &middot; check '+blEsc(c.check)
        + (money && c.amount != null ? ' &middot; '+blN(c.amount) : '')+' &mdash; '+blEsc(c.reason||'no reason given')+'</div>'; }).join('')+'</div>');
    if(S.note) h.push('<div class="bl-note mn-sim">'+blEsc(S.note)+'</div>');
    if(money) h.push('<div class="bl-note mn-sim">From Simphony, net after discounts. Scala = Lounge, Cortina, Premium Lounge and Bar, walk-ins included; 8 PM &ndash; 1 AM is by the hour each line was rung.</div>');
  }

  if(N && money && !S){
    var pkNet = blNet(N.pkgFood + N.pkgDrink, d), allNet = blNet(N.checks, d);
    h.push('<div class="bl-note mn-sim">From the bookings at menu price &mdash; comps are not seen until the Simphony check.</div>');
    h.push('<div class="rv2-stats">'
      + '<div class="rv2-stat"><div class="l">Package net</div><div class="v">'+blN(pkNet)+'</div></div>'
      + '<div class="rv2-stat"><div class="l">&nbsp;of it food</div><div class="v">'+blN(blNet(N.pkgFood, d))+'</div></div>'
      + '<div class="rv2-stat"><div class="l">&nbsp;of it drinks</div><div class="v">'+blN(blNet(N.pkgDrink, d))+'</div></div>'
      + '<div class="rv2-stat"><div class="l">Everything else</div><div class="v">'+blN(blNet(N.other, d))+'</div></div>'
      + '<div class="rv2-stat"><div class="l">All Scala tables</div><div class="v">'+blN(allNet)+'</div></div>'
      + '<div class="rv2-stat"><div class="l">Net per guest</div><div class="v">'+(N.guests ? blN(allNet/N.guests) : '&ndash;')+'</div></div>'
      + '</div>');
    if(sim.net != null) h.push('<div class="bl-note mn-sim">Closing report, Scala for the whole night: <b>'+blN(sim.net)+'</b> net. The tables above are the booked ones from 8 PM; walk-ins rung with no booking and anything before 8 PM make up the difference.</div>');
  }

  // every Wednesday side by side + what they had
  function mnPk(x){ var s = MN.simph[x], n = MN.nights[x]; return s ? s.packages : (n ? n.packages : null); }
  var mx = 1; weds.forEach(function(x){ var v = mnPk(x); if(v > mx) mx = v; });
  h.push('<div class="bl-grid"><div class="bl-panel"><div class="rv2-mix-title">Every Moda Night <span class="bl-hint">&middot; tap one</span></div><div class="bl-bars">');
  weds.slice().reverse().forEach(function(x){
    var s = MN.simph[x], n = MN.nights[x], v = mnPk(x), ok = v != null;
    var sub = !money ? '&nbsp;' : s ? blN(s.scala_window_net)+' net' : (n ? blN(blNet(n.checks, x))+' booked' : '&nbsp;');
    h.push('<button class="bl-bar'+(x===t?' today':'')+(x===d?' on':'')+'" onclick="mnPickNight(\''+x+'\')">'
      + '<span class="bl-bar-v">'+(ok ? blN(v) : '&hellip;')+'</span><span class="bl-bar-col"><i style="height:'+(ok ? Math.max(v?4:0, Math.round(v/mx*100)) : 0)+'%"></i></span>'
      + '<span class="bl-bar-d">'+blEsc(blDateLabel(x))+'</span><span class="bl-bar-s">'+sub
      + (s && s.packages_comp ? '<br>'+blN(s.packages_comp)+' comped' : (s ? '' : '<br>not checked'))+'</span></button>');
  });
  h.push('</div></div>');
  // Simphony's own check journals once the night is checked: SevenRooms' copy of a check can be
  // an earlier version of it (7 Oct: table 611 was re-rung after midnight as the comp check).
  var simIt = S && S.items && typeof S.items === 'object' ? S.items : null, it = {};
  if(simIt) Object.keys(simIt).forEach(function(k){ var n = mnNice('MN '+k); it[n] = (it[n]||0) + (Number(simIt[k])||0); });
  else if(N) it = N.items;
  var ks = Object.keys(it).filter(function(k){ return it[k] > 0; }).sort(function(a,b){ return it[b]-it[a] || (a<b?-1:1); }), imx = ks.length ? it[ks[0]] : 1;
  h.push('<div class="bl-panel"><div class="rv2-mix-title">What they had <span class="bl-hint">&middot; in the package &middot; '+(simIt ? 'from Simphony' : 'from the bookings, not checked yet')+'</span></div>');
  if(!ks.length) h.push('<div class="bl-empty">'+(N || simIt ? 'No package on the checks this night.' : 'Reading&hellip;')+'</div>');
  else h.push('<div class="bl-dishes">'+ks.map(function(k){ return '<div class="bl-dish"><span class="bl-dish-n">'+blEsc(k)+'</span><span class="bl-dish-b"><i style="width:'+Math.round(it[k]/imx*100)+'%"></i></span><span class="bl-dish-v">'+blN(it[k])+'</span></div>'; }).join('')+'</div>');
  h.push('</div></div>');

  // the tables. On a night checked in Simphony, Simphony's own package checks lead and the bookings
  // (SevenRooms, before comps) fold underneath. Checks are NOT matched to bookings by table: on 30 Sep
  // one booking spans 12 tables, and the 15 comped packages sit on check 29948 while their items are on
  // check 29932 (another table) — a table match would put the numbers on the wrong rows.
  var SC = S && Array.isArray(S.checks) && S.checks.length ? S.checks : null;
  if(SC){
    h.push('<div class="bl-day"><div class="bl-day-h"><div><div class="bl-day-t">Package checks in Simphony</div><div class="bl-day-s">'+blN(SC.length)+' check'+(SC.length===1?'':'s')+' &middot; tap one for what was on it</div></div></div>');
    h.push('<table class="bl-tbl"><thead><tr><th>Opened</th><th>Check</th><th>Table</th><th class="r">Packages</th>'+(money?'<th class="r">Check net</th>':'')+'</tr></thead><tbody>');
    SC.forEach(function(c, k){
      var key = 'c'+k, its = {};
      Object.keys(c.items||{}).forEach(function(x){ var n = mnNice('MN '+x); its[n] = (its[n]||0) + (Number(c.items[x])||0); });
      h.push('<tr class="bl-row'+(MN.open[key]?' open':'')+'" onclick="mnToggle(\''+key+'\')"><td>'+blEsc(String(c.opened||'').slice(11,16))+'</td><td class="bl-guest">'+blEsc(c.check)
        + (c.comp ? ' <span class="bl-tag">comped</span>' : '')+'</td><td>'+blEsc(c.table||'—')+'</td>'
        + '<td class="r"><b>'+(c.packages ? blN(c.packages) : '&ndash;')+'</b></td>'+(money?'<td class="r">'+blN(blNet(c.subtotal, d))+'</td>':'')+'</tr>');
      if(MN.open[key]){
        var keys = Object.keys(its).filter(function(x){ return its[x] > 0; }).sort(function(a,b){ return its[b]-its[a] || (a<b?-1:1); });
        h.push('<tr class="bl-items"><td colspan="'+(money?5:4)+'">'
          + (c.comp ? '<div><span><b>Comped'+(money ? ' '+blN(c.comp.amount) : '')+'</b> &mdash; '+blEsc(c.comp.reason||'')+'</span><span></span></div>' : '')
          + (c.note ? '<div><span>'+blEsc(c.note)+'</span><span></span></div>' : '')
          + (keys.length ? keys.map(function(x){ return '<div><span>'+(its[x]>1?blN(its[x])+'× ':'')+blEsc(x)+'</span><span>in the package</span></div>'; }).join('') : '<div><span>No package items on this check</span></div>')+'</td></tr>');
      }
    });
    h.push('</tbody></table></div>');
  }
  if(N && N.rows.length){
    if(SC) h.push('<details class="bl-how mn-book"><summary>Bookings in SevenRooms ('+blN(N.tables)+') &mdash; before comps; a check here can be an earlier copy</summary>');
    h.push('<div class="bl-day"><div class="bl-day-h"><div><div class="bl-day-t">Scala tables</div><div class="bl-day-s">'+blN(N.tables)+' tables &middot; tap one for its check'+(SC ? ' &middot; from the bookings' : '')+'</div></div></div>');
    h.push('<table class="bl-tbl"><thead><tr><th>Time</th><th>Guest</th><th>Table</th><th class="r">Guests</th><th class="r">Packages</th>'+(money?'<th class="r">Check net</th>':'')+'</tr></thead><tbody>');
    N.rows.forEach(function(r, k){
      h.push('<tr class="bl-row'+(MN.open[k]?' open':'')+'" onclick="mnToggle('+k+')"><td>'+blEsc(r.time)+'</td><td class="bl-guest">'+blEsc(r.guest||'—')
        + (r.vip?' <span class="bl-tag">VIP</span>':'')+(r.walkin?' <span class="bl-tag">walk-in</span>':'')+'</td><td>'+blEsc(r.tables||'—')+'</td>'
        + '<td class="r">'+blN(r.pax)+'</td><td class="r"><b>'+(r.packages ? blN(r.packages) : '&ndash;')+'</b></td>'+(money?'<td class="r">'+blN(blNet(r.check, d))+'</td>':'')+'</tr>');
      if(MN.open[k]){
        var keys = Object.keys(r.items);
        h.push('<tr class="bl-items"><td colspan="'+(money?6:5)+'">'+(keys.length ? keys.map(function(x){ return '<div><span>'+(r.items[x]>1?blN(r.items[x])+'× ':'')+blEsc(x)+'</span><span>in the package</span></div>'; }).join('') : '<div><span>No package on this table</span></div>')+'</td></tr>');
      }
    });
    h.push('</tbody></table></div>');
    if(SC) h.push('</details>');
  }

  h.push('<details class="bl-how"><summary>How these numbers are counted</summary>'
    + '<p>Read from the Simphony check SevenRooms attaches to each Scala booking (every area except Piemonte). A table counts when it has a Moda Night package or was booked for 8 PM or later. Every <b>ModaNight@'+blN(price)+'</b> line is one package; the price sits on the MN Fd, MN (Alc) and MN (Wine) lines, so food and drinks are already split. The MN lines with no price are what the guest had inside the package.</p>'
    + '<p>SevenRooms&rsquo; copy of a check does not carry its discounts, so a comped package looks paid there. Every Thursday night the Wednesday is checked in Simphony: packages paid and comped, who it was comped for, the paid net, and Scala&rsquo;s real revenue from 8 PM to 1 AM, walk-ins included. Once that check is in, those figures replace the booking figures at the top, and comped tables show 0.</p>'
    + (money ? '<p>Net = menu price &divide; '+blDiv(d)+' (10% service and 5% VAT are inside the price; the 7% DIFC fee is added to the bill). Table totals use the check subtotal. Tips are not included.</p>' : '')
    + '</details>');
  h.push('<div class="res-foot">Read-only from SevenRooms'+(S && S.read_at ? ' &middot; checked in Simphony '+blEsc(String(S.read_at).slice(0,10)) : '')+(money ? '' : ' &middot; money is hidden on your access')+'.</div></div>');
  return h.join('');
}
function mnCss(){
  if(document.getElementById('mn-css')) return;
  var s = document.createElement('style'); s.id = 'mn-css';
  s.textContent = '.mn-sim{margin:-6px 2px 16px}\n.mn-comps div{margin-top:4px}\n.mn-book{margin-top:8px}\n.mn-wrap .bl-items span:last-child{color:var(--text-light);font-size:11px}';
  document.head.appendChild(s);
}
