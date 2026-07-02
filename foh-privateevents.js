// ════════════════════════════════════════════════════════════════════════════
//  foh-privateevents.js — Events module (private events desk)
//  One event record generates every document Valentina used to retype:
//  coordination email, client menu, function sheet, plus the monthly group
//  report + calendar views that replace her tracking spreadsheets.
//  Libraries: chef's dishes + Manuel's beverage packages + package templates.
//  Tables: events_desk, event_items, event_log, event_dishes,
//          event_bev_packages, event_packages (all venue-tagged, RLS auth-only).
// ════════════════════════════════════════════════════════════════════════════

var peState = {
  loaded:false, loading:false,
  view:'list',            // list | calendar | event | library | report
  libTab:'dishes',        // dishes | bev | packages
  filter:'open',          // open | all | draft | sent | confirmed | deposit | done
  q:'',                   // search text on the events list
  fcFrom:null, fcTo:null, fcRun:false,
  currentId:null,
  month:null,             // YYYY-MM shown in calendar/report
  events:[], items:{},    // items: event_id -> [{id,dish_id,pcs_per_guest}]
  dishes:[], bevs:[], packs:[],
  log:{},                 // event_id -> log rows (loaded per event)
  aiDesc:null, aiBusy:false,
  editDishId:null, editBevId:null, editPackId:null
};

var PE_TEAM_CC = ['astellacci@robertos.ae','afalcone@robertos.ae','rmazouz@robertos.ae','reservations@robertos.ae','aviscardi@robertos.ae','kvukotic@robertos.ae','asacchi@skelmore.com'];
var PE_TARGETS = {
  cells: {'Vegetarian|Cold':7,'Fish|Cold':7,'Beef|Cold':6,'Vegetarian|Hot':7,'Fish|Hot':6,'Beef|Hot':7,'Dessert|Dessert':5},
  serve: {Cold:20, Hot:20, Dessert:5},
  tiers: {Classic:10, Elevated:25, Signature:10}
};
var peQuick = { qty:{}, title:'Canap\u00e9 selection', guests:'40' };

var PE_STATUS = [
  {k:'draft',     n:'Draft',          pill:'pe-p-draft'},
  {k:'sent',      n:'Proposal sent',  pill:'pe-p-sent'},
  {k:'confirmed', n:'Confirmed',      pill:'pe-p-conf'},
  {k:'deposit',   n:'Deposit paid',   pill:'pe-p-dep'},
  {k:'done',      n:'Event done',     pill:'pe-p-done'},
  {k:'lost',      n:'Lost',           pill:'pe-p-lost'}
];
var PE_AREAS = ['Restaurant','Scala bar & lounge','Scala lounge','Cortile terrace','Piemonte room','Private dining','Full venue'];
var PE_TYPES = ['Gathering','Private gathering','Dinner','Lunch','Reception','Full buyout'];
var PE_ALL_CODES = ['D','E','H','N','R','S','V'];
var PE_GROSS = 1.23585;   // 10% SC + 7% DIFC + 5% VAT compounding — net = gross / PE_GROSS
var PE_TIERS = [{n:'Classic',p:10},{n:'Elevated',p:20},{n:'Signature',p:35}];

function peStatusMeta(k){ for(var i=0;i<PE_STATUS.length;i++) if(PE_STATUS[i].k===k) return PE_STATUS[i]; return PE_STATUS[0]; }
function peEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function peMoney(n){ return n==null||isNaN(n) ? '—' : Math.round(Number(n)).toLocaleString('en-US'); }
function peToast(msg, bad){ if(typeof toast==='function') toast(msg, !!bad); else alert(msg); }
function peActor(){ return (state.access && state.access.name) || state.userEmail || 'unknown'; }
function peToday(){ return localISO(new Date()); }
function peMonthKey(d){ return String(d).slice(0,7); }
function peDishById(id){ for(var i=0;i<peState.dishes.length;i++) if(peState.dishes[i].id===id) return peState.dishes[i]; return null; }
function peBevById(id){ for(var i=0;i<peState.bevs.length;i++) if(peState.bevs[i].id===id) return peState.bevs[i]; return null; }
function peEvById(id){ for(var i=0;i<peState.events.length;i++) if(peState.events[i].id===id) return peState.events[i]; return null; }
function peDLabel(ds){ if(!ds) return '—'; var d=new Date(String(ds).slice(0,10)+'T12:00:00'); return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}); }

// ── data ─────────────────────────────────────────────────────────────────────
async function peLoadAll(force){
  if(peState.loading || (peState.loaded && !force)) return;
  peState.loading = true;
  try{
    var res = await Promise.all([
      sb.from('events_desk').select('*').order('event_date',{ascending:true}).limit(500),
      sb.from('event_items').select('*').limit(3000),
      sb.from('event_dishes').select('*').order('category').order('serve').order('name').limit(500),
      sb.from('event_bev_packages').select('*').order('name').limit(100),
      sb.from('event_packages').select('*').order('name').limit(100)
    ]);
    var bad = res.find(function(r){ return r.error; });
    if(bad) throw bad.error;
    peState.events = res[0].data||[];
    peState.items = {};
    (res[1].data||[]).forEach(function(it){ (peState.items[it.event_id]=peState.items[it.event_id]||[]).push(it); });
    peState.dishes = res[2].data||[];
    peState.bevs   = res[3].data||[];
    peState.packs  = res[4].data||[];
    peState.loaded = true;
  }catch(e){
    console.warn('[peLoadAll]', e);
    peToast('Events data did NOT load — check connection and try again.', true);
  }
  peState.loading = false;
  renderMain();
}
async function peLoadLog(eventId){
  try{
    var r = await sb.from('event_log').select('*').eq('event_id', eventId).order('created_at',{ascending:false}).limit(50);
    if(!r.error){ peState.log[eventId] = r.data||[]; renderMain(); }
  }catch(e){}
}
function peGo(view, id){
  peState.view = view;
  if(id !== undefined) peState.currentId = id;
  if(view==='event' && id) peLoadLog(id);
  renderMain();
  var mc = document.getElementById('main-content'); if(mc) mc.scrollTop = 0;
}

// ── styles (injected once) ───────────────────────────────────────────────────
(function(){
  var css = ''+
  '.pe-wrap{max-width:1080px;margin:0 auto}'+
  '.pe-kbar{display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px}'+
  '.pe-shell{display:flex;gap:18px;align-items:flex-start}'+
  '.pe-side{width:168px;flex-shrink:0;display:flex;flex-direction:column;gap:5px}'+
  '.pe-side .pe-btn{width:100%;box-sizing:border-box;text-align:center}'+
  '.pe-sdiv{border-top:1px solid rgba(107,31,42,0.15);margin:9px 6px}'+
  '.pe-snav{font-size:12.5px;padding:8px 12px;border-radius:8px;border:1px solid var(--vino);text-align:center;color:var(--vino);cursor:pointer}'+
  '.pe-snav:hover{background:rgba(107,31,42,0.07)}'+
  '.pe-snav.on{background:var(--vino);border-color:var(--vino);color:var(--cream);font-weight:600}'+
  '.pe-main{flex:1;min-width:0}'+
  '@media(max-width:820px){.pe-shell{display:block}.pe-side{width:auto;flex-direction:row;flex-wrap:wrap;align-items:center;margin-bottom:12px}.pe-side .pe-btn{width:auto}.pe-sdiv{display:none}.pe-snav{border:1px solid rgba(107,31,42,0.3);border-radius:14px;padding:6px 14px;font-size:12px}.pe-snav.on{border-color:var(--vino)}}'+
  '.pe-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px}'+
  '.pe-title{font-family:\'Playfair Display\',serif;font-size:22px;color:var(--vino-dark)}'+
  '.pe-tabs{display:flex;gap:6px;flex-wrap:wrap}'+
  '.pe-tab{font-size:12px;padding:6px 14px;border-radius:14px;border:1px solid rgba(107,31,42,0.3);color:var(--vino);cursor:pointer;background:transparent}'+
  '.pe-tab.on{background:var(--vino);color:var(--cream)}'+
  '.pe-tab.staff{border-color:#C9A84C;color:#8A6A4F}'+
  '.pe-tab.staff.on{background:#8A6A4F;border-color:#8A6A4F;color:#FBF7F1}'+
  '.pe-btn{font-size:12.5px;padding:8px 14px;border-radius:8px;border:1px solid var(--vino);background:var(--vino);color:var(--cream);cursor:pointer}'+
  '.pe-btn.sec{background:transparent;color:var(--vino)}'+
  '.pe-btn.sm{padding:5px 10px;font-size:11.5px}'+
  '.pe-btn:disabled{opacity:.5;cursor:default}'+
  '.pe-card{background:#fff;border:1px solid rgba(107,31,42,0.16);border-radius:12px;padding:14px 16px;margin-bottom:12px}'+
  '.pe-row{display:grid;grid-template-columns:1.5fr 1.2fr 0.5fr 0.9fr 1fr;gap:8px;padding:10px 4px;border-bottom:1px solid rgba(107,31,42,0.1);align-items:center;cursor:pointer}'+
  '.pe-row:hover{background:var(--cream)}'+
  '.pe-pill{font-size:11px;padding:3px 10px;border-radius:10px;display:inline-block;white-space:nowrap}'+
  '.pe-p-draft{background:#F1EDE6;color:#6B5E4E;border:1px solid #D8CDBB}'+
  '.pe-p-sent{background:#FAF0DA;color:#8A6400;border:1px solid #E8CE92}'+
  '.pe-p-conf{background:#E7F0E4;color:#2E6B34;border:1px solid #BAD5B5}'+
  '.pe-p-dep{background:#E4EDF5;color:#1F5580;border:1px solid #B7CFE3}'+
  '.pe-p-done{background:#EDEDED;color:#555;border:1px solid #D5D5D5}'+
  '.pe-p-lost{background:#F7E6E6;color:#933;border:1px solid #E3BFBF}'+
  '.pe-lbl{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8B7355;margin:0 0 3px}'+
  '.pe-in{width:100%;font-size:13px;padding:7px 9px;border:1px solid rgba(107,31,42,0.25);border-radius:7px;background:#fff;color:#2C1810;box-sizing:border-box}'+
  'select.pe-in{height:33px}'+
  '.pe-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}'+
  '.pe-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}'+
  '.pe-2col{display:grid;grid-template-columns:1.2fr .8fr;gap:14px;align-items:start}'+
  '.pe-dishrow{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(107,31,42,0.08);font-size:12.5px}'+
  '.pe-x{color:#B00020;cursor:pointer;font-size:14px;padding:0 4px}'+
  '.pe-tot{background:#F7EEE2;border-radius:10px;padding:13px 14px}'+
  '.pe-tot-row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#6B4A33}'+
  '.pe-tot-row b{color:#400207}'+
  '.pe-flag{display:flex;gap:6px;align-items:flex-start;font-size:12px;padding:4px 0}'+
  '.pe-chip{font-size:11px;border:1px solid rgba(107,31,42,0.3);border-radius:10px;padding:3px 9px;cursor:pointer;display:inline-block;margin:0 4px 4px 0;color:var(--vino)}'+
  '.pe-chip.on{background:var(--vino);color:var(--cream)}'+
  '.pe-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}'+
  '.pe-cal-h{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#8B7355;text-align:center;padding:4px 0}'+
  '.pe-cal-d{min-height:74px;background:#fff;border:1px solid rgba(107,31,42,0.12);border-radius:8px;padding:4px 5px;font-size:11px}'+
  '.pe-cal-d.dim{opacity:.4}'+
  '.pe-cal-d.today{border-color:var(--vino);border-width:2px}'+
  '.pe-cal-n{color:#8B7355;font-size:10px;margin-bottom:2px}'+
  '.pe-cal-ev{border-radius:5px;padding:2px 5px;margin-bottom:2px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}'+
  '.pe-log{font-size:12px;padding:6px 0;border-bottom:1px solid rgba(107,31,42,0.08)}'+
  '.pe-log .t{color:#8B7355;font-size:10.5px}'+
  '.pe-modal-bg{position:fixed;inset:0;background:rgba(44,24,16,0.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px}'+
  '.pe-modal{background:#FBF7F1;border-radius:14px;max-width:640px;width:100%;max-height:86vh;overflow-y:auto;padding:18px 20px}'+
  '.pe-steps{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}'+
  '.pe-step{font-size:11px;padding:4px 11px;border-radius:11px;border:1px solid rgba(107,31,42,0.25);color:#8B7355;cursor:pointer}'+
  '.pe-step.cur{background:var(--vino);color:var(--cream);border-color:var(--vino)}'+
  '.pe-report{width:100%;border-collapse:collapse;font-size:11.5px}'+
  '.pe-report th{background:var(--vino);color:var(--cream);padding:6px 7px;text-align:left;font-weight:600;font-size:10.5px;letter-spacing:.03em}'+
  '.pe-report td{padding:6px 7px;border-bottom:1px solid rgba(107,31,42,0.12);vertical-align:top}'+
  '@media(max-width:700px){.pe-2col{grid-template-columns:1fr}.pe-grid3{grid-template-columns:1fr 1fr}.pe-row{grid-template-columns:1.4fr 1fr 0.9fr}.pe-row .pe-hide-m{display:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();

// ── main render ──────────────────────────────────────────────────────────────
function renderPrivateEvents(){
  if(!peState.loaded){ peLoadAll(); return '<div class="loading">Loading events…</div>'; }
  var v = peState.view;
  if(v==='event')    return peRenderEvent();
  if(v==='quick')    return peRenderQuick();
  if(v==='calendar') return peRenderCalendar();
  if(v==='chef')     return peRenderChefCorner();
  if(v==='bev')      return peRenderBevCorner();
  if(v==='packs')    return peRenderPacksView();
  if(v==='library')  return peRenderChefCorner();
  if(v==='report')   return peRenderReport();
  return peRenderList();
}
function peHeader(active){
  var left = [['list','Events'],['calendar','Calendar'],['report','Monthly report'],['packs','Menu packages']];
  var right = [['chef','Chef corner'],['bev','Beverage corner']];
  return '<div class="pe-wrap">'+
    '<div class="pe-kbar">'+
    '<span style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#A88930;margin-right:2px">Kitchen &amp; bar</span>'+
    right.map(function(t){
      return '<span class="pe-tab staff'+(active===t[0]?' on':'')+'" onclick="peGo(\''+t[0]+'\')">'+t[1]+'</span>';
    }).join('')+'</div>'+
    '<div class="pe-shell">'+
    '<div class="pe-side">'+
      '<button class="pe-btn" onclick="peNewEvent()">+ New event</button>'+
      '<button class="pe-btn sec" onclick="peQuick.qty={};peGo(\'quick\')">Quick menu</button>'+
      '<button class="pe-btn sec" onclick="peCopyGuestLink()">Guest link</button>'+
      '<div class="pe-sdiv"></div>'+
    left.map(function(t){
      return '<span class="pe-snav'+(active===t[0]?' on':'')+'" onclick="peGo(\''+t[0]+'\')">'+t[1]+'</span>';
    }).join('')+
    '</div>'+
    '<div class="pe-main">';
}
var PE_FOOT = '</div></div></div>';

// ── list view ────────────────────────────────────────────────────────────────
function peFilteredEvents(){
  var f = peState.filter, q = (peState.q||'').toLowerCase();
  return peState.events.filter(function(e){
    if(q && String((e.client_name||'')+' '+(e.company||'')+' '+(e.contact_name||'')).toLowerCase().indexOf(q)<0) return false;
    if(f==='all') return true;
    if(f==='open') return ['draft','sent','confirmed','deposit'].indexOf(e.status)>=0;
    return e.status===f;
  });
}
function peRenderList(){
  var evs = peFilteredEvents().slice().sort(function(a,b){ return String(a.event_date||'9999').localeCompare(String(b.event_date||'9999')); });
  var filters = [['open','Open'],['draft','Draft'],['sent','Sent'],['confirmed','Confirmed'],['deposit','Deposit paid'],['done','Done'],['all','All']];
  var pipeline = 0;
  evs.forEach(function(e){ var t = peEventValue(e); if(t && ['draft','sent','confirmed','deposit'].indexOf(e.status)>=0) pipeline += t; });
  var h = peHeader('list');
  h += '<div class="pe-card">';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;border-bottom:1px solid rgba(107,31,42,0.1);padding-bottom:10px;margin-bottom:4px">'+filters.map(function(f){
    return '<span class="pe-tab'+(peState.filter===f[0]?' on':'')+'" style="font-size:11px;padding:4px 11px" onclick="peState.filter=\''+f[0]+'\';renderMain()">'+f[1]+'</span>';
  }).join('')+
  '<input class="pe-in" style="width:190px;margin-left:auto" placeholder="Search client or company\u2026" value="'+peEsc(peState.q||'')+'" oninput="peState.q=this.value;renderMain();var el=document.querySelectorAll(\'input[placeholder^=Search]\')[0];if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}">'+
  '</div>';
  if(!evs.length){
    h += '<div style="text-align:center;padding:26px;color:#8B7355;font-size:13px">No events here yet. Tap “+ New event” to start a quotation.</div>';
  } else {
    h += evs.map(function(e){
      var m = peStatusMeta(e.status);
      var val = peEventValue(e);
      return '<div class="pe-row" onclick="peGo(\'event\',\''+e.id+'\')">'+
        '<div><div style="font-size:13px;font-weight:600;color:#2C1810">'+peEsc(e.client_name||e.company||'Unnamed')+'</div>'+
        '<div style="font-size:11px;color:#8B7355">'+peEsc(e.company&&e.client_name?e.company:(e.event_type||''))+'</div></div>'+
        '<div style="font-size:12px;color:#6B4A33">'+peDLabel(e.event_date)+(e.time_from?' · '+peEsc(e.time_from):'')+'<br><span style="font-size:11px;color:#8B7355">'+peEsc(e.area||'')+'</span></div>'+
        '<div class="pe-hide-m" style="text-align:center;font-size:13px;color:#6B4A33">'+(e.guests||'—')+'</div>'+
        '<div class="pe-hide-m" style="text-align:right;font-size:13px;color:#2C1810">'+(val?('AED '+peMoney(val)):'—')+'</div>'+
        '<div style="text-align:right"><span class="pe-pill '+m.pill+'">'+m.n+'</span></div>'+
      '</div>';
    }).join('');
  }
  h += '</div>';
  h += '<div style="font-size:11.5px;color:#8B7355;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px"><span>'+evs.length+' events shown</span><span>Open pipeline value: AED '+peMoney(pipeline)+'</span></div>';
  return h+PE_FOOT;
}
function peEventValue(e){
  var t = peCalcTotals(e);
  if(t.total) return t.total;
  return e.min_spend ? Number(e.min_spend) : null;
}

