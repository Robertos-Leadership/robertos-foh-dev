// ── BUSINESS LUNCH (added 7 Oct 2026) ─────────────────────────────────────────
// Takes the hub slot Activations held (Activations is hidden, not deleted — its
// tables and code are untouched). Business lunch started Mon 5 Oct 2026 at
// AED 135 a set, rung in Simphony as "BusinessLunch@135" with each course as a
// zero-priced "BL …" line.
//
// WHERE THE NUMBERS COME FROM: the Simphony check that SevenRooms attaches to each
// booking, read night by night through the Kitchen `sevenrooms-sync ?daysheet=`
// call — the same call Reservation Reports makes. Nothing is stored and nothing
// is typed: a night is counted from the book at the moment the screen asks.
//
// MONEY: a check line's `price` is the LINE TOTAL at menu price (4 × 135 = 540).
// Menu prices carry 10% service + 5% VAT; since 16 Sep 2026 the 7% DIFC fee is
// added on top of the bill, so net = menu price ÷ fohSubtotalToNetDiv(night)
// (1.155 from 16 Sep) — read from foh-core.js, never re-typed here. Proved
// 7 Oct 2026: Mon 5 Oct lunch subtotals 2,896.50 ÷ 1.155 = 2,507.79 against
// Simphony's lunch net 2,507.80. Money is hidden without Revenue access.
//
// THE GAP: a check that was never linked to a booking (a walk-in rung without a
// reservation) is invisible here. The Simphony lunch figures from the closing
// report (rev_daily) are shown beside every day so a gap is visible, not hidden.

var BL = { week: 0, nights: {}, loading: {}, failed: {}, sim: {}, simKey: '', pick: null, open: {}, kick: 0 };

function blEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function blToday(){ return (typeof chkToday==='function') ? chkToday().iso : new Date(Date.now()+4*3600000).toISOString().slice(0,10); }
function blAdd(iso, n){ var d = new Date(iso+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function blDow(iso){ return (new Date(iso+'T12:00:00Z').getUTCDay()+6)%7; }          // Mon=0 … Sun=6
function blMonday(iso){ return blAdd(iso, -blDow(iso)); }
function blWeekDates(off){ var m = blAdd(blMonday(blToday()), 7*off); var a=[]; for(var i=0;i<7;i++) a.push(blAdd(m,i)); return a; }
function blDayName(iso, long){ var d=new Date(iso+'T12:00:00Z'); return d.toLocaleDateString('en-GB',{weekday: long?'long':'short', timeZone:'UTC'}); }
function blDateLabel(iso){ var d=new Date(iso+'T12:00:00Z'); return d.toLocaleDateString('en-GB',{day:'numeric', month:'short', timeZone:'UTC'}); }
function blN(n){ return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:0}); }
function blN2(n){ return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2}); }
function blDiv(iso){ return (typeof fohSubtotalToNetDiv==='function') ? fohSubtotalToNetDiv(iso) : 1.155; }
function blNet(gross, iso){ return (Number(gross)||0) / blDiv(iso); }
function blMoney(){ return (typeof fohBlocked==='function') ? !fohBlocked('revenue') : false; }
function blIsMenu(name){ return /^business\s*lunch/i.test(String(name||'')); }
function blIsCourse(name){ return /^BL\s/.test(String(name||'')); }
// Served to every business-lunch guest by default — not a choice, so never counted
// as one (Francesco, 7 Oct 2026). It still shows on the check itself.
var BL_NOT_A_CHOICE = ['focaccia'];
function blIsChoice(name){ return BL_NOT_A_CHOICE.indexOf(blCourseName(name).toLowerCase()) === -1; }
function blCourseName(name){ var s = String(name||'').replace(/^BL\s+/,''); return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase(); }

