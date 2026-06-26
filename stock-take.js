// ══════════════════════════════════════════════════════════════════════════
// FOH STOCK TAKE MODULE — monthly inventory count (Beverage + Tobacco).
// The FOH twin of the Kitchen stock take. Two lists live in one screen, flipped
// by a Beverage | Tobacco toggle at the top — each is its own dept, own totals,
// own Excel back to Aung. Items + prices come from the cost controller's monthly
// Excels (uploaded in-app); staff enter quantities live, gated by employee ID.
//
// Tables (FOH project paoaivwtkzujmrgrfjuq): stock_take_sheets / _items / _counts.
// Scale-ready: every row carries venue_id + dept('beverage'|'tobacco') + month.
//
// FOH integration: a single-page "Stock Take" tab (like Revenue / Operations),
// reached via enterApp('stocktake'). renderMain() writes a STABLE shell
// (#st-root); this module owns everything inside it (so realtime ticks elsewhere
// never clobber a count in progress). Reuses FOH globals: sb, SUPABASE_URL,
// SUPABASE_KEY, state.currentTab, toast().
//
// NOTE: no yield logic here — the Kitchen's 30% wild-seafood/tenderloin gross-up
// is food-only and deliberately omitted.
// ══════════════════════════════════════════════════════════════════════════

var STOCK_VENUE = 'robertos-difc';
var STOCK_DEPTS = [{ key:'beverage', label:'Beverage' }, { key:'tobacco', label:'Tobacco' }];

// Review & send recipients (FOH). To Aung; cc Asarudeen, Manuel, Jad.
var STOCK_EMAIL_TO = 'ahtwe@robertos.ae';
var STOCK_EMAIL_CC = ['amohamed@robertos.ae','mpetrosino@robertos.ae','jballout@robertos.ae'];

// Super-user passcodes — grant stock-take access on their own, NOT linked to any
// employee/roster record (so the holder never appears on the FOH schedule). Used
// by Francesco + shared with the cost controller as an admin code. Beta: security
// deferred, so this lives client-side. Counts are attributed to this label.
var STOCK_SUPER = { '1212': 'Stock Take Admin', '0000': 'Cost Controller' };

// Previous-month reference (the grey "Last month: …" line + last-month closing
// total) is BUILT but hidden for now. Flip to true to switch it back on — planned
// for July once June's inventory is done. When false, no prior-month data is even
// loaded, so the display naturally shows nothing.
var STOCK_SHOW_PREV = false;

// ── state ──
var stDept    = 'beverage';  // current list (beverage | tobacco)
var stSheet   = null;        // { month, status, ... }
var stMonth   = null;        // 'YYYY-MM'
var stItems   = [];          // [{id,item_group,code,name,unit,price,units,is_added}]
var stCounts  = {};          // item_id -> { qty, unit, counted_by, counted_by_name }
var stUser    = null;        // { emp_id, name }  (null until signed in; persists across dept switch)
var stSearch  = '';
var stCatFilter = '';
var stOnlyCounted = false;   // "Counted only" tickbox
var stUnitSel = {};          // item_id -> chosen unit (for 2-unit items)
var stChannel = null;
var stLoading = false;

// ── previous-month reference (read-only): what each item closed at last month ──
var stPrevRef   = {};        // ref-key -> { qty, unit, value }
var stPrevTotal = 0;         // previous month's closing total value
var stPrevMonth = null;      // 'YYYY-MM' of the previous sheet (null if none)
var stPrevLabel = '';        // e.g. 'May 2026'