// ── calendar view ────────────────────────────────────────────────────────────
function peRenderCalendar(){
  if(!peState.month) peState.month = peMonthKey(peToday());
  var mk = peState.month;
  var y = +mk.slice(0,4), mo = +mk.slice(5,7);
  var first = new Date(y, mo-1, 1);
  var startDow = (first.getDay()+6)%7;      // Monday-first
  var days = new Date(y, mo, 0).getDate();
  var byDate = {};
  peState.events.forEach(function(e){
    if(e.event_date && peMonthKey(e.event_date)===mk) (byDate[String(e.event_date).slice(0,10)]=byDate[String(e.event_date).slice(0,10)]||[]).push(e);
  });
  var mLbl = first.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  var h = peHeader('calendar');
  h += '<div class="pe-top" style="margin-bottom:8px"><button class="pe-btn sec sm" onclick="peCalShift(-1)">‹ Prev</button>'+
       '<div class="pe-title" style="font-size:17px">'+mLbl+'</div>'+
       '<button class="pe-btn sec sm" onclick="peCalShift(1)">Next ›</button></div>';
  h += '<div class="pe-cal">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(d){ return '<div class="pe-cal-h">'+d+'</div>'; }).join('');
  for(var i=0;i<startDow;i++) h += '<div class="pe-cal-d dim"></div>';
  var today = peToday();
  var pillColors = {draft:'#F1EDE6;color:#6B5E4E', sent:'#FAF0DA;color:#8A6400', confirmed:'#E7F0E4;color:#2E6B34', deposit:'#E4EDF5;color:#1F5580', done:'#EDEDED;color:#555', lost:'#F7E6E6;color:#933'};
  for(var d=1; d<=days; d++){
    var ds = y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var evs = byDate[ds]||[];
    h += '<div class="pe-cal-d'+(ds===today?' today':'')+'"><div class="pe-cal-n">'+d+'</div>'+
      evs.map(function(e){
        return '<div class="pe-cal-ev" style="background:'+(pillColors[e.status]||pillColors.draft)+'" onclick="peGo(\'event\',\''+e.id+'\')" title="'+peEsc(e.client_name||e.company||'')+'">'+peEsc((e.client_name||e.company||'?'))+(e.guests?' · '+e.guests:'')+'</div>';
      }).join('')+'</div>';
  }
  h += '</div>';
  h += '<div style="font-size:11px;color:#8B7355;margin-top:8px">Tap an event to open it. Colors follow the status pills.</div>';
  return h+PE_FOOT;
}
function peCalShift(n){
  var y = +peState.month.slice(0,4), mo = +peState.month.slice(5,7)-1+n;
  var d = new Date(y, mo, 1);
  peState.month = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  renderMain();
}