// One night's book → the business-lunch view of it.
function blDigest(iso, j){
  var out = { date: iso, menus: 0, menuGross: 0, extraGross: 0, tables: 0, guests: 0, dishes: {}, courses: {}, rows: [], price: null };
  (j.reservations||[]).forEach(function(r){
    if(r.state === 'cancelled' || r.state === 'noshow') return;
    var items = r.items || [];
    var menus = 0, mg = 0, xg = 0, dishes = {}, courses = {};
    items.forEach(function(it){
      var q = Number(it.qty)||0, p = Number(it.price)||0;
      if(blIsMenu(it.name)){
        menus += q; mg += p;
        var m = String(it.name).match(/@\s*(\d+(?:\.\d+)?)/); if(m) out.price = Number(m[1]);
      } else if(blIsCourse(it.name)){
        // every course as rung, Focaccia too: it is not a choice, but it is a cost
        var tn = blTill(it.name); courses[tn] = (courses[tn]||0) + q;
        if(!blIsChoice(it.name)) return;
        var k = blCourseName(it.name); dishes[k] = (dishes[k]||0) + q;
      } else if(p) { xg += p; }
    });
    if(!menus) return;
    // The check SUBTOTAL is the truth: some discounts never reach the item list
    // (Tue 6 Oct check 11626: items 1,010, subtotal 770). Extras = check - menus.
    var cg = (typeof r.gross === 'number') ? r.gross : (mg + xg);
    xg = cg - mg;
    out.menus += menus; out.menuGross += mg; out.extraGross += xg; out.tables++; out.guests += Number(r.pax)||0;
    Object.keys(dishes).forEach(function(k){ out.dishes[k] = (out.dishes[k]||0) + dishes[k]; });
    Object.keys(courses).forEach(function(k){ out.courses[k] = (out.courses[k]||0) + courses[k]; });
    out.rows.push({ time: r.time||'', tables: (r.tables||[]).join(', '), area: r.area||'', pax: Number(r.pax)||0,
                    guest: String(r.name||'').trim(), walkin: /walk\s*in/i.test(String(r.booked_by||'')), vip: !!r.vip,
                    menus: menus, menuGross: mg, extraGross: xg, dishes: dishes,
                    items: items.filter(function(it){ return (Number(it.price)||0) || blIsCourse(it.name) || blIsMenu(it.name); }) });
  });
  out.rows.sort(function(a,b){ return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0); });
  return out;
}

async function blFetchNight(iso){
  var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?daysheet=' + iso + '&include=all', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
  });
  if(!r.ok) throw new Error('HTTP '+r.status);
  var j = await r.json();
  if(!j || !j.ok || !Array.isArray(j.reservations)) throw new Error((j && j.error) || 'no data');
  return blDigest(iso, j);
}