function stActive(){ return typeof state==='object' && state && state.currentTab==='stocktake'; }
function stDeptLabel(){ var d=STOCK_DEPTS.find(function(x){return x.key===stDept;}); return d?d.label:stDept; }
function stMoney(n){ return 'AED ' + (Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function stEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// price/unit for an item given the currently-chosen unit
function stItemPrice(it){
  var u = stUnitSel[it.id];
  if(u && Array.isArray(it.units)){
    var hit = it.units.find(function(x){ return x.unit===u; });
    if(hit) return Number(hit.price)||0;
  }
  return Number(it.price)||0;
}
function stItemUnit(it){ return stUnitSel[it.id] || it.unit || ''; }

// price for a given item + a specific unit (used for previous-month history,
// independent of the current session's unit picks)
function stPriceForUnit(it, unit){
  if(unit && Array.isArray(it.units)){
    var hit = it.units.find(function(x){ return x.unit===unit; });
    if(hit) return Number(hit.price)||0;
  }
  return Number(it.price)||0;
}
// stable identity across monthly re-uploads: article code if present, else name
function stRefKey(it){
  var c = (it.code==null?'':String(it.code)).trim();
  if(c) return 'c:'+c.toLowerCase();
  return 'n:'+String(it.name||'').trim().toLowerCase();
}
// the small grey "Last month: …" line under an item (empty if no prior count)
function stPrevText(it){
  var r = stPrevRef[stRefKey(it)];
  if(!r) return '';
  return '<div class="st-prev">Last month: '+stEsc(String(r.qty))+(r.unit?' '+stEsc(r.unit):'')+' · '+stMoney(r.value)+'</div>';
}

// ── data load (scoped to the current dept) ──
async function stLoadSheet(){
  var res = await sb.from('stock_take_sheets').select('*')
    .eq('venue_id',STOCK_VENUE).eq('dept',stDept)
    .order('month',{ascending:false}).limit(1);
  if(res.error && typeof toast==='function')
    toast('Could not load the stock-take month — check connection and reopen.', true);
  stSheet = (res.data && res.data[0]) || null;
  stMonth = stSheet ? stSheet.month : null;
}
// Page through PostgREST's 1000-rows-per-request cap. WITHOUT this, a dept+month
// with more than 1000 items (or counts) silently loads only the first 1000 — no
// error — and the rest vanish from the totals, Excel and email. Each page rebuilds
// the query (a range can't be reused across awaits); we stop on the first short
// page. A stable secondary sort on id keeps pages from overlapping/skipping rows.
async function stFetchAllPaged(makeQuery){
  var out=[], from=0, PAGE=1000;
  for(;;){
    var res = await makeQuery().range(from, from+PAGE-1);
    if(res && res.error) return { data:out, error:res.error };
    var batch = (res && res.data) || [];
    out = out.concat(batch);
    if(batch.length < PAGE) break;
    from += PAGE;
  }
  return { data:out, error:null };
}
async function stLoadItems(){
  if(!stMonth){ stItems = []; return; }
  var res = await stFetchAllPaged(function(){
    return sb.from('stock_take_items').select('*')
      .eq('venue_id',STOCK_VENUE).eq('dept',stDept).eq('month',stMonth)
      .eq('active',true).order('sort_order').order('id');
  });
  stItems = res.data || [];
  if(res.error && typeof toast==='function')
    toast('Not all items loaded ('+stItems.length+' so far) — the total may be incomplete. Reopen Stock Take.', true);
}
async function stLoadCounts(){
  stCounts = {};
  if(!stMonth) return;
  var res = await stFetchAllPaged(function(){
    return sb.from('stock_take_counts').select('*')
      .eq('venue_id',STOCK_VENUE).eq('dept',stDept).eq('month',stMonth).order('id');
  });
  if(res.error && typeof toast==='function')
    toast('Not all counts loaded — reopen Stock Take to be sure the total is right.', true);
  (res.data||[]).forEach(function(r){
    stCounts[r.item_id] = { qty:r.qty, unit:r.unit, counted_by:r.counted_by, counted_by_name:r.counted_by_name };
    if(r.unit) stUnitSel[r.item_id] = r.unit;
  });
}

// ── previous-month reference: load the most recent EARLIER sheet (same dept) and
// build a per-item lookup of what it closed at. Read-only history — no realtime. ──
async function stLoadPrevMonth(){
  stPrevRef = {}; stPrevTotal = 0; stPrevMonth = null; stPrevLabel = '';
  if(!STOCK_SHOW_PREV) return;   // feature built but hidden — flip STOCK_SHOW_PREV to re-enable
  if(!stMonth) return;
  var sres = await sb.from('stock_take_sheets').select('month')
    .eq('venue_id',STOCK_VENUE).eq('dept',stDept).lt('month',stMonth)
    .order('month',{ascending:false}).limit(1);
  var prev = sres.data && sres.data[0];
  if(!prev) return;
  stPrevMonth = prev.month;
  stPrevLabel = new Date(stPrevMonth+'-01T12:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  var ires = await stFetchAllPaged(function(){
    return sb.from('stock_take_items').select('id,code,name,unit,price,units')
      .eq('venue_id',STOCK_VENUE).eq('dept',stDept).eq('month',stPrevMonth).eq('active',true);
  });
  var cres = await stFetchAllPaged(function(){
    return sb.from('stock_take_counts').select('item_id,qty,unit')
      .eq('venue_id',STOCK_VENUE).eq('dept',stDept).eq('month',stPrevMonth);
  });
  var countByItem = {};
  (cres.data||[]).forEach(function(c){ if(c.qty!=null) countByItem[c.item_id] = c; });
  (ires.data||[]).forEach(function(it){
    var c = countByItem[it.id]; if(!c) return;
    var val = stPriceForUnit(it, c.unit) * Number(c.qty);
    stPrevRef[stRefKey(it)] = { qty:c.qty, unit:c.unit||it.unit||'', value:val };
    stPrevTotal += val;
  });
}

// ── realtime: live multi-person counting (per dept + month) ──
function stSubscribe(){
  if(stChannel){ sb.removeChannel(stChannel); stChannel = null; }
  if(!stMonth) return;
  stChannel = sb.channel('stock_take_'+stDept+'_'+stMonth)
    .on('postgres_changes', { event:'*', schema:'public', table:'stock_take_counts', filter:'month=eq.'+stMonth },
      function(payload){
        var r = payload.new || payload.old; if(!r) return;
        if(r.dept && r.dept!==stDept) return;           // ignore the other list's changes
        if(payload.eventType==='DELETE'){ delete stCounts[r.item_id]; }
        else { stCounts[r.item_id] = { qty:r.qty, unit:r.unit, counted_by:r.counted_by, counted_by_name:r.counted_by_name }; }
        if(stActive()){ stUpdateRowUI(r.item_id); stRenderTotals(); }
      })
    .on('postgres_changes', { event:'*', schema:'public', table:'stock_take_items', filter:'month=eq.'+stMonth },
      function(){ if(stActive()){ stLoadItems().then(function(){ if(stActive()) stSafeRenderRows(); }); } })
    .subscribe();
}

// ── employee-ID gate (validated against the FOH staff list) ──
async function stSignIn(){
  var inp = document.getElementById('st-empid');
  var id = inp ? (inp.value||'').trim() : '';
  if(!id){ if(inp) inp.focus(); return; }
  // super-user passcode (e.g. 1212) — access without any staff/roster record
  if(STOCK_SUPER[id]){ stUser = { emp_id:id, name:STOCK_SUPER[id] }; stRender(); return; }
  var res = await sb.from('foh_staff').select('id,name,emp_id').eq('emp_id', id).eq('active', true).limit(1);
  var staff = res.data && res.data[0];
  if(!staff){
    toast('Employee ID '+id+' not recognised — check and try again.', true);
    return;
  }
  stUser = { emp_id:id, name:staff.name };
  stRender();
}
function stSignOut(){ stUser = null; stRender(); }

// ── write one item's count (upsert / delete on empty), optimistic + rollback ──
async function stSetQty(itemId, value){
  if(!stUser) return;
  var prev = stCounts[itemId] ? Object.assign({}, stCounts[itemId]) : null;
  var qty = value === '' ? null : Number(value);
  var it = stItems.find(function(x){ return x.id===itemId; });
  var unit = it ? stItemUnit(it) : null;
  var res;
  if(qty===null || isNaN(qty) || qty < 0){
    delete stCounts[itemId];
    res = await sb.from('stock_take_counts').delete().eq('item_id', itemId);
  } else {
    stCounts[itemId] = { qty:qty, unit:unit, counted_by:stUser.emp_id, counted_by_name:stUser.name };
    var row = { item_id:itemId, venue_id:STOCK_VENUE, dept:stDept, month:stMonth,
                qty:qty, unit:unit, counted_by:stUser.emp_id, counted_by_name:stUser.name,
                updated_at:new Date().toISOString() };
    res = await sb.from('stock_take_counts').upsert(row, { onConflict:'item_id' });
  }
  if(res && res.error){
    if(prev) stCounts[itemId] = prev; else delete stCounts[itemId];
    toast('That count did NOT save — check the connection and tap again.', true);
    console.warn('stock_take_counts save failed', res.error);
  }
  stUpdateRowUI(itemId);
  stRenderTotals();
  return res || {};
}

// ── ADD to a count (the "+ add" box): sum what you just found onto the running
// total. The add happens ATOMICALLY on the server (stock_take_add RPC) so two
// people adding at the same moment never lose a bottle. We show the change
// optimistically, then trust the server's returned running total. ──
async function stAddQty(itemId, value){
  if(!stUser) return;
  var addBox = document.getElementById('st-add-'+itemId);
  var delta = Number(value);
  if(value==='' || isNaN(delta) || delta===0){ if(addBox) addBox.value=''; return; }
  var it = stItems.find(function(x){ return x.id===itemId; });
  var unit = it ? stItemUnit(it) : null;
  var prev = stCounts[itemId] ? Object.assign({}, stCounts[itemId]) : null;
  // optimistic: bump the local running total straight away
  var base = (prev && prev.qty!=null) ? Number(prev.qty) : 0;
  stCounts[itemId] = { qty:base+delta, unit:unit, counted_by:stUser.emp_id, counted_by_name:stUser.name };
  stUpdateRowUI(itemId); stRenderTotals();
  var res = await sb.rpc('stock_take_add', {
    p_item_id:itemId, p_venue_id:STOCK_VENUE, p_dept:stDept, p_month:stMonth,
    p_delta:delta, p_unit:unit, p_counted_by:stUser.emp_id, p_counted_by_name:stUser.name });
  if(res && res.error){
    if(prev) stCounts[itemId]=prev; else delete stCounts[itemId];
    stUpdateRowUI(itemId); stRenderTotals();
    toast('That add did NOT save — check the connection and try again.', true);
    console.warn('stock_take_add failed', res.error);
    return;
  }
  // server is the source of truth for the running total
  if(res && res.data!=null){
    stCounts[itemId].qty = Number(res.data);
    stUpdateRowUI(itemId); stRenderTotals();
  }
  if(addBox){ addBox.value=''; }   // clear, ready for the next person
}

// ── derived ──
function stFilteredItems(){
  var q = stSearch.toLowerCase();
  return stItems.filter(function(it){
    if(stCatFilter && it.item_group !== stCatFilter) return false;
    if(stOnlyCounted){ var c=stCounts[it.id]; if(!c||c.qty==null) return false; }
    if(q && it.name.toLowerCase().indexOf(q)===-1 && String(it.code||'').indexOf(q)===-1) return false;
    return true;
  });
}
function stCats(){ return Array.from(new Set(stItems.map(function(i){ return i.item_group||'Other'; }))); }
function stLineValue(it){ var c = stCounts[it.id]; if(!c||c.qty==null) return 0; return stItemPrice(it)*Number(c.qty); }
function stGrandTotal(){ var t=0; stItems.forEach(function(it){ t+=stLineValue(it); }); return t; }
function stCountedCount(){ var n=0; stItems.forEach(function(it){ var c=stCounts[it.id]; if(c&&c.qty!=null) n++; }); return n; }
function stCategoryTotal(){ var t=0; stItems.forEach(function(it){ if(!stCatFilter||it.item_group===stCatFilter) t+=stLineValue(it); }); return t; }

// ── self-contained CSS (no dependency on FOH's own button/card classes) ──
function stInjectCss(){
  if(document.getElementById('st-css')) return;
  var s = document.createElement('style'); s.id='st-css';
  s.textContent =
    '#st-root{padding:0 0 70px;max-width:920px;margin:0 auto}'+
    '.st-deptbar{display:flex;gap:8px;padding:14px 14px 4px}'+
    '.st-deptbtn{flex:1;height:42px;border:1px solid #c9a84c;background:#fff;color:#7a1218;font-weight:700;font-size:14px;border-radius:10px;cursor:pointer}'+
    '.st-deptbtn.active{background:#410207;color:#f5ede0;border-color:#410207}'+
    '.st-title{padding:12px 14px 0;font-family:Georgia,serif;color:#410207;font-size:20px;font-weight:700}'+
    '.st-sub{padding:0 14px;color:#8a7a55;font-size:12px}'+
    '.st-gate{margin:12px 14px;padding:12px;background:#fbe7d8;border:1px solid #e3c79a;border-radius:10px}'+
    '.st-gate b{color:#7a1218}'+
    '.st-who{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 14px;font-size:13px;color:#7a6a55}'+
    '.st-who b{color:#410207}'+
    '.st-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:8px 14px 0}'+
    '.st-card{background:#fff;border:1px solid #e8ddc9;border-radius:12px;padding:12px}'+
    '.st-card.dark{background:#410207;border-color:#410207}'+
    '.st-card.dark .st-num{color:#f5ede0}.st-card.dark .st-label{color:#d8c7a8}'+
    '.st-num{font-size:20px;font-weight:800;color:#410207;font-variant-numeric:tabular-nums}'+
    '.st-label{font-size:11px;color:#8a7a55;text-transform:uppercase;letter-spacing:1px;margin-top:2px}'+
    '.st-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 14px 2px}'+
    '.st-input,.st-select{height:38px;border:1px solid #c9a84c;border-radius:8px;padding:0 10px;font-size:14px;background:#fff}'+
    '.st-onlycount{display:flex;align-items:center;gap:6px;font-size:13px;color:#7a6a55;white-space:nowrap}'+
    '.st-catbar{display:flex;align-items:center;justify-content:space-between;padding:8px 14px 2px;font-size:13px}'+
    '.st-catbar b{color:#410207}'+
    '.st-muted{font-size:12px;color:#8a7a55}'+
    '.st-cat{background:#410207;color:#f5ede0;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;padding:6px 14px;margin-top:6px}'+
    '.st-actions{display:flex;gap:8px;padding:8px 14px 4px;flex-wrap:wrap}'+
    '.st-btn{flex:1;min-width:108px;height:40px;border:1px solid #c9a84c;background:#fff;color:#410207;font-weight:700;font-size:13px;border-radius:9px;cursor:pointer;padding:0 12px}'+
    '.st-btn:hover{background:#fbf4e6}'+
    '.st-btn.danger{color:#7a1218;border-color:#d98a8a}'+
    '.st-row{padding:9px 14px;border-bottom:1px solid #e8ddc9;transition:background .12s}'+
    '.st-row.locked{opacity:.55}'+
    '.st-row.active{background:#fbe7cf}'+
    '.st-main{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px}'+
    '.st-namecol{min-width:0}'+
    '.st-name{font-size:14px;font-weight:600;color:#2a1a10;line-height:1.25}'+
    '.st-tag{font-size:10px;font-weight:700;color:#7a4a00;background:#f6d79a;border-radius:5px;padding:1px 6px;margin-left:6px}'+
    '.st-meta{margin-top:4px}'+
    '.st-prev{margin-top:3px;font-size:11px;color:#9a8a6a;font-style:italic}'+
    '.st-prevtotal{padding:6px 14px 0;font-size:12px;color:#8a7a55}'+
    '.st-prevtotal b{color:#410207}'+
    '.st-qtywrap{justify-self:center;display:flex;flex-direction:column;align-items:center;gap:4px}'+
    '.st-qty{width:76px;height:38px;text-align:center;border:1px solid #c9a84c;border-radius:8px;font-size:16px;background:#fff}'+
    '.st-add{width:76px;height:30px;text-align:center;border:1px dashed #1d7a4a;border-radius:8px;font-size:13px;color:#1d7a4a;background:#f3faf5}'+
    '.st-add::placeholder{color:#69a883}'+
    '.st-unit{height:30px;background:#e1d3c2;border:1px solid #cbb892;border-radius:6px;font-size:12px;color:#8a7a55;max-width:180px;padding:0 4px}'+
    '.st-line{justify-self:end;min-width:96px;text-align:right;font-weight:700;color:#410207;font-size:13px;font-variant-numeric:tabular-nums}'+
    '.st-addbtn{margin:14px;width:calc(100% - 28px);height:42px;border:1px dashed #c9a84c;background:#fff;color:#410207;font-weight:700;border-radius:10px;cursor:pointer}'+
    '.st-nodata{padding:26px 14px;text-align:center;color:#8a7a55;font-size:13px}'+
    '.st-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999}'+
    '.st-modal-box{background:#fff;border-radius:12px;padding:18px;width:90%;max-width:360px}'+
    '.st-modal input{width:100%;height:38px;border:1px solid #c9a84c;border-radius:8px;padding:0 10px;font-size:14px;box-sizing:border-box}';
  document.head.appendChild(s);
}

// ── render the whole screen into #st-root ──
function stRender(){
  stInjectCss();
  var root = document.getElementById('st-root'); if(!root) return;
  var deptBar = '<div class="st-deptbar">'+ STOCK_DEPTS.map(function(d){
      return '<button class="st-deptbtn'+(d.key===stDept?' active':'')+'" onclick="stSetDept(\''+d.key+'\')">'+stEsc(d.label)+'</button>';
    }).join('') + '</div>';

  if(stLoading){
    root.innerHTML = deptBar + '<div class="st-nodata">Loading '+stEsc(stDeptLabel())+'…</div>';
    return;
  }
  if(!stMonth){
    root.innerHTML = deptBar +
      '<div class="st-title">'+stEsc(stDeptLabel())+' Stock Take</div>'+
      '<div class="st-sub">No month loaded yet</div>'+
      stGateHtml()+
      (stUser
        ? '<div style="padding:14px"><button class="st-btn" style="flex:none" onclick="stShowUpload()">Upload this month\'s list (.xls)</button></div>'
        : '<div class="st-nodata">Enter your employee ID, then upload this month\'s list from the cost controller.</div>');
    return;
  }
  var monLabel = new Date(stMonth+'-01T12:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  var cats = ['<option value="">All categories</option>'].concat(stCats().map(function(c){
    return '<option value="'+stEsc(c)+'"'+(c===stCatFilter?' selected':'')+'>'+stEsc(c)+'</option>';
  })).join('');

  root.innerHTML =
    deptBar +
    '<div class="st-title">'+stEsc(stDeptLabel())+' Stock Take · '+stEsc(monLabel)+'</div>'+
    '<div class="st-sub">'+stItems.length+' items · shared live · tap a quantity to count</div>'+
    stGateHtml()+
    '<div class="st-cards">'+
      '<div class="st-card dark"><div class="st-num" id="st-grand">'+stMoney(stGrandTotal())+'</div><div class="st-label">Counted value (all)</div></div>'+
      '<div class="st-card"><div class="st-num"><span id="st-counted">'+stCountedCount()+'</span> / '+stItems.length+'</div><div class="st-label">Items counted</div></div>'+
    '</div>'+
    (stPrevTotal>0 ? '<div class="st-prevtotal">Last month ('+stEsc(stPrevLabel)+') closing value: <b>'+stMoney(stPrevTotal)+'</b> · shown per item below for reference</div>' : '')+
    '<div class="st-toolbar">'+
      '<input class="st-input" id="st-search" placeholder="Search items…" value="'+stEsc(stSearch)+'" oninput="stOnSearch(this.value)" style="flex:1;min-width:140px">'+
      '<select class="st-select" id="st-cat" onchange="stOnCat(this.value)">'+cats+'</select>'+
      '<label class="st-onlycount"><input type="checkbox" id="st-onlycount" '+(stOnlyCounted?'checked':'')+' onchange="stToggleOnlyCounted(this.checked)"> Counted only</label>'+
      (stUser?'<button class="st-btn" style="flex:none" onclick="stShowUpload()">Upload month</button>':'')+
    '</div>'+
    '<div class="st-catbar"><span id="st-catlabel">'+(stCatFilter?stEsc(stCatFilter):'All categories')+'</span>'+
      '<span class="st-muted">category total <b id="st-catsub">'+stMoney(stCategoryTotal())+'</b></span></div>'+
    (stUser? '<div class="st-actions">'+
        '<button class="st-btn" onclick="stReviewSend()">Email to Aung</button>'+
        '<button class="st-btn" onclick="stExportExcel()">Download Excel</button>'+
        '<button class="st-btn" onclick="stPrint()">Print</button>'+
        '<button class="st-btn danger" onclick="stClearAllCounts()">Clear all counts</button>'+
      '</div>' : '')+
    '<div id="st-rows"></div>'+
    '<button class="st-addbtn" onclick="stShowAdd()">+ Add missing item</button>';

  stRenderRows();
}