// ── event editor ─────────────────────────────────────────────────────────────
async function peNewEvent(){
  var row = { venue_id:'robertos-difc', status:'draft', updated_by:peActor(), payment_terms:'50% deposit to confirm, balance on the day' };
  var r = await sb.from('events_desk').insert(row).select().single();
  if(r.error || !r.data){ peToast('Could not create the event — check connection.', true); return; }
  peState.events.push(r.data);
  await sb.from('event_log').insert({event_id:r.data.id, action:'created', actor:peActor()});
  peGo('event', r.data.id);
}
function peCalcTotals(e){
  var items = peState.items[e.id]||[];
  var foodComputed = 0, cost = 0, pcs = 0, missing = [];
  items.forEach(function(it){
    var d = peDishById(it.dish_id); if(!d) return;
    var p = Number(it.pcs_per_guest)||0;
    foodComputed += (Number(d.sell_price)||0)*p;
    cost += (Number(d.cost)||0)*p;
    pcs += p;
    if(!(d.allergens||[]).length && d.category!=='Dessert') missing.push(d.name);
  });
  var foodPP = (e.food_price_pp!=null && e.food_price_pp!=='') ? Number(e.food_price_pp) : (foodComputed||null);
  var bev = e.bev_package_id ? peBevById(e.bev_package_id) : null;
  var bevPP = bev ? Number(bev.price_pp) : 0;
  var perGuest = (foodPP||0)+bevPP;
  var total = e.guests ? perGuest*Number(e.guests) : null;
  var foodCostPct = foodPP ? (cost/(foodPP/PE_GROSS))*100 : null;
  return { foodComputed:foodComputed, foodPP:foodPP, bevPP:bevPP, perGuest:perGuest, total:total,
           pcs:pcs, foodCostPct:foodCostPct, missingAllergens:missing, items:items };
}
function peRenderEvent(){
  var e = peEvById(peState.currentId);
  if(!e) return peHeader('list')+'<div class="pe-card">Event not found.</div>'+PE_FOOT;
  var t = peCalcTotals(e);
  var m = peStatusMeta(e.status);
  var log = peState.log[e.id]||[];
  var h = '<div class="pe-wrap">';
  h += '<div class="pe-top"><span class="pe-tab" onclick="peGo(\'list\')">‹ All events</span>'+
       '<span class="pe-pill '+m.pill+'" style="font-size:12px">'+m.n+'</span></div>';

  // status stepper
  h += '<div class="pe-steps">'+PE_STATUS.filter(function(s){return s.k!=='lost';}).map(function(s){
    return '<span class="pe-step'+(e.status===s.k?' cur':'')+'" onclick="peSetStatus(\''+e.id+'\',\''+s.k+'\')">'+s.n+'</span>';
  }).join('')+'<span class="pe-step'+(e.status==='lost'?' cur':'')+'" style="margin-left:auto" onclick="peSetStatus(\''+e.id+'\',\'lost\')">Lost</span></div>';
  if(e.status==='lost'){
    var lr = null;
    log.forEach(function(l){ if(!lr && l.action==='lost') lr = String(l.detail||'').replace(/^.*?→ lost — /,''); });
    if(!lr && peState.lostReasons) lr = peState.lostReasons[e.id];
    h += '<div style="font-size:12px;color:#933;margin:-4px 0 10px">Lost — '+peEsc(lr||'reason not recorded')+'</div>';
  }

  // facts
  h += '<div class="pe-card"><div class="pe-grid3">'+
    peIn('Client / booking name','client_name',e)+peIn('Company','company',e)+peSel('Type of event','event_type',e,PE_TYPES)+
    peIn('Date','event_date',e,'date')+peIn('From (e.g. 6:30 pm)','time_from',e)+peIn('To','time_to',e)+
    peSel('Venue / area','area',e,PE_AREAS)+peIn('Guests (pax)','guests',e,'number')+peIn('Minimum spend (AED)','min_spend',e,'number')+
    peIn('Contact name','contact_name',e)+peIn('Contact phone','contact_phone',e)+peIn('Contact email','contact_email',e)+
  '</div><div class="pe-grid2" style="margin-top:10px">'+
    peIn('Dietary requirements','dietary',e)+peIn('Payment terms','payment_terms',e)+
  '</div>'+
  '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="pe-btn" onclick="peSaveEvent(\''+e.id+'\')">Save details</button>'+
  '<button class="pe-btn sec" onclick="peDeleteEvent(\''+e.id+'\')"'+(e.status==='draft'?'':' disabled')+'>Delete draft</button></div></div>';

  // 2col: food+bev | totals+actions
  h += '<div class="pe-2col"><div>';
  // food
  h += '<div class="pe-card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px">'+
    '<b style="font-size:14px;color:#400207">Food</b>'+
    '<span><select class="pe-in" style="width:auto;display:inline-block" id="pe-pack-sel">'+
      '<option value="">Start from a package…</option>'+
      peState.packs.map(function(p){ return '<option value="'+p.id+'">'+peEsc(p.name)+' — AED '+peMoney(p.price_pp)+'/guest</option>'; }).join('')+
    '</select> <button class="pe-btn sec sm" onclick="peApplyPackage(\''+e.id+'\')">Apply</button></span></div>';
  h += '<div class="pe-lbl">Package label on documents (free text — set menus welcome)</div>'+
       '<input class="pe-in" id="pe-f-package_label" value="'+peEsc(e.package_label||'')+'" placeholder="e.g. Canape Cortile · or Set Menu Mare 440">';
  h += '<div style="display:flex;gap:10px;margin-top:8px;align-items:end"><div style="flex:1"><div class="pe-lbl">Food price / guest (AED) — leave blank to use the dishes total</div>'+
       '<input class="pe-in" id="pe-f-food_price_pp" type="number" value="'+(e.food_price_pp!=null?peEsc(e.food_price_pp):'')+'" placeholder="auto: '+peMoney(t.foodComputed)+'"></div></div>';
  h += '<div style="margin-top:10px">'+ (t.items.length ? t.items.map(function(it){
      var d = peDishById(it.dish_id); if(!d) return '';
      return '<div class="pe-dishrow"><span>'+peEsc(d.name)+' <span style="color:#A5876B;font-size:10.5px">('+peEsc((d.allergens||[]).join(')(')||'–')+')</span>'+
        ((d.allergens||[]).length||d.category==='Dessert'?'':' <span class="pe-pill pe-p-sent" style="font-size:10px">no allergens set</span>')+'</span>'+
        '<span style="display:flex;align-items:center;gap:6px;flex-shrink:0"><input class="pe-in" style="width:52px;padding:3px 6px" type="number" step="0.5" value="'+it.pcs_per_guest+'" onchange="peSetPcs(\''+it.id+'\',this.value)"> pc/guest'+
        '<span class="pe-x" onclick="peRemoveItem(\''+it.id+'\')">✕</span></span></div>';
    }).join('') : '<div style="font-size:12px;color:#8B7355;padding:6px 0">No dishes yet — apply a package or add from the library.</div>');
  h += '<button class="pe-btn sec sm" style="margin-top:8px" onclick="peOpenDishPicker(\''+e.id+'\')">+ Add dish from library</button></div></div>';
  // beverage
  h += '<div class="pe-card"><b style="font-size:14px;color:#400207">Beverage</b>'+
    '<div style="margin-top:8px"><select class="pe-in" id="pe-f-bev_package_id" onchange="peSaveField(\''+e.id+'\',\'bev_package_id\',this.value||null)">'+
      '<option value="">No beverage package</option>'+
      peState.bevs.map(function(b){ return '<option value="'+b.id+'"'+(e.bev_package_id===b.id?' selected':'')+'>'+peEsc(b.name)+' — '+(b.duration_hours?b.duration_hours+'h — ':'')+'AED '+peMoney(b.price_pp)+'/guest</option>'; }).join('')+
    '</select>'+
    (e.bev_package_id && peBevById(e.bev_package_id) ? '<div style="font-size:11.5px;color:#8B7355;margin-top:6px">'+peEsc(peBevById(e.bev_package_id).includes||'')+'</div>' : '')+
    '</div></div>';
  // follow-ups
  h += '<div class="pe-card"><b style="font-size:14px;color:#400207">Follow-up log</b>'+
    '<div style="display:flex;gap:6px;margin:8px 0"><input class="pe-in" id="pe-fu-note" placeholder="e.g. Called Ramona — waiting on final pax"><button class="pe-btn sm" onclick="peAddFollowup(\''+e.id+'\')">Add</button></div>'+
    (log.length ? log.map(function(l){
      var d = new Date(l.created_at);
      return '<div class="pe-log"><span class="t">'+d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})+' · '+peEsc(l.actor||'')+'</span><br>'+peEsc(l.action==='followup'?(l.detail||''):(l.action+(l.detail?' — '+l.detail:'')))+'</div>';
    }).join('') : '<div style="font-size:12px;color:#8B7355">Nothing logged yet.</div>')+'</div>';
  h += '</div><div>';
  // totals
  h += '<div class="pe-tot">'+
    '<div class="pe-lbl" style="color:#8A6A4F">Live totals</div>'+
    '<div class="pe-tot-row"><span>Food / guest</span><b>AED '+peMoney(t.foodPP||0)+(e.food_price_pp!=null&&e.food_price_pp!==''?' (set)':'')+'</b></div>'+
    '<div class="pe-tot-row"><span>Beverage / guest</span><b>AED '+peMoney(t.bevPP)+'</b></div>'+
    '<div class="pe-tot-row" style="border-top:1px solid #DCC9B2;margin-top:4px;padding-top:7px"><span>Per guest</span><b>AED '+peMoney(t.perGuest)+'</b></div>'+
    '<div class="pe-tot-row"><span>× '+(e.guests||'—')+' guests</span><b>AED '+peMoney(t.total)+'</b></div>';
  if(e.min_spend && t.total!=null){
    var gap = Number(e.min_spend)-t.total;
    h += gap>0 ? '<div class="pe-flag" style="color:#7A5500">▲ AED '+peMoney(gap)+' below the '+peMoney(e.min_spend)+' min spend</div>'
               : '<div class="pe-flag" style="color:#2E5B30">✓ Min spend covered</div>';
  }
  if(t.foodCostPct!=null){
    h += '<div class="pe-flag" style="color:'+(t.foodCostPct<=27?'#2E5B30':'#7A5500')+'">'+(t.foodCostPct<=27?'✓':'▲')+' Food cost '+t.foodCostPct.toFixed(1)+'%'+(t.foodCostPct<=27?' — on target':' — above 25% target')+'</div>';
  }
  if(t.pcs){
    h += '<div class="pe-flag" style="color:'+(t.pcs>=8&&t.pcs<=12?'#2E5B30':'#7A5500')+'">'+(t.pcs>=8&&t.pcs<=12?'✓':'▲')+' '+t.pcs+' pieces / guest'+(t.pcs<8?' — below 8–12 norm':(t.pcs>12?' — above 8–12 norm':''))+'</div>';
  }
  if(t.missingAllergens.length){
    h += '<div class="pe-flag" style="color:#B00020">▲ Allergens missing: '+peEsc(t.missingAllergens.join(', '))+'</div>';
  }
  h += '</div>';
  // documents & actions
  h += '<div class="pe-card" style="margin-top:12px"><b style="font-size:14px;color:#400207">Documents</b>'+
    '<div style="display:flex;flex-direction:column;gap:7px;margin-top:9px">'+
    '<button class="pe-btn" onclick="pePrintProposal(\''+e.id+'\')">Client menu / proposal</button>'+
    '<button class="pe-btn sec" onclick="pePrintFunctionSheet(\''+e.id+'\')">Function sheet</button>'+
    '<button class="pe-btn sec" onclick="peSendCoordEmail(\''+e.id+'\')">Coordination email\u2026</button>'+
    '<button class="pe-btn sec" onclick="peEmailProposal(\''+e.id+'\')"'+(e.contact_email?'':' disabled title="No client email on the event"')+'>Email proposal to client</button>'+
    '<button class="pe-btn sec" onclick="peWhatsApp(\''+e.id+'\')"'+(e.contact_phone?'':' disabled title="No phone on the event"')+'>WhatsApp the client</button>'+
    '<button class="pe-btn sec" onclick="peCopyClientLink(\''+e.id+'\')">Copy client selection link</button>'+
    (e.client_selection ? '<div style="font-size:11.5px;color:#2E6B34;background:#E7F0E4;border-radius:8px;padding:8px 10px">Client picked '+((e.client_selection.dish_ids||[]).length)+' dishes'+(e.client_selection.note?' · “'+peEsc(e.client_selection.note)+'”':'')+' <span style="text-decoration:underline;cursor:pointer" onclick="peApplyClientSelection(\''+e.id+'\')">apply to event</span></div>' : '')+
    '</div></div>';
  h += '</div></div>';
  return h+'</div>';
}
function peIn(lbl, field, e, type){
  var v = e[field];
  if(type==='date') v = v ? String(v).slice(0,10) : '';
  return '<div><div class="pe-lbl">'+lbl+'</div><input class="pe-in" id="pe-f-'+field+'" type="'+(type||'text')+'" value="'+peEsc(v==null?'':v)+'"></div>';
}
function peSel(lbl, field, e, opts){
  return '<div><div class="pe-lbl">'+lbl+'</div><select class="pe-in" id="pe-f-'+field+'">'+
    '<option value=""></option>'+opts.map(function(o){ return '<option'+(e[field]===o?' selected':'')+'>'+o+'</option>'; }).join('')+
  '</select></div>';
}
async function peSaveEvent(id){
  var e = peEvById(id); if(!e) return;
  var fields = ['client_name','company','event_type','event_date','time_from','time_to','area','guests','min_spend','contact_name','contact_phone','contact_email','dietary','payment_terms','package_label','food_price_pp'];
  var patch = { updated_by:peActor(), updated_at:new Date().toISOString() };
  fields.forEach(function(f){
    var el = document.getElementById('pe-f-'+f); if(!el) return;
    var v = el.value.trim();
    if(f==='guests') v = v ? parseInt(v,10) : null;
    else if(f==='min_spend'||f==='food_price_pp') v = v ? Number(v) : null;
    else v = v || null;
    patch[f] = v;
  });
  var r = await sb.from('events_desk').update(patch).eq('id', id);
  if(r.error){ peToast('NOT saved — '+(r.error.message||'check connection'), true); return; }
  Object.keys(patch).forEach(function(k){ e[k] = patch[k]; });
  peToast('Saved ✓');
  renderMain();
}
async function peSaveField(id, field, value){
  var e = peEvById(id); if(!e) return;
  var patch = {}; patch[field] = value; patch.updated_at = new Date().toISOString();
  var r = await sb.from('events_desk').update(patch).eq('id', id);
  if(r.error){ peToast('NOT saved — check connection', true); return; }
  e[field] = value; renderMain();
}
async function peDeleteEvent(id){
  var e = peEvById(id); if(!e || e.status!=='draft') return;
  if(!confirm('Delete this draft event? This cannot be undone.')) return;
  var r = await sb.from('events_desk').delete().eq('id', id);
  if(r.error){ peToast('Delete failed — check connection', true); return; }
  peState.events = peState.events.filter(function(x){ return x.id!==id; });
  peToast('Draft deleted');
  peGo('list');
}
async function peSetStatus(id, status){
  var e = peEvById(id); if(!e || e.status===status) return;
  if(status==='lost'){ peAskLostReason(id); return; }
  var was = e.status;
  var r = await sb.from('events_desk').update({status:status, updated_by:peActor(), updated_at:new Date().toISOString()}).eq('id', id);
  if(r.error){ peToast('Status NOT changed — check connection', true); return; }
  e.status = status;
  sb.from('event_log').insert({event_id:id, action:'status', detail:was+' → '+status, actor:peActor()}).then(function(){ peLoadLog(id); });
  renderMain();
  if(status==='confirmed'){
    peToast('Confirmed — the kitchen and hostess can now see this event. Send the coordination email from Documents.');
  }
}
var PE_LOST_REASONS = ['Price too high','Date not available','Chose another venue','No response','Guest cancelled'];
function peAskLostReason(id){
  var bg = document.createElement('div'); bg.className='pe-modal-bg';
  bg.addEventListener('click', function(ev){ if(ev.target===bg) bg.remove(); });
  bg.innerHTML = '<div class="pe-modal" style="max-width:440px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="color:#400207">Mark as lost — what happened?</b><span class="pe-x" onclick="this.closest(\'.pe-modal-bg\').remove()">✕</span></div>'+
    '<div style="margin-bottom:8px">'+PE_LOST_REASONS.map(function(r){
      return '<span class="pe-chip" onclick="var p=this.parentNode;p.querySelectorAll(\'.pe-chip\').forEach(function(c){c.classList.remove(\'on\')});this.classList.add(\'on\')">'+r+'</span>';
    }).join('')+'</div>'+
    '<div class="pe-lbl">More detail (optional when a reason above is picked)</div>'+
    '<textarea class="pe-in" id="pe-lost-note" rows="2" placeholder="e.g. their budget was AED 150 per guest"></textarea>'+
    '<div style="display:flex;gap:8px;margin-top:10px"><button class="pe-btn" onclick="peConfirmLost(\''+id+'\')">Mark as lost</button>'+
    '<button class="pe-btn sec" onclick="this.closest(\'.pe-modal-bg\').remove()">Cancel</button></div></div>';
  document.body.appendChild(bg);
}
async function peConfirmLost(id){
  var bg = document.querySelector('.pe-modal-bg'); if(!bg) return;
  var chip = bg.querySelector('.pe-chip.on');
  var note = (bg.querySelector('#pe-lost-note')||{value:''}).value.trim();
  var reason = [chip?chip.textContent:'', note].filter(Boolean).join(' — ');
  if(!reason){ peToast('Pick a reason or write one — it helps us learn', true); return; }
  var e = peEvById(id); var was = e ? e.status : '';
  var r = await sb.from('events_desk').update({status:'lost', updated_by:peActor(), updated_at:new Date().toISOString()}).eq('id', id);
  if(r.error){ peToast('Status NOT changed — check connection', true); return; }
  if(e) e.status = 'lost';
  if(peState.lostReasons) peState.lostReasons[id] = reason;
  bg.remove();
  sb.from('event_log').insert({event_id:id, action:'lost', detail:(was?was+' → lost — ':'')+reason.slice(0,300), actor:peActor()}).then(function(){ peLoadLog(id); });
  peToast('Marked as lost — reason saved');
  renderMain();
}
async function peLoadLostReasons(){
  if(peState.lostReasons) return;
  peState.lostReasons = {};
  var r = await sb.from('event_log').select('event_id,detail,created_at').eq('action','lost').order('created_at',{ascending:true});
  if(!r.error && r.data && r.data.length){
    r.data.forEach(function(l){ peState.lostReasons[l.event_id] = String(l.detail||'').replace(/^.*?→ lost — /,''); });
    renderMain();
  }
}
async function peAddFollowup(id){
  var el = document.getElementById('pe-fu-note'); if(!el || !el.value.trim()) return;
  var r = await sb.from('event_log').insert({event_id:id, action:'followup', detail:el.value.trim().slice(0,500), actor:peActor()});
  if(r.error){ peToast('Note NOT saved — check connection', true); return; }
  el.value=''; peLoadLog(id);
}

