// ══════════════════════════════════════════════════════════════════════════
// FOH EQUIPMENT COUNT — the monthly count of what the floor, the bar and the
// sommelier work with: cutlery, glassware, crockery, serviceware, bar tools,
// decanters. Lives inside Stock Take, behind the "Equipment" switch.
//
// Why this is not a seventh section of stock-take.js: that module counts ONE
// number per FMC article and the bar runs its month-end on it. Every equipment
// workbook this restaurant keeps counts TWO places — the store and in use — and
// none of them has an article code. Same reasoning as the Kitchen crockery count
// (crockery-count.js), which this is ported from. 6 Oct 2026.
//
// Tables: foh_equipment        (the pieces, with photograph, price and par)
//         foh_equipment_takes  (one header per section per month — open or closed)
//         foh_equipment_counts (store + in_use per piece per month; `total` is
//                               GENERATED in the database. `unsplit` holds a
//                               workbook total that never said where things were;
//                               `received` is what came in during the month)
//
// Reuses: sb, toast(), fohMasterName(), STOCK_SUPER / stMasterIds / stUser and
// stLoadXLSX() from stock-take.js (same admin codes, one sign-in for both).
//
// The anchoring rule: a counter is NEVER shown last month's number while
// counting. Last month, what is short and the money are on the summary, behind
// an admin code.
// ══════════════════════════════════════════════════════════════════════════

var EQ_VENUE = 'robertos-difc';
var EQ_SECTIONS = [
  { key:'restaurant', label:'Restaurant & Lounge' },
  { key:'bar',        label:'Bar' },
  { key:'sommelier',  label:'Sommelier' }
];

var eqMode    = 'stock';   // stock | equipment — which half of Stock Take is on screen
var eqSection = 'restaurant';
var eqUser    = null;      // { emp_id, name }
var eqShelf   = [];        // pieces in this section, shelf order
var eqTakes   = [];        // every month this section has, newest first
var eqMonth   = null;
var eqTake    = null;
var eqCounts  = {};        // equipment_id -> row
var eqPrev    = {};        // equipment_id -> row, the month before
var eqPrevM   = null;
var eqTab     = 'count';   // count | summary | manage
var eqQ       = '';
var eqBusy    = false;
var eqErr     = '';
var eqEdit    = null;      // id being edited in Manage, or 'new'
var eqHelp    = false;

try { if (sessionStorage.getItem('eq-mode') === 'equipment') eqMode = 'equipment'; } catch(e){}