function stRenderRows(){
  var c = document.getElementById('st-rows'); if(!c) return;
  var items = stFilteredItems();
  if(!items.length){ c.innerHTML = '<div class="st-nodata">No items match your search.</div>'; return; }
  var locked = !stUser;
  var html = '';
  var lastCat = null;
  items.forEach(function(it){
    var cat = it.item_group||'Other';
    if(cat!==lastCat){ html += '<div class="st-cat">'+stEsc(cat)+'</div>'; lastCat = cat; }
    var c2 = stCounts[it.id];
    var qv = (c2&&c2.qty!=null) ? c2.qty : '';
    var multi = Array.isArray(it.units) && it.units.length>1;
    var unitCtl = multi
      ? '<select class="st-unit" '+(locked?'disabled':'')+' onchange="stPickUnit(\''+it.id+'\',this.value)">'+
        it.units.map(function(u){ return '<option value="'+stEsc(u.unit)+'"'+(stItemUnit(it)===u.unit?' selected':'')+'>'+stEsc(u.unit)+' · '+stMoney(u.price)+'</option>'; }).join('')+'</select>'
      : '<span class="st-muted">'+stEsc(it.unit||'')+' · '+stMoney(stItemPrice(it))+'</span>';
    html +=
      '<div class="st-row'+(locked?' locked':'')+'" id="st-row-'+it.id+'">'+
        '<div class="st-main">'+
          '<div class="st-namecol">'+
            '<div class="st-name">'+stEsc(it.name)+(it.is_added?'<span class="st-tag">added</span>':'')+'</div>'+
            '<div class="st-meta">'+unitCtl+'</div>'+
            stPrevText(it)+
          '</div>'+
          '<div class="st-qtywrap">'+
            '<input class="st-qty" inputmode="decimal" placeholder="0" value="'+qv+'" '+(locked?'disabled':'')+
              ' onfocus="stFocusRow(\''+it.id+'\',true)" onblur="stFocusRow(\''+it.id+'\',false)" onchange="stSetQty(\''+it.id+'\',this.value)">'+
            '<input class="st-add" id="st-add-'+it.id+'" inputmode="decimal" placeholder="+ add" '+(locked?'disabled':'')+
              ' title="Add what you just found — it sums onto the count" onfocus="stFocusRow(\''+it.id+'\',true)" onblur="stFocusRow(\''+it.id+'\',false)" onchange="stAddQty(\''+it.id+'\',this.value)">'+
          '</div>'+
          '<span class="st-line" id="st-line-'+it.id+'">'+stMoney(stLineValue(it))+'</span>'+
        '</div>'+
      '</div>';
  });
  c.innerHTML = html;
}