// ── dishes on an event ───────────────────────────────────────────────────────
async function peApplyPackage(eventId){
  var sel = document.getElementById('pe-pack-sel'); if(!sel || !sel.value) return;
  var pack = null; peState.packs.forEach(function(p){ if(p.id===sel.value) pack=p; });
  if(!pack) return;
  var existing = (peState.items[eventId]||[]).map(function(i){ return i.dish_id; });
  var toAdd = (pack.dish_ids||[]).filter(function(d){ return existing.indexOf(d)<0; })
    .map(function(d){ return {event_id:eventId, dish_id:d, pcs_per_guest:1}; });
  if(toAdd.length){
    var r = await sb.from('event_items').insert(toAdd).select();
    if(r.error){ peToast('Package NOT applied — check connection', true); return; }
    peState.items[eventId] = (peState.items[eventId]||[]).concat(r.data||[]);
  }
  await peSaveField(eventId, 'package_label', pack.name);
  await peSaveField(eventId, 'food_price_pp', Number(pack.price_pp));
  peToast('Package applied — adjust dishes freely');
}
function peOpenDishPicker(eventId){
  var existing = (peState.items[eventId]||[]).map(function(i){ return i.dish_id; });
  var cats = {};
  peState.dishes.filter(function(d){ return d.active && existing.indexOf(d.id)<0; })
    .forEach(function(d){ (cats[d.category+' · '+d.serve]=cats[d.category+' · '+d.serve]||[]).push(d); });
  var h = '<div class="pe-modal-bg" onclick="if(event.target===this)this.remove()"><div class="pe-modal">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="color:#400207">Add dishes</b><span class="pe-x" onclick="this.closest(\'.pe-modal-bg\').remove()">✕</span></div>';
  Object.keys(cats).forEach(function(k){
    h += '<div class="pe-lbl" style="margin-top:8px">'+peEsc(k)+'</div>'+cats[k].map(function(d){
      return '<div class="pe-dishrow"><span>'+peEsc(d.name)+' <span style="color:#A5876B;font-size:10.5px">'+peEsc(d.description||'')+'</span></span>'+
        '<button class="pe-btn sm" onclick="peAddItem(\''+eventId+'\',\''+d.id+'\');this.disabled=true;this.textContent=\'Added ✓\'">Add</button></div>';
    }).join('');
  });
  if(!Object.keys(cats).length) h += '<div style="font-size:12px;color:#8B7355">Every active dish is already on this event.</div>';
  h += '</div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}
async function peAddItem(eventId, dishId){
  var r = await sb.from('event_items').insert({event_id:eventId, dish_id:dishId, pcs_per_guest:1}).select().single();
  if(r.error || !r.data){ peToast('NOT added — check connection', true); return; }
  (peState.items[eventId]=peState.items[eventId]||[]).push(r.data);
  renderMain();
}
async function peRemoveItem(itemId){
  var r = await sb.from('event_items').delete().eq('id', itemId);
  if(r.error){ peToast('NOT removed — check connection', true); return; }
  Object.keys(peState.items).forEach(function(k){
    peState.items[k] = peState.items[k].filter(function(i){ return i.id!==itemId; });
  });
  renderMain();
}
async function peSetPcs(itemId, val){
  var v = Number(val); if(!(v>0)){ peToast('Enter a quantity above 0', true); renderMain(); return; }
  var r = await sb.from('event_items').update({pcs_per_guest:v}).eq('id', itemId);
  if(r.error){ peToast('NOT saved — check connection', true); return; }
  Object.keys(peState.items).forEach(function(k){
    peState.items[k].forEach(function(i){ if(i.id===itemId) i.pcs_per_guest = v; });
  });
  renderMain();
}
async function peApplyClientSelection(eventId){
  var e = peEvById(eventId); if(!e || !e.client_selection) return;
  var want = e.client_selection.dish_ids||[];
  var qmap = e.client_selection.quantities||{};
  var g = Number(e.guests)||0;
  var existing = (peState.items[eventId]||[]).map(function(i){ return i.dish_id; });
  var toAdd = want.filter(function(d){ return existing.indexOf(d)<0; })
    .map(function(d){
      var q = Number(qmap[d])||0;
      return {event_id:eventId, dish_id:d, pcs_per_guest:(q&&g)?Math.round(q/g*100)/100:1};
    });
  if(toAdd.length){
    var r = await sb.from('event_items').insert(toAdd).select();
    if(r.error){ peToast('Could not apply — check connection', true); return; }
    peState.items[eventId] = (peState.items[eventId]||[]).concat(r.data||[]);
  }
  peToast('Client selection applied — review quantities');
  renderMain();
}

// ── documents ────────────────────────────────────────────────────────────────
function peDocShell(title, inner){
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+peEsc(title)+'</title>'+
  '<style>@page{margin:18mm}body{font-family:Georgia,\'Times New Roman\',serif;color:#2C1810;margin:0;padding:24px;max-width:720px;margin:0 auto}'+
  '.brand{font-size:22px;letter-spacing:7px;color:#400207;text-align:center;margin:6px 0 2px}'+
  '.rule{width:70px;height:1px;background:#C9A84C;margin:10px auto}'+
  'h2{font-size:16px;letter-spacing:2px;color:#7A8B4A;text-align:center;font-weight:normal;text-transform:uppercase}'+
  '.sub{text-align:center;font-size:12px;color:#8B7355}'+
  '.sec{font-size:13px;letter-spacing:2px;color:#7A8B4A;text-transform:uppercase;text-align:center;margin:22px 0 8px}'+
  '.dish{text-align:center;font-size:13.5px;margin:7px 0}.dish .d{font-size:11.5px;color:#8B7355}'+
  '.codes{font-size:9.5px;color:#A5876B}'+
  '.ft{text-align:center;font-size:9.5px;color:#A5876B;margin-top:34px;line-height:1.7}'+
  'table{width:100%;border-collapse:collapse;font-size:12px}td{padding:6px 8px;border:1px solid #E3D5C2;vertical-align:top}'+
  'td.l{width:32%;color:#8B7355;font-size:10.5px;text-transform:uppercase;letter-spacing:1px}'+
  '.fs-h{background:#400207;color:#E8D9C7;text-align:center;padding:8px;font-size:13px;letter-spacing:2px}'+
  '</style></head><body>'+inner+'</body></html>';
}
function pePrintHTML(html){
  var w = window.open('', '_blank');
  if(!w){ peToast('Popup blocked — allow popups for this site to print documents', true); return; }
  w.document.write(html); w.document.close();
  setTimeout(function(){ try{ w.print(); }catch(e){} }, 400);
}
function peProposalHTML(e){
  var t = peCalcTotals(e);
  var groups = [{k:'Cold',n:'Cold'},{k:'Hot',n:'Hot'},{k:'Dessert',n:'Dolci'}];
  var body = '<div class="brand">R O B E R T O ’ S</div><div class="rule"></div>';
  body += '<h2>'+peEsc(e.package_label||'Canapé Selection')+'</h2>';
  var priceLine = t.foodPP ? 'AED '+peMoney(t.foodPP)+' / person' : (e.min_spend ? 'Minimum spend AED '+peMoney(e.min_spend) : '');
  if(priceLine) body += '<div class="sub">'+priceLine+(t.pcs?' · '+t.pcs+' pieces per guest':'')+'</div>';
  if(e.client_name||e.event_date) body += '<div class="sub" style="margin-top:3px">'+peEsc(e.client_name||'')+(e.event_date?' · '+peDLabel(e.event_date):'')+(e.area?' · '+peEsc(e.area):'')+'</div>';
  groups.forEach(function(g){
    var list = t.items.map(function(it){ return peDishById(it.dish_id); }).filter(function(d){ return d && d.serve===g.k; });
    if(!list.length) return;
    body += '<div class="sec">'+g.n+'</div>';
    list.forEach(function(d){
      body += '<div class="dish">'+peEsc(d.name)+((d.allergens||[]).length?' <span class="codes">('+(d.allergens||[]).join(')(')+')</span>':'')+
        (d.description?'<br><span class="d">'+peEsc(d.description)+'</span>':'')+'</div>';
    });
  });
  var bev = e.bev_package_id ? peBevById(e.bev_package_id) : null;
  if(bev){
    body += '<div class="sec">Beverage</div><div class="dish">'+peEsc(bev.name)+(bev.duration_hours?' — '+bev.duration_hours+' hours':'')+' · AED '+peMoney(bev.price_pp)+' / person'+
      (bev.includes?'<br><span class="d">'+peEsc(bev.includes)+'</span>':'')+'</div>';
  }
  body += '<div class="ft">Our Chefs will do their best to accommodate your dietary requirements, please inform your waiter.<br>'+
    'All prices are in AED inclusive of 5% VAT, 7% DIFC Authority Fee and 10% Service Charge.<br>'+
    'D - Dairy | E - Egg | H - Homemade | N - Nuts | R - Raw | S - Shellfish | V - Vegetarian</div>';
  return peDocShell('Roberto\'s proposal', body);
}
function pePrintProposal(id){ var e = peEvById(id); if(e) pePrintHTML(peProposalHTML(e)); }
function peFunctionSheetHTML(e){
  var t = peCalcTotals(e);
  function row(l,v){ return '<tr><td class="l">'+l+'</td><td>'+peEsc(v==null||v===''?'—':v)+'</td></tr>'; }
  var body = '<div class="brand">R O B E R T O ’ S</div><div class="fs-h">FUNCTION SHEET</div><table>';
  body += row('Booking name', e.client_name)+row('Company', e.company)+row('Contact', (e.contact_name||'')+(e.contact_phone?' · '+e.contact_phone:'')+(e.contact_email?' · '+e.contact_email:''));
  body += row('Event date', peDLabel(e.event_date))+row('Type', e.event_type)+row('Timing', (e.time_from||'')+(e.time_to?' – '+e.time_to:''));
  body += row('Area', e.area)+row('Guests', e.guests);
  body += row('Food', (e.package_label||'Bespoke selection')+(t.foodPP?' · AED '+peMoney(t.foodPP)+'/guest':'')+(t.pcs?' · '+t.pcs+' pcs/guest':''));
  var bev = e.bev_package_id ? peBevById(e.bev_package_id) : null;
  body += row('Beverage', bev ? bev.name+' · AED '+peMoney(bev.price_pp)+'/guest' : '—');
  body += row('Estimated total', t.total ? 'AED '+peMoney(t.total) : '—')+row('Minimum spend', e.min_spend?'AED '+peMoney(e.min_spend):'—');
  body += row('Dietary', e.dietary)+row('Payment', e.payment_terms);
  body += row('Status', peStatusMeta(e.status).n)+row('Last update', new Date().toLocaleDateString('en-GB')+' · '+peActor());
  body += '</table><div class="ft">Amounts inclusive of 5% VAT, subject to 7% DIFC fee & 10% service charge.</div>';
  return peDocShell('Function sheet', body);
}
function pePrintFunctionSheet(id){ var e = peEvById(id); if(e) pePrintHTML(peFunctionSheetHTML(e)); }
function peCoordEmailHTML(e){
  var t = peCalcTotals(e);
  var bev = e.bev_package_id ? peBevById(e.bev_package_id) : null;
  function li(l,v){ return v ? '<tr><td style="padding:3px 10px 3px 0;color:#666;white-space:nowrap"><b>'+l+':</b></td><td style="padding:3px 0">'+peEsc(v)+'</td></tr>' : ''; }
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">'+
    '<p>Dear Team,</p>'+
    '<table style="border-collapse:collapse">'+
    li('Event', (e.client_name||'')+(e.company?' — '+e.company:''))+
    li('Date', peDLabel(e.event_date))+
    li('Time', (e.time_from||'')+(e.time_to?' to '+e.time_to:''))+
    li('Area', e.area)+
    li('No. People', e.guests?String(e.guests)+' guests':null)+
    li('Food package', (e.package_label||(t.items.length?'Bespoke canapé selection':null)))+
    li('Beverage', bev?bev.name+(bev.duration_hours?' ('+bev.duration_hours+'h)':''):null)+
    li('Minimum spending', e.min_spend?'AED '+peMoney(e.min_spend):null)+
    li('Dietary', e.dietary)+
    '</table>'+
    '<p style="color:#666;font-size:12px">Sent automatically from the Events module · status: '+peStatusMeta(e.status).n+'</p>'+
    '<p>Kind regards,<br>'+peEsc(peActor())+'</p></div>';
}
async function peSendCoordEmail(id){
  var e = peEvById(id); if(!e) return;
  var def = (state.userEmail?state.userEmail+', ':'')+PE_TEAM_CC.join(', ');
  var to = prompt('Coordination email \u2014 send to (comma-separated).\nThe standard team list is prefilled \u2014 remove anyone not needed.', def);
  if(to===null) return;
  var list = to.split(',').map(function(s){ return s.trim(); }).filter(function(s){ return s.indexOf('@')>0; });
  if(!list.length){ peToast('No valid recipients', true); return; }
  var subject = "Private Event "+(e.event_date?peDLabel(e.event_date):'')+(e.client_name?' — '+e.client_name:'');
  try{
    var r = await sb.functions.invoke('send-event-email', { body:{ to:list, subject:subject, html:peCoordEmailHTML(e) } });
    if(r.error || (r.data&&r.data.error)) throw (r.error||r.data.error);
    peToast('Email sent to '+list.length+' recipient'+(list.length>1?'s':'')+' ✓');
    sb.from('event_log').insert({event_id:id, action:'email', detail:'coordination email → '+list.join(', '), actor:peActor()}).then(function(){ peLoadLog(id); });
  }catch(err){
    peToast('Email NOT sent — '+String(err&&err.message||err).slice(0,120), true);
  }
}
async function peEmailProposal(id){
  var e = peEvById(id); if(!e || !e.contact_email) return;
  if(!confirm('Send the branded proposal to '+e.contact_email+' now?')) return;
  try{
    var r = await sb.functions.invoke('send-event-email', { body:{
      to:[e.contact_email],
      subject: 'Your canap\u00e9 proposal \u2014 Roberto\u2019s'+(e.event_date?' \u00b7 '+peDLabel(e.event_date):''),
      html: peProposalHTML(e)
    }});
    if(r.error || (r.data&&r.data.error)) throw (r.error||r.data.error);
    peToast('Proposal sent to '+e.contact_email+' \u2713');
    if(e.status==='draft') peSetStatus(id, 'sent');
    sb.from('event_log').insert({event_id:id, action:'email', detail:'proposal \u2192 '+e.contact_email, actor:peActor()}).then(function(){ peLoadLog(id); });
  }catch(err){
    peToast('NOT sent \u2014 '+String(err&&err.message||err).slice(0,120), true);
  }
}
function peWhatsApp(id){
  var e = peEvById(id); if(!e || !e.contact_phone) return;
  var digits = String(e.contact_phone).replace(/[^0-9]/g,'');
  if(digits.length && digits[0]==='0') digits = '971'+digits.slice(1);
  if(digits.length <= 9) digits = '971'+digits;
  var msg = 'Ciao'+(e.contact_name?' '+e.contact_name.split(' ')[0]:'')+'! Thank you for your enquiry with Roberto\u2019s'+
    (e.event_date?' for '+peDLabel(e.event_date):'')+'. I\u2019m preparing everything for you \u2014 Valentina';
  window.open('https://wa.me/'+digits+'?text='+encodeURIComponent(msg), '_blank');
  sb.from('event_log').insert({event_id:id, action:'whatsapp', detail:'chat opened \u2192 '+e.contact_phone, actor:peActor()});
}
function peCopyClientLink(id){
  var e = peEvById(id); if(!e) return;
  var base = location.origin + location.pathname.replace(/[^\/]*$/, '');
  var url = base + 'client-event.html?t=' + e.client_token;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function(){
    peToast('Client link copied — paste it into your email/WhatsApp to the client');
  }).catch(function(){ prompt('Copy this link:', url); });
  sb.from('event_log').insert({event_id:id, action:'client_link', detail:'link copied', actor:peActor()});
}