function eqSuper(){ return !!(eqUser && typeof STOCK_SUPER === 'object' && STOCK_SUPER[eqUser.emp_id]); }
function eqEsc(s){ return String(s==null?'':s)
  .replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function eqOpen(){ return !!(eqTake && eqTake.status !== 'closed'); }
function eqSecLabel(k){ var s = EQ_SECTIONS.filter(function(x){ return x.key === (k||eqSection); })[0]; return s ? s.label : k; }
function eqToast(m, bad){ if (typeof toast === 'function') toast(m, !!bad); }
function eqMonthEnd(d){
  d = d || new Date();
  var e = new Date(d.getFullYear(), d.getMonth()+1, 0);
  return e.getFullYear()+'-'+String(e.getMonth()+1).padStart(2,'0')+'-'+String(e.getDate()).padStart(2,'0');
}
function eqMonthName(m){
  if (!m) return '';
  var p = String(m).split('-');
  return new Date(+p[0], +p[1]-1, +p[2]).toLocaleDateString('en-GB', { month:'long', year:'numeric' });
}
function eqMoney(n){ return 'AED ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
// what a row adds up to, and whether anything was counted at all
function eqHas(c){ return !!(c && (c.store != null || c.in_use != null || c.unsplit != null)); }
function eqTot(c){ return c ? (c.store||0) + (c.in_use||0) + (c.unsplit||0) : 0; }

// ══════════════════════════════════════════════════════════════════════════
// the switch at the top of Stock Take
// ══════════════════════════════════════════════════════════════════════════
function eqMountSwitch(){
  eqInjectCss();
  var sw = document.getElementById('stk-mode');
  if (!sw) return;
  sw.innerHTML = '<div class="eq-switch" role="tablist">'+
    '<button role="tab" class="eq-sw'+(eqMode==='stock'?' on':'')+'" onclick="eqSetMode(\'stock\')">Food &amp; drink stock</button>'+
    '<button role="tab" class="eq-sw'+(eqMode==='equipment'?' on':'')+'" onclick="eqSetMode(\'equipment\')">Equipment</button>'+
  '</div>';
  var st = document.getElementById('st-root'), eq = document.getElementById('eq-root');
  if (st) st.style.display = eqMode === 'stock' ? '' : 'none';
  if (eq) eq.style.display = eqMode === 'equipment' ? '' : 'none';
  if (eqMode === 'equipment' && eq && eq.getAttribute('data-eq') !== '1'){
    eq.setAttribute('data-eq','1'); eqStart();
  }
}
function eqSetMode(m){
  eqMode = m;
  try { sessionStorage.setItem('eq-mode', m); } catch(e){}
  eqMountSwitch();
}

// ══════════════════════════════════════════════════════════════════════════
// loading
// ══════════════════════════════════════════════════════════════════════════
async function eqLoadShelf(){
  // thumb only — the big photograph is fetched when someone taps a picture
  var r = await sb.from('foh_equipment')
    .select('id,section,grp,kind,name,supplier,par_level,price,thumb,sort_order')
    .eq('venue_id', EQ_VENUE).eq('section', eqSection).eq('archived', false)
    .order('sort_order');
  if (r.error){ eqErr = r.error.message; eqShelf = []; return; }
  eqShelf = r.data || [];
}
async function eqLoadTakes(){
  var r = await sb.from('foh_equipment_takes').select('*')
    .eq('venue_id', EQ_VENUE).eq('section', eqSection).order('month', { ascending:false });
  eqTakes = r.error ? [] : (r.data || []);
  if (r.error) eqToast('The months could not be loaded — reopen before counting.', true);
}
async function eqLoadCounts(month, into){
  var r = await sb.from('foh_equipment_counts').select('equipment_id,store,in_use,unsplit,received,total')
    .eq('venue_id', EQ_VENUE).eq('section', eqSection).eq('month', month);
  var out = {};
  (r.error ? [] : (r.data || [])).forEach(function(c){ out[c.equipment_id] = c; });
  // a failed read must never look like "nothing counted"
  if (r.error) eqToast((into === 'prev' ? 'Last month’s counts' : 'This month’s counts')+' could not be loaded — the figures shown are incomplete. Reopen to retry.', true);
  if (into === 'prev') eqPrev = out; else eqCounts = out;
}
async function eqOpenMonth(month){
  eqMonth = month;
  eqTake = eqTakes.filter(function(t){ return t.month === month; })[0] || null;
  await eqLoadCounts(month);
  var older = eqTakes.filter(function(t){ return t.month < month; });
  eqPrevM = older.length ? older[0].month : null;
  eqPrev = {};
  if (eqPrevM) await eqLoadCounts(eqPrevM, 'prev');
}
async function eqStart(){
  // one sign-in for both halves of Stock Take
  if (!eqUser && typeof stUser !== 'undefined' && stUser) eqUser = { emp_id:stUser.emp_id, name:stUser.name };
  await eqReload();
}
async function eqReload(){
  var root = document.getElementById('eq-root'); if (!root) return;
  root.innerHTML = '<div class="eqwrap"><div class="eqnote">Opening '+eqEsc(eqSecLabel())+'…</div></div>';
  eqErr = '';
  await eqLoadShelf();
  await eqLoadTakes();
  await eqOpenMonth(eqTakes.length ? eqTakes[0].month : eqMonthEnd());
  eqRender();
}
async function eqSetSection(k){ eqSection = k; eqQ = ''; eqEdit = null; await eqReload(); }

// ══════════════════════════════════════════════════════════════════════════
// signing in — the same employee ID and admin codes as the stock take
// ══════════════════════════════════════════════════════════════════════════
async function eqSignIn(){
  var inp = document.getElementById('eq-empid');
  var id = inp ? (inp.value||'').trim() : '';
  if (!id){ if (inp) inp.focus(); return; }
  if (typeof STOCK_SUPER === 'object' && !STOCK_SUPER[id] && typeof fohMasterName === 'function'){
    var mn = await fohMasterName(id);
    if (mn){ STOCK_SUPER[id] = mn; if (typeof stMasterIds === 'object') stMasterIds[id] = true; }
  }
  if (typeof STOCK_SUPER === 'object' && STOCK_SUPER[id]){ eqUser = { emp_id:id, name:STOCK_SUPER[id] }; eqRender(); return; }
  var r = await sb.from('foh_staff').select('id,name,emp_id').eq('emp_id', id).eq('active', true).limit(1);
  var s = r.data && r.data[0];
  if (!s){ eqToast('Employee ID '+id+' not recognised — check and try again.', true); return; }
  eqUser = { emp_id:id, name:s.name };
  if (eqTakes.length && eqMonth !== eqTakes[0].month) await eqOpenMonth(eqTakes[0].month);
  if (eqTab === 'manage') eqTab = 'count';
  eqRender();
}
async function eqSignOut(){
  eqUser = null; eqTab = 'count';
  if (eqTakes.length && eqMonth !== eqTakes[0].month) await eqOpenMonth(eqTakes[0].month);
  eqRender();
}

// ══════════════════════════════════════════════════════════════════════════
// writing a count. Only the box that changed is sent, so two people counting
// different places of the same piece never overwrite each other.
// ══════════════════════════════════════════════════════════════════════════
async function eqSet(id, which){
  if (!eqUser){ eqToast('Enter your employee ID first.', true); return; }
  if (!eqOpen()){ eqToast('This month is closed. Reopen it to change a count.', true); return; }
  if (which === 'received' && !eqSuper()){ eqToast('Only an admin code can enter what was received.', true); return; }
  var el = document.getElementById('eq-'+which+'-'+id);
  var txt = String(el ? el.value : '').trim().replace(',', '.');
  // empty is "not counted yet", which is a different thing from counted as zero
  var n = txt === '' ? null : Number(txt);
  if (n != null && (!isFinite(n) || n < 0 || Math.round(n) !== n)){
    eqToast('“'+txt+'” is not a number of pieces — the box was left as it was.', true);
    eqPaintRow(id); return;
  }
  var was = eqCounts[id] ? JSON.parse(JSON.stringify(eqCounts[id])) : null;
  var row = eqCounts[id] || { store:null, in_use:null, unsplit:null, received:null };
  row[which] = n;
  var body = { venue_id:EQ_VENUE, section:eqSection, month:eqMonth, equipment_id:id,
               counted_by:eqUser.emp_id, counted_by_name:eqUser.name,
               source:'counted in the app', updated_at:new Date().toISOString() };
  body[which] = n;
  // a workbook total with no split is replaced the moment somebody counts the places
  if ((which === 'store' || which === 'in_use') && row.unsplit != null){ row.unsplit = null; body.unsplit = null; }
  eqCounts[id] = row;
  eqPaintRow(id);
  var r = await sb.from('foh_equipment_counts').upsert(body, { onConflict:'venue_id,month,equipment_id' });
  if (r.error){
    // put it back. A number that looks saved and is not is the one thing a count must never do.
    if (was) eqCounts[id] = was; else delete eqCounts[id];
    eqPaintRow(id);
    eqToast('Not saved — '+(r.error.message||'the write was refused'), true);
  }
}
function eqPaintRow(id){
  var c = eqCounts[id] || {};
  ['store','in_use','received'].forEach(function(k){
    var el = document.getElementById('eq-'+k+'-'+id);
    if (el && document.activeElement !== el) el.value = (c[k] == null ? '' : c[k]);
    if (el) el.classList.toggle('set', c[k] != null);
  });
  var t = document.getElementById('eq-tot-'+id);
  if (t) t.textContent = eqHas(c) ? eqTot(c) : '—';
  var d = document.getElementById('eq-done');
  if (d) d.textContent = eqDone()+' of '+eqShelf.length+' counted';
}
function eqDone(){
  var n = 0; eqShelf.forEach(function(p){ if (eqHas(eqCounts[p.id])) n++; }); return n;
}

// ══════════════════════════════════════════════════════════════════════════
// the month: start one, close one, reopen one
// ══════════════════════════════════════════════════════════════════════════
async function eqStartMonth(){
  if (!eqSuper()){ eqToast('Only an admin code (1212 / 0000 / 2468) can start a count.', true); return; }
  var m = eqMonthEnd();
  if (eqTakes.filter(function(t){ return t.month === m; }).length){ await eqOpenMonth(m); eqTab='count'; eqRender(); return; }
  eqBusy = true; eqRender();
  var r = await sb.from('foh_equipment_takes').insert({
    venue_id:EQ_VENUE, section:eqSection, month:m, status:'counting', opened_by:eqUser.name });
  eqBusy = false;
  if (r.error){ eqToast('Not started — '+r.error.message, true); eqRender(); return; }
  await eqLoadTakes(); await eqOpenMonth(m); eqTab = 'count'; eqRender();
  eqToast(eqSecLabel()+' — '+eqMonthName(m)+' is open for counting.');
}
async function eqCloseMonth(reopen){
  if (!eqSuper()){ eqToast('Only an admin code (1212 / 0000 / 2468) can close or reopen a count.', true); return; }
  if (!eqTake) return;
  eqBusy = true; eqRender();
  var r = await sb.from('foh_equipment_takes').update({
      status: reopen ? 'counting' : 'closed',
      closed_by: reopen ? '' : eqUser.name,
      closed_at: reopen ? null : new Date().toISOString(),
      updated_at: new Date().toISOString() }).eq('id', eqTake.id);
  eqBusy = false;
  if (r.error){ eqToast('Not changed — '+r.error.message, true); eqRender(); return; }
  await eqLoadTakes();
  eqTake = eqTakes.filter(function(t){ return t.month === eqMonth; })[0] || null;
  eqRender();
}
async function eqPick(m){ await eqOpenMonth(m); eqRender(); }

// ══════════════════════════════════════════════════════════════════════════
// what it adds up to. Against last month: last month's total + what came in
// is what SHOULD be there; the count is what IS there.
// ══════════════════════════════════════════════════════════════════════════
function eqLine(p){
  var c = eqCounts[p.id], pv = eqPrev[p.id];
  if (!eqHas(c) || !eqHas(pv)) return null;
  var expect = eqTot(pv) + ((c && c.received) || 0);
  var now = eqTot(c);
  return { p:p, was:eqTot(pv), rec:(c.received||0), expect:expect, now:now, d:expect-now,
           v: p.price != null ? (expect-now)*Number(p.price) : null };
}
function eqTotals(){
  var t = { store:0, in_use:0, unsplit:0, total:0, counted:0, value:0, valued:0, priced:0,
            short:0, shortValue:0, shortValued:0, shortLines:0, unpricedShort:0, over:0,
            noPrev:0, belowPar:0 };
  eqShelf.forEach(function(p){
    var c = eqCounts[p.id], has = eqHas(c);
    if (p.price != null) t.priced++;
    if (!has) return;
    t.counted++;
    t.store += c.store||0; t.in_use += c.in_use||0; t.unsplit += c.unsplit||0; t.total += eqTot(c);
    if (p.price != null){ t.value += eqTot(c)*Number(p.price); t.valued++; }
    if (p.par_level != null && eqTot(c) < p.par_level) t.belowPar++;
    var L = eqLine(p);
    if (!L){ t.noPrev++; return; }
    if (L.d > 0){
      t.short += L.d; t.shortLines++;
      if (L.v != null){ t.shortValue += L.v; t.shortValued++; } else t.unpricedShort += L.d;
    } else if (L.d < 0) t.over += -L.d;
  });
  return t;
}

// ══════════════════════════════════════════════════════════════════════════
// drawing
// ══════════════════════════════════════════════════════════════════════════
function eqGateHtml(){
  return eqUser
    ? '<div class="eqwho"><span><span style="color:#1d7a4a">●</span> Counting as <b>'+eqEsc(eqUser.name)+
      '</b> · #'+eqEsc(eqUser.emp_id)+'</span><button class="eqb2" onclick="eqSignOut()">Switch</button></div>'
    : '<div class="eqgate"><b>Enter your employee ID to count</b><div class="eqrow">'+
      '<input class="eqin" id="eq-empid" inputmode="numeric" autocomplete="off" placeholder="e.g. 1042" style="flex:1 1 160px" '+
      'onkeydown="if(event.key===\'Enter\')eqSignIn()"><button class="eqb" onclick="eqSignIn()">Start</button></div></div>';
}
function eqMonthPicker(){
  // only an admin code can look back: a counter shown an earlier month sees the
  // number they are about to count, which is the whole thing the rule prevents
  if (!eqTakes.length || !eqSuper()) return '';
  return '<select class="eqin" onchange="eqPick(this.value)" aria-label="Which count">'+
    eqTakes.map(function(t){
      return '<option value="'+t.month+'"'+(t.month===eqMonth?' selected':'')+'>'+
        eqEsc(eqMonthName(t.month))+(t.status==='closed'?' — closed':' — counting')+'</option>';
    }).join('')+'</select>';
}
function eqSub(p){
  var bits = [];
  if (p.kind && p.kind.toLowerCase() !== String(p.grp||'').toLowerCase()) bits.push(eqEsc(p.kind.charAt(0)+p.kind.slice(1).toLowerCase()));
  if (p.supplier) bits.push(eqEsc(p.supplier));
  if (p.par_level != null) bits.push('par '+p.par_level);
  bits.push(p.price != null ? eqMoney(p.price)+' each' : 'no price yet');
  return bits.join(' · ');
}
function eqPic(p, cls){
  return p.thumb
    ? '<button class="eqpic '+(cls||'')+'" onclick="eqShowPhoto(\''+p.id+'\')" aria-label="Bigger photo of '+eqEsc(p.name)+'"><img src="'+p.thumb+'" alt="" loading="lazy"></button>'
    : '<span class="eqpic eqnopic '+(cls||'')+'" title="No photo yet"></span>';
}
function eqCountHtml(){
  var q = eqQ.trim().toLowerCase();
  var list = eqShelf.filter(function(p){
    return !q || (p.name+' '+p.kind+' '+p.grp+' '+p.supplier).toLowerCase().indexOf(q) > -1; });
  if (!list.length) return '<div class="eqnote">Nothing in '+eqEsc(eqSecLabel())+' matches “'+eqEsc(eqQ)+'”.</div>';
  var out = '', last = null, dis = (eqOpen() && eqUser) ? '' : ' disabled', sup = eqSuper();
  list.forEach(function(p){
    if (p.grp !== last){ last = p.grp; out += '<div class="eqgh">'+eqEsc(last||'Other')+'</div>'; }
    var c = eqCounts[p.id] || {};
    function box(k, label){
      return '<div class="eqqb"><label for="eq-'+k+'-'+p.id+'">'+label+'</label>'+
        '<input id="eq-'+k+'-'+p.id+'" inputmode="numeric" autocomplete="off" value="'+(c[k]==null?'':c[k])+'"'+
        (c[k]!=null?' class="set"':'')+dis+' onchange="eqSet(\''+p.id+'\',\''+k+'\')" '+
        'onkeydown="if(event.key===\'Enter\')this.blur()"></div>';
    }
    out += '<div class="eqr">'+eqPic(p)+
      '<div class="eqnm"><b>'+eqEsc(p.name)+'</b><span>'+eqSub(p)+'</span>'+
        (c.unsplit != null ? '<em>From the workbook: '+c.unsplit+' in total, not split by place.</em>' : '')+'</div>'+
      '<div class="eqq">'+box('store','Store')+box('in_use','In use')+(sup ? box('received','Received') : '')+'</div>'+
      '<div class="eqtot"><b id="eq-tot-'+p.id+'">'+(eqHas(c)?eqTot(c):'—')+'</b><span>total</span></div>'+
    '</div>';
  });
  return out;
}

function eqSummaryHtml(){
  var t = eqTotals(), N = eqShelf.length;
  var out = '<div class="eqsum"><h3>'+eqEsc(eqSecLabel())+' · '+eqEsc(eqMonthName(eqMonth))+'</h3>'+
    '<div class="eqfig">'+
      '<div><b>'+t.total+'</b><span>pieces counted</span></div>'+
      '<div><b>'+t.store+'</b><span>in the store</span></div>'+
      '<div><b>'+t.in_use+'</b><span>in use</span></div>'+
      '<div><b>'+t.counted+' / '+N+'</b><span>lines done</span></div>'+
    '</div>';
  if (t.unsplit) out += '<div class="eqnote">'+t.unsplit+' of these pieces came from the workbook as a total only — '+
    'it never said how many were in the store and how many in use.</div>';
  // the money says what it CANNOT price, every time, in the same breath
  out += '<div class="eqfig" style="margin-top:10px">'+
      '<div><b>'+(t.valued ? eqMoney(t.value) : '—')+'</b><span>'+(t.valued ? 'value counted' : 'no priced line counted yet')+'</span></div>'+
      '<div><b>'+t.priced+' / '+N+'</b><span>lines with a price</span></div>'+
    '</div>';
  if (N - t.priced) out += '<div class="eqnote warn"><b>'+(N - t.priced)+' of the '+N+' lines have no price yet</b>, '+
    'so the value above covers only the '+t.priced+' that do. An admin code can add a price in <b>Manage</b>.</div>';
  out += '</div>';

  if (!eqSuper()){
    return out + '<div class="eqnote">What was there last month, and what is short since, is on an admin code '+
      '(1212 / 0000 / 2468). Not to keep it secret — because somebody who sees last month’s number before '+
      'counting counts to it.</div>';
  }
  if (!eqPrevM) return out + '<div class="eqnote">There is no earlier month to compare this one with, so nothing can be called short yet.</div>';

  out += '<div class="eqsum"><h3>Against '+eqEsc(eqMonthName(eqPrevM))+'</h3>'+
    '<div class="eqfig">'+
      '<div><b>'+t.short+'</b><span>pieces short</span></div>'+
      '<div><b>'+(t.shortValued ? eqMoney(t.shortValue) : '—')+'</b><span>'+(t.shortValued ? 'what that cost' : 'none of it priced')+'</span></div>'+
      '<div><b>'+t.shortLines+'</b><span>lines short</span></div>'+
      (t.over ? '<div><b>'+t.over+'</b><span>more than expected</span></div>' : '')+
    '</div>'+
    '<div class="eqnote">Expected = last month’s count + what was received this month. Short = expected − counted.</div>';
  if (t.unpricedShort) out += '<div class="eqnote warn">'+t.unpricedShort+' of the pieces short have no price, so they are in the count above and not in the money.</div>';
  if (t.noPrev) out += '<div class="eqnote">'+t.noPrev+' counted line'+(t.noPrev===1?' has':'s have')+' no count for '+
    eqEsc(eqMonthName(eqPrevM))+', so '+(t.noPrev===1?'it is':'they are')+' left out of the comparison rather than guessed.</div>';

  var rows = eqShelf.map(eqLine).filter(function(L){ return L && L.d; })
    .sort(function(a,b){ return (b.v||0)-(a.v||0) || b.d-a.d; });
  if (rows.length){
    out += '<table class="eqtab"><thead><tr><th>Piece</th><th class="n">Was</th><th class="n hidemob">In</th>'+
      '<th class="n">Now</th><th class="n">Diff</th><th class="n hidemob">Cost</th></tr></thead><tbody>'+
      rows.map(function(r){
        return '<tr'+(r.d>0?' class="bad"':'')+'><td>'+(r.p.thumb?'<img class="eqmini" src="'+r.p.thumb+'" alt="">':'')+eqEsc(r.p.name)+'</td>'+
          '<td class="n">'+r.was+'</td><td class="n hidemob">'+(r.rec||'')+'</td><td class="n">'+r.now+'</td>'+
          '<td class="n br">'+(r.d>0?'−'+r.d:'+'+(-r.d))+'</td>'+
          '<td class="n hidemob">'+(r.v==null?'<i>no price</i>':(r.d>0?eqMoney(r.v):'—'))+'</td></tr>';
      }).join('')+'</tbody></table>';
  } else out += '<div class="eqnote">Nothing has moved since '+eqEsc(eqMonthName(eqPrevM))+' on any line counted so far.</div>';
  out += '</div>';

  var low = eqShelf.filter(function(p){ var c = eqCounts[p.id]; return eqHas(c) && p.par_level != null && eqTot(c) < p.par_level; });
  if (low.length){
    out += '<div class="eqsum"><h3>Below par</h3><table class="eqtab"><thead><tr><th>Piece</th><th class="n">Par</th>'+
      '<th class="n">Counted</th><th class="n">To par</th></tr></thead><tbody>'+
      low.map(function(p){ var n = eqTot(eqCounts[p.id]);
        return '<tr><td>'+(p.thumb?'<img class="eqmini" src="'+p.thumb+'" alt="">':'')+eqEsc(p.name)+'</td><td class="n">'+p.par_level+
          '</td><td class="n">'+n+'</td><td class="n br">'+(p.par_level-n)+'</td></tr>'; }).join('')+'</tbody></table></div>';
  }
  return out;
}

// ── Manage: add a piece, correct one, retire one. Admin codes only. ──
function eqManageHtml(){
  if (!eqSuper()) return '<div class="eqnote">Managing the list is on an admin code (1212 / 0000 / 2468).</div>';
  var out = '<div class="eqtools"><button class="eqb" onclick="eqEdit=\'new\';eqRender()">+ Add a piece to '+eqEsc(eqSecLabel())+'</button></div>';
  if (eqEdit === 'new') out += eqEditForm(null);
  var last = null;
  eqShelf.forEach(function(p){
    if (p.grp !== last){ last = p.grp; out += '<div class="eqgh">'+eqEsc(last||'Other')+'</div>'; }
    if (eqEdit === p.id){ out += eqEditForm(p); return; }
    out += '<div class="eqr">'+eqPic(p)+'<div class="eqnm"><b>'+eqEsc(p.name)+'</b><span>'+eqSub(p)+'</span></div>'+
      '<button class="eqb2" onclick="eqEdit=\''+p.id+'\';eqRender()">Correct</button></div>';
  });
  return out;
}
function eqEditForm(p){
  var groups = Array.from(new Set(eqShelf.map(function(x){ return x.grp; }).filter(Boolean)));
  var v = function(k){ return p && p[k] != null ? eqEsc(p[k]) : ''; };
  return '<div class="eqedit" id="eq-editor">'+
    '<label>Name<input class="eqin" id="eqe-name" value="'+v('name')+'"></label>'+
    '<label>Heading<input class="eqin" id="eqe-grp" list="eqe-groups" value="'+(p?v('grp'):eqEsc(groups[0]||''))+'">'+
      '<datalist id="eqe-groups">'+groups.map(function(g){ return '<option value="'+eqEsc(g)+'">'; }).join('')+'</datalist></label>'+
    '<label>Supplier<input class="eqin" id="eqe-supplier" value="'+v('supplier')+'"></label>'+
    '<div class="eqrow"><label>Price, AED each<input class="eqin" id="eqe-price" inputmode="decimal" autocomplete="off" value="'+v('price')+'"></label>'+
    '<label>Par level<input class="eqin" id="eqe-par" inputmode="numeric" autocomplete="off" value="'+v('par_level')+'"></label></div>'+
    '<label>Photo<input class="eqin" id="eqe-photo" type="file" accept="image/*"></label>'+
    (p && p.thumb ? '<div class="eqsmall">Choose a photo only to replace the one it has.</div>' : '')+
    '<div class="eqrow" style="margin-top:8px"><button class="eqb" onclick="eqSavePiece('+(p?'\''+p.id+'\'':'null')+')"'+(eqBusy?' disabled':'')+'>Save</button>'+
    '<button class="eqb2" onclick="eqEdit=null;eqRender()">Cancel</button>'+
    (p ? '<button class="eqb2" id="eqe-retire" onclick="eqRetireAsk(\''+p.id+'\')">Retire it…</button>' : '')+'</div>'+
    '<div id="eqe-retire-box"></div></div>';
}
function eqResize(file, size, q){
  return new Promise(function(res, rej){
    var fr = new FileReader();
    fr.onload = function(){
      var im = new Image();
      im.onload = function(){
        var s = Math.min(1, size/Math.max(im.width, im.height));
        var c = document.createElement('canvas'); c.width = Math.round(im.width*s); c.height = Math.round(im.height*s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', q));
      };
      im.onerror = function(){ rej(new Error('that file is not a picture')); };
      im.src = fr.result;
    };
    fr.onerror = function(){ rej(new Error('the file could not be read')); };
    fr.readAsDataURL(file);
  });
}
async function eqSavePiece(id){
  if (!eqSuper()) return;
  var g = function(k){ var e = document.getElementById('eqe-'+k); return e ? e.value.trim() : ''; };
  var name = g('name');
  if (!name){ eqToast('A piece needs a name.', true); return; }
  var pr = g('price').replace(',', '.'), par = g('par');
  var price = pr === '' ? null : Number(pr), parN = par === '' ? null : Number(par);
  if (price != null && (!isFinite(price) || price < 0)){ eqToast('“'+pr+'” is not a price.', true); return; }
  if (parN != null && (!isFinite(parN) || parN < 0 || Math.round(parN) !== parN)){ eqToast('“'+par+'” is not a par level.', true); return; }
  var body = { name:name, grp:g('grp') || 'Other', supplier:g('supplier'),
               price: price === 0 ? null : price, par_level:parN, updated_at:new Date().toISOString() };
  var f = document.getElementById('eqe-photo');
  eqBusy = true;
  try {
    if (f && f.files && f.files[0]){
      body.thumb = await eqResize(f.files[0], 220, 0.72);
      body.photo = await eqResize(f.files[0], 900, 0.8);
    }
  } catch(e){ eqBusy = false; eqToast('Photo not used — '+e.message, true); return; }
  var r;
  if (id) r = await sb.from('foh_equipment').update(body).eq('id', id);
  else {
    var maxSort = eqShelf.filter(function(x){ return x.grp === body.grp; }).reduce(function(m, x){ return Math.max(m, x.sort_order); }, 0)
               || eqShelf.reduce(function(m, x){ return Math.max(m, x.sort_order); }, 0);
    body.sort_order = maxSort + 1; body.section = eqSection; body.venue_id = EQ_VENUE;
    body.kind = ''; body.created_by = eqUser.name;
    r = await sb.from('foh_equipment').insert(body);
  }
  eqBusy = false;
  if (r.error){ eqToast('Not saved — '+r.error.message, true); return; }
  eqEdit = null;
  await eqLoadShelf(); eqRender();
  eqToast(id ? name+' corrected.' : name+' added to '+eqSecLabel()+'.');
}
// retire is an inline yes/no, never a browser pop-up. Nothing is deleted:
// a retired piece leaves the list and keeps every month it was counted in.
function eqRetireAsk(id){
  var b = document.getElementById('eqe-retire-box'); if (!b) return;
  b.innerHTML = '<div class="eqnote warn">Retire it? It leaves the count from now on. Every month it was already counted in keeps it.'+
    '<div class="eqrow" style="margin-top:8px"><button class="eqb" onclick="eqRetire(\''+id+'\')">Yes, retire it</button>'+
    '<button class="eqb2" onclick="document.getElementById(\'eqe-retire-box\').innerHTML=\'\'">Keep it</button></div></div>';
}
async function eqRetire(id){
  if (!eqSuper()) return;
  var r = await sb.from('foh_equipment').update({ archived:true, updated_at:new Date().toISOString() }).eq('id', id);
  if (r.error){ eqToast('Not retired — '+r.error.message, true); return; }
  eqEdit = null; await eqLoadShelf(); eqRender(); eqToast('Retired.');
}

// ── the big photograph, fetched only when asked for ──
async function eqShowPhoto(id){
  var p = eqShelf.filter(function(x){ return x.id === id; })[0]; if (!p) return;
  var ov = document.getElementById('eq-photo-ov');
  if (!ov){ ov = document.createElement('div'); ov.id = 'eq-photo-ov'; document.body.appendChild(ov); }
  ov.onclick = function(){ ov.style.display = 'none'; };
  ov.innerHTML = '<figure><img src="'+p.thumb+'" alt=""><figcaption>'+eqEsc(p.name)+'<span>Tap anywhere to close</span></figcaption></figure>';
  ov.style.display = 'flex';
  var r = await sb.from('foh_equipment').select('photo').eq('id', id).limit(1);
  var big = r.data && r.data[0] && r.data[0].photo;
  var im = ov.querySelector('img'); if (big && im && ov.style.display !== 'none') im.src = big;
}

// ── Excel, in the layout the workbooks already use ──
// The Excel is the app on paper: the same words (Store · In use · Total · Was ·
// Diff), the same groups, the same photographs, and the house look the
// Reservations and roster exports already use (RES_XL in foh-reservations.js) —
// so the three files look like they came from one company. Numbers go in as
// numbers so it can be summed; a column nobody has filled (Supplier, Par) is
// left out rather than printed empty.
var EQ_XL = { VINO:'6B1F2A', SABBIA:'F5F0E8', GOLD:'C9A84C', DARK:'3D0F15', LIGHT:'F0EBE2' };
function eqLoadExcelJS(){
  if (typeof resLoadExcelJS === 'function') return resLoadExcelJS();
  if (window.ExcelJS) return Promise.resolve();
  return new Promise(function(res, rej){
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = res;
    s.onerror = function(){ rej(new Error('the spreadsheet library could not be reached')); };
    document.body.appendChild(s);
  });
}
async function eqExcel(){
  if (!eqSuper()){ eqToast('The Excel carries last month’s figures, so it is on an admin code.', true); return; }
  try {
    await eqLoadExcelJS();
    var C = (typeof RES_XL === 'object' && RES_XL) ? RES_XL : EQ_XL;
    var line = function(colour){ var c = {style:'thin', color:{argb:'FF'+colour}}; return {top:c, bottom:c, left:c, right:c}; };
    var font = function(o){ var f = {name:'Calibri', size:10, color:{argb:'FF'+C.DARK}}; for (var k in o) f[k] = o[k]; return f; };
    var fill = function(c){ return {type:'pattern', pattern:'solid', fgColor:{argb:'FF'+c}}; };
    // a counted 0 prints as 0 — empty (not counted) is a blank cell, never the same thing
    var NUM = '#,##0;[Red]-#,##0;0', AED = '#,##0.00;[Red]-#,##0.00;"–"', DIFF = '+#,##0;[Red]-#,##0;0';

    var any = function(f){ return eqShelf.some(f); };
    var hasType = any(function(p){ return p.kind && p.kind.toLowerCase() !== String(p.grp||'').toLowerCase(); });
    var hasSup  = any(function(p){ return !!p.supplier; });
    var hasPar  = any(function(p){ return p.par_level != null; });
    var hasNote = any(function(p){ var c = eqCounts[p.id]; return c && c.unsplit != null; });
    var prev = !!eqPrevM, prevName = prev ? eqMonthName(eqPrevM) : '';

    // one list of columns; every row is built from it, so a header can never
    // drift away from the number under it
    var cols = [{ k:'pic', h:'', w:8 }, { k:'name', h:'Piece', w:34 }];
    if (hasType) cols.push({ k:'type', h:'Type', w:16 });
    if (hasSup)  cols.push({ k:'sup',  h:'Supplier', w:16 });
    if (hasPar)  cols.push({ k:'par',  h:'Par', w:7, f:NUM, sum:false });
    cols.push({ k:'store', h:'Store', w:9, f:NUM, sum:true },
              { k:'in_use', h:'In use', w:9, f:NUM, sum:true },
              { k:'total', h:'Total', w:9, f:NUM, sum:true, bold:true });
    if (prev) cols.push({ k:'was', h:'Was\n'+prevName, w:12, f:NUM, sum:true },
                        { k:'rec', h:'Received', w:10, f:NUM, sum:true },
                        { k:'diff', h:'Diff\n(− = short)', w:11, f:DIFF, sum:true, bold:true });
    cols.push({ k:'price', h:'Price\n(AED)', w:11, f:AED, sum:false },
              { k:'value', h:'Value\n(AED)', w:13, f:AED, sum:true });
    if (prev) cols.push({ k:'cost', h:'Cost of short\n(AED)', w:14, f:AED, sum:true });
    if (hasNote) cols.push({ k:'note', h:'Note', w:30 });
    var N = cols.length, ix = {};
    cols.forEach(function(c, i){ ix[c.k] = i + 1; });

    var wb = new ExcelJS.Workbook();
    wb.creator = "Roberto's DIFC"; wb.created = new Date();
    var ws = wb.addWorksheet(eqSecLabel().replace(/&/g,'and').slice(0,31), {
      views: [{ state:'frozen', ySplit:4, topLeftCell:'A5', activeCell:'A5' }],
      pageSetup: { orientation:'landscape', paperSize:9, fitToPage:true, fitToWidth:1, fitToHeight:0,
                   margins:{ left:0.4, right:0.4, top:0.5, bottom:0.5, header:0.3, footer:0.3 } },
      headerFooter: { oddFooter: "&L&8Roberto's DIFC · "+eqSecLabel().replace(/&/g,'&&')+' equipment · '+eqMonthName(eqMonth)+'&R&8Page &P of &N' }
    });
    ws.columns = cols.map(function(c){ return { width:c.w }; });
    ws.pageSetup.printTitlesRow = '4:4';

    var t = eqTotals();
    var title = ws.addRow(["ROBERTO'S DIFC  —  "+eqSecLabel().toUpperCase()+' EQUIPMENT']);
    title.height = 34; ws.mergeCells(title.number, 1, title.number, N);
    title.getCell(1).style = { font:font({bold:true, size:16, color:{argb:'FF'+C.SABBIA}}), fill:fill(C.VINO),
      alignment:{horizontal:'center', vertical:'middle'} };
    var sub = ws.addRow([eqMonthName(eqMonth)+' count'+(eqTake ? (eqTake.status==='closed' ? ' (closed)' : ' (still counting)') : '')+
      '   |   '+t.counted+' of '+eqShelf.length+' lines counted'+
      (prev ? '   |   compared with '+prevName : '   |   no earlier month to compare with')+
      '   |   built '+new Date().toLocaleString('en-GB', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'})]);
    sub.height = 18; ws.mergeCells(sub.number, 1, sub.number, N);
    sub.getCell(1).style = { font:font({size:9, italic:true, color:{argb:'FF'+C.VINO}}), fill:fill(C.SABBIA),
      alignment:{horizontal:'center', vertical:'middle'} };
    ws.addRow([]).height = 6;
    var hdr = ws.addRow(cols.map(function(c){ return c.h; }));
    hdr.height = 32;
    hdr.eachCell({includeEmpty:true}, function(cell, ci){
      cell.style = { font:font({bold:true, size:9, color:{argb:'FF'+C.SABBIA}}), fill:fill(C.VINO),
        alignment:{horizontal: ci <= 2 ? 'left' : 'center', vertical:'middle', wrapText:true}, border:line(C.GOLD) };
    });

    // what each piece says, in the app's own arithmetic (eqTot / eqLine)
    function vals(p){
      var c = eqCounts[p.id], has = eqHas(c), L = prev ? eqLine(p) : null, pv = eqPrev[p.id];
      var price = p.price != null ? Number(p.price) : null;
      return {
        name: p.name,
        type: (p.kind && p.kind.toLowerCase() !== String(p.grp||'').toLowerCase()) ? p.kind.charAt(0)+p.kind.slice(1).toLowerCase() : null,
        sup: p.supplier || null, par: p.par_level,
        store: c && c.store != null ? c.store : null,
        in_use: c && c.in_use != null ? c.in_use : null,
        total: has ? eqTot(c) : null,
        was: eqHas(pv) ? eqTot(pv) : null,
        rec: c && c.received ? c.received : null,
        diff: L ? -L.d : null,
        price: price,
        value: has && price != null ? Math.round(eqTot(c)*price*100)/100 : null,
        cost: L && L.d > 0 && price != null ? Math.round(L.d*price*100)/100 : null,
        note: c && c.unsplit != null ? 'Workbook total, not split by place' : null,
        short: !!(L && L.d > 0)
      };
    }
    var groupRows = [], first = null, last = null, band = 0;
    function closeGroup(){
      if (first == null) return;
      var r = ws.addRow([]); r.height = 18;
      r.getCell(ix.name).value = 'Total '+last;
      cols.forEach(function(c){
        var cell = r.getCell(ix[c.k]);
        // a column nobody filled in this group stays blank — a 0 would say
        // "counted, none", and Sommelier's store/in-use were never split at all
        if (c.sum){
          var L = cell.address.replace(/\d+$/, '');
          var res = 0, seen = 0;
          for (var i = first; i < r.number; i++){ var v = ws.getRow(i).getCell(ix[c.k]).value; if (typeof v === 'number'){ res += v; seen++; } }
          if (seen) cell.value = { formula:'SUM('+L+first+':'+L+(r.number-1)+')', result:Math.round(res*100)/100 };
          cell.numFmt = c.f;
        }
        cell.style = Object.assign({}, cell.style, { font:font({bold:true, color:{argb:'FF'+C.VINO}}), fill:fill(C.LIGHT),
          border:{ top:{style:'thin', color:{argb:'FF'+C.GOLD}} }, alignment:{vertical:'middle', horizontal: ix[c.k] <= 2 ? 'left' : 'right'} });
        if (c.sum) cell.numFmt = c.f;
      });
      groupRows.push(r.number);
      ws.addRow([]).height = 8;
      first = null;
    }
    var picIds = {};
    eqShelf.forEach(function(p){
      var g = p.grp || 'Other';
      if (g !== last){
        closeGroup();
        last = g; band = 0;
        var gr = ws.addRow([]); gr.height = 22;
        ws.mergeCells(gr.number, 1, gr.number, N);
        gr.getCell(1).value = g;
        gr.getCell(1).style = { font:font({bold:true, size:11, color:{argb:'FF'+C.VINO}}), alignment:{vertical:'bottom'},
          border:{ bottom:{style:'medium', color:{argb:'FF'+C.VINO}} } };
      }
      var v = vals(p);
      var r = ws.addRow(cols.map(function(c){ return c.k === 'pic' ? null : (v[c.k] == null ? null : v[c.k]); }));
      if (first == null) first = r.number;
      r.height = 40;
      var zebra = (band++ % 2 === 1);
      cols.forEach(function(c){
        var cell = r.getCell(ix[c.k]);
        cell.style = { font:font({ bold:!!c.bold || (c.k==='diff' && v.short), italic: c.k==='note',
                         size: c.k==='note' || c.k==='type' || c.k==='sup' ? 9 : 10,
                         color:{argb:'FF'+((c.k==='diff'||c.k==='cost') && v.short ? '9C1C1C' : C.DARK)} }),
          fill: v.short ? fill('FBE9E7') : (zebra ? fill(C.LIGHT) : undefined),
          alignment:{ vertical:'middle', horizontal: c.f ? 'right' : 'left', wrapText: c.k==='name' || c.k==='note' },
          border:{ bottom:{style:'hair', color:{argb:'FFD9CFC0'}} } };
        if (c.f) cell.numFmt = c.f;
      });
      if (p.thumb && /^data:image\/(jpeg|jpg|png);base64,/.test(p.thumb)){
        var ext = /png/.test(p.thumb.slice(0,20)) ? 'png' : 'jpeg';
        var id = picIds[p.id] || (picIds[p.id] = wb.addImage({ base64:p.thumb, extension:ext }));
        ws.addImage(id, { tl:{ col:0.12, row:r.number-1+0.06 }, ext:{ width:46, height:46 }, editAs:'oneCell' });
      }
    });
    closeGroup();

    // the whole section, off the group totals (not the pieces again, so a
    // total can never disagree with the subtotals printed above it)
    var tot = ws.addRow([]); tot.height = 24;
    tot.getCell(ix.name).value = 'TOTAL '+eqSecLabel().toUpperCase();
    cols.forEach(function(c){
      var cell = tot.getCell(ix[c.k]);
      if (c.sum){
        var L = cell.address.replace(/\d+$/, ''), res = 0, used = [];
        groupRows.forEach(function(n){ var x = ws.getRow(n).getCell(ix[c.k]).value; if (x && x.formula){ res += x.result || 0; used.push(L+n); } });
        if (used.length) cell.value = { formula: used.join('+'), result:Math.round(res*100)/100 };
      }
      cell.style = { font:font({bold:true, size:11, color:{argb:'FF'+C.SABBIA}}), fill:fill(C.VINO),
        alignment:{vertical:'middle', horizontal: ix[c.k] <= 2 ? 'left' : 'right'}, border:line(C.GOLD) };
      if (c.sum) cell.numFmt = c.f;
    });

    // what the money cannot see, said where the money is — as on the Summary
    var notes = [];
    if (eqShelf.length - t.priced) notes.push((eqShelf.length - t.priced)+' of the '+eqShelf.length+' lines have no price yet, so Value'+(prev?' and Cost of short':'')+' leave them out.');
    if (prev) notes.push('Diff = counted now − (was + received). A minus is pieces short; the red rows are the short ones.');
    if (prev && t.noPrev) notes.push(t.noPrev+' counted line'+(t.noPrev===1?' has':'s have')+' no count for '+prevName+', so Diff is left empty rather than guessed.');
    if (t.unsplit) notes.push(t.unsplit+' pieces came from the workbook as a total only — it never said how many were in the store and how many in use.');
    if (notes.length) ws.addRow([]).height = 8;
    notes.forEach(function(n){
      var r = ws.addRow([]); ws.mergeCells(r.number, 2, r.number, N);
      r.getCell(2).value = n;
      r.getCell(2).style = { font:font({size:9, italic:true}), alignment:{wrapText:true, vertical:'top'} };
      r.height = 16;
    });

    var buf = await wb.xlsx.writeBuffer();
    var blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = "Roberto's "+eqSecLabel()+' equipment '+eqMonthName(eqMonth)+'.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  } catch(e){ eqToast('Could not build the Excel: '+((e && e.message) ? e.message : e), true); }
}

function eqRender(){
  var root = document.getElementById('eq-root'); if (!root) return;
  eqInjectCss();
  var secs = '<div class="eqsecs">'+EQ_SECTIONS.map(function(s){
    return '<button class="eqsec'+(s.key===eqSection?' on':'')+'" onclick="eqSetSection(\''+s.key+'\')">'+eqEsc(s.label)+'</button>'; }).join('')+'</div>';
  if (eqErr){
    root.innerHTML = '<div class="eqwrap">'+secs+'<div class="eqnote warn"><b>The equipment list could not be read.</b> '+eqEsc(eqErr)+'</div></div>';
    return;
  }
  var open = eqOpen(), sup = eqSuper(), cur = eqMonthEnd();
  var hasCur = eqTakes.some(function(t){ return t.month === cur; });
  var head = '<div class="eqhd"><h2>Equipment count</h2><p>'+eqEsc(eqSecLabel())+
    ' — counted where it is: what is in the store and what is out in use.</p>'+
    '<button class="eqfold" onclick="eqHelp=!eqHelp;eqRender()">'+(eqHelp?'Hide how this works':'How this works')+'</button>'+
    (eqHelp ? '<p class="eqhelp">Every line has its photograph, so nobody counts the wrong glass. Type what is in the store '+
      'and what is in use; the total adds itself up. Leave a box empty if you have not counted it — empty is not zero. '+
      'An admin code starts and closes the month, enters what was received, and sees last month and what is short.</p>' : '')+
    '</div>';
  var tools = '<div class="eqtools">'+eqMonthPicker()+
    '<button class="eqb2'+(eqTab==='count'?' on':'')+'" onclick="eqTab=\'count\';eqRender()">Count</button>'+
    '<button class="eqb2'+(eqTab==='summary'?' on':'')+'" onclick="eqTab=\'summary\';eqRender()">Summary</button>'+
    (sup ? '<button class="eqb2'+(eqTab==='manage'?' on':'')+'" onclick="eqTab=\'manage\';eqRender()">Manage</button>' : '')+
    (sup && eqTake ? '<button class="eqb2" onclick="eqCloseMonth('+(open?'false':'true')+')"'+(eqBusy?' disabled':'')+'>'+(open?'Close this count':'Reopen it')+'</button>' : '')+
    (sup && !hasCur ? '<button class="eqb" onclick="eqStartMonth()"'+(eqBusy?' disabled':'')+'>Start '+eqEsc(eqMonthName(cur))+'</button>' : '')+
    (sup ? '<button class="eqb2" onclick="eqExcel()">Excel</button>' : '')+
    '<button class="eqb2" onclick="window.print()">Print</button>'+
  '</div>';
  var state = '';
  if (!eqTake){
    state = '<div class="eqnote warn"><b>No count is open for '+eqEsc(eqSecLabel())+'.</b> '+
      (sup ? 'Press <b>Start '+eqEsc(eqMonthName(cur))+'</b> and the whole list appears, ready to count.' : 'An admin code (1212 / 0000 / 2468) starts one.')+'</div>';
  } else if (!open){
    state = '<div class="eqnote"><b>'+eqEsc(eqMonthName(eqMonth))+' is closed.</b> '+(eqTake.note ? eqEsc(eqTake.note)+' ' : '')+
      'Nothing on it can change until it is reopened.'+
      (!hasCur ? (sup ? '' : ' The next count starts when an admin code opens '+eqEsc(eqMonthName(cur))+'.') : '')+'</div>';
  } else {
    state = '<div class="eqnote"><b id="eq-done">'+eqDone()+' of '+eqShelf.length+' counted</b> · '+eqEsc(eqMonthName(eqMonth))+' is open. '+
      'Empty is not the same as zero.</div>';
  }
  var body;
  // a closed month is last month's numbers the moment the next one starts —
  // a counter is shown that it is closed, never what it says
  if (!sup && eqTake && !open && eqTab !== 'manage') body = '<div class="eqnote">Its figures are on an admin code (1212 / 0000 / 2468).</div>';
  else if (eqTab === 'summary') body = eqSummaryHtml();
  else if (eqTab === 'manage') body = eqManageHtml();
  else if (!eqTake) body = '';
  else body = '<div class="eqtools"><input class="eqin" style="flex:1 1 220px" placeholder="Search '+eqEsc(eqSecLabel())+'…" value="'+eqEsc(eqQ)+
    '" aria-label="Search" oninput="eqQ=this.value;eqDraw()"></div><div id="eq-list">'+eqCountHtml()+'</div>';
  root.innerHTML = '<div class="eqwrap">'+secs+head+eqGateHtml()+tools+(eqTab==='manage'?'':state)+body+'</div>';
}
function eqDraw(){ var l = document.getElementById('eq-list'); if (l) l.innerHTML = eqCountHtml(); }

function eqInjectCss(){
  if (document.getElementById('eq-css')) return;
  var s = document.createElement('style'); s.id = 'eq-css';
  s.textContent = [
    '.eq-switch{display:flex;gap:8px;max-width:920px;margin:0 auto;padding:14px 14px 0}',
    '.eq-sw{flex:1 1 0;min-height:46px;border:1px solid #410207;background:#fff;color:#410207;font-weight:700;font-size:14px;border-radius:10px;cursor:pointer}',
    '.eq-sw.on{background:#410207;color:#f5ede0}',
    '#eq-root{--cv:#410207;--cvm:#5e0a10;--cvl:#7a1218;--cs:#e1d3c2;--csl:#ede5d8;--csd:#cfc0ad;--ck:#2a1a10;--ccr:#f5ede0;--cgo:#ba9b02;--col:#4b5128}',
    '.eqwrap{max-width:920px;margin:0 auto;padding:12px 14px 90px;color:var(--ck)}',
    '.eqsecs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}',
    '.eqsec{min-height:44px;padding:4px 6px;border:1px solid #c9a84c;background:#fff;color:#7a1218;font-weight:700;font-size:13px;border-radius:10px;cursor:pointer}',
    '.eqsec.on{background:#410207;color:#f5ede0;border-color:#410207}',
    '.eqhd{background:var(--cv);color:var(--ccr);border-radius:6px;padding:14px 16px;margin-bottom:12px}',
    '.eqhd h2{font-family:"Cormorant Garamond",Georgia,serif;font-size:26px;margin:0 0 3px;font-weight:600;color:var(--ccr)}',
    '.eqhd p{margin:0;font-size:13.5px;color:#f5ede0;line-height:1.5}',
    '.eqhd .eqhelp{margin-top:8px}',
    '.eqfold{border:0;background:none;color:#f5ede0;font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 0 0;text-decoration:underline;text-underline-offset:3px}',
    '.eqgate{background:#fff;border:2px solid var(--cv);border-radius:6px;padding:14px;margin-bottom:12px}',
    '.eqgate b{display:block;font-size:15px;margin-bottom:9px}',
    '.eqrow{display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end}',
    '.eqin{font-size:16px;color:var(--ck);background:#fff;border:1px solid var(--csd);border-radius:4px;padding:10px 12px;min-height:46px;box-sizing:border-box;max-width:100%}',
    '.eqin:focus{border-color:var(--cv);outline:none}',
    '.eqb{font-size:14px;font-weight:700;background:var(--cv);color:var(--ccr);border:1px solid var(--cv);border-radius:6px;padding:0 16px;min-height:46px;cursor:pointer}',
    '.eqb[disabled],.eqb2[disabled]{opacity:.55;cursor:default}',
    '.eqb2{font-size:14px;font-weight:700;background:#fff;color:var(--cv);border:1px solid var(--csd);border-radius:6px;padding:0 14px;min-height:46px;cursor:pointer}',
    '.eqb2.on{background:var(--cv);color:var(--ccr);border-color:var(--cv)}',
    '.eqb:focus-visible,.eqb2:focus-visible,.eqsec:focus-visible,.eq-sw:focus-visible{outline:3px solid var(--cgo);outline-offset:2px}',
    '.eqwho{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--csl);border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:14px}',
    '.eqtools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}',
    '.eqnote{background:var(--ccr);border-left:3px solid var(--col);padding:10px 12px;border-radius:0 4px 4px 0;font-size:14px;line-height:1.55;margin-bottom:12px}',
    '.eqnote.warn{border-left-color:var(--cv)}',
    '.eqgh{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--cvl);font-weight:800;padding:14px 0 7px}',
    '.eqr{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid var(--csd);border-radius:6px;padding:9px;margin-bottom:8px}',
    '.eqpic{width:64px;height:64px;flex:0 0 auto;padding:0;border:0;background:var(--csl);border-radius:4px;cursor:zoom-in;overflow:hidden}',
    '.eqpic img{width:100%;height:100%;object-fit:contain;display:block}',
    '.eqnopic{cursor:default}',
    '.eqnm{flex:1 1 150px;min-width:0}',
    '.eqnm b{display:block;font-size:15px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}',
    '.eqnm span{display:block;font-size:12.5px;color:#5e0a10;margin-top:3px}',
    '.eqnm em{display:block;font-size:12px;color:#4b5128;margin-top:3px;font-style:normal;font-weight:600}',
    '.eqq{flex:0 0 auto;display:flex;gap:8px;align-items:flex-end}',
    '.eqqb{display:flex;flex-direction:column;gap:3px}',
    '.eqqb label{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#5e0a10;font-weight:800}',
    '.eqqb input{width:74px;font-family:"Cormorant Garamond",Georgia,serif;font-size:23px;text-align:center;color:var(--cv);background:#fff;border:1px solid var(--csd);border-radius:4px;min-height:48px;box-sizing:border-box}',
    '.eqqb input:focus{border-color:var(--cv);outline:none}',
    '.eqqb input.set{background:var(--ccr);font-weight:700}',
    '.eqqb input[disabled]{background:#f4f1ec;color:#5e0a10}',
    '.eqtot{flex:0 0 auto;min-width:58px;text-align:right}',
    '.eqtot b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-size:25px;color:var(--ck)}',
    '.eqtot span{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#5e0a10;font-weight:800}',
    '.eqsum{background:#fff;border:1px solid var(--csd);border-radius:6px;padding:14px;margin-bottom:12px}',
    '.eqsum h3{font-family:"Cormorant Garamond",Georgia,serif;font-size:21px;color:var(--cv);margin:0 0 10px;font-weight:700}',
    '.eqfig{display:flex;flex-wrap:wrap;gap:10px}',
    '.eqfig div{flex:1 1 130px;background:var(--csl);border-radius:6px;padding:10px 12px}',
    '.eqfig b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-size:27px;color:var(--cv);line-height:1.1}',
    '.eqfig span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5e0a10;font-weight:800;margin-top:4px}',
    '.eqtab{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}',
    '.eqtab th{text-align:left;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#5e0a10;font-weight:800;padding:7px 6px;border-bottom:1px solid var(--csd)}',
    '.eqtab td{padding:7px 6px;border-bottom:1px solid rgba(207,192,173,.55);vertical-align:middle}',
    '.eqtab .n{text-align:right;font-variant-numeric:tabular-nums}',
    '.eqtab tr.bad td{background:rgba(65,2,7,.055)}',
    '.eqtab td.br{font-weight:800;color:var(--cv)}',
    '.eqmini{width:34px;height:34px;object-fit:contain;background:var(--csl);border-radius:3px;vertical-align:middle;margin-right:8px}',
    '.eqedit{background:#fff;border:2px solid var(--cv);border-radius:6px;padding:12px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px}',
    '.eqedit label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:800;color:#5e0a10}',
    '.eqedit .eqrow label{flex:1 1 140px}',
    '.eqsmall{font-size:12.5px;color:#5e0a10}',
    '#eq-photo-ov{position:fixed;inset:0;z-index:9999;background:rgba(20,8,6,.88);display:none;align-items:center;justify-content:center;padding:16px;cursor:zoom-out}',
    '#eq-photo-ov figure{margin:0;max-width:min(92vw,900px);text-align:center}',
    '#eq-photo-ov img{max-width:100%;max-height:78vh;object-fit:contain;border-radius:6px;background:#fff}',
    '#eq-photo-ov figcaption{color:#f5ede0;font-size:16px;font-weight:700;margin-top:10px}',
    '#eq-photo-ov figcaption span{display:block;font-size:12.5px;font-weight:400;opacity:.85;margin-top:3px}',
    '@media(max-width:620px){',
    '  .eqr{flex-wrap:wrap}.eqnm{flex:1 1 calc(100% - 80px)}',
    '  .eqq{flex:1 1 0;min-width:0}.eqqb{flex:1 1 0;min-width:0}.eqqb input{width:100%}',
    '  .eqtab .hidemob{display:none}',
    '}',
    '@media print{',
    '  .eq-switch,.eqsecs,.eqtools,.eqwho,.eqgate,.eqfold,.eqb,.eqb2,#eq-photo-ov{display:none!important}',
    '  .eqwrap{padding:0;max-width:none}.eqr{break-inside:avoid}',
    '}'
  ].join('');
  document.head.appendChild(s);
}