// A remote item-add rebuilds rows. Defer the rebuild while a quantity field is
// focused, so we never clear a number someone is mid-typing.
var stRowsTimer = null;
function stSafeRenderRows(){
  var ae = document.activeElement;
  if(ae && ae.classList && (ae.classList.contains('st-qty') || ae.classList.contains('st-add'))){
    clearTimeout(stRowsTimer);
    stRowsTimer = setTimeout(function(){ if(stActive()) stSafeRenderRows(); }, 400);
    return;
  }
  stRenderRows();
}

function stUpdateRowUI(itemId){
  var it = stItems.find(function(x){ return x.id===itemId; });
  if(!it) return;
  var line = document.getElementById('st-line-'+itemId);
  if(line) line.textContent = stMoney(stLineValue(it));
  var row = document.getElementById('st-row-'+itemId);
  if(row){ var inp = row.querySelector('.st-qty'); var c=stCounts[itemId];
    if(inp && document.activeElement!==inp){ inp.value = (c&&c.qty!=null)?c.qty:''; } }
}
function stRenderTotals(){
  var g=document.getElementById('st-grand'); if(g) g.textContent = stMoney(stGrandTotal());
  var n=document.getElementById('st-counted'); if(n) n.textContent = stCountedCount();
  var s=document.getElementById('st-catsub'); if(s) s.textContent = stMoney(stCategoryTotal());
  var l=document.getElementById('st-catlabel'); if(l) l.textContent = stCatFilter||'All categories';
}