// ── library (chef dishes / Manuel beverage / packages) ───────────────────────
function peRenderChefCorner(){
  var h = peHeader('chef');
  h += '<div style="font-size:12px;color:#8B7355;margin-bottom:10px">The kitchen\u2019s home: add and update canap\u00e9s \u2014 everything saved here is instantly available to the events desk and the guest menu.</div>';
  h += peRenderDishLib();
  return h+PE_FOOT;
}
function peRenderBevCorner(){
  var h = peHeader('bev');
  h += '<div style="font-size:12px;color:#8B7355;margin-bottom:10px">Manuel\u2019s home: beverage packages for events \u2014 name, hours, price per guest and what\u2019s included.</div>';
  h += peRenderBevLib();
  return h+PE_FOOT;
}
function peRenderPacksView(){
  var h = peHeader('packs');
  h += '<div style="font-size:12px;color:#8B7355;margin-bottom:10px">Ready-made menu packages (like Canape Cortile) that start a quotation with one tap.</div>';
  h += peRenderPackLib();
  return h+PE_FOOT;
}
function peBuildGoal(){
  var have = { serve:{}, tiers:{}, cells:{} };
  peState.dishes.forEach(function(d){
    if(!d.active) return;
    have.serve[d.serve] = (have.serve[d.serve]||0)+1;
    if(d.tier) have.tiers[d.tier] = (have.tiers[d.tier]||0)+1;
    var ck = d.category+'|'+d.serve;
    have.cells[ck] = (have.cells[ck]||0)+1;
  });
  var total = peState.dishes.filter(function(d){ return d.active; }).length;
  var goal = 0; Object.keys(PE_TARGETS.serve).forEach(function(k){ goal += PE_TARGETS.serve[k]; });
  function bar(label, n, target){
    var pct = Math.min(100, Math.round(n/target*100));
    return '<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:11.5px;color:#6B4A33"><span>'+label+'</span><span><b style="color:#400207">'+n+'</b> of '+target+'</span></div>'+
      '<div style="height:7px;background:#EFE4D4;border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+(pct>=100?'#2E6B34':'#C9A84C')+'"></div></div></div>';
  }
  var gaps = [];
  Object.keys(PE_TARGETS.cells).forEach(function(ck){
    var miss = PE_TARGETS.cells[ck] - (have.cells[ck]||0);
    if(miss>0) gaps.push({k:ck.replace('|',' \u00b7 '), miss:miss});
  });
  gaps.sort(function(a,b){ return b.miss-a.miss; });
  var h = '<div class="pe-card" style="background:#F7EEE2;border-color:rgba(201,168,76,0.5)">'+
    '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px">'+
    '<b style="color:#400207;font-size:14px">The kitchen goal: '+goal+' canap\u00e9s on the menu</b>'+
    '<span style="font-size:12px;color:'+(total>=goal?'#2E6B34':'#8A6A4F')+'">'+total+' done \u00b7 '+Math.max(0,goal-total)+' to create</span></div>'+
    '<div class="pe-grid3" style="margin-top:6px">'+
    bar('Cold', have.serve.Cold||0, PE_TARGETS.serve.Cold)+
    bar('Hot', have.serve.Hot||0, PE_TARGETS.serve.Hot)+
    bar('Dolci', have.serve.Dessert||0, PE_TARGETS.serve.Dessert)+
    '</div><div class="pe-grid3" style="margin-top:2px">'+
    bar('Classic \u00b7 AED 10', have.tiers.Classic||0, PE_TARGETS.tiers.Classic)+
    bar('Elevated \u00b7 AED 20', have.tiers.Elevated||0, PE_TARGETS.tiers.Elevated)+
    bar('Signature \u00b7 AED 35', have.tiers.Signature||0, PE_TARGETS.tiers.Signature)+
    '</div>'+
    (gaps.length ? '<div style="font-size:12px;color:#6B4A33;margin-top:8px"><b style="color:#400207">Most needed next:</b> '+gaps.slice(0,4).map(function(g){ return g.k+' ('+g.miss+' more)'; }).join(' \u00b7 ')+'</div>'
                 : '<div style="font-size:12px;color:#2E6B34;margin-top:8px">Every category is complete \u2014 grande!</div>')+
    '</div>';
  return h;
}
function peRenderDishLib(){
  var ed = peState.editDishId==='new' ? {} : (peState.editDishId ? peDishById(peState.editDishId)||{} : null);
  var h = peBuildGoal();
  if(ed){
    var alg = ed.allergens||[];
    h += '<div class="pe-card"><b style="color:#400207">'+(ed.id?'Edit dish':'Add a dish')+'</b>'+
      '<div style="font-size:11px;color:#8B7355;margin:2px 0 10px">Goes live for the events desk the moment you save.</div>'+
      '<div class="pe-grid3">'+
      '<div style="grid-column:1/3"><div class="pe-lbl">Dish name</div><input class="pe-in" id="pe-d-name" value="'+peEsc(ed.name||'')+'"></div>'+
      '<div><div class="pe-lbl">Cost (AED, net)</div><input class="pe-in" id="pe-d-cost" type="number" step="0.01" value="'+peEsc(ed.cost!=null?ed.cost:'')+'"></div>'+
      '</div><div class="pe-grid3" style="margin-top:8px">'+
      '<div><div class="pe-lbl">Category</div><select class="pe-in" id="pe-d-category">'+['Vegetarian','Fish','Beef','Chicken','Dessert'].map(function(c){ return '<option'+(ed.category===c?' selected':'')+'>'+c+'</option>'; }).join('')+'</select></div>'+
      '<div><div class="pe-lbl">Served</div><select class="pe-in" id="pe-d-serve">'+['Cold','Hot','Dessert'].map(function(c){ return '<option'+(ed.serve===c?' selected':'')+'>'+c+'</option>'; }).join('')+'</select></div>'+
      '<div><div class="pe-lbl">Min order (pcs)</div><input class="pe-in" id="pe-d-min_order" type="number" value="'+peEsc(ed.min_order!=null?ed.min_order:10)+'"></div>'+
      '</div>'+
      '<div style="margin-top:8px"><div class="pe-lbl">Allergens</div>'+PE_ALL_CODES.map(function(c){
        return '<span class="pe-chip'+(alg.indexOf(c)>=0?' on':'')+'" data-code="'+c+'" onclick="this.classList.toggle(\'on\')">'+c+'</span>';
      }).join('')+'<span style="font-size:10.5px;color:#8B7355;margin-left:6px">D dairy · E egg · H homemade · N nuts · R raw · S shellfish · V vegetarian</span></div>'+
      '<div style="margin-top:8px"><div class="pe-lbl">What\'s in it (helps the menu line)</div><input class="pe-in" id="pe-d-notes" placeholder="e.g. burrata from Puglia, confit datterino, aged balsamic" value=""></div>'+
      '<div style="margin-top:10px;background:#F7EEE2;border-radius:10px;padding:11px 12px">'+
      '<div class="pe-lbl" style="color:#8A6A4F">Menu line — written for you</div>'+
      '<div style="font-family:Georgia,serif;font-size:13.5px;color:#400207;min-height:18px" id="pe-d-desc-show">'+peEsc(peState.aiDesc!=null?peState.aiDesc:(ed.description||'— tap Write it —'))+'</div>'+
      '<input class="pe-in" id="pe-d-description" style="margin-top:6px" placeholder="or type/edit it here" value="'+peEsc(peState.aiDesc!=null?peState.aiDesc:(ed.description||''))+'">'+
      '<div style="margin-top:6px"><button class="pe-btn sec sm" onclick="peDescribe()" '+(peState.aiBusy?'disabled':'')+'>'+(peState.aiBusy?'Writing…':(peState.aiDesc!=null||ed.description?'Try again':'Write it'))+'</button></div></div>'+
      '<div style="margin-top:8px;font-size:12px;color:#6B4A33" id="pe-d-tier"></div>'+
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="pe-btn" onclick="peSaveDish(\''+(ed.id||'')+'\')">Save dish</button>'+
      '<button class="pe-btn sec" onclick="peState.editDishId=null;peState.aiDesc=null;renderMain()">Cancel</button>'+
      (ed.id?'<button class="pe-btn sec" style="margin-left:auto;color:#B00020;border-color:#B00020" onclick="peToggleDish(\''+ed.id+'\','+(ed.active?'false':'true')+')">'+(ed.active?'Retire dish':'Reactivate')+'</button>':'')+
      '</div></div>';
  } else {
    h += '<div style="margin-bottom:10px"><button class="pe-btn" onclick="peState.editDishId=\'new\';peState.aiDesc=null;renderMain()">+ Add a dish</button></div>';
  }
  h += '<div class="pe-card">'+peState.dishes.map(function(d){
    return '<div class="pe-dishrow" style="opacity:'+(d.active?1:.45)+'">'+
      '<span><b>'+peEsc(d.name)+'</b> <span style="color:#A5876B;font-size:10.5px">('+((d.allergens||[]).join(')(')||'–')+')</span><br>'+
      '<span style="font-size:11px;color:#8B7355">'+peEsc(d.category)+' · '+peEsc(d.serve)+' · '+peEsc(d.tier||'')+' · AED '+peMoney(d.sell_price)+'/pc · cost '+(d.cost!=null?d.cost:'—')+(d.description?' · “'+peEsc(d.description)+'”':' · <span style="color:#B00020">no menu line</span>')+'</span></span>'+
      '<button class="pe-btn sec sm" onclick="peState.editDishId=\''+d.id+'\';peState.aiDesc=null;renderMain()">Edit</button></div>';
  }).join('')+'</div>';
  return h;
}
async function peDescribe(){
  var name = (document.getElementById('pe-d-name')||{}).value||'';
  if(!name.trim()){ peToast('Type the dish name first', true); return; }
  peState.aiBusy = true; renderMain();
  try{
    var r = await sb.functions.invoke('event-dish-describe', { body:{
      name:name, category:(document.getElementById('pe-d-category')||{}).value,
      serve:(document.getElementById('pe-d-serve')||{}).value,
      notes:(document.getElementById('pe-d-notes')||{}).value
    }});
    if(r.error || !r.data || !r.data.description) throw (r.error||{message:(r.data&&r.data.error)||'no response'});
    peState.aiDesc = r.data.description;
  }catch(err){
    peToast('Could not write the line — type it manually. '+String(err&&err.message||'').slice(0,80), true);
  }
  peState.aiBusy = false; renderMain();
}
async function peSaveDish(id){
  var g = function(f){ var el=document.getElementById('pe-d-'+f); return el?el.value.trim():''; };
  var name = g('name'); if(!name){ peToast('Dish name is required', true); return; }
  var cost = g('cost') ? Number(g('cost')) : null;
  var tier = null, sell = null;
  if(cost!=null){
    for(var i=0;i<PE_TIERS.length;i++){
      var maxCost = (PE_TIERS[i].p/PE_GROSS)*0.25;
      if(cost <= maxCost*1.05){ tier = PE_TIERS[i].n; sell = PE_TIERS[i].p; break; }
    }
    if(!tier){ tier='Signature'; sell=35; }
  }
  var codes = [];
  document.querySelectorAll('.pe-chip.on[data-code]').forEach(function(el){ codes.push(el.getAttribute('data-code')); });
  var row = { name:name, category:g('category'), serve:g('serve'), cost:cost, tier:tier, sell_price:sell,
              allergens:codes, description:g('description')||null,
              min_order: g('min_order')?parseInt(g('min_order'),10):10,
              created_by:peActor(), updated_at:new Date().toISOString() };
  var r = id ? await sb.from('event_dishes').update(row).eq('id', id).select().single()
             : await sb.from('event_dishes').insert(row).select().single();
  if(r.error || !r.data){ peToast('Dish NOT saved — '+String(r.error&&r.error.message||'').slice(0,100), true); return; }
  if(id){ peState.dishes = peState.dishes.map(function(d){ return d.id===id ? r.data : d; }); }
  else peState.dishes.push(r.data);
  peState.editDishId = null; peState.aiDesc = null;
  peToast('Dish saved ✓ — live for the events desk'+(tier?' · '+tier+' AED '+sell:''));
  renderMain();
}
async function peToggleDish(id, active){
  var r = await sb.from('event_dishes').update({active:active==='true'||active===true}).eq('id', id);
  if(r.error){ peToast('NOT changed — check connection', true); return; }
  peState.dishes.forEach(function(d){ if(d.id===id) d.active = (active==='true'||active===true); });
  peState.editDishId = null; renderMain();
}
function peRenderBevLib(){
  var ed = peState.editBevId==='new' ? {} : (peState.editBevId ? peBevById(peState.editBevId)||{} : null);
  var h = '';
  if(ed){
    h += '<div class="pe-card"><b style="color:#400207">'+(ed.id?'Edit package':'Add a beverage package')+'</b>'+
      '<div class="pe-grid3" style="margin-top:10px">'+
      '<div style="grid-column:1/3"><div class="pe-lbl">Package name</div><input class="pe-in" id="pe-b-name" value="'+peEsc(ed.name||'')+'"></div>'+
      '<div><div class="pe-lbl">Hours</div><input class="pe-in" id="pe-b-duration_hours" type="number" step="0.5" value="'+peEsc(ed.duration_hours!=null?ed.duration_hours:3)+'"></div>'+
      '</div><div class="pe-grid2" style="margin-top:8px">'+
      '<div><div class="pe-lbl">Price / guest (AED)</div><input class="pe-in" id="pe-b-price_pp" type="number" value="'+peEsc(ed.price_pp!=null?ed.price_pp:'')+'"></div>'+
      '<div><div class="pe-lbl">Includes</div><input class="pe-in" id="pe-b-includes" value="'+peEsc(ed.includes||'')+'" placeholder="House wine, beers, soft drinks, water"></div>'+
      '</div><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="pe-btn" onclick="peSaveBev(\''+(ed.id||'')+'\')">Save package</button>'+
      '<button class="pe-btn sec" onclick="peState.editBevId=null;renderMain()">Cancel</button>'+
      (ed.id?'<button class="pe-btn sec" style="margin-left:auto;color:#B00020;border-color:#B00020" onclick="peToggleBev(\''+ed.id+'\','+(ed.active===false?'true':'false')+')">'+(ed.active===false?'Reactivate':'Retire package')+'</button>':'')+
      '</div></div>';
  } else {
    h += '<div style="margin-bottom:10px"><button class="pe-btn" onclick="peState.editBevId=\'new\';renderMain()">+ Add a beverage package</button></div>';
  }
  h += '<div class="pe-card">'+(peState.bevs.length?peState.bevs.map(function(b){
    return '<div class="pe-dishrow" style="opacity:'+(b.active===false?.45:1)+'"><span><b>'+peEsc(b.name)+'</b> · '+(b.duration_hours?b.duration_hours+'h · ':'')+'AED '+peMoney(b.price_pp)+'/guest<br><span style="font-size:11px;color:#8B7355">'+peEsc(b.includes||'')+'</span></span>'+
      '<button class="pe-btn sec sm" onclick="peState.editBevId=\''+b.id+'\';renderMain()">Edit</button></div>';
  }).join(''):'<div style="font-size:12px;color:#8B7355">No packages yet.</div>')+'</div>';
  return h;
}
async function peSaveBev(id){
  var g = function(f){ var el=document.getElementById('pe-b-'+f); return el?el.value.trim():''; };
  if(!g('name')){ peToast('Package name is required', true); return; }
  if(!g('price_pp')){ peToast('Price per guest is required', true); return; }
  var row = { name:g('name'), duration_hours:g('duration_hours')?Number(g('duration_hours')):null,
              price_pp:Number(g('price_pp')), includes:g('includes')||null, created_by:peActor() };
  var r = id ? await sb.from('event_bev_packages').update(row).eq('id', id).select().single()
             : await sb.from('event_bev_packages').insert(row).select().single();
  if(r.error || !r.data){ peToast('NOT saved — '+String(r.error&&r.error.message||'').slice(0,100), true); return; }
  if(id){ peState.bevs = peState.bevs.map(function(b){ return b.id===id ? r.data : b; }); } else peState.bevs.push(r.data);
  peState.editBevId = null; peToast('Beverage package saved ✓'); renderMain();
}
async function peToggleBev(id, active){
  var r = await sb.from('event_bev_packages').update({active:active==='true'||active===true}).eq('id', id);
  if(r.error){ peToast('NOT changed \u2014 check connection', true); return; }
  peState.bevs.forEach(function(b){ if(b.id===id) b.active = (active==='true'||active===true); });
  peState.editBevId = null; renderMain();
}
function peRenderPackLib(){
  var ed = peState.editPackId==='new' ? {dish_ids:[]} : (peState.editPackId ? (peState.packs.filter(function(p){return p.id===peState.editPackId;})[0]||{dish_ids:[]}) : null);
  var h = '';
  if(ed){
    var sel = ed.dish_ids||[];
    h += '<div class="pe-card"><b style="color:#400207">'+(ed.id?'Edit menu package':'New menu package')+'</b>'+
      '<div class="pe-grid2" style="margin-top:10px">'+
      '<div><div class="pe-lbl">Package name</div><input class="pe-in" id="pe-p-name" value="'+peEsc(ed.name||'')+'" placeholder="e.g. Canape Portici"></div>'+
      '<div><div class="pe-lbl">Price / guest (AED)</div><input class="pe-in" id="pe-p-price_pp" type="number" value="'+peEsc(ed.price_pp!=null?ed.price_pp:'')+'"></div>'+
      '</div><div style="margin-top:8px"><div class="pe-lbl">Dishes in the package</div>'+
      peState.dishes.filter(function(d){ return d.active; }).map(function(d){
        return '<span class="pe-chip'+(sel.indexOf(d.id)>=0?' on':'')+'" data-dish="'+d.id+'" onclick="this.classList.toggle(\'on\')">'+peEsc(d.name)+'</span>';
      }).join('')+'</div>'+
      '<div style="margin-top:10px;display:flex;gap:8px"><button class="pe-btn" onclick="peSavePack(\''+(ed.id||'')+'\')">Save package</button>'+
      '<button class="pe-btn sec" onclick="peState.editPackId=null;renderMain()">Cancel</button></div></div>';
  } else {
    h += '<div style="margin-bottom:10px"><button class="pe-btn" onclick="peState.editPackId=\'new\';renderMain()">+ New menu package</button></div>';
  }
  h += '<div class="pe-card">'+(peState.packs.length?peState.packs.map(function(p){
    var names = (p.dish_ids||[]).map(function(id){ var d=peDishById(id); return d?d.name:null; }).filter(Boolean);
    return '<div class="pe-dishrow"><span><b>'+peEsc(p.name)+'</b> · AED '+peMoney(p.price_pp)+'/guest<br><span style="font-size:11px;color:#8B7355">'+peEsc(names.join(' · '))+'</span></span>'+
      '<button class="pe-btn sec sm" onclick="peState.editPackId=\''+p.id+'\';renderMain()">Edit</button></div>';
  }).join(''):'<div style="font-size:12px;color:#8B7355">No packages yet.</div>')+'</div>';
  return h;
}
async function peSavePack(id){
  var g = function(f){ var el=document.getElementById('pe-p-'+f); return el?el.value.trim():''; };
  if(!g('name')||!g('price_pp')){ peToast('Name and price are required', true); return; }
  var ids = [];
  document.querySelectorAll('.pe-chip.on[data-dish]').forEach(function(el){ ids.push(el.getAttribute('data-dish')); });
  var row = { name:g('name'), price_pp:Number(g('price_pp')), dish_ids:ids };
  var r = id ? await sb.from('event_packages').update(row).eq('id', id).select().single()
             : await sb.from('event_packages').insert(row).select().single();
  if(r.error || !r.data){ peToast('NOT saved — '+String(r.error&&r.error.message||'').slice(0,100), true); return; }
  if(id){ peState.packs = peState.packs.map(function(p){ return p.id===id ? r.data : p; }); } else peState.packs.push(r.data);
  peState.editPackId = null; peToast('Menu package saved ✓'); renderMain();
}