// Settled nights are kept for the session; today (and anything not yet read) is
// fetched. Four at a time — the same courtesy Reservation Reports pays the API.
async function blLoad(dates, force){
  var today = blToday();
  var want = dates.filter(function(d){
    if(d > today || BL.loading[d]) return false;
    return force || !BL.nights[d] || d >= today;
  });
  if(!want.length) return;
  want.forEach(function(d){ BL.loading[d] = true; });
  blRepaint();
  var q = want.slice();
  async function worker(){
    while(q.length){
      var d = q.shift();
      try { BL.nights[d] = await blFetchNight(d); delete BL.failed[d]; }
      catch(e){ BL.failed[d] = String(e && e.message || e); }
      delete BL.loading[d];
      blRepaint();
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// Simphony's own lunch figures for the week (closing report → rev_daily).
async function blLoadSim(dates){
  var key = dates[0]+'|'+dates[6];
  if(BL.simKey === key || typeof sb === 'undefined') return;
  BL.simKey = key;
  try {
    var res = await sb.from('rev_daily').select('service_date,rest_lunch_covers,lounge_lunch_covers,rest_lunch_net,lounge_lunch_net')
      .gte('service_date', dates[0]).lte('service_date', dates[6]);
    (res.data||[]).forEach(function(r){
      var c = (r.rest_lunch_covers==null && r.lounge_lunch_covers==null) ? null : (Number(r.rest_lunch_covers)||0) + (Number(r.lounge_lunch_covers)||0);
      var n = (r.rest_lunch_net==null && r.lounge_lunch_net==null) ? null : (Number(r.rest_lunch_net)||0) + (Number(r.lounge_lunch_net)||0);
      BL.sim[String(r.service_date).slice(0,10)] = { covers: c, net: n };
    });
  } catch(e){ BL.simKey = ''; }
  blRepaint();
}

function blRepaint(){
  if(typeof state === 'object' && state && state.currentTab === 'bizlunch' && typeof renderMain === 'function') renderMain();
}
function blStep(n){ BL.week = n === 0 ? 0 : Math.min(0, BL.week + n); BL.pick = null; BL.open = {}; blRepaint(); }
function blPick(iso){ BL.pick = (BL.pick === iso) ? null : iso; BL.open = {}; blRepaint(); }
function blToggle(i){ BL.open[i] = !BL.open[i]; blRepaint(); }
function blRefresh(){ BL.simKey = ''; var d = blWeekDates(BL.week); blLoad(d, true); blLoadSim(d); }

function blSum(days){
  var s = { menus:0, menuGross:0, extraGross:0, menuNet:0, extraNet:0, tables:0, guests:0, dishes:{}, sold:0, simCovers:0, simDays:0, menusOnSimDays:0 };
  days.forEach(function(n){
    if(!n) return;
    s.menus += n.menus; s.menuGross += n.menuGross; s.extraGross += n.extraGross;
    s.menuNet += blNet(n.menuGross, n.date); s.extraNet += blNet(n.extraGross, n.date);
    s.tables += n.tables; s.guests += n.guests; if(n.menus) s.sold++;
    Object.keys(n.dishes).forEach(function(k){ s.dishes[k] = (s.dishes[k]||0) + n.dishes[k]; });
    var sim = BL.sim[n.date];
    if(sim && sim.covers){ s.simCovers += sim.covers; s.simDays++; s.menusOnSimDays += n.menus; }
  });
  return s;
}


// Food cost — a clean, read-only report (Francesco, 7 Oct 2026: "just a clean report").
// The chefs own the costing and the till-name links in the Kitchen app (Recipes >
// Business lunch, chef code to change). Here it is only READ: the recipe book's own cost
// through its read-only bridge, and the links the chefs saved. No per-dish lines, no
// matching, nothing to edit.
function blTill(name){ return String(name||'').replace(/\s+/g,' ').trim(); }
function blNorm(name){ return blTill(name).toLowerCase(); }
var BLC = { state:'idle' };
function blKitchenPage(){
  if(window.BL_KITCHEN_PAGE) return window.BL_KITCHEN_PAGE;
  return /robertos-foh-dev|localhost|127\.0\.0\.1/.test(location.hostname)
    ? 'https://robertos-kitchen.github.io/robertos-kitchen/' : 'https://guarracinofamily.github.io/robertos-kitchen/';
}
function blCostStart(){
  if(BLC.state !== 'idle') return;
  BLC.state = 'loading';
  var page = blKitchenPage(), origin = new URL(page, location.href).origin, done = false;
  var f = document.createElement('iframe');
  f.src = page + 'recipe-create.html?costbridge=1&origin=' + encodeURIComponent(location.origin);
  f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.setAttribute('inert', '');
  f.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;visibility:hidden';
  function finish(err, list){
    if(done) return; done = true; clearTimeout(t); window.removeEventListener('message', on);
    setTimeout(function(){ if(f.parentNode) f.parentNode.removeChild(f); }, 0);
    if(err){ BLC = { state:'error', err:String(err.message || err) }; blRepaint(); return; }
    var by = {}, bn = {}; list.forEach(function(x){ by[x.id] = x; bn[blNorm(x.name)] = x; });
    BLC.byId = by; BLC.byName = bn; BLC.costed = true; if(BLC.links) BLC.state = 'ready'; blRepaint();
  }
  function on(e){
    if(e.origin !== origin || !e.data || e.data.type !== 'rk-costs') return;
    if(e.data.ok) finish(null, e.data.list || []); else finish(new Error(e.data.error || 'no cost'));
  }
  window.addEventListener('message', on);
  var t = setTimeout(function(){ finish(new Error('the recipe book did not answer')); }, 60000);
  document.body.appendChild(f);
  sbKitchen.from('kitchen_event_overrides').select('dish_name,label').eq('event_id', '__bl_till_link__').then(function(r){
    var m = {}; ((r && r.data) || []).forEach(function(x){ if(x.label) m[x.dish_name] = x.label; });
    BLC.links = m; if(BLC.costed) BLC.state = 'ready'; blRepaint();
  }, function(){ BLC.links = {}; if(BLC.costed) BLC.state = 'ready'; blRepaint(); });
}
function blCostOf(till){
  var id = BLC.links && BLC.links[till], r = (id && BLC.byId[id]) || BLC.byName[blNorm(till)];
  return r && r.cost != null ? r.cost : null;
}
function blFoodCostHtml(shown, today){
  setTimeout(blCostStart, 0);
  var h = ['<div class="bl-day bl-fc"><div class="bl-day-h"><div><div class="bl-day-t">Food cost</div></div></div>'];
  if(BLC.state !== 'ready'){
    h.push('<div class="bl-empty bl-pad">'+(BLC.state === 'error' ? 'The recipe book could not be read just now.' : 'Costing from the recipe book&hellip;')+'</div></div>');
    return h.join('');
  }
  var days = shown.filter(function(d){ return d <= today && BL.nights[d]; }), T = { m:0, fc:0, net:0, miss:0 }, missing = {};
  h.push('<table class="bl-tbl"><thead><tr><th>Day</th><th class="r">Menus</th><th class="r">Food cost</th><th class="r">Per menu</th><th class="r">Food cost %</th></tr></thead><tbody>');
  days.forEach(function(d){
    var n = BL.nights[d], c = n.courses || {}, fc = 0, miss = 0;
    Object.keys(c).forEach(function(k){ var v = blCostOf(k); if(v != null) fc += v * c[k]; else { miss += c[k]; missing[k] = 1; } });
    var net = blNet(n.menuGross, d);
    T.m += n.menus; T.fc += fc; T.net += net; T.miss += miss;
    h.push('<tr><td>'+blEsc(blDayName(d))+' '+blEsc(blDateLabel(d))+(d===today?' <span class="bl-sofar">so far</span>':'')+'</td><td class="r"><b>'+blN(n.menus)+'</b></td>'
      + '<td class="r">'+(miss ? '&ge; ' : '')+blN2(fc)+'</td><td class="r">'+(n.menus ? (miss ? '&ge; ' : '')+blN2(fc/n.menus) : '&ndash;')+'</td>'
      + '<td class="r"><b>'+(!miss && net ? (fc/net*100).toFixed(1)+'%' : '&ndash;')+'</b></td></tr>');
  });
  h.push('<tr class="bl-tot"><td>Week</td><td class="r">'+blN(T.m)+'</td><td class="r">'+(T.miss ? '&ge; ' : '')+blN2(T.fc)+'</td>'
    + '<td class="r">'+(T.m ? (T.miss ? '&ge; ' : '')+blN2(T.fc/T.m) : '&ndash;')+'</td><td class="r">'+(!T.miss && T.net ? (T.fc/T.net*100).toFixed(1)+'%' : '&ndash;')+'</td></tr></tbody></table>');
  var ml = Object.keys(missing);
  if(ml.length) h.push('<div class="bl-note bl-pad">Not costed yet: '+ml.map(function(k){ return blEsc(k.replace(/^BL\s+/,'')); }).join(', ')+' &mdash; the % shows once the kitchen costs '+(ml.length===1?'it':'them')+'.</div>');
  h.push('</div>');
  return h.join('');
}

function renderBizLunch(){
  blCss();
  var dates = blWeekDates(BL.week), today = blToday(), money = blMoney();
  // Kick the reads off after this render returns (renderMain must stay synchronous).
  var need = dates.some(function(d){ return d <= today && !BL.loading[d] && (!BL.nights[d] || (d === today && Date.now() - BL.kick > 120000)); });
  if(need){ BL.kick = Date.now(); setTimeout(function(){ blLoad(dates); }, 0); }
  if(BL.simKey !== dates[0]+'|'+dates[6]) setTimeout(function(){ blLoadSim(dates); }, 0);

  var nights = dates.map(function(d){ return BL.nights[d] || null; });
  var S = blSum(nights);
  var busy = dates.some(function(d){ return BL.loading[d]; });
  var failed = dates.filter(function(d){ return BL.failed[d]; });
  var shown = dates.filter(function(d, i){ return i < 5 || (BL.nights[d] && BL.nights[d].menus); });
  var price = null; nights.forEach(function(n){ if(n && n.price) price = n.price; });
  if(price == null) price = 135;
  var h = ['<div class="res-wrap bl-wrap">'];

  // ── Head ──
  h.push('<div class="res-head"><div class="res-head-l">');
  h.push('<div class="res-kicker">Lunch &middot; set menu &middot; AED '+blN(price)+'</div>');
  h.push('<div class="res-title">Business Lunch</div>');
  h.push('</div><div class="res-head-r">');
  h.push('<button class="res-btn" onclick="blStep(-1)" aria-label="Previous week">&lsaquo;</button>');
  h.push('<span class="bl-week">'+blDateLabel(dates[0])+' &ndash; '+blDateLabel(dates[6])+'</span>');
  h.push('<button class="res-btn" onclick="blStep(1)" aria-label="Next week"'+(BL.week>=0?' disabled':'')+'>&rsaquo;</button>');
  if(BL.week !== 0) h.push('<button class="res-btn" onclick="blStep(0)">This week</button>');
  h.push('<button class="res-btn" onclick="blRefresh()"'+(busy?' disabled':'')+'>'+(busy?'Reading&hellip;':'Refresh')+'</button>');
  h.push('</div></div>');

  // ── Hero: menus sold this week ──
  var share = S.simCovers ? Math.round(S.menusOnSimDays / S.simCovers * 100) : null;
  h.push('<div class="rv2-hero '+(S.menus ? 'good' : 'empty')+'">');
  h.push('<div class="rv2-tag">'+(BL.week===0 ? 'This week' : 'Week of '+blDateLabel(dates[0]))+' &middot; menus sold</div>');
  h.push('<div class="rv2-bignum"><span class="n">'+(nights.some(Boolean) || !busy ? blN(S.menus) : '&hellip;')+'</span>');
  h.push('<span class="of">'+(share!=null ? '<b>'+share+'%</b> of Simphony lunch guests ('+blN(S.menusOnSimDays)+' of '+blN(S.simCovers)+')' : 'menus')
    + (S.sold ? ' &middot; '+blN(S.tables)+' table'+(S.tables===1?'':'s') : '')+'</span></div>');
  h.push('<div class="bl-hero-days">'+shown.map(function(d){
    var n = BL.nights[d];
    var v = BL.loading[d] ? '&hellip;' : (n ? blN(n.menus) : (d > today ? '&ndash;' : (BL.failed[d] ? '!' : '&hellip;')));
    return '<span'+(d===today?' class="today"':'')+'>'+blEsc(blDayName(d))+' <b>'+v+'</b></span>';
  }).join('')+'</div>');
  h.push('</div>');

  if(failed.length){
    h.push('<div class="rr-bad bl-bad"><b>'+failed.length+' day'+(failed.length===1?'':'s')+' could not be read and '+(failed.length===1?'is':'are')
      + ' NOT in these figures:</b> '+failed.map(function(d){ return blEsc(blDayName(d)+' '+blDateLabel(d)); }).join(', ')
      + '. Press Refresh to try again.</div>');
  }

  // ── Stat strip ──
  var perGuest = S.guests ? (S.menuNet + S.extraNet) / S.guests : null;
  h.push('<div class="rv2-stats">');
  h.push('<div class="rv2-stat"><div class="l">Avg a day</div><div class="v">'+(S.sold ? blN(S.menus / S.sold) : '&ndash;')+'</div></div>');
  h.push('<div class="rv2-stat"><div class="l">Guests at BL tables</div><div class="v">'+blN(S.guests)+'</div></div>');
  if(money){
    h.push('<div class="rv2-stat"><div class="l">Net per menu</div><div class="v">'+blN2(price / blDiv(dates[0]))+'</div></div>');
    h.push('<div class="rv2-stat"><div class="l">Menu net</div><div class="v">'+blN(S.menuNet)+'</div></div>');
    h.push('<div class="rv2-stat"><div class="l">Extras net</div><div class="v">'+blN(S.extraNet)+'</div></div>');
    h.push('<div class="rv2-stat"><div class="l">Net spend / guest</div><div class="v">'+(perGuest!=null ? blN(perGuest) : '&ndash;')+'</div></div>');
  }
  h.push('</div>');

  // ── Against all lunch: Simphony's own lunch guests and net (closing report) ──
  var cmpDays = shown.filter(function(d){ return d <= today; });
  if(cmpDays.length){
    h.push('<div class="bl-day bl-cmp"><div class="bl-day-h"><div><div class="bl-day-t">Against all lunch</div>'
      + '<div class="bl-day-s">Simphony&rsquo;s lunch guests'+(money?' and lunch net':'')+' from the closing report, beside the business lunch</div></div></div>');
    h.push('<table class="bl-tbl"><thead><tr><th>Day</th><th class="r">BL menus</th><th class="r">Lunch guests</th><th class="r">BL share</th>'
      + (money ? '<th class="r">BL tables net</th><th class="r">Lunch net</th><th class="r">BL share</th>' : '')+'</tr></thead><tbody>');
    var tg = { m:0, c:0, bn:0, ln:0 };
    cmpDays.forEach(function(d){
      var n = BL.nights[d], sim = BL.sim[d] || {}, m = n ? n.menus : null, c = sim.covers, ln = sim.net;
      var bn = n ? blNet(n.menuGross + n.extraGross, d) : null;
      if(m != null && c){ tg.m += m; tg.c += c; }
      if(bn != null && ln){ tg.bn += bn; tg.ln += ln; }
      h.push('<tr><td>'+blEsc(blDayName(d))+' '+blEsc(blDateLabel(d))+(d===today?' <span class="bl-sofar">so far</span>':'')+'</td>'
        + '<td class="r"><b>'+(m==null ? '&hellip;' : blN(m))+'</b></td>'
        + '<td class="r">'+(c==null ? '&ndash;' : blN(c))+'</td>'
        + '<td class="r">'+(m!=null && c ? Math.round(m/c*100)+'%' : '&ndash;')+'</td>'
        + (money ? '<td class="r">'+(bn==null ? '&hellip;' : blN(bn))+'</td><td class="r">'+(ln==null ? '&ndash;' : blN(ln))+'</td>'
                 + '<td class="r">'+(bn!=null && ln ? Math.round(bn/ln*100)+'%' : '&ndash;')+'</td>' : '')+'</tr>');
    });
    h.push('<tr class="bl-tot"><td>Days with a closing report</td><td class="r"><b>'+blN(tg.m)+'</b></td><td class="r">'+blN(tg.c)+'</td>'
      + '<td class="r">'+(tg.c ? Math.round(tg.m/tg.c*100)+'%' : '&ndash;')+'</td>'
      + (money ? '<td class="r">'+blN(tg.bn)+'</td><td class="r">'+blN(tg.ln)+'</td><td class="r">'+(tg.ln ? Math.round(tg.bn/tg.ln*100)+'%' : '&ndash;')+'</td>' : '')+'</tr>');
    h.push('</tbody></table></div>');
  }

  // ── Two panels: by day · what they chose ──
  var max = 1; shown.forEach(function(d){ var n = BL.nights[d]; if(n && n.menus > max) max = n.menus; });
  h.push('<div class="bl-grid">');
  h.push('<div class="bl-panel"><div class="rv2-mix-title">Menus by day <span class="bl-hint">&middot; tap a day for its tables</span></div><div class="bl-bars">');
  shown.forEach(function(d){
    var n = BL.nights[d], v = n ? n.menus : 0, sim = BL.sim[d];
    var cls = 'bl-bar' + (d===today?' today':'') + (BL.pick===d?' on':'') + (d>today?' future':'');
    var can = n && n.menus;
    h.push('<button class="'+cls+'"'+(can ? ' onclick="blPick(\''+d+'\')"' : ' disabled')+'>');
    h.push('<span class="bl-bar-v">'+(n ? blN(v) : (d>today ? '' : '&hellip;'))+'</span>');
    h.push('<span class="bl-bar-col"><i style="height:'+(n ? Math.max(v ? 4 : 0, Math.round(v/max*100)) : 0)+'%"></i></span>');
    h.push('<span class="bl-bar-d">'+blEsc(blDayName(d))+'</span>');
    h.push('<span class="bl-bar-s">'+(sim && sim.covers!=null ? blN(sim.covers)+' lunch' : (d===today ? 'so far' : '&nbsp;'))+'</span>');
    h.push('</button>');
  });
  h.push('</div></div>');

  var dsrc = BL.pick && BL.nights[BL.pick] ? BL.nights[BL.pick].dishes : S.dishes;
  var dk = Object.keys(dsrc).sort(function(a,b){ return dsrc[b]-dsrc[a] || (a<b?-1:1); });
  var dmax = dk.length ? dsrc[dk[0]] : 1;
  h.push('<div class="bl-panel"><div class="rv2-mix-title">What they chose <span class="bl-hint">&middot; '
    + (BL.pick ? blEsc(blDayName(BL.pick, true)) : 'this week')+'</span></div>');
  if(!dk.length) h.push('<div class="bl-empty">No business lunch courses on the checks yet.</div>');
  else {
    h.push('<div class="bl-dishes">');
    dk.forEach(function(k){
      h.push('<div class="bl-dish"><span class="bl-dish-n">'+blEsc(k)+'</span><span class="bl-dish-b"><i style="width:'+Math.round(dsrc[k]/dmax*100)+'%"></i></span><span class="bl-dish-v">'+blN(dsrc[k])+'</span></div>');
    });
    h.push('</div>');
  }
  h.push('</div></div>');

  // Food cost sits under the day chart (Francesco, 7 Oct)
  if(money) h.push(blFoodCostHtml(shown, today));

  // ── The chosen day's tables ──
  if(BL.pick && BL.nights[BL.pick]){
    var N = BL.nights[BL.pick], sim = BL.sim[BL.pick];
    h.push('<div class="bl-day"><div class="bl-day-h"><div><div class="bl-day-t">'+blEsc(blDayName(BL.pick, true))+' '+blEsc(blDateLabel(BL.pick))+'</div>');
    h.push('<div class="bl-day-s">'+blN(N.menus)+' menus &middot; '+blN(N.tables)+' tables'
      + (sim && sim.covers!=null ? ' &middot; Simphony lunch guests '+blN(sim.covers) : '')
      + (money && sim && sim.net!=null ? ' &middot; SevenRooms checks found '+blN(blNet(N.menuGross+N.extraGross, N.date))+' of Simphony&rsquo;s '+blN(sim.net)+' lunch net' : '')
      + '</div></div><button class="res-btn" onclick="blPick(\''+BL.pick+'\')">Close</button></div>');
    h.push('<table class="bl-tbl"><thead><tr><th>Time</th><th>Guest</th><th>Table</th><th class="r">Guests</th><th class="r">Menus</th><th class="bl-hide-s">Courses</th>'
      + (money ? '<th class="r">Extras net</th><th class="r">Check net</th>' : '')+'</tr></thead><tbody>');
    N.rows.forEach(function(r, i){
      var courses = Object.keys(r.dishes).map(function(k){ return (r.dishes[k]>1 ? r.dishes[k]+'× ' : '')+k; }).join(', ');
      h.push('<tr class="bl-row'+(BL.open[i]?' open':'')+'" onclick="blToggle('+i+')"><td>'+blEsc(r.time)+'</td><td class="bl-guest">'+blEsc(r.guest||'—')+(r.vip?' <span class="bl-tag">VIP</span>':'')+(r.walkin?' <span class="bl-tag">walk-in</span>':'')+'</td><td>'+blEsc(r.tables||'—')+'</td><td class="r">'+blN(r.pax)+'</td><td class="r"><b>'+blN(r.menus)+'</b></td>'
        + '<td class="bl-hide-s bl-courses">'+blEsc(courses)+'</td>'
        + (money ? '<td class="r">'+blN(blNet(r.extraGross, N.date))+'</td><td class="r">'+blN(blNet(r.menuGross + r.extraGross, N.date))+'</td>' : '')+'</tr>');
      if(BL.open[i]){
        h.push('<tr class="bl-items"><td colspan="'+(money?8:6)+'">'+r.items.map(function(it){
          var p = Number(it.price)||0;
          return '<div><span>'+(Number(it.qty)>1 ? blN(it.qty)+'× ' : '')+blEsc(it.name)+'</span><span>'+(p ? (money ? 'AED '+blN(p) : '') : 'incl.')+'</span></div>';
        }).join('')+'</td></tr>');
      }
    });
    h.push('</tbody></table></div>');
  }

  // ── How it is counted (folded) ──
  h.push('<details class="bl-how"><summary>How these numbers are counted</summary>'
    + '<p>Counted from the Simphony check SevenRooms attaches to each booking: every <b>BusinessLunch@'+blN(price)+'</b> line is one menu, every <b>BL &hellip;</b> line is a course. Focaccia goes to every guest, so it is not counted as a choice. Nothing is typed in and nothing is stored &mdash; Refresh reads the book again.</p>'
    + '<p>A check rung without a booking is not linked to SevenRooms and is <b>not</b> in these figures. The Simphony lunch guests beside each day come from the closing report, so a gap shows up as a difference. BL tables net is everything on a table that had a business lunch (menus and extras); a lunch check with no booking is missed, so the BL share of lunch net is a floor, never an overstatement.</p>'
    + (money ? '<p>Net = menu price &divide; '+blDiv(dates[0])+' (10% service and 5% VAT are inside the price; since 16 Sep 2026 the 7% DIFC fee is added on top of the bill). AED '+blN(price)+' = '+blN2(price/blDiv(dates[0]))+' net. Extras are everything else on a business-lunch table &mdash; water, drinks, desserts. Tips are not included.</p>' : '')
    + '</details>');
  h.push('<div class="res-foot">Read-only from SevenRooms'+(money ? '' : ' &middot; money is hidden on your access')+'.</div>');
  h.push('</div>');
  return h.join('');
}

function blCss(){
  if(document.getElementById('bl-css')) return;
  var s = document.createElement('style'); s.id = 'bl-css';
  s.textContent = [
    // its own centred column, like Closing Report (.ops-wrap): .res-wrap alone is
    // calc(100vw - 40px) wide and ran past the right edge inside the app's content area
    '.res-wrap.bl-wrap{width:auto;max-width:980px;margin-left:auto;margin-right:auto}',
    '.bl-wrap .rv2-hero{margin-top:4px}',
    '.bl-week{font-size:12px;color:var(--text-mid);letter-spacing:.02em;min-width:104px;text-align:center;font-variant-numeric:tabular-nums}',
    '.bl-hero-days{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:14px;font-size:12px;color:var(--text-light)}',
    '.bl-hero-days b{color:var(--vino);font-weight:600;margin-left:3px;font-variant-numeric:tabular-nums}',
    '.bl-hero-days .today{color:var(--gold-dim)}',
    '.bl-bad{margin:0 0 14px}',
    '.bl-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:16px;margin-bottom:16px}',
    '.bl-panel{border:1px solid var(--border);background:var(--surface);padding:16px 18px}',
    '.bl-panel .rv2-mix-title{margin-bottom:12px}',
    '.bl-hint{letter-spacing:.04em;text-transform:none;font-weight:400}',
    '.bl-bars{display:flex;gap:8px;align-items:stretch}',
    '.bl-bar{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:1px solid transparent;border-radius:6px;padding:6px 2px;cursor:pointer;font-family:inherit}',
    '.bl-bar:disabled{cursor:default}',
    '.bl-bar:not(:disabled):hover{background:var(--surface2)}',
    '.bl-bar.on{border-color:var(--gold);background:var(--surface2)}',
    '.bl-bar-v{font-size:13px;font-weight:600;color:var(--vino);font-variant-numeric:tabular-nums;min-height:17px}',
    '.bl-bar-col{width:100%;max-width:46px;height:120px;background:var(--surface3);display:flex;align-items:flex-end}',
    '.bl-bar-col i{display:block;width:100%;background:var(--vino)}',
    '.bl-bar.today .bl-bar-col i{background:var(--gold-dim)}',
    '.bl-bar-d{font-size:11px;color:var(--text-mid);letter-spacing:.06em;text-transform:uppercase}',
    '.bl-bar.future .bl-bar-d{color:var(--text-light)}',
    '.bl-bar-s{font-size:10px;color:var(--text-light);white-space:nowrap}',
    '.bl-dishes{display:flex;flex-direction:column;gap:7px}',
    '.bl-dish{display:grid;grid-template-columns:minmax(0,9em) 1fr 2.4em;align-items:center;gap:10px;font-size:13px;color:var(--text)}',
    '.bl-dish-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bl-dish-b{height:8px;background:var(--surface3)}',
    '.bl-dish-b i{display:block;height:100%;background:var(--gold-dim)}',
    '.bl-dish-v{text-align:right;font-weight:600;color:var(--vino);font-variant-numeric:tabular-nums}',
    '.bl-empty{font-size:13px;color:var(--text-light);padding:8px 0}',
    '.bl-day{border:1px solid var(--border);background:var(--surface);margin-bottom:16px}',
    '.bl-day-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--surface2)}',
    '.bl-day-t{font-family:"Playfair Display",serif;font-size:20px;color:var(--vino-dark)}',
    '.bl-day-s{font-size:12px;color:var(--text-mid);margin-top:3px}',
    '.bl-tbl{width:100%;border-collapse:collapse;font-size:13px}',
    '@media (max-width:640px){.bl-tbl{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}}',
    '.bl-tbl th{font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:var(--text-light);font-weight:600;text-align:left;padding:9px 12px;border-bottom:1px solid var(--border)}',
    '.bl-tbl td{padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text);font-variant-numeric:tabular-nums;vertical-align:top}',
    '.bl-tbl .r{text-align:right}',
    '.bl-row{cursor:pointer}',
    '.bl-row:hover td,.bl-row.open td{background:var(--surface2)}',
    '.bl-courses{color:var(--text-mid);font-size:12px}',
    '.bl-guest{font-weight:600;color:var(--vino-dark)}',
    '.bl-tag{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-dim);font-weight:600;margin-left:4px;white-space:nowrap}',
    '.bl-items td{background:var(--surface2);padding:4px 12px 12px 24px}',
    '.bl-items div{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--text-mid);padding:3px 0;max-width:420px}',
    '.bl-cmp .bl-tbl td:first-child{white-space:nowrap}',
    '.bl-tot td{background:var(--surface2);font-weight:600;color:var(--vino)}',
    '.bl-sofar{font-size:10px;color:var(--gold-dim);letter-spacing:.06em;text-transform:uppercase;margin-left:4px}',
    '.bl-pad{margin:10px 18px}',
    '.bl-more{display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--border);padding:11px 18px;font:inherit;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:var(--gold-dim);cursor:pointer}',
    '.bl-more .bl-miss{text-transform:none;letter-spacing:0;font-weight:600}',
    '.bl-note{font-size:12px;color:var(--text-mid)}',
    '.bl-miss{color:#8C2F1E;font-weight:600}',
    '.bl-missrow td{background:#FBF3F0}',
    '.bl-why{font-size:11px;color:#8C2F1E;margin-top:3px}',
    '.bl-link{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
    '.bl-link select{font:inherit;font-size:12px;padding:5px 6px;border:1px solid var(--border-strong);border-radius:6px;background:var(--surface);max-width:260px}',
    '.bl-fct{border-top:1px solid var(--border)}',
    '.bl-how{margin:4px 0 10px;font-size:12px;color:var(--text-mid)}',
    '.bl-how summary{cursor:pointer;color:var(--gold-dim);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;padding:6px 0}',
    '.bl-how p{margin:6px 0;line-height:1.55;max-width:760px}',
    '@media (max-width:760px){.bl-grid{grid-template-columns:1fr}.bl-hide-s{display:none}.bl-tbl th,.bl-tbl td{padding:9px 8px}.bl-bar-col{height:90px}.bl-items td{padding-left:12px}}'
  ].join('\n');
  document.head.appendChild(s);
}