// ── toolbar handlers ──
var stSearchTimer=null;
function stOnSearch(v){ stSearch=v; clearTimeout(stSearchTimer); stSearchTimer=setTimeout(stRenderRows,120); }
function stOnCat(v){ stCatFilter=v; stRenderRows(); stRenderTotals(); }
function stToggleOnlyCounted(v){ stOnlyCounted=!!v; stRenderRows(); }
function stFocusRow(itemId, on){ var r=document.getElementById('st-row-'+itemId); if(r) r.classList.toggle('active', on); }
function stPickUnit(itemId, unit){ stUnitSel[itemId]=unit; stUpdateRowUI(itemId); stRenderTotals(); if(stCounts[itemId]&&stCounts[itemId].qty!=null) stSetQty(itemId, stCounts[itemId].qty); }

// switch list (beverage <-> tobacco); keeps the signed-in person
async function stSetDept(dept){
  if(dept===stDept || stLoading) return;
  stDept = dept; stSearch=''; stCatFilter=''; stUnitSel={};
  await stOpen();
}

// wipe EVERY quantity entered for this dept+month (all counters) — confirmed first
async function stClearAllCounts(){
  if(!stUser){ toast('Enter your employee ID first.', true); return; }
  if(!stCountedCount()){ toast('Nothing counted yet.'); return; }
  if(!confirm('Clear ALL counts for '+stDeptLabel()+' — '+stMonth+'?\n\nThis erases every quantity entered this month — by everyone — and cannot be undone. The item list stays.')) return;
  var res=await sb.from('stock_take_counts').delete().eq('venue_id',STOCK_VENUE).eq('dept',stDept).eq('month',stMonth);
  if(res && res.error){ toast('Could not clear counts: '+res.error.message, true); return; }
  stCounts={};
  stRender();
  toast('✓ All counts cleared for '+stDeptLabel()+' '+stMonth+'.');
}