// ── monthly report (replaces the Group Report + RLL financials) ──────────────
function peKpis(){
  var today = peToday();
  var mk = peMonthKey(today);
  var plus30 = localISO(new Date(Date.now()+30*86400000));
  var k = { m:{n:0,v:0}, n30:{n:0,v:0}, pipe:{n:0,v:0}, ytd:{n:0,v:0} };
  peState.events.forEach(function(e){
    var v = peEventValue(e)||0;
    var d = e.event_date ? String(e.event_date).slice(0,10) : null;
    var conf = ['confirmed','deposit','done'].indexOf(e.status)>=0;
    if(conf && d && peMonthKey(d)===mk){ k.m.n++; k.m.v+=v; }
    if(conf && d && d>=today && d<plus30){ k.n30.n++; k.n30.v+=v; }
    if(['draft','sent'].indexOf(e.status)>=0){ k.pipe.n++; k.pipe.v+=v; }
    if(conf && d && d.slice(0,4)===today.slice(0,4)){ k.ytd.n++; k.ytd.v+=v; }
  });
  function card(lbl, v, sub){
    return '<div class="pe-card" style="padding:11px 12px;margin-bottom:0"><div class="pe-lbl">'+lbl+'</div>'+
      '<div style="font-family:\'Playfair Display\',serif;font-size:19px;color:#400207">AED '+peMoney(v.v)+'</div>'+
      '<div style="font-size:11px;color:#8B7355">'+v.n+' '+sub+'</div></div>';
  }
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">'+
    card('This month', k.m, 'confirmed events')+
    card('Next 30 days', k.n30, 'events coming')+
    card('Open pipeline', k.pipe, 'enquiries in play')+
    card(new Date().getFullYear()+' to date', k.ytd, 'confirmed events')+
  '</div>';
}
function peForecastData(){
  var from = peState.fcFrom, to = peState.fcTo;
  if(!from || !to) return null;
  var conf={n:0,v:0}, pipe={n:0,v:0}, lost=0, rows=[];
  peState.events.forEach(function(e){
    var d = e.event_date ? String(e.event_date).slice(0,10) : null;
    if(!d || d<from || d>to) return;
    var v = peEventValue(e)||0;
    if(['confirmed','deposit','done'].indexOf(e.status)>=0){ conf.n++; conf.v+=v; rows.push(e); }
    else if(['draft','sent'].indexOf(e.status)>=0){ pipe.n++; pipe.v+=v; rows.push(e); }
    else if(e.status==='lost') lost++;
  });
  rows.sort(function(a,b){ return String(a.event_date).localeCompare(String(b.event_date)); });
  return { from:from, to:to, conf:conf, pipe:pipe, lost:lost, rows:rows };
}
function peForecastHTML(fc){
  var rows = fc.rows.map(function(e){
    return '<tr><td>'+peDLabel(e.event_date)+'</td><td>'+peEsc(e.client_name||'')+(e.company?' \u2014 '+peEsc(e.company):'')+'</td>'+
      '<td>'+peEsc(e.area||'')+'</td><td>'+(e.guests||'')+'</td><td>'+peEsc(peStatusMeta(e.status).n)+'</td>'+
      '<td style="text-align:right">'+peMoney(peEventValue(e))+'</td></tr>';
  }).join('');
  return '<div class="brand">R O B E R T O \u2019 S</div><div class="fs-h">EVENTS FORECAST \u2014 '+peEsc(fc.from)+' to '+peEsc(fc.to)+'</div>'+
    '<p style="font-family:Arial,sans-serif;font-size:13px">Confirmed &amp; definite: <b>AED '+peMoney(fc.conf.v)+'</b> ('+fc.conf.n+' events) \u00b7 '+
    'Pipeline: <b>AED '+peMoney(fc.pipe.v)+'</b> ('+fc.pipe.n+' enquiries) \u00b7 Lost: '+fc.lost+'</p>'+
    '<table><tr><td class="l">Date</td><td class="l">Client</td><td class="l">Venue</td><td class="l">Pax</td><td class="l">Status</td><td class="l" style="text-align:right">Value AED</td></tr>'+rows+'</table>'+
    '<div class="ft">Generated from the Events module \u00b7 '+new Date().toLocaleDateString('en-GB')+' \u00b7 values are minimum-spend or quoted package totals</div>';
}
function peRunForecast(){
  var f = document.getElementById('pe-fc-from'), t2 = document.getElementById('pe-fc-to');
  if(!f || !t2 || !f.value || !t2.value){ peToast('Pick both dates first', true); return; }
  peState.fcFrom = f.value; peState.fcTo = t2.value; peState.fcRun = true;
  renderMain();
}
function pePrintForecastDoc(){
  var fc = peForecastData(); if(!fc) return;
  pePrintHTML(peDocShell('Events forecast', peForecastHTML(fc)));
}
async function peEmailForecast(){
  var fc = peForecastData(); if(!fc) return;
  var def = 'asacchi@skelmore.com, '+(state.userEmail||'');
  var to = prompt('Email this forecast to:', def);
  if(to===null) return;
  var list = to.split(',').map(function(s){ return s.trim(); }).filter(function(s){ return s.indexOf('@')>0; });
  if(!list.length){ peToast('No valid recipients', true); return; }
  try{
    var r = await sb.functions.invoke('send-event-email', { body:{
      to:list, subject:'Roberto\u2019s DIFC \u2014 Events forecast '+fc.from+' to '+fc.to,
      html: peDocShell('Events forecast', peForecastHTML(fc))
    }});
    if(r.error || (r.data&&r.data.error)) throw (r.error||r.data.error);
    peToast('Forecast sent to '+list.length+' recipient'+(list.length>1?'s':'')+' \u2713');
  }catch(err){ peToast('NOT sent \u2014 '+String(err&&err.message||err).slice(0,120), true); }
}
function peRenderReport(){
  if(!peState.month) peState.month = peMonthKey(peToday());
  var mk = peState.month;
  var first = new Date(+mk.slice(0,4), +mk.slice(5,7)-1, 1);
  var mLbl = first.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  var groups = [
    {n:'DEF (Definite)', st:['deposit','done']},
    {n:'Confirmed without payment', st:['confirmed']},
    {n:'Pipeline', st:['draft','sent']},
    {n:'Lost (LOS)', st:['lost']}
  ];
  var monthEvents = peState.events.filter(function(e){ return e.event_date && peMonthKey(e.event_date)===mk; })
    .sort(function(a,b){ return String(a.event_date).localeCompare(String(b.event_date)); });
  var h = peHeader('report');
  h += peKpis();
  var fc = peState.fcRun ? peForecastData() : null;
  h += '<div class="pe-card" style="border-color:rgba(201,168,76,0.5)">'+
    '<div style="font-size:12.5px;color:#6B4A33;margin-bottom:8px"><b style="color:#400207">Forecast any period</b> \u2014 confirmed vs pipeline for the dates you pick:</div>'+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
    '<input class="pe-in" style="width:auto" type="date" id="pe-fc-from" value="'+peEsc(peState.fcFrom||'')+'">'+
    '<span style="font-size:12px;color:#8B7355">to</span>'+
    '<input class="pe-in" style="width:auto" type="date" id="pe-fc-to" value="'+peEsc(peState.fcTo||'')+'">'+
    '<button class="pe-btn sm" onclick="peRunForecast()">Run forecast</button>'+
    (fc?'<button class="pe-btn sec sm" onclick="pePrintForecastDoc()">Print / PDF</button>'+
        '<button class="pe-btn sec sm" onclick="peEmailForecast()">Email report</button>':'')+
    '</div>'+
    (fc?'<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:#5A3A1E">'+
      '<span><b style="color:#2E6B34">Confirmed &amp; definite:</b> AED '+peMoney(fc.conf.v)+' \u00b7 '+fc.conf.n+' events</span>'+
      '<span><b style="color:#8A6400">Pipeline:</b> AED '+peMoney(fc.pipe.v)+' \u00b7 '+fc.pipe.n+' enquiries</span>'+
      '<span><b style="color:#933">Lost:</b> '+fc.lost+'</span></div>':'')+
  '</div>';
  h += '<div class="pe-top" style="margin-bottom:8px"><button class="pe-btn sec sm" onclick="peCalShift(-1)">‹ Prev</button>'+
       '<div class="pe-title" style="font-size:17px">'+mLbl+'</div>'+
       '<span><button class="pe-btn sec sm" onclick="peCalShift(1)">Next ›</button> <button class="pe-btn sm" onclick="pePrintReport()">Print / PDF</button></span></div>';
  var ytd = 0, mtot = 0;
  peState.events.forEach(function(e){
    if(['deposit','done','confirmed'].indexOf(e.status)<0) return;
    var v = peEventValue(e)||0;
    if(e.event_date && String(e.event_date).slice(0,4)===mk.slice(0,4)) ytd += v;
    if(e.event_date && peMonthKey(e.event_date)===mk) mtot += v;
  });
  groups.forEach(function(g){
    var isLost = g.st.length===1 && g.st[0]==='lost';
    if(isLost && !peState.lostReasons) peLoadLostReasons();
    var list = monthEvents.filter(function(e){ return g.st.indexOf(e.status)>=0; });
    h += '<div class="pe-lbl" style="margin:14px 0 6px;font-size:11px">'+g.n+' ('+list.length+')</div>';
    h += '<div class="pe-card" style="overflow-x:auto"><table class="pe-report"><tr><th>Date</th><th>Name / Company</th><th>Venue</th><th>Type</th><th>Time</th><th>Pax</th><th>Package</th><th>Min spend</th><th>Contact</th>'+(isLost?'<th>Why lost</th>':'')+'</tr>';
    if(!list.length) h += '<tr><td colspan="'+(isLost?10:9)+'" style="color:#8B7355">—</td></tr>';
    list.forEach(function(e){
      h += '<tr style="cursor:pointer" onclick="peGo(\'event\',\''+e.id+'\')"><td>'+peDLabel(e.event_date)+'</td>'+
        '<td>'+peEsc(e.client_name||'')+(e.company?'<br><span style="color:#8B7355">'+peEsc(e.company)+'</span>':'')+'</td>'+
        '<td>'+peEsc(e.area||'')+'</td><td>'+peEsc(e.event_type||'')+'</td><td>'+peEsc(e.time_from||'')+'</td>'+
        '<td>'+(e.guests||'')+'</td><td>'+peEsc(e.package_label||'')+'</td>'+
        '<td>'+(e.min_spend?peMoney(e.min_spend):'')+'</td>'+
        '<td>'+peEsc(e.contact_name||'')+(e.contact_phone?'<br>'+peEsc(e.contact_phone):'')+'</td>'+
        (isLost?'<td>'+peEsc((peState.lostReasons||{})[e.id]||'')+'</td>':'')+'</tr>';
    });
    h += '</table></div>';
  });
  h += '<div class="pe-tot" style="max-width:380px"><div class="pe-tot-row"><span>'+mLbl+' confirmed value</span><b>AED '+peMoney(mtot)+'</b></div>'+
       '<div class="pe-tot-row"><span>'+mk.slice(0,4)+' YTD confirmed value</span><b>AED '+peMoney(ytd)+'</b></div></div>';
  return h+PE_FOOT;
}
function pePrintReport(){
  var el = document.getElementById('main-content');
  if(!el) return;
  pePrintHTML(peDocShell('Group report', '<div class="brand">R O B E R T O ’ S</div><div class="fs-h">GROUP REPORT — '+peEsc(peState.month)+'</div>'+
    el.innerHTML.replace(/<button[\s\S]*?<\/button>/g,'').replace(/onclick="[^"]*"/g,'')));
}


// ── quick menu: the Excel selector, reborn — priced table, qty per dish,
//    live totals and the same warnings Valentina already knows ──────────────
function peQuickGroups(){
  var order = [['Vegetarian','Cold'],['Fish','Cold'],['Beef','Cold'],['Chicken','Cold'],['Vegetarian','Hot'],['Fish','Hot'],['Beef','Hot'],['Chicken','Hot'],['Dessert','Dessert']];
  return order.map(function(o){
    return { label: (o[0]==='Dessert' ? 'Dolci' : o[0]+' \u00b7 '+o[1]),
             dishes: peState.dishes.filter(function(d){ return d.active && d.category===o[0] && d.serve===o[1]; }) };
  }).filter(function(g){ return g.dishes.length; });
}
function peQuickTotals(){
  var pieces=0, price=0, distinct=0, minViol=[];
  peState.dishes.forEach(function(d){
    var q = Number(peQuick.qty[d.id])||0;
    if(q<=0) return;
    distinct++; pieces += q; price += q*(Number(d.sell_price)||0);
    if(d.min_order && q < d.min_order) minViol.push(d.name+' (min '+d.min_order+')');
  });
  var guests = Number(peQuick.guests)||0;
  return { pieces:pieces, price:price, distinct:distinct, minViol:minViol, guests:guests,
           perGuest: guests?price/guests:null, pcsPerGuest: guests?pieces/guests:null };
}
function peRenderQuick(){
  var tt = peQuickTotals();
  var h = '<div class="pe-wrap"><div class="pe-top"><span class="pe-tab" onclick="peGo(\'list\')">\u2039 Events</span>'+
    '<span style="font-size:12px;color:#8B7355">Quick menu \u2014 like the Excel, but it prints itself</span></div>';
  h += '<div class="pe-card"><div class="pe-grid3">'+
    '<div style="grid-column:1/3"><div class="pe-lbl">Menu title</div><input class="pe-in" id="pe-q-title" value="'+peEsc(peQuick.title)+'" onchange="peQuickRead()"></div>'+
    '<div><div class="pe-lbl">Number of guests</div><input class="pe-in" id="pe-q-guests" type="number" value="'+peEsc(peQuick.guests)+'" onchange="peQuickRead();renderMain()"></div>'+
    '</div></div>';
  h += '<div class="pe-2col"><div>';
  peQuickGroups().forEach(function(g){
    var subP=0, subQ=0;
    g.dishes.forEach(function(d){ var q=Number(peQuick.qty[d.id])||0; subQ+=q; subP+=q*(Number(d.sell_price)||0); });
    h += '<div class="pe-card" style="padding:10px 14px">'+
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:13px;color:#400207">'+g.label+'</b>'+
      (subQ?'<span style="font-size:11px;color:#8A6A4F">'+subQ+' pcs \u00b7 AED '+peMoney(subP)+'</span>':'')+'</div>';
    g.dishes.forEach(function(d){
      var q = Number(peQuick.qty[d.id])||0;
      var bad = q>0 && d.min_order && q<d.min_order;
      h += '<div class="pe-dishrow"><span><b style="font-weight:600">'+peEsc(d.name)+'</b>'+
        ((d.allergens||[]).length?' <span style="color:#A5876B;font-size:10px">('+(d.allergens||[]).join(')(')+')</span>':'')+
        '<br><span style="font-size:11px;color:#8B7355">'+peEsc(d.tier||'')+' \u00b7 AED '+peMoney(d.sell_price)+'/pc \u00b7 min '+(d.min_order||10)+' pcs'+
        (d.description?' \u00b7 '+peEsc(d.description):'')+'</span>'+
        (bad?'<br><span style="font-size:10.5px;color:#B00020">below the minimum order of '+d.min_order+'</span>':'')+'</span>'+
        '<span style="display:flex;align-items:center;gap:5px;flex-shrink:0">'+
        '<input class="pe-in" style="width:62px;padding:4px 7px;text-align:center'+(bad?';border-color:#B00020;color:#B00020':'')+'" type="number" min="0" placeholder="qty" value="'+(q||'')+'" onchange="peQuickSetQty(\''+d.id+'\',this.value)">'+
        (q?'<span style="font-size:11px;color:#6B4A33;min-width:56px;text-align:right">'+peMoney(q*(Number(d.sell_price)||0))+'</span>':'<span style="min-width:56px"></span>')+
        '</span></div>';
    });
    h += '</div>';
  });
  h += '</div><div><div class="pe-tot" style="position:sticky;top:10px">'+
    '<div class="pe-lbl" style="color:#8A6A4F">Live totals</div>'+
    '<div class="pe-tot-row"><span>Total pieces</span><b>'+tt.pieces+'</b></div>'+
    '<div class="pe-tot-row"><span>Total price</span><b>AED '+peMoney(tt.price)+'</b></div>'+
    '<div class="pe-tot-row" style="border-top:1px solid #DCC9B2;margin-top:4px;padding-top:7px"><span>Price / guest</span><b>'+(tt.perGuest!=null&&tt.guests?('AED '+peMoney(tt.perGuest)):'\u2014')+'</b></div>'+
    '<div class="pe-tot-row"><span>Different dishes on the menu</span><b>'+tt.distinct+'</b></div>';
  if(tt.distinct>15) h += '<div class="pe-flag" style="color:#B00020">\u25b2 Above the 15-dish kitchen cap \u2014 reduce variety</div>';
  else if(tt.distinct>10) h += '<div class="pe-flag" style="color:#7A5500">\u25b2 Within range \u2014 confirm lead time with the kitchen</div>';
  if(tt.pcsPerGuest!=null && tt.pieces>0){
    var ok = tt.pcsPerGuest>=8 && tt.pcsPerGuest<=12;
    h += '<div class="pe-flag" style="color:'+(ok?'#2E5B30':'#7A5500')+'">'+(ok?'\u2713':'\u25b2')+' '+tt.pcsPerGuest.toFixed(1)+' pieces / guest'+(ok?' \u2014 within the 8\u201312 norm':(tt.pcsPerGuest<8?' \u2014 below the 8\u201312 norm':' \u2014 above the 8\u201312 norm'))+'</div>';
  }
  if(tt.minViol.length) h += '<div class="pe-flag" style="color:#B00020">\u25b2 Below minimum order: '+peEsc(tt.minViol.join(', '))+'</div>';
  h += '<div style="display:flex;flex-direction:column;gap:7px;margin-top:12px">'+
    '<button class="pe-btn" onclick="peQuickPrint()" '+(tt.pieces?'':'disabled')+'>Print / PDF menu</button>'+
    '<button class="pe-btn sec" onclick="peQuickSave()" '+(tt.pieces?'':'disabled')+'>Save as event draft</button>'+
    '</div></div></div></div>';
  return h+'</div>';
}
function peQuickRead(){
  var tEl = document.getElementById('pe-q-title'), gEl = document.getElementById('pe-q-guests');
  if(tEl) peQuick.title = tEl.value.trim() || 'Canap\u00e9 selection';
  if(gEl) peQuick.guests = gEl.value.trim();
}
function peQuickSetQty(id, val){
  peQuickRead();
  var v = Math.max(0, parseInt(val,10)||0);
  if(v>0) peQuick.qty[id] = v; else delete peQuick.qty[id];
  renderMain();
}
function peQuickDishes(){
  return peState.dishes.filter(function(d){ return (Number(peQuick.qty[d.id])||0) > 0; });
}
function peQuickPrint(){
  peQuickRead();
  var dishes = peQuickDishes();
  if(!dishes.length) return;
  var tt = peQuickTotals();
  var groups = [{k:'Cold',n:'Cold'},{k:'Hot',n:'Hot'},{k:'Dessert',n:'Dolci'}];
  var body = '<div class="brand">R O B E R T O \u2019 S</div><div class="rule"></div>'+
    '<h2>'+peEsc(peQuick.title)+'</h2>';
  var sub = [];
  if(tt.perGuest!=null && tt.guests) sub.push('AED '+peMoney(tt.perGuest)+' / person');
  if(tt.pcsPerGuest!=null && tt.guests) sub.push(tt.pcsPerGuest.toFixed(0)+' pieces per guest');
  if(sub.length) body += '<div class="sub">'+sub.join(' \u00b7 ')+'</div>';
  groups.forEach(function(g){
    var list = dishes.filter(function(d){ return d.serve===g.k; });
    if(!list.length) return;
    body += '<div class="sec">'+g.n+'</div>';
    list.forEach(function(d){
      body += '<div class="dish">'+peEsc(d.name)+((d.allergens||[]).length?' <span class="codes">('+(d.allergens||[]).join(')(')+')</span>':'')+
        (d.description?'<br><span class="d">'+peEsc(d.description)+'</span>':'')+'</div>';
    });
  });
  body += '<div class="ft">Our Chefs will do their best to accommodate your dietary requirements, please inform your waiter.<br>'+
    'All prices are in AED inclusive of 5% VAT, 7% DIFC Authority Fee and 10% Service Charge.<br>'+
    'D - Dairy | E - Egg | H - Homemade | N - Nuts | R - Raw | S - Shellfish | V - Vegetarian</div>';
  pePrintHTML(peDocShell(peQuick.title, body));
}
async function peQuickSave(){
  peQuickRead();
  var dishes = peQuickDishes();
  if(!dishes.length) return;
  var tt = peQuickTotals();
  var row = { venue_id:'robertos-difc', status:'draft', updated_by:peActor(),
              package_label:peQuick.title,
              guests: tt.guests||null,
              food_price_pp: (tt.perGuest!=null && tt.guests) ? Math.round(tt.perGuest*100)/100 : null,
              payment_terms:'50% deposit to confirm, balance on the day' };
  var r = await sb.from('events_desk').insert(row).select().single();
  if(r.error || !r.data){ peToast('Could not save \u2014 check connection', true); return; }
  peState.events.push(r.data);
  var g = tt.guests||0;
  var items = dishes.map(function(d){
    var q = Number(peQuick.qty[d.id])||0;
    return {event_id:r.data.id, dish_id:d.id, pcs_per_guest: g ? Math.round(q/g*100)/100 : q};
  });
  var ir = await sb.from('event_items').insert(items).select();
  if(!ir.error) peState.items[r.data.id] = ir.data||[];
  sb.from('event_log').insert({event_id:r.data.id, action:'created', detail:'from quick menu', actor:peActor()});
  peQuick.qty = {};
  peToast('Saved as a draft event \u2014 add the client details when ready');
  peGo('event', r.data.id);
}


// the standing guest link: full canape selection, no event needed — a guest
// enquiry from it arrives as a new draft with the selection attached
function peCopyGuestLink(){
  var base = location.origin + location.pathname.replace(/[^\/]*$/, '');
  var url = base + 'client-event.html';
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function(){
    peToast('Guest link copied — send it to anyone; their picks arrive here as a new draft');
  }).catch(function(){ prompt('Copy this link:', url); });
}