// ── add a missing item (anyone signed in) ──
function stShowAdd(){
  if(!stUser){ toast('Enter your employee ID first.', true); return; }
  var old=document.getElementById('st-add-modal'); if(old) old.remove();
  var box=document.createElement('div');
  box.id='st-add-modal'; box.className='st-modal';
  box.innerHTML='<div class="st-modal-box" onclick="event.stopPropagation()">'+
    '<div style="font-weight:700;color:#410207;margin-bottom:10px">Add missing item — '+stEsc(stDeptLabel())+'</div>'+
    '<input id="st-add-name" placeholder="Item name" style="margin-bottom:8px">'+
    '<div style="display:flex;gap:8px;margin-bottom:8px"><input id="st-add-unit" placeholder="Unit (e.g. Each)" style="flex:1">'+
    '<input id="st-add-price" inputmode="decimal" placeholder="Price" style="width:90px"></div>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="st-btn" style="flex:none" onclick="document.getElementById(\'st-add-modal\').remove()">Cancel</button>'+
    '<button class="st-btn" style="flex:none" onclick="stAddItem()">Add</button></div></div>';
  box.addEventListener('click', function(){ box.remove(); });
  document.body.appendChild(box);
  setTimeout(function(){ var f=document.getElementById('st-add-name'); if(f) f.focus(); }, 50);
}
async function stAddItem(){
  var name=(document.getElementById('st-add-name').value||'').trim();
  if(!name){ document.getElementById('st-add-name').focus(); return; }
  var unit=(document.getElementById('st-add-unit').value||'').trim();
  var price=Number(document.getElementById('st-add-price').value)||0;
  var cat = stCatFilter || 'Added items';
  var maxSort = stItems.length ? Math.max.apply(null, stItems.map(function(i){ return i.sort_order||0; })) : 0;
  var res = await sb.from('stock_take_items').insert({
    venue_id:STOCK_VENUE, dept:stDept, month:stMonth, item_group:cat, code:'',
    name:name, unit:unit, price:price, units:[{unit:unit,price:price}],
    sort_order:maxSort+1, is_added:true, added_by:stUser.emp_id, active:true
  }).select().single();
  if(res.error){ toast('Could not add item: '+res.error.message, true); return; }
  stItems.push(res.data);
  stItems.sort(function(a,b){ return (a.sort_order||0)-(b.sort_order||0); });
  var m=document.getElementById('st-add-modal'); if(m) m.remove();
  stRenderRows();
}

// ── build printable / emailable HTML ──
function stReportHtml(){
  var monLabel = new Date(stMonth+'-01T12:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  var byCat = {};
  stItems.forEach(function(it){ var c=stCounts[it.id]; if(!c||c.qty==null) return;
    (byCat[it.item_group||'Other']=byCat[it.item_group||'Other']||[]).push(it); });
  var cats = Object.keys(byCat);
  var grand = stGrandTotal();
  var body = cats.length ? cats.map(function(cat){
    var rows = byCat[cat].map(function(it){
      var c=stCounts[it.id];
      return '<tr><td style="padding:5px 8px;border-bottom:1px solid #ddd">'+stEsc(it.name)+'</td>'+
        '<td style="padding:5px 8px;border-bottom:1px solid #ddd;text-align:right">'+c.qty+' '+stEsc(stItemUnit(it))+'</td>'+
        '<td style="padding:5px 8px;border-bottom:1px solid #ddd;text-align:right">'+stMoney(stItemPrice(it))+'</td>'+
        '<td style="padding:5px 8px;border-bottom:1px solid #ddd;text-align:right;font-weight:bold">'+stMoney(stLineValue(it))+'</td></tr>';
    }).join('');
    var catTotal = byCat[cat].reduce(function(t,it){ return t+stLineValue(it); },0);
    return '<tr><td colspan="4" style="background:#410207;color:#f5ede0;font-size:11px;letter-spacing:1.2px;padding:6px 8px;text-transform:uppercase">'+stEsc(cat)+' — '+stMoney(catTotal)+'</td></tr>'+rows;
  }).join('') : '<tr><td colspan="4" style="padding:20px;text-align:center">Nothing counted yet.</td></tr>';
  return {
    countedLines: stCountedCount(),
    html: '<div style="font-family:Arial,Helvetica,sans-serif;color:#2a1a10;max-width:680px">'+
      '<h1 style="font-family:Georgia,serif;color:#410207;margin:0 0 2px">Roberto\'s — '+stEsc(stDeptLabel())+' Stock Take</h1>'+
      '<div style="font-size:13px;color:#7a1218;margin-bottom:6px">'+stEsc(monLabel)+' · '+stCountedCount()+' of '+stItems.length+' items counted</div>'+
      '<div style="font-size:16px;color:#410207;font-weight:bold;margin-bottom:12px">Total stock value: '+stMoney(grand)+'</div>'+
      '<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>'+
        '<th style="text-align:left;padding:5px 8px;border-bottom:2px solid #410207">Item</th>'+
        '<th style="text-align:right;padding:5px 8px;border-bottom:2px solid #410207">Counted</th>'+
        '<th style="text-align:right;padding:5px 8px;border-bottom:2px solid #410207">Price</th>'+
        '<th style="text-align:right;padding:5px 8px;border-bottom:2px solid #410207">Value</th></tr></thead>'+
        '<tbody>'+body+'</tbody></table>'+
      '<div style="font-size:11px;color:#999;margin-top:14px">Sent from Roberto\'s FOH App · Stock Take</div></div>'
  };
}

// ── Excel export (matches the cost controller's layout so it drops back in) ──
function stExcelAoa(){
  var monLabel = new Date(stMonth+'-01T12:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  var aoa = [["ROBERTO'S DIFC"], ['Stock Take List - '+stDeptLabel()+' — '+monLabel], [],
    ['Item Group','Article','Article Name','Unit','Ave.Price','Qty','Total Value']];
  var grand = 0;
  stItems.forEach(function(it){
    var c = stCounts[it.id];
    var qty = (c && c.qty!=null) ? Number(c.qty) : '';
    var price = stItemPrice(it);
    var val = qty==='' ? 0 : Math.round(qty*price*100)/100;
    grand += val;
    aoa.push([it.item_group||'', it.code||'', it.name, stItemUnit(it), price, qty, val]);
  });
  aoa.push([]);
  aoa.push(['','','','','','TOTAL', Math.round(grand*100)/100]);
  return aoa;
}
function stExcelBook(){
  var ws = XLSX.utils.aoa_to_sheet(stExcelAoa());
  ws['!cols'] = [{wch:22},{wch:12},{wch:42},{wch:18},{wch:10},{wch:8},{wch:12}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, stDeptLabel());
  return wb;
}
function stExcelName(){ return "Roberto's "+stDeptLabel()+" Stock Take "+stMonth+".xlsx"; }
async function stExportExcel(){
  try{
    await stLoadXLSX();
    XLSX.writeFile(stExcelBook(), stExcelName());
  }catch(e){ toast('Could not build Excel: '+e.message, true); }
}

// ── print ──
function stPrint(){
  var out = stReportHtml();
  var w = window.open('','_blank');
  if(!w){ alert('Pop-up blocked — allow pop-ups to print.'); return; }
  w.document.write('<html><head><title>Roberto\'s '+stEsc(stDeptLabel())+' Stock Take</title></head><body style="margin:28px">'+out.html+'</body></html>');
  w.document.close(); w.focus(); setTimeout(function(){ w.print(); }, 250);
}

// ── review & send: choose Excel attachment OR the in-app digital layout ──
function stReviewSend(){
  if(!stCountedCount()){ alert('Nothing counted yet — enter some quantities first.'); return; }
  var old=document.getElementById('st-send-modal'); if(old) old.remove();
  var box=document.createElement('div');
  box.id='st-send-modal'; box.className='st-modal';
  box.innerHTML='<div class="st-modal-box" onclick="event.stopPropagation()">'+
    '<div style="font-weight:700;color:#410207;margin-bottom:4px">Send '+stEsc(stDeptLabel())+' stock take to Aung</div>'+
    '<div style="font-size:12px;color:#8a7a55;margin-bottom:14px">cc Asarudeen, Manuel &amp; Jad. Choose a format:</div>'+
    '<button class="st-btn" style="width:100%;margin-bottom:10px;text-align:left;height:auto;padding:10px 12px" onclick="stSendEmail(\'excel\')"><b>Excel file</b><br><span style="font-size:11px;color:#8a7a55">attached spreadsheet — for Aung\'s system</span></button>'+
    '<button class="st-btn" style="width:100%;margin-bottom:14px;text-align:left;height:auto;padding:10px 12px" onclick="stSendEmail(\'digital\')"><b>Digital format</b><br><span style="font-size:11px;color:#8a7a55">the in-app layout, inside the email</span></button>'+
    '<div id="st-send-status" style="font-size:12px;min-height:16px;color:#7a1218;margin-bottom:8px"></div>'+
    '<div style="display:flex;justify-content:flex-end"><button class="st-btn" style="flex:none" onclick="document.getElementById(\'st-send-modal\').remove()">Cancel</button></div></div>';
  box.addEventListener('click', function(){ box.remove(); });
  document.body.appendChild(box);
}
async function stSendEmail(mode){
  var statusEl=document.getElementById('st-send-status');
  var monLabel = new Date(stMonth+'-01T12:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  var body={ to:STOCK_EMAIL_TO, cc:STOCK_EMAIL_CC, subject:stDeptLabel()+' Stock Take — '+monLabel };
  try{
    if(statusEl){ statusEl.style.color='#8a7a55'; statusEl.textContent='Sending…'; }
    if(mode==='excel'){
      await stLoadXLSX();
      body.html='<p style="font-family:Arial,Helvetica,sans-serif;color:#2a1a10">Please find attached the '+stEsc(stDeptLabel())+' Stock Take for '+monLabel+'.<br>Total stock value: <b>'+stMoney(stGrandTotal())+'</b> · '+stCountedCount()+' of '+stItems.length+' items counted.</p>';
      body.attachments=[{ filename:stExcelName(), content:XLSX.write(stExcelBook(), {type:'base64', bookType:'xlsx'}) }];
    } else {
      body.html=stReportHtml().html;
    }
    var r=await fetch(SUPABASE_URL+'/functions/v1/send-stock-take', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_KEY}, body:JSON.stringify(body) });
    var d=await r.json().catch(function(){return{};});
    if(r.ok){ var m=document.getElementById('st-send-modal'); if(m) m.remove(); toast('✓ Sent to Aung ('+(mode==='excel'?'Excel':'digital')+').'); }
    else if(statusEl){ statusEl.style.color='#7a1218'; statusEl.textContent='Send failed: '+(d.error||r.status); }
  }catch(e){ if(statusEl){ statusEl.style.color='#7a1218'; statusEl.textContent='Send failed: '+e.message; } }
}

// ── employee-ID gate / signed-in chip ──
function stGateHtml(){
  return stUser
    ? '<div class="st-who"><span><span style="color:#1d7a4a">●</span> Counting as <b>'+stEsc(stUser.name)+'</b> · #'+stEsc(stUser.emp_id)+'</span>'+
      '<button class="st-btn" style="flex:none" onclick="stSignOut()">Switch</button></div>'
    : '<div class="st-gate"><div><b>Enter your employee ID to count</b></div>'+
      '<div style="display:flex;gap:8px;margin-top:8px"><input class="st-input" id="st-empid" inputmode="numeric" placeholder="e.g. 1042" style="flex:1" onkeydown="if(event.key===\'Enter\')stSignIn()">'+
      '<button class="st-btn" style="flex:none" onclick="stSignIn()">Start</button></div></div>';
}

// ══ Excel upload — anyone with a valid employee ID loads the new month's list ══
function stLoadXLSX(){
  if(window.XLSX) return Promise.resolve();
  var url='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  if(typeof lazyLoad==='function') return lazyLoad(url);
  return new Promise(function(res,rej){ var s=document.createElement('script'); s.src=url; s.onload=res; s.onerror=rej; document.body.appendChild(s); });
}
// guess 'YYYY-MM' from a dd.mm.yyyy in the first rows (e.g. "as of 30.06.2026")
function stGuessMonth(rows){
  for(var r=0;r<Math.min(6,rows.length);r++){
    var line=(rows[r]||[]).join(' ');
    var m=line.match(/(\d{2})[.\/](\d{2})[.\/](\d{4})/);
    if(m) return m[3]+'-'+m[2];
  }
  var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function stShowUpload(){
  if(!stUser){ toast('Enter your employee ID first.', true); return; }
  var old=document.getElementById('st-up-modal'); if(old) old.remove();
  var box=document.createElement('div');
  box.id='st-up-modal'; box.className='st-modal';
  box.innerHTML='<div class="st-modal-box" onclick="event.stopPropagation()">'+
    '<div style="font-weight:700;color:#410207;margin-bottom:6px">Upload '+stEsc(stDeptLabel())+' stock take</div>'+
    '<div style="font-size:12px;color:#8a7a55;margin-bottom:10px">Pick the Excel file the cost controller sent (.xls or .xlsx). It becomes this month\'s '+stEsc(stDeptLabel())+' count sheet.</div>'+
    '<input type="file" id="st-up-file" accept=".xls,.xlsx" style="margin-bottom:10px" onchange="stUploadPreview()">'+
    '<label style="font-size:12px;color:#8a7a55">Month</label>'+
    '<input id="st-up-month" type="month" style="margin:4px 0 12px">'+
    '<div id="st-up-status" style="font-size:12px;color:#7a1218;min-height:16px;margin-bottom:8px"></div>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="st-btn" style="flex:none" onclick="document.getElementById(\'st-up-modal\').remove()">Cancel</button>'+
    '<button class="st-btn" style="flex:none" id="st-up-go" onclick="stHandleUpload()">Upload</button></div></div>';
  box.addEventListener('click', function(){ box.remove(); });
  document.body.appendChild(box);
  var d=new Date(); document.getElementById('st-up-month').value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
async function stUploadPreview(){
  var statusEl=document.getElementById('st-up-status');
  var f=document.getElementById('st-up-file').files[0]; if(!f) return;
  try{
    statusEl.style.color='#8a7a55'; statusEl.textContent='Reading…';
    await stLoadXLSX();
    var rows=stReadRows(await f.arrayBuffer());
    var guess=stGuessMonth(rows); var monthEl=document.getElementById('st-up-month'); if(guess) monthEl.value=guess;
    var items=stParseRows(rows);
    statusEl.textContent=items.length?(items.length+' items found for '+monthEl.value+'.'):'No items found — is this the right file?';
  }catch(e){ statusEl.style.color='#7a1218'; statusEl.textContent='Could not read: '+e.message; }
}
function stReadRows(buf){
  var wb=XLSX.read(new Uint8Array(buf), {type:'array'});
  var ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:''});
}
function stParseRows(rows){
  var hdr=-1;
  for(var r=0;r<rows.length;r++){
    var joined=(rows[r]||[]).join('|').toLowerCase();
    if(joined.indexOf('item group')>-1 && joined.indexOf('article')>-1){ hdr=r; break; }
  }
  var start=hdr>-1?hdr+1:0, items=[];
  for(var i=start;i<rows.length;i++){
    var c=rows[i]||[];
    var group=(c[0]==null?'':String(c[0])).trim();
    var code=(c[1]==null?'':String(c[1])).trim();
    var name=(c[2]==null?'':String(c[2])).trim();
    var unit=(c[3]==null?'':String(c[3])).trim();
    var price=Math.round((Number(c[4])||0)*100)/100;
    var isAlt=(code===''||code==='0')&&name==='';
    if(isAlt){ if(items.length) items[items.length-1].units.push({unit:unit,price:price}); continue; }
    if(name==='') continue;
    items.push({item_group:group,code:code,name:name,unit:unit,price:price,units:[{unit:unit,price:price}],sort_order:items.length+1});
  }
  return items;
}
async function stHandleUpload(){
  var statusEl=document.getElementById('st-up-status');
  var f=document.getElementById('st-up-file').files[0];
  if(!f){ statusEl.style.color='#7a1218'; statusEl.textContent='Choose a file first.'; return; }
  try{
    statusEl.style.color='#8a7a55'; statusEl.textContent='Reading file…';
    await stLoadXLSX();
    var rows=stReadRows(await f.arrayBuffer());
    var month=document.getElementById('st-up-month').value||stGuessMonth(rows);
    var items=stParseRows(rows);
    if(!items.length){ statusEl.style.color='#7a1218'; statusEl.textContent='No items found — is this the right file?'; return; }
    statusEl.textContent='Saving '+items.length+' items for '+month+'…';
    await stApplyUpload(month, items, f.name);
    var m=document.getElementById('st-up-modal'); if(m) m.remove();
    toast('✓ Loaded '+items.length+' '+stDeptLabel()+' items for '+month+'.');
  }catch(e){
    if(String(e.message)==='cancelled'){ statusEl.textContent='Cancelled.'; return; }
    statusEl.style.color='#7a1218'; statusEl.textContent='Upload failed: '+e.message;
  }
}
async function stApplyUpload(month, items, filename){
  var existing=await sb.from('stock_take_sheets').select('id').eq('venue_id',STOCK_VENUE).eq('dept',stDept).eq('month',month).limit(1);
  if(existing.data && existing.data.length){
    if(!confirm('A '+stDeptLabel()+' stock take for '+month+' already exists. Replacing it clears any counts already entered for that month. Continue?')) throw new Error('cancelled');
  }
  // supabase-js never throws — check each destructive step's .error and abort
  // BEFORE the next one, so a blocked delete can't leave the month half-wiped
  // (new items against stale counts = wrong totals shown as real).
  var dC=await sb.from('stock_take_counts').delete().eq('venue_id',STOCK_VENUE).eq('dept',stDept).eq('month',month);
  if(dC.error) throw new Error('Could not clear old counts: '+dC.error.message);
  var dI=await sb.from('stock_take_items').delete().eq('venue_id',STOCK_VENUE).eq('dept',stDept).eq('month',month);
  if(dI.error) throw new Error('Could not clear old items: '+dI.error.message);
  var dS=await sb.from('stock_take_sheets').delete().eq('venue_id',STOCK_VENUE).eq('dept',stDept).eq('month',month);
  if(dS.error) throw new Error('Could not clear old sheet: '+dS.error.message);
  var iS=await sb.from('stock_take_sheets').insert({ venue_id:STOCK_VENUE, dept:stDept, month:month, status:'counting', source_filename:filename, item_count:items.length, uploaded_by:stUser.emp_id, uploaded_by_name:stUser.name });
  if(iS.error) throw new Error('Could not create the sheet: '+iS.error.message);
  var rowsToInsert=items.map(function(it){ return { venue_id:STOCK_VENUE, dept:stDept, month:month, item_group:it.item_group, code:it.code, name:it.name, unit:it.unit, price:it.price, units:it.units, sort_order:it.sort_order, active:true }; });
  for(var i=0;i<rowsToInsert.length;i+=500){
    var res=await sb.from('stock_take_items').insert(rowsToInsert.slice(i,i+500));
    if(res.error) throw new Error(res.error.message);
  }
  stMonth=month; stUnitSel={};
  await stLoadItems(); await stLoadCounts(); await stLoadPrevMonth();
  stSubscribe(); stRender();
}

// ── load the current dept then render (called on mount + on dept switch) ──
async function stOpen(){
  stLoading = true; stRender();
  await stLoadSheet();
  await stLoadItems();
  await stLoadCounts();
  await stLoadPrevMonth();
  stSubscribe();
  stLoading = false;
  stRender();
}

// ── FOH tab integration ──────────────────────────────────────────────────
// renderMain() writes this STABLE shell once; this module owns everything inside
// it, so realtime ticks from other screens (which re-call renderMain) hit the
// identical-HTML cache and never rewrite #st-root mid-count.
var ST_SHELL = '<div id="st-root"></div>';
function renderStockTake(){
  Promise.resolve().then(stEnsureMounted);   // runs after renderMain writes the shell
  return ST_SHELL;
}
function stEnsureMounted(){
  var root=document.getElementById('st-root');
  if(!root || root.getAttribute('data-st')==='1') return;  // not on screen / already populated
  root.setAttribute('data-st','1');
  stInjectCss();
  stOpen();
}
