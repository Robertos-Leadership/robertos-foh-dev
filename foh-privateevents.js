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
  lastLoad:0,             // when the data was last read, so the screen can say how fresh it is
  view:'list',            // list | calendar | event | library | report | packs | packlib | wizard
  libTab:'dishes',        // dishes | bev | packages
  filter:'open',          // open | all | draft | sent | confirmed | deposit | done
  focus:null,             // null | 'send' | 'sign' | 'week' — a summary-pill spotlight on the list
  lead:'all',             // all | mine | <handled_by value> — separate the book by who took the lead
  q:'',                   // search text on the events list
  fcFrom:null, fcTo:null, fcRun:false,
  currentId:null,
  month:null,             // YYYY-MM shown in calendar/report
  events:[], items:{},    // items: event_id -> [{id,dish_id,pcs_per_guest}]
  dishes:[], bevs:[], packs:[], setMenus:[],
  alacarte:[],            // event_alacarte — the printed à la carte, with prices
  alcQ:'', alcSec:'',     // à la carte search box + section filter
  cm:null,                // the "Customise a menu" draft (see peCmStart)
  cmBusy:false,
  log:{},                 // event_id -> log rows (loaded per event)
  logEdit:null,           // id of the log line currently being corrected in place
  canapeViewOk:null,      // is event_packages_public there yet? asked once, lazily
  aiDesc:null, aiBusy:false,
  editDishId:null, editBevId:null, editPackId:null,
  chefTab:'canape',       // canape | set — Chef Corner sub-tab
  editSetMenuId:null, smDraft:null, smName:'', smText:'', smBusy:false
};

// Who the event brief goes to. The live list lives in app_users.notify ('event_brief')
// and is managed on Admin → Emails, so it changes without a deploy. This array is the
// FALLBACK only — used if that read returns nobody, so the brief can never go to no one.
var PE_TEAM_CC = ['fguarracino@robertos.ae','dvalla@robertos.ae','jthomas@robertos.ae','mpetrosino@robertos.ae','astellacci@robertos.ae','afalcone@robertos.ae','rmazouz@robertos.ae','reservations@robertos.ae','aviscardi@robertos.ae','kvukotic@robertos.ae','ahtwe@robertos.ae','asacchi@skelmore.com','amahmoud@skelmore.com'];
var PE_TARGETS = {
  cells: {'Vegetarian|Cold':7,'Fish|Cold':7,'Beef|Cold':6,'Vegetarian|Hot':7,'Fish|Hot':6,'Beef|Hot':7,'Dessert|Dessert':5},
  serve: {Cold:20, Hot:20, Dessert:5},
  tiers: {Classic:10, Elevated:25, Signature:10}
};
// qty  \u2014 canap\u00e9s, by the piece (event_dishes)
// alc  \u2014 \u00e0 la carte, by the portion (event_alacarte). Kept in its own map so
//        nothing that already reads peQuick.qty can be confused by an id from
//        a different table.
// savedId/savedToken \u2014 set once this quick menu has been saved as a draft
// event. The selections are deliberately NOT cleared on save: Valentina's next
// move is to print it or WhatsApp it, and clearing the screen took that away.
var peQuick = { qty:{}, alc:{}, title:'Canap\u00e9 selection', guests:'40',
                savedId:null, savedToken:null, sharedKey:null };

var PE_STATUS = [
  {k:'draft',     n:'Draft',          pill:'pe-p-draft'},
  {k:'sent',      n:'Proposal sent',  pill:'pe-p-sent'},
  {k:'confirmed', n:'Confirmed',      pill:'pe-p-conf'},
  {k:'deposit',   n:'Deposit paid',   pill:'pe-p-dep'},
  {k:'done',      n:'Event done',     pill:'pe-p-done'},
  {k:'lost',      n:'Lost',           pill:'pe-p-lost'}
];
// One source of truth for the status colours (bg · text · border) so the calendar
// legend and the event pills always read the same and every pill carries a border.
var PE_STATUS_COL = {
  draft:    {bg:'#E4DBCC', t:'#4E4433', b:'#B9A98C'},
  sent:     {bg:'#F5D98A', t:'#6B4A00', b:'#C99A12'},
  confirmed:{bg:'#B8DEB4', t:'#1C5A25', b:'#4E9E56'},
  deposit:  {bg:'#B3D2EC', t:'#12456E', b:'#3E7FBB'},
  done:     {bg:'#D2D2D2', t:'#3D3D3D', b:'#9E9E9E'},
  lost:     {bg:'#EDB9B0', t:'#7E1A0C', b:'#BB3A28'}
};
var PE_AREAS = ['Piemonte','Cortile','Restaurant terrace','Scala and Bar','Scala lounge','Scala terrace','Full venue'];
var PE_TYPES = ['Gathering','Private gathering','Dinner','Lunch','Reception','Full buyout'];
// Where a booking came from. Valentina (17 Jul 2026): a promoter's "table of 30,
// my usual 10%" lived only in her phone; Andrea, same day: "lead from and handler
// need to be there". The note field carries the promoter's name / commission.
var PE_LEAD_SOURCES = ['Walk-in','Phone call','WhatsApp','Email','Instagram / social','Website','Referral','Promoter','Repeat guest','Call centre'];
// G (gluten) added 17 Jul 2026 — Valentina: coeliac had nowhere to go, so it lived
// in a free-text note the allergen check could not see, and a proposal could go out
// reading "all clear". Existing dishes need the G tag applied in Chef Corner.
var PE_ALL_CODES = ['D','E','G','H','N','R','S','V'];
var PE_ALLERGEN_WORDS = {D:'dairy', E:'egg', G:'gluten', H:'homemade', N:'nuts', R:'raw', S:'shellfish', V:'vegetarian'};
// A plain-language allergen line for staff-facing screens — never a bare "(–)"
// or a lone "(S)". "Allergens: shellfish, nuts" / "Allergens: none".
function peAllergenText(alg){
  var list = (alg||[]).map(function(c){ return PE_ALLERGEN_WORDS[c]||String(c).toLowerCase(); });
  return 'Allergens: ' + (list.length ? list.join(', ') : 'none');
}
var PE_GROSS = 1.23585;   // 10% SC + 7% DIFC + 5% VAT compounding — net = gross / PE_GROSS
var PE_TIERS = [{n:'Classic',p:10},{n:'Elevated',p:20},{n:'Signature',p:35}];
// Wizard scaling — there is NO piece cap per guest or per dish (a guest may have
// 30 pcs of one thing — it's their budget). The only real cap is VARIETY (see
// peWizCap, max 15 different canapés). PE_WIZ_SANE_PCS is a *sensible* ceiling of
// canapés per guest: beyond it we stop piling on more pieces and instead offer a
// plated course / live station / beverage upgrade. PE_WIZ_AVG_PC is the blend the
// wizard aims for (~AED 20/piece) so the proposal is a full spread, not a few
// costly pieces — pieces ≈ food balance ÷ 20.
var PE_WIZ_SANE_PCS = 30;
var PE_WIZ_AVG_PC = 20;
// The three designed set menus (PDFs live in menus/ inside this repo, so they
// deploy with the app and the email links always match the site being served).
// Each menu carries its courses so the kitchen prep sheet can be built from a
// booking. Fixed courses = one portion per guest; a "choose" course records the
// per-option headcount split the kitchen actually cooks (e.g. 18 wagyu / 8 moro).
var PE_SET_MENUS = [
  {key:'terra', name:'Terra set menu', price:370, pdf:'menus/set-menu-terra.pdf',
   line:'Burrata · homemade tortelli, ricotta and spinach with truffle cream · choice of branzino, polletto or insalata 4 semi · tiramisù',
   courses:[
     {name:'Primi', items:['Burrata']},
     {name:'Pasta', items:['Tortelli ricotta &amp; spinach']},
     {name:'Secondi', choose:1, options:['Branzino','Polletto','Insalata 4 semi']},
     {name:'Dolci', items:['Tiramisù']}
   ]},
  {key:'mare', name:'Mare set menu', price:440, pdf:'menus/set-menu-mare.pdf',
   line:'Burrata, bresaola and tonno battuto · Il Bosco truffle risotto · choice of angus ribeye, branzino or melanzane · torta al limone',
   courses:[
     {name:'Primi', items:['Burrata','Bresaola','Tonno Battuto']},
     {name:'Pasta', items:['Il Bosco truffle risotto']},
     {name:'Secondi', choose:1, options:['Ribeye di Angus','Branzino','Melanzane']},
     {name:'Dolci', items:['Torta al Limone']}
   ]},
  {key:'fuoco', name:'Fuoco set menu', price:525, pdf:'menus/set-menu-fuoco.pdf',
   line:'Burrata, bresaola and tonno battuto · raviolo alla Genovese · choice of wagyu ribeye, moro toothfish or melanzane · Choc-Choc',
   courses:[
     {name:'Primi', items:['Burrata','Bresaola','Tonno Battuto']},
     {name:'Pasta', items:['Raviolo alla Genovese']},
     {name:'Secondi', choose:1, options:['Ribeye di Wagyu','Moro','Melanzane']},
     {name:'Dolci', items:['Choc-Choc']}
   ]}
];
// Set menus are now data-driven (event_set_menus). PE_SET_MENUS above is the
// built-in seed / offline fallback used only before the table is loaded.
// peNormSM gives every menu — DB row or built-in — one shape: price (from
// price_pp), courses, line, pdf, active. price==null means "price pending".
function peNormSM(m){
  if(!m) return null;
  return { id:(m.id||null), key:m.key, name:m.name,
           price:(m.price!=null ? m.price : (m.price_pp!=null ? m.price_pp : null)),
           cost:(m.cost!=null ? m.cost : (m.cost_pp!=null ? m.cost_pp : null)),
           line:(m.line||''), courses:(m.courses||[]), pdf:(m.pdf||null),
           custom:!!m.is_custom, basedOn:(m.based_on||null),
           eventId:(m.event_id||null), priceMode:(m.price_mode||'supplement'),
           detail:(m.detail||null),
           active:(m.active!==false) };
}
// "The table isn't there yet" (first run, SQL not applied) vs "the read failed".
// PostgREST answers an unknown table with 42P01 / "does not exist"; anything else
// — network, timeout, RLS — is a failure and must NOT fall back to the seed.
function peSetMenusTableMissing(r){
  if(!r || !r.error) return false;
  var e = r.error;
  return e.code === '42P01' || /does not exist|schema cache/i.test(e.message || '');
}
// The live list. It used to read "…length ? peState.setMenus : PE_SET_MENUS",
// which meant an EMPTY table — every menu deleted — silently brought the three
// built-in menus back. Empty now means empty. peState.setMenus is seeded from
// PE_SET_MENUS at load time only when the table genuinely isn't there yet.
function peSetMenusRaw(){ return peState.setMenus || []; }
// Did the menu list actually load? false = the read failed, so the pickers must
// say so instead of showing an empty dropdown that looks like "no menus exist".
function peSetMenusLoaded(){ return peState.setMenusOk !== false; }
function peSetMenusAll(){ return peSetMenusRaw().map(peNormSM); }
// A customised menu (built in "Customise a menu") is a normal event_set_menus
// row flagged is_custom, so every document resolves it through peSetMenuByKey
// with no special case. It is hidden from the chef's library and from the
// booking dropdown — those are for the designed menus.
function peSmIsCustom(m){ return !!(m && m.custom); }
// The designed menus only — the chef's library and the pickers.
function peSetMenusDesigned(){ return peSetMenusAll().filter(function(m){ return !peSmIsCustom(m); }); }
// Only active, priced menus can be picked into a quote.
function peSetMenusSel(){ return peSetMenusDesigned().filter(function(m){ return m.active!==false && m.price!=null; }); }
function peSetMenuByKey(k){
  // peSetMenusAll() already falls back to PE_SET_MENUS via peSetMenusRaw() when
  // the DB table hasn't loaded yet — no separate fallback needed here. Adding
  // one back would let a menu deleted/renamed in event_set_menus silently
  // resurrect its old hardcoded copy instead of correctly returning "not found".
  var all = peSetMenusAll();
  for(var i=0;i<all.length;i++) if(all[i].key===k) return all[i];
  return null;
}
// Serving-style variants: a menu whose key is '<base>-sharing' is the shared
// version of the '<base>' menu (e.g. restaurant-week / restaurant-week-sharing).
// The event pickers show ONE entry (the base); the Food card then offers an
// "Individual / Everything shared" selector. Each variant stays a full row, so
// the proposal, agreement and kitchen brief render it with zero special cases.
function peSmFamily(key){
  var base = /-sharing$/.test(String(key)) ? String(key).replace(/-sharing$/,'') : String(key);
  var ind = null, sh = null;
  peSetMenusSel().forEach(function(x){ if(x.key===base) ind = x; if(x.key===base+'-sharing') sh = x; });
  return (ind && sh) ? {individual:ind, sharing:sh} : null;
}
// The event pickers: hide a '-sharing' row only when its base menu is also
// selectable — otherwise it stays listed, so a sharing-only menu never vanishes.
function peSetMenusPick(){
  return peSetMenusSel().filter(function(m){
    return !(/-sharing$/.test(m.key) && peSmFamily(m.key));
  });
}
// Like peSetMenusPick, but keeps unpriced menus too. Used only by the guest
// menu-send screen: a minimum-spend client is sent the menu WITHOUT a price, so
// a menu with "price pending" (e.g. a bespoke confidential-price menu) must still
// be tickable there. The per-guest price never appears — the send hides it.
function peSetMenusPickInc(){
  return peSetMenusDesigned().filter(function(m){
    return m.active!==false && !(/-sharing$/.test(m.key) && peSmFamily(m.key));
  });
}
function peSmSummary(courses){
  return (courses||[]).map(function(c){
    if(c.choose) return 'choice of '+((c.options||[]).join(' / '));
    return (c.items||[]).join(', ');
  }).filter(Boolean).join(' · ');
}

function peStatusMeta(k){ for(var i=0;i<PE_STATUS.length;i++) if(PE_STATUS[i].k===k) return PE_STATUS[i]; return PE_STATUS[0]; }
function peEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function peMoney(n){ return n==null||isNaN(n) ? '—' : Math.round(Number(n)).toLocaleString('en-US'); }
function peToast(msg, bad){ if(typeof toast==='function') toast(msg, !!bad); else alert(msg); }
function peActor(){ return (state.access && state.access.name) || state.userEmail || 'unknown'; }
// The human name for the email From line, so the guest sees "Katarina · Roberto's
// DIFC Events" — the person who sent it, not a faceless desk. Prefer the real
// name; fall back to the login's local part; never put the raw email on show.
function peSenderName(){
  if(state.access && state.access.name) return state.access.name;
  var e = state.userEmail || '';
  return e ? e.split('@')[0] : '';
}
// Events-desk view/edit lock — only these 3 may create/edit/send/confirm/delete
// on the desk itself. Everyone else sees it fully, read-only. Chef Corner
// (dishes) and Beverage Corner (bev packages) are NOT locked — those stay
// editable by whoever opens them (kitchen/bar libraries, not the desk).
// The people who can CREATE / EDIT / SEND on the events desk — everyone else sees
// it fully, read-only. These founding editors are ON BY DEFAULT; from here on,
// the Admin module manages the rest through the app_users.modules array, so cover
// staff can be added or removed without ever touching this code again:
//   'events_editor'      -> granted (anyone)
//   'events_editor_off'  -> revoked  (overrides a founder)
var PE_EDITORS = ['asacchi@skelmore.com','fguarracino@robertos.ae','kvukotic@robertos.ae','onafid@robertos.ae'];
function peCanEdit(){
  // Access not loaded yet (state.access is null while loadFohAccess is running,
  // or before it has ever run) — deny until we actually know, rather than falling
  // through to the founding-editor list, which would ignore a live revocation
  // that just hasn't loaded.
  if(!state.access) return false;
  var mods = state.access.modules || [];
  if(mods.indexOf('events_editor') >= 0) return true;       // granted in Admin
  if(mods.indexOf('events_editor_off') >= 0) return false;  // revoked in Admin
  var e = (state.userEmail||'').toLowerCase();
  return PE_EDITORS.indexOf(e) >= 0;                         // founding editors, on by default
}
// The calm one-liner a non-editor sees at the top of the events list and the
// event editor. Everything stays readable; only changing things is theirs.
function peViewBanner(){
  if(peCanEdit()) return '';
  return '<div style="background:#F3ECE0;border:1px solid #D8CDBB;border-radius:10px;padding:9px 13px;margin-bottom:12px;font-size:12.5px;color:#6B5E4E">'+
    'View only — changes are made by Katarina, Andrea or Francesco.</div>';
}
// A disabled action explains itself out loud: toast the reason and jump to the
// empty field (touch users never see hover tooltips).
function peScrollToField(fid, msg){
  if(msg) peToast(msg, true);
  var el = document.getElementById('pe-f-'+fid);
  // The field may live under the collapsed "More details" section — open it
  // first, re-render, then find the field, so the guidance actually lands.
  if(!el && peState.currentId){
    peState.moreOpen = peState.moreOpen || {};
    peState.moreOpen[peState.currentId] = true;
    renderMain();
    el = document.getElementById('pe-f-'+fid);
  }
  if(el){ try{ el.focus(); }catch(e){} if(el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'center'}); }
}
function peScrollToCard(name){
  var el = document.getElementById('pe-card-'+name);
  if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'start'});
}
// Branded confirm (pe-modal) — names the consequence in the body, never a bare
// "OK?". Resolves true only on the named action button; backdrop/✕/Cancel = false.
function peConfirm(opts){
  return new Promise(function(resolve){
    var bg = document.createElement('div'); bg.className='pe-modal-bg';
    var done = function(v){ bg.remove(); resolve(v); };
    bg.addEventListener('click', function(ev){ if(ev.target===bg) done(false); });
    var m = document.createElement('div'); m.className='pe-modal'; m.style.maxWidth='440px';
    m.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
      '<b style="color:#400207">'+peEsc(opts.title||'Are you sure?')+'</b><span class="pe-x">✕</span></div>'+
      '<div style="font-size:12.5px;color:#6B4A33;margin:6px 0 12px;line-height:1.55">'+(opts.html||peEsc(opts.body||''))+'</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="pe-btn" data-pecf="ok"'+(opts.danger?' style="background:#B00020;border-color:#B00020"':'')+'>'+peEsc(opts.ok||'Continue')+'</button>'+
      '<button class="pe-btn sec" data-pecf="no">'+peEsc(opts.cancel||'Cancel')+'</button></div>';
    m.querySelector('.pe-x').addEventListener('click', function(){ done(false); });
    m.querySelector('[data-pecf="ok"]').addEventListener('click', function(){ done(true); });
    m.querySelector('[data-pecf="no"]').addEventListener('click', function(){ done(false); });
    bg.appendChild(m); document.body.appendChild(bg);
  });
}
// A plausible email = has an "@" (not first char) with a "." somewhere after it.
// Deliberately loose — we only block obvious mistakes (a missing "@"), never
// try to fully validate an address.
function peIsEmail(v){
  v = String(v==null?'':v).trim();
  var at = v.indexOf('@');
  return at>0 && v.indexOf('.', at+2) >= 0 && !/\s/.test(v);
}
// One recipient field can hold several people — "a@x.com, b@y.com". Split on
// commas, semicolons or spaces; peEmailsValid requires at least one, all valid.
function peEmailList(v){
  return String(v==null?'':v).split(/[,;\s]+/).map(function(s){ return s.trim(); }).filter(Boolean);
}
function peEmailsValid(v){
  var l = peEmailList(v);
  return l.length>0 && l.every(peIsEmail);
}
// Recipients for a send: every address in the field, plus the sender's copy,
// with no duplicates (the guest never gets the mail twice).
function peSendTo(field, sender){
  var l = peEmailList(field);
  if(sender && l.indexOf(sender)<0) l.push(sender);
  return l;
}
// Three of the menu builders live only in memory — the customise builder, the Quick
// menu and the budget wizard. The app's ETag auto-reloader would refresh the page out
// from under a half-built quote and take the lot. index.html asks this before it
// reloads, exactly as it already asks __schedEditing for the schedule.
function peHasUnsavedWork(){
  try{
    // Customise builder: open with at least one dish typed in.
    if(peState.cm && (peState.cm.courses||[]).some(function(c){
      return (c.lines||[]).some(function(l){ return String(l.name||'').trim(); });
    })) return true;
    // Quick menu: any canapé or à la carte quantity above zero.
    var anyQty = function(o){ return o && Object.keys(o).some(function(k){ return Number(o[k])>0; }); };
    if(peState.view==='quick' && (anyQty(peQuick.qty) || anyQty(peQuick.alc)) && !peQuick.savedId) return true;
    // Budget wizard: a client name or a budget typed, not yet created.
    if(peState.view==='wizard' && (String(peWiz.client||'').trim() || String(peWiz.budget||'').trim())) return true;
  }catch(e){ /* never let this block a deploy refresh */ }
  return false;
}
window.__peUnsaved = peHasUnsavedWork;
// "Start a different menu" threw the whole customised menu away on one tap, with no
// confirm — and it is the control sitting directly above the builder.
async function peCmDiscard(){
  var n = 0;
  try{ (peState.cm.courses||[]).forEach(function(c){
    (c.lines||[]).forEach(function(l){ if(String(l.name||'').trim()) n++; });
  }); }catch(e){}
  if(n && !(await peConfirm({title:'Throw this menu away?',
    html:'You have <b>'+n+' dish'+(n>1?'es':'')+'</b> on this menu and it has not been saved. Starting a different one loses it.',
    ok:'Throw it away', cancel:'Keep building', danger:true}))) return;
  peState.cm = null; renderMain();
}
// The sidebar link used to blank the canapé quantities on the way in, so tapping
// "Quick menu" from inside a half-built Quick menu silently emptied it.
async function peQuickOpen(){
  var anyQty = function(o){ return o && Object.keys(o).some(function(k){ return Number(o[k])>0; }); };
  var has = anyQty(peQuick.qty) || anyQty(peQuick.alc);
  if(has){
    if(!(await peConfirm({title:'Start a new quick menu?',
      html:'You already have dishes chosen'+(peQuick.savedId?' and saved':'')+'. Starting a new one clears them.',
      ok:'Start a new one', cancel:'Go back to it'}))){
      peGo('quick'); return;      // keep what she had
    }
    peQuick.qty = {}; peQuick.alc = {}; peQuick.savedId = null; peQuick.savedToken = null;
  }
  peGo('quick');
}
// WhatsApp messages were signed "Valentina" whoever sent them, so a guest could get
// a message from Katarina signed by someone else. Sign with whoever is actually
// logged in; fall back to the desk if we somehow have no name.
function peSignOff(){
  var n = peSenderName();
  return n ? String(n).split(' ')[0] : 'Roberto’s Events';
}
// Every client send also copies the sender and sets reply-to. The confirms used to
// name only the client, so she had no way to know a second copy was going out.
function peCopyLine(sender){
  if(!sender) return '';
  return '<br><br><span style="font-size:11.5px;color:#4F4535">A copy goes to you (<b>'+peEsc(sender)+
    '</b>), and their reply comes back to you.</span>';
}
// Show / clear a small red message right under a facts-card input (el). Passing an
// empty message removes it. Used so a bad email is flagged inline, not just a toast.
function peInlineErr(el, msg){
  if(!el) return;
  var host = el.parentNode; if(!host) return;
  var s = host.querySelector('.pe-inline-err');
  if(!msg){ if(s) s.parentNode.removeChild(s); return; }
  if(!s){ s = document.createElement('div'); s.className='pe-inline-err'; s.style.cssText='font-size:11px;color:#8A2A1A;margin:3px 2px 0'; host.appendChild(s); }
  s.textContent = msg;
}
// The single next thing to do ON THIS event — drives the strip at the top of the
// editor so Valentina is never lost on that long screen. Points her at the exact
// field/card, or triggers the next action.
function peEditorNext(e){
  if(e.status==='done' || e.status==='lost') return null;
  var name = e.client_name || e.company;
  var items = peState.items[e.id]||[];
  var hasFood = items.length>0 || !!e.set_menu || (e.food_price_pp!=null && e.food_price_pp!=='');
  var hasBev = !!e.bev_package_id;   // a beverage-only booking is a real event too
  var t = peCalcTotals(e);
  var hasPrice = !!t.total || !!e.min_spend;
  if(!name) return {label:'Add a booking name', act:"peScrollToField('client_name')"};
  if(!e.event_date) return {label:'Add the event date', act:"peScrollToField('event_date')"};
  if(!e.guests) return {label:'Add the guest count', act:"peScrollToField('guests')"};
  if(!hasFood && !hasBev) return {label:'Add the menu or a beverage package', act:"peScrollToCard('food')"};
  // Not priced yet is no longer a dead stop. She can send the menu now and price
  // it after — so point at the send, and let the docs card offer both.
  if((e.status==='draft' || e.status==='sent') && !e.signed_at){
    if(!e.contact_email) return {label:'Add the client email, then send', act:"peScrollToField('contact_email')"};
    return hasPrice
      ? {label:'Send the proposal to the guest', act:"peScrollToCard('docs')"}
      : {label:'Send the menu, or set the price first', act:"peScrollToCard('docs')"};
  }
  if(!hasPrice) return {label:'Set the price', act:"peScrollToField('min_spend')"};
  if(e.status==='sent' && e.signed_at) return {label:'Signed — mark it Confirmed', act:"peSetStatus('"+e.id+"','confirmed')"};
  return null;   // confirmed/deposit are handled by the green "this event is ON" banner
}
function peToday(){ return localISO(new Date()); }
function peMonthKey(d){ return String(d).slice(0,7); }
function peDishById(id){ for(var i=0;i<peState.dishes.length;i++) if(peState.dishes[i].id===id) return peState.dishes[i]; return null; }
function peBevById(id){ for(var i=0;i<peState.bevs.length;i++) if(peState.bevs[i].id===id) return peState.bevs[i]; return null; }
// A canapé package (event_packages) by id — the ticked keys come back from the
// DOM as strings, so compare as strings or a ticked package resolves to nothing.
function peCanapePackById(id){
  var all = peState.packs||[];
  for(var i=0;i<all.length;i++) if(String(all[i].id)===String(id)) return all[i];
  return null;
}
function peEvById(id){ for(var i=0;i<peState.events.length;i++) if(peState.events[i].id===id) return peState.events[i]; return null; }
function peDLabel(ds){ if(!ds) return '—'; var d=new Date(String(ds).slice(0,10)+'T12:00:00'); return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}); }
// A timestamp a person can read. "2026-07-30 14:22" is a database value, not
// something to put in front of anyone.
function peWhenLabel(ts){
  if(!ts) return '';
  var d = new Date(ts); if(isNaN(d)) return '';
  return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+
         ' · '+d.toLocaleTimeString('en-GB',{hour:'numeric',minute:'2-digit',hour12:true}).toLowerCase();
}

// ── hospitality time slots ───────────────────────────────────────────────────
// Times in hospitality land on :00 / :15 / :30 / :45 — never 8:31. A slot picker
// replaces the free-text and native minute-by-minute pickers everywhere. Stored
// value is a friendly "6:30 pm" string (reads the same on every document); the
// parser below still understands the old "18:30" values so nothing is lost.
function peParseTimeMin(s){
  if(s==null) return null;
  s = String(s).trim().toLowerCase(); if(!s) return null;
  var ampm = null;
  if(/p\.?m\.?$/.test(s)) ampm='pm';
  else if(/a\.?m\.?$/.test(s)) ampm='am';
  s = s.replace(/[ap]\.?m\.?/,'').trim().replace('.',':');
  var m = s.match(/^(\d{1,2})(?::(\d{1,2}))?$/); if(!m) return null;
  var h = parseInt(m[1],10), mn = m[2]?parseInt(m[2],10):0;
  if(isNaN(h)||isNaN(mn)) return null;
  if(ampm==='pm' && h<12) h+=12;
  if(ampm==='am' && h===12) h=0;
  return ((h*60+mn)%1440+1440)%1440;
}
function peFmtTime(min){
  min = ((Math.round(min)%1440)+1440)%1440;
  var h = Math.floor(min/60), mn = min%60;
  var ap = h<12?'am':'pm', h12 = h%12; if(h12===0) h12=12;
  return h12+':'+String(mn).padStart(2,'0')+' '+ap;
}
function peAddHoursTime(startStr, hours){
  var m = peParseTimeMin(startStr); if(m==null) return null;
  return peFmtTime(m + Math.round(Number(hours)*60));
}
// <option> list for a slot picker; keeps any off-slot legacy value selectable so
// an existing "18:31" is never silently dropped.
function peTimeOptions(selected){
  var selMin = peParseTimeMin(selected);
  var order = [], h;
  for(h=7; h<24; h++) order.push(h);
  for(h=0; h<7; h++) order.push(h);
  var opts = '<option value="">—</option>', onSlot = false;
  order.forEach(function(hr){
    [0,15,30,45].forEach(function(mn){
      var min = hr*60+mn, lbl = peFmtTime(min), sel = (selMin===min);
      if(sel) onSlot = true;
      opts += '<option value="'+lbl+'"'+(sel?' selected':'')+'>'+lbl+'</option>';
    });
  });
  if(selected && !onSlot){
    var keep = selMin!=null ? peFmtTime(selMin) : String(selected);
    opts += '<option value="'+peEsc(keep)+'" selected>'+peEsc(keep)+'</option>';
  }
  return opts;
}
function peTimeField(lbl, field, e, onchangeJs){
  return '<div><div class="pe-lbl">'+lbl+'</div><select class="pe-in" id="pe-f-'+field+'" onchange="'+onchangeJs+'"'+(peCanEdit()?'':' disabled')+'>'+peTimeOptions(e[field])+'</select></div>';
}
// Start-time change on an event: save it (audit-logged like any fact) and, when
// the end time is still blank, fill it from the beverage package's hours (3h
// default) — the number the guest is quoted on. Editable afterwards.
async function peTimeFromChange(el, id){
  var val = el.value;
  await peFact(el, 'time_from', id);
  var e = peEvById(id); if(!e) return;
  if(val && !e.time_to){
    var bev = e.bev_package_id ? peBevById(e.bev_package_id) : null;
    var hrs = (bev && bev.duration_hours) ? Number(bev.duration_hours) : 3;
    var end = peAddHoursTime(val, hrs);
    if(end){ await peSaveField(id, 'time_to', end, {silent:true}); peToast('End time set to '+end+' — adjust if needed'); }
  }
}

// ── safer number entry ───────────────────────────────────────────────────────
// A number field flanked by − / + so a guest count is a tap, not a typo, and the
// value can never be mis-keyed by an order of magnitude. Fires both input and
// change so it drives oninput- and onchange-bound fields alike.
function peStepWrap(inputHtml){
  return '<div class="pe-step-wrap"><button type="button" class="pe-step-btn" onclick="peStep(this,-1)" tabindex="-1" aria-label="less">−</button>'+inputHtml+'<button type="button" class="pe-step-btn" onclick="peStep(this,1)" tabindex="-1" aria-label="more">+</button></div>';
}
function peStep(btn, delta){
  var input = btn.parentNode.querySelector('input'); if(!input) return;
  var minAttr = input.getAttribute('min'), min = minAttr==null?0:parseInt(minAttr,10);
  var v = (parseInt(input.value,10)||0) + delta;
  if(!isNaN(min) && v<min) v = min;
  if(v<0) v = 0;
  input.value = v;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}
function peGuestField(lbl, e){
  var inp = '<input class="pe-in" id="pe-f-guests" type="number" min="1" value="'+peEsc(e.guests==null?'':e.guests)+'" onchange="peFact(this,\'guests\',\''+e.id+'\')"'+(peCanEdit()?'':' disabled')+'>';
  return '<div><div class="pe-lbl">'+lbl+'</div>'+(peCanEdit()?peStepWrap(inp):inp)+'</div>';
}
// Budget entry: grouped with thousands separators as you type (20,000 can never
// read as 2,000), with a big echo underneath. The raw digits are stored so the
// wizard maths still parses cleanly.
function peWizBudget(el){
  var raw = String(el.value).replace(/[^0-9]/g,'');
  peWiz.budget = raw;
  el.value = raw ? Number(raw).toLocaleString('en-US') : '';
  try{ el.setSelectionRange(el.value.length, el.value.length); }catch(e){}
  var echo = document.getElementById('pe-w-budget-echo');
  if(echo) echo.innerHTML = raw ? '= <b style="color:#400207">AED '+Number(raw).toLocaleString('en-US')+'</b>' : '&nbsp;';
  peWizPaint();
}

// ── data ─────────────────────────────────────────────────────────────────────
// Load every row across pages. A bare .limit() silently drops rows once a table
// grows past the cap — event_items is the real risk (line items accumulate across
// ALL events, and with no ordering it was undefined WHICH rows came back). Mirrors
// stock-take's stFetchAllPaged: each page rebuilds the query (a range can't be
// reused across awaits); a stable .order('id') tiebreaker stops pages overlapping
// or skipping rows; we stop on the first short page.
async function peFetchAllPaged(makeQuery){
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
async function peLoadAll(force){
  if(peState.loading || (peState.loaded && !force)) return;
  peState.loading = true;
  try{
    var res = await Promise.all([
      peFetchAllPaged(function(){ return sb.from('events_desk').select('*').order('event_date',{ascending:true}).order('id'); }),
      peFetchAllPaged(function(){ return sb.from('event_items').select('*').order('event_id').order('id'); }),
      peFetchAllPaged(function(){ return sb.from('event_dishes').select('*').order('category').order('serve').order('name').order('id'); }),
      peFetchAllPaged(function(){ return sb.from('event_bev_packages').select('*').order('name').order('id'); }),
      peFetchAllPaged(function(){ return sb.from('event_packages').select('*').order('name').order('id'); }),
      peFetchAllPaged(function(){ return sb.from('event_set_menus').select('*').order('name').order('id'); }),
      // Set-menu replies only. Without the menu_key filter an unapplied à la carte
      // pick sharing the same token lit up the set-menu banner, which then had no
      // matching numbers to review.
      sb.from('event_menu_choices').select('token,created_at,menu_key').eq('applied', false).neq('menu_key','alacarte').order('created_at',{ascending:false}),
      sb.from('event_log').select('event_id,created_at').eq('action','email').like('detail','event brief%').order('created_at',{ascending:true}),
      sb.from('event_targets').select('*'),
      sb.from('event_log').select('event_id,actor,created_at').eq('action','email').like('detail','proposal%').order('created_at',{ascending:true}),
      // res[10] — the printed à la carte. Loaded the same non-fatal way as the
      // set menus: if foh-events-alacarte.sql hasn't been run the module still
      // works, the À la carte tab simply says the menu isn't loaded yet.
      peFetchAllPaged(function(){ return sb.from('event_alacarte').select('*').order('sort_order').order('name'); })
    ]);
    // event_set_menus (res[5]) is loaded non-fatally so the module still opens if
    // the read fails — but it is NOT silently replaced by the built-in seed any
    // more. See setMenusOk below.
    var bad = [res[0],res[1],res[2],res[3],res[4]].find(function(r){ return r.error; });
    if(bad) throw bad.error;
    peState.events = res[0].data||[];
    peState.items = {};
    (res[1].data||[]).forEach(function(it){ (peState.items[it.event_id]=peState.items[it.event_id]||[]).push(it); });
    peState.dishes = res[2].data||[];
    peState.bevs   = res[3].data||[];
    peState.packs  = res[4].data||[];
    // ── Set menus: never quietly substitute the built-in copy ──
    // This used to be `...length) ? res[5].data : PE_SET_MENUS`, so a FAILED read
    // silently fell back to the three menus written into this file. Two of them
    // still matched the table; 'fuoco' did not — the seed calls it "Fuoco set
    // menu, AED 525, active" while the real row is the Netflix menu, no price,
    // switched off. A dropped connection could therefore put a retired menu at an
    // invented price in front of a guest, inside a quote, with nothing on screen
    // saying anything had gone wrong.
    //
    // Three states now, kept apart the way the à la carte keeps them (below):
    //   setMenusOk === true              → the table answered; use it, even if empty
    //   setMenusOk === false             → the read FAILED; show nothing, say so
    //   table absent + seed (first run)  → the built-in menus, as before
    // "The menus didn't load" and "there are no menus" are different sentences,
    // and only one of them means she should stop quoting.
    peState.setMenusOk = !!(res[5] && !res[5].error);
    if(peState.setMenusOk){
      peState.setMenus = res[5].data || [];
    } else if(peSetMenusTableMissing(res[5])){
      peState.setMenus = PE_SET_MENUS.map(peNormSM);   // table not created yet — first run
      peState.setMenusOk = true;
    } else {
      peState.setMenus = [];                            // read failed — quote nothing
    }
    // res[10] (non-fatal): the à la carte. alacarteOk is what the screen reads
    // to tell "the table isn't there yet" apart from "the menu is empty" —
    // two different things to put in front of Valentina mid-quote.
    peState.alacarteOk = !!(res[10] && !res[10].error);
    peState.alacarte = (res[10] && !res[10].error) ? (res[10].data||[]) : [];
    // res[6] (non-fatal): guest menu-number submissions not yet applied, so
    // Valentina is told the moment she's in the app — token → newest arrival.
    peState.menuChoicesPending = {};
    if(res[6] && !res[6].error) (res[6].data||[]).forEach(function(c){
      if(!peState.menuChoicesPending[c.token]) peState.menuChoicesPending[c.token] = c.created_at;
    });
    // res[7] (non-fatal): which events have actually had their team brief sent.
    // The log row is written ONLY after the email leaves, so it can't claim a
    // send that failed — brief_token is saved BEFORE the send, so it can.
    // Ascending order → the last write per event wins = the most recent send.
    peState.briefSent = {};
    if(res[7] && !res[7].error) (res[7].data||[]).forEach(function(l){
      peState.briefSent[l.event_id] = l.created_at;
    });
    // res[8] (non-fatal): the monthly events target — Andrea, coo-events-2 #11.
    // targetsOk is what the report reads to tell the difference between "no
    // target has been set for this month" and "this table isn't there yet",
    // which are two completely different things to put in front of a COO.
    peState.targets = {};
    peState.targetsOk = !!(res[8] && !res[8].error);
    // Keyed by month + lead ('' = the Everyone/overall budget). Rows from before the
    // per-person migration have no lead, so they land on '' and stay the overall one.
    if(peState.targetsOk) (res[8].data||[]).forEach(function(r){ peState.targets[r.month + '|' + (r.lead||'')] = r; });
    // res[9] (non-fatal): who sent the proposal, per event — the fallback "lead" when
    // no one is set in Handled by. Ascending order → the last send per event wins.
    peState.proposalBy = {};
    // Same rows also tell us WHEN it last went, which the send button needs so it
    // can say "Re-send" and show the date instead of always reading like a first send.
    peState.proposalSent = {};
    if(res[9] && !res[9].error) (res[9].data||[]).forEach(function(l){
      if(l.actor) peState.proposalBy[l.event_id] = l.actor;
      peState.proposalSent[l.event_id] = l.created_at;
    });
    // Which of the new columns actually EXIST. select('*') returns a missing
    // column as an absent key and a set-but-empty one as null, so `in` tells the
    // two apart — which matters, because otherwise the only way to find out is
    // for Valentina to build a whole evening and lose it on the next reload.
    // She is told BEFORE she types, not after. No rows to look at → assume fine
    // rather than warn about nothing.
    var probe = peState.events[0];
    peState.colsOk = probe
      ? { spaces:('spaces' in probe), options:('options' in probe), alt_dates:('alt_dates' in probe), actual_revenue:('actual_revenue' in probe) }
      : { spaces:true, options:true, alt_dates:true, actual_revenue:true };
    peState.loaded = true;
    peState.lastLoad = Date.now();
    peLoadReplies(true);   // fire-and-forget; its own error handling
  }catch(e){
    console.warn('[peLoadAll]', e);
    peToast('Events data did NOT load — check connection and try again.', true);
  }
  peState.loading = false;
  renderMain();
}

// The module used to read the database exactly once per page load and never again:
// peLoadAll took a `force` flag that nothing ever passed. So a client could sign, or
// send their menu choices, and her screen would still be telling her to chase them —
// for as long as the tab stayed open. These three give her fresh data on returning to
// the tab, and a refresh she can see and tap.
var peSyncAttached = false;
function peAttachSync(){
  if(peSyncAttached) return;
  peSyncAttached = true;
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) peMaybeRefresh(); });
  window.addEventListener('focus', peMaybeRefresh);
}
function peMaybeRefresh(){
  if(!peState.loaded || peState.loading) return;
  if(Date.now() - (peState.lastLoad||0) < 15000) return;      // same throttle as the core app
  // Never wipe the screen while she is typing or has something open.
  if(typeof safeToRefresh === 'function' && !safeToRefresh()) return;
  peLoadAll(true);
}
function peRefreshNow(){
  if(peState.loading){ peToast('Already refreshing…'); return; }
  peLoadAll(true);
  peToast('Refreshed ✓');
}
// "just now" / "4 min ago" / "14:32" — she should be able to see how old the screen is.
function peFreshLabel(){
  var ms = peState.lastLoad ? Date.now() - peState.lastLoad : null;
  if(ms == null) return '';
  if(ms < 60000) return 'just now';
  var mins = Math.floor(ms/60000);
  if(mins < 60) return mins+' min ago';
  return new Date(peState.lastLoad).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
async function peLoadLog(eventId){
  try{
    var r = await sb.from('event_log').select('*').eq('event_id', eventId).order('created_at',{ascending:false}).limit(50);
    if(!r.error){ peState.log[eventId] = r.data||[]; renderMain(); }
  }catch(e){}
}
// Every screen an event can honestly be opened FROM, and what to call it.
var PE_BACK_LABELS = {
  list:'Events', calendar:'Calendar', report:'Monthly report',
  packs:'Menu packages', packsfood:'Menu packages', packsbev:'Menu packages',
  quick:'Quick menu', wizard:'New quote from a budget',
  chef:'Chef corner', bev:'Beverage corner'
};
function peGo(view, id){
  // Remember the screen we opened an event FROM, so "back" returns there
  // (calendar → event → back to calendar), not always to the flat list.
  var prev = peState.view;
  if(view==='event' || view==='guidedevent'){
    // Always reassign. It used to be set ONLY when coming from list/calendar/report,
    // so opening a booking from anywhere else (Menu packages, a guest reply card, the
    // wizard) left the previous journey's value behind and the button then offered to
    // take her "back" to a screen she had not come from.
    peState.backTo = PE_BACK_LABELS[prev] ? prev : 'list';
  }
  peState.view = view;
  if(id !== undefined) peState.currentId = id;
  if((view==='event' || view==='guidedevent') && id) peLoadLog(id);
  renderMain();
  var mc = document.getElementById('foh-tab-content') || document.getElementById('main-content'); if(mc) mc.scrollTop = 0;
}
// Where a persistent "back" on an event screen should return to.
function peBackTarget(){
  var b = peState.backTo;
  var label = PE_BACK_LABELS[b];
  // Anything we cannot name honestly falls back to the events list rather than
  // guessing — a wrong "Back to Calendar" is worse than a plain "Back to Events".
  return label ? {view:b, label:label} : {view:'list', label:'Events'};
}
function peScrollTopBtn(){
  return '<button class="pe-totop" onclick="peScrollTop()" aria-label="Back to top">↑ Top</button>';
}
// Reset EVERY possible scroll container so this can't miss regardless of which
// element actually scrolls: any scrolled ancestor of #main-content, #foh-tab-content,
// the window, and the document scrolling element.
function peScrollTop(){
  function top(node){ if(!node) return; if(node.scrollTo){ try{ node.scrollTo({top:0, behavior:'smooth'}); return; }catch(e){} } try{ node.scrollTop = 0; }catch(e){} }
  var node = document.getElementById('main-content');
  while(node && node !== document.body){
    if(node.scrollTop > 0 && node.scrollHeight > node.clientHeight + 2) top(node);
    node = node.parentElement;
  }
  top(document.getElementById('foh-tab-content'));
  top(document.scrollingElement || document.documentElement);
  top(document.body);
  try{ window.scrollTo({top:0, behavior:'smooth'}); }catch(e){ try{ window.scrollTo(0,0); }catch(_){} }
}

// ── styles (injected once) ───────────────────────────────────────────────────
(function(){
  var css = ''+
  // ── the room, as a frame ───────────────────────────────────────────────────
  // The venue is the ground for the whole module and the work sits on one sheet
  // of cream paper laid over the middle of it. The wash is the SAME one the
  // .pe-room band already uses, so the two read as one continuous photograph
  // with paper resting on it, not as two pictures of the same place.
  //
  // Why it is painted from .pe-wrap and not from the shell: .pe-wrap only exists
  // while an Events screen is rendered, so the room appears and disappears with
  // the module. Revenue, Reservations and the rest are untouched, and there is no
  // teardown to get wrong. Both layers are position:fixed, so the room stays still
  // while the list scrolls over it — the device already live on Kitchen Recipes.
  //
  // Nothing reads off the photograph: every label, figure and control in the
  // module sits on the sheet or on a card. That is the whole point of this
  // treatment and the reason it needs no ink changes anywhere.
  '.pe-wrap{max-width:1080px;margin:0 auto;position:relative;isolation:isolate}'+
  '.pe-wrap::before,.pe-wrap::after{content:"";position:fixed;inset:0;pointer-events:none}'+
  '.pe-wrap::before{z-index:-2;background:url(venue-dining-art.jpg) center/cover;background-color:#cdbba6}'+
  '.pe-wrap::after{z-index:-1;background:linear-gradient(180deg,'+
    'rgba(43,1,4,.60) 0,rgba(43,1,4,.44) 9%,rgba(43,1,4,.40) 62%,rgba(43,1,4,.58) 100%)}'+
  // The sheet. Cream, not white, so the white cards on it still read as cards.
  // Padding replaces the space the page used to get from the tab container, so
  // nothing inside it moves relative to anything else.
  '.pe-sheet{background:#F4EDE1;border-radius:14px;padding:18px 20px 22px;'+
    'box-shadow:0 34px 76px -34px rgba(20,4,4,.94)}'+
  // A slow connection gets the wine, not a grey hole; print gets neither.
  '@media print{.pe-wrap::before,.pe-wrap::after{display:none}.pe-sheet{background:none;box-shadow:none;padding:0}}'+
  '@media(max-width:520px){.pe-sheet{border-radius:10px;padding:12px 12px 16px}}'+
  '.pe-kbar{display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px}'+
  '.pe-shell{display:flex;gap:18px;align-items:flex-start}'+
  '.pe-side{width:168px;flex-shrink:0;display:flex;flex-direction:column;gap:5px}'+
  '.pe-side .pe-btn{width:100%;box-sizing:border-box;text-align:center}'+
  '.pe-sdiv{border-top:1px solid rgba(107,31,42,0.15);margin:9px 6px}'+
  // Sidebar group labels. A class, not an inline style, so the mobile rule
  // below can hide them -- on a phone the sidebar becomes a row of pills and
  // these headings were left stranded between them.
  '.pe-slbl{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#544418;margin:10px 6px 4px}'+
  '.pe-snav{font-size:12.5px;padding:8px 12px;border-radius:8px;border:1px solid var(--vino);text-align:center;color:var(--vino);cursor:pointer}'+
  '.pe-snav:hover{background:rgba(107,31,42,0.07)}'+
  '.pe-snav.on{background:var(--vino);border-color:var(--vino);color:var(--cream);font-weight:600}'+
  '.pe-main{flex:1;min-width:0}'+
  '@media(max-width:820px){.pe-shell{display:block}.pe-side{width:auto;flex-direction:row;flex-wrap:wrap;align-items:center;margin-bottom:12px}.pe-side .pe-btn{width:auto}.pe-sdiv{display:none}.pe-slbl{display:none}.pe-snav{border:1px solid rgba(107,31,42,0.3);border-radius:14px;padding:6px 14px;font-size:12px}.pe-snav.on{border-color:var(--vino)}}'+
  // ── the room band ──────────────────────────────────────────────────────────
  // Room behind, wine wash over it, content above -- the same device that is
  // live on the Kitchen Recipes screens. It goes ONLY on a way-in screen (the
  // events list, Chef corner, Beverage corner); never over a screen where the
  // work happens, because nobody reads a table off a photograph.
  //
  // The wash is not decoration: cream lettering needs it. Each room was
  // measured against the Cortina screen (heading 4.31:1) that was approved for
  // Kitchen, and every room used here meets or beats it at this wash.
  '.pe-room{position:relative;background:#cdbba6;border-radius:12px;overflow:hidden;'+
    'padding:22px 22px 24px;margin-bottom:14px}'+
  '.pe-room::before,.pe-room::after{content:"";position:absolute;inset:0;pointer-events:none}'+
  '.pe-room::before{background:var(--pe-room) center/cover}'+
  '.pe-room::after{background:linear-gradient(180deg,'+
    'rgba(43,1,4,.60) 0,rgba(43,1,4,.44) 55px,rgba(43,1,4,.36) 62%,rgba(43,1,4,.56) 100%)}'+
  '.pe-room>*{position:relative;z-index:1}'+
  '.pe-room .pe-eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#F2D3B8}'+
  '.pe-room .pe-lede{font-family:\'Playfair Display\',serif;font-size:25px;color:#FBF3E9;margin:5px 0 3px}'+
  // #F0E2D6, not the softer #E6D3C6 it started as: measured over these rooms the
  // softer cream fell to 2.65:1, under the 2.82 the approved Cortina screen gives
  // its sub-line. Lifting the ink was the fix; darkening the room was not.
  '.pe-room .pe-stand{font-size:12.5px;color:#F0E2D6}'+
  '@media(max-width:520px){.pe-room{padding:18px 16px 20px}.pe-room .pe-lede{font-size:21px}}'+
  // A slow connection should get the wine, not a grey hole, so the band is
  // readable before the photograph arrives and readable if it never does.
  '@media print{.pe-room{background:var(--vino)}.pe-room::before{display:none}}'+
  '.pe-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px}'+
  '.pe-title{font-family:\'Playfair Display\',serif;font-size:22px;color:var(--vino-dark)}'+
  '.pe-tabs{display:flex;gap:6px;flex-wrap:wrap}'+
  '.pe-tab{font-size:12px;padding:6px 14px;border-radius:14px;border:1px solid rgba(107,31,42,0.3);color:var(--vino);cursor:pointer;background:transparent}'+
  '.pe-tab.on{background:var(--vino);color:var(--cream)}'+
  '.pe-tab.staff{border-color:#C9A84C;color:#574232}'+
  '.pe-tab.staff.on{background:#8A6A4F;border-color:#8A6A4F;color:#FBF7F1}'+
  '.pe-btn{font-size:12.5px;padding:8px 14px;border-radius:8px;border:1px solid var(--vino);background:var(--vino);color:var(--cream);cursor:pointer}'+
  '.pe-btn.sec{background:transparent;color:var(--vino)}'+
  '.pe-btn.sm{padding:5px 10px;font-size:11.5px}'+
  '.pe-primary{font-weight:700;box-shadow:0 2px 8px rgba(64,2,7,0.22)}'+
  '.pe-side .pe-primary{font-size:14px;padding:12px 14px;margin-bottom:2px}'+
  '.pe-btn:disabled{opacity:.5;cursor:default}'+
  '.pe-card{background:#fff;border:1px solid rgba(107,31,42,0.16);border-radius:12px;padding:14px 16px;margin-bottom:12px}'+
  '.pe-row{display:grid;grid-template-columns:1.5fr 1.2fr 0.5fr 0.9fr 1fr;gap:8px;padding:10px 4px;border-bottom:1px solid rgba(107,31,42,0.1);align-items:center;cursor:pointer}'+
  '.pe-row:hover{background:var(--cream)}'+
  '.pe-lrow{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(107,31,42,0.08);cursor:pointer}'+
  '.pe-lrow:last-child{border-bottom:none}'+
  '.pe-lrow:hover{background:var(--cream)}'+
  // THE BOOK SITS IN THE ROOM (13 Aug 2026). Each group of bookings is a tray cut
  // through the cream sheet onto the venue photograph, and every booking floats on it
  // as a pane of glass carrying its own status colour down the left edge. The photo is
  // the same file the module already paints behind the sheet, so a slow connection
  // gets the warm ground and never a grey hole.
  '.pe-tray{position:relative;border-radius:14px;padding:14px;margin:0 0 2px;'+
    'background:#cdbba6 url(venue-dining-art.jpg) center/cover;'+
    'box-shadow:0 10px 26px -14px rgba(20,4,4,.55)}'+
  '.pe-tray::before{content:"";position:absolute;inset:0;border-radius:13px;pointer-events:none;'+
    'background:linear-gradient(180deg,rgba(43,1,4,.64) 0,rgba(43,1,4,.52) 45%,rgba(43,1,4,.68) 100%)}'+
  // 88%/78% and no glassier: at 80/66 the small line under each name measured 3.28:1
  // over the dark end of the photograph, which is not readable.
  '.pe-tray .pe-lrow{position:relative;z-index:1;margin-bottom:9px;padding:12px 14px 12px 0;'+
    'border-bottom:none;border-radius:12px;overflow:hidden;'+
    'background:linear-gradient(180deg,rgba(255,250,242,.88) 0,rgba(248,240,228,.78) 100%);'+
    'border:1px solid rgba(255,255,255,.55);'+
    'box-shadow:0 8px 20px -10px rgba(20,4,4,.6),inset 0 1px 0 rgba(255,255,255,.9);'+
    'transition:transform .18s cubic-bezier(.2,.7,.3,1),box-shadow .18s ease,background .18s ease}'+
  '.pe-tray .pe-lrow:last-child{margin-bottom:0}'+
  '@supports ((-webkit-backdrop-filter:blur(2px)) or (backdrop-filter:blur(2px))){'+
    '.pe-tray .pe-lrow{-webkit-backdrop-filter:blur(12px) saturate(140%);backdrop-filter:blur(12px) saturate(140%)}}'+
  '.pe-spine{width:5px;align-self:stretch;flex:none;background:var(--sc,#B9A98C);transition:box-shadow .2s ease}'+
  '.pe-sdot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--sc,#B9A98C);'+
    'box-shadow:0 0 0 3px rgba(92,61,46,.10);transition:box-shadow .2s ease}'+
  // Hover only where there is a real pointer: on a touch screen :hover sticks to the
  // last row tapped and would leave a booking lifted after she has moved on.
  '@media(hover:hover){.pe-tray .pe-lrow:hover{transform:translateY(-2px);'+
    'background:linear-gradient(180deg,rgba(255,253,248,.95) 0,rgba(251,246,237,.88) 100%);'+
    'box-shadow:0 16px 30px -12px rgba(20,4,4,.7),inset 0 1px 0 #fff}'+
    '.pe-tray .pe-lrow:hover .pe-spine{box-shadow:0 0 12px var(--sc,#B9A98C)}'+
    '.pe-tray .pe-lrow:hover .pe-sdot{box-shadow:0 0 0 3px rgba(92,61,46,.10),0 0 10px var(--sc,#B9A98C)}}'+
  '.pe-tray .pe-lrow:active{transform:translateY(0);box-shadow:0 4px 10px -6px rgba(20,4,4,.6)}'+
  '.pe-key{border:none;display:inline-block;transition:transform .1s ease,box-shadow .12s ease,filter .12s ease}'+
  '@media(hover:hover){.pe-key:hover{filter:brightness(1.06)}}'+
  '.pe-key:active{transform:translateY(2px);box-shadow:inset 0 1px 3px rgba(20,4,4,.35)}'+
  // On a phone the dot goes and the gap tightens, so the row spends no more width
  // than it did before: spine 5 + gap 8 replaces the 14px of left padding it lost.
  '@media(max-width:520px){.pe-sdot{display:none}.pe-tray .pe-lrow{gap:8px}.pe-tray{padding:6px;border-radius:11px}}'+
  '@media(prefers-reduced-motion:reduce){.pe-tray .pe-lrow{transition:none}'+
    '.pe-tray .pe-lrow:hover{transform:none}}'+
  '@media print{.pe-tray{background:none;box-shadow:none;padding:0}.pe-tray::before{display:none}'+
    '.pe-tray .pe-lrow{background:none;box-shadow:none;border:none;border-radius:0;margin:0;'+
    '-webkit-backdrop-filter:none;backdrop-filter:none;border-bottom:1px solid rgba(107,31,42,0.12)}}'+
  '.pe-pill{font-size:11px;padding:3px 10px;border-radius:10px;display:inline-block;white-space:nowrap}'+
  '.pe-p-draft{background:#E4DBCC;color:#4E4433;border:1px solid #B9A98C;font-weight:600}'+
  '.pe-p-sent{background:#F5D98A;color:#6B4A00;border:1px solid #C99A12;font-weight:600}'+
  '.pe-p-conf{background:#B8DEB4;color:#1C5A25;border:1px solid #4E9E56;font-weight:600}'+
  '.pe-p-dep{background:#B3D2EC;color:#12456E;border:1px solid #3E7FBB;font-weight:600}'+
  '.pe-p-done{background:#D2D2D2;color:#3D3D3D;border:1px solid #9E9E9E;font-weight:600}'+
  '.pe-p-lost{background:#EDB9B0;color:#7E1A0C;border:1px solid #BB3A28;font-weight:600}'+
  '.pe-lbl{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#4F4535;margin:0 0 3px}'+
  '.pe-in{width:100%;font-size:13px;padding:7px 9px;border:1px solid rgba(107,31,42,0.25);border-radius:7px;background:#fff;color:#2C1810;box-sizing:border-box}'+
  'select.pe-in{height:33px}'+
  '.pe-step-wrap{display:flex;align-items:stretch;gap:6px}'+
  '.pe-step-wrap input{text-align:center}'+
  '.pe-step-btn{width:38px;flex-shrink:0;border:1px solid var(--vino);background:transparent;color:var(--vino);border-radius:7px;font-size:18px;line-height:1;cursor:pointer;font-weight:700}'+
  '.pe-step-btn:hover{background:rgba(107,31,42,0.08)}'+
  '.pe-totop{position:fixed;right:18px;bottom:18px;z-index:120;background:var(--vino);color:var(--cream);border:none;border-radius:20px;padding:9px 16px;font-size:12.5px;font-weight:700;box-shadow:0 3px 10px rgba(64,2,7,0.32);cursor:pointer}'+
  '.pe-totop:hover{background:var(--vino-dark)}'+
  '.pe-statpill[onclick]:hover{box-shadow:0 2px 9px rgba(64,2,7,0.15);transform:translateY(-1px)}'+
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
  '.pe-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}'+
  '.pe-cal-h{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:#4F4535;text-align:center;padding:6px 0;font-weight:700;background:#F3EEE6;border-radius:7px}'+
  '.pe-cal-h.we{color:#544418}'+
  '.pe-cal-d{min-height:92px;background:#fff;border:1px solid rgba(107,31,42,0.12);border-radius:9px;padding:5px 6px;font-size:11px}'+
  '.pe-cal-d.dim{opacity:.4;background:transparent;border-style:dashed}'+
  '.pe-cal-d.we{background:#FBF7F0}'+
  '.pe-cal-d.today{border-color:var(--vino);border-width:2px;box-shadow:0 2px 8px rgba(64,2,7,0.12)}'+
  '.pe-cal-n{color:#4F4535;font-size:11px;margin-bottom:3px;text-align:right;min-height:18px}'+
  '.pe-cal-today{background:var(--vino);color:var(--cream);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;font-weight:700;font-size:11px}'+
  '.pe-cal-ev{border-radius:6px;padding:3px 6px;margin-bottom:3px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;font-weight:600;line-height:1.3}'+
  '.pe-cal-ev:hover{filter:brightness(.96)}'+
  '.pe-agenda{display:none}'+
  '@media(max-width:640px){.pe-cal{display:none}.pe-agenda{display:block}}'+
  '.pe-log{font-size:12px;padding:6px 0;border-bottom:1px solid rgba(107,31,42,0.08)}'+
  '.pe-log .t{color:#4F4535;font-size:10.5px}'+
  '.pe-log-h{display:flex;justify-content:space-between;align-items:center;gap:10px}'+
  '.pe-log-acts{display:flex;gap:4px;flex:none}'+
  '.pe-log-act{font-size:10.5px;color:#4F4535;background:none;border:1px solid rgba(107,31,42,0.16);border-radius:7px;padding:4px 9px;min-height:26px;cursor:pointer;line-height:1}'+
  '.pe-log-act:hover{color:var(--vino);border-color:var(--vino)}'+
  '.pe-log-act.danger:hover{color:#8A2A1A;border-color:#8A2A1A}'+
  '@media(max-width:640px){.pe-log-act{min-height:32px;padding:6px 11px;font-size:11.5px}}'+
  '.pe-modal-bg{position:fixed;inset:0;background:rgba(44,24,16,0.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px}'+
  '.pe-modal{background:#FBF7F1;border-radius:14px;max-width:640px;width:100%;max-height:86vh;overflow-y:auto;padding:18px 20px}'+
  '.pe-steps{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}'+
  '.pe-step{font-size:12px;padding:9px 15px;border-radius:11px;border:1px solid rgba(107,31,42,0.25);color:#4F4535;cursor:pointer;min-height:20px;display:inline-flex;align-items:center}'+
  '.pe-step.cur{background:var(--vino);color:var(--cream);border-color:var(--vino)}'+
  '.pe-report{width:100%;border-collapse:collapse;font-size:11.5px}'+
  '.pe-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}'+
  '.pe-kpi{background:#fff;border:1px solid rgba(107,31,42,0.14);border-radius:12px;padding:13px 15px 14px;box-shadow:0 1px 3px rgba(64,2,7,0.05)}'+
  '.pe-kpi-l{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#4F4535;margin-bottom:7px}'+
  '.pe-kpi-v{font-family:\'Playfair Display\',serif;font-size:22px;color:#400207;line-height:1.05}'+
  '.pe-kpi-s{font-size:11px;color:#4F4535;margin-top:5px}'+
  '.pe-report th{background:var(--vino);color:var(--cream);padding:6px 7px;text-align:left;font-weight:600;font-size:10.5px;letter-spacing:.03em}'+
  '.pe-report td{padding:6px 7px;border-bottom:1px solid rgba(107,31,42,0.12);vertical-align:top}'+
  '@media(max-width:700px){.pe-2col{grid-template-columns:1fr}.pe-grid3{grid-template-columns:1fr 1fr}.pe-row{grid-template-columns:1.4fr 1fr 0.9fr}.pe-row .pe-hide-m{display:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();

// ── main render ──────────────────────────────────────────────────────────────
function renderPrivateEvents(){
  peAttachSync();   // once, so returning to the tab re-reads instead of showing stale events
  if(!peState.loaded){ peLoadAll(); return '<div class="loading">Loading events…</div>'; }
  var v = peState.view;
  if(v==='event')    return peRenderEvent();
  if(v==='quick')    return peRenderQuick();
  if(v==='calendar') return peRenderCalendar();
  if(v==='chef')     return peRenderChefCorner();
  if(v==='bev')      return peRenderBevCorner();
  if(v==='packs' || v==='packsfood' || v==='packsbev') return peRenderPacksView();
  if(v==='packlib')   return peRenderPacksLibView();
  if(v==='wizard')   return peRenderWizard();
  if(v==='guided')   return peRenderGuided();
  if(v==='guidedevent') return peGuideEventView();
  if(v==='library')  return peRenderChefCorner();
  if(v==='report')   return peRenderReport();
  if(v==='table')    return peRenderTableMenu();
  return peRenderList();
}
// Shown across the whole module when the set-menu read failed. The pickers are
// empty in that state — and an empty dropdown looks exactly like "there are no
// menus", which is the wrong thing to believe halfway through quoting a guest.
// This says which of the two it is. It never appears when the table simply has
// no menus in it: that is a real, correct empty.
function peSetMenusBanner(){
  if(peSetMenusLoaded()) return '';
  return '<div style="margin:0 0 12px;padding:11px 14px;border-radius:10px;background:#fdf1d6;'+
    'border:1px solid #d9a441;color:#6b4a10;font:500 13px/1.45 var(--font-body,inherit)">'+
    '<strong>The set menus didn’t load.</strong> They are hidden rather than shown out of date — '+
    'don’t quote a set menu until this clears. Check the connection and reopen Events.'+
    '</div>';
}
// The room band for a way-in screen. One room per screen and no repeats -- the
// same photograph twice reads as the same screen. Every room here is a daylight
// frame, measured at this wash against the Cortina standard:
//   dining-art 4.55 · mural 4.53 · foliage 5.09  (Cortina, approved, is 4.31)
var PE_ROOMS = { list:'venue-dining-art.jpg', chef:'venue-mural.jpg', bev:'venue-foliage.jpg' };
function peRoom(which, eyebrow, lede, stand){
  var img = PE_ROOMS[which];
  if(!img) return '';
  return '<div class="pe-room" style="--pe-room:url(' + img + ')">'+
    '<div class="pe-eyebrow">'+peEsc(eyebrow)+'</div>'+
    '<div class="pe-lede">'+peEsc(lede)+'</div>'+
    (stand ? '<div class="pe-stand">'+peEsc(stand)+'</div>' : '')+
  '</div>';
}
function peHeader(active){
  var mine = [['list','Events'],['calendar','Calendar'],['report','Monthly report']];
  var right = [['chef','Chef corner'],['bev','Beverage corner']];
  var snav = function(k, label){ return '<span class="pe-snav'+(active===k?' on':'')+'" onclick="peGo(\''+k+'\')">'+label+'</span>'; };
  return '<div class="pe-wrap">'+
    '<div class="pe-sheet">'+
    peSetMenusBanner()+
    '<div class="pe-kbar">'+
    '<span style="font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#544418;margin-right:2px">Kitchen &amp; bar</span>'+
    right.map(function(t){
      return '<span class="pe-tab staff'+(active===t[0]?' on':'')+'" onclick="peGo(\''+t[0]+'\')">'+t[1]+'</span>';
    }).join('')+'</div>'+
    '<div class="pe-shell">'+
    '<div class="pe-side">'+
      (peCanEdit() ? '<button class="pe-btn pe-primary" onclick="peStartGuide()">+ New event</button>' : '')+
      '<div class="pe-slbl">My events</div>'+
      mine.map(function(t){ return snav(t[0], t[1]); }).join('')+
      '<div class="pe-slbl">Tools</div>'+
      '<span class="pe-snav" onclick="peQuickOpen()">Quick menu</span>'+
      '<span class="pe-snav'+(active==='wizard'?' on':'')+'" onclick="peWizReset();peGo(\'wizard\')">New quote from a budget</span>'+
      // Stays "Guest link" — Valentina uses this every day and renaming it mid-
      // flow cost her more than the missing option did. Same name, same place;
      // it just asks WHICH link now. Two choices, nothing else.
      '<span class="pe-snav" onclick="peGuestLinkChoose()">Guest link</span>'+
      '<span class="pe-snav'+(active==='table'?' on':'')+'" onclick="peGo(\'table\')" title="The menu the guest finds at their place">Print for the table</span>'+
      snav('packs','Menu packages')+
      // How fresh the screen is, and a way to force it. Signatures and guest menu
      // choices are written server-side, so nothing in her session can know they
      // happened until the data is read again.
      '<div class="pe-slbl" style="margin-top:14px">This screen</div>'+
      '<span class="pe-snav" onclick="peRefreshNow()" title="Read the latest bookings, replies and signatures">'+
        (peState.loading ? 'Refreshing…' : 'Refresh')+
        '<span style="display:block;font-size:10.5px;color:#4F4535;letter-spacing:0">Updated '+peFreshLabel()+'</span>'+
      '</span>'+
    '</div>'+
    '<div class="pe-main">';
}
var PE_FOOT = '</div></div></div></div>';   // pe-main, pe-shell, pe-sheet, pe-wrap

// ── list view ────────────────────────────────────────────────────────────────
// ── tonight ──────────────────────────────────────────────────────────────────
// What is actually happening today, with the operational facts on the face of it
// rather than one tap inside the booking. Before this the only way to know an
// event was on tonight was to already know.
function peTonightHTML(){
  var today = peToday();
  var evs = (peState.events||[]).filter(function(e){
    return String(e.event_date||'').slice(0,10) === today &&
           ['confirmed','deposit'].indexOf(e.status) >= 0;
  });
  if(!evs.length) return '';
  return '<div class="pe-card" style="border-color:#8A2A1A;background:#FCF2EE;margin-bottom:12px">'+
    '<b style="color:#8A2A1A">Tonight — '+evs.length+' private event'+(evs.length>1?'s':'')+'</b>'+
    evs.map(function(e){
      var when = [e.time_from, e.time_to].filter(Boolean).join(' – ');
      var facts = [when, e.area, (e.guests?e.guests+' guests':'')].filter(Boolean).join(' · ');
      var food = e.package_label || (e.set_menu && peSetMenuByKey(e.set_menu.key) ? peSetMenuByKey(e.set_menu.key).name : '');
      return '<div class="pe-dishrow"><span>'+
        '<b style="color:#400207">'+peEsc(e.client_name || e.company || 'Private event')+'</b>'+
        (facts?'<br><span style="font-size:12px;color:#6B4A33">'+peEsc(facts)+'</span>':'')+
        (food?'<br><span style="font-size:11.5px;color:#4F4535">'+peEsc(food)+'</span>':'')+
        // The allergy line is the one thing on this card that can hurt someone.
        (e.dietary?'<br><span style="font-size:11.5px;color:#B00020">'+peEsc(e.dietary)+'</span>':'')+
        (peBriefSent(e)?'':'<br><span style="font-size:11.5px;color:#7F5C00">The team has not been sent the brief.</span>')+
        '</span>'+
        '<span style="display:flex;gap:6px;flex-shrink:0"><button class="pe-btn sm" onclick="peGo(\'event\',\''+e.id+'\')">Open</button></span></div>';
    }).join('')+'</div>';
}
// ── guest replies, in one place ──────────────────────────────────────────────
// Every kind of guest reply used to land somewhere different and none of them was
// the screen she opens first: set-menu numbers raised a banner inside one event,
// à la carte picks sat under Menu packages, and a reply whose token matched no
// booking was visible nowhere at all. This loads the lot, unfiltered.
async function peLoadReplies(force){
  if(peState.repliesLoading) return;
  if(peState.repliesLoaded && !force) return;
  peState.repliesLoading = true;
  var r = await sb.from('event_menu_choices').select('*').eq('applied', false)
    .order('created_at',{ascending:false}).limit(50);
  peState.repliesLoading = false;
  // supabase-js does not throw. Only mark it loaded once it actually worked, or a
  // failed read looks exactly like "nobody has replied".
  if(r.error){
    peToast('Could not check for guest replies — '+String(r.error.message||'').slice(0,70), true);
    return;
  }
  peState.repliesLoaded = true;
  peState.replies = r.data||[];
  renderMain();
}
// What the guest actually sent, in one line she can read without opening anything.
function peReplySummary(row){
  var c = row.choices || {};
  if(row.menu_key === 'alacarte'){
    var d = c.dishes || [];
    return d.length ? d.join(' · ') : 'à la carte choices';
  }
  var parts = [];
  Object.keys(c).forEach(function(course){
    var picks = c[course];
    if(!picks || typeof picks !== 'object') return;
    var n = 0; Object.keys(picks).forEach(function(k){ n += Number(picks[k])||0; });
    if(n) parts.push(course+': '+n);
  });
  return parts.length ? parts.join(' · ') : 'menu choices';
}
function peReplyEvent(row){
  return (peState.events||[]).filter(function(e){ return e.client_token===row.token; })[0] || null;
}
function peRepliesHTML(){
  var rs = peState.replies || [];
  if(!rs.length) return '';
  return '<div class="pe-card" style="border-color:#C9A84C;background:#FBF6EA;margin-bottom:12px">'+
    '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:4px">'+
    '<b style="color:#400207">'+rs.length+' guest '+(rs.length>1?'replies':'reply')+' waiting</b>'+
    '<span style="font-size:11px;color:#4F4535;text-decoration:underline;cursor:pointer" onclick="peLoadReplies(true)">refresh</span></div>'+
    rs.map(function(row){
      var ev = peReplyEvent(row);
      var who = (row.choices && row.choices.guest) || (ev && (ev.client_name||ev.company)) || 'A guest';
      return '<div class="pe-dishrow"><span>'+
        '<b style="color:#400207">'+peEsc(who)+'</b>'+
        ' <span style="font-size:11px;color:#4F4535">'+peEsc(peWhenLabel(row.created_at))+
          (row.menu_key==='alacarte'?' · à la carte':' · set menu')+'</span>'+
        '<br><span style="font-size:12px;color:#6B4A33">'+peEsc(peReplySummary(row))+'</span>'+
        (row.note?'<br><span style="font-size:11.5px;color:#B00020">“'+peEsc(row.note)+'”</span>':'')+
        // A reply we cannot place is the one most likely to be lost, so it says so
        // in words rather than quietly showing "A guest".
        (!ev?'<br><span style="font-size:11.5px;color:#7F5C00">We can’t tell which booking this belongs to — open the booking and use “Check for the guest’s numbers”.</span>':'')+
        '</span>'+
        '<span style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap">'+
        (ev?'<button class="pe-btn sm" onclick="peGo(\'event\',\''+ev.id+'\')">Open booking</button>':'')+
        '<button class="pe-btn sec sm" onclick="peReplyDone(\''+row.id+'\')">Not needed</button>'+
        '</span></div>';
    }).join('')+'</div>';
}
async function peReplyDone(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var row = (peState.replies||[]).filter(function(r){ return r.id===id; })[0];
  if(!row) return;
  if(!(await peConfirm({title:'Clear this reply?',
    html:'The guest’s reply stays saved — this only takes it off the list.'+
      (peReplyEvent(row)?'<br><br>You can still pull their numbers in later from the booking.':''),
    ok:'Clear it', cancel:'Keep it'}))) return;
  var r = await sb.from('event_menu_choices').update({applied:true}).eq('id', id);
  if(r.error){ peToast('NOT cleared — '+String(r.error.message||'').slice(0,80), true); return; }
  peState.replies = (peState.replies||[]).filter(function(x){ return x.id!==id; });
  peToast('Cleared ✓');
  renderMain();
}
// A booking that is lost or has moved on can leave this banner asserting forever,
// because applying was the only thing that cleared it. Same idea as "Done with it"
// on the à la carte card: the guest's reply stays saved, it just stops asking.
async function peDismissMenuChoices(id){
  var e = peEvById(id); if(!e) return;
  if(!(await peConfirm({title:'Clear this from the screen?',
    html:'The guest’s reply stays saved — this only stops the reminder.'+
      '<br><br>You can still pull their numbers in later with <b>“Check for the guest’s numbers”</b>.',
    ok:'Clear it', cancel:'Keep it'}))) return;
  var r = await sb.from('event_menu_choices').update({applied:true})
    .eq('token', e.client_token).eq('applied', false).neq('menu_key','alacarte');
  if(r.error){ peToast('NOT cleared — '+String(r.error.message||'').slice(0,80), true); return; }
  if(peState.menuChoicesPending) delete peState.menuChoicesPending[e.client_token];
  peToast('Cleared ✓');
  renderMain();
}
// The log used to print the database's own column values at her — "email", "status",
// "unsigned". These are the same events in the words she would use.
var PE_LOG_WORDS = {
  followup:'', email:'Email sent', status:'Status', edited:'Changed', created:'Created',
  signed:'Client signed the agreement', unsigned:'Signature voided',
  // "opened", not "sent" — WhatsApp opens with the message written and she still
  // has to press send there, so the app can never know it actually went.
  whatsapp:'WhatsApp opened', client_link:'Guest link copied',
  agreement_link:'Signing link copied', payment_link:'Payment link sent'
};
function peLogLine(l){
  var d = l.detail || '';
  if(l.action === 'followup') return d;                 // her own note, as typed
  var w = PE_LOG_WORDS[l.action];
  if(w == null) w = l.action;                           // an action we haven't named yet
  return w ? (d ? w + ' — ' + d : w) : d;
}
// renderMain() replaces the input, so the caret has to be put back by hand. It used
// to be forced to the end of the text, which meant correcting a typo mid-word threw
// her cursor to the end on every single keystroke.
function peSearchInput(el){
  var pos = el.selectionStart;
  peState.q = el.value;
  renderMain();
  var n = document.querySelector('input[placeholder^="Search"]');
  if(n){ n.focus(); try{ n.setSelectionRange(pos, pos); }catch(err){} }
}
function peEventMatchesQuery(e, q){
  if(!q) return true;
  var hay = [e.client_name||'', e.company||'', e.contact_name||'', e.area||'', e.event_date||'', peDLabel(e.event_date)].join(' ').toLowerCase();
  return hay.indexOf(q)>=0;
}
function pePassesStatus(e, f){
  if(f==='all') return true;
  if(f==='open') return ['draft','sent','confirmed','deposit'].indexOf(e.status)>=0;
  return e.status===f;
}
// A summary-pill spotlight: narrows the list to just the events that pill counts.
// 'send' = drafts with an email that still need the proposal sent · 'sign' = sent
// and waiting on a signature · 'week' = open bookings happening within 7 days.
function peFocusMatch(e){
  var f = peState.focus;
  if(!f) return true;
  if(f==='week') return peTimeBucket(e)==='week' && ['draft','sent','confirmed','deposit'].indexOf(e.status)>=0;
  var ns = peNextStep(e);
  if(f==='send') return ns.label==='Send the proposal now';
  if(f==='sign') return ns.label==='Chase the signature';
  return true;
}
// ── "Who took the lead" — every booking carries handled_by (defaults to whoever
// created it). These let the desk be read one person at a time without changing
// the record: it's a view, not an edit. ──
function peLeadLabel(h){ h = String(h||''); return h.indexOf('@')>=0 ? h.split('@')[0] : h; }
// The effective lead credited with a booking: the person set in "Handled by", or —
// when that's blank — whoever actually sent the proposal. One definition, so the
// name shown in brackets on the list and the person the report is scoped to agree.
function peEffLead(e){ return (e && (e.handled_by || (peState.proposalBy && peState.proposalBy[e.id]))) || ''; }
// Distinct effective leads present in the book (drives the monthly-report person
// filter), most-common name first.
function peReportLeadKeys(){
  var counts = {};
  (peState.events||[]).forEach(function(e){ var L = peEffLead(e); if(L) counts[L] = (counts[L]||0)+1; });
  return Object.keys(counts).sort(function(a,b){ return peLeadLabel(a).localeCompare(peLeadLabel(b)); });
}
// Does this event belong to the person the report is scoped to? 'all' = everyone.
function peReportLeadMatch(e){
  var L = peState.reportLead || 'all';
  if(L==='all') return true;
  return peEffLead(e) === L;
}
// The signed-in person, as they appear in handled_by (name if we have it, else email).
function peMyLeadVals(){
  var v = [];
  if(state.access && state.access.name) v.push(String(state.access.name).toLowerCase());
  if(state.userEmail) v.push(String(state.userEmail).toLowerCase());
  return v;
}
function peIsMine(e){
  var h = String(e.handled_by||'').toLowerCase(); if(!h) return false;
  var hl = h.indexOf('@')>=0 ? h.split('@')[0] : h;
  return peMyLeadVals().some(function(m){ var ml = m.indexOf('@')>=0 ? m.split('@')[0] : m; return m===h || ml===hl; });
}
function peMatchesLead(e){
  var L = peState.lead || 'all';
  if(L==='all') return true;
  if(L==='mine') return peIsMine(e);
  return String(e.handled_by||'') === L;
}
// The distinct leads present in the book, most-used first — drives the chip row.
function peLeadKeys(){
  var counts = {};
  (peState.events||[]).forEach(function(e){ var h = e.handled_by ? String(e.handled_by) : ''; if(h) counts[h] = (counts[h]||0)+1; });
  return Object.keys(counts).sort(function(a,b){ return peLeadLabel(a).localeCompare(peLeadLabel(b)); });
}
function peSetLead(i){ var d = (peState._leadDefs||[])[i]; peState.lead = d ? d.k : 'all'; renderMain(); }
// The monthly report's own person scope (kept separate from the list's lead filter).
function peSetReportLead(i){ var d = (peState._reportLeadDefs||[])[i]; peState.reportLead = d ? d.k : 'all'; renderMain(); }
function peFilteredEvents(){
  var f = peState.filter, q = (peState.q||'').toLowerCase();
  return peState.events.filter(function(e){
    return peEventMatchesQuery(e, q) && pePassesStatus(e, f) && peFocusMatch(e) && peMatchesLead(e);
  });
}
// Tapping a summary pill spotlights those events (tap again to clear). We widen
// the status filter to Open so the spotlighted bookings are guaranteed visible.
function pePillFocus(kind){
  peState.focus = (peState.focus===kind) ? null : kind;
  if(peState.focus) peState.filter = 'open';
  renderMain();
  var mc = document.getElementById('foh-tab-content') || document.getElementById('main-content'); if(mc) mc.scrollTop = 0;
}
// Colours for the "next step" chips — plain code Valentina reads on the phone:
// red = something missing, amber = do it now, blue = waiting on the client, green = done.
var PE_CHIP = {
  danger:'background:#EDB9B0;color:#7E1A0C', warn:'background:#F5D98A;color:#6B4A00',
  info:'background:#B3D2EC;color:#12456E', success:'background:#B8DEB4;color:#1C5A25',
  neutral:'background:#E4DBCC;color:#4E4433'
};
// The same step, as the key he picked: it sits ON the glass rather than staining it.
// Wine is the routine step (20 of 22 rows say "Add the menu") and gold is the one
// that must go out today, so the loudest paint is no longer also the most common.
var PE_KEY = {
  danger: 'background:linear-gradient(180deg,#7D2634 0,#6B1F2A 100%);color:#F9F1E4;'+
          'box-shadow:0 2px 0 #431019,0 5px 12px -4px rgba(48,10,18,.45),inset 0 1px 0 rgba(255,255,255,.22)',
  warn:   'background:linear-gradient(180deg,#E0BC62 0,#C9A84C 100%);color:#3A2B06;'+
          'box-shadow:0 2px 0 #8E7422,0 5px 12px -4px rgba(58,43,6,.40),inset 0 1px 0 rgba(255,255,255,.50)',
  info:   'background:linear-gradient(180deg,#4E8CC4 0,#3E7FBB 100%);color:#F4F9FD;'+
          'box-shadow:0 2px 0 #23527D,0 5px 12px -4px rgba(18,69,110,.40),inset 0 1px 0 rgba(255,255,255,.28)',
  success:'background:linear-gradient(180deg,#4E9E56 0,#3F8A47 100%);color:#F3FAF4;'+
          'box-shadow:0 2px 0 #26602D,0 5px 12px -4px rgba(28,90,37,.40),inset 0 1px 0 rgba(255,255,255,.26)',
  neutral:'background:linear-gradient(180deg,#D9CFBD 0,#C8BBA4 100%);color:#403729;'+
          'box-shadow:0 2px 0 #9A8B70,0 5px 12px -4px rgba(78,68,51,.35),inset 0 1px 0 rgba(255,255,255,.6)'
};
// Has this event's team brief actually gone out? Read from the send log only:
// a brief that failed to send must never show as sent, or the kitchen and the
// hostess team reach the night not knowing about a confirmed event.
function peBriefSent(e){ return !!(peState.briefSent && peState.briefSent[e.id]); }
// When the proposal last went to the client, or null. Also updated in-session after
// a send, so the button flips to "Re-send" without waiting for a reload.
function peProposalSent(e){ return (e && peState.proposalSent && peState.proposalSent[e.id]) || null; }
// The brief the team holds is a snapshot frozen at send time — nothing refreshes it.
// So once it has gone, a change to any of these makes their copy wrong, and only she
// can put that right by re-sending. Deliberately NOT `updated_at > sent_at`: routine
// bookkeeping after the night moves updated_at and would cry wolf on every event.
// Money fields are left out on purpose — they don't change what the kitchen cooks.
var PE_BRIEF_FIELDS = ['Guests','Date','Area','Start time','End time'];
function peBriefChangedSince(e, log){
  var sent = peState.briefSent && peState.briefSent[e.id];
  if(!sent) return [];
  var t = new Date(sent).getTime();
  return (log||[]).filter(function(l){
    if(l.action!=='edited' || !l.detail) return false;
    if(new Date(l.created_at).getTime() <= t) return false;
    return PE_BRIEF_FIELDS.some(function(f){ return l.detail.indexOf(f+' →')===0; });
  });
}
// The one action this booking needs next.
function peNextStep(e){
  var name = e.client_name || e.company;
  if(e.status==='lost') return {label:'Lost', kind:'neutral'};
  if(e.status==='done') return {label:'Done', kind:'success'};
  // A sent team brief is the strongest signal the event is real and ON — the team
  // already has it, so never nag for a client email once the brief has gone out
  // (e.g. a direct booking with no guest email). But if the booking was never marked
  // Confirmed/Deposit, say so and nudge it: a paid, briefed event left as a draft
  // drops out of the revenue figures, so this must not look "all done".
  if(peBriefSent(e)) return (e.status==='confirmed' || e.status==='deposit')
    ? {label:'Team brief sent ✓', kind:'success'}
    : {label:'Team brief sent — confirm it', kind:'warn'};
  if(e.status==='draft' || e.status==='sent'){
    if(!name && !e.event_date) return {label:'Add a name and date', kind:'danger'};
    if(!e.event_date) return {label:'Add a date', kind:'danger'};
    if(!name) return {label:'Add a name', kind:'danger'};
    if(!e.guests) return {label:'Add the guest count', kind:'danger'};
    if(!e.area) return {label:'Add the area', kind:'danger'};
  }
  // The list chip and the editor chip used to disagree on the same booking — the
  // list promised "Send the proposal now" on a booking with no menu and no price,
  // while the editor was still asking for both. The list is the one she reads when
  // she is working fast, so it now knows the same two facts peEditorNext knows.
  var pItems = peState.items[e.id]||[];
  var pFood = pItems.length>0 || !!e.set_menu || (e.food_price_pp!=null && e.food_price_pp!=='');
  var pBev = !!e.bev_package_id || e.bev_mode==='dry';
  var pT = peCalcTotals(e);
  var pPriced = !!pT.total || !!e.min_spend;
  if((e.status==='draft' || e.status==='sent') && !pFood && !pBev)
    return {label:'Add the menu', kind:'danger'};
  // No email = nothing to send to — the chip must ask for the email, not promise a send.
  // Unpriced but with a menu is not a dead end: that is exactly the menu-only send,
  // so the chip names it rather than pointing at an agreement that would read AED 0.
  if(e.status==='draft') return e.contact_email
    ? (pPriced ? {label:'Send the proposal now', kind:'warn'} : {label:'Send the menu — price it later', kind:'info'})
    : {label:'Add the client email', kind:'danger'};
  if(e.status==='sent') return e.signed_at ? {label:'Confirm the booking', kind:'warn'} : {label:'Chase the signature', kind:'info'};
  // Every other step flips the status once it's done, so its chip moves on by itself.
  // The brief doesn't — so the chip has to say, on its own, whether it's been sent.
  if(e.status==='confirmed' || e.status==='deposit') return peBriefSent(e)
    ? {label:'Team brief sent ✓', kind:'success'}
    : {label:'Send the team brief', kind:'warn'};
  return {label:'', kind:'neutral'};
}
// A draft never given a name, date or guests — clutter to be tidied, not a booking.
function peIsEmptyDraft(e){ return e.status==='draft' && !(e.client_name||e.company) && !e.event_date && !e.guests; }
function peTimeBucket(e){
  var d = e.event_date ? String(e.event_date).slice(0,10) : null;
  if(!d) return 'nodate';
  var today = peToday(), wkEnd = localISO(new Date(Date.now()+7*86400000));
  if(d < today) return 'past';
  if(d <= wkEnd) return 'week';
  return 'later';
}
// The "state of my world" counts, over everything (not just the current filter).
function peLandingStats(){
  var today = peToday(), wkEnd = localISO(new Date(Date.now()+7*86400000));
  var s = {week:0, send:0, sign:0, empty:0};
  peState.events.forEach(function(e){
    if(peIsEmptyDraft(e)){ s.empty++; return; }
    var open = ['draft','sent','confirmed','deposit'].indexOf(e.status)>=0;
    var d = e.event_date ? String(e.event_date).slice(0,10) : null;
    if(open && d && d>=today && d<=wkEnd) s.week++;
    var ns = peNextStep(e);
    // Both are a booking waiting to be sent something — a menu-only send is still
    // a send, so it must not quietly drop out of the "to send" count.
    if(ns.label==='Send the proposal now' || ns.label==='Send the menu — price it later') s.send++;
    else if(ns.label==='Chase the signature') s.sign++;
  });
  return s;
}
// A summary pill. When it has an onclick it becomes a filter chip: an arrow hints
// it's tappable, and the active one gets a ring + the arrow flips to ✕ (tap to clear).
function peStatPill(n, label, bg, border, numCol, lblCol, onclick, active){
  var base = 'background:'+bg+';border:1.5px solid '+border+';border-radius:11px;padding:8px 13px;font-size:12.5px;display:inline-flex;align-items:center;gap:7px;transition:box-shadow .12s,transform .08s';
  var tap = onclick ? ';cursor:pointer' : '';
  var act = active ? ';box-shadow:0 0 0 3px '+numCol+'33,0 2px 7px rgba(64,2,7,.16);transform:translateY(-1px)' : '';
  var cue = onclick ? '<span style="font-size:11px;font-weight:700;color:'+lblCol+';opacity:.75">'+(active?'✕':'›')+'</span>' : '';
  return '<div class="pe-statpill" style="'+base+tap+act+'"'+(onclick?' onclick="'+onclick+'"':'')+'>'+
    '<span><b style="font-size:17px;color:'+numCol+'">'+n+'</b> <span style="color:'+lblCol+'">'+label+'</span></span>'+cue+'</div>';
}
function peListRow(e){
  var ns = peNextStep(e);
  var val = peEventValue(e);
  var parts = [];
  if(e.event_date) parts.push(peDLabel(e.event_date)+(e.time_from?' · '+peEsc(e.time_from):''));
  // #4 — a held date, at Valentina's request "as a option, not automatic": nothing
  // expires by itself, the chip just turns red once the promise date has passed so
  // she chases the client instead of the date quietly rotting in a draft.
  if(e.hold_until && ['confirmed','deposit','done','lost'].indexOf(e.status)<0){
    var expired = String(e.hold_until).slice(0,10) < peToday();
    parts.push(expired
      ? '<b style="color:#B00020">HOLD EXPIRED '+peDLabel(e.hold_until)+' — chase or release</b>'
      : '<b style="color:#7F5C00">HELD until '+peDLabel(e.hold_until)+'</b>');
  }
  if(e.area) parts.push(peEsc(e.area));
  else if(['draft','sent'].indexOf(e.status)>=0) parts.push('<span style="color:#B00020">no area yet</span>');
  if(e.guests) parts.push(e.guests+' guests');
  // Who took the lead — shown in brackets after the name so the desk reads at a
  // glance whose booking each one is. Prefer "Handled by"; when that's blank, fall
  // back to whoever actually sent the proposal (from the log). Name without domain.
  var leadRaw = peEffLead(e);
  var lead = leadRaw ? peLeadLabel(leadRaw) : '';
  var nameHtml = peEsc(e.client_name||e.company||'Unnamed')+(e.company&&e.client_name?' <span style="font-weight:400;color:#5C3D2E">· '+peEsc(e.company)+'</span>':'')+(lead?' <span style="font-weight:400;color:#5C3D2E">('+peEsc(lead)+')</span>':'');
  // The colour down the left edge and the dot beside the name are the booking's status,
  // straight off PE_STATUS_COL -- the same six colours the calendar legend and the status
  // pills already use, so the row says where it stands without spending a word on it.
  var scol = (PE_STATUS_COL[e.status] || PE_STATUS_COL.draft).b;
  return '<div class="pe-lrow" style="--sc:'+scol+'" title="'+peEsc(peStatusMeta(e.status).n)+'" onclick="peGo(\'event\',\''+e.id+'\')">'+
    '<span class="pe-spine"></span><span class="pe-sdot"></span>'+
    '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;color:#2C1810">'+nameHtml+'</div>'+
    '<div style="font-size:11.5px;color:#5C3D2E">'+(parts.join(' · ')||'—')+'</div></div>'+
    (val?'<div class="pe-hide-m" style="font-size:13px;color:#5C3D2E;white-space:nowrap">AED '+peMoney(val)+'</div>':'')+
    (ns.label?'<span onclick="event.stopPropagation();peGo(\''+(peCanEdit()?'guidedevent':'event')+'\',\''+e.id+'\')" style="'+PE_KEY[ns.kind]+';border-radius:9px;padding:7px 13px;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer" class="pe-key">'+ns.label+'</span>':'')+
  '</div>';
}
function peRenderList(){
  var filters = [['open','Open'],['draft','Draft'],['sent','Sent'],['confirmed','Confirmed'],['deposit','Deposit paid'],['done','Done'],['lost','Lost'],['all','All']];
  var filterName = {open:'Open',draft:'Draft',sent:'Sent',confirmed:'Confirmed',deposit:'Deposit paid',done:'Done',lost:'Lost',all:'All'};
  // If the book is back down to a single lead, drop any leftover lead filter BEFORE
  // filtering, so a stale "Mine"/person selection can never silently hide events.
  if(peLeadKeys().length < 2 && (peState.lead||'all')!=='all') peState.lead = 'all';
  var all = peFilteredEvents();
  var collapse = (peState.filter==='open' || peState.filter==='all') && !(peState.q && peState.q.trim());
  var empties = collapse ? all.filter(peIsEmptyDraft) : [];
  var emptyIds = {}; empties.forEach(function(e){ emptyIds[e.id]=1; });
  var evs = all.filter(function(e){ return !emptyIds[e.id]; });
  var pipeline = 0;
  all.forEach(function(e){ var t = peEventValue(e); if(t && ['draft','sent','confirmed','deposit'].indexOf(e.status)>=0) pipeline += t; });
  var st = peLandingStats();
  var h = peHeader('list');
  // The band says what is true right now, not "Events" -- the word above a list
  // of events earns nothing. Live = the four statuses that are still work.
  var onBook = all.filter(function(e){ return ['draft','sent','confirmed','deposit'].indexOf(e.status) >= 0; }).length;
  h += peRoom('list', 'Roberto’s DIFC · Private events',
    onBook ? (onBook + ' event' + (onBook>1?'s':'') + ' on the book') : 'Nothing on the book yet',
    peCanEdit() ? 'Create a booking, quote it, send the agreement.' : 'Every booking, readable end to end.');
  h += peViewBanner();
  h += peTonightHTML();   // what is on TODAY outranks everything else on this screen
  h += peRepliesHTML();   // then replies: a reply that waits is the costliest thing here
  var fo = peState.focus;
  h += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:'+(fo?'8px':'12px')+'">'+
    peStatPill(st.week,'this week','#FBF6EC','#C9A84C','#8A6400','#6B4A33','pePillFocus(\'week\')',fo==='week')+
    peStatPill(st.send,'to send','#F5D98A','#C99A12','#6B4A00','#6B4A00','pePillFocus(\'send\')',fo==='send')+
    peStatPill(st.sign,'waiting to sign','#B3D2EC','#3E7FBB','#12456E','#12456E','pePillFocus(\'sign\')',fo==='sign')+
    (st.empty&&peCanEdit()?peStatPill(st.empty,'empty draft'+(st.empty>1?'s':''),'#E4DBCC','#B9A98C','#4E4433','#4E4433','peTidyDrafts()'):'')+
  '</div>';
  if(fo){
    var fLbl = {send:'events that still need the proposal sent', sign:'events sent and waiting for a signature', week:'events happening this week'}[fo];
    h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#FBF3DE;border:1px solid #C9A84C;border-radius:10px;padding:9px 13px;margin-bottom:12px;font-size:12.5px;color:#6B4A00">'+
      '<span>Showing <b>'+fLbl+'</b></span>'+
      '<span style="color:#400207;text-decoration:underline;cursor:pointer;white-space:nowrap" onclick="peState.focus=null;renderMain()">Show all events</span></div>';
  }
  h += '<div class="pe-card">';
  // A count on each status chip — how many bookings are Done, Lost, Deposit paid…
  // Respects the active search + lead filter so each number matches what a click shows.
  var _fq = (peState.q||'').toLowerCase();
  var _fbase = peState.events.filter(function(e){ return peEventMatchesQuery(e,_fq) && peMatchesLead(e); });
  var _fcount = {}; filters.forEach(function(f){ _fcount[f[0]] = _fbase.filter(function(e){ return pePassesStatus(e,f[0]); }).length; });
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;border-bottom:1px solid rgba(107,31,42,0.1);padding-bottom:10px;margin-bottom:4px">'+filters.map(function(f){
    return '<span class="pe-tab'+(peState.filter===f[0]?' on':'')+'" style="font-size:11px;padding:4px 11px" onclick="peState.filter=\''+f[0]+'\';peState.focus=null;renderMain()">'+f[1]+' <span style="opacity:.55;font-weight:400">'+_fcount[f[0]]+'</span></span>';
  }).join('')+
  '<input class="pe-in" style="width:210px;margin-left:auto" placeholder="Search name, company, date or area\u2026" value="'+peEsc(peState.q||'')+'" oninput="peSearchInput(this)">'+
  '</div>';
  // ── Lead filter — only when more than one person has taken a lead, so a
  // single-handler desk never grows a chip row that just says "Everyone". ──
  var leadKeys = peLeadKeys();
  if(leadKeys.length >= 2){
    var leadDefs = [{k:'all',n:'Everyone'},{k:'mine',n:'Mine'}].concat(leadKeys.map(function(hk){ return {k:hk, n:peLeadLabel(hk)}; }));
    peState._leadDefs = leadDefs;
    var curLead = peState.lead || 'all';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0 2px"><span style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#544418;margin-right:2px">Lead</span>'+
      leadDefs.map(function(d,i){
        return '<span class="pe-tab'+(curLead===d.k?' on':'')+'" style="font-size:11px;padding:4px 11px" onclick="peSetLead('+i+')">'+peEsc(d.n)+'</span>';
      }).join('')+'</div>';
  } else if((peState.lead||'all')!=='all'){
    peState.lead = 'all';  // was filtered to a person who no longer has events — reset so nothing hides
  }
  if(!all.length){
    var qNow = (peState.q||'').toLowerCase();
    if((peState.lead||'all')!=='all'){
      var lname = peState.lead==='mine' ? 'you' : peLeadLabel(peState.lead);
      h += '<div style="text-align:center;padding:22px;color:#4F4535;font-size:13px">No events here for <b>'+peEsc(lname)+'</b>. <span style="color:#400207;text-decoration:underline;cursor:pointer" onclick="peState.lead=\'all\';renderMain()">Show everyone</span></div>';
      h += '</div>';
      return h+PE_FOOT;
    }
    var inAll = peState.events.filter(function(e){ return peEventMatchesQuery(e, qNow); }).length;
    if(peState.focus){
      h += '<div style="text-align:center;padding:22px;color:#4F4535;font-size:13px">Nothing here right now — everything in this group is handled. <span style="color:#400207;text-decoration:underline;cursor:pointer" onclick="peState.focus=null;renderMain()">Show all events</span></div>';
    } else if(peState.filter!=='all' && inAll){
      h += '<div style="text-align:center;padding:22px;color:#4F4535;font-size:13px">No results in <b>'+filterName[peState.filter]+'</b> — '+inAll+' more in <span style="color:#400207;text-decoration:underline;cursor:pointer" onclick="peState.filter=\'all\';renderMain()">All</span>.</div>';
    } else if(qNow){
      h += '<div style="text-align:center;padding:22px;color:#4F4535;font-size:13px">Nothing matches your search. <span style="color:#400207;text-decoration:underline;cursor:pointer" onclick="peState.q=\'\';renderMain()">Clear search</span></div>';
    } else {
      h += '<div style="text-align:center;padding:26px;color:#4F4535;font-size:13px">'+(peCanEdit()?'No events here yet. Tap “+ New event” to start a quotation.':'No events here yet.')+'</div>';
    }
  }
  h += '</div>';
  // grouped by time — soonest first, so Valentina reads her week top-down
  if(evs.length){
    var byBucket = {};
    evs.forEach(function(e){ var b = peTimeBucket(e); (byBucket[b]=byBucket[b]||[]).push(e); });
    // Just "Earlier" — the group carries finished and lost bookings too, so
    // "still open" was telling her to chase events that are already done.
    var groups = [['past','Earlier'],['week','This week'],['later','Later'],['nodate','No date yet']];
    groups.forEach(function(g){
      var list = (byBucket[g[0]]||[]).sort(function(a,b){ return String(a.event_date||'9999').localeCompare(String(b.event_date||'9999')); });
      if(!list.length) return;
      h += '<div style="font-size:11.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#544418;margin:16px 2px 7px">'+g[1]+'</div>'+
        '<div class="pe-tray">'+list.map(peListRow).join('')+'</div>';
    });
  }
  if(empties.length && peCanEdit()){
    h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#F1EDE6;border:1px dashed #D8CDBB;border-radius:12px;padding:11px 14px;margin-top:6px">'+
      '<div style="font-size:12.5px;color:#6B5E4E">'+empties.length+' empty draft'+(empties.length>1?'s':'')+' started but never filled in</div>'+
      '<button class="pe-btn sec sm" onclick="peTidyDrafts()">Review &amp; tidy up</button></div>';
  }
  h += '<div style="font-size:11.5px;color:#4F4535;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-top:10px"><span>'+all.length+' event'+(all.length===1?'':'s')+' shown</span><span>Open pipeline value: AED '+peMoney(pipeline)+'</span></div>';
  if(all.length>8) h += peScrollTopBtn();
  return h+PE_FOOT;
}
// Tidy-up modal for the empty drafts.
function peTidyDrafts(){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var old = document.querySelector('.pe-modal-bg'); if(old) old.remove();
  var empties = peState.events.filter(peIsEmptyDraft);
  var bg = document.createElement('div'); bg.className='pe-modal-bg';
  bg.addEventListener('click', function(ev){ if(ev.target===bg) bg.remove(); });
  var rows = empties.length ? empties.map(function(e){
    return '<div class="pe-dishrow"><span style="font-size:12.5px;color:#6B4A33">Empty draft'+(e.guests?' · '+e.guests+' guests':'')+(e.event_date?' · '+peDLabel(e.event_date):'')+'</span>'+
      '<button class="pe-btn sec sm" style="color:#B00020;border-color:#B00020" onclick="peTidyDeleteOne(\''+e.id+'\')">Delete</button></div>';
  }).join('') : '<div style="font-size:12.5px;color:#4F4535;padding:8px 0">No empty drafts — all tidy.</div>';
  bg.innerHTML = '<div class="pe-modal" style="max-width:460px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="color:#400207">Tidy up empty drafts</b><span class="pe-x" onclick="this.closest(\'.pe-modal-bg\').remove()">✕</span></div>'+
    '<div style="font-size:11.5px;color:#4F4535;margin-bottom:8px">These were started but never given a name, date or guests. Delete the ones you don’t need.</div>'+
    rows+
    (empties.length>1?'<div style="margin-top:12px"><button class="pe-btn" style="background:#B00020;border-color:#B00020" onclick="peTidyDeleteAll()">Delete all '+empties.length+'</button></div>':'')+
    '</div>';
  document.body.appendChild(bg);
}
async function peDeleteEmptyDraft(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return false; }
  var e = peEvById(id); if(!e || e.status!=='draft') return true;
  var r = await sb.from('events_desk').delete().eq('id', id);
  if(r.error){ peToast('Delete failed — check connection', true); return false; }
  peState.events = peState.events.filter(function(x){ return x.id!==id; });
  return true;
}
async function peTidyDeleteOne(id){ if(await peDeleteEmptyDraft(id)){ peTidyDrafts(); renderMain(); } }
async function peTidyDeleteAll(){
  var empties = peState.events.filter(peIsEmptyDraft);
  if(!empties.length) return;
  if(!(await peConfirm({title:'Delete all empty drafts?', html:'Delete all <b>'+empties.length+'</b> empty draft'+(empties.length>1?'s':'')+'? They have no name, date or guests, and this cannot be undone.', ok:'Delete', cancel:'Keep them', danger:true}))) return;
  var ok = true;
  for(var i=0;i<empties.length;i++){ if(!(await peDeleteEmptyDraft(empties[i].id))){ ok=false; break; } }
  var bg = document.querySelector('.pe-modal-bg'); if(bg) bg.remove();
  if(ok) peToast('Empty drafts cleared ✓');
  renderMain();
}
// What a booking is WORTH to the business. This must agree with the agreement we
// signed, so it simply asks peAgBase — the same function the deposit is taken on.
// It used to read the package total first, so a minimum-spend booking that ordered
// less than its minimum was reported at what they ordered (60k) while the contract
// said 150k, and every headline number was short by the difference.
// Andrea Sacchi, 17 Jul 2026: the balance between the minimum spend and what they
// actually consume (F&B, decoration, AV, extra staffing) "is to be billed as venue
// rental" — so the whole minimum is ours either way. Splitting that balance into
// its parts is a separate piece of work; this only makes the TOTAL honest.
function peEventValue(e){
  // Real revenue, typed after the night ran (more guests than quoted, extra bar or
  // off-menu spend). Once set, it IS this booking's value everywhere it is reported
  // — list, calendar, monthly report, pipeline. The deposit and signed agreement
  // are unaffected: those read peAgBase, which stays on the quoted price.
  if(e.actual_revenue!=null && e.actual_revenue!=='') return Math.max(0, Number(e.actual_revenue));
  // Valentina, 17 Jul 2026 (#12): "Send me three options and I'll pick one."
  // Three options are ONE enquiry, so this returns ONE number — never the sum,
  // which would book the same guest three times over. Until they pick, we count
  // the LOWEST option: the most we can honestly claim is the least they might
  // spend. The report says so in words rather than leaving it to be guessed.
  // The moment an option is chosen it has been written onto the booking, so the
  // ordinary calculation below is the right one again.
  if(peHasOptions(e) && !peChosenOption(e)){
    var vals = peOptionValues(e);
    if(vals.length) return Math.min.apply(null, vals);
  }
  var v = peAgBase(e);                       // respects pricing_type — min spend means the minimum
  if(v != null && v !== 0) return v;
  return e.min_spend ? Number(e.min_spend) : null;
}

// ── Andrea's reporting lens ──────────────────────────────────────────────────
// The COO reads the book as lead → prospect → tentative → converted. Valentina
// works in draft → proposal sent → confirmed → deposit paid → done. These are the
// SAME rows: the stage is DERIVED here and never stored, so her screens keep her
// words and the report speaks his. Never show PE_STAGE names on the events desk.
// Andrea Sacchi, 17 Jul 2026:
//   "unconfirmed prospect without a date should be recorded under leads and
//    highlighted as to be actioned but not included in the pipeline yet"
//   "we need to know whats a prospect, tentative and converted"
//   "future confirmed event on the book are converted pipeline"
var PE_STAGE = {
  lead:      {n:'Lead',      d:'No date yet — needs chasing'},
  prospect:  {n:'Prospect',  d:'Has a date, not quoted yet'},
  tentative: {n:'Tentative', d:'Quoted, waiting on the client'},
  converted: {n:'Converted', d:'Confirmed, deposit paid or delivered'},
  lost:      {n:'Lost',      d:'Gone'}
};
function peIsConverted(e){ return ['confirmed','deposit','done'].indexOf(e.status) >= 0; }
function peStage(e){
  if(e.status === 'lost') return 'lost';
  if(peIsConverted(e)) return 'converted';   // a confirmed booking is converted even with no date yet
  if(!e.event_date) return 'lead';           // unconfirmed AND undated = a lead, deliberately NOT pipeline
  return e.status === 'sent' ? 'tentative' : 'prospect';
}
// Only real, dated, unconfirmed business counts as pipeline. Leads are excluded on
// Andrea's instruction — an undated maybe used to inflate the pipeline while an
// undated CONFIRMED booking counted in nothing at all.
function peInPipeline(e){ var s = peStage(e); return s === 'prospect' || s === 'tentative'; }
// A converted booking with no date is real money we cannot schedule — it must be
// visible and chased, never silently dropped the way it used to be.
function peNeedsDate(e){ return peIsConverted(e) && !e.event_date; }
// Every price in this module is what the client is quoted: GROSS, carrying 10%
// service + 7% DIFC + 5% VAT (PE_GROSS). Finance books the net. Andrea asked to
// see "both numbers", so nothing is ever shown without saying which it is.
function peNetOf(gross){ return (gross == null) ? null : gross / PE_GROSS; }
// The other direction — what a NET figure is worth at the price a client is
// quoted. Needed because the events target is set in NET (Francesco, 18 Jul
// 2026) while every booking on this module is valued GROSS, so one of the two
// has to be converted before they can honestly be compared.
function peGrossOf(net){ return (net == null) ? null : net * PE_GROSS; }
// A buyout takes the whole venue — it hits every other guest and the whole
// operation, so Andrea asked for these to stand out rather than read like a
// normal booking. ("Buy out affect the whole operation and our guest and should
// be better monitored by highlighting them.")
function peIsBuyout(e){
  return String(e.event_type || '') === 'Full buyout' || String(e.area || '') === 'Full venue';
}

// ── One booking that is bigger than one row ─────────────────────────────────
// Three separate things Valentina asked for on 17 Jul 2026 all had the same
// shape: a real enquiry does not fit in one date, one room, or one price, so
// she was building TWO OR THREE BOOKINGS and tidying up by hand afterwards.
// Each is fixed on its own terms below, and all three share one rule: the
// booking stays ONE row, so the pipeline still counts it once.
//
//   #5  spaces     — "Canapés in the Cortile first, then dinner in Piemonte."
//   #12 options    — "Send me three options and I'll pick one."
//   #13 alt_dates  — "Either the 12th or the 19th — whichever you have."
//
// In all three the ORIGINAL columns still hold the first/primary answer
// (area + time_from/time_to, event_date, the event's own price). That is not
// tidiness — it means every booking ever made is already valid, every screen
// that reads e.area or e.event_date keeps working untouched, and there was
// nothing to migrate.

// ── #5 — the run of the evening ─────────────────────────────────────────────
// Valentina's whole verdict on this one was two words: "only 1 price". So a
// second space adds a ROOM and a TIME to the evening and never a second price.
// There is exactly one total on the proposal, exactly as she asked.
// RAW is what the editor shows: a leg she has just added is still blank, and
// filtering it out would delete the row under her hands before she can type in
// it. Everything that DISPLAYS or checks a booking uses the filtered list below,
// so a half-typed leg never reaches a guest document or a clash warning.
function peExtraSpacesRaw(e){
  return (e && Array.isArray(e.spaces) ? e.spaces : []).filter(Boolean);
}
function peExtraSpaces(e){
  return peExtraSpacesRaw(e).filter(function(s){ return !!s.area; });
}
function peIsMultiSpace(e){ return peExtraSpaces(e).length > 0; }
// Every leg of the evening, first leg first. The first leg IS the event's own
// area/time, so a one-room booking returns exactly what it always did.
function peSpaceList(e){
  var out = [];
  if(e && (e.area || e.time_from)) out.push({ area:e.area||'', from:e.time_from||'', to:e.time_to||'', note:'', primary:true });
  peExtraSpaces(e).forEach(function(s){
    out.push({ area:s.area||'', from:s.from||'', to:s.to||'', note:s.note||'', primary:false });
  });
  return out;
}
// "Cortile 19:00–20:30, then Piemonte 20:30–23:00" — one line, for the guest.
function peRunOfEvening(e){
  return peSpaceList(e).map(function(s){
    var t = [s.from, s.to].filter(Boolean).join('–');
    return (s.note ? s.note+': ' : '') + (s.area||'—') + (t ? ' ' + t : '');
  }).join(', then ');
}

// ── #13 — two possible dates ────────────────────────────────────────────────
// event_date stays the FIRST choice, so the month filter, the report and every
// total keep counting this booking exactly ONCE. The alternatives are dates the
// booking also holds — they show on the calendar so neither is forgotten, and
// they are deliberately NOT a second row in anybody's pipeline.
function peAltDatesRaw(e){
  return (e && Array.isArray(e.alt_dates) ? e.alt_dates : []).filter(Boolean);
}
function peAltDates(e){
  return peAltDatesRaw(e).filter(function(d){ return !!d.date; });
}
function peHasAltDates(e){ return peAltDates(e).length > 0; }
// Primary first, then the alternatives. Times fall back to the event's own.
function peCandidateDates(e){
  var out = [];
  if(e && e.event_date) out.push({ date:String(e.event_date).slice(0,10), from:e.time_from||'', to:e.time_to||'', primary:true });
  peAltDates(e).forEach(function(d){
    out.push({ date:String(d.date).slice(0,10), from:d.from||'', to:d.to||'', primary:false });
  });
  return out;
}

// ── #12 — three options, one enquiry ────────────────────────────────────────
// An option is a whole alternative the guest is being offered: its own room,
// guest count and price. Picking one WRITES it onto the booking (peApplyOption),
// so from that moment there is nothing special about this enquiry at all.
var PE_OPTION_KEYS = ['A','B','C','D'];
function peOptions(e){
  return (e && Array.isArray(e.options) ? e.options : []).filter(function(o){ return o && o.key; });
}
function peHasOptions(e){ return peOptions(e).length > 0; }
function peChosenOption(e){
  if(!e || !e.option_chosen) return null;
  var m = peOptions(e).filter(function(o){ return o.key === e.option_chosen; });
  return m.length ? m[0] : null;
}
// What one option would come to. A minimum-spend option is worth its minimum,
// exactly as a minimum-spend booking is (peEventValue) — the two must agree.
function peOptionTotal(e, o){
  if(!o) return null;
  if(o.min_spend) return Number(o.min_spend) || null;
  var g = (o.guests != null && o.guests !== '') ? Number(o.guests) : Number(e && e.guests);
  var pp = Number(o.price_pp) || 0;
  return (g && pp) ? g * pp : null;
}
function peOptionValues(e){
  return peOptions(e).map(function(o){ return peOptionTotal(e, o); })
                     .filter(function(v){ return v != null && v > 0; });
}

// ── calendar view ────────────────────────────────────────────────────────────
// The month, built once. The screen and the printed calendar both read this —
// two copies of this arithmetic would drift, and the thing that would drift is
// the money.
function peCalMonthMap(mk){
  var y = +mk.slice(0,4), mo = +mk.slice(5,7);
  var first = new Date(y, mo-1, 1);
  // #13 — a booking that is holding two possible dates appears on BOTH, so
  // neither is forgotten and nobody sells the second one out from under it. The
  // alternative is marked `held`, and every COUNT and every TOTAL below ignores
  // held entries — one booking is one booking, however many days it is sitting
  // on. Getting this wrong would have shown the same money twice.
  var byDate = {};
  var put = function(ds, e, held){ (byDate[ds] = byDate[ds] || []).push({e:e, held:held}); };
  (peState.events||[]).forEach(function(e){
    if(e.event_date && peMonthKey(e.event_date)===mk) put(String(e.event_date).slice(0,10), e, false);
    peAltDates(e).forEach(function(d){
      if(peMonthKey(d.date)===mk) put(String(d.date).slice(0,10), e, true);
    });
  });
  var monthCount = Object.keys(byDate).reduce(function(a,k){
    return a + byDate[k].filter(function(r){ return !r.held; }).length; }, 0);
  var heldCount = Object.keys(byDate).reduce(function(a,k){
    return a + byDate[k].filter(function(r){ return r.held; }).length; }, 0);
  // The month header counted events but never added them up, so a 400k buyout read
  // the same as a 45k gathering. Converted money is separated from what is still
  // only in play — a calendar full of maybes is not a calendar full of money.
  var mConv = 0, mPipe = 0;
  Object.keys(byDate).forEach(function(k){ byDate[k].forEach(function(r){
    if(r.held) return;                       // counted on its first-choice date only
    var v = peEventValue(r.e)||0;
    if(peStage(r.e)==='converted') mConv += v; else if(peInPipeline(r.e)) mPipe += v;
  }); });
  return { y:y, mo:mo, first:first, startDow:(first.getDay()+6)%7, days:new Date(y, mo, 0).getDate(),
           byDate:byDate, mLbl:first.toLocaleDateString('en-GB',{month:'long',year:'numeric'}),
           monthCount:monthCount, heldCount:heldCount, mConv:mConv, mPipe:mPipe };
}
// ── the printable month ─────────────────────────────────────────────────────
// Katarina asked for a calendar she can print. It is the same month the screen
// is showing, on the house shell, landscape because seven columns will not read
// on a portrait A4.
//
// MONEY IS OFF unless she ticks it. A calendar is the one document that ends up
// pinned to a wall or left on a desk, and per-event value is the last thing that
// should be sitting there — so it is a deliberate tick, not a default.
function peCalPrint(withMoney){
  var mk = peState.month || peMonthKey(peToday());
  var M = peCalMonthMap(mk);
  var today = peToday();
  var cell = function(inner, cls){ return '<td class="'+(cls||'')+'">'+inner+'</td>'; };
  var h = '<div class="brand">'+peLogoImg(210)+'</div>'+
    '<div class="cal-h">'+peEsc(M.mLbl)+'</div>'+
    '<div class="cal-sub">'+(M.monthCount ? M.monthCount+' event'+(M.monthCount>1?'s':'') : 'no events')+
      (M.heldCount ? ' &middot; '+M.heldCount+' date'+(M.heldCount>1?'s':'')+' held' : '')+
      (withMoney && M.mConv ? ' &middot; AED '+peMoney(M.mConv)+' converted' : '')+
      (withMoney && M.mPipe ? ' &middot; '+peMoney(M.mPipe)+' in play' : '')+'</div>';
  h += '<div class="calwrap"><table class="cal"><thead><tr>'+
       ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(d){ return '<th>'+d+'</th>'; }).join('')+
       '</tr></thead><tbody><tr>';
  var col = 0;
  for(var i=0;i<M.startDow;i++){ h += cell('', 'off'); col++; }
  for(var d=1; d<=M.days; d++){
    if(col===7){ h += '</tr><tr>'; col = 0; }
    var ds = M.y+'-'+String(M.mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var evs = M.byDate[ds]||[];
    var inner = '<div class="dnum'+(ds===today?' now':'')+'">'+d+'</div>';
    inner += evs.map(function(r){
      var e = r.e, c = PE_STATUS_COL[e.status]||PE_STATUS_COL.draft;
      var name = peEsc(e.client_name || e.company || '?');
      if(r.held) return '<div class="ev held" style="border-color:'+c.b+'">or: '+name+'</div>';
      var v = peEventValue(e);
      var bits = [];
      if(e.guests) bits.push(e.guests+' guests');
      var tm = [e.time_from, e.time_to].filter(Boolean).join('–');
      if(tm) bits.push(peEsc(tm));
      if(e.area) bits.push(peEsc(e.area));
      return '<div class="ev" style="background:'+c.bg+';border-color:'+c.b+';color:'+c.t+'">'+
        (peIsBuyout(e)?'&#9679; ':'')+'<b>'+name+'</b>'+
        (bits.length?'<div class="meta">'+bits.join(' &middot; ')+'</div>':'')+
        (withMoney && v ? '<div class="meta">AED '+peMoney(v)+'</div>' : '')+'</div>';
    }).join('');
    h += cell(inner, ((M.startDow+d-1)%7)>=5 ? 'we' : '');
    col++;
  }
  while(col<7){ h += cell('', 'off'); col++; }
  h += '</tr></tbody></table></div>';
  h += '<div class="cal-key">'+[['sent','Proposal sent'],['confirmed','Confirmed'],['deposit','Deposit paid'],
        ['draft','Draft'],['done','Done'],['lost','Lost']].map(function(l){
    var c = PE_STATUS_COL[l[0]];
    return '<span><i style="background:'+c.bg+';border-color:'+c.b+'"></i>'+l[1]+'</span>';
  }).join('')+'<span class="pr">Printed '+peEsc(peDLabel(today))+'</span></div>';

  var css =
    '@page{size:A4 landscape;margin:0}'+
    'html,body{height:100%}'+
    'body{margin:0;padding:9mm 11mm;max-width:none;height:100%;box-sizing:border-box;display:flex;flex-direction:column;'+
      '-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.brand{text-align:center;margin:0 0 2mm}.brand img{width:38mm;height:auto}'+
    '.cal-h{text-align:center;font-family:\'Forum\',Georgia,serif;font-size:15pt;color:#450207;letter-spacing:1px}'+
    '.cal-sub{text-align:center;font-size:8pt;color:#574232;margin-top:1mm}'+
    '.calwrap{flex:1 1 auto;min-height:0;display:flex}'+
    'table.cal{width:100%;height:100%;border-collapse:collapse;table-layout:fixed;margin-top:3mm}'+
    'table.cal th{font-size:7.5pt;letter-spacing:2px;text-transform:uppercase;color:#544418;padding:0 0 2mm;font-weight:normal;border:0}'+
    'table.cal td{border:1px solid #E3D5C2;vertical-align:top;padding:1.3mm;overflow:hidden}'+
    'table.cal td.we{background:#FBF7F1}table.cal td.off{background:#F7F2E9;border-color:#EFE7DA}'+
    '.dnum{font-size:8pt;color:#574232;text-align:right;line-height:1}'+
    '.dnum.now{color:#450207;font-weight:700}'+
    '.ev{border:1px solid;border-radius:3px;padding:1mm 1.4mm;margin-top:1.2mm;font-size:7.5pt;line-height:1.3;'+
      'font-family:\'Outfit\',Arial,sans-serif;break-inside:avoid}'+
    '.ev.held{background:transparent;border-style:dashed;color:#574232}'+
    '.ev .meta{font-size:6.5pt;opacity:.8;margin-top:.4mm}'+
    '.cal-key{flex:0 0 auto;margin-top:3mm;display:flex;flex-wrap:wrap;gap:2mm 6mm;align-items:center;font-size:7pt;color:#574232;'+
      'font-family:\'Outfit\',Arial,sans-serif}'+
    '.cal-key i{display:inline-block;width:3mm;height:3mm;border-radius:1mm;border:1px solid;margin-right:1.5mm;vertical-align:-.4mm}'+
    '.cal-key .pr{margin-left:auto;color:#574232}';
  pePrintHTML(peDocShell(M.mLbl+' — Roberto\'s events', h, css));
}
function peRenderCalendar(){
  if(!peState.month) peState.month = peMonthKey(peToday());
  var mk = peState.month;
  var M = peCalMonthMap(mk);
  var y=M.y, mo=M.mo, first=M.first, startDow=M.startDow, days=M.days, byDate=M.byDate;
  var mLbl=M.mLbl, monthCount=M.monthCount, heldCount=M.heldCount, mConv=M.mConv, mPipe=M.mPipe;
  var h = peHeader('calendar');
  h += '<div style="margin-bottom:12px"><div class="pe-title">Calendar</div>'+
    '<div style="font-size:12px;color:#4F4535">Every booking on the day it lands. Tap one to open it.</div></div>';
  // Month header — a calm branded bar: prev · month + count · today · next
  h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--vino);color:var(--cream);border-radius:12px;padding:11px 14px;margin-bottom:12px">'+
       '<button class="pe-btn sec sm" style="background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.5);color:var(--cream)" onclick="peCalShift(-1)">‹ Prev</button>'+
       '<div style="text-align:center;line-height:1.25"><div style="font-family:\'Playfair Display\',serif;font-size:20px">'+mLbl+'</div>'+
         '<div style="font-size:10.5px;letter-spacing:.06em;opacity:.85">'+(monthCount?monthCount+' event'+(monthCount>1?'s':''):'no events yet')+
         (heldCount?' &middot; '+heldCount+' date'+(heldCount>1?'s':'')+' held':'')+
         (mConv?' &middot; AED '+peMoney(mConv)+' converted':'')+(mPipe?' &middot; '+peMoney(mPipe)+' in play':'')+'</div></div>'+
       '<span style="display:flex;gap:6px"><button class="pe-btn sec sm" style="background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.5);color:var(--cream)" onclick="peCalToday()">Today</button>'+
       '<button class="pe-btn sec sm" style="background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.5);color:var(--cream)" onclick="peCalShift(1)">Next ›</button></span></div>';
  // Print the month. The money is a deliberate tick — a printed calendar is the
  // one thing that gets pinned to a wall, and per-event value should not be
  // sitting on it unless she has decided it should.
  h += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">'+
    '<button class="pe-btn sec sm" onclick="peCalPrint(document.getElementById(\'pe-cal-money\').checked)">Print this month</button>'+
    '<label style="font-size:12px;color:#6E5844;display:flex;align-items:center;gap:6px">'+
      '<input type="checkbox" id="pe-cal-money" style="accent-color:#400207">Include the money</label>'+
    '<span style="font-size:11px;color:#574232">Landscape A4 · names, guests, time and area</span></div>';
  // colour legend — a tidy card so the meaning of each colour is always in view
  var legend = [['sent','Proposal sent'],['confirmed','Confirmed'],['deposit','Deposit paid'],['draft','Draft'],['done','Done'],['lost','Lost']];
  h += '<div style="display:flex;flex-wrap:wrap;gap:7px 14px;background:#FBF7F1;border:1px solid rgba(107,31,42,0.14);border-radius:10px;padding:9px 13px;margin-bottom:12px;font-size:11.5px;color:#5A3A1E">'+legend.map(function(l){
    var c = PE_STATUS_COL[l[0]];
    return '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:13px;height:13px;border-radius:4px;background:'+c.bg+';border:1px solid '+c.b+'"></span>'+l[1]+'</span>';
  }).join('')+'</div>';
  var today = peToday();
  // wide screens: the month grid
  h += '<div class="pe-cal">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(d,i){ return '<div class="pe-cal-h'+(i>=5?' we':'')+'">'+d+'</div>'; }).join('');
  for(var i=0;i<startDow;i++) h += '<div class="pe-cal-d dim"></div>';
  for(var d=1; d<=days; d++){
    var dow = (startDow+d-1)%7;
    var ds = y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var evs = byDate[ds]||[];
    var isToday = ds===today;
    var num = isToday ? '<div class="pe-cal-n"><span class="pe-cal-today">'+d+'</span></div>' : '<div class="pe-cal-n">'+d+'</div>';
    h += '<div class="pe-cal-d'+(isToday?' today':'')+(dow>=5?' we':'')+'">'+num+
      evs.map(function(r){
        var e = r.e;
        var c = PE_STATUS_COL[e.status]||PE_STATUS_COL.draft;
        var v = peEventValue(e), bo = peIsBuyout(e);
        // A date this booking is only HOLDING reads as a possibility, not a
        // booking: dashed, faded, no money on it — the money belongs to its
        // first-choice date and is shown there exactly once.
        if(r.held){
          return '<div class="pe-cal-ev" style="background:transparent;color:'+c.t+';border:1px dashed '+c.b+';opacity:.85" onclick="peGo(\'event\',\''+e.id+'\')" title="'+
            peEsc((e.client_name||e.company||'')+' — one of the dates being held for this booking. Counted on '+peDLabel(e.event_date)+'.')+'">'+
            'or: '+peEsc((e.client_name||e.company||'?'))+'</div>';
        }
        // A buyout closes the whole venue — it gets a heavy border so it cannot be
        // mistaken for a normal booking sitting in one room.
        return '<div class="pe-cal-ev" style="background:'+c.bg+';color:'+c.t+';border:1px solid '+c.b+
          (bo?';border-left:4px solid #400207;font-weight:700':'')+'" onclick="peGo(\'event\',\''+e.id+'\')" title="'+
          peEsc((e.client_name||e.company||'')+(bo?' — FULL BUYOUT':'')+(v?' — AED '+peMoney(v):'')+(peIsMultiSpace(e)?' — '+peRunOfEvening(e):''))+'">'+
          (bo?'&#9679; ':'')+peEsc((e.client_name||e.company||'?'))+(e.guests?' · '+e.guests:'')+
          (peIsMultiSpace(e)?' <span style="opacity:.75">'+(peSpaceList(e).length)+' spaces</span>':'')+
          (v?'<br><span style="opacity:.75">'+peMoney(v)+'</span>':'')+'</div>';
      }).join('')+'</div>';
  }
  h += '</div>';
  // narrow screens: a stacked agenda list (the 7-col grid is unreadable on a phone)
  var agendaDates = Object.keys(byDate).sort();
  h += '<div class="pe-agenda">';
  if(!agendaDates.length){ h += '<div style="font-size:12px;color:#4F4535;padding:10px 2px">No events this month.</div>'; }
  agendaDates.forEach(function(ds){
    h += '<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#4F4535;margin:10px 2px 4px">'+peEsc(peDLabel(ds))+'</div>';
    byDate[ds].forEach(function(r){
      var e = r.e, pm = peStatusMeta(e.status);
      // The run of the evening, so a two-space booking reads as one evening in
      // order rather than as a single room that is only half the truth.
      var where = peIsMultiSpace(e) ? peRunOfEvening(e) : (peEsc(e.area||'')+(e.time_from?' · '+peEsc(e.time_from):''));
      h += '<div class="pe-card" style="padding:9px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer'+(r.held?';border-style:dashed;opacity:.85':'')+'" onclick="peGo(\'event\',\''+e.id+'\')">'+
        '<span><b style="font-size:13px;color:#2C1810">'+(r.held?'<span style="color:#4F4535;font-weight:400">or: </span>':'')+peEsc(e.client_name||e.company||'Unnamed')+'</b>'+(e.guests?' · '+e.guests+' guests':'')+'<br><span style="font-size:11px;color:#4F4535">'+
        (r.held ? 'One of the dates held for this booking — counted on '+peEsc(peDLabel(e.event_date)) : peEsc(where))+'</span></span>'+
        '<span class="pe-pill '+(r.held?'pe-p-draft':pm.pill)+'">'+(r.held?'Date held':pm.n)+'</span></div>';
    });
  });
  h += '</div>';
  h += peLeadsStrip();
  return h+PE_FOOT;
}
// Leads and undated confirmed bookings belong to no month, so a calendar can never
// show them — and until now nothing else did either: an undated booking was invisible
// on every screen while still being real money. This strip sits under the calendar so
// the work is in front of whoever is looking.
// Andrea Sacchi, 17 Jul 2026: "unconfirmed prospect without a date should be recorded
// under leads and highlighted as to be actioned but not included in the pipeline yet".
function peLeadsStrip(){
  var leads = peState.events.filter(function(e){ return peStage(e)==='lead'; });
  var undated = peState.events.filter(peNeedsDate);
  if(!leads.length && !undated.length) return '';
  function row(e, why){
    var v = peEventValue(e);
    return '<div class="pe-card" style="padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer" onclick="peGo(\'event\',\''+e.id+'\')">'+
      '<span><b style="font-size:13px;color:#2C1810">'+peEsc(e.client_name||e.company||'Unnamed')+'</b>'+(e.guests?' · '+e.guests+' guests':'')+
      '<br><span style="font-size:11px;color:#4F4535">'+why+'</span></span>'+
      '<span style="font-size:12px;color:#6B4A33;white-space:nowrap">'+(v?'AED '+peMoney(v):'no value yet')+'</span></div>';
  }
  var h = '';
  if(undated.length){
    h += '<div style="margin:18px 2px 7px"><span class="pe-lbl" style="margin:0;font-size:11px;color:#7F5C00">&#9888; Confirmed but no date ('+undated.length+') — book these in</span></div>';
    h += undated.map(function(e){ return row(e, 'Confirmed &mdash; needs a date before anyone can plan it'); }).join('');
  }
  if(leads.length){
    var lv = leads.reduce(function(a,e){ return a+(peEventValue(e)||0); }, 0);
    h += '<div style="margin:18px 2px 7px"><span class="pe-lbl" style="margin:0;font-size:11px">Leads ('+leads.length+') — no date yet, not counted in the pipeline'+(lv?' · AED '+peMoney(lv)+' if they land':'')+'</span></div>';
    h += leads.map(function(e){ return row(e, peStatusMeta(e.status).n+' &mdash; no date yet, chase it'); }).join('');
  }
  return h;
}
function peCalToday(){ peState.month = peMonthKey(peToday()); renderMain(); }
function peCalShift(n){
  var y = +peState.month.slice(0,4), mo = +peState.month.slice(5,7)-1+n;
  var d = new Date(y, mo, 1);
  peState.month = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  renderMain();
}

// ── event editor ─────────────────────────────────────────────────────────────
// Insert an event, retrying without any NEW optional column the database doesn't
// have yet (SQL not run) — a nice-to-have default must never block creating a
// booking. Mirrors the peColMissing graceful-degradation pattern used on saves.
var PE_OPTIONAL_INSERT_COLS = ['handled_by'];
async function peInsertEvent(row){
  var r = await sb.from('events_desk').insert(row).select().single();
  if(r.error){
    var missing = PE_OPTIONAL_INSERT_COLS.filter(function(c){ return row[c]!=null && peColMissing(r.error, c); });
    if(missing.length){
      var slim = Object.assign({}, row);
      missing.forEach(function(c){ delete slim[c]; });
      r = await sb.from('events_desk').insert(slim).select().single();
    }
  }
  return r;
}
async function peNewEvent(){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  // handled_by defaults to whoever creates it (Andrea: "handler need to be there"),
  // so the field is filled by habit, not by extra typing.
  var row = { venue_id:'robertos-difc', status:'draft', updated_by:peActor(), handled_by:peActor(), payment_terms:'50% deposit to confirm, balance on the day' };
  var r = await peInsertEvent(row);
  if(r.error || !r.data){ peToast('Could not create the event — check connection.', true); return; }
  peState.events.push(r.data);
  await sb.from('event_log').insert({event_id:r.data.id, action:'created', actor:peActor()});
  peGo('event', r.data.id);
}
function peCalcTotals(e){
  var items = peState.items[e.id]||[];
  var foodComputed = 0, cost = 0, pcs = 0, missing = [], noPrice = [], noCost = [];
  items.forEach(function(it){
    var d = peDishById(it.dish_id); if(!d) return;
    var p = Number(it.pcs_per_guest)||0;
    // A dish "on the house" is not charged — but the kitchen still cooks it, so its
    // COST and its PIECES still count (food-cost % and pieces/guest stay honest).
    if(!it.comp) foodComputed += (Number(d.sell_price)||0)*p;
    cost += (Number(d.cost)||0)*p;
    pcs += p;
    if(!(d.allergens||[]).length && d.category!=='Dessert') missing.push(d.name);
    // A dish with no sell price or no cost recorded contributes ZERO here, which
    // makes the quote look complete and the food-cost % look better than it is.
    // The module's own rule (peCmTotals, peQuickTotals) is that nothing downstream
    // may silently treat "no price" as zero — so name them instead.
    if(!it.comp && (d.sell_price==null || d.sell_price==='') && p>0) noPrice.push(d.name);
    if((d.cost==null || d.cost==='') && p>0) noCost.push(d.name);
  });
  // A set-menu event has no dish items — the chef's cost/guest on the menu
  // keeps the food-cost % honest (vs the agreed price, so discounts show).
  if(!items.length && e.set_menu){
    var smCost = peSetMenuByKey(e.set_menu.key);
    if(smCost && smCost.cost!=null) cost = Number(smCost.cost)||0;
  }
  var foodPP = (e.food_price_pp!=null && e.food_price_pp!=='') ? Number(e.food_price_pp) : (foodComputed||null);
  var bev = e.bev_package_id ? peBevById(e.bev_package_id) : null;
  // Dry event: an alcoholic (or not-yet-flagged) package can never be charged —
  // the "no alcohol" promise and the money must never contradict. Only a package
  // explicitly flagged alcohol-free may carry a price on a dry event.
  var dry = e.bev_mode==='dry';
  var bevCounts = bev && !(dry && !bev.non_alcoholic);
  var bevPP = bevCounts ? Number(bev.price_pp) : 0;
  var perGuest = (foodPP||0)+bevPP;
  var subtotal = e.guests ? perGuest*Number(e.guests) : null;
  // A courtesy discount comes off the very end — never taking the total below 0.
  var discount = subtotal!=null ? Math.min(Math.max(0, Number(e.discount)||0), subtotal) : Math.max(0, Number(e.discount)||0);
  var total = subtotal!=null ? Math.max(0, subtotal - discount) : null;
  var foodCostPct = foodPP ? (cost/(foodPP/PE_GROSS))*100 : null;
  // The real total charged once the night ran (more guests / extra bar / off-menu),
  // typed by hand after the event. When set it is what the report counts — but the
  // quoted `total` above (and the signed agreement + deposit) never move.
  var actual = (e.actual_revenue!=null && e.actual_revenue!=='') ? Math.max(0, Number(e.actual_revenue)) : null;
  return { foodComputed:foodComputed, foodPP:foodPP, bevPP:bevPP, perGuest:perGuest,
           subtotal:subtotal, discount:discount, total:total, actual:actual,
           pcs:pcs, foodCostPct:foodCostPct, missingAllergens:missing,
           noPrice:noPrice, noCost:noCost, items:items };
}
// The agreement's quoted base and deposit — one place, so the editor card, the
// guided screen and the payment-link send all agree. A courtesy discount reduces
// the quoted base (so the deposit % and signed agreement follow automatically).
function peAgBase(e){
  var t = peCalcTotals(e);
  if(e.pricing_type==='min_spend'){
    var ms = Number(e.min_spend);
    if(!ms) return null;
    return Math.max(0, ms - Math.max(0, Number(e.discount)||0));   // set_price already discounted in t.total
  }
  return t.total;   // already has the discount taken off
}
function peDepositAmt(e){
  var base = peAgBase(e);
  var pct = e.deposit_pct==null ? 50 : Number(e.deposit_pct);
  return (base!=null && pct>0) ? Math.round(base*pct/100) : 0;
}
// True when a Supabase write failed only because a Batch-7 column isn't in the
// database yet — so the app can degrade gracefully (keep working in-session)
// instead of showing a scary red error. Mirrors the non_alcoholic pattern.
function peColMissing(err, col){
  var m = String(err && err.message || err || '').toLowerCase();
  return m.indexOf(col.toLowerCase())>=0 &&
    (m.indexOf('does not exist')>=0 || m.indexOf('schema cache')>=0 || m.indexOf('could not find')>=0);
}
// ── guided lifecycle view — walk an EXISTING event through its next step, one
// calm screen at a time. Reuses every real action; the full editor is one tap away.
function peDaysSince(iso){ if(!iso) return null; var d = Math.floor((Date.now()-new Date(iso).getTime())/86400000); return d>=0?d:null; }
function peGuideReminder(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e) return;
  if(e.contact_phone){ peWhatsApp(id, 'remind'); }
  else if(e.contact_email){ peEmailAgreement(id); }
  else { peToast('Add a phone or email first', true); peGo('event', id); }
}
function peGuideEventView(){
  var e = peEvById(peState.currentId);
  if(!e) return peHeader('list')+'<div class="pe-card">Event not found.</div>'+PE_FOOT;
  var log = peState.log[e.id]||[];
  var name = e.client_name || e.company || 'the client';
  var lost = e.status==='lost';
  var idx = 0;
  if(e.status==='draft') idx = 0;
  else if(e.status==='sent') idx = e.signed_at ? 2 : 1;
  else if(e.status==='confirmed' || e.status==='deposit') idx = 3;
  else if(e.status==='done') idx = 4;
  var stages = ['Draft','Sent','Signed','Confirmed','Done'];
  var h = '<div class="pe-wrap" style="max-width:520px"><div class="pe-sheet">';
  var bt = peBackTarget();
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
    '<span class="pe-tab" onclick="peGo(\''+bt.view+'\')">‹ Back to '+bt.label+'</span>'+
    '<span style="font-size:13px;color:#400207;font-weight:600">'+peEsc(e.client_name||e.company||'Event')+'</span></div>';
  h += peViewBanner();
  if(!lost){
    h += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:16px;font-size:9.5px">'+stages.map(function(s,i){
      var done=i<idx, cur=i===idx;
      var seg = i<stages.length-1 ? '<span style="flex:1;height:1px;background:'+(i<idx?'#BAD5B5':'#E3D5C2')+'"></span>' : '';
      return '<span style="white-space:nowrap;color:'+(cur?'#400207':(done?'#2E6B34':'#8B7355'))+(cur?';font-weight:600':'')+'">'+(done?'✓ ':(cur?'● ':''))+s+'</span>'+seg;
    }).join('')+'</div>';
  }
  var title='', sub='', body='';
  function pbtn(label, onclick){ return '<button class="pe-btn" style="width:100%;box-sizing:border-box;padding:13px;margin-bottom:8px" onclick="'+onclick+'">'+label+'</button>'; }
  function sbtn(label, onclick){ return '<button class="pe-btn sec" style="width:100%;box-sizing:border-box;padding:11px;margin-bottom:8px" onclick="'+onclick+'">'+label+'</button>'; }
  if(lost){
    title = 'Marked as lost';
    sub = 'This booking is out of your open pipeline. Open the full event to reopen it or see why.';
  } else if(e.status==='done'){
    title = 'All set — event done';
    sub = 'Nothing left to do here. Grande!';
    body = pbtn('Back to my events', "peGo('list')");
  } else if(e.status==='draft'){
    var items = peState.items[e.id]||[]; var t = peCalcTotals(e);
    var hasFood = items.length>0 || !!e.set_menu || (e.food_price_pp!=null && e.food_price_pp!=='');
    var hasBev = !!e.bev_package_id;
    var hasPrice = !!t.total || !!e.min_spend;
    var nx = peEditorNext(e);
    if((hasFood||hasBev) && hasPrice && e.contact_email){
      title = 'Ready to send';
      sub = 'Everything is on this event. Send '+peEsc(name)+' the proposal to review and sign online.';
      body = pbtn('Send the proposal', "peEmailAgreement('"+e.id+"')") + sbtn('Open full event to review first', "peGo('event','"+e.id+"')");
    } else {
      title = 'Let’s finish this booking';
      sub = nx ? 'Still to do: '+nx.label+'. Open the event and I’ll point you to it.' : 'A few details are still needed before you can send it.';
      body = pbtn('Open the event to finish', "peGo('event','"+e.id+"')");
    }
  } else if(e.status==='sent' && !e.signed_at){
    var emailLogs = log.filter(function(l){ return l.action==='email'; });
    var last = emailLogs.length ? emailLogs[0] : null;
    var days = last ? peDaysSince(last.created_at) : null;
    title = 'Waiting for the signature';
    sub = 'Sent to '+peEsc(name)+(days!=null?(days===0?' today':' '+days+' day'+(days>1?'s':'')+' ago'):'')+'. Not signed yet.';
    // Name the channel the reminder actually uses — matches peGuideReminder's pick.
    var remLabel = e.contact_phone ? 'Open WhatsApp to remind '+peEsc(name)
                 : (e.contact_email ? 'Re-send the email to '+peEsc(name)
                 : 'Add a phone or email to remind '+peEsc(name));
    body = pbtn(remLabel, "peGuideReminder('"+e.id+"')") +
           sbtn('Copy the signing link', "peCopyAgreementLink('"+e.id+"')");
  } else if(e.status==='sent' && e.signed_at){
    title = peEsc(name)+' signed';
    sub = 'Signed'+(e.signed_at?' on '+peDLabel(e.signed_at):'')+'. Lock it in so the kitchen and hostess team treat it as ON.';
    // Collect the deposit first when a Telr link is ready — named + confirmed + logged.
    var payBtn = (e.payment_link && e.contact_email)
      ? pbtn('Send payment link to '+peEsc(e.contact_email)+' — AED '+peMoney(peDepositAmt(e))+' deposit', "peSendPaymentLink('"+e.id+"')")
      : '';
    body = payBtn + pbtn('Mark as Confirmed', "peSetStatus('"+e.id+"','confirmed')");
  } else if(e.status==='confirmed' || e.status==='deposit'){
    if(peBriefSent(e)){
      title = 'It’s ON — the team has the brief';
      sub = 'The kitchen and hostess team were sent the brief'+(e.event_date?' for '+peDLabel(e.event_date):'')+'. Nothing left to do on this one.';
      body = pbtn('Back to the events list', "peGo('list')") + sbtn('Re-send the team brief', "peSendCoordEmail('"+e.id+"')");
    } else {
      title = 'It’s ON — tell the team';
      sub = 'The kitchen and hostess team have not been sent the brief'+(e.event_date?' for '+peDLabel(e.event_date):'')+' yet.';
      body = pbtn('Send the team brief', "peSendCoordEmail('"+e.id+"')") + sbtn('I’ll send it later', "peGo('list')");
    }
  }
  h += '<div class="pe-card">'+
    '<div class="pe-title" style="font-size:20px">'+title+'</div>'+
    '<div style="font-size:13px;color:#6B4A33;margin:6px 0 16px">'+sub+'</div>'+
    body + '</div>';
  h += '<div style="text-align:center;margin-top:14px"><span class="pe-tab" onclick="peGo(\'event\',\''+e.id+'\')">Open full event ›</span></div>';
  return h+'</div></div>';   // pe-sheet, pe-wrap
}
function peRenderEvent(){
  var e = peEvById(peState.currentId);
  if(!e) return peHeader('list')+'<div class="pe-card">Event not found.</div>'+PE_FOOT;
  var t = peCalcTotals(e);
  var m = peStatusMeta(e.status);
  var log = peState.log[e.id]||[];
  var ce = peCanEdit();   // non-editors read everything; the edit affordances go
  var h = '<div class="pe-wrap"><div class="pe-sheet">';
  var bt = peBackTarget();
  h += '<div class="pe-top"><span style="display:flex;align-items:center;gap:8px">'+
       '<span class="pe-tab" onclick="peGo(\''+bt.view+'\')">‹ Back to '+bt.label+'</span>'+
       (bt.view!=='list'?'<span class="pe-tab" onclick="peGo(\'list\')">⌂ Events home</span>':'')+'</span>'+
       '<span style="display:flex;align-items:center;gap:8px">'+(ce?'<span class="pe-tab" onclick="peGo(\'guidedevent\',\''+e.id+'\')">Walk me through it</span>':'')+
       '<span class="pe-pill '+m.pill+'" style="font-size:12px">'+m.n+'</span></span></div>';
  h += peViewBanner();

  // status stepper — read-only users see where the event stands, but can't move it
  h += '<div class="pe-steps">'+PE_STATUS.filter(function(s){return s.k!=='lost';}).map(function(s){
    return '<span class="pe-step'+(e.status===s.k?' cur':'')+'"'+(ce?' onclick="peSetStatus(\''+e.id+'\',\''+s.k+'\')"':' style="cursor:default"')+'>'+s.n+'</span>';
  }).join('')+'<span class="pe-step'+(e.status==='lost'?' cur':'')+'" style="margin-left:auto'+(ce?'':';cursor:default')+'"'+(ce?' onclick="peSetStatus(\''+e.id+'\',\'lost\')"':'')+'>Lost</span></div>';
  if(e.status==='lost'){
    var lr = null;
    log.forEach(function(l){ if(!lr && l.action==='lost') lr = String(l.detail||'').replace(/^.*?→ lost — /,''); });
    if(!lr && peState.lostReasons) lr = peState.lostReasons[e.id];
    h += '<div style="font-size:12px;color:#933;margin:-4px 0 10px">Lost — '+peEsc(lr||'reason not recorded')+'</div>';
  }
  // #11 — persistent next step once the event is ON: send the team brief.
  // Amber until it's actually been sent — a green "all good" panel above an
  // unsent brief is exactly how a confirmed event reaches the day unbriefed.
  if(e.status==='confirmed' || e.status==='deposit'){
    var briefChanges = peBriefSent(e) ? peBriefChangedSince(e, log) : [];
    h += peBriefSent(e)
      ? (briefChanges.length
        // Their copy is now wrong. Say what changed and since when — a green tick over
        // a stale brief is how a team turns up cooking for the old guest count.
        ? '<div style="background:#FBF0D8;border:1px solid #E6C766;border-radius:10px;padding:10px 13px;margin-bottom:12px;font-size:12.5px;color:#6B4A00;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
          '<span>The team has the brief from <b>'+peDLabel(String(peState.briefSent[e.id]).slice(0,10))+'</b>, but this has changed since: <b>'+
          peEsc(briefChanges.map(function(l){ return l.detail; }).join(' · '))+'</b>. Their copy still shows the old details.</span>'+
          (ce?'<button class="pe-btn sm" onclick="peSendCoordEmail(\''+e.id+'\')">Re-send the brief</button>':'')+'</div>'
        : '<div style="background:#E7F0E4;border:1px solid #BAD5B5;border-radius:10px;padding:10px 13px;margin-bottom:12px;font-size:12.5px;color:#2E5B30;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
        '<span>This event is <b>ON</b> and the <b>team brief has been sent ✓</b> — the kitchen and hostess team have it.</span>'+
        (ce?'<button class="pe-btn sec sm" onclick="peSendCoordEmail(\''+e.id+'\')">Re-send the brief</button>':'')+'</div>')
      : '<div style="background:#FBF0D8;border:1px solid #E6C766;border-radius:10px;padding:10px 13px;margin-bottom:12px;font-size:12.5px;color:#6B4A00;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
        '<span>This event is <b>ON</b>, but the <b>team brief has not been sent</b> — the kitchen and hostess team do not know about it yet.</span>'+
        (ce?'<button class="pe-btn sm" onclick="peSendCoordEmail(\''+e.id+'\')">Send the team brief now</button>':'')+'</div>';
  }

  // #3 — double-booking warning
  // With a second space (#5) or a second possible date (#13) in play, "they
  // clash" stops being a useful sentence — one line per collision, naming the
  // date and the room it actually happens in, and saying plainly when the
  // collision is only on a date this booking is merely HOLDING.
  var clashes = peClashPairs(e);
  if(clashes.length){
    h += '<div style="background:#FBE9E7;border:1px solid #E8A99E;border-radius:10px;padding:9px 12px;margin-bottom:12px;font-size:12.5px;color:#8A2A1A">'+
      clashes.map(function(c){
        var who = '<span style="text-decoration:underline;cursor:pointer" onclick="peGo(\'event\',\''+c.ev.id+'\')">'+peEsc(c.ev.client_name||c.ev.company||'another event')+'</span> ('+peEsc(peStatusMeta(c.ev.status).n)+')';
        return '⚠ '+(c.mineAlt ? 'On the alternative date <b>' : 'On <b>')+peEsc(peDLabel(c.date))+'</b>'+
          (c.buyout ? ' the <b>full venue</b> is taken' : ' <b>'+peEsc(c.area||'that space')+'</b> is already booked')+
          ' — '+who+(c.theirAlt ? ' <i>(their alternative date)</i>' : '');
      }).join('<br>')+
      '<div style="margin-top:4px">Check this is intentional.</div></div>';
  }

  // The guest sent their set-menu numbers — tell Valentina the moment she's on
  // the event, with the review-and-apply one tap away.
  if(ce && e.set_menu && peState.menuChoicesPending && peState.menuChoicesPending[e.client_token]){
    h += '<div style="background:#EEF3E4;border:1px solid #B9C99A;border-radius:10px;padding:11px 13px;margin-bottom:12px;font-size:13px;color:#3F5222;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span><b>✓ The guest sent their menu numbers</b> — review them and they go straight onto the kitchen brief.</span>'+
      '<span style="display:flex;gap:6px;flex-wrap:wrap">'+
      '<button class="pe-btn sm" onclick="peFetchMenuChoices(\''+e.id+'\')">Review &amp; apply</button>'+
      // Applying was the only thing that cleared this, which is meaningless on a
      // booking that has since been lost — so the banner asserted forever.
      '<button class="pe-btn sec sm" onclick="peDismissMenuChoices(\''+e.id+'\')">Not needed</button></span></div>';
  }

  // P0/#6 — persistent banner when an edit voided the signed agreement (stays
  // until it's re-sent for signature, unlike the fading toast that first fired).
  if(ce && peState.voided && peState.voided[e.id] && !e.signed_at){
    h += '<div style="background:#FBE9E7;border:1px solid #E8A99E;border-radius:10px;padding:11px 13px;margin-bottom:12px;font-size:13px;color:#8A2A1A;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span><b>▲ Agreement voided by your edit</b> — it needs re-signing before this event is confirmed.</span>'+
      '<span style="display:flex;gap:6px;flex-wrap:wrap">'+
      '<button class="pe-btn sm" onclick="peEmailAgreement(\''+e.id+'\')"'+(e.contact_email?'':' disabled title="Add the client email above to re-send"')+'>Re-send for signature</button>'+
      (e.contact_email?'':'<span style="font-size:11px;color:#8A2A1A;align-self:center">Add the client email above to re-send</span>')+
      '<button class="pe-btn sec sm" onclick="if(peState.voided)delete peState.voided[\''+e.id+'\'];renderMain()">Dismiss</button></span></div>';
  }

  // #1 — the one thing to do next on THIS event, so the long editor never loses her
  var nx = ce ? peEditorNext(e) : null;
  if(nx){
    h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#F7EEE2;border:1px solid #E8CE92;border-radius:10px;padding:10px 13px;margin-bottom:12px">'+
      '<div style="min-width:0"><div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#544418">Next step</div>'+
      '<div style="font-size:14px;color:#400207;font-weight:600">'+nx.label+'</div></div>'+
      '<button class="pe-btn sm" style="flex-shrink:0" onclick="'+nx.act+'">Take me there ›</button></div>';
  }

  // #2 — a compact running total pinned at the top, so she never scrolls three
  // cards down to read a number to a guest on the phone.
  h += '<div style="display:flex;justify-content:space-between;align-items:center;background:#F3E9DA;border-radius:8px;padding:9px 13px;margin-bottom:12px">'+
    '<span style="font-size:11.5px;color:#4F4535">'+(t.actual!=null?'Real total':'Running total')+'</span>'+
    '<b style="font-size:14px;color:#400207">'+(t.actual!=null
      ? 'AED '+peMoney(t.actual)+' <span style="font-size:10.5px;font-weight:400;color:#4F4535">· actual on the night</span>'
      : (t.total!=null
        ? 'AED '+peMoney(t.total)+' <span style="font-size:10.5px;font-weight:400;color:#4F4535">· '+peMoney(t.perGuest)+'/guest</span>'
        : (e.min_spend ? 'Min spend AED '+peMoney(e.min_spend) : 'AED — <span style="font-size:10.5px;font-weight:400;color:#4F4535">set food + guests</span>')))+'</b></div>';

  // facts — a new event shows only the 4 essentials; the rest live under
  // "More details" and auto-open the moment any of them holds real data.
  var secTriggers = ['company','event_type','time_from','time_to','min_spend','contact_name','contact_phone','contact_email','dietary'];
  var hasSecData = secTriggers.some(function(f){ return e[f]!=null && e[f]!==''; });
  var showMore = hasSecData || (peState.moreOpen && peState.moreOpen[e.id]);
  h += '<div class="pe-card"><div class="pe-grid2">'+
    peIn('Client / booking name','client_name',e)+peSel('Venue / area','area',e,PE_AREAS)+
  '</div><div class="pe-grid2" style="margin-top:10px">'+
    peIn('Date','event_date',e,'date')+peGuestField('Guests',e)+
  '</div>';
  if(!showMore){
    h += '<div style="margin-top:12px;border-top:1px dashed rgba(107,31,42,0.18);padding-top:10px;display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="peState.moreOpen=peState.moreOpen||{};peState.moreOpen[\''+e.id+'\']=true;renderMain()">'+
      '<span style="font-size:12.5px;color:#4F4535">+ More details</span>'+
      '<span style="font-size:11px;color:#574232">company · contact · dietary · payment</span></div>';
  } else {
    h += '<div style="margin-top:12px;border-top:1px dashed rgba(107,31,42,0.18);padding-top:12px"></div>'+
      '<div class="pe-grid3">'+
      peIn('Company','company',e)+peSel('Type of event','event_type',e,PE_TYPES)+peIn('Minimum spend (AED)','min_spend',e,'number')+
      peTimeField('Start time','time_from',e,'peTimeFromChange(this,\''+e.id+'\')')+peTimeField('End time','time_to',e,'peFact(this,\'time_to\',\''+e.id+'\')')+peIn('Contact name','contact_name',e)+
      peIn('Contact phone','contact_phone',e)+
      '<div><div class="pe-lbl">Contact email</div><input class="pe-in" id="pe-f-contact_email" type="text" value="'+peEsc(e.contact_email==null?'':e.contact_email)+'" placeholder="guest@email.com, planner@email.com" onchange="peFact(this,\'contact_email\',\''+e.id+'\')"'+(peCanEdit()?'':' disabled')+'><div style="font-size:11px;color:#4F4535;margin-top:3px">Sending to more than one person? Separate the emails with a comma — everyone on it gets the proposal, contract and payment link.</div></div>'+
    '</div><div class="pe-grid3" style="margin-top:10px">'+
      // #3 + Andrea's "lead from and handler": where it came from and whose it is.
      // The handler defaults to whoever created the event, so old habits cost nothing.
      peSel('How it came in','lead_source',e,PE_LEAD_SOURCES)+
      peIn('Source note (promoter, commission…)','lead_source_note',e)+
      peIn('Handled by','handled_by',e)+
    '</div><div class="pe-grid2" style="margin-top:10px">'+
      peIn('Dietary requirements','dietary',e)+peIn('Payment terms','payment_terms',e)+
    '</div><div class="pe-grid2" style="margin-top:10px">'+
      // #4 — Valentina: "as a option, not automatic". Nothing happens on its own:
      // this only shows a HELD chip on the list, turning red once the date passes.
      peIn('Hold the date until (optional)','hold_until',e,'date')+
      // #17 — the only channel that reaches the KITCHEN docs for off-menu items.
      // A dish priced by hand never reached the prep list; this line always does.
      peIn('Off-menu / à la carte for the kitchen (e.g. 2× burrata)','off_menu',e)+
    '</div>'+
      (!hasSecData ? '<div style="margin-top:8px;font-size:12px;color:#4F4535;cursor:pointer" onclick="peState.moreOpen=peState.moreOpen||{};peState.moreOpen[\''+e.id+'\']=false;renderMain()">– Show fewer details</div>' : '');
  }
  h += (ce?'<div style="margin-top:8px;font-size:11px;color:#4F4535">Every field saves as you leave it — you’ll see “Saved ✓”.</div>'+
  '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="pe-btn sec" onclick="peDeleteEvent(\''+e.id+'\')"'+(e.status==='draft'?'':' disabled')+'>Delete draft</button>'+
  (e.status==='draft'?'':'<span style="font-size:11px;color:#4F4535">Only a draft can be deleted — mark this event Lost instead.</span>')+'</div>':'')+'</div>';

  h += peEveningCardHTML(e, ce);      // #5  two spaces in one evening, one price
  h += peAltDatesCardHTML(e, ce);     // #13 two possible dates, one booking
  h += peOptionsCardHTML(e, ce, t);   // #12 three options, one enquiry

  // 2col: food+bev | totals+actions
  h += '<div class="pe-2col"><div>';
  // food — either a set menu (plated, with a per-choice headcount) or canapés
  var sm = e.set_menu;
  h += '<div class="pe-card" id="pe-card-food"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px">'+
    '<b style="font-size:14px;color:#400207">Food</b>'+
    (sm || !ce ? '' : '<span><select class="pe-in" style="width:auto;display:inline-block" onchange="peApplyPackage(\''+e.id+'\',this.value)">'+
      '<option value="">Start from a canapé package…</option>'+
      peState.packs.map(function(p){ return '<option value="'+p.id+'">'+peEsc(p.name)+' — AED '+peMoney(p.price_pp)+'/guest</option>'; }).join('')+
    '</select></span>')+'</div>';
  if(!sm && ce) h += '<div style="font-size:11px;color:#4F4535;margin:-2px 0 8px">Start from a canapé package above, or build the menu dish by dish below.</div>';
  h += peFoodSetMenuHTML(e);
  if(!sm){
    h += '<div class="pe-lbl">Package label on documents (free text)</div>'+
       '<input class="pe-in" id="pe-f-package_label" value="'+peEsc(e.package_label||'')+'" placeholder="e.g. Canape Cortile" onchange="peFact(this,\'package_label\',\''+e.id+'\')"'+(ce?'':' disabled')+'>';
    h += '<div style="display:flex;gap:10px;margin-top:8px;align-items:end"><div style="flex:1"><div class="pe-lbl">Food price / guest (AED) — leave blank to use the dishes total</div>'+
       '<input class="pe-in" id="pe-f-food_price_pp" type="number" value="'+(e.food_price_pp!=null?peEsc(e.food_price_pp):'')+'" placeholder="auto: '+peMoney(t.foodComputed)+'" onchange="peFact(this,\'food_price_pp\',\''+e.id+'\')"'+(ce?'':' disabled')+'></div></div>';
    h += '<div style="margin-top:10px">'+ (t.items.length ? t.items.map(function(it){
        var d = peDishById(it.dish_id); if(!d) return '';
        // Same shape as the Quick-menu row: priced, with a clear quantity and a
        // live line total. In an event the quantity is per guest, so we also
        // spell out the absolute pieces (× guests) and the AED/guest it adds.
        var g = Number(e.guests)||0;
        var p = Number(it.pcs_per_guest)||0;
        var lineAED = (Number(d.sell_price)||0)*p;              // AED/guest for this dish
        var absPcs = g ? Math.round(p*g*10)/10 : null;          // total pieces across all guests
        var lineTotal = (Number(d.sell_price)||0)*(absPcs!=null?absPcs:p); // total AED for this selection
        var minv = !!(d.min_order && g && (p*g) < d.min_order);
        var comp = !!it.comp;                                   // "on the house" — cooked, not charged
        return '<div class="pe-dishrow"><span><b style="font-weight:600">'+peEsc(d.name)+'</b>'+
          (comp?' <span class="pe-pill" style="font-size:10px;background:#EAF0E4;color:#4A6B2E;border:1px solid #C6D6AE">on the house</span>':'')+
          ' <span style="color:#574232;font-size:10px">'+peEsc(peAllergenText(d.allergens))+'</span>'+
          ((d.allergens||[]).length||d.category==='Dessert'?'':' <span class="pe-pill pe-p-sent" style="font-size:10px">no allergens set</span>')+
          '<br><span style="font-size:11px;color:#4F4535">'+peEsc(d.tier||'')+(d.tier?' · ':'')+'AED '+peMoney(d.sell_price)+' each · min '+(d.min_order||10)+' pieces</span>'+
          '<br><span style="font-size:11px;color:'+(minv?'#B00020':'#6B4A33')+'">'+
            (absPcs!=null?'× '+peEsc(e.guests)+' guests = '+absPcs+' pcs':'add the guest count for total pieces')+
            // "the kitchen still prepares it" used to exist only as a hover tooltip,
            // on a control that changes what the client pays. Say it on the screen.
            ' · '+(comp?'<span style="color:#4A6B2E">with our compliments — not charged, the kitchen still prepares it</span>':'<b>AED '+peMoney(lineTotal)+'</b>'+(absPcs!=null?'':'/guest'))+
            (minv?' — below the minimum order of '+d.min_order+' pcs':'')+'</span></span>'+
          '<span style="display:flex;align-items:center;gap:5px;flex-shrink:0">'+
            (ce?'<label style="display:flex;flex-direction:column;align-items:center;line-height:1.1;cursor:pointer" title="Give this dish for free — the kitchen still prepares it">'+
              '<input type="checkbox" '+(comp?'checked':'')+' onchange="peToggleComp(\''+it.id+'\',this.checked)" style="accent-color:#4A6B2E;width:16px;height:16px">'+
              '<span style="font-size:9px;color:#4F4535;margin-top:2px">on the<br>house</span></label>':'')+
            '<span style="display:flex;flex-direction:column;align-items:center;line-height:1.1">'+
              '<input class="pe-in" style="width:56px;padding:4px 6px;text-align:center'+(minv?';border-color:#B00020;color:#B00020':'')+'" type="number" step="0.5" min="0" value="'+it.pcs_per_guest+'" onchange="peSetPcs(\''+it.id+'\',this.value)"'+(ce?'':' disabled')+'>'+
              '<span style="font-size:9.5px;color:#4F4535;margin-top:2px">pieces / guest</span></span>'+
            (ce?'<span class="pe-x" onclick="peRemoveItem(\''+it.id+'\')">✕</span>':'')+'</span></div>';
      }).join('') : '<div style="font-size:12px;color:#4F4535;padding:6px 0">'+(ce?'No dishes yet — apply a package or add from the library.':'No dishes on this event yet.')+'</div>');
    if(ce) h += '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="pe-btn sec sm" onclick="peOpenDishPicker(\''+e.id+'\')">+ Add dish from library</button>'+
      (t.items.length?'<button class="pe-btn sec sm" style="color:#B00020;border-color:#B00020" onclick="peClearMenu(\''+e.id+'\')">Clear menu</button>':'')+'</div>';
  }
  h += '</div></div>';
  // beverage — one dropdown carries the whole choice: no package · no alcohol
  // (soft drinks & water) · or a package (alcohol-free ones are labelled).
  var bevOpts = peState.bevs.filter(function(b){ return b.active!==false || b.id===e.bev_package_id; });
  var bevIsDry = (e.bev_mode==='dry' && !e.bev_package_id);
  h += '<div class="pe-card"><b style="font-size:14px;color:#400207">Beverage</b>'+
    '<div style="margin-top:8px"><select class="pe-in" id="pe-f-bev_package_id" onchange="peSetBeverage(\''+e.id+'\',this.value)"'+(ce?'':' disabled')+'>'+
      '<option value=""'+(!e.bev_package_id && !bevIsDry?' selected':'')+'>No beverage package</option>'+
      '<option value="dry"'+(bevIsDry?' selected':'')+'>No alcohol — soft drinks &amp; water</option>'+
      bevOpts.map(function(b){ return '<option value="'+b.id+'"'+(e.bev_package_id===b.id?' selected':'')+'>'+peEsc(b.name)+' — '+(b.duration_hours?b.duration_hours+'h — ':'')+(b.price_pp!=null?'AED '+peMoney(b.price_pp)+'/guest':'price on the proposal')+(b.non_alcoholic?' · alcohol-free':'')+(b.active===false?' (retired)':'')+'</option>'; }).join('')+
    '</select>'+
    (bevIsDry
      ? '<div style="font-size:12px;color:#8A2A1A;background:#FBE9E7;border-radius:8px;padding:8px 10px;margin-top:8px">No alcohol will be served — this is stated on every document and the beverage charge is AED 0.</div>'
      : '')+
    (e.bev_package_id && peBevById(e.bev_package_id) ? '<div style="font-size:11.5px;color:#4F4535;margin-top:6px">'+peEsc(peBevById(e.bev_package_id).includes||'')+'</div>' : '')+
    '</div></div>';
  // agreement (terms Valentina adjusts per event; guest signs via the link)
  var agBase = peAgBase(e);                        // already has any courtesy discount taken off
  var agPct = e.deposit_pct==null ? 50 : Number(e.deposit_pct);
  var agDep = peDepositAmt(e);
  var agDisc = Math.max(0, Number(e.discount)||0);
  h += '<div class="pe-card"><b style="font-size:14px;color:#400207">Agreement</b>';
  if(e.signed_at){
    h += '<div style="font-size:12px;color:#2E6B34;background:#E7F0E4;border-radius:8px;padding:9px 11px;margin-top:8px">✓ Signed by <b>'+peEsc(e.signed_name||'')+'</b>'+(e.signed_designation?' ('+peEsc(e.signed_designation)+')':'')+' on '+peEsc(String(e.signed_at).slice(0,10))+
      (e.contract_snapshot?' · <span style="text-decoration:underline;cursor:pointer" onclick="peViewSignedCopy(\''+e.id+'\')">open the signed copy</span>':'')+'</div>'+
      '<div style="font-size:11px;color:#4F4535;margin-top:6px">The signed terms are frozen — edits here no longer change what the client agreed to.</div>';
  } else {
    h += '<div style="font-size:11px;color:#4F4535;margin:2px 0 8px">'+(ce?'These fill the agreement the guest signs. Changes save as you leave each field.':'The terms the agreement is built from.')+'</div>'+
      '<div class="pe-grid3">'+
      '<div><div class="pe-lbl">Pricing</div><select class="pe-in" onchange="peSaveField(\''+e.id+'\',\'pricing_type\',this.value)"'+(ce?'':' disabled')+'>'+
        '<option value="set_price"'+(e.pricing_type!=='min_spend'?' selected':'')+'>Set price (from totals)</option>'+
        '<option value="min_spend"'+(e.pricing_type==='min_spend'?' selected':'')+'>Minimum spend</option></select>'+
        (e.pricing_type==='min_spend' ? '<div style="font-size:11px;margin-top:3px">'+(e.min_spend?'<b style="color:#400207">AED '+peMoney(e.min_spend)+'</b> <span style="color:#4F4535">— set up top</span>':'<span style="color:#B00020;cursor:pointer;text-decoration:underline" onclick="peScrollToField(\'min_spend\',\'Type the minimum spend in the facts above\')">▲ set the amount up top</span>')+'</div>' : '')+'</div>'+
      '<div><div class="pe-lbl">Deposit %</div><input class="pe-in" type="number" min="0" max="100" step="5" value="'+peEsc(agPct)+'" onchange="peSaveField(\''+e.id+'\',\'deposit_pct\',this.value===\'\'?null:Number(this.value))"'+(ce?'':' disabled')+'></div>'+
      '<div><div class="pe-lbl">Guests the client pays for (minimum)</div><input class="pe-in" type="number" value="'+peEsc(e.guests_min!=null?e.guests_min:'')+'" placeholder="'+peEsc(e.guests||'')+'" onchange="peSaveField(\''+e.id+'\',\'guests_min\',this.value?parseInt(this.value,10):null)"'+(ce?'':' disabled')+'></div>'+
      // A courtesy discount comes straight off the quoted price (so the deposit and
      // the signed agreement follow it). Saved via peFact = logged + voids if signed.
      '<div><div class="pe-lbl">Discount / courtesy (AED)</div><input class="pe-in" id="pe-f-discount" type="number" min="0" step="50" value="'+(agDisc>0?peEsc(agDisc):'')+'" placeholder="0" onchange="peFact(this,\'discount\',\''+e.id+'\')"'+(ce?'':' disabled')+'></div>'+
      '</div>'+
      '<div style="margin-top:8px"><div class="pe-lbl">Extras / remarks on the agreement (cake, flowers, tobacco, set-up…)</div>'+
      '<input class="pe-in" value="'+peEsc(e.agreement_remarks||'')+'" onchange="peSaveField(\''+e.id+'\',\'agreement_remarks\',this.value||null)"'+(ce?'':' disabled')+'></div>'+
      '<div style="font-size:12px;color:#6B4A33;margin-top:8px">'+
      (agBase!=null
        ? (e.pricing_type==='min_spend'?'Minimum spend':'Quoted price')+': <b style="color:#400207">AED '+peMoney(agBase)+'</b>'+
          (agDisc>0?' <span style="color:#4A6B2E">(after AED '+peMoney(agDisc)+' courtesy)</span>':'')+
          (agPct>0?' · deposit '+agPct+'%: <b style="color:#400207">AED '+peMoney(agDep)+'</b>':' · no deposit — balance on the day')
        : (e.pricing_type==='min_spend'
            ? '<span style="color:#B00020;cursor:pointer;text-decoration:underline" onclick="peScrollToField(\'min_spend\',\'Type the minimum spend in the facts above\')">▲ Set the minimum spend above first.</span>'
            : (!e.guests
                ? '<span style="color:#B00020;cursor:pointer;text-decoration:underline" onclick="peScrollToField(\'guests\',\'Add the guest count in the facts above\')">▲ Add the guest count above first.</span>'
                : '<span style="color:#B00020;cursor:pointer;text-decoration:underline" onclick="peScrollToCard(\'food\')">▲ Add the menu or a set food price first — the quoted price comes from it.</span>')))+
      '</div>';
  }
  // Payment link (from the Telr portal) — shown signed OR unsigned, because the
  // link is usually generated AFTER signing. It's an ops field, not a contract
  // term, so it saves quietly (no void). While empty, the agreement promises no
  // link — the events team contacts the guest instead (see event-agreement fn).
  h += '<div style="margin-top:'+(e.signed_at?'10px':'12px')+';border-top:1px dashed rgba(107,31,42,0.18);padding-top:10px">'+
    '<div class="pe-lbl">Payment link (from the Telr portal)</div>'+
    '<input class="pe-in" id="pe-f-payment_link" value="'+peEsc(e.payment_link||'')+'" placeholder="Paste the Telr payment link here" onchange="peSaveField(\''+e.id+'\',\'payment_link\',this.value.trim()||null)"'+(ce?'':' disabled')+'>'+
    '<div style="font-size:11px;color:#4F4535;margin-top:4px">'+
      (e.payment_link
        ? (e.signed_at
            ? '✓ A “Send payment link” button is ready — below, in the guided view and in Documents.'
            : 'Once the agreement is signed, a “Send payment link” button appears here and in Documents.')
        : 'While this is empty, the agreement tells the guest the events team will contact them to arrange the deposit — no broken link is promised.')+
    '</div></div>';
  h += '</div>';
  // follow-ups
  h += '<div class="pe-card"><b style="font-size:14px;color:#400207">Follow-up log</b>'+
    (ce?'<div style="display:flex;gap:6px;margin:8px 0"><input class="pe-in" id="pe-fu-note" placeholder="e.g. Called Ramona — waiting on final guest count"><button class="pe-btn sm" onclick="peAddFollowup(\''+e.id+'\')">Add</button></div>':'<div style="margin:8px 0"></div>')+
    (log.length ? log.map(function(l){
      var d = new Date(l.created_at);
      var head = '<span class="t">'+d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})+' · '+peEsc(l.actor||'')+'</span>';
      // Katarina, 8 Aug 2026: the log was append-only, so a note typed into the wrong
      // box stayed on the event forever. Her own words can be corrected in place; the
      // recorded history can only be removed, never rewritten.
      if(ce && String(peState.logEdit) === String(l.id)){
        return '<div class="pe-log"><div class="pe-log-h">'+head+'</div>'+
          '<textarea class="pe-in" id="pe-log-edit-'+l.id+'" rows="2" style="margin:5px 0">'+peEsc(peLogEditablePart(l))+'</textarea>'+
          (l.action==='lost' ? '<div style="font-size:10.5px;color:#4F4535;margin:-2px 0 5px">This is also the lost reason shown on the event.</div>' : '')+
          '<div class="pe-log-acts"><button class="pe-btn sm" onclick="peSaveLogEdit(\''+e.id+'\','+l.id+')">Save</button>'+
          '<button class="pe-btn sm sec" onclick="peCancelLogEdit()">Cancel</button></div></div>';
      }
      var acts = '';
      if(ce){
        acts = '<div class="pe-log-acts">'+
          (PE_LOG_EDITABLE[l.action] ? '<button class="pe-log-act" onclick="peStartLogEdit('+l.id+')">Edit</button>' : '')+
          (l.action==='created' ? '' : '<button class="pe-log-act danger" onclick="peDeleteLogLine(\''+e.id+'\','+l.id+')">Delete</button>')+
          '</div>';
      }
      return '<div class="pe-log"><div class="pe-log-h">'+head+acts+'</div>'+peEsc(peLogLine(l))+'</div>';
    }).join('') : '<div style="font-size:12px;color:#4F4535">Nothing logged yet.</div>')+'</div>';
  h += '</div><div>';
  // totals
  // On a minimum-spend booking the MINIMUM is the price she charges — the rows below
  // are only what the menu adds up to so far, which is usually 0 while she is still
  // building it. Leading with those made every min-spend event read "AED 0".
  var isMin = e.pricing_type==='min_spend';
  var msAmt = Number(e.min_spend)||0;
  h += '<div class="pe-tot">'+
    '<div class="pe-lbl" style="color:#574232">Live totals</div>'+
    (isMin
      ? '<div class="pe-tot-row" style="border-bottom:1px solid #DCC9B2;padding-bottom:7px;margin-bottom:5px"><span>Minimum spend</span><b style="color:#400207">'+
          (msAmt ? 'AED '+peMoney(msAmt) : '— set it above')+'</b></div>'+
        '<div style="font-size:11px;color:#4F4535;margin:-3px 0 7px">This is what they are charged. Below is what the menu comes to so far.</div>'
      : '')+
    '<div class="pe-tot-row"><span>Food / guest</span><b>AED '+peMoney(t.foodPP||0)+(e.food_price_pp!=null&&e.food_price_pp!==''?' (set)':'')+'</b></div>'+
    '<div class="pe-tot-row"><span>Beverage / guest</span><b>AED '+peMoney(t.bevPP)+'</b></div>'+
    '<div class="pe-tot-row" style="border-top:1px solid #DCC9B2;margin-top:4px;padding-top:7px"><span>Per guest</span><b>AED '+peMoney(t.perGuest)+'</b></div>'+
    '<div class="pe-tot-row"><span>× '+(e.guests||'—')+' guests</span><b>AED '+peMoney(t.subtotal)+'</b></div>';
  // A courtesy discount shows as its own line, then the discounted total below it.
  if(t.discount>0){
    h += '<div class="pe-tot-row"><span>Discount / courtesy</span><b style="color:#4A6B2E">− AED '+peMoney(t.discount)+'</b></div>'+
      '<div class="pe-tot-row" style="border-top:1px solid #DCC9B2;margin-top:4px;padding-top:7px"><span>Total</span><b>AED '+peMoney(t.total)+'</b></div>';
  }
  // Only compare once something is actually priced. Comparing against a total of 0
  // told her every untouched minimum-spend booking was short by its whole minimum —
  // which then made the warning meaningless on the bookings that genuinely fall short.
  if(e.min_spend && t.total){
    var gap = Number(e.min_spend)-t.total;
    h += gap>0 ? '<div class="pe-flag" style="color:#7A5500">▲ AED '+peMoney(gap)+' below the '+peMoney(e.min_spend)+' min spend</div>'
               : '<div class="pe-flag" style="color:#2E5B30">✓ Min spend covered</div>';
  }
  // #3 (Batch 1) — a set food price the dishes have outgrown must never drift silently.
  if(e.food_price_pp!=null && e.food_price_pp!=='' && Math.round(t.foodComputed) > Math.round(Number(e.food_price_pp))){
    h += '<div class="pe-flag" style="color:#7A5500">▲ Dishes worth AED '+peMoney(t.foodComputed)+'/guest — you’re charging the set AED '+peMoney(e.food_price_pp)+'</div>';
  }
  // A dish on the quote with no price is money she is not charging for.
  if(t.noPrice && t.noPrice.length){
    h += '<div class="pe-flag" style="color:#B00020">▲ No price set, so charged as 0: '+peEsc(t.noPrice.join(', '))+'</div>';
  }
  if(t.foodCostPct!=null){
    // A missing cost counts as zero in the maths, so the percentage reads better
    // than the truth. Say the figure is incomplete rather than showing a green tick.
    var costBlind = t.noCost && t.noCost.length;
    h += '<div class="pe-flag" style="color:'+(costBlind?'#7A5500':(t.foodCostPct<=27?'#2E5B30':'#7A5500'))+'">'+
      (costBlind?'▲':(t.foodCostPct<=27?'✓':'▲'))+' Food cost '+t.foodCostPct.toFixed(1)+'%'+
      (costBlind
        ? ' — at least. No cost recorded for '+peEsc(t.noCost.join(', '))+', so the real figure is higher.'
        : (t.foodCostPct<=27?' — on target':' — above the 27% target'))+'</div>';
  }
  if(t.pcs){
    // Informational — there is no piece-count norm; the client's budget sets it.
    h += '<div class="pe-flag" style="color:#6B4A33">'+(Math.round(t.pcs*10)/10)+' pieces / guest</div>';
  }
  if(t.missingAllergens.length){
    h += '<div class="pe-flag" style="color:#B00020">▲ Allergens missing: '+peEsc(t.missingAllergens.join(', '))+'</div>';
  }
  h += '</div>';
  // After the event — the real revenue. Once a booking is confirmed onward, more
  // guests than quoted or extra bar / off-menu spend can lift what was actually
  // charged. One box: type the REAL final total and it becomes this event's revenue
  // in the monthly report. Left blank, the quoted total stands. The signed
  // agreement and the deposit never move — this is actuals, not the quote.
  if(peIsConverted(e)){
    var actSet = (e.actual_revenue!=null && e.actual_revenue!=='');
    var actVal = actSet ? Math.max(0, Number(e.actual_revenue)) : null;
    var colMissing = !!(peState.colsOk && peState.colsOk.actual_revenue===false);
    h += '<div class="pe-card" style="margin-top:12px;border-color:rgba(201,168,76,0.55);background:#FDFBF6">'+
      '<b style="font-size:14px;color:#400207">After the event — real revenue</b>'+
      '<div style="font-size:11.5px;color:#4F4535;margin:4px 0 9px">More guests showed up, or extra bar / off-menu spend? Put the <b>real final total</b> here — it becomes this event’s revenue in the monthly report. You can also just raise the guest count above. Leave this blank to keep the quoted '+(t.total!=null?'AED '+peMoney(t.total):'amount')+'.</div>'+
      '<div class="pe-lbl">Real total charged (AED)</div>'+
      '<input class="pe-in" type="number" min="0" step="50" value="'+(actSet?peEsc(actVal):'')+'" placeholder="'+(t.total!=null?peMoney(t.total):'quoted total')+'" onchange="peFact(this,\'actual_revenue\',\''+e.id+'\')"'+(ce?'':' disabled')+'>'+
      (actSet
        ? '<div style="margin-top:8px;font-size:12.5px;color:#2E6B34">✓ The report counts <b>AED '+peMoney(actVal)+'</b> for this event'+((t.total!=null && Math.round(actVal)!==Math.round(t.total))?' <span style="color:#4F4535">(quoted was AED '+peMoney(t.total)+')</span>':'')+'.</div>'
        : '')+
      (colMissing
        ? '<div style="margin-top:8px;font-size:11.5px;color:#7A5500;background:#FBF0D6;border:1px solid #DFC680;border-radius:8px;padding:8px 10px">Run <b>foh-events-actualrev.sql</b> once in Supabase before this saves permanently — until then it holds for this session only.</div>'
        : '')+
    '</div>';
  }
  // documents & actions — grouped: what the guest gets, then the team side.
  // Disabled sends stay tappable but explain themselves (toast + jump to field)
  // and carry a visible reason line, never a hover-only tooltip.
  var hasMail = !!e.contact_email, hasPhone = !!e.contact_phone;
  // `arg` carries the send's own option (today: the no-price proposal) through the
  // same disabled-explains-itself path, so it cannot drift from the priced button.
  var mailClick = function(fn, arg){ return hasMail ? fn+'(\''+e.id+'\''+(arg?','+arg:'')+')' : 'peScrollToField(\'contact_email\',\'Add the client email above to send\')'; };
  var dim = function(ok){ return ok?'':' style="opacity:.55"'; };
  var grpLbl = 'font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#544418;margin:2px 2px 5px';
  var sendMoreOpen = !!(peState.sendMore && peState.sendMore[e.id]);
  if(!ce){
    // Read-only Documents: everything stays readable/printable, nothing sends.
    h += '<div class="pe-card" id="pe-card-docs" style="margin-top:12px"><b style="font-size:14px;color:#400207">Documents</b>'+
      '<div style="font-size:11.5px;color:#4F4535;margin:4px 0 8px">View and print — sending is done by Katarina, Andrea or Francesco.</div>'+
      '<div style="display:flex;flex-direction:column;gap:7px">'+
      '<button class="pe-btn sec" onclick="pePrintProposal(\''+e.id+'\')">Print / view the proposal (PDF)</button>'+
      '<button class="pe-btn sec" onclick="pePrintFunctionSheet(\''+e.id+'\')">Print / view the event brief</button>'+
      (e.contract_snapshot?'<button class="pe-btn sec" onclick="peViewSignedCopy(\''+e.id+'\')">Open the signed agreement</button>':'')+
      '</div></div>';
    h += '</div></div>';
    return h+'</div>';
  }
  h += '<div class="pe-card" id="pe-card-docs" style="margin-top:12px"><b style="font-size:14px;color:#400207">Documents</b>'+
    '<div style="'+grpLbl+';margin-top:10px">For the guest</div>'+
    '<div style="font-size:11.5px;color:#6B4A33;background:#F7EEE2;border-radius:8px;padding:8px 10px;margin-bottom:8px">Most bookings: send the full proposal so the guest can sign online.</div>'+
    // How the price reads on the guest's proposal — whole event or per person.
    // Both live figures are on the buttons so the choice shows its own result.
    ((t.total && e.guests) ?
      '<div style="'+grpLbl+'">Price the guest sees on the proposal</div>'+
      '<div style="display:flex;border:1px solid rgba(107,31,42,0.3);border-radius:8px;overflow:hidden;margin-bottom:9px">'+
        '<button onclick="peSetPriceDisplay(\''+e.id+'\',\'total\')" style="flex:1;border:none;padding:9px 6px;cursor:pointer;font-size:12px;line-height:1.25;'+((e.price_display==='pp')?'background:#fff;color:#6B4A33':'background:#400207;color:#fff;font-weight:600')+'">Whole event<br><span style="font-size:11px;font-weight:400;opacity:.85">AED '+peMoney(t.total)+'</span></button>'+
        '<button onclick="peSetPriceDisplay(\''+e.id+'\',\'pp\')" style="flex:1;border:none;border-left:1px solid rgba(107,31,42,0.2);padding:9px 6px;cursor:pointer;font-size:12px;line-height:1.25;'+((e.price_display==='pp')?'background:#400207;color:#fff;font-weight:600':'background:#fff;color:#6B4A33')+'">Per person<br><span style="font-size:11px;font-weight:400;opacity:.85">AED '+peMoney(Math.round(t.total/e.guests))+' pp</span></button>'+
      '</div>'
    : '')+
    '<div style="display:flex;flex-direction:column;gap:7px">'+
    // "Send" that never becomes "Re-send" left her unable to tell, on a booking she
    // opened cold, whether the client had been sent anything. The team-brief button
    // eight lines below already does this properly — same pattern here.
    '<button class="pe-btn"'+dim(hasMail)+' onclick="'+mailClick('peEmailAgreement')+'">'+
      (peProposalSent(e)?'Re-send the full proposal (client signs online)':'Send full proposal (client signs online)')+'</button>'+
    (peProposalSent(e)?'<div style="font-size:11.5px;color:#2E5B30;margin:-3px 2px 2px">Sent '+peDLabel(String(peProposalSent(e)).slice(0,10))+' ✓</div>':'')+
    // The actual page the client opens, not a mock-up of it and not the Print
    // version, which is a different document built by different code. She had no
    // way to see what she was sending before sending it.
    '<button class="pe-btn sec" onclick="pePreviewClient(\''+e.id+'\')">Preview what the client sees</button>'+
    (hasMail?'':'<div style="font-size:11px;color:#8A2A1A;margin:-3px 2px 2px">Add the client email above to send.</div>')+
    // Once signed AND a Telr link is pasted on the Agreement card, one named,
    // confirmed, logged send to collect the deposit. (Deposit-paid stays a manual flip.)
    ((e.signed_at && e.payment_link && hasMail)
      ? '<button class="pe-btn" onclick="peSendPaymentLink(\''+e.id+'\')">Send payment link to '+peEsc(e.contact_email)+' — AED '+peMoney(peDepositAmt(e))+' deposit</button>'
      : '')+
    // The other four sends are one tap away, not a wall.
    '<div style="border:1px solid rgba(107,31,42,0.25);border-radius:8px;padding:9px 11px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;color:#6B4A33" onclick="peState.sendMore=peState.sendMore||{};peState.sendMore[\''+e.id+'\']='+(!sendMoreOpen)+';renderMain()">'+
      '<span style="font-size:12.5px">More ways to send</span><span style="font-size:11px;color:#574232">price only · WhatsApp · copy link · print '+(sendMoreOpen?'▴':'▾')+'</span></div>'+
    (sendMoreOpen ?
      '<button class="pe-btn sec"'+dim(hasMail)+' onclick="'+mailClick('peEmailProposal')+'">Send price &amp; menu only (no signing)</button>'+
      // Sending the food before the money is a normal first move on this desk, not
      // an edge case — the previous sales lead asked for it. Her choice on every
      // send, so it sits beside the priced one rather than replacing it or being
      // decided for her by the booking's stage.
      '<button class="pe-btn sec"'+dim(hasMail)+' onclick="'+mailClick('peEmailProposal','true')+'">Send the menu only — no prices</button>'+
      '<button class="pe-btn sec" onclick="peCopyClientLink(\''+e.id+'\')">Copy the guest’s menu link</button>'+
      '<div style="display:flex;gap:7px"><button class="pe-btn sec" style="flex:1"'+dim(hasPhone)+' onclick="'+(hasPhone?'peWhatsApp(\''+e.id+'\')':'peScrollToField(\'contact_phone\',\'Add the client phone for WhatsApp\')')+'">WhatsApp</button>'+
      '<button class="pe-btn sec" style="flex:1" onclick="peCopyAgreementLink(\''+e.id+'\')">Copy signing link</button>'+
      '<button class="pe-btn sec" style="flex:1" onclick="pePrintProposal(\''+e.id+'\')">Print PDF</button></div>'+
      (hasPhone?'':'<div style="font-size:11px;color:#8A2A1A;margin:-3px 2px 2px">Add the client phone for WhatsApp.</div>')
      : '')+
    (e.client_selection ? '<div style="font-size:11.5px;color:#2E6B34;background:#E7F0E4;border-radius:8px;padding:8px 10px">Client picked '+((e.client_selection.dish_ids||[]).length)+' dishes'+(e.client_selection.note?' · “'+peEsc(e.client_selection.note)+'”':'')+' <span style="text-decoration:underline;cursor:pointer" onclick="peApplyClientSelection(\''+e.id+'\')">apply to event</span></div>' : '')+
    '</div>'+
    '<div style="'+grpLbl+';margin-top:12px">For the team</div>'+
    '<div style="display:flex;flex-direction:column;gap:7px">'+
    '<button class="pe-btn" onclick="peSendCoordEmail(\''+e.id+'\')">'+(peBriefSent(e)?'Re-send the event brief to the team':'Send the event brief to the team')+'</button>'+
    (peBriefSent(e)?'<div style="font-size:11.5px;color:#2E5B30;margin:-3px 2px 2px">Sent '+peDLabel(String(peState.briefSent[e.id]).slice(0,10))+' ✓</div>':'')+
    '<button class="pe-btn sec" onclick="pePrintFunctionSheet(\''+e.id+'\')">Print the event brief</button>'+
    '</div></div>';
  h += '</div></div>';
  return h+'</div></div>';   // pe-sheet, pe-wrap
}
// Facts-card fields auto-save on blur (peFact), matching the fields below — one
// save model per screen, each with a visible "Saved ✓".
// ── The three "one booking, more than one answer" cards ────────────────────
// Each stays a QUIET ONE-LINER until it is used. Most bookings are one room, one
// date, one price, and an editor that shows three empty sections to everybody
// would make the ordinary booking harder to serve the rare one.
function peQuietAdd(prompt, act, ce, why){
  if(!ce) return '';
  return '<div class="pe-card" style="padding:9px 13px;background:#FCFAF6;border-style:dashed;cursor:pointer" onclick="'+act+'">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
    '<span style="font-size:12.5px;color:#4F4535">'+prompt+'</span>'+
    '<span style="font-size:12px;color:#6B1F2A;font-weight:600;white-space:nowrap">'+why+' ›</span></div></div>';
}
// Said BEFORE she builds something the database cannot keep. Everything still
// works on screen — it just will not survive a reload until the file is run.
function peNeedsSqlHTML(col){
  if(!peState.colsOk || peState.colsOk[col] !== false) return '';
  return '<div style="margin-top:8px;background:#FBF0D6;border:1px solid #DFC680;border-radius:9px;padding:9px 12px;font-size:12.5px;color:#7A5500">'+
    '&#9888; <b>This will not save yet.</b> It works on screen, but it is lost when the page reloads until '+
    '<b>foh-events-oneevening.sql</b> has been run once in Supabase. Ask Francesco — it takes a minute.</div>';
}
var PE_SUBCARD = 'background:#FBF7F0;border:1px solid rgba(107,31,42,0.16);border-radius:9px;padding:10px 12px;margin-top:8px';

// #5 — "Canapés in the Cortile first, then dinner in Piemonte." Valentina's
// answer to what the guest should get was two words: "only 1 price". So this
// card adds rooms and times and has nowhere to type a second price, and the
// line at the bottom says the total is for the whole evening.
function peEveningCardHTML(e, ce){
  var extras = peExtraSpacesRaw(e);
  if(!extras.length) return peQuietAdd(
    'Canapés in one space first, then dinner in another? Keep it as <b>one booking at one price</b>.',
    'peAddSpace(\''+e.id+'\')', ce, '+ Add a second space');
  var t = peCalcTotals(e);
  var h = '<div class="pe-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
    '<b style="font-size:14px;color:#400207">The run of the evening</b>'+
    (ce?'<button class="pe-btn sec sm" onclick="peAddSpace(\''+e.id+'\')">+ Add another space</button>':'')+'</div>'+
    '<div style="font-size:11.5px;color:#4F4535;margin-top:3px">One booking, one price — the guest is never quoted twice for one evening.</div>'+peNeedsSqlHTML('spaces');
  // The first leg is the event's own area and time, edited above. Shown here
  // read-only so the evening reads in order, rather than starting mid-way.
  h += '<div style="'+PE_SUBCARD+';background:#F3E9DA">'+
    '<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#4F4535">First</div>'+
    '<div style="font-size:13.5px;color:#400207">'+peEsc(e.area||'— set the venue above')+
    ((e.time_from||e.time_to)?' <span style="color:#4F4535">'+peEsc([e.time_from,e.time_to].filter(Boolean).join('–'))+'</span>':'')+'</div>'+
    '<div style="font-size:11px;color:#574232">Set in the details above</div></div>';
  extras.forEach(function(s, i){
    h += '<div style="'+PE_SUBCARD+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'+
      '<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#4F4535">Then</div>'+
      (ce?'<span style="font-size:11.5px;color:#8A2A1A;cursor:pointer;text-decoration:underline" onclick="peRemoveSpace(\''+e.id+'\','+i+')">Remove</span>':'')+'</div>'+
      '<div class="pe-grid2" style="margin-top:6px">'+
      '<div><div class="pe-lbl">Venue / area</div><select class="pe-in" onchange="peSetSpace(this,\''+e.id+'\','+i+',\'area\')"'+(ce?'':' disabled')+'>'+
        '<option value=""></option>'+PE_AREAS.map(function(a){ return '<option'+(s.area===a?' selected':'')+'>'+a+'</option>'; }).join('')+'</select></div>'+
      '<div><div class="pe-lbl">What happens here</div><input class="pe-in" value="'+peEsc(s.note||'')+'" placeholder="e.g. Dinner" onchange="peSetSpace(this,\''+e.id+'\','+i+',\'note\')"'+(ce?'':' disabled')+'></div>'+
      '</div><div class="pe-grid2" style="margin-top:8px">'+
      '<div><div class="pe-lbl">From</div><select class="pe-in" onchange="peSetSpace(this,\''+e.id+'\','+i+',\'from\')"'+(ce?'':' disabled')+'>'+peTimeOptions(s.from)+'</select></div>'+
      '<div><div class="pe-lbl">Until</div><select class="pe-in" onchange="peSetSpace(this,\''+e.id+'\','+i+',\'to\')"'+(ce?'':' disabled')+'>'+peTimeOptions(s.to)+'</select></div>'+
      '</div></div>';
  });
  h += '<div style="margin-top:10px;background:#EEF3E4;border:1px solid #C3D3A6;border-radius:9px;padding:9px 12px;font-size:12.5px;color:#3F5222">'+
    '<b>One price for the whole evening</b> — '+(t.total!=null
      ? 'AED '+peMoney(t.total)+(e.guests?' for '+e.guests+' guests':'')
      : (e.min_spend ? 'minimum spend AED '+peMoney(e.min_spend) : 'set the food and guests above'))+
    '. The guest sees the rooms and the times, and <b>one total</b>.</div>';
  return h + '</div>';
}

// #13 — "Either the 12th or the 19th — whichever you have." One booking holds
// both, so neither is forgotten. event_date stays the first choice, which is
// why every report still counts this booking exactly once.
function peAltDatesCardHTML(e, ce){
  var alts = peAltDatesRaw(e);
  if(!alts.length) return peQuietAdd(
    'Guest gave you <b>two possible dates</b>? Hold them both on this one booking.',
    'peAddAltDate(\''+e.id+'\')', ce, '+ Add another possible date');
  var h = '<div class="pe-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
    '<b style="font-size:14px;color:#400207">Dates we are holding</b>'+
    (ce?'<button class="pe-btn sec sm" onclick="peAddAltDate(\''+e.id+'\')">+ Add another</button>':'')+'</div>'+
    '<div style="font-size:11.5px;color:#4F4535;margin-top:3px">One booking, not two drafts — so neither date gets forgotten. It shows on the calendar on every date below, and still counts <b>once</b> in the report.</div>'+peNeedsSqlHTML('alt_dates');
  h += '<div style="'+PE_SUBCARD+';background:#F3E9DA;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
    '<span><span style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#4F4535">First choice</span><br>'+
    '<b style="font-size:13.5px;color:#400207">'+peEsc(peDLabel(e.event_date))+'</b></span>'+
    '<span style="font-size:11px;color:#574232">This is the date on the booking</span></div>';
  alts.forEach(function(d, i){
    h += '<div style="'+PE_SUBCARD+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'+
      '<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#4F4535">Or</div>'+
      (ce?'<span style="font-size:11.5px;color:#8A2A1A;cursor:pointer;text-decoration:underline" onclick="peRemoveAltDate(\''+e.id+'\','+i+')">Remove</span>':'')+'</div>'+
      '<div class="pe-grid3" style="margin-top:6px">'+
      '<div><div class="pe-lbl">Date</div><input class="pe-in" type="date" value="'+peEsc(d.date?String(d.date).slice(0,10):'')+'" onchange="peSetAltDate(this,\''+e.id+'\','+i+',\'date\')"'+(ce?'':' disabled')+'></div>'+
      '<div><div class="pe-lbl">From (if different)</div><select class="pe-in" onchange="peSetAltDate(this,\''+e.id+'\','+i+',\'from\')"'+(ce?'':' disabled')+'>'+peTimeOptions(d.from)+'</select></div>'+
      '<div><div class="pe-lbl">Until (if different)</div><select class="pe-in" onchange="peSetAltDate(this,\''+e.id+'\','+i+',\'to\')"'+(ce?'':' disabled')+'>'+peTimeOptions(d.to)+'</select></div>'+
      '</div>'+
      (ce?'<div style="margin-top:8px"><button class="pe-btn sm"'+(d.date?'':' disabled title="Put a date in first"')+' onclick="pePickDate(\''+e.id+'\','+i+')">Guest chose this date</button>'+
        (d.date?'':'<span style="font-size:11px;color:#4F4535;margin-left:8px">Put a date in first</span>')+'</div>':'')+
      '</div>';
  });
  return h + '</div>';
}

// #12 — "Send me three options and I'll pick one." One enquiry, one email, one
// line in the pipeline. Picking one writes it onto the booking, so there is
// nothing left to tidy up by hand afterwards.
function peOptionsCardHTML(e, ce, t){
  var opts = peOptions(e);
  if(!opts.length) return peQuietAdd(
    'Guest asked for <b>a few options to choose from</b>? Build them on this one enquiry.',
    'peAddOption(\''+e.id+'\')', ce, '+ Offer options');
  var chosen = peChosenOption(e);
  var vals = peOptionValues(e);
  var h = '<div class="pe-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
    '<b style="font-size:14px;color:#400207">Options for the guest</b>'+
    (ce?'<button class="pe-btn sec sm" onclick="peAddOption(\''+e.id+'\')">+ Add an option</button>':'')+'</div>'+
    '<div style="font-size:11.5px;color:#4F4535;margin-top:3px">One enquiry and <b>one email</b> with all of them — not three bookings and three emails to tidy up afterwards.</div>'+peNeedsSqlHTML('options');
  opts.forEach(function(o, i){
    var tot = peOptionTotal(e, o);
    var isChosen = chosen && chosen.key === o.key;
    h += '<div style="'+PE_SUBCARD+(isChosen?';border-color:#4E9E56;background:#EEF6EC':'')+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
      '<b style="font-size:13px;color:#400207">Option '+peEsc(o.key)+(isChosen?' <span style="color:#2E6B34">✓ this is the booking</span>':'')+'</b>'+
      '<span style="display:flex;gap:10px;align-items:center">'+
      '<b style="font-size:13px;color:#400207">'+(tot!=null?'AED '+peMoney(tot):'—')+'</b>'+
      (ce?'<span style="font-size:11.5px;color:#8A2A1A;cursor:pointer;text-decoration:underline" onclick="peRemoveOption(\''+e.id+'\','+i+')">Remove</span>':'')+
      '</span></div>'+
      '<div class="pe-grid2" style="margin-top:6px">'+
      '<div><div class="pe-lbl">Call it</div><input class="pe-in" value="'+peEsc(o.name||'')+'" placeholder="e.g. Cortile canapés" onchange="peSetOption(this,\''+e.id+'\','+i+',\'name\')"'+(ce?'':' disabled')+'></div>'+
      '<div><div class="pe-lbl">Venue / area</div><select class="pe-in" onchange="peSetOption(this,\''+e.id+'\','+i+',\'area\')"'+(ce?'':' disabled')+'>'+
        '<option value=""></option>'+PE_AREAS.map(function(a){ return '<option'+(o.area===a?' selected':'')+'>'+a+'</option>'; }).join('')+'</select></div>'+
      '</div><div class="pe-grid3" style="margin-top:8px">'+
      '<div><div class="pe-lbl">Guests</div><input class="pe-in" type="number" value="'+peEsc(o.guests==null?'':o.guests)+'" placeholder="'+peEsc(e.guests||'')+'" onchange="peSetOption(this,\''+e.id+'\','+i+',\'guests\')"'+(ce?'':' disabled')+'></div>'+
      '<div><div class="pe-lbl">Price / guest (AED)</div><input class="pe-in" type="number" value="'+peEsc(o.price_pp==null?'':o.price_pp)+'" onchange="peSetOption(this,\''+e.id+'\','+i+',\'price_pp\')"'+(ce?'':' disabled')+'></div>'+
      '<div><div class="pe-lbl">Or a minimum spend</div><input class="pe-in" type="number" value="'+peEsc(o.min_spend==null?'':o.min_spend)+'" onchange="peSetOption(this,\''+e.id+'\','+i+',\'min_spend\')"'+(ce?'':' disabled')+'></div>'+
      '</div>'+
      '<div style="margin-top:8px"><div class="pe-lbl">Anything to say about it</div>'+
      '<input class="pe-in" value="'+peEsc(o.note||'')+'" placeholder="e.g. our quietest space" onchange="peSetOption(this,\''+e.id+'\','+i+',\'note\')"'+(ce?'':' disabled')+'></div>'+
      (ce && !isChosen ? '<div style="margin-top:8px"><button class="pe-btn sm" onclick="peApplyOption(\''+e.id+'\',\''+peEsc(o.key)+'\')">Guest chose this one</button></div>' : '')+
      '</div>';
  });
  // What this enquiry is worth to the pipeline, said out loud. An unanswered set
  // of options is counted at its LOWEST — never the sum, which would book the
  // same guest three times over.
  h += chosen
    ? '<div style="margin-top:10px;background:#EEF6EC;border:1px solid #BAD9B4;border-radius:9px;padding:9px 12px;font-size:12.5px;color:#2E6B34">'+
      '<b>Option '+peEsc(chosen.key)+' is on the booking.</b> Its venue, guests and price were written onto the enquiry, so everything from here reads as an ordinary booking. The others stay here as a record of what was offered.</div>'
    : '<div style="margin-top:10px;background:#FBF3DE;border:1px solid #DFC680;border-radius:9px;padding:9px 12px;font-size:12.5px;color:#6B4A00">'+
      'Until the guest picks, the report counts this as <b>one enquiry</b> worth '+
      (vals.length ? '<b>AED '+peMoney(Math.min.apply(null, vals))+'</b> — the lowest of the '+opts.length+' options, because that is the least they might spend' : '<b>—</b> (put a price on the options)')+
      '. Never the '+opts.length+' added together.</div>';
  return h + '</div>';
}

function peIn(lbl, field, e, type){
  var v = e[field];
  if(type==='date') v = v ? String(v).slice(0,10) : '';
  return '<div><div class="pe-lbl">'+lbl+'</div><input class="pe-in" id="pe-f-'+field+'" type="'+(type||'text')+'" value="'+peEsc(v==null?'':v)+'" onchange="peFact(this,\''+field+'\',\''+e.id+'\')"'+(peCanEdit()?'':' disabled')+'></div>';
}
function peSel(lbl, field, e, opts){
  // Keep an older saved value (e.g. area "Restaurant" from before the list
  // changed) as a selectable option so editing an old event never loses it.
  var list = opts.slice();
  var cur = e[field];
  if(cur && list.indexOf(cur)===-1) list = [cur].concat(list);
  return '<div><div class="pe-lbl">'+lbl+'</div><select class="pe-in" id="pe-f-'+field+'" onchange="peFact(this,\''+field+'\',\''+e.id+'\')"'+(peCanEdit()?'':' disabled')+'>'+
    '<option value=""></option>'+list.map(function(o){ return '<option'+(cur===o?' selected':'')+'>'+o+'</option>'; }).join('')+
  '</select></div>';
}
// Fields whose change is money-relevant / contract-relevant — logged for
// Andrea's audit trail, and (for guests/date) guarded when already signed.
var PE_AUDIT_FIELDS = { guests:'Guests', event_date:'Date', food_price_pp:'Food price/guest', min_spend:'Minimum spend', area:'Area', time_from:'Start time', time_to:'End time', discount:'Discount', actual_revenue:'Real total charged' };
// Which fields, when changed on a SIGNED event, void the agreement (they change
// what the client actually agreed to). Menu changes are guarded separately.
var PE_CONTRACT_FIELDS = ['guests','event_date','area','food_price_pp','min_spend','discount'];
var PE_FACT_INT = { guests:1 };
var PE_FACT_NUM = { min_spend:1, food_price_pp:1, discount:1, actual_revenue:1 };
// One auto-save handler for every facts-card field: coerces the value, keeps the
// contract-void guard + Andrea's audit log, and always shows "Saved ✓".
async function peFact(el, field, id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); renderMain(); return; }
  var e = peEvById(id); if(!e) return;
  var raw = el.value;
  // A typed client email must look like one — flag it inline and don't save the mistake.
  if(field==='contact_email'){
    if(raw.trim() && !peEmailsValid(raw)){ peInlineErr(el, 'One of these isn’t a valid email — add more people with a comma between them.'); return; }
    peInlineErr(el, '');
  }
  var v;
  if(PE_FACT_INT[field]) v = raw.trim() ? parseInt(raw,10) : null;
  else if(PE_FACT_NUM[field]) v = raw.trim() ? Number(raw) : null;
  else if(field==='event_date') v = raw ? String(raw).slice(0,10) : null;
  else v = raw.trim() || null;
  var cur = field==='event_date' ? (e[field]?String(e[field]).slice(0,10):null) : (e[field]==null?null:e[field]);
  if(String(cur==null?'':cur) === String(v==null?'':v)) return;   // nothing changed — stay quiet

  var isAudit = !!PE_AUDIT_FIELDS[field];
  var breaks = !!e.signed_at && PE_CONTRACT_FIELDS.indexOf(field)>=0;
  if(breaks){
    if(!(await peConfirm({title:'This event is already signed',
        html:'Changing the '+peEsc((PE_AUDIT_FIELDS[field]||field).toLowerCase())+' voids the signed agreement — the client will need to sign again.<br><br>The booking <b>stays confirmed and the deposit is kept</b>; you’ll just need to re-send it for signature. Proceed?',
        ok:'Proceed', cancel:'Keep it signed', danger:true}))){
      renderMain(); return;   // revert the field on screen
    }
  }
  var patch = {}; patch[field] = v; patch.updated_at = new Date().toISOString(); patch.updated_by = peActor();
  // P1.10 — typing a minimum spend makes it the pricing basis in one step.
  var autoMin = false;
  if(field==='min_spend' && v!=null && e.pricing_type!=='min_spend'){ patch.pricing_type = 'min_spend'; autoMin = true; }
  if(breaks){
    // Void the signature only — the booking KEEPS its status and deposit.
    // Valentina, 17 Jul 2026: a signed + paid booking that gained +2 guests used to
    // fall back to "Proposal sent", so the deposit dropped out of confirmed figures
    // (and out of Andrea's converted total) as if the money had never arrived. It
    // stays confirmed now; only the paperwork needs re-signing (the banner says so).
    patch.signed_at = null; patch.signed_name = null; patch.signed_designation = null; patch.contract_snapshot = null;
  }
  var r = await sb.from('events_desk').update(patch).eq('id', id);
  if(r.error){
    // Graceful degradation: a new Batch-7 column (e.g. discount) may not be in the
    // database yet — keep the value working in-session rather than a scary error.
    if(peColMissing(r.error, field)){
      e[field] = v;
      peToast('Kept for now — “'+(PE_AUDIT_FIELDS[field]||field)+'” needs the Batch 7 database update to save permanently.', true);
      renderMain(); return;
    }
    peToast('NOT saved — '+(r.error.message||'check connection'), true); return;
  }
  Object.keys(patch).forEach(function(k){ e[k] = patch[k]; });

  if(isAudit && e.status!=='draft'){
    sb.from('event_log').insert({event_id:id, action:'edited', detail:(PE_AUDIT_FIELDS[field]+' → '+(v==null||v===''?'—':v)).slice(0,400), actor:peActor()}).then(function(){ peLoadLog(id); });
  }
  if(breaks){
    peState.voided = peState.voided || {}; peState.voided[id] = true;
    sb.from('event_log').insert({event_id:id, action:'unsigned', detail:'signed agreement voided by editing '+(PE_AUDIT_FIELDS[field]||field), actor:peActor()}).then(function(){ peLoadLog(id); });
    peToast('Saved — the signed agreement was reset. Re-send it for signature.');
  } else {
    peToast(autoMin ? 'Saved ✓ — pricing switched to Minimum spend' : 'Saved ✓');
  }
  renderMain();
}
// Menu/set-menu edits on a SIGNED event also void the agreement — same deliberate
// re-sign, behind a confirm that names the consequence. Returns true to proceed.
async function peConfirmSignedEdit(id, label){
  var e = peEvById(id); if(!e || !e.signed_at) return true;
  if(!(await peConfirm({title:'This event is already signed',
      html:'Changing '+peEsc(label)+' voids the signed agreement — the client will need to sign again.<br><br>The booking <b>stays confirmed and the deposit is kept</b>; you’ll just need to re-send it for signature. Proceed?',
      ok:'Proceed', cancel:'Keep it signed', danger:true}))) return false;
  // Void the signature only — keep the status and deposit (see peSaveField).
  var patch = { signed_at:null, signed_name:null, signed_designation:null, contract_snapshot:null, updated_at:new Date().toISOString(), updated_by:peActor() };
  var r = await sb.from('events_desk').update(patch).eq('id', id);
  if(r.error){ peToast('NOT saved — '+(r.error.message||'check connection'), true); return false; }
  Object.keys(patch).forEach(function(k){ e[k] = patch[k]; });
  peState.voided = peState.voided || {}; peState.voided[id] = true;
  sb.from('event_log').insert({event_id:id, action:'unsigned', detail:'signed agreement voided by editing '+label, actor:peActor()}).then(function(){ peLoadLog(id); });
  return true;
}
function peEventOfItem(itemId){
  var found = null;
  Object.keys(peState.items).forEach(function(k){
    (peState.items[k]||[]).forEach(function(i){ if(i.id===itemId) found = k; });
  });
  return found;
}
// #3 — other live events that genuinely collide: same date, overlapping times,
// AND the same space (or a full-venue booking, which takes everything).
// Valentina, 17 Jul 2026, flagged two failures of the old rule (date + exact area,
// time never checked):
//   #6 — lunch and dinner in one room, two clients, warned as a clash that isn't;
//   #7 — a full-venue buyout over a Piemonte booking, no warning at all.
// Francesco's rule (17 Jul 2026): ONLY a full-venue booking blocks everything;
// every other area is independent, so a real clash needs the SAME area and an
// overlapping time. A missing time is treated as a possible clash (better a false
// nudge than a silent double-booking); a finish past midnight is handled.
function peWindowOf(from, to){
  var a = peParseTimeMin(from); if(a==null) return null;   // no start → unknown
  var b = peParseTimeMin(to);
  if(b==null) b = a + 240;            // no end entered → assume a 4-hour block
  if(b <= a) b += 1440;               // finishes after midnight (e.g. 8pm–1am)
  return [a, b];
}
function peTimeWindow(e){ return peWindowOf(e.time_from, e.time_to); }
function peWindowsOverlap(A, B){
  if(!A || !B) return true;           // can't tell → warn to be safe
  return A[0] < B[1] && B[0] < A[1];
}
function peTimesOverlap(e, x){ return peWindowsOverlap(peTimeWindow(e), peTimeWindow(x)); }
// Every (date · room · time) this booking would take up. A one-room, one-date
// booking returns exactly one entry, so the rule below is the same rule it
// always was — it just now has more than one thing to apply it to:
//   #5  a second space means a second room on the same evening;
//   #13 an alternative date means the same evening held on another day.
// Both are why the old check could miss a real double-booking: it only ever
// looked at e.area on e.event_date.
function peOccupancy(e){
  if(!e) return [];
  var legs = peSpaceList(e), out = [];
  peCandidateDates(e).forEach(function(d){
    if(!legs.length){ out.push({date:d.date, alt:!d.primary, area:'', from:d.from, to:d.to}); return; }
    legs.forEach(function(s){
      // On an alternative date the FIRST leg follows that date's own times when
      // it has them; the later legs keep the times they were given.
      var from = (s.primary && !d.primary && d.from) ? d.from : s.from;
      var to   = (s.primary && !d.primary && d.to)   ? d.to   : s.to;
      out.push({date:d.date, alt:!d.primary, area:s.area, from:from, to:to, note:s.note});
    });
  });
  return out;
}
// The real collisions, one per other-booking-and-date, with enough detail to
// say WHICH date and WHICH room — because with alternatives in play, "they
// clash" is no longer a useful sentence on its own.
function peClashPairs(e){
  if(!e || !e.event_date) return [];
  var mine = peOccupancy(e), pairs = [], seen = {};
  peState.events.forEach(function(x){
    if(x.id===e.id || ['lost','done'].indexOf(x.status)>=0) return;
    var theirs = peOccupancy(x);
    mine.forEach(function(a){
      theirs.forEach(function(b){
        if(a.date !== b.date) return;
        // A full-venue booking (either side) takes the whole place for the day —
        // set-up and breakdown included — so it clashes with ANYTHING else booked
        // that date, whatever the times (Francesco: "only Full venue blocks
        // everything").
        var buyout = peIsBuyout(e) || peIsBuyout(x);
        if(!buyout){
          // Otherwise the two must be in the SAME named area AND overlap in time —
          // so lunch and dinner in one room, two clients, is NOT a clash (#6).
          if(!(a.area && b.area && a.area === b.area)) return;
          if(!peWindowsOverlap(peWindowOf(a.from, a.to), peWindowOf(b.from, b.to))) return;
        }
        // Two rooms overlapping on one night is still ONE thing to tell her about.
        var k = x.id + '|' + a.date;
        if(seen[k]) return;
        seen[k] = 1;
        pairs.push({ ev:x, date:a.date, area:buyout ? (a.area || b.area) : a.area,
                     mineAlt:a.alt, theirAlt:b.alt, buyout:buyout });
      });
    });
  });
  return pairs;
}
// The other live events that genuinely collide. Unchanged in meaning and in what
// it returns (event rows), so every existing caller keeps working.
function peConflicts(e){
  var seen = {}, out = [];
  peClashPairs(e).forEach(function(p){
    if(seen[p.ev.id]) return;
    seen[p.ev.id] = 1;
    out.push(p.ev);
  });
  return out;
}
// P0 — the first set-menu "choose" course whose per-option split doesn't add up
// to the guest count (so we can warn before a proposal/agreement goes out).
function peSetMenuSplitGap(e){
  if(!e.set_menu) return null;
  var m = peSetMenuByKey(e.set_menu.key); if(!m) return null;
  var g = Number(e.guests)||0; if(!g) return null;
  for(var i=0;i<m.courses.length;i++){
    var c = m.courses[i]; if(!c.choose) continue;
    var counts = (e.set_menu.choices&&e.set_menu.choices[c.name])||{};
    var sum = 0; c.options.forEach(function(o){ sum += Number(counts[o])||0; });
    if(sum!==g) return {course:c.name, sum:sum, guests:g};
  }
  return null;
}
// P0 — the facts an agreement is meaningless without. These are NOT judgment calls,
// so unlike peSendChecks below they are hard stops: no "send anyway". The guided
// wizard already blocks date + guests (peGuideNext), but a draft made outside it —
// peQuickSave writes no date at all — lands on the same event page with the same
// three send buttons, so the gate belongs here, at the choke point they all share.
// Order and wording follow peEditorNext so the guest-send names the same next step
// the editor has been pointing at all along.
// Returns null when clean to send, else the first missing fact + the field to open.
// `forSigning` is true only for the send that asks the client to sign. A menu-only
// send has looser rules on purpose — see the note on the price block below.
// `noPrice` is the deliberate menu-only send — she has chosen not to quote yet, so
// the price block below does not apply. Everything else still does.
function peSendBlocks(e, forSigning, noPrice){
  var t = peCalcTotals(e);
  if(!e.event_date) return {fid:'event_date', msg:'Add the event date before sending — the guest signs against it.'};
  if(!e.guests) return {fid:'guests', msg:'Add the guest count before sending — the price and the kitchen both work off it.'};
  // Nothing to read. A proposal with no food and no beverage on it is an empty
  // document, and it used to leave on a "Send anyway". A beverage-only booking is
  // a real event, so either one satisfies this.
  var items = peState.items[e.id]||[];
  var hasFood = items.length>0 || !!e.set_menu || (e.food_price_pp!=null && e.food_price_pp!=='');
  if(!hasFood && !e.bev_package_id && e.bev_mode!=='dry')
    return {card:'food', msg:'Add the menu or a beverage package before sending — there is nothing on this proposal for the guest to read.'};
  // Sharing the menu before the money is settled is a real thing the desk does, so
  // a no-price send is allowed to skip this. A send that carries prices is not:
  // an unpriced booking would go out reading AED 0.
  // The escape route is only named on a send that COULD have gone without prices.
  // Offering it on the agreement would be pointing at a document nobody can sign.
  if(!noPrice && (t.total==null || !t.total) && !e.min_spend) return {fid:'min_spend', msg: forSigning
    ? 'Set a price or a minimum spend before sending the agreement — it carries a signature, and with no price it would read AED 0.'
    : 'Set a price or a minimum spend before sending — or use “Send the menu only, no prices” to share the menu now and price it later.'};
  // Signing needs an amount that actually resolves. On minimum-spend pricing the
  // dish total is NOT what is charged, so clearing the minimum leaves nothing to
  // sign against even though the dishes still add up — and the check above passes.
  // peAgBase is the one function that knows what the client is really charged.
  if(forSigning && peAgBase(e)==null) return {fid:'min_spend', msg:'This booking is priced on a minimum spend, but the amount is empty — set it before sending the agreement to sign.'};
  return null;
}
// P0 — gaps that should stop a client-facing send until the user confirms.
// Returns an array of plain-language gap sentences (empty = clean to send).
function peSendChecks(e, noPrice){
  var t = peCalcTotals(e);
  var msgs = [];
  var items = peState.items[e.id]||[];
  var hasFood = items.length>0 || !!e.set_menu || (e.food_price_pp!=null && e.food_price_pp!=='');
  var hasBev = !!e.bev_package_id;
  if(!hasFood && !hasBev) msgs.push('This proposal has no food, menu, or beverage on it.');
  var gap = peSetMenuSplitGap(e);
  if(gap) msgs.push('The '+gap.course+' choices add up to '+gap.sum+' of '+gap.guests+' guests.');
  // Allergen safety — the dishes below have no allergen info recorded, so a guest
  // (or the kitchen) can't see what's in them. Named before any client-facing send.
  if(t.missingAllergens && t.missingAllergens.length) msgs.push(t.missingAllergens.length+(t.missingAllergens.length>1?' dishes have':' dish has')+' no allergens recorded: '+t.missingAllergens.join(', ')+'.');
  // A dish with no price is on the quote at zero — the client would be reading a
  // number that does not cover what the kitchen is making. Named before any send.
  // Not worth saying on a menu-only send: no dish carries a price on that document,
  // by design, so "it is on the quote at AED 0" would be describing a quote she is
  // deliberately not sending.
  if(!noPrice && t.noPrice && t.noPrice.length) msgs.push(t.noPrice.length+(t.noPrice.length>1?' dishes have':' dish has')+' no price, so '+(t.noPrice.length>1?'they are':'it is')+' on the quote at AED 0: '+t.noPrice.join(', ')+'.');
  // Double-booking — the same date + area already holds another live event. Named
  // here so a send confirm says it out loud, not only the banner she may have scrolled past.
  peClashPairs(e).forEach(function(c){
    msgs.push((c.buyout ? 'The full venue' : (c.area||'That space'))+' is already booked on '+peDLabel(c.date)+
      (c.mineAlt ? ' (the alternative date you are holding)' : '')+' for: '+(c.ev.client_name||c.ev.company||'an unnamed event')+'.');
  });
  return msgs;
}
// Confirm past any send gaps, naming each one. Returns true to proceed.
async function peConfirmSend(e, forSigning, noPrice){
  // Missing facts stop the send outright and open the field to fix — the same way
  // peSendPaymentLink refuses a missing link. Only judgment calls (allergens, a
  // split gap, a double-booking) get the overridable confirm below.
  var block = peSendBlocks(e, forSigning, noPrice);
  // Some gaps are a whole card, not one field — "no menu at all" lives on the food
  // card, which has no single input to focus.
  if(block){
    if(block.card){ peToast(block.msg, true); peScrollToCard(block.card); }
    else peScrollToField(block.fid, block.msg);
    return false;
  }
  var gaps = peSendChecks(e, noPrice);
  if(!gaps.length) return true;
  return await peConfirm({
    title:'Before you send',
    html:'<ul style="margin:0 0 8px 16px;padding:0">'+gaps.map(function(g){ return '<li style="margin-bottom:5px">'+peEsc(g)+'</li>'; }).join('')+'</ul>Send anyway?',
    ok:'Send anyway', cancel:'Go back and fix', danger:true
  });
}
async function peSaveField(id, field, value, opts){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  opts = opts || {};
  var e = peEvById(id); if(!e) return;
  var patch = {}; patch[field] = value; patch.updated_at = new Date().toISOString();
  var r = await sb.from('events_desk').update(patch).eq('id', id);
  if(r.error){
    // Graceful degradation for a not-yet-added Batch-7 column (e.g. payment_link).
    if(peColMissing(r.error, field)){
      e[field] = value;
      peToast('Kept for now — this needs the latest database update to save permanently.', true);
      renderMain(); return;
    }
    peToast('NOT saved — check connection', true); return;
  }
  e[field] = value;
  if(!opts.silent) peToast('Saved ✓');
  renderMain();
}
// How the price reads on the guest's proposal: 'total' (whole event, the default)
// or 'pp' (per person). Only the presentation changes — the underlying total is
// identical. peSaveField degrades gracefully if the column isn't in the DB yet.
function peSetPriceDisplay(id, mode){
  peSaveField(id, 'price_display', mode==='pp' ? 'pp' : 'total');
}

// ── #5 — the run of the evening: add / edit / remove a space ───────────────
// A second space adds a room and a time. It never adds a price: Valentina's
// entire answer on this was "only 1 price", so there is deliberately nowhere
// here to type one.
var PE_MAX_EXTRA_SPACES = 3;
async function peAddSpace(id){
  var e = peEvById(id); if(!e) return;
  var list = peExtraSpacesRaw(e).slice();
  if(list.length >= PE_MAX_EXTRA_SPACES){ peToast('That is already a very long evening — '+(PE_MAX_EXTRA_SPACES+1)+' spaces is the most.', true); return; }
  // Start the new leg where the evening currently ends, so the ordinary case
  // (canapés finish, dinner starts) needs no typing at all.
  var legs = peSpaceList(e), last = legs[legs.length-1];
  list.push({ area:'', from:(last && last.to) || '', to:'', note:'' });
  await peSaveField(id, 'spaces', list, {silent:true});
}
async function peSetSpace(el, id, i, field){
  var e = peEvById(id); if(!e) return;
  var list = peExtraSpacesRaw(e).slice();
  if(!list[i]) return;
  list[i] = Object.assign({}, list[i]);
  list[i][field] = el.value;
  await peSaveField(id, 'spaces', list);
}
async function peRemoveSpace(id, i){
  var e = peEvById(id); if(!e) return;
  var list = peExtraSpacesRaw(e).slice();
  if(!list[i]) return;
  list.splice(i, 1);
  await peSaveField(id, 'spaces', list);
}

// ── #13 — a second possible date ──────────────────────────────────────────
async function peAddAltDate(id){
  var e = peEvById(id); if(!e) return;
  if(!e.event_date){ peScrollToField('event_date', 'Put the first date in, then add the alternative.'); return; }
  var list = peAltDatesRaw(e).slice();
  if(list.length >= 3){ peToast('Three alternatives is plenty to hold at once.', true); return; }
  list.push({ date:'', from:'', to:'' });
  await peSaveField(id, 'alt_dates', list, {silent:true});
}
async function peSetAltDate(el, id, i, field){
  var e = peEvById(id); if(!e) return;
  var list = peAltDatesRaw(e).slice();
  if(!list[i]) return;
  list[i] = Object.assign({}, list[i]);
  list[i][field] = (field==='date' && el.value) ? String(el.value).slice(0,10) : el.value;
  await peSaveField(id, 'alt_dates', list);
}
async function peRemoveAltDate(id, i){
  var e = peEvById(id); if(!e) return;
  var list = peAltDatesRaw(e).slice();
  if(!list[i]) return;
  list.splice(i, 1);
  await peSaveField(id, 'alt_dates', list);
}
// The guest chose one of the dates we were holding. That date becomes THE date
// and the alternatives are released — which is the whole point: nothing is left
// behind on the calendar for somebody to trip over later.
async function pePickDate(id, i){
  var e = peEvById(id); if(!e) return;
  var alts = peAltDates(e), pick = alts[i];
  if(!pick) return;
  if(!(await peConfirm({
    title:'Go with '+peDLabel(pick.date)+'?',
    body:'This becomes the date for this booking, and the other date'+(alts.length>1?'s are':' is')+' released — so nothing is left holding a day we are not using.',
    ok:'Yes, use this date', cancel:'Keep holding both'
  }))) return;
  var patch = { event_date:pick.date, alt_dates:[] };
  if(pick.from) patch.time_from = pick.from;
  if(pick.to)   patch.time_to   = pick.to;
  var r = await sb.from('events_desk').update(Object.assign({updated_at:new Date().toISOString()}, patch)).eq('id', id);
  if(r.error && !peColMissing(r.error, 'alt_dates')){ peToast('NOT saved — check connection', true); return; }
  Object.keys(patch).forEach(function(k){ e[k] = patch[k]; });
  await sb.from('event_log').insert({event_id:id, action:'date chosen', actor:peActor(), detail:'Guest chose '+pick.date+' — other held dates released'});
  peToast('Date set to '+peDLabel(pick.date)+' ✓');
  renderMain();
}

// ── #12 — three options on one enquiry ────────────────────────────────────
async function peAddOption(id){
  var e = peEvById(id); if(!e) return;
  var list = peOptions(e).slice();
  if(list.length >= PE_OPTION_KEYS.length){ peToast('Four options is more than anyone wants to choose between.', true); return; }
  // A new option starts as a copy of what the booking says today, so option A is
  // "what we have already quoted" rather than an empty form to retype.
  list.push({ key:PE_OPTION_KEYS[list.length], name:'', area:e.area||'',
              guests:(e.guests!=null?e.guests:''), price_pp:(e.food_price_pp!=null?e.food_price_pp:''),
              min_spend:'', note:'' });
  await peSaveField(id, 'options', list, {silent:true});
}
async function peSetOption(el, id, i, field){
  var e = peEvById(id); if(!e) return;
  var list = peOptions(e).slice();
  if(!list[i]) return;
  list[i] = Object.assign({}, list[i]);
  list[i][field] = el.value;
  await peSaveField(id, 'options', list);
}
async function peRemoveOption(id, i){
  var e = peEvById(id); if(!e) return;
  var list = peOptions(e).slice();
  if(!list[i]) return;
  var wasChosen = (e.option_chosen && list[i].key === e.option_chosen);
  list.splice(i, 1);
  // Re-letter so the guest never reads "Option A, Option C".
  list = list.map(function(o, n){ return Object.assign({}, o, {key:PE_OPTION_KEYS[n]}); });
  await peSaveField(id, 'options', list, {silent:true});
  if(wasChosen) await peSaveField(id, 'option_chosen', null);
}
// The guest picked one. It is WRITTEN onto the booking — area, guests, price —
// so from here on this is an ordinary enquiry with an ordinary price, and every
// screen, total and document already knows how to handle it. The options stay
// on the record so we can still see what was offered.
async function peApplyOption(id, key){
  var e = peEvById(id); if(!e) return;
  var o = peOptions(e).filter(function(x){ return x.key === key; })[0];
  if(!o) return;
  var tot = peOptionTotal(e, o);
  if(!(await peConfirm({
    title:'Go with option '+key+'?',
    body:'This puts option '+key+(o.name?' — '+o.name:'')+' onto the booking'+
         (tot!=null ? ' at AED '+peMoney(tot) : '')+
         '. The other options stay on the record so you can see what was offered, but the booking is now this one.',
    ok:'Yes, use option '+key, cancel:'Not yet'
  }))) return;
  var patch = { option_chosen:key, updated_at:new Date().toISOString() };
  if(o.area) patch.area = o.area;
  if(o.guests !== '' && o.guests != null) patch.guests = parseInt(o.guests, 10);
  if(o.min_spend !== '' && o.min_spend != null && Number(o.min_spend)){
    patch.min_spend = Number(o.min_spend); patch.pricing_type = 'min_spend';
  } else if(o.price_pp !== '' && o.price_pp != null){
    patch.food_price_pp = Number(o.price_pp);
  }
  var r = await sb.from('events_desk').update(patch).eq('id', id);
  if(r.error && !peColMissing(r.error, 'option_chosen')){ peToast('NOT saved — check connection', true); return; }
  Object.keys(patch).forEach(function(k){ if(k!=='updated_at') e[k] = patch[k]; });
  await sb.from('event_log').insert({event_id:id, action:'option chosen', actor:peActor(), detail:'Guest chose option '+key+(o.name?' — '+o.name:'')});
  peToast('Option '+key+' is now the booking ✓');
  renderMain();
}
// One beverage choice sets BOTH bev_package_id and bev_mode — no separate toggle,
// no way to contradict: '' = no package · 'dry' = no alcohol (soft drinks & water,
// AED 0) · a package id = that package (alcohol-free ones still charge normally).
async function peSetBeverage(id, val){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e) return;
  var patch = { updated_at:new Date().toISOString() };
  if(val==='dry'){ patch.bev_package_id = null; patch.bev_mode = 'dry'; }
  else if(!val){ patch.bev_package_id = null; patch.bev_mode = null; }
  else { patch.bev_package_id = val; patch.bev_mode = null; }
  var r = await sb.from('events_desk').update(patch).eq('id', id);
  if(r.error){ peToast('NOT saved — check connection', true); return; }
  Object.keys(patch).forEach(function(k){ e[k] = patch[k]; });
  peToast('Saved ✓');
  renderMain();
}
async function peDeleteEvent(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e || e.status!=='draft') return;
  if(!(await peConfirm({title:'Delete this draft?', body:'Delete this draft event? This cannot be undone.', ok:'Delete', cancel:'Keep it', danger:true}))) return;
  // Belt-and-suspenders: remove the draft's child rows (dishes + history) first, so
  // nothing is left orphaned even if the database foreign keys aren't set to cascade.
  // If a child delete fails we stop before touching the event — retrying is safe
  // (deleting already-gone rows is a no-op). See foh-events-cascade.sql for the DB fix.
  var ri = await sb.from('event_items').delete().eq('event_id', id);
  if(ri.error){ peToast('Delete didn’t finish — the dishes couldn’t be removed. Try again.', true); return; }
  var rl = await sb.from('event_log').delete().eq('event_id', id);
  if(rl.error){ peToast('Delete didn’t finish — the history couldn’t be removed. Try again.', true); return; }
  var r = await sb.from('events_desk').delete().eq('id', id);
  if(r.error){ peToast('Delete failed — check connection', true); return; }
  peState.events = peState.events.filter(function(x){ return x.id!==id; });
  delete peState.items[id];
  peToast('Draft deleted');
  peGo('list');
}
async function peSetStatus(id, status){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e || e.status===status) return;
  if(status==='lost'){ peAskLostReason(id); return; }
  // #11 — Confirmed / Deposit paid are real commitments the kitchen and hostess
  // act on. Name the consequence before flipping.
  if(status==='confirmed' && !(await peConfirm({title:'Mark as Confirmed?', html:'The kitchen and hostess team treat this as <b>ON</b> — they will prep and staff for it.', ok:'Mark Confirmed', cancel:'Not yet'}))) return;
  if(status==='deposit' && !(await peConfirm({title:'Mark Deposit paid?', body:'This records the client’s deposit as received and keeps the event confirmed.', ok:'Mark Deposit paid', cancel:'Not yet'}))) return;
  var was = e.status;
  var r = await sb.from('events_desk').update({status:status, updated_by:peActor(), updated_at:new Date().toISOString()}).eq('id', id);
  if(r.error){ peToast('Status NOT changed — check connection', true); return; }
  e.status = status;
  sb.from('event_log').insert({event_id:id, action:'status', detail:was+' → '+status, actor:peActor()}).then(function(){ peLoadLog(id); });
  renderMain();
  if(status==='confirmed'){
    peToast('Confirmed ✓ — now send the event brief so the kitchen and hostess have it.');
  } else {
    peToast('Saved ✓');
  }
}
var PE_LOST_REASONS = ['Price too high','Date not available','Chose another venue','No response','Guest cancelled'];
// Valentina, 17 Jul 2026: when a client cancels after paying, there was nowhere to
// record what happened to the deposit — it ended in a free-text note, so nothing
// could total up what we kept vs refunded. When (and only when) the booking is in a
// paid state, the lost modal now asks — Kept / Refunded / Moved to another date.
var PE_DEPOSIT_OUTCOMES = ['Deposit kept','Deposit refunded','Deposit moved to another date'];
function peHadDeposit(e){ return !!e && ['deposit','done'].indexOf(e.status)>=0; }
function peChipGroupHTML(list){
  return list.map(function(r){
    return '<span class="pe-chip" onclick="var p=this.parentNode;p.querySelectorAll(\'.pe-chip\').forEach(function(c){c.classList.remove(\'on\')});this.classList.add(\'on\')">'+r+'</span>';
  }).join('');
}
function peAskLostReason(id){
  var e = peEvById(id);
  var askDeposit = peHadDeposit(e);
  var bg = document.createElement('div'); bg.className='pe-modal-bg';
  bg.addEventListener('click', function(ev){ if(ev.target===bg) bg.remove(); });
  bg.innerHTML = '<div class="pe-modal" style="max-width:440px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><b style="color:#400207">Mark as lost — what happened?</b><span class="pe-x" onclick="this.closest(\'.pe-modal-bg\').remove()">✕</span></div>'+
    '<div style="font-size:11.5px;color:#4F4535;margin-bottom:8px">This moves the event out of your open pipeline. You can reopen it later from the “Lost” filter.</div>'+
    '<div id="pe-lost-reasons" style="margin-bottom:8px">'+peChipGroupHTML(PE_LOST_REASONS)+'</div>'+
    (askDeposit
      ? '<div class="pe-lbl" style="color:#8A2A1A">A deposit was paid — what happened to it?</div>'+
        '<div id="pe-lost-deposit" style="margin-bottom:8px">'+peChipGroupHTML(PE_DEPOSIT_OUTCOMES)+'</div>'
      : '')+
    '<div class="pe-lbl">More detail (optional when a reason above is picked)</div>'+
    '<textarea class="pe-in" id="pe-lost-note" rows="2" placeholder="e.g. their budget was AED 150 per guest"></textarea>'+
    '<div style="display:flex;gap:8px;margin-top:10px"><button class="pe-btn" onclick="peConfirmLost(\''+id+'\')">Mark as lost</button>'+
    '<button class="pe-btn sec" onclick="this.closest(\'.pe-modal-bg\').remove()">Cancel</button></div></div>';
  document.body.appendChild(bg);
}
async function peConfirmLost(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var bg = document.querySelector('.pe-modal-bg'); if(!bg) return;
  var chip = (bg.querySelector('#pe-lost-reasons .pe-chip.on'));
  var depBox = bg.querySelector('#pe-lost-deposit');
  var depChip = depBox ? depBox.querySelector('.pe-chip.on') : null;
  var note = (bg.querySelector('#pe-lost-note')||{value:''}).value.trim();
  var reason = [chip?chip.textContent:'', note].filter(Boolean).join(' — ');
  if(!reason){ peToast('Pick a reason or write one — it helps us learn', true); return; }
  // If a deposit was paid, its outcome is required — the money story must be complete.
  if(depBox && !depChip){ peToast('A deposit was paid — say what happened to it', true); return; }
  if(depChip) reason += ' · ' + depChip.textContent;
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
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var el = document.getElementById('pe-fu-note'); if(!el || !el.value.trim()) return;
  var r = await sb.from('event_log').insert({event_id:id, action:'followup', detail:el.value.trim().slice(0,500), actor:peActor()});
  if(r.error){ peToast('Note NOT saved — check connection', true); return; }
  el.value=''; peToast('Saved ✓'); peLoadLog(id);
}
// ── correcting the follow-up log ─────────────────────────────────────────────
// Only the lines that are somebody's own words can be rewritten. "Status — sent →
// lost", "Email sent", "Client signed" are the record of what happened; those can
// be removed if they were made by mistake, but never edited into something else.
var PE_LOG_EDITABLE = { followup:1, lost:1 };
function peLogRow(eventId, logId){
  var found = null;
  (peState.log[eventId]||[]).forEach(function(l){ if(String(l.id)===String(logId)) found = l; });
  return found;
}
// A lost line is stored as "sent → lost — Guest cancelled — …". She only ever wrote
// the part after the arrow, so that is the only part she gets to edit.
function peLostPrefix(l){ var m = String(l.detail||'').match(/^.*?→ lost — /); return m ? m[0] : ''; }
function peLogEditablePart(l){
  var d = String(l.detail||'');
  return l.action==='lost' ? d.slice(peLostPrefix(l).length) : d;
}
function peStartLogEdit(logId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  peState.logEdit = logId;
  renderMain();
  var el = document.getElementById('pe-log-edit-'+logId);
  if(el){ el.focus(); try{ el.setSelectionRange(el.value.length, el.value.length); }catch(err){} }
}
function peCancelLogEdit(){ peState.logEdit = null; renderMain(); }
// The lost reason on the event card is read from the most recent 'lost' line, so it
// has to be re-derived whenever one is edited or removed — otherwise the card keeps
// showing the words she just corrected until the next full reload.
function peRefreshLostReason(eventId){
  if(!peState.lostReasons) return;
  var latest = null;
  (peState.log[eventId]||[]).forEach(function(l){
    if(l.action!=='lost') return;
    if(!latest || new Date(l.created_at) >= new Date(latest.created_at)) latest = l;
  });
  if(latest) peState.lostReasons[eventId] = peLogEditablePart(latest);
  else delete peState.lostReasons[eventId];
}
async function peSaveLogEdit(eventId, logId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var el = document.getElementById('pe-log-edit-'+logId); if(!el) return;
  var txt = el.value.trim();
  if(!txt){ peToast('Write something, or use Delete to remove the line', true); return; }
  var row = peLogRow(eventId, logId); if(!row) return;
  var detail = row.action==='lost'
    ? peLostPrefix(row) + txt.slice(0,300)
    : txt.slice(0,500);
  var r = await sb.from('event_log').update({detail:detail}).eq('id', row.id);
  if(r.error){ peToast('NOT saved — check connection', true); return; }
  row.detail = detail;
  peState.logEdit = null;
  if(row.action==='lost') peRefreshLostReason(eventId);
  peToast('Saved ✓');
  renderMain();
}
async function peDeleteLogLine(eventId, logId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var row = peLogRow(eventId, logId); if(!row) return;
  var own = row.action==='followup';
  if(!(await peConfirm({
    title: own ? 'Delete this note?' : 'Remove this line from the history?',
    html: own
      ? 'It disappears from the log for everyone. This can’t be undone.'
      : 'This line records something that happened — “<b>'+peEsc(peLogLine(row))+'</b>”.<br><br>Only remove it if it was recorded by mistake. It disappears for everyone and can’t be undone.',
    ok:'Delete it', cancel:'Keep it', danger:true }))) return;
  var r = await sb.from('event_log').delete().eq('id', row.id);
  if(r.error){ peToast('NOT deleted — check connection', true); return; }
  peState.log[eventId] = (peState.log[eventId]||[]).filter(function(l){ return String(l.id)!==String(logId); });
  if(peState.logEdit && String(peState.logEdit)===String(logId)) peState.logEdit = null;
  if(row.action==='lost') peRefreshLostReason(eventId);
  peToast('Deleted');
  renderMain();
}

// ── dishes on an event ───────────────────────────────────────────────────────
// #12 — applying a package replaces the current menu (like the beverage dropdown
// replaces the drink). Confirm before overwriting a menu the user has tuned.
async function peApplyPackage(eventId, packId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); renderMain(); return; }
  if(!packId){ renderMain(); return; }
  var pack = null; peState.packs.forEach(function(p){ if(p.id===packId) pack=p; });
  if(!pack) return;
  var e = peEvById(eventId);
  var cur = peState.items[eventId]||[];
  var custom = cur.some(function(i){ return i.qty_confirmed || Number(i.pcs_per_guest)!==1; }) || (e && e.food_price_pp!=null && e.food_price_pp!=='');
  if(cur.length && custom && !(await peConfirm({title:'Replace the current menu?', html:'Applying “'+peEsc(pack.name)+'” replaces your current menu and price with <b>AED '+peMoney(pack.price_pp)+'/guest</b> — continue?', ok:'Replace menu', cancel:'Keep current', danger:true}))){ renderMain(); return; }
  if(!(await peConfirmSignedEdit(eventId, 'the menu'))){ renderMain(); return; }
  if(cur.length){
    var dr = await sb.from('event_items').delete().in('id', cur.map(function(i){ return i.id; }));
    if(dr.error){ peToast('Could not replace the menu — check connection', true); return; }
    peState.items[eventId] = [];
  }
  var toAdd = (pack.dish_ids||[]).map(function(d){ return {event_id:eventId, dish_id:d, pcs_per_guest:1, qty_confirmed:false}; });
  if(toAdd.length){
    var r = await sb.from('event_items').insert(toAdd).select();
    if(r.error){ peToast('Package NOT applied — check connection', true); return; }
    peState.items[eventId] = (r.data||[]);
  }
  await peSaveField(eventId, 'package_label', pack.name, {silent:true});
  await peSaveField(eventId, 'food_price_pp', Number(pack.price_pp), {silent:true});
  peToast('“'+pack.name+'” applied ✓ — AED '+peMoney(pack.price_pp)+'/guest, adjust dishes freely');
}
// #12 — clear the whole menu (with a confirm), so a wrong package can be undone.
async function peClearMenu(eventId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var cur = peState.items[eventId]||[];
  if(!cur.length){ peToast('No dishes to clear'); return; }
  if(!(await peConfirm({title:'Clear the menu?', html:'Remove all <b>'+cur.length+'</b> dishes from this event’s menu?', ok:'Clear menu', cancel:'Keep dishes', danger:true}))) return;
  if(!(await peConfirmSignedEdit(eventId, 'the menu'))) return;
  var dr = await sb.from('event_items').delete().in('id', cur.map(function(i){ return i.id; }));
  if(dr.error){ peToast('Could not clear the menu — check connection', true); return; }
  peState.items[eventId] = [];
  await peSaveField(eventId, 'package_label', null, {silent:true});
  peToast('Menu cleared ✓');
}
function peOpenDishPicker(eventId){
  var e = peEvById(eventId);
  var g = Number(e&&e.guests)||0;
  var existing = (peState.items[eventId]||[]).map(function(i){ return i.dish_id; });
  var cats = {};
  peState.dishes.filter(function(d){ return d.active && existing.indexOf(d.id)<0; })
    .forEach(function(d){ (cats[d.category+' · '+d.serve]=cats[d.category+' · '+d.serve]||[]).push(d); });
  var h = '<div class="pe-modal-bg" onclick="if(event.target===this)this.remove()"><div class="pe-modal">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="color:#400207">Add dishes from the library</b><span class="pe-x" onclick="this.closest(\'.pe-modal-bg\').remove()">✕</span></div>';
  if(!Object.keys(cats).length){
    h += '<div style="font-size:12px;color:#4F4535">Every active dish is already on this event.</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', h);
    return;
  }
  // Same picking format as the Quick menu: search, priced rows, a clear quantity
  // and a live line total — so choosing a dish works one way across the module.
  h += '<input class="pe-in" id="pe-dp-search" placeholder="Search dishes by name…" oninput="peDishPickerFilter(this)" style="margin-bottom:6px">'+
    '<div style="font-size:11px;color:#4F4535;margin-bottom:8px">Set the pieces per guest, then Add. Prices are per piece.</div>'+
    '<div id="pe-dp-none-all" style="display:none;font-size:12px;color:#4F4535;padding:6px 0">No dish matches your search.</div>';
  Object.keys(cats).forEach(function(k){
    h += '<div class="pe-dp-sec"><div class="pe-lbl" style="margin-top:8px">'+peEsc(k)+'</div>'+cats[k].map(function(d){
      var srch = peEsc((d.name+' '+(d.description||'')+' '+(d.tier||'')).toLowerCase());
      var absPcs = g ? '× '+g+' guests = '+g+' pcs · ' : '';   // qty defaults to 1 pc/guest
      return '<div class="pe-dp-row" data-search="'+srch+'"><div class="pe-dishrow">'+
        '<span><b style="font-weight:600">'+peEsc(d.name)+'</b>'+
        ' <span style="color:#574232;font-size:10px">'+peEsc(peAllergenText(d.allergens))+'</span>'+
        (d.description?'<br><span style="color:#574232;font-size:10.5px">'+peEsc(d.description)+'</span>':'')+
        '<br><span style="font-size:11px;color:#4F4535">'+peEsc(d.tier||'')+(d.tier?' · ':'')+'AED '+peMoney(d.sell_price)+' each · min '+(d.min_order||10)+' pieces</span></span>'+
        '<span style="display:flex;align-items:center;gap:5px;flex-shrink:0">'+
          '<span style="display:flex;flex-direction:column;align-items:center;line-height:1.1">'+
            '<input class="pe-in pe-dp-qty" style="width:56px;padding:4px 6px;text-align:center" type="number" step="0.5" min="0" value="1" data-price="'+(Number(d.sell_price)||0)+'" oninput="peDishPickerQty(this,'+g+')">'+
            '<span style="font-size:9.5px;color:#4F4535;margin-top:2px">pieces / guest</span></span>'+
          '<button class="pe-btn sm" onclick="peAddItemQty(this,\''+eventId+'\',\''+d.id+'\')">Add</button>'+
        '</span></div>'+
        '<div class="pe-dp-help" style="font-size:10.5px;color:#574232;text-align:right;margin:-3px 0 5px">'+absPcs+'AED '+peMoney(Number(d.sell_price)||0)+'/guest</div>'+
      '</div>';
    }).join('')+'</div>';
  });
  h += '</div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}
// Live filter for the dish picker — hides rows (and empty category groups) as
// she types, without re-rendering, so any quantities she has set are preserved.
function peDishPickerFilter(input){
  var term = (input.value||'').trim().toLowerCase();
  var modal = input.closest('.pe-modal'); if(!modal) return;
  var any = false;
  modal.querySelectorAll('.pe-dp-sec').forEach(function(sec){
    var shown = 0;
    sec.querySelectorAll('.pe-dp-row').forEach(function(row){
      var hit = !term || (row.getAttribute('data-search')||'').indexOf(term) >= 0;
      row.style.display = hit ? '' : 'none';
      if(hit) shown++;
    });
    sec.style.display = shown ? '' : 'none';
    if(shown) any = true;
  });
  var none = modal.querySelector('#pe-dp-none-all');
  if(none) none.style.display = any ? 'none' : 'block';
}
// Live per-row total as she types a quantity in the picker (matches Quick menu).
function peDishPickerQty(input, g){
  var q = Math.max(0, Number(input.value)||0);
  var price = Number(input.getAttribute('data-price'))||0;
  var row = input.closest('.pe-dp-row'); if(!row) return;
  var help = row.querySelector('.pe-dp-help'); if(!help) return;
  help.innerHTML = (g ? '× '+g+' guests = '+(Math.round(q*g*10)/10)+' pcs · ' : '')+'AED '+peMoney(q*price)+'/guest';
}
async function peAddItemQty(btn, eventId, dishId){
  var row = btn.closest('.pe-dp-row');
  var inp = row && row.querySelector('.pe-dp-qty');
  var q = Math.max(0, Number(inp&&inp.value)||0);
  if(!(q>0)){ peToast('Enter pieces per guest above 0', true); return; }
  var ok = await peAddItem(eventId, dishId, q);
  if(ok){ btn.disabled = true; btn.textContent = 'Added ✓'; if(inp) inp.disabled = true; }
}
async function peAddItem(eventId, dishId, pcs){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return false; }
  if(!(await peConfirmSignedEdit(eventId, 'the menu'))) return false;
  var p = Number(pcs)>0 ? Number(pcs) : 1;
  var r = await sb.from('event_items').insert({event_id:eventId, dish_id:dishId, pcs_per_guest:p, qty_confirmed:Number(pcs)>0}).select().single();
  if(r.error || !r.data){ peToast('NOT added — check connection', true); return false; }
  (peState.items[eventId]=peState.items[eventId]||[]).push(r.data);
  renderMain();
  return true;
}
async function peRemoveItem(itemId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var evId = peEventOfItem(itemId);
  // Deleting the row cannot be undone, so name the dish before doing it.
  var it = null;
  Object.keys(peState.items).forEach(function(k){
    (peState.items[k]||[]).forEach(function(i){ if(i.id===itemId) it = i; });
  });
  var dish = it ? peDishById(it.dish_id) : null;
  var nm = (dish && dish.name) || 'this dish';
  if(!(await peConfirm({title:'Take it off the menu?', html:'Remove <b>'+peEsc(nm)+'</b> from this menu? You would have to add it again — this cannot be undone.', ok:'Remove '+peEsc(nm), cancel:'Keep it'}))) return;
  if(evId && !(await peConfirmSignedEdit(evId, 'the menu'))){ renderMain(); return; }
  var r = await sb.from('event_items').delete().eq('id', itemId);
  if(r.error){ peToast('NOT removed — check connection', true); return; }
  Object.keys(peState.items).forEach(function(k){
    peState.items[k] = peState.items[k].filter(function(i){ return i.id!==itemId; });
  });
  peToast('Removed ✓');
  renderMain();
}
async function peSetPcs(itemId, val){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); renderMain(); return; }
  var v = Number(val); if(!(v>0)){ peToast('Enter a quantity above 0', true); renderMain(); return; }
  var evId = peEventOfItem(itemId);
  if(evId && !(await peConfirmSignedEdit(evId, 'the menu quantities'))){ renderMain(); return; }
  var r = await sb.from('event_items').update({pcs_per_guest:v, qty_confirmed:true}).eq('id', itemId);
  if(r.error){ peToast('NOT saved — check connection', true); return; }
  Object.keys(peState.items).forEach(function(k){
    peState.items[k].forEach(function(i){ if(i.id===itemId){ i.pcs_per_guest = v; i.qty_confirmed = true; } });
  });
  peToast('Saved ✓');
  renderMain();
}
// "On the house": mark a dish free — excluded from the charged food total, but the
// kitchen still prepares it (cost + pieces still count). A menu/price change, so it
// voids a signed agreement like any other. Degrades gracefully if the column is absent.
function peSetItemComp(itemId, on){
  Object.keys(peState.items).forEach(function(k){
    peState.items[k].forEach(function(i){ if(i.id===itemId) i.comp = !!on; });
  });
}
async function peToggleComp(itemId, on){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); renderMain(); return; }
  var evId = peEventOfItem(itemId);
  if(evId && !(await peConfirmSignedEdit(evId, 'the menu'))){ renderMain(); return; }
  var r = await sb.from('event_items').update({comp:!!on}).eq('id', itemId);
  if(r.error){
    if(peColMissing(r.error, 'comp')){
      peSetItemComp(itemId, on);
      peToast('Marked for now — “on the house” needs the Batch 7 database update to save.', true);
      renderMain(); return;
    }
    peToast('NOT saved — check connection', true); renderMain(); return;
  }
  peSetItemComp(itemId, on);
  peToast(on ? 'On the house ✓ — not charged, the kitchen still prepares it' : 'Back to charged ✓');
  renderMain();
}
async function peApplyClientSelection(eventId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(eventId); if(!e || !e.client_selection) return;
  if(!(await peConfirmSignedEdit(eventId, 'the menu'))) return;
  var want = e.client_selection.dish_ids||[];
  var qmap = e.client_selection.quantities||{};
  var g = Number(e.guests)||0;
  var existing = (peState.items[eventId]||[]).map(function(i){ return i.dish_id; });
  var toAdd = want.filter(function(d){ return existing.indexOf(d)<0; })
    .map(function(d){
      var q = Number(qmap[d])||0;
      var known = !!(q&&g);
      return {event_id:eventId, dish_id:d, pcs_per_guest:known?Math.round(q/g*100)/100:1, qty_confirmed:known};
    });
  if(toAdd.length){
    var r = await sb.from('event_items').insert(toAdd).select();
    if(r.error){ peToast('Could not apply — check connection', true); return; }
    peState.items[eventId] = (peState.items[eventId]||[]).concat(r.data||[]);
  }
  peToast('Client selection applied — review quantities');
  renderMain();
}

// ── set menus (plated Terra/Mare/Fuoco with a per-choice headcount) ──────────
function peSmEsc(s){ return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function peFoodSetMenuHTML(e){
  var sm = e.set_menu;
  var ce = peCanEdit();
  var h = '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed rgba(107,31,42,0.15)">';
  if(!sm){
    if(!ce) return '';
    h += '<div class="pe-lbl">Or use a plated set menu…</div>'+
      '<span style="display:flex;gap:6px;align-items:center"><select class="pe-in" style="flex:1" id="pe-sm-sel"><option value="">Choose a plated set menu…</option>'+
      peSetMenusPickInc().map(function(m){ return '<option value="'+m.key+'">'+peEsc(m.name)+(m.price!=null?' — AED '+m.price+'/guest':' — price on the proposal')+'</option>'; }).join('')+
      '</select><button class="pe-btn sec sm" onclick="peApplySetMenu(\''+e.id+'\')">Use</button></span>';
    return h+'</div>';
  }
  var m = peSetMenuByKey(sm.key);
  // The header shows what this event actually charges — the agreed price when
  // Valentina negotiated one, with the list price named next to it.
  var evPP = (e.food_price_pp!=null && e.food_price_pp!=='') ? Number(e.food_price_pp) : null;
  var custPP = (m && evPP!=null && Math.round(evPP)!==Math.round(Number(m.price)));
  h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
    '<b style="color:#400207">'+(m?peEsc(m.name):'Set menu')+(m?' · AED '+peMoney(evPP!=null?evPP:m.price)+'/guest'+(custPP?' <span style="font-weight:normal;font-size:11px;color:#7A5500">(agreed — list AED '+m.price+')</span>':''):'')+'</b>'+
    // The guest is happy with this menu but wants dishes from the à la carte:
    // this is the door to the builder, pre-loaded with THIS menu and THIS
    // booking, so she never re-picks either.
    (ce && !m.custom ? '<button class="pe-btn sec sm" onclick="peCmStart(\''+peSmEsc(sm.key)+'\',\''+e.id+'\')">Customise this menu</button>' : '')+
    (ce?'<button class="pe-btn sec sm" style="color:#B00020;border-color:#B00020" onclick="peClearSetMenu(\''+e.id+'\')">Remove set menu</button>':'')+'</div>';
  // Serving style — when this menu has an individual + sharing version, pick
  // here; the price and the guest/kitchen documents follow the picked version.
  var fam = m ? peSmFamily(m.key) : null;
  if(fam){
    var isSh = m.key===fam.sharing.key;
    var pill = function(v, on, lbl){
      return '<button class="pe-btn sm'+(on?'':' sec')+'" style="flex:1;min-width:150px"'+
        (on||!ce ? ' disabled' : ' onclick="peSetMenuServe(\''+e.id+'\',\''+peSmEsc(v.key)+'\')"')+'>'+
        lbl+' — AED '+v.price+'/guest'+(on?' ✓':'')+'</button>';
    };
    h += '<div style="margin-top:8px"><div class="pe-lbl">How is it served?</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
      pill(fam.individual, !isSh, 'Individual choices')+
      pill(fam.sharing, isSh, 'Everything to share')+'</div>'+
      '<div style="font-size:11px;color:#4F4535;margin-top:4px">'+peEsc(m.line||peSmSummary(m.courses))+'</div></div>';
  }
  if(m){
    // Agreed price — same audited, contract-guarded field as the facts card
    // (food_price_pp), surfaced here so a negotiated menu price is one edit.
    h += '<div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
      '<span class="pe-lbl" style="margin:0">Agreed price per guest</span>'+
      '<input class="pe-in" style="width:90px;padding:4px 6px" type="number" min="0" value="'+(evPP!=null?peEsc(e.food_price_pp):'')+'" placeholder="'+m.price+'" onchange="peFact(this,\'food_price_pp\',\''+e.id+'\')"'+(ce?'':' disabled')+'>'+
      '<span style="font-size:11px;color:#4F4535">list price AED '+m.price+' — change only what was agreed with the guest</span></div>';
    var g = Number(e.guests)||0;
    m.courses.forEach(function(c){
      if(!c.choose) return;
      var counts = (sm.choices&&sm.choices[c.name])||{};
      var sum = 0; c.options.forEach(function(o){ sum += Number(counts[o])||0; });
      h += '<div style="margin-top:8px"><div class="pe-lbl">'+peEsc(c.name)+' — how many guests chose each</div>'+
        c.options.map(function(o){
          return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0">'+
            '<span style="font-size:12.5px">'+o+'</span>'+
            '<input class="pe-in" style="width:70px;padding:4px 6px" type="number" min="0" value="'+(counts[o]!=null?counts[o]:'')+'" onchange="peSetMenuCount(\''+e.id+'\',\''+peSmEsc(c.name)+'\',\''+peSmEsc(o)+'\',this.value)"'+(ce?'':' disabled')+'></div>';
        }).join('')+
        '<div style="font-size:12px;margin-top:3px;color:'+((g&&sum===g)?'#2E6B34':'#B00020')+(g&&sum!==g?';font-weight:600':'')+'">'+((g&&sum!==g)?'▲ ':'')+sum+' of '+(g||'—')+' guests assigned'+
        ((g&&sum!==g)?' — '+(sum<g?(g-sum)+' still to assign':(sum-g)+' over'):(g?' ✓':''))+'</div></div>';
    });
    // Guest-requested changes to the menu (e.g. a vegan main) — one note that
    // reaches BOTH the guest proposal and the kitchen brief, so what was
    // promised and what gets cooked can never drift apart.
    h += '<div style="margin-top:8px"><div class="pe-lbl">Menu changes the guest asked for — shows on the proposal AND the kitchen brief</div>'+
      '<textarea class="pe-in" rows="2" style="width:100%;box-sizing:border-box" placeholder="e.g. 2 guests need a vegan main — chef to propose" onchange="peSetMenuNote(\''+e.id+'\',this.value)"'+(ce?'':' disabled')+'>'+peEsc(sm.note||'')+'</textarea></div>';
    // Let the guest enter their own numbers: send them a link, they fill each
    // course to the guest count, then ONE tap here applies it — nothing reaches
    // the kitchen or the documents without Valentina seeing it first.
    if(ce && e.client_token){
      h += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">'+
        '<button class="pe-btn sec sm" onclick="peCopyMenuChoicesLink(\''+e.id+'\')">Copy link — guest picks the numbers</button>'+
        '<button class="pe-btn sec sm" onclick="peWaMenuChoicesLink(\''+e.id+'\')">WhatsApp it'+(e.contact_phone?'':' (add phone first)')+'</button>'+
        '<button class="pe-btn sec sm" onclick="peFetchMenuChoices(\''+e.id+'\')">Check for the guest’s numbers</button></div>';
    }
  }
  return h+'</div>';
}
function peMenuChoicesUrl(e){
  var base = location.origin + location.pathname.replace(/[^\/]*$/, '');
  return base + 'client-setmenu.html?t=' + e.client_token + '&m=' + encodeURIComponent(e.set_menu.key) + (e.guests ? '&g=' + Number(e.guests) : '') +
    ((e.food_price_pp!=null && e.food_price_pp!=='') ? '&p=' + Number(e.food_price_pp) : '');
}
function peCopyMenuChoicesLink(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e || !e.set_menu) return;
  var url = peMenuChoicesUrl(e);
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function(){
    peToast('Link copied — the guest picks how many of each dish, then tap “Check for the guest’s numbers”');
  }).catch(function(){ prompt('Copy this link:', url); });
  sb.from('event_log').insert({event_id:id, action:'client_link', detail:'set-menu choices link copied', actor:peActor()});
}
// WhatsApp the pick-your-numbers link straight to the event's contact.
function peWaMenuChoicesLink(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e || !e.set_menu) return;
  if(!e.contact_phone){ peToast('Add the client’s phone on the event first — then this sends in one tap', true); return; }
  var digits = String(e.contact_phone).replace(/[^0-9]/g,'');
  if(digits.length && digits[0]==='0') digits = '971'+digits.slice(1);
  if(digits.length <= 9) digits = '971'+digits;
  var m = peSetMenuByKey(e.set_menu.key);
  var msg = 'Ciao'+(e.contact_name?' '+e.contact_name.split(' ')[0]:'')+'! Here is the menu for your event at Roberto’s'+
    (m?' — '+m.name:'')+'. Tap to see every dish and tell us your choices:\n'+peMenuChoicesUrl(e)+'\nGrazie — '+peSignOff();
  window.open('https://wa.me/'+digits+'?text='+encodeURIComponent(msg), '_blank');
  sb.from('event_log').insert({event_id:id, action:'whatsapp', detail:'WhatsApp opened — set-menu choices link → '+e.contact_phone, actor:peActor()});
}
// Share ANY menu as a read-only page (no event needed) — WhatsApp opens with
// the contact picker, so it works for any number.
function peWaShareMenu(key){
  var m = peSetMenuByKey(key); if(!m) return;
  var base = location.origin + location.pathname.replace(/[^\/]*$/, '');
  var url = base + 'client-setmenu.html?m=' + encodeURIComponent(key);
  var msg = 'Roberto’s — '+m.name+(m.price!=null?' · AED '+m.price+' per guest':'')+'. Tap to see the full menu:\n'+url;
  window.open('https://wa.me/?text='+encodeURIComponent(msg), '_blank');
}
// Pull the guest's submitted numbers and apply them to this event after a
// preview — the newest submission for this event's link wins.
async function peFetchMenuChoices(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e || !e.set_menu) return;
  var r = await sb.from('event_menu_choices').select('*').eq('token', e.client_token).order('created_at', {ascending:false}).limit(1);
  if(r.error){
    if(/event_menu_choices/.test(r.error.message||'')) peToast('This needs the database update first — run event-menu-choices.sql in Supabase', true);
    else peToast('Could not check — '+(r.error.message||'connection'), true);
    return;
  }
  if(!r.data || !r.data.length){ peToast('Nothing from the guest yet — they haven’t sent their numbers'); return; }
  var row = r.data[0];
  var m = peSetMenuByKey(e.set_menu.key);
  var warn = [];
  if(row.menu_key && row.menu_key!==e.set_menu.key) warn.push('they picked on a different version of the menu ('+peEsc(row.menu_key)+')');
  if(row.guests && Number(e.guests) && Number(row.guests)!==Number(e.guests)) warn.push('they entered '+row.guests+' guests, the event says '+e.guests);
  var lines = [];
  Object.keys(row.choices||{}).forEach(function(course){
    var cc = row.choices[course]||{};
    lines.push('<b>'+peEsc(course)+'</b>: '+Object.keys(cc).map(function(o){ return cc[o]+' × '+peEsc(o); }).join(', '));
  });
  var body = 'Received '+new Date(row.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+':<br>'+
    (lines.length ? lines.join('<br>') : 'No course numbers')+
    (row.note ? '<br><b>Their note:</b> '+peEsc(row.note) : '')+
    (warn.length ? '<br><span style="color:#B00020">▲ '+warn.join(' · ')+'</span>' : '')+
    '<br><br>Applying replaces the numbers on this event'+(row.note?' and adds their note to the menu changes':'')+'.';
  // `body` is escaped by peConfirm; this text is already built with peEsc around
  // every guest-supplied value and carries its own <b>/<br> markup, so it belongs
  // in `html`. Passing it as `body` printed the raw tags at her.
  if(!(await peConfirm({title:'Use the guest’s numbers?', html:body, ok:'Apply to the event', cancel:'Not now'}))) return;
  if(!(await peConfirmSignedEdit(id, 'the menu'))){ renderMain(); return; }
  var sm = JSON.parse(JSON.stringify(e.set_menu));
  sm.choices = row.choices||{};
  if(row.note) sm.note = sm.note ? (sm.note+' · Guest: '+row.note) : ('Guest: '+row.note);
  var u = await sb.from('events_desk').update({set_menu:sm, updated_at:new Date().toISOString()}).eq('id', id);
  if(u.error){ peToast('NOT applied — '+(u.error.message||'check connection'), true); return; }
  e.set_menu = sm;
  // Applying the newest submission settles ALL of this event's submissions —
  // older ones (re-sends, tests) must not keep the green banner alive.
  sb.from('event_menu_choices').update({applied:true}).eq('token', e.client_token);
  if(peState.menuChoicesPending) delete peState.menuChoicesPending[e.client_token];
  sb.from('event_log').insert({event_id:id, action:'client_selection', detail:'guest set-menu numbers applied', actor:peActor()});
  peToast('Guest’s numbers applied ✓ — check the green totals, then the kitchen brief is ready');
  renderMain();
}
// A set menu REPLACES the menu, like peApplyPackage: confirm, then clear any
// existing dishes — otherwise the guest proposal and kitchen brief print BOTH.
async function peApplySetMenu(eventId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var sel = document.getElementById('pe-sm-sel'); if(!sel || !sel.value) return;
  var m = peSetMenuByKey(sel.value); if(!m) return;
  // An unpriced menu is allowed: on a minimum-spend booking the food carries no
  // per-guest price — the menu supplies the dishes, the minimum spend the money.
  var e = peEvById(eventId); if(!e) return;
  var cur = peState.items[eventId]||[];
  var hadPrice = e.food_price_pp!=null && e.food_price_pp!=='';
  if(cur.length || hadPrice){
    var priceChange = m.price!=null
      ? ' the AED '+peMoney(e.food_price_pp)+'/guest food price becomes AED '+peMoney(m.price)+'/guest'
      : ' the AED '+peMoney(e.food_price_pp)+'/guest food price is removed — the minimum spend applies';
    var body = 'Using “'+m.name+'” replaces the food on this event'+
      (cur.length ? ' — the '+cur.length+' dish'+(cur.length>1?'es':'')+' on it now will be removed' : '')+
      (hadPrice ? (cur.length?' and':' —')+priceChange : '')+
      '. The proposal and the kitchen brief will show only the set menu.';
    if(!(await peConfirm({title:'Switch to “'+m.name+'”?', body:body, ok:'Use “'+m.name+'”', cancel:'Keep the current menu'}))){ renderMain(); return; }
  }
  if(!(await peConfirmSignedEdit(eventId, 'the menu'))){ renderMain(); return; }
  if(cur.length){
    var dr = await sb.from('event_items').delete().in('id', cur.map(function(i){ return i.id; }));
    if(dr.error){ peToast('Could not replace the menu — check connection', true); return; }
    peState.items[eventId] = [];
  }
  var patch = { set_menu:{key:m.key, choices:{}}, package_label:m.name, food_price_pp:m.price, updated_at:new Date().toISOString() };
  var r = await sb.from('events_desk').update(patch).eq('id', eventId);
  if(r.error){ peToast('NOT applied — '+(r.error.message||'check connection'), true); return; }
  Object.keys(patch).forEach(function(k){ e[k] = patch[k]; });
  peToast('Set menu applied — enter the guests’ choices for the kitchen');
  renderMain();
}
// Switch a set menu between its individual and sharing version. Keeps the
// per-course guest choices — Secondi/Dolci splits carry straight over, and a
// course that stops being choose-style is simply ignored by every renderer.
async function peSetMenuServe(eventId, key){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(eventId); if(!e || !e.set_menu || e.set_menu.key===key) return;
  var m = peSetMenuByKey(key); if(!m || m.price==null) return;
  if(!(await peConfirmSignedEdit(eventId, 'the menu'))){ renderMain(); return; }
  var sm = JSON.parse(JSON.stringify(e.set_menu)); sm.key = key;
  var patch = { set_menu:sm, package_label:m.name, food_price_pp:m.price, updated_at:new Date().toISOString() };
  var r = await sb.from('events_desk').update(patch).eq('id', eventId);
  if(r.error){ peToast('NOT changed — '+(r.error.message||'check connection'), true); return; }
  Object.keys(patch).forEach(function(k){ e[k] = patch[k]; });
  peToast('Now “'+m.name+'” — AED '+m.price+'/guest');
  renderMain();
}
// Removing the set menu drops its per-guest price — never silently: the modal
// names what the food price becomes (dishes total, or nothing) before it changes.
async function peClearSetMenu(eventId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(eventId); if(!e) return;
  var m = e.set_menu ? peSetMenuByKey(e.set_menu.key) : null;
  var t = peCalcTotals(e);
  var body = 'This takes “'+(m?m.name:'the set menu')+'”'+(m?' and its AED '+peMoney(m.price)+'/guest food price':'')+' off this event. '+
    (t.foodComputed
      ? 'The food price becomes the dishes on the event — AED '+peMoney(t.foodComputed)+'/guest.'
      : 'The event will have NO food or food price until you pick a package or build a menu.');
  if(!(await peConfirm({title:'Remove the set menu?', body:body, ok:'Remove set menu', cancel:'Keep it', danger:true}))){ renderMain(); return; }
  if(!(await peConfirmSignedEdit(eventId, 'the menu'))){ renderMain(); return; }
  var patch = { set_menu:null, package_label:null, food_price_pp:null, updated_at:new Date().toISOString() };
  var r = await sb.from('events_desk').update(patch).eq('id', eventId);
  if(r.error){ peToast('NOT changed — check connection', true); return; }
  Object.keys(patch).forEach(function(k){ e[k] = patch[k]; });
  peToast(t.foodComputed ? 'Set menu removed — food price is now the dishes total, AED '+peMoney(t.foodComputed)+'/guest' : 'Set menu removed — this event now has no food on it');
  renderMain();
}
async function peSetMenuCount(eventId, course, option, val){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); renderMain(); return; }
  var e = peEvById(eventId); if(!e || !e.set_menu) return;
  var sm = JSON.parse(JSON.stringify(e.set_menu));
  sm.choices = sm.choices || {};
  sm.choices[course] = sm.choices[course] || {};
  var n = parseInt(val,10);
  if(n>0) sm.choices[course][option] = n; else delete sm.choices[course][option];
  var r = await sb.from('events_desk').update({set_menu:sm, updated_at:new Date().toISOString()}).eq('id', eventId);
  if(r.error){ peToast('NOT saved — check connection', true); return; }
  e.set_menu = sm; peToast('Saved ✓'); renderMain();
}
// The guest's menu-change note (e.g. vegan main) — lives inside set_menu so it
// travels with the menu and is cleared with it.
async function peSetMenuNote(eventId, val){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); renderMain(); return; }
  var e = peEvById(eventId); if(!e || !e.set_menu) return;
  var sm = JSON.parse(JSON.stringify(e.set_menu));
  var v = String(val||'').trim();
  if(v) sm.note = v; else delete sm.note;
  var r = await sb.from('events_desk').update({set_menu:sm, updated_at:new Date().toISOString()}).eq('id', eventId);
  if(r.error){ peToast('NOT saved — check connection', true); return; }
  e.set_menu = sm; peToast(v ? 'Saved ✓ — the proposal and kitchen brief now carry this note' : 'Note removed'); renderMain();
}

// ── documents ────────────────────────────────────────────────────────────────
// The official wordmark — burgundy #410207 with the orange #fa4700 apostrophe.
// Emails get the PNG, not the SVG: Gmail and Outlook strip inline SVG. The src
// has to be absolute (peBaseUrl) so it still resolves once the mail has left us.
// 11.923 is the artwork's true aspect, so the height is never guessed.
// Outlook and Gmail often block remote images until the guest clicks "show
// images". The alt text is styled so that, blocked, it still falls back to a
// spaced burgundy wordmark rather than a broken-image icon.
function peLogoImg(w){
  var px = w || 300;
  return '<img src="'+peBaseUrl()+'robertos-logo-email.png" width="'+px+'" height="'+Math.round(px/11.923)+
         '" alt="R O B E R T O ’ S" style="display:block;margin:0 auto;border:0;'+
         'font-family:Georgia,serif;font-size:22px;letter-spacing:7px;color:#410207;text-align:center">';
}
function peDocShell(title, inner, extraCss){
  // Without this the brief, the proposal and the signed copy all render at 720px
  // zoomed out on a phone. showBrief() rewrites the whole document, so the viewport
  // meta on print-brief.html is thrown away — it has to live here.
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width, initial-scale=1">'+
  '<title>'+peEsc(title)+'</title>'+
  // ONE STANDARD. Every value below is copied from client-brand.css — the SOP
  // standard chosen 30 Jul 2026 — so a guest who opens the emailed proposal and
  // then the menu link sees one restaurant, not two. It has to be literals and
  // inline: email clients strip external stylesheets and CSS variables, which is
  // how this document drifted onto Georgia and sage-green headings in the first
  // place. If client-brand.css changes, change these with it.
  '<style>@import url(\'https://fonts.googleapis.com/css2?family=Forum&family=Outfit:wght@300;400;500;600&display=swap\');'+
  '@page{margin:18mm}body{font-family:\'Outfit\',Arial,sans-serif;color:#3A332C;margin:0;padding:24px;max-width:720px;margin:0 auto}'+
  /* bottom margin keeps the designer's clear space (~0.9x the logo height) */
  '.brand{text-align:center;margin:10px 0 24px}'+
  '.rule{width:70px;height:1px;background:#C9A84C;margin:10px auto}'+
  'h2{font-family:\'Forum\',Georgia,serif;font-size:17px;letter-spacing:2px;color:#450207;text-align:center;font-weight:normal;text-transform:uppercase}'+
  '.sub{text-align:center;font-size:12px;color:#574232}'+
  // Identical to .sect-t on the guest pages: 11px, 3px tracking, gold.
  '.sec{font-size:11px;letter-spacing:3px;color:#544418;text-transform:uppercase;text-align:center;margin:22px 0 10px}'+
  '.dish{font-family:\'Forum\',Georgia,serif;text-align:center;font-size:13.5px;margin:7px 0;color:#3A332C}'+
  '.dish .d{font-family:\'Outfit\',Arial,sans-serif;font-size:11.5px;color:#574232}'+
  '.codes{font-family:\'Outfit\',Arial,sans-serif;font-size:11.5px;color:#574232}'+
  '.ft{text-align:center;font-size:10.5px;color:#574232;margin-top:34px;line-height:1.7}'+
  'table{width:100%;border-collapse:collapse;font-size:12px}td{padding:6px 8px;border:1px solid #E3D5C2;vertical-align:top}'+
  'td.l{width:32%;color:#574232;font-size:10.5px;text-transform:uppercase;letter-spacing:1px}'+
  '.fs-h{background:#450207;color:#E8D9C7;text-align:center;padding:8px;font-size:13px;letter-spacing:2px}'+
  // Phone only — never print. The kitchen table is three columns wide, so on a
  // phone it has to be allowed to scroll on its own rather than push the page.
  '@media screen and (max-width:600px){body{padding:14px}'+
  'table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}}'+
  (extraCss||'')+'</style></head><body>'+inner+'</body></html>';
}
function pePrintHTML(html){
  var w = window.open('', '_blank');
  if(!w){ peToast('Popup blocked — allow popups for this site to print documents', true); return; }
  w.document.write(html); w.document.close();
  setTimeout(function(){ try{ w.print(); }catch(e){} }, 400);
}
// noPrice = the food proposal she sends before the money is settled. It is her
// choice on every send, not a stage the app decides for her: sharing the menu
// first and pricing after is how the desk has always worked.
// "Without prices" means NO money anywhere — not a zero, not a blank line, not
// the VAT footnote. A guest reading "AED 0" reads a price; a guest reading
// nothing reads a menu, which is exactly what this document is.
function peProposalHTML(e, noPrice){
  var t = peCalcTotals(e);
  var groups = [{k:'Cold',n:'Cold'},{k:'Hot',n:'Hot'},{k:'Dessert',n:'Dolci'}];
  var body = '<div class="brand">'+peLogoImg()+'</div><div class="rule"></div>';
  // Title falls back to the food theme, but a beverage-only booking has no canapés —
  // don't head the guest's proposal "Canapé Selection" when there's no food on it.
  var hasFoodDoc = t.items.length>0 || !!e.set_menu || (e.food_price_pp!=null && e.food_price_pp!=='');
  body += '<h2>'+peEsc(e.package_label || (hasFoodDoc ? 'Canapé Selection' : 'Beverage Package'))+'</h2>';
  // Guest-facing: no per-person maths or piece counts at the top — just who,
  // when, where. The one complete figure lives in "Your event" at the end.
  // #12 — the options this proposal is offering (none, once one is chosen).
  // Needed up here because a proposal that offers three rooms must not headline
  // one of them as THE venue: each option names its own below.
  var propOpts = peChosenOption(e) ? [] : peOptions(e);
  var who = [];
  if(e.client_name) who.push('Prepared for '+peEsc(e.client_name));
  // #13 — the guest offered us two dates, so the proposal offers both back
  // rather than silently picking one and hoping it was the right one.
  if(e.event_date) who.push(peHasAltDates(e)
    ? peCandidateDates(e).map(function(d){ return peDLabel(d.date); }).join(' or ')
    : peDLabel(e.event_date));
  // #5 — "Canapés in the Cortile first, then dinner in Piemonte": the guest
  // reads the evening in the order it happens, in one line.
  // A proposal offering options names no venue up here — each option names its
  // own. Heading it "Cortile" when option C is the whole venue would be the
  // two-numbers-one-deal problem again, in the venue instead of the price.
  if(propOpts.length){ /* each option carries its own venue below */ }
  else if(peIsMultiSpace(e)) who.push(peEsc(peRunOfEvening(e)));
  else if(e.area) who.push(peEsc(e.area));
  if(who.length) body += '<div class="sub">'+who.join(' · ')+'</div>';
  body += peProposalSetMenuHTML(e);
  groups.forEach(function(g){
    var list = t.items.filter(function(it){ var d=peDishById(it.dish_id); return d && d.serve===g.k; });
    if(!list.length) return;
    body += '<div class="sec">'+g.n+'</div>';
    list.forEach(function(it){
      var d = peDishById(it.dish_id);
      body += '<div class="dish">'+peEsc(d.name)+((d.allergens||[]).length?' <span class="codes">('+(d.allergens||[]).join(')(')+')</span>':'')+
        (it.comp?' <span class="d" style="color:#5B6737">— with our compliments</span>':'')+
        (d.description?'<br><span class="d">'+peEsc(d.description)+'</span>':'')+'</div>';
    });
  });
  var bev = e.bev_package_id ? peBevById(e.bev_package_id) : null;
  if(bev){
    body += '<div class="sec">Beverage</div><div class="dish">'+peEsc(bev.name)+(bev.duration_hours?' — '+bev.duration_hours+' hours':'')+
      (bev.includes?'<br><span class="d">'+peEsc(bev.includes)+'</span>':'')+'</div>'+
      // A package built from a designed PDF (no typed "includes") still needs to
      // reach the guest — link the PDF so the beverage selection is never missing.
      (bev.pdf?'<div style="text-align:center;margin:8px 0 4px"><a href="'+(/^https?:/i.test(bev.pdf)?bev.pdf:peBaseUrl()+bev.pdf)+'" style="display:inline-block;background:#400207;color:#E8D9C7;padding:8px 22px;border-radius:20px;text-decoration:none;font-size:12px;letter-spacing:1px">View the beverage package</a></div>':'');
  } else if(e.bev_mode==='dry'){
    body += '<div class="sec">Beverage</div><div class="dish">A dry event — no alcohol will be served<br><span class="d">Soft drinks and water throughout</span></div>';
  }
  // #12 — "Send me three options and I'll pick one." ONE proposal carries them
  // all, so the guest gets one email instead of three, and we keep one enquiry
  // instead of three to reconcile afterwards. Each option shows its own single
  // price; the whole-event figure below is skipped, because quoting a total AND
  // a set of options on one page is exactly the two-numbers-one-deal problem
  // Valentina flagged on the agreement (#9).
  if(propOpts.length){
    body += '<div class="rule" style="margin-top:26px"></div><div class="sec">Your options</div>';
    propOpts.forEach(function(o){
      var tot = peOptionTotal(e, o);
      var g = (o.guests!=null && o.guests!=='') ? Number(o.guests) : Number(e.guests);
      body += '<div class="dish" style="font-size:15px">Option '+peEsc(o.key)+(o.name?' — '+peEsc(o.name):'')+
        '<br><span class="d">'+[o.area?peEsc(o.area):'', g?g+' guests':''].filter(Boolean).join(' · ')+
        (o.note?'<br>'+peEsc(o.note):'')+'</span>'+
        ((tot!=null && !noPrice) ? '<br>'+(o.min_spend ? 'Minimum spend AED '+peMoney(tot) : 'AED '+peMoney(tot)+' — everything included') : '')+
        '</div>';
    });
    body += '<div class="d" style="margin-top:10px">Let us know which one you would like and we will hold it for you.</div>';
  }
  // A minimum-spend booking is quoted on the minimum alone — never a per-person or
  // sub-total figure, even once a priced beverage gives it a running total. The
  // menu is shown for what it is; the money lives on the "Minimum spend" line below.
  else if(noPrice){ /* the money is not on this document at all — see peProposalHTML */ }
  else if(t.total && e.guests && e.pricing_type!=='min_spend'){
    // Valentina chooses how the price reads for this guest — the whole-event total,
    // or a per-person figure (which some groups prefer). Per person reconciles with
    // the guest count: round(total ÷ guests) × guests ≈ total.
    var ppMode = (e.price_display==='pp');
    var priceLine = ppMode
      ? e.guests+' guests · AED '+peMoney(Math.round(t.total/e.guests))+' per person'
      : e.guests+' guests · AED '+peMoney(t.total);
    body += '<div class="rule" style="margin-top:26px"></div><div class="sec">Your event</div>'+
      '<div class="dish" style="font-size:15px">'+priceLine+
      (t.discount>0?'<br><span class="d" style="color:#5B6737">including a courtesy of AED '+peMoney(t.discount)+'</span>':'')+
      '<br><span class="d">'+(t.items.length?'Canapé selection':'Menu')+(bev?' and '+(bev.duration_hours?bev.duration_hours+'-hour ':'')+'beverage package':'')+' — everything included</span></div>';
  } else if(e.min_spend){
    body += '<div class="rule" style="margin-top:26px"></div><div class="sec">Your event</div>'+
      '<div class="dish" style="font-size:15px">Minimum spend AED '+peMoney(e.min_spend)+'</div>';
  }
  // Nothing stands in for the money on a no-price proposal — no placeholder, no
  // "pricing to follow". The VAT sentence goes with it: it is a statement about
  // prices, and there are none on this document.
  body += '<div class="ft">Our Chefs will do their best to accommodate your dietary requirements, please inform your waiter.'+
    (noPrice ? '' : '<br>All prices are in AED inclusive of 5% VAT, 7% DIFC Authority Fee and 10% Service Charge.')+
    peAlgLegend(body)+'</div>';
  return peDocShell('Roberto\'s proposal', body);
}
function pePrintProposal(id){ var e = peEvById(id); if(e) pePrintHTML(peProposalHTML(e)); }
// The branded internal Event Brief — the whole team's one-page source of truth.
// Used both for the printout and for the email to the team (same document).
function peBriefBodyHTML(e){
  var t = peCalcTotals(e);
  function row(l,v){ return '<tr><td class="l">'+l+'</td><td>'+peEsc(v==null||v===''?'—':v)+'</td></tr>'; }
  // Same row, but the value is already HTML — used for the one line the kitchen
  // must not read as a decision.
  function rowHTML(l,v){ return '<tr><td class="l">'+l+'</td><td>'+v+'</td></tr>'; }
  var body = '<div class="brand">'+peLogoImg()+'</div><div class="rule"></div><div class="fs-h">EVENT BRIEF</div><table>';
  body += row('Booking name', e.client_name)+row('Company', e.company)+row('Contact', (e.contact_name||'')+(e.contact_phone?' · '+e.contact_phone:'')+(e.contact_email?' · '+e.contact_email:''));
  body += row('Event date', peDLabel(e.event_date))+row('Type', e.event_type)+row('Timing', (e.time_from||'')+(e.time_to?' – '+e.time_to:''));
  // #5 — a two-space evening moves rooms partway through. The floor and the
  // kitchen have to know that before the night, not during it, so the brief
  // spells out the whole run rather than naming one room.
  body += peIsMultiSpace(e)
    ? row('Areas — the run of the evening', peRunOfEvening(e))
    : row('Area', e.area);
  body += row('Guests', e.guests);
  // "Bespoke selection" is the fallback label for NOTHING CHOSEN, so an empty menu
  // reached Danilo looking like a decision — and with no KITCHEN section below it,
  // there was nothing to contradict that. It has to say what it is.
  var bfItems = peState.items[e.id]||[];
  var bfHasFood = bfItems.length>0 || !!e.set_menu || (e.food_price_pp!=null && e.food_price_pp!=='');
  body += bfHasFood
    ? row('Food', (e.package_label||'Bespoke selection')+(t.foodPP?' · AED '+peMoney(t.foodPP)+'/guest':'')+(t.pcs?' · '+(Math.round(t.pcs*10)/10)+' pieces/guest':''))
    : rowHTML('Food', '<b style="color:#B00020">NO MENU YET — do not prep</b>');
  var bev = e.bev_package_id ? peBevById(e.bev_package_id) : null;
  body += row('Beverage', bev ? bev.name+(bev.price_pp!=null?' · AED '+peMoney(bev.price_pp)+'/guest':' · price on the proposal') : (e.bev_mode==='dry'?'DRY EVENT — no alcohol served (soft drinks & water)':'—'));
  body += row('Estimated total', t.total ? 'AED '+peMoney(t.total) : '—')+row('Minimum spend', e.min_spend?'AED '+peMoney(e.min_spend):'—');
  body += row('Dietary', e.dietary)+row('Payment', e.payment_terms);
  // When the BOOKING last changed — not when the paper was printed. This used to be
  // new Date() plus whoever was holding the screen, so the one line a chef would use
  // to decide whether to trust the sheet always said today and named the reader.
  // The actor is deliberately left off: only some update paths write updated_by, so
  // printing it would name a stale person.
  body += row('Status', peStatusMeta(e.status).n)+
    row('Last update', e.updated_at ? new Date(e.updated_at).toLocaleDateString('en-GB') : '—');
  body += '</table>';
  body += peSetMenuPrepHTML(e);
  body += peKitchenPrepHTML(e, t);
  body += '<div class="ft">All prices inclusive of 5% VAT, 7% DIFC authority fee and 10% service charge.</div>';
  return body;
}
function peFunctionSheetHTML(e){ return peDocShell('Roberto’s — event brief', peBriefBodyHTML(e)); }
// Set-menu prep for the kitchen: fixed courses = one portion per guest; the
// choose course carries the exact per-option headcount the chef cooks.
function peSetMenuPrepHTML(e){
  var sm = e.set_menu; if(!sm) return '';
  var m = peSetMenuByKey(sm.key); if(!m) return '';
  var g = Number(e.guests)||0;
  var h = '<div class="fs-h" style="margin-top:16px">KITCHEN — '+peEsc(m.name).toUpperCase()+' · '+(g||'?')+' GUESTS</div><table>';
  m.courses.forEach(function(c){
    h += '<tr><td colspan="2" style="background:#F3E9DA;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#574232">'+peEsc(c.name)+(c.choose?' — guests’ choice':'')+'</td></tr>';
    if(c.choose){
      var counts = (sm.choices&&sm.choices[c.name])||{}, sum = 0;
      c.options.forEach(function(o){ var n=Number(counts[o])||0; sum+=n;
        h += '<tr><td>'+o+'</td><td><b>'+(n?n+' portions':'—')+'</b></td></tr>';
      });
      if(g && sum!==g) h += '<tr><td colspan="2" style="color:#B00020;font-size:11px">▲ choices total '+sum+' of '+g+' guests — confirm the split with the events desk</td></tr>';
    } else {
      (c.items||[]).forEach(function(it){ h += '<tr><td>'+it+'</td><td><b>'+(g?g+' portions':'per guest')+'</b></td></tr>'; });
    }
  });
  h += '</table>';
  h += peCmSwapsHTML(m);   // a customised menu: what was swapped for what
  if(sm.note) h += '<div style="font-family:Arial,sans-serif;font-size:12px;color:#B00020;margin-top:6px"><b>Menu changes agreed with the guest — read before prep:</b> '+peEsc(sm.note)+'</div>';
  h += peOffMenuHTML(e);   // #17 — à la carte additions reach the set-menu prep too
  if(e.dietary) h += '<div style="font-family:Arial,sans-serif;font-size:12px;color:#B00020;margin-top:6px"><b>Dietary — read before prep:</b> '+peEsc(e.dietary)+'</div>';
  return h;
}
// A customised menu prints its courses like any other, so the kitchen already
// sees the RIGHT dishes. What it must also see is what changed: a chef who
// knows this menu will otherwise plate the dish that used to be there.
function peCmSwapsHTML(m){
  var d = m && m.custom ? m.detail : null;
  if(!d || ((!d.swaps || !d.swaps.length) && (!d.adds || !d.adds.length))) return '';
  var h = '<div style="font-family:Arial,sans-serif;font-size:12px;color:#B00020;margin-top:6px"><b>Customised for this booking — read before prep:</b><ul style="margin:4px 0 0 18px;padding:0">';
  (d.swaps||[]).forEach(function(s){
    h += '<li>'+peEsc(s.course||'')+' — <b>'+peEsc(s.name)+'</b>'+(s.out?' instead of '+peEsc(s.out):'')+'</li>';
  });
  (d.adds||[]).forEach(function(a){
    h += '<li>'+peEsc(a.course||'')+' — <b>'+peEsc(a.name)+'</b> added to the menu</li>';
  });
  return h+'</ul></div>';
}
function peCoordSetMenuHTML(e){
  var sm = e.set_menu; if(!sm) return '';
  var m = peSetMenuByKey(sm.key); if(!m) return '';
  var g = Number(e.guests)||0;
  var h = '<p style="margin:14px 0 4px"><b>'+peEsc(m.name)+' — kitchen (@Danilo) · '+(g||'?')+' guests:</b></p>'+
    '<table style="border-collapse:collapse;font-size:13px">';
  m.courses.forEach(function(c){
    h += '<tr><td colspan="2" style="padding:3px 8px;border:1px solid #ddd;color:#574232;font-size:11px;text-transform:uppercase;letter-spacing:1px">'+peEsc(c.name)+(c.choose?' — guests’ choice':'')+'</td></tr>';
    if(c.choose){
      var counts = (sm.choices&&sm.choices[c.name])||{}, sum = 0;
      c.options.forEach(function(o){ var n=Number(counts[o])||0; sum+=n;
        h += '<tr><td style="padding:3px 8px;border:1px solid #ddd">'+o+'</td><td style="padding:3px 8px;border:1px solid #ddd"><b>'+(n?n+' portions':'—')+'</b></td></tr>';
      });
      if(g && sum!==g) h += '<tr><td colspan="2" style="padding:3px 8px;border:1px solid #ddd;color:#B00020;font-size:11px">choices total '+sum+' of '+g+' — to be confirmed</td></tr>';
    } else {
      (c.items||[]).forEach(function(it){ h += '<tr><td style="padding:3px 8px;border:1px solid #ddd">'+it+'</td><td style="padding:3px 8px;border:1px solid #ddd"><b>'+(g?g+' portions':'per guest')+'</b></td></tr>'; });
    }
  });
  h += '</table>';
  if(sm.note) h += '<p style="color:#B00020;font-size:13px;margin:6px 0"><b>Menu changes agreed with the guest:</b> '+peEsc(sm.note)+'</p>';
  return h;
}
// Elegant set-menu courses for the guest proposal — a menu, not a headcount.
function peProposalSetMenuHTML(e){
  var sm = e.set_menu; if(!sm) return '';
  var m = peSetMenuByKey(sm.key); if(!m) return '';
  var h = '';
  m.courses.forEach(function(c){
    h += '<div class="sec">'+peEsc(c.name)+'</div>';
    var kind = peCmCourseKind(c), stored = c.desc||{};
    // Every menu we send names the dish, what it is in English, and its
    // allergens. The proposal printed the name alone.
    var dishLine = function(o){
      // Same order as the printed menu: the menu's own text first, and the
      // a la carte only fills a gap. Allergens come from the structured field
      // where the menu has one, otherwise out of its own prose.
      var info = stored[o] ? null : peCmDishInfo(o, kind);
      var alg  = peAlgOf(c, o);
      if(!alg.known && info && info.allergens && info.allergens.length){
        alg = { known:true, list:info.allergens };
      }
      var txt = stored[o] ? peDescOf(c, o) : ((info && info.desc) ? info.desc : '');
      // On a document a guest reads, a dish nobody has recorded must say so.
      // A GUEST NEVER READS OUR GAP. A dish we have not recorded simply shows
      // no codes; the footer already carries the line that is true for every
      // dish — ask your waiter. The alarm belongs inside: peMenuAllergenGaps
      // stops an incomplete menu being printed or sent at all.
      var codes = alg.known
        ? (alg.list.length ? '('+alg.list.join(')(')+')' : '')
        : '';
      return '<div class="dish">'+peEsc(o)+(codes?' <span class="codes">'+peEsc(codes)+'</span>':'')+
        (txt?'<br><span class="d">'+peEsc(txt)+'</span>':'')+'</div>';
    };
    if(c.choose){
      h += '<div class="dish"><span class="d">Each guest chooses one</span></div>'+
        (c.options||[]).map(dishLine).join('');
    } else {
      (c.items||[]).forEach(function(it){ h += dishLine(it); });
    }
  });
  if(sm.note) h += '<div class="sec">Special arrangements</div><div class="dish">'+peEsc(sm.note)+'</div>';
  return h;
}
// #17 — off-menu / à la carte items, rendered on EVERY kitchen-facing document.
// Valentina (17 Jul 2026): a dish added by hand ("the burrata from the à la carte")
// got the PRICE right but never reached the kitchen's prep list — the money was
// correct and the kitchen didn't know. This block is the missing channel; it is
// deliberately loud (red, "read before prep") because it is the exception list.
function peOffMenuHTML(e, plain){
  if(!e.off_menu) return '';
  if(plain) return '<p style="color:#B00020;font-size:13px;margin:6px 0"><b>Off-menu / à la carte — read before prep:</b> '+peEsc(e.off_menu)+'</p>';
  return '<div style="font-family:Arial,sans-serif;font-size:12px;color:#B00020;margin-top:6px"><b>Off-menu / à la carte — read before prep:</b> '+peEsc(e.off_menu)+'</div>';
}
// The chef's half of the sheet: every selected dish with the quantity to
// prepare (pcs/guest × guests), grouped like the kitchen works — cold, hot,
// dolci — with allergens and the dietary note in one place.
function peKitchenPrepRows(e){
  var t = peCalcTotals(e);
  var order = {Cold:0, Hot:1, Dessert:2};
  return t.items.map(function(it){
    var d = peDishById(it.dish_id); if(!d) return null;
    var pcs = Number(it.pcs_per_guest)||0;
    var total = e.guests ? Math.ceil(pcs*Number(e.guests)) : null;
    var minFlag = (total!=null && d.min_order && total < d.min_order) ? d.min_order : null;
    return {d:d, pcs:pcs, total:total, minFlag:minFlag, unconfirmed:(it.qty_confirmed===false), sort:(order[d.serve]!=null?order[d.serve]:9)};
  }).filter(Boolean).sort(function(a,b){ return a.sort-b.sort; });
}
function peKitchenPrepHTML(e, t){
  var rows = peKitchenPrepRows(e);
  // No library dishes but an off-menu line: the kitchen block still renders —
  // an à-la-carte-only event must not leave the kitchen with a blank sheet (#17).
  // (A set-menu event shows it inside its own kitchen block instead — no doubling.)
  if(!rows.length){
    if(!e.off_menu || e.set_menu) return '';
    return '<div class="fs-h" style="margin-top:16px">KITCHEN — MENU &amp; QUANTITIES TO PREPARE</div>'+
      peOffMenuHTML(e)+
      (e.dietary?'<div style="font-family:Arial,sans-serif;font-size:12px;color:#B00020;margin-top:6px"><b>Dietary — read before prep:</b> '+peEsc(e.dietary)+'</div>':'');
  }
  var h = '<div class="fs-h" style="margin-top:16px">KITCHEN — MENU &amp; QUANTITIES TO PREPARE</div><table>';
  h += '<tr><td class="l">Dish</td><td class="l" style="width:18%">Per guest</td><td class="l" style="width:22%">Total to prepare</td></tr>';
  var lastServe = null;
  rows.forEach(function(r){
    if(r.d.serve!==lastServe){
      lastServe = r.d.serve;
      h += '<tr><td colspan="3" style="background:#F3E9DA;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#574232">'+(r.d.serve==='Dessert'?'Dolci':peEsc(r.d.serve))+'</td></tr>';
    }
    h += '<tr><td>'+peEsc(r.d.name)+' <span style="font-size:10px;color:#574232">'+peEsc(peAllergenText(r.d.allergens))+'</span></td>'+
      '<td>'+(Math.round(r.pcs*10)/10)+' pc'+(r.unconfirmed?' <span style="color:#544418;font-size:9px">default</span>':'')+'</td>'+
      '<td><b>'+(r.total!=null ? r.total+' pcs' : '— set guests')+'</b>'+(r.minFlag?' <span style="color:#B00020;font-size:10px">min order '+r.minFlag+'</span>':'')+'</td></tr>';
  });
  var totalPcs = 0, anyDefault = false; rows.forEach(function(r){ if(r.total) totalPcs += r.total; if(r.unconfirmed) anyDefault = true; });
  if(e.guests && totalPcs) h += '<tr><td style="text-align:right"><b>Total</b></td><td>'+(Math.round((t||peCalcTotals(e)).pcs*10)/10)+' pc/guest</td><td><b>'+totalPcs+' pcs</b></td></tr>';
  h += '</table>';
  if(anyDefault) h += '<div style="font-family:Arial,sans-serif;font-size:11px;color:#544418;margin-top:5px">Items marked <b>default</b> are still at 1 pc/guest — confirm the real quantity with the events desk before prep.</div>';
  h += peOffMenuHTML(e);   // #17 — à la carte additions reach the prep sheet
  if(e.dietary) h += '<div style="font-family:Arial,sans-serif;font-size:12px;color:#B00020;margin-top:6px"><b>Dietary — read before prep:</b> '+peEsc(e.dietary)+'</div>';
  return h;
}
function pePrintFunctionSheet(id){ var e = peEvById(id); if(e) pePrintHTML(peFunctionSheetHTML(e)); }
// The wall-print page is served from our own site (renders reliably in every
// browser and email client) and pulls the brief from the token-gated function.
function peBriefPrintUrl(e){
  return location.origin + location.pathname.replace(/[^\/]*$/, '') + 'print-brief.html?t=' + e.brief_token;
}
function peCoordEmailHTML(e){
  // The team's brief arrives as a full branded Roberto's document (same as the
  // printout). A print button at the top opens it as its own page to print
  // for the wall (email itself can't run a print button).
  var bar = e.brief_token ? '<div style="text-align:center;margin:0 0 8px"><a href="'+peBriefPrintUrl(e)+'" style="display:inline-block;background:#400207;color:#E8D9C7;padding:9px 22px;border-radius:20px;text-decoration:none;font-size:12px;letter-spacing:.5px">🖨 Open &amp; print this brief for the wall</a></div>' : '';
  return peDocShell('Roberto’s — event brief', bar + peBriefBodyHTML(e));
}
// @Danilo's half of the coordination email — the selected menu with the
// quantities the kitchen has to prepare, so nobody has to call to ask.
function peCoordPrepHTML(e){
  var rows = peKitchenPrepRows(e);
  if(!rows.length) return '';
  var h = '<p style="margin:14px 0 4px"><b>Menu — quantities to prepare (@Danilo):</b></p>'+
    '<table style="border-collapse:collapse;font-size:13px">'+
    '<tr><td style="padding:3px 8px;border:1px solid #ddd;background:#f5f0e8"><b>Dish</b></td>'+
    '<td style="padding:3px 8px;border:1px solid #ddd;background:#f5f0e8"><b>Per guest</b></td>'+
    '<td style="padding:3px 8px;border:1px solid #ddd;background:#f5f0e8"><b>Total</b></td></tr>';
  var lastServe = null, totalPcs = 0;
  rows.forEach(function(r){
    if(r.d.serve!==lastServe){
      lastServe = r.d.serve;
      h += '<tr><td colspan="3" style="padding:3px 8px;border:1px solid #ddd;color:#574232;font-size:11px;text-transform:uppercase;letter-spacing:1px">'+(r.d.serve==='Dessert'?'Dolci':peEsc(r.d.serve))+'</td></tr>';
    }
    if(r.total) totalPcs += r.total;
    h += '<tr><td style="padding:3px 8px;border:1px solid #ddd">'+peEsc(r.d.name)+' <span style="color:#4F4535;font-size:11px">'+peEsc(peAllergenText(r.d.allergens))+'</span></td>'+
      '<td style="padding:3px 8px;border:1px solid #ddd">'+(Math.round(r.pcs*10)/10)+' pc'+(r.unconfirmed?' <span style="color:#544418;font-size:10px">default</span>':'')+'</td>'+
      '<td style="padding:3px 8px;border:1px solid #ddd"><b>'+(r.total!=null?r.total+' pcs':'— set guests')+'</b>'+(r.minFlag?' <span style="color:#B00020;font-size:11px">min '+r.minFlag+'</span>':'')+'</td></tr>';
  });
  if(totalPcs) h += '<tr><td style="padding:3px 8px;border:1px solid #ddd;text-align:right"><b>Total</b></td><td style="padding:3px 8px;border:1px solid #ddd"></td><td style="padding:3px 8px;border:1px solid #ddd"><b>'+totalPcs+' pcs</b></td></tr>';
  h += '</table>';
  if(rows.some(function(r){ return r.unconfirmed; })) h += '<p style="font-size:11px;color:#544418;margin:4px 0 0">Items marked <b>default</b> are still at 1 pc/guest — quantities to be confirmed.</p>';
  return h;
}
// Friendly names for the standard team, so the picker reads like people not emails.
var PE_PEOPLE = {
  'vdetoni@robertos.ae':'Valentina De Toni','dvalla@robertos.ae':'Danilo Valla','jthomas@robertos.ae':'Jins Thomas','mpetrosino@robertos.ae':'Manuel Petrosino',
  'astellacci@robertos.ae':'Antonio Stellacci','afalcone@robertos.ae':'Andrea Falcone',
  'reservations@robertos.ae':'Reservations','asacchi@skelmore.com':'Andrea Sacchi',
  'kvukotic@robertos.ae':'Katarina Vukotic','rmazouz@robertos.ae':'R. Mazouz','aviscardi@robertos.ae':'A. Viscardi',
  'ahtwe@robertos.ae':'Aung Htwe','amahmoud@skelmore.com':'A. Mahmoud (Design)'
};
// A branded, tap-to-include recipient picker — replaces the raw prompt() box.
function pePickRecipients(opts){
  var standard = opts.standard || [];
  var checked = opts.checked || standard.slice();
  var you = opts.you || '';
  var row = function(em){
    var lbl = (em===you) ? 'You' : (PE_PEOPLE[em]||'');
    var on = checked.indexOf(em)>=0;
    return '<label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(107,31,42,0.08);cursor:pointer">'+
      '<input type="checkbox" class="pe-rcp" value="'+peEsc(em)+'" '+(on?'checked':'')+' style="accent-color:#400207;width:16px;height:16px;flex-shrink:0">'+
      '<span style="flex:1;min-width:0"><span style="font-size:13px;color:#2C1810">'+peEsc(lbl||em)+'</span>'+
      (lbl?'<br><span style="font-size:11px;color:#4F4535">'+peEsc(em)+'</span>':'')+'</span></label>';
  };
  var bg = document.createElement('div'); bg.className='pe-modal-bg';
  bg.addEventListener('click', function(ev){ if(ev.target===bg) bg.remove(); });
  bg.innerHTML = '<div class="pe-modal" style="max-width:440px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px"><b style="color:#400207;font-size:15px">'+peEsc(opts.title||'Send email')+'</b><span class="pe-x" onclick="this.closest(\'.pe-modal-bg\').remove()">✕</span></div>'+
    (opts.subtitle?'<div style="font-size:12px;color:#4F4535;margin-bottom:6px">'+peEsc(opts.subtitle)+'</div>':'')+
    '<div style="font-size:11px;color:#4F4535;margin-bottom:4px">Tap to include or leave out. Add anyone else below.</div>'+
    '<div id="pe-rcp-list" style="max-height:44vh;overflow-y:auto">'+standard.map(row).join('')+'</div>'+
    '<div style="display:flex;gap:6px;margin-top:10px"><input class="pe-in" id="pe-rcp-add" placeholder="Add another email…" style="flex:1" onkeydown="if(event.key===\'Enter\'){event.preventDefault();peRcpAdd();}"><button class="pe-btn sec sm" onclick="peRcpAdd()">Add</button></div>'+
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="pe-btn" id="pe-rcp-send">Send</button>'+
    '<button class="pe-btn sec" onclick="this.closest(\'.pe-modal-bg\').remove()">Cancel</button></div></div>';
  document.body.appendChild(bg);
  function refresh(){
    var n = bg.querySelectorAll('.pe-rcp:checked').length;
    var b = bg.querySelector('#pe-rcp-send');
    b.textContent = n ? 'Send to '+n+' '+(n===1?'person':'people') : 'Select recipients';
    b.disabled = !n;
  }
  bg.addEventListener('change', refresh);
  bg.querySelector('#pe-rcp-send').addEventListener('click', function(){
    var list = Array.prototype.map.call(bg.querySelectorAll('.pe-rcp:checked'), function(c){ return c.value; });
    if(!list.length) return;
    bg.remove();
    opts.onSend(list);
  });
  refresh();
}
function peRcpAdd(){
  var bg = document.querySelector('.pe-modal-bg'); if(!bg) return;
  var inp = bg.querySelector('#pe-rcp-add'); var em = (inp.value||'').trim();
  if(em.indexOf('@')<1){ peToast('Enter a valid email', true); return; }
  var dup = Array.prototype.some.call(bg.querySelectorAll('.pe-rcp'), function(c){ return c.value.toLowerCase()===em.toLowerCase(); });
  if(dup){ peToast('Already on the list', true); inp.value=''; return; }
  bg.querySelector('#pe-rcp-list').insertAdjacentHTML('beforeend',
    '<label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(107,31,42,0.08);cursor:pointer">'+
    '<input type="checkbox" class="pe-rcp" value="'+peEsc(em)+'" checked style="accent-color:#400207;width:16px;height:16px;flex-shrink:0">'+
    '<span style="flex:1;min-width:0;font-size:13px;color:#2C1810">'+peEsc(em)+'</span></label>');
  inp.value='';
  var b = bg.querySelector('#pe-rcp-send'); var n = bg.querySelectorAll('.pe-rcp:checked').length;
  b.textContent = 'Send to '+n+' '+(n===1?'person':'people'); b.disabled = !n;
}
// The brief's recipient list, read live from Admin -> Emails (app_users.notify).
// It goes through the fn_notify_list RPC because RLS only lets a person read their
// OWN app_users row unless they're an admin — a plain select here would show Valentina
// one name and quietly send to the wrong team. Anything unexpected (RPC not there yet,
// network, empty list) falls back to PE_TEAM_CC: a brief that reaches the old standard
// team is recoverable, one that reaches nobody is not.
async function peBriefTeam(){
  try{
    var r = await sb.rpc('fn_notify_list', {p_key:'event_brief'});
    if(r.error) throw r.error;
    var rows = r.data || [];
    var emails = rows.map(function(x){ return String(x.email||'').trim(); })
                     .filter(function(x){ return x.indexOf('@')>0; });
    if(!emails.length) return PE_TEAM_CC.slice();
    // Names come from the same rows, so the picker reads like people even for someone
    // added on the Emails screen today and never listed in PE_PEOPLE.
    rows.forEach(function(x){ if(x.email && x.name) PE_PEOPLE[x.email]=x.name; });
    return emails;
  }catch(err){ return PE_TEAM_CC.slice(); }
}
async function peSendCoordEmail(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e) return;
  // P0 — the team can't act on a brief that's missing the basics.
  var missing = [];
  if(!(e.client_name||e.company)) missing.push('a booking name');
  if(!e.event_date) missing.push('the date');
  if(!e.guests) missing.push('the guest count');
  if(missing.length && !(await peConfirm({title:'Some basics are missing', html:'This event is still missing <b>'+peEsc(missing.join(', '))+'</b>.<br><br>Send the brief to the team anyway?', ok:'Send anyway', cancel:'Go back', danger:true}))) return;
  var standard = (state.userEmail?[state.userEmail]:[]).concat(await peBriefTeam());
  standard = standard.filter(function(x,i){ return standard.indexOf(x)===i; });
  pePickRecipients({
    title:'Send the event brief', subtitle:(e.client_name||'Event')+' · '+peDLabel(e.event_date),
    standard:standard, checked:standard, you:state.userEmail,
    onSend:function(list){ peDoSendCoord(id, list); }
  });
}
async function peDoSendCoord(id, list){
  var e = peEvById(id); if(!e || !list.length) return;
  // Save a printable copy the team can reopen from the email (its own token so
  // it's never reachable from a guest link).
  if(!e.brief_token){ e.brief_token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('b'+Date.now().toString(36)+Math.round(Math.random()*1e9).toString(36)); }
  var snapshot = peDocShell('Roberto’s — event brief', peBriefBodyHTML(e));
  var sv = await sb.from('events_desk').update({brief_token:e.brief_token, brief_html:snapshot, updated_at:new Date().toISOString()}).eq('id', id);
  // If the printable-brief columns aren't in place yet, still send the brief —
  // just without the wall-print button (no brief_token → peCoordEmailHTML omits it).
  if(sv.error){ e.brief_token = null; }
  var subject = "Event brief — "+(e.client_name||'event')+(e.event_date?' · '+peDLabel(e.event_date):'');
  try{
    var r = await sb.functions.invoke('send-event-email', { body:{ to:list, from_name:peSenderName(), subject:subject, html:peCoordEmailHTML(e) } });
    if(r.error || (r.data&&r.data.error)) throw (r.error||r.data.error);
    peToast('Event brief sent to '+list.length+' '+(list.length>1?'people':'person')+' ✓');
    // Flip the chip/banner to "sent ✓" now rather than on the next full reload —
    // the send only counts as done once she can SEE it's done.
    (peState.briefSent = peState.briefSent || {})[id] = new Date().toISOString();
    sb.from('event_log').insert({event_id:id, action:'email', detail:'event brief → '+list.join(', '), actor:peActor()}).then(function(){ peLoadLog(id); });
    renderMain();
  }catch(err){
    peToast('Email NOT sent — '+String(err&&err.message||err).slice(0,120), true);
  }
}
// What the client sees in their inbox. A set-menu dinner is not a canape proposal.
function peProposalSubject(e){
  if(e && e.set_menu) return 'Your menu proposal — Roberto’s';
  if(e && (peState.items[e.id]||[]).length) return 'Your canapé proposal — Roberto’s';
  return 'Your event proposal — Roberto’s';
}
async function peEmailProposal(id, noPrice){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e || !e.contact_email) return;
  if(!(await peConfirmSend(e, false, noPrice))) return;
  // The sender is copied (her inbox record of exactly what the client got)
  // and set as reply-to, so the client's answer reaches a person.
  var sender = state.userEmail || 'reservations@robertos.ae';
  // Say that the copy exists. The confirm used to name one recipient while the
  // email quietly went to two.
  // The confirm names which of the two documents is leaving. She picks per send,
  // so it must never be ambiguous which one she picked.
  if(!(await peConfirm({title:noPrice?'Send the menu, without prices?':'Send the proposal?',
    html:(noPrice
      ? 'Send the menu to <b>'+peEsc(e.contact_email)+'</b> now, with <b>no prices on it</b>?'
      : 'Send the branded proposal to <b>'+peEsc(e.contact_email)+'</b> now?')+
      peCopyLine(sender),
    ok:noPrice?'Send the menu':'Send proposal', cancel:'Not yet'}))) return;
  try{
    var r = await sb.functions.invoke('send-event-email', { body:{
      to: peSendTo(e.contact_email, sender),
      from_name: peSenderName(),
      reply_to: sender,
      // The subject has to match what is actually inside, or a set-menu dinner
      // arrives in the client's inbox titled "canape proposal".
      subject: (noPrice ? 'Your menu \u2014 Roberto\u2019s' : peProposalSubject(e))+(e.event_date?' \u00b7 '+peDLabel(e.event_date):''),
      html: peProposalHTML(e, noPrice)
    }});
    if(r.error || (r.data&&r.data.error)) throw (r.error||r.data.error);
    peToast((noPrice?'Menu sent (no prices) to ':'Proposal sent to ')+e.contact_email+' \u2713');
    // A menu-only send is a real first contact, so the booking moves off draft the
    // same way a priced one does. The log says which document went, because "sent"
    // on its own would leave her unable to tell whether the guest has seen a price.
    if(e.status==='draft') peSetStatus(id, 'sent');
    (peState.proposalSent = peState.proposalSent || {})[id] = new Date().toISOString();
    (peState.proposalNoPrice = peState.proposalNoPrice || {})[id] = !!noPrice;
    sb.from('event_log').insert({event_id:id, action:'email', detail:(noPrice?'menu, no prices':'proposal')+' \u2192 '+e.contact_email, actor:peActor()}).then(function(){ peLoadLog(id); });
  }catch(err){
    peToast('NOT sent \u2014 '+String(err&&err.message||err).slice(0,120), true);
  }
}
// mode==='remind' is a FOLLOW-UP, not a first hello. The reminder button reused the
// enquiry message, so a client who had already been sent everything got "Thank you
// for your enquiry" all over again.
async function peWhatsApp(id, mode){
  if(!peCanEdit()){ peToast('View only \u2014 ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e || !e.contact_phone) return;
  if(!(await peConfirmSend(e))) return;
  var digits = String(e.contact_phone).replace(/[^0-9]/g,'');
  if(digits.length && digits[0]==='0') digits = '971'+digits.slice(1);
  if(digits.length <= 9) digits = '971'+digits;
  var first = e.contact_name ? ' '+e.contact_name.split(' ')[0] : '';
  var msg = mode==='remind'
    ? 'Ciao'+first+'! Just following up on the proposal for your event with Roberto\u2019s'+
      (e.event_date?' on '+peDLabel(e.event_date):'')+'. Here is the link again whenever you have a moment:\n'+
      peAgreementUrl(e)+'\nAny questions at all, just reply here \u2014 '+peSignOff()
    : 'Ciao'+first+'! Thank you for your enquiry with Roberto\u2019s'+
      (e.event_date?' for '+peDLabel(e.event_date):'')+'. Here is your proposal and event agreement to review and sign at your convenience:\n'+
      peAgreementUrl(e)+'\nIt will be our pleasure \u2014 '+peSignOff();
  window.open('https://wa.me/'+digits+'?text='+encodeURIComponent(msg), '_blank');
  sb.from('event_log').insert({event_id:id, action:'whatsapp',
    detail:'WhatsApp opened \u2014 '+(mode==='remind'?'reminder':'proposal + agreement link')+' \u2192 '+e.contact_phone,
    actor:peActor()});
}
function peCopyClientLink(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e) return;
  // The guest's menu page, so no price is required — but an empty one is still an
  // empty page with our name on it. Synchronous for the same clipboard reason as
  // the signing link above.
  var block = peSendBlocks(e, false, true);
  if(block){
    if(block.card){ peToast(block.msg, true); peScrollToCard(block.card); }
    else peScrollToField(block.fid, block.msg);
    return;
  }
  var base = location.origin + location.pathname.replace(/[^\/]*$/, '');
  var url = base + 'client-event.html?t=' + e.client_token;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function(){
    peToast('Client link copied — paste it into your email/WhatsApp to the client');
  }).catch(function(){ prompt('Copy this link:', url); });
  sb.from('event_log').insert({event_id:id, action:'client_link', detail:'link copied', actor:peActor()});
}
// Open the real guest page in a new tab. Deliberately the live URL rather than a
// rendered copy — a preview that is built by different code to the thing being
// sent is how the Print version and the client's page drifted apart.
function pePreviewClient(id){
  var e = peEvById(id); if(!e) return;
  if(!e.client_token){ peToast('This booking has no guest link yet — save it first', true); return; }
  var w = window.open(peAgreementUrl(e), '_blank');
  if(!w){ peToast('Popup blocked — allow popups to preview the guest page', true); return; }
  peToast('Opened the page exactly as the client sees it');
}
function peAgreementUrl(e){
  return location.origin + location.pathname.replace(/[^\/]*$/, '') + 'client-agreement.html?t=' + e.client_token;
}
// Copying the signing link puts the agreement in front of the guest exactly as
// emailing it does — same page, same signature block — so it has to pass the same
// gate. It ran no checks at all, which is how an unpriced booking could reach a
// guest reading "AED 0" under a live signature block.
function peCopyAgreementLink(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e) return;
  // Deliberately the synchronous hard block, not peConfirmSend: awaiting a modal
  // spends the click's user-activation and the clipboard write is then refused by
  // the browser. The refusals below need no confirming anyway.
  var block = peSendBlocks(e, true);
  if(block){
    if(block.card){ peToast(block.msg, true); peScrollToCard(block.card); }
    else peScrollToField(block.fid, block.msg);
    return;
  }
  var url = peAgreementUrl(e);
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function(){
    peToast('Agreement link copied — the guest reads the proposal and signs on that page');
  }).catch(function(){ prompt('Copy this link:', url); });
  sb.from('event_log').insert({event_id:id, action:'agreement_link', detail:'link copied', actor:peActor()});
}
function peViewSignedCopy(id){
  var e = peEvById(id); if(!e || !e.contract_snapshot) return;
  var w = window.open('', '_blank');
  if(!w){ peToast('Popup blocked — allow popups for this site', true); return; }
  w.document.write(e.contract_snapshot); w.document.close();
}
async function peEmailAgreement(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e || !e.contact_email) return;
  if(!(await peConfirmSend(e, true))) return;
  var sender = state.userEmail || 'reservations@robertos.ae';
  if(!(await peConfirm({title:'Send proposal + agreement?', html:'Email the proposal + agreement link to <b>'+peEsc(e.contact_email)+'</b> now?<br>The guest reads the menu and terms on one page and signs electronically.'+peCopyLine(sender), ok:'Send now', cancel:'Not yet'}))) return;
  var url = peAgreementUrl(e);
  var inner = '<div style="text-align:center;margin:24px 0 10px"><a href="'+url+'" style="display:inline-block;background:#400207;color:#E8D9C7;padding:12px 30px;border-radius:22px;text-decoration:none;font-size:13.5px;letter-spacing:1px">Read your proposal &amp; sign</a></div>'+
    '<p style="font-size:12px;color:#4F4535;text-align:center">The page shows your full proposal and the agreement on one page — signing takes under a minute.</p>';
  var intro = 'Thank you for choosing Roberto’s'+(e.event_date?' for '+peDLabel(e.event_date):'')+'. Your proposal and event agreement are ready — the button below opens everything on one page, where you can review and sign electronically.';
  try{
    var r = await sb.functions.invoke('send-event-email', { body:{
      to: peSendTo(e.contact_email, sender), reply_to:sender, from_name:peSenderName(),
      subject: 'Your event proposal & agreement — Roberto’s'+(e.event_date?' · '+peDLabel(e.event_date):''),
      html: peGuestEmailHTML('Your Event Agreement', intro, e.contact_name||e.client_name, null, inner)
    }});
    if(r.error || (r.data&&r.data.error)) throw (r.error||r.data.error);
    if(peState.voided) delete peState.voided[id];   // re-sent — clear the void banner
    peToast('Sent to '+e.contact_email+' ✓ — the events desk is emailed the moment they sign');
    if(e.status==='draft') peSetStatus(id, 'sent');
    (peState.proposalSent = peState.proposalSent || {})[id] = new Date().toISOString();
    sb.from('event_log').insert({event_id:id, action:'email', detail:'proposal + agreement link → '+e.contact_email, actor:peActor()}).then(function(){ peLoadLog(id); });
  }catch(err){
    peToast('NOT sent — '+String(err&&err.message||err).slice(0,120), true);
  }
}

// Send the guest the Telr deposit payment link — only reachable once the event is
// signed AND a link has been pasted on the Agreement card. Named (email + amount),
// confirmed, and logged like every other send. Marking the deposit PAID stays the
// existing manual status flip — this only delivers the link.
async function peSendPaymentLink(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var e = peEvById(id); if(!e) return;
  if(!e.payment_link){ peScrollToCard('food'); peToast('Paste the Telr payment link on the Agreement card first', true); return; }
  if(!e.contact_email){ peScrollToField('contact_email','Add the client email to send the payment link'); return; }
  var dep = peDepositAmt(e);
  var sender = state.userEmail || 'reservations@robertos.ae';
  if(!(await peConfirm({title:'Send the payment link?',
      html:'Email the secure Telr payment link to <b>'+peEsc(e.contact_email)+'</b> to settle the <b>AED '+peMoney(dep)+'</b> deposit?<br><br>Marking the deposit as <b>paid</b> stays a manual step once the money lands.'+peCopyLine(sender),
      ok:'Send the link', cancel:'Not yet'}))) return;
  var intro = 'Thank you for confirming your event with Roberto’s'+(e.event_date?' on '+peDLabel(e.event_date):'')+'. To secure your booking, please settle the deposit of AED '+peMoney(dep)+' using the secure link below.';
  var inner = '<div style="text-align:center;margin:24px 0 10px"><a href="'+peEsc(e.payment_link)+'" style="display:inline-block;background:#400207;color:#E8D9C7;padding:12px 30px;border-radius:22px;text-decoration:none;font-size:13.5px;letter-spacing:1px">Pay the AED '+peMoney(dep)+' deposit</a></div>'+
    '<p style="font-size:12px;color:#4F4535;text-align:center">This opens Roberto’s secure card payment page. Your balance is settled on the day of the event.</p>';
  try{
    var r = await sb.functions.invoke('send-event-email', { body:{
      to: peSendTo(e.contact_email, sender), reply_to:sender, from_name:peSenderName(),
      subject:'Your deposit payment link — Roberto’s'+(e.event_date?' · '+peDLabel(e.event_date):''),
      html: peGuestEmailHTML('Your Deposit Payment', intro, e.contact_name||e.client_name, null, inner)
    }});
    if(r.error || (r.data&&r.data.error)) throw (r.error||r.data.error);
    peToast('Payment link sent to '+e.contact_email+' ✓');
    sb.from('event_log').insert({event_id:id, action:'payment_link', detail:'payment link (AED '+dep+' deposit) → '+e.contact_email, actor:peActor()}).then(function(){ peLoadLog(id); });
  }catch(err){
    peToast('NOT sent — '+String(err&&err.message||err).slice(0,120), true);
  }
}

// ── library (chef dishes / Manuel beverage / packages) ───────────────────────
function peRenderChefCorner(){
  var tab = peState.chefTab || 'canape';
  var h = peHeader('chef');
  // The count has to be the SAME count the library below prints, or the band is
  // a second version of the truth. Dishes: peRenderDishLib's own total.
  // The sentence that used to sit in grey under the tabs moves INTO the band --
  // same words, said once. Nothing is duplicated and nothing is invented.
  var lede, stand;
  if(tab==='set'){
    var nSet = peSetMenusLoaded() ? peSetMenusDesigned().length : 0;
    lede  = nSet ? (nSet + ' set menu' + (nSet===1?'':'s')) : 'Set menus';
    stand = 'Plated set menus — saved here they appear in the events desk booking dropdown, the guest proposal and the kitchen brief.';
  } else {
    var nDish = peState.dishes.filter(function(d){ return d.active; }).length;
    lede  = nDish ? (nDish + ' dish' + (nDish===1?'':'es') + ' in the library') : 'The dish library';
    stand = 'The kitchen’s home: add and update canapés — everything saved here is instantly available to the events desk and the guest menu.';
  }
  h += peRoom('chef', 'Chef corner', lede, stand);
  var tabs = [['canape','Canap\u00e9s'],['set','Set menus']];
  h += '<div class="pe-tabs" style="margin-bottom:12px">'+tabs.map(function(t){
    return '<span class="pe-tab'+(tab===t[0]?' on':'')+'" onclick="peState.chefTab=\''+t[0]+'\';renderMain()">'+t[1]+'</span>';
  }).join('')+'</div>';
  h += (tab==='set') ? peRenderSetMenuLib() : peRenderDishLib();
  return h+PE_FOOT;
}
function peRenderBevCorner(){
  var h = peHeader('bev');
  var nBev = peState.bevs.filter(function(b){ return b.active!==false; }).length;
  h += peRoom('bev', 'Beverage corner',
    nBev ? (nBev + ' package' + (nBev===1?'':'s')) : 'Beverage packages',
    'Manuel\u2019s home: beverage packages for events \u2014 name, hours, price per guest and what\u2019s included.');
  h += peRenderBevLib();
  return h+PE_FOOT;
}
function peRenderPacksView(){
  var tab = peState.packsTab || 'menus';
  var bevs = peState.bevs.filter(function(b){ return b.active!==false; });
  var h = peHeader('packs');
  // #15 — canapé packages are now a first-class tab (not a grey footer link).
  // Set menus + beverage stay on ONE screen so the guest still gets everything
  // ticked — a set menu, a few beverage packages, or a mix — in ONE email, one tap.
  var tabs = [['menus','Set menus & beverage'],['canape','Canapé packages'],['alacarte','À la carte'],['custom','Customise a menu']];
  h += '<div class="pe-tabs" style="margin-bottom:12px">'+tabs.map(function(t){
    return '<span class="pe-tab'+(tab===t[0]?' on':'')+'" onclick="peState.packsTab=\''+t[0]+'\';renderMain()">'+t[1]+'</span>';
  }).join('')+'</div>';
  if(tab==='canape'){
    h += '<div style="font-size:12px;color:#4F4535;margin-bottom:10px">Ready-made canapé packages (like Canape Cortile) that start a quotation in one tap from an event’s Food card.</div>';
    h += peRenderPackLib();
    return h+PE_FOOT;
  }
  if(tab==='alacarte'){ h += peRenderAlaCarte(); return h+PE_FOOT; }
  if(tab==='custom'){ h += peRenderCustomise(); return h+PE_FOOT; }
  h += '<div style="font-size:12px;color:#4F4535;margin-bottom:10px">Tick anything below — a set menu, dishes from the à la carte, beverage packages, or a mix — and the guest receives it all in ONE branded email, or one WhatsApp with one link.</div>';
  // The canapé link stays where she has always found it — on Guest link. No
  // second copy of it here; one thing in one place.
  h += '<div class="pe-card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="color:#400207">Food packages — the set menus</b>'+peSelLinks('food')+'</div>'+
    '<div style="font-size:11px;color:#4F4535;margin:2px 0 8px">Open any menu to see the designed PDF — the email carries a button to each ticked menu.</div>'+
    peSetMenusPickInc().map(function(m){
      return '<div class="pe-dishrow"><span><label style="cursor:pointer"><input type="checkbox" class="pe-mp-check" data-kind="food" data-key="'+m.key+'" onchange="peMpCount()" style="accent-color:#400207;margin-right:8px;vertical-align:-2px">'+
        '<b>'+peEsc(m.name)+'</b>'+(m.price!=null?' · AED '+m.price+' / person':' · <span style="background:#FAEEDA;color:#854F0B;font-size:10.5px;padding:1px 8px;border-radius:20px">price on the proposal</span>')+'</label><br>'+
        '<span style="font-size:11px;color:#4F4535">'+peEsc(m.line||peSmSummary(m.courses))+'</span></span>'+
        '<span style="display:flex;gap:6px;flex-shrink:0">'+
        '<button class="pe-btn sec sm" onclick="peWaShareMenu(\''+peSmEsc(m.key)+'\')">WhatsApp</button>'+
        (m.pdf?'<button class="pe-btn sec sm" onclick="window.open(\''+m.pdf+'\',\'_blank\')">Open PDF</button>':'')+'</span></div>';
    }).join('')+'</div>';
  // The menus Valentina built herself. They are kept out of the designed list
  // above on purpose, but she still has to be able to SEND one — this is that
  // door. Ticks travel through exactly the same email and WhatsApp path.
  var mine = peSetMenusAll().filter(function(m){ return peSmIsCustom(m) && m.active!==false; });
  if(mine.length){
    h += '<div class="pe-card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="color:#400207">Menus you customised</b>'+peSelLinks('food')+'</div>'+
      '<div style="font-size:11px;color:#4F4535;margin:2px 0 8px">Built in “Customise a menu”. Tick one to send it exactly like a set menu.</div>'+
      mine.map(function(m){
        var ev = m.eventId ? peEvById(m.eventId) : null;
        return '<div class="pe-dishrow"><span><label style="cursor:pointer"><input type="checkbox" class="pe-mp-check" data-kind="food" data-key="'+m.key+'"'+(peState.mpPreTick===m.key?' checked':'')+' onchange="peMpCount()" style="accent-color:#400207;margin-right:8px;vertical-align:-2px">'+
          '<b>'+peEsc(m.name)+'</b>'+(m.price!=null?' · AED '+peMoney(m.price)+' / person':' · <span style="background:#FAEEDA;color:#854F0B;font-size:10.5px;padding:1px 8px;border-radius:20px">price on the proposal</span>')+'</label><br>'+
          '<span style="font-size:11px;color:#4F4535">'+
          (m.basedOn?'from '+peEsc((peSetMenuByKey(m.basedOn)||{name:m.basedOn}).name)+' · ':'')+
          (ev?peEsc(ev.client_name||'a booking'):'not on a booking')+' · '+peEsc(peSmSummary(m.courses))+'</span></span>'+
          '<span style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">'+
          '<button class="pe-btn sec sm" onclick="peCmOpen(\''+peSmEsc(m.key)+'\')">View</button>'+
          '<button class="pe-btn sec sm" onclick="peCmPrintMenu(\''+peSmEsc(m.key)+'\')">Print / PDF</button>'+
          '<button class="pe-btn sec sm" onclick="peWaShareMenu(\''+peSmEsc(m.key)+'\')">WhatsApp</button>'+
          (ev?'<button class="pe-btn sec sm" onclick="peGo(\'event\',\''+m.eventId+'\')">Booking</button>':'')+
          '<button class="pe-btn sec sm" style="color:#B00020;border-color:#B00020" onclick="peCmDelete(\''+peSmEsc(m.key)+'\')">Delete</button>'+
          '</span></div>';
      }).join('')+'</div>';
  }
  // Katarina, 8 Aug 2026: the canapé packages had their own tab and no way onto a
  // send. A canapé reception with a beverage package is the most common shape of
  // enquiry she answers, so it has to travel in the SAME one email, ticked here
  // beside the set menus — not as a second message the guest has to join up.
  var packs = (peState.packs||[]).filter(function(p){ return p.active!==false; });
  if(packs.length){
    h += '<div class="pe-card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="color:#400207">Canapé packages</b>'+peSelLinks('pack')+'</div>'+
      '<div style="font-size:11px;color:#4F4535;margin:2px 0 8px">The reception canapés — the email lists every canapé in the package. Build and edit them under “Canapé packages”.</div>'+
      packs.map(function(p){
        var names = (p.dish_ids||[]).map(function(id){ var d=peDishById(id); return d?d.name:null; }).filter(Boolean);
        return '<div class="pe-dishrow"><span><label style="cursor:pointer"><input type="checkbox" class="pe-mp-check" data-kind="pack" data-key="'+p.id+'" onchange="peMpCount()" style="accent-color:#400207;margin-right:8px;vertical-align:-2px">'+
          '<b>'+peEsc(p.name)+'</b>'+(p.price_pp!=null?' · AED '+peMoney(p.price_pp)+' / guest':' · <span style="background:#FAEEDA;color:#854F0B;font-size:10.5px;padding:1px 8px;border-radius:20px">price on the proposal</span>')+'</label><br>'+
          '<span style="font-size:11px;color:#4F4535">'+(names.length?peEsc(names.join(' · ')):'No canapés on this package yet')+'</span></span>'+
          '<span style="display:flex;gap:6px;flex-shrink:0">'+
          (peCanEdit()?'<button class="pe-btn sec sm" onclick="peState.packsTab=\'canape\';peState.editPackId=\''+p.id+'\';renderMain()">Edit</button>':'')+
          '</span></div>';
      }).join('')+'</div>';
  }
  // À la carte, tickable dish by dish. Valentina (30 Jul): a guest wants to see
  // the à la carte and say what they'd like — she picks what goes on the link,
  // with or without prices, and the guest ticks from exactly that.
  if(peState.alacarteOk && peAlcAll().length){
    h += '<div class="pe-card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="color:#400207">À la carte</b>'+peSelLinks('alc')+'</div>'+
      '<div style="font-size:11px;color:#4F4535;margin:2px 0 8px">Tick the dishes to put in front of the guest — a whole section or a handful. They can tick what they’d like and send it back to you.</div>';
    peAlcSections().forEach(function(s){
      var rows = peAlcAll().filter(function(a){ return a.section===s; });
      if(!rows.length) return;
      h += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin:10px 0 2px">'+
        '<span style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#544418">'+peEsc(peAlcSecLabel(s))+'</span>'+
        '<span style="font-size:11px;color:#4F4535;text-decoration:underline;cursor:pointer" onclick="peMpSelectSection(\''+peSmEsc(s)+'\')">tick this section</span></div>';
      rows.forEach(function(a){
        h += '<div class="pe-dishrow"><span><label style="cursor:pointer"><input type="checkbox" class="pe-mp-check" data-kind="alc" data-key="'+a.id+'" data-section="'+peEsc(a.section)+'" onchange="peMpCount()" style="accent-color:#400207;margin-right:8px;vertical-align:-2px">'+
          '<b>'+peEsc(a.name)+'</b>'+((a.allergens&&a.allergens.length)?' <span style="color:#574232;font-size:10px">('+a.allergens.join(')(')+')</span>':'')+
          ' · '+peEsc(peAlcPriceText(a))+'</label>'+
          (a.description?'<br><span style="font-size:11px;color:#4F4535">'+peEsc(a.description)+'</span>':'')+'</span></div>';
      });
    });
    h += '</div>';
  }
  h += '<div class="pe-card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="color:#400207">Beverage packages</b>'+peSelLinks('bev')+'</div>'+
    '<div style="font-size:11px;color:#4F4535;margin:2px 0 8px">Guest prices only — costs never leave the Beverage corner.</div>'+
    (bevs.length?bevs.map(function(b){
      return '<div class="pe-dishrow"><span><label style="cursor:pointer"><input type="checkbox" class="pe-mp-check" data-kind="bev" data-key="'+b.id+'" onchange="peMpCount()" style="accent-color:#400207;margin-right:8px;vertical-align:-2px">'+
        '<b>'+peEsc(b.name)+'</b>'+(b.duration_hours?' · '+b.duration_hours+'h':'')+(b.price_pp!=null?' · AED '+peMoney(b.price_pp)+' / guest':' · price on the proposal')+'</label><br>'+
        '<span style="font-size:11px;color:#4F4535">'+peEsc(b.includes||'')+'</span></span>'+
        (b.pdf?'<span style="display:flex;gap:6px;flex-shrink:0"><button class="pe-btn sec sm" onclick="window.open(\''+b.pdf+'\',\'_blank\')">Open PDF</button></span>':'')+'</div>';
    }).join(''):'<div style="font-size:12px;color:#4F4535">No packages yet — Manuel adds them in the Beverage corner.</div>')+'</div>';
  h += peMenuPackEmailForm();
  // Arriving from "Email" on a customised menu, the box is already ticked —
  // but the summary line and the Send button only update on a change event, so
  // without this they would say "nothing ticked" over a ticked box and stay
  // disabled. Run the count once the markup is in the DOM, then forget the
  // pre-tick so it does not re-tick on every later visit.
  if(peState.mpPreTick){
    peState.mpPreTick = null;
    setTimeout(function(){ if(typeof peMpCount==='function') peMpCount(); }, 0);
  }
  return h+PE_FOOT;
}
// ── à la carte ───────────────────────────────────────────────────────────────
// The printed menu (event_alacarte, seeded from the June 2026 PDF and price-
// checked against Simphony) inside the app, for two reasons: Valentina can
// quote a dish without hunting for the PDF, and "Customise a menu" has a real
// priced dish list to swap from instead of a free-text note.
var PE_ALC_ORDER = ['CRUDO BAR','ROBERTO’S SELECTION','INSALATE','ANTIPASTI','PIZZE','PASTE E RISO',
  'SECONDI DI PESCE','LA VIA DEL SALE','DAL BANCO','SECONDI DI CARNE','DALLA NOSTRA GRIGLIA JOSPER',
  'CONTORNI CALDI','DOLCI'];
function peAlcAll(){
  return (peState.alacarte||[]).filter(function(a){ return a.active!==false; });
}
function peAlcById(id){
  var all = peAlcAll();
  for(var i=0;i<all.length;i++) if(String(all[i].id)===String(id)) return all[i];
  return null;
}
// The number to quote. A caviar row is priced by weight (tiers) and a market-
// price row has no number at all — both return null, so nothing downstream can
// silently treat "no price" as zero.
function peAlcPrice(a){
  if(!a) return null;
  if(a.price!=null && a.price!=='') return Number(a.price);
  return null;
}
function peAlcPriceText(a){
  if(!a) return '';
  if(a.tiers && a.tiers.length) return a.tiers.map(function(t){ return t.size+' AED '+peMoney(t.price); }).join(' · ');
  if(a.market_price) return 'Market price';
  var p = peAlcPrice(a);
  if(p==null) return 'no price';
  return 'AED '+peMoney(p)+(a.unit==='per piece' ? ' per piece' : '');
}
function peAlcSections(){
  var seen = {}, out = [];
  peAlcAll().forEach(function(a){ if(!seen[a.section]){ seen[a.section]=1; out.push(a.section); } });
  return out.sort(function(x,y){
    var i = PE_ALC_ORDER.indexOf(x), j = PE_ALC_ORDER.indexOf(y);
    return (i<0?99:i)-(j<0?99:j);
  });
}
function peAlcFiltered(){
  var q = String(peState.alcQ||'').trim().toLowerCase();
  var sec = peState.alcSec||'';
  return peAlcAll().filter(function(a){
    if(sec && a.section!==sec) return false;
    if(!q) return true;
    return (a.name+' '+(a.description||'')+' '+a.section).toLowerCase().indexOf(q)>=0;
  });
}
// Same caret rule as the events search — keep her cursor where she put it.
function peAlcQ(v, pos){
  peState.alcQ = v; renderMain();
  var el = document.getElementById('pe-alc-q');
  if(el){ el.focus(); try{ var p = (pos==null?el.value.length:pos); el.setSelectionRange(p,p); }catch(e){} }
}
function peAlcSec(v){ peState.alcSec = v; renderMain(); }
// What guests have ticked on an à la carte link. A reply that lands nowhere is
// worse than no reply, so it sits at the top of the screen the dishes live on.
function peAlcPicksHTML(){
  var picks = peState.alcPicks || [];
  if(!picks.length) return '';
  return '<div class="pe-card" style="border-color:#C9A84C;background:#FBF6EA">'+
    '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">'+
    '<b style="color:#400207">Guests have chosen dishes</b>'+
    '<span style="font-size:11px;color:#4F4535;text-decoration:underline;cursor:pointer" onclick="peAlcLoadPicks(true)">refresh</span></div>'+
    picks.map(function(p){
      var c = p.choices||{};
      var ev = (peState.events||[]).filter(function(e){ return e.client_token===p.token; })[0];
      return '<div class="pe-dishrow"><span><b style="color:#400207">'+peEsc((c.guest||(ev&&ev.client_name)||'A guest'))+'</b>'+
        ' <span style="font-size:11px;color:#4F4535">'+peEsc(peWhenLabel(p.created_at))+'</span>'+
        '<br><span style="font-size:12px;color:#6B4A33">'+peEsc((c.dishes||[]).join(' · '))+'</span>'+
        (p.note?'<br><span style="font-size:11.5px;color:#B00020">“'+peEsc(p.note)+'”</span>':'')+
        '</span>'+
        '<span style="display:flex;gap:6px;flex-shrink:0">'+
        // A note on an à la carte reply is usually an allergy, and it had no way of
        // reaching the kitchen — the brief prints e.dietary, and nothing copied it
        // there, so it depended on her retyping it by hand.
        (ev && p.note ? '<button class="pe-btn sm" onclick="peAlcNoteToDietary(\''+p.id+'\')">Add note to dietary</button>' : '')+
        (ev?'<button class="pe-btn sec sm" onclick="peGo(\'event\',\''+ev.id+'\')">Open booking</button>':'')+
        '<button class="pe-btn sec sm" onclick="peAlcPickDone(\''+p.id+'\')">Done with it</button></span></div>';
    }).join('')+'</div>';
}
// Copy a guest's note into the booking's Dietary requirements, which is the field
// the kitchen brief prints in red. Appends rather than replaces — she may already
// have typed something there, and losing it would be worse than the original bug.
async function peAlcNoteToDietary(pickId){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var p = (peState.alcPicks||[]).filter(function(x){ return x.id===pickId; })[0];
  if(!p || !p.note) return;
  var e = (peState.events||[]).filter(function(x){ return x.client_token===p.token; })[0];
  if(!e){ peToast('No booking matches this reply — open it and pick one first', true); return; }
  var line = 'Guest: '+String(p.note).trim();
  var existing = String(e.dietary||'').trim();
  if(existing.indexOf(line) >= 0){ peToast('Already on the booking ✓'); return; }
  var merged = existing ? existing+' · '+line : line;
  if(!(await peConfirm({title:'Add this to the kitchen brief?',
    html:'This copies the guest’s note into <b>Dietary requirements</b> on <b>'+peEsc(e.client_name||e.company||'this booking')+'</b>, which prints in red on the kitchen brief.'+
      '<br><br><b>'+peEsc(merged)+'</b>'+
      (peBriefSent(e) ? '<br><br><span style="color:#7A5500">The team already has a brief for this event — you will need to re-send it.</span>' : ''),
    ok:'Add it', cancel:'Not now'}))) return;
  var r = await sb.from('events_desk').update({dietary:merged, updated_at:new Date().toISOString()}).eq('id', e.id);
  if(r.error){ peToast('NOT saved — '+String(r.error.message||'').slice(0,80), true); return; }
  e.dietary = merged;
  sb.from('event_log').insert({event_id:e.id, action:'edited',
    detail:('Dietary → '+merged).slice(0,400), actor:peActor()});
  peToast('Added to dietary ✓ — it prints on the kitchen brief');
  renderMain();
}
async function peAlcLoadPicks(force){
  if(peState.alcPicksLoaded && !force) return;
  var r = await sb.from('event_menu_choices').select('*').eq('menu_key','alacarte').eq('applied', false)
    .order('created_at',{ascending:false}).limit(30);
  // supabase-js does NOT throw — a failure comes back as r.error. This used to set
  // the loaded flag BEFORE the query and had no else, so a failed read looked
  // exactly like "no guest has replied yet", and the flag then blocked every retry
  // for the rest of the session. Only mark it loaded once it actually worked.
  if(r.error){
    peToast('Could not check for guest picks — ' + String(r.error.message||'').slice(0,80), true);
    return;
  }
  peState.alcPicksLoaded = true;
  peState.alcPicks = r.data||[];
  renderMain();
}
// "Done with it" clears the card — applied=true is the same flag the set-menu
// choices already use, so nothing new had to be invented to track it.
async function peAlcPickDone(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var r = await sb.from('event_menu_choices').update({applied:true}).eq('id', id);
  if(r.error){ peToast('Could not clear it — '+String(r.error.message||'').slice(0,90), true); return; }
  peState.alcPicks = (peState.alcPicks||[]).filter(function(p){ return String(p.id)!==String(id); });
  peToast('Cleared ✓');
  renderMain();
}
function peRenderAlaCarte(){
  peAlcLoadPicks();
  if(!peState.alacarteOk){
    return '<div class="pe-card"><b style="color:#400207">À la carte</b>'+
      '<div style="font-size:12.5px;color:#8A2A1A;background:#FBE9E7;border-radius:8px;padding:10px 12px;margin-top:8px">'+
      'The à la carte isn’t loaded yet — <b>foh-events-alacarte.sql</b> still needs to be run on the FOH database. '+
      'Nothing else is affected: set menus, canapés and beverage all work as normal.</div></div>';
  }
  var rows = peAlcFiltered();
  var secs = peAlcSections();
  var h = peAlcPicksHTML();
  h += '<div style="font-size:12px;color:#4F4535;margin-bottom:10px">Roberto’s à la carte, June 2026 — every price checked against the POS. '+
    'This is the list “Customise a menu” swaps from, so a dish added to a menu carries its real price.</div>';
  h += '<div class="pe-card"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
    '<input class="pe-in" id="pe-alc-q" style="flex:1;min-width:180px" placeholder="Search a dish — e.g. burrata, branzino, truffle" value="'+peEsc(peState.alcQ||'')+'" oninput="peAlcQ(this.value, this.selectionStart)">'+
    '<select class="pe-in" style="width:auto" onchange="peAlcSec(this.value)"><option value="">Every section</option>'+
      secs.map(function(s){ return '<option value="'+peEsc(s)+'"'+(peState.alcSec===s?' selected':'')+'>'+peEsc(peAlcSecLabel(s))+'</option>'; }).join('')+
    '</select>'+
    '<span style="font-size:11.5px;color:#4F4535">'+rows.length+' of '+peAlcAll().length+' dishes</span>'+
  '</div></div>';
  if(!rows.length){
    h += '<div class="pe-card"><div style="font-size:12px;color:#4F4535">No dish matches that. Clear the search to see the whole menu.</div></div>';
    return h;
  }
  var cur = null;
  h += '<div class="pe-card">';
  secs.forEach(function(s){
    var inSec = rows.filter(function(a){ return a.section===s; });
    if(!inSec.length) return;
    h += '<div style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#544418;margin:12px 0 4px">'+peEsc(peAlcSecLabel(s))+'</div>';
    inSec.forEach(function(a){
      h += '<div class="pe-dishrow"><span><b style="font-weight:600;color:#400207">'+peEsc(a.name)+'</b>'+
        (a.sub?' <span style="font-size:10px;color:#574232">'+peEsc(a.sub)+'</span>':'')+
        ((a.allergens&&a.allergens.length)?' <span style="color:#574232;font-size:10px">('+a.allergens.join(')(')+')</span>':'')+
        '<br><span style="font-size:11px;color:#4F4535">'+peEsc(a.description||'')+'</span>'+
        (a.price_note?'<br><span style="font-size:11px;color:#B00020">'+peEsc(a.price_note)+'</span>':'')+
        '</span>'+
        '<span style="flex-shrink:0;text-align:right"><b style="font-size:12.5px;color:'+(peAlcPrice(a)==null?'#8A6A4F':'#400207')+'">'+peEsc(peAlcPriceText(a))+'</b></span></div>';
    });
  });
  h += '</div>';
  return h;
}
// "DALLA NOSTRA GRIGLIA JOSPER" shouted in a dropdown is not how anyone reads a
// menu — Title Case it for the screen, leave the stored value alone. Italian
// connectives stay lowercase the way the printed menu sets them, and a letter
// after an apostrophe is never capitalised (Roberto’s, not Roberto’S).
var PE_ALC_MINOR = {e:1, di:1, del:1, della:1, la:1, le:1, il:1, al:1, alla:1, allo:1,
                    con:1, da:1, dal:1, nostra:1, nostro:1, in:1, a:1};
function peAlcSecLabel(s){
  return String(s||'').toLowerCase().split(/\s+/).map(function(w, i){
    if(i && PE_ALC_MINOR[w]) return w;
    return w.replace(/^([a-zà-ÿ])/, function(m,c){ return c.toUpperCase(); });
  }).join(' ');
}

// ── customise a menu ─────────────────────────────────────────────────────────
// Valentina, 30 Jul 2026: a guest takes the Mare set menu but wants two dishes
// from the à la carte instead. Until now the only channel was a free-text note,
// so she typed the dish from memory, priced the difference by hand, and the swap
// reached the guest as prose at the bottom of the proposal.
//
// This builder starts from ANY set menu (or from nothing), swaps and adds from
// the priced à la carte, and saves the result as a normal event_set_menus row
// flagged is_custom. That flag is the whole trick: the proposal, the kitchen
// brief, the coordination email, the guest menu page and the per-guest price
// override all resolve it through peSetMenuByKey and need no change at all.
//
// A line remembers where it came from (from:'set' | 'alacarte'), what it
// replaced (out), and its supplement — so the price is never a mystery number
// and the kitchen brief can say "instead of".
function peCmStart(basedOnKey, eventId){
  var ev = eventId ? peEvById(eventId) : null;
  var base = basedOnKey ? peSetMenuByKey(basedOnKey) : null;
  peState.cm = {
    basedOn: base ? base.key : null,
    basePrice: base ? base.price : null,
    baseName: base ? base.name : '',
    name: base ? (base.name+' — customised') : 'Customised menu',
    priceMode: base && base.price!=null ? 'supplement' : 'sum',
    eventId: eventId || null,
    guests: ev && ev.guests!=null ? ev.guests : null,
    // Start from the note the booking already carries — usually the guest's own
    // "need 3 vegan". Opening blank is how it got retyped, or lost.
    note: (ev && ev.set_menu && ev.set_menu.note) ? String(ev.set_menu.note) : '',
    priceOverride: null,
    courses: (base ? base.courses : []).map(function(c){
      // Carry the base menu's OWN descriptions. They are authored for that menu
      // (Mare's burrata is "Apulian burrata, Roberto's tomatoes selection and
      // basil", which is not what the à la carte says) and they cover dishes
      // the à la carte does not have at all, like Bresaola and Ribeye di Angus.
      var dsc = c.desc||{};
      return {
        name: c.name||'Course',
        choose: !!c.choose,
        lines: ((c.choose ? c.options : c.items)||[]).map(function(n){
          // The allergens travel separately from the prose now, so the editor
          // has to carry both. Reading only the text would drop the allergens
          // of every dish she keeps from the base menu.
          var a = peAlgOf(c, n);
          return { name:n, from:'set', price:null, supplement:0, out:null, alcId:null,
                   inherited: dsc[n]||'', inheritedAlg: a.known ? a.list : null };
        })
      };
    })
  };
  if(!peState.cm.courses.length) peCmAddCourse(true);
  peState.packsTab = 'custom';
  // peGo, not renderMain: this is called from the Quick menu and from an
  // event's Food card, and setting the tab without changing the VIEW just
  // re-drew the screen she was already on.
  peGo('packs');
}
// Carry a quick menu into the builder: the canapés she has already counted
// become courses grouped the way the kitchen works (cold, hot, dolci), the
// à la carte portions become their own courses by menu section, and every line
// keeps its real price — so "reprice from every dish" gives a true number the
// moment she opens it, and she can then swap, add or overwrite the price.
// The quick menu as courses: canapés grouped the way the kitchen works, then
// the à la carte by menu section. Shared by "turn this into a menu she can
// edit" and by the WhatsApp send, so the guest sees the same shape either way.
function peQuickCourses(){
  var courses = [];
  var groups = [['Cold','Cold'],['Hot','Hot'],['Dessert','Dolci']];
  groups.forEach(function(g){
    var lines = peState.dishes.filter(function(d){
      return d.active && d.serve===g[0] && (Number(peQuick.qty[d.id])||0)>0;
    }).map(function(d){
      return { name:d.name, from:'canape', price:(Number(d.sell_price)||null),
               supplement:0, out:null, alcId:null, added:true, suggested:false, diff:null, forGuests:null };
    });
    if(lines.length) courses.push({ name:g[1], choose:false, lines:lines });
  });
  var bySection = {};
  peQuickAlcLines().forEach(function(l){
    (bySection[l.a.section] = bySection[l.a.section] || []).push(l.a);
  });
  peAlcSections().forEach(function(s){
    if(!bySection[s]) return;
    courses.push({ name: peAlcSecLabel(s), choose:false,
      lines: bySection[s].map(function(a){
        return { name:a.name, from:'alacarte', price:peAlcPrice(a), alcId:a.id,
                 supplement:0, out:null, added:true, suggested:false, diff:null, forGuests:null };
      }) });
  });
  return courses;
}
function peCmFromQuick(){
  peQuickRead();
  var tt = peQuickTotals();
  var courses = peQuickCourses();
  peState.cm = {
    basedOn:null, basePrice:null, baseName:'',
    name: peQuick.title || 'Customised menu',
    priceMode:'sum',
    eventId:null,
    guests: tt.guests || null,
    note:'',
    // The quick menu already worked out a per-guest price — carry it, so she
    // starts from the number she was just looking at rather than a blank.
    priceOverride: (tt.perGuest!=null && tt.guests) ? Math.round(tt.perGuest) : null,
    courses: courses
  };
  if(!courses.length) peCmAddCourse(true);
  peState.packsTab = 'custom';
  peGo('packs');
}
function peCmAddCourse(quiet){
  if(!peState.cm) return;
  peState.cm.courses.push({ name:'', choose:false, lines:[] });
  if(!quiet) renderMain();
}
function peCmRemoveCourse(i){
  if(!peState.cm) return;
  peState.cm.courses.splice(i,1); renderMain();
}
function peCmSet(field, v){
  if(!peState.cm) return;
  if(field==='guests' || field==='priceOverride') v = (v===''||v==null) ? null : Number(v);
  peState.cm[field] = v;
  renderMain();
}
function peCmCourse(i, field, v){
  if(!peState.cm || !peState.cm.courses[i]) return;
  peState.cm.courses[i][field] = (field==='choose') ? !!v : v;
  renderMain();
}
function peCmRemoveLine(ci, li){
  if(!peState.cm || !peState.cm.courses[ci]) return;
  peState.cm.courses[ci].lines.splice(li,1); renderMain();
}
function peCmSupp(ci, li, v){
  var l = peState.cm && peState.cm.courses[ci] && peState.cm.courses[ci].lines[li];
  if(!l) return;
  l.supplement = (v===''||v==null) ? 0 : Number(v);
  renderMain();
}
// Swap a line for an à la carte dish. The supplement is SUGGESTED as the price
// difference against the dish going out — and only when both numbers are real.
// Guessing a supplement from a dish with no price is how a menu goes out
// underpriced, so an unpriced swap suggests nothing and says so.
function peCmSwap(ci, li, alcId){
  var l = peState.cm && peState.cm.courses[ci] && peState.cm.courses[ci].lines[li];
  var a = peAlcById(alcId);
  if(!l || !a) return;
  var outName = l.out || l.name;
  var kind = peCmCourseKind(peState.cm.courses[ci]);
  var outMatch = l.from==='alacarte' ? null : peCmMatchAlc(outName, kind);
  var outPrice = l.from==='alacarte' ? l.price : (outMatch ? peAlcPrice(outMatch) : null);
  var inPrice = peAlcPrice(a);
  l.out = outName;
  l.name = a.name;
  l.from = 'alacarte';
  l.alcId = a.id;
  l.price = inPrice;
  l.diff = (inPrice!=null && outPrice!=null) ? Math.max(0, inPrice-outPrice) : null;
  l.forGuests = null;
  // A swap does NOT move the price. Valentina asked for this explicitly: a
  // guest on the Mare menu who swaps a dish stays on AED 440 unless SHE decides
  // otherwise. The à la carte difference is worked out and offered — one tap to
  // apply it — but never imposed, because the price is a commercial decision
  // and the app does not get to make it.
  l.supplement = 0;
  l.suggested = (l.diff!=null);
  // Name what the difference was worked out against, so she can sanity-check
  // the supplement instead of trusting it.
  l.outPricedAs = outMatch ? (outMatch.name+' AED '+peMoney(peAlcPrice(outMatch))) : null;
  renderMain();
}
// The price on an event is ONE number per guest, so a supplement typed against
// a "guests choose one" course is charged to everybody. If a wagyu is taken by
// 4 of 20 guests, charging all 20 the full AED 327 difference overcharges the
// bill by a factor of five. She tells the app how many take it and the app does
// the division — she never does the arithmetic herself.
// Take the offered difference (or drop it again). Nothing else in the builder
// writes the supplement on its own.
function peCmApplyDiff(ci, li, on){
  var cm = peState.cm;
  var l = cm && cm.courses[ci] && cm.courses[ci].lines[li];
  if(!l || l.diff==null) return;
  if(!on){ l.supplement = 0; l.forGuests = null; }
  else l.supplement = (l.forGuests!=null && cm.guests)
    ? Math.round(l.diff * l.forGuests / Number(cm.guests))
    : l.diff;
  renderMain();
}
function peCmForGuests(ci, li, v){
  var cm = peState.cm;
  var l = cm && cm.courses[ci] && cm.courses[ci].lines[li];
  if(!l) return;
  var n = (v===''||v==null) ? null : Number(v);
  l.forGuests = n;
  // Only re-divides a supplement she has already chosen to charge. If the swap
  // is free of charge it stays free of charge.
  if(l.diff!=null && Number(l.supplement)>0){
    l.supplement = (n!=null && cm.guests)
      ? Math.round(l.diff * n / Number(cm.guests))
      : l.diff;
  }
  renderMain();
}
function peCmAddDish(ci, alcId){
  var c = peState.cm && peState.cm.courses[ci];
  var a = peAlcById(alcId);
  if(!c || !a) return;
  // Same rule as a swap: adding a dish does not move the price by itself. Its
  // à la carte price is offered as the supplement, one tap away.
  c.lines.push({ name:a.name, from:'alacarte', price:peAlcPrice(a), alcId:a.id,
                 supplement:0, diff:peAlcPrice(a), forGuests:null, out:null, added:true,
                 suggested:(peAlcPrice(a)!=null) });
  renderMain();
}
function peCmAddLine(ci){
  var c = peState.cm && peState.cm.courses[ci];
  if(!c) return;
  c.lines.push({ name:'', from:'set', price:null, supplement:0, out:null, alcId:null });
  renderMain();
}
function peCmLineName(ci, li, v){
  var l = peState.cm && peState.cm.courses[ci] && peState.cm.courses[ci].lines[li];
  if(!l) return;
  l.name = v;
}
// A set menu prices the whole menu, never a dish — so to suggest a supplement
// we have to value the dish going OUT, and the only honest source for that is
// the à la carte. The catch: the set menus name dishes short ("Ribeye di
// Angus", "Il Bosco truffle risotto") and the à la carte names them long
// ("Costata di Angus (300g)", "Il Bosco"). An exact match therefore almost
// never fires, which made every suggested supplement come out as zero.
//
// peCmMatchAlc matches on distinctive words, and prefers a dish that can
// actually fill this course, so a "Branzino" secondo values against the
// AED 220 secondo and not the AED 115 carpaccio. It returns the ROW, so the
// screen can name the dish it priced from — a suggestion the user can check is
// worth far more than a number that appears from nowhere.
var PE_CM_STOP = {di:1,de:1,del:1,della:1,dello:1,al:1,alla:1,allo:1,con:1,e:1,la:1,le:1,il:1,
                  su:1,in:1,a:1,and:1,the:1,of:1,con2:1,una:1,come:1,'nostra':1};
function peCmNorm(s){
  return String(s||'')
    .replace(/[’']/g,'')
    .normalize ? String(s||'').replace(/[’']/g,'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
               : String(s||'').toLowerCase();
}
function peCmTokens(s){
  return peCmNorm(s).replace(/\([^)]*\)/g,' ').replace(/[0-9]+\s*(g|kg|gr)\b/g,' ')
    .split(/[^a-z]+/).filter(function(w){ return w.length>2 && !PE_CM_STOP[w]; });
}
function peCmMatchAlc(name, courseKind){
  var want = peCmTokens(name);
  if(!want.length) return null;
  var wantKey = want.join(' ');
  var best = null, bestScore = 0;
  peAlcAll().forEach(function(a){
    var got = peCmTokens(a.name);
    if(!got.length) return;
    var score = 0;
    if(got.join(' ')===wantKey) score = 100;
    else {
      var shared = want.filter(function(w){ return got.indexOf(w)>=0; });
      if(!shared.length) return;
      var subset = shared.length===want.length || shared.length===got.length;
      // A single shared word is only convincing when it is the distinctive one
      // (angus, branzino, melanzane) — not a generic one like "pasta".
      var longest = shared.reduce(function(m,w){ return Math.max(m,w.length); }, 0);
      if(shared.length===1 && longest<5 && !subset) return;
      score = (subset?50:0) + shared.length*10 + longest;
    }
    if(courseKind && a.course===courseKind) score += 25;
    if(score>bestScore){ bestScore = score; best = a; }
  });
  return bestScore>=20 ? best : null;
}
function peCmSetDishPrice(name, courseKind){
  var hit = peCmMatchAlc(name, courseKind);
  return hit ? peAlcPrice(hit) : null;
}
function peCmTotals(){
  var cm = peState.cm;
  if(!cm) return null;
  var supp = 0, sum = 0, unpriced = [], swaps = [], adds = [];
  cm.courses.forEach(function(c){
    var kind = peCmCourseKind(c);
    c.lines.forEach(function(l){
      if(!String(l.name||'').trim()) return;
      supp += Number(l.supplement)||0;
      // Anything that came from a priced library — the à la carte or the canapé
      // list — carries its own price. Only a line inherited from the set menu
      // has to be valued by looking it up.
      if(l.from!=='set'){
        if(l.price==null) unpriced.push(l.name); else sum += Number(l.price);
        (l.added ? adds : swaps).push({ course:c.name, name:l.name, out:l.out||null,
          price:(l.price==null?null:Number(l.price)), supplement:Number(l.supplement)||0 });
      } else {
        var p = peCmSetDishPrice(l.name, kind);
        if(p==null) unpriced.push(l.name); else sum += p;
      }
    });
  });
  var base = cm.basePrice!=null ? Number(cm.basePrice) : null;
  var computed = cm.priceMode==='supplement'
    ? (base!=null ? base+supp : null)
    : (unpriced.length ? null : sum);
  var price = cm.priceOverride!=null ? Number(cm.priceOverride) : computed;
  return { base:base, supp:supp, sum:sum, unpriced:unpriced, computed:computed,
           price:price, swaps:swaps, adds:adds };
}
function peRenderCustomise(){
  var ce = peCanEdit();
  var h = '';
  if(!peState.alacarteOk){
    return '<div class="pe-card"><b style="color:#400207">Customise a menu</b>'+
      '<div style="font-size:12.5px;color:#8A2A1A;background:#FBE9E7;border-radius:8px;padding:10px 12px;margin-top:8px">'+
      'This needs the à la carte, and it isn’t loaded yet — <b>foh-events-alacarte.sql</b> still needs to be run on the FOH database. '+
      'Until then, use the “Menu changes agreed with the guest” note on the event’s Food card: it already reaches the proposal and the kitchen brief.</div></div>';
  }
  if(!ce){
    return '<div class="pe-card"><b style="color:#400207">Customise a menu</b>'+
      '<div style="font-size:12px;color:#4F4535;margin-top:8px">Building menus is for the events desk — you can browse the à la carte and the set menus.</div></div>';
  }
  var cm = peState.cm;
  if(!cm){
    h += '<div style="font-size:12px;color:#4F4535;margin-bottom:10px">A guest takes a set menu but wants dishes from the à la carte instead — start from that menu, swap what they asked for, and the price, the proposal and the kitchen brief all follow.</div>';
    h += '<div class="pe-card"><b style="color:#400207">Start a customised menu</b>'+
      '<div style="font-size:11px;color:#4F4535;margin:2px 0 10px">Pick the menu the guest is happy with — you can change every course afterwards.</div>'+
      peSetMenusPickInc().map(function(m){
        return '<div class="pe-dishrow"><span><b style="color:#400207">'+peEsc(m.name)+'</b>'+
          (m.price!=null?' · AED '+peMoney(m.price)+' / guest':' · <span style="background:#FAEEDA;color:#854F0B;font-size:10.5px;padding:1px 8px;border-radius:20px">price on the proposal</span>')+
          '<br><span style="font-size:11px;color:#4F4535">'+peEsc(m.line||peSmSummary(m.courses))+'</span></span>'+
          '<button class="pe-btn sec sm" onclick="peCmStart(\''+peSmEsc(m.key)+'\',null)">Start from this</button></div>';
      }).join('')+
      '<div style="margin-top:10px"><button class="pe-btn sec" onclick="peCmStart(null,null)">Start from nothing — build it course by course</button></div>'+
      '</div>';
    var mine = peSetMenusAll().filter(function(m){ return peSmIsCustom(m) && m.active!==false; });
    if(mine.length){
      h += '<div class="pe-card"><b style="color:#400207">Menus you have customised</b>'+
        '<div style="font-size:11px;color:#4F4535;margin:2px 0 8px">To send one to a guest, tick it under <span style="color:#400207;text-decoration:underline;cursor:pointer" onclick="peState.packsTab=\'menus\';renderMain()">Set menus &amp; beverage</span> — or WhatsApp it straight from here. One on a booking also goes out with that proposal.</div>'+
        mine.map(function(m){
          var ev = m.eventId ? peEvById(m.eventId) : null;
          return '<div class="pe-dishrow"><span><b style="color:#400207">'+peEsc(m.name)+'</b>'+
            (m.price!=null?' · AED '+peMoney(m.price)+' / guest':'')+
            '<br><span style="font-size:11px;color:#4F4535">'+
            (m.basedOn?'from '+peEsc((peSetMenuByKey(m.basedOn)||{name:m.basedOn}).name)+' · ':'')+
            (ev?peEsc(ev.client_name||'event')+(ev.event_date?' · '+peEsc(ev.event_date):''):'not on a booking')+
            '</span></span>'+
            '<span style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">'+
            '<button class="pe-btn sec sm" onclick="peCmOpen(\''+peSmEsc(m.key)+'\')">View</button>'+
            '<button class="pe-btn sec sm" onclick="peCmPrintMenu(\''+peSmEsc(m.key)+'\')">Print / PDF</button>'+
            '<button class="pe-btn sec sm" onclick="peCmEmail(\''+peSmEsc(m.key)+'\')">Email</button>'+
            '<button class="pe-btn sec sm" onclick="peWaShareMenu(\''+peSmEsc(m.key)+'\')">WhatsApp</button>'+
            (ev?'<button class="pe-btn sec sm" onclick="peGo(\'event\',\''+m.eventId+'\')">Open booking</button>':'')+
            '<button class="pe-btn sec sm" style="color:#B00020;border-color:#B00020" onclick="peCmDelete(\''+peSmEsc(m.key)+'\')">Delete</button>'+
            '</span></div>';
        }).join('')+'</div>';
    }
    return h;
  }
  // ── the builder ──
  var t = peCmTotals();
  var alc = peAlcAll();
  h += '<div style="font-size:12px;color:#4F4535;margin-bottom:10px;cursor:pointer" onclick="peCmDiscard()">← Start a different menu</div>';
  h += '<div class="pe-card"><div class="pe-lbl">What this menu is called on the proposal</div>'+
    '<input class="pe-in" value="'+peEsc(cm.name)+'" placeholder="e.g. Mare set menu — Sara’s dinner" onchange="peCmSet(\'name\',this.value)">'+
    (cm.basedOn?'<div style="font-size:11px;color:#4F4535;margin-top:5px">Started from <b>'+peEsc(cm.baseName)+'</b>'+(cm.basePrice!=null?' at AED '+peMoney(cm.basePrice)+'/guest':'')+' — the designed menu is untouched.</div>':'')+
    '<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap"><div><div class="pe-lbl">Guests (optional — for the kitchen’s portions)</div>'+
    '<input class="pe-in" style="max-width:120px" type="number" min="0" value="'+(cm.guests!=null?peEsc(cm.guests):'')+'" onchange="peCmSet(\'guests\',this.value)"></div></div>'+
    '</div>';
  cm.courses.forEach(function(c, ci){
    h += '<div class="pe-card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
      '<input class="pe-in" style="flex:1;min-width:140px" value="'+peEsc(c.name)+'" placeholder="Course name — e.g. Secondi" onchange="peCmCourse('+ci+',\'name\',this.value)">'+
      '<label style="font-size:11.5px;color:#6B4A33;display:inline-flex;align-items:center;gap:6px;cursor:pointer">'+
        '<input type="checkbox" '+(c.choose?'checked':'')+' onchange="peCmCourse('+ci+',\'choose\',this.checked)" style="accent-color:#400207"> guests choose one</label>'+
      '<span class="pe-x" onclick="peCmRemoveCourse('+ci+')" title="Remove this course">✕</span></div>';
    if(!c.lines.length) h += '<div style="font-size:11.5px;color:#4F4535;margin-top:8px">No dishes in this course yet — add one from the à la carte below.</div>';
    c.lines.forEach(function(l, li){
      var isAlc = l.from!=='set';
      var src = l.from==='canape' ? 'the canapé list' : 'the à la carte';
      h += '<div class="pe-dishrow"><span>'+
        (isAlc
          ? '<b style="font-weight:600;color:#400207">'+peEsc(l.name)+'</b>'+
            ' <span class="pe-pill" style="font-size:10px;background:#F4EEE1;color:#574232;border:1px solid #C9B48E">'+(l.added?'added from ':'from ')+src+'</span>'+
            (l.out?'<br><span style="font-size:11px;color:#4F4535">instead of <b>'+peEsc(l.out)+'</b></span>':'')+
            '<br><span style="font-size:11px;color:'+(l.price==null?'#B00020':'#6B4A33')+'">'+
              (l.price==null
                ? 'this dish has no fixed price — set the supplement yourself'
                : (l.from==='canape' ? 'AED '+peMoney(l.price)+' per piece' : 'à la carte AED '+peMoney(l.price)))+'</span>'+
            // The offer. Charging nothing is the default and is stated as a
            // choice, not left as an empty box she has to interpret.
            (l.diff!=null
              ? '<br><span style="font-size:11px;color:#6B4A33">'+
                (Number(l.supplement)>0
                  ? 'Charging <b>AED '+peMoney(l.supplement)+' / guest</b> for this'+
                    ' · <span style="color:#400207;text-decoration:underline;cursor:pointer" onclick="peCmApplyDiff('+ci+','+li+',false)">no charge instead</span>'
                  : 'No change to the price'+
                    (l.diff>0
                      ? ' · the à la carte difference'+(l.outPricedAs?' against '+peEsc(l.outPricedAs):'')+' is AED '+peMoney(l.diff)+
                        ' — <span style="color:#400207;text-decoration:underline;cursor:pointer" onclick="peCmApplyDiff('+ci+','+li+',true)">charge it</span>'
                      : ' · this dish is not dearer than the one it replaces'))+'</span>'
              : (l.price!=null && l.from!=='canape'
                  ? '<br><span style="font-size:11px;color:#6B4A33">No change to the price — nothing to compare it against, so type a supplement if you want one.</span>'
                  : ''))
          : '<input class="pe-in" style="width:100%;max-width:320px" value="'+peEsc(l.name)+'" placeholder="Dish name" oninput="peCmLineName('+ci+','+li+',this.value)">'+
            '<br><span style="font-size:11px;color:#4F4535">from the set menu — no supplement</span>')+
        '<div style="margin-top:6px"><select class="pe-in" style="width:auto;max-width:100%;font-size:11.5px" onchange="peCmSwap('+ci+','+li+',this.value);this.selectedIndex=0">'+
          '<option value="">Swap for an à la carte dish…</option>'+
          peCmAlcOptions(alc, c)+
        '</select></div>'+
        // On a "guests choose one" course the supplement still lands on every
        // guest's price, so she is offered the division instead of doing it.
        (c.choose && isAlc && l.diff!=null && Number(l.supplement)>0
          ? '<div style="margin-top:6px;font-size:11px;color:#6B4A33">Taken by '+
            '<input class="pe-in" style="width:56px;padding:3px 5px;text-align:center;display:inline-block" type="number" min="0"'+
              (cm.guests?'':' disabled')+
              ' value="'+(l.forGuests!=null?l.forGuests:'')+'" onchange="peCmForGuests('+ci+','+li+',this.value)">'+
            ' of '+(cm.guests||'?')+' guests'+
            (cm.guests?'':' <span style="color:#8A2A1A">— add the guest count above before you can split this</span>')+
            (l.forGuests!=null && cm.guests
              ? ' — the AED '+peMoney(l.diff)+' difference spread over everyone is <b>AED '+peMoney(l.supplement)+' / guest</b>'
              : ' — leave blank to charge every guest the full AED '+peMoney(l.diff))+'</div>'
          : '')+
        '</span>'+
        '<span style="display:flex;align-items:center;gap:6px;flex-shrink:0">'+
          '<span style="display:flex;flex-direction:column;align-items:center;line-height:1.1">'+
            '<input class="pe-in" style="width:74px;padding:4px 6px;text-align:center" type="number" min="0" value="'+(Number(l.supplement)||0)+'" onchange="peCmSupp('+ci+','+li+',this.value)">'+
            '<span style="font-size:9.5px;color:#4F4535;margin-top:2px">supplement<br>AED / guest</span></span>'+
          '<span class="pe-x" onclick="peCmRemoveLine('+ci+','+li+')">✕</span></span></div>';
    });
    h += '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
      '<select class="pe-in" style="width:auto;max-width:100%" onchange="peCmAddDish('+ci+',this.value);this.selectedIndex=0">'+
        '<option value="">+ Add a dish from the à la carte…</option>'+peCmAlcOptions(alc, c)+'</select>'+
      '<button class="pe-btn sec sm" onclick="peCmAddLine('+ci+')">+ Add a dish by name</button></div>';
    h += '</div>';
  });
  h += '<div style="margin-bottom:12px"><button class="pe-btn sec" onclick="peCmAddCourse()">+ Add a course</button></div>';
  // ── price ──
  h += '<div class="pe-card" style="border-color:rgba(201,168,76,0.5)"><b style="color:#400207">Price per guest</b>';
  h += '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">'+
    ['supplement','sum'].map(function(mode){
      var on = cm.priceMode===mode;
      var lbl = mode==='supplement' ? 'Keep the set price + supplements' : 'Reprice from every dish';
      var dis = (mode==='supplement' && cm.basePrice==null);
      return '<button class="pe-btn '+(on?'':'sec')+' sm"'+(dis?' disabled title="This menu didn’t start from a priced set menu, so there is no set price to keep"':' onclick="peCmSet(\'priceMode\',\''+mode+'\')"')+'>'+lbl+'</button>';
    }).join('')+'</div>'+
    // Rule 3: a disabled button has to say why on the screen, not on hover.
    (cm.basePrice==null?'<div style="font-size:11px;color:#8A2A1A;margin-top:6px">This menu didn’t start from a priced set menu, so there is no set price to keep — price it from every dish.</div>':'');
  if(cm.priceMode==='supplement'){
    h += '<div class="pe-tot-row" style="margin-top:8px"><span>'+peEsc(cm.baseName||'Set menu')+'</span><b>AED '+peMoney(t.base||0)+'</b></div>'+
      '<div class="pe-tot-row"><span>Supplements on this menu</span><b>'+(t.supp?'+ AED '+peMoney(t.supp):'none')+'</b></div>';
  } else {
    h += '<div class="pe-tot-row" style="margin-top:8px"><span>Every dish added up</span><b>'+(t.unpriced.length?'—':'AED '+peMoney(t.sum))+'</b></div>';
    if(t.unpriced.length) h += '<div class="pe-flag" style="color:#B00020">▲ Can’t add up: no price for '+peEsc(t.unpriced.slice(0,4).join(', '))+(t.unpriced.length>4?' and '+(t.unpriced.length-4)+' more':'')+' — set the price yourself below.</div>';
  }
  h += '<div class="pe-tot-row" style="border-top:1px solid #E3D5C2;margin-top:4px;padding-top:6px"><span><b>What the guest is charged</b></span><b style="color:#400207;font-size:15px">'+
    (t.price==null?'not set yet':'AED '+peMoney(t.price)+' / guest')+'</b></div>';
  h += '<div style="margin-top:8px"><div class="pe-lbl">Override the price (optional — leave blank to use the number above)</div>'+
    '<input class="pe-in" style="max-width:170px" type="number" min="0" value="'+(cm.priceOverride!=null?peEsc(cm.priceOverride):'')+'" placeholder="'+(t.computed!=null?peMoney(t.computed):'e.g. 480')+'" onchange="peCmSet(\'priceOverride\',this.value)"></div>';
  if(cm.guests && t.price!=null) h += '<div style="font-size:11.5px;color:#4F4535;margin-top:6px">'+cm.guests+' guests × AED '+peMoney(t.price)+' = <b>AED '+peMoney(t.price*cm.guests)+'</b> of food.</div>';
  h += '<div style="margin-top:10px"><div class="pe-lbl">Anything the kitchen must read (optional)</div>'+
    '<textarea class="pe-in" rows="2" placeholder="e.g. the two vegetarian guests take the melanzane as their secondo" onchange="peCmSet(\'note\',this.value)">'+peEsc(cm.note||'')+'</textarea></div>';
  h += '</div>';
  // ── save ──
  var problems = peCmProblems();
  h += '<div class="pe-card"><b style="color:#400207">Save it</b>'+
    '<div style="font-size:11px;color:#4F4535;margin:2px 0 10px">Saved, it behaves like any other menu: the proposal prints the courses, the kitchen brief prints the portions and what was swapped, and the guest can be sent it.</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
      '<select class="pe-in" style="width:auto;max-width:100%" onchange="peCmSet(\'eventId\',this.value)">'+
        '<option value="">Save to the library — not on a booking yet</option>'+
        peCmEventOptions()+
      '</select>'+
      '<button class="pe-btn"'+(problems.length||peState.cmBusy?' disabled':'')+' onclick="peCmSave()">'+(peState.cmBusy?'Saving…':'Save this menu')+'</button>'+
    '</div>'+
    (problems.length
      ? '<div style="font-size:11.5px;color:#B00020;margin-top:8px">Can’t save yet — '+peEsc(problems.join(' · '))+'</div>'
      : '<div style="font-size:11.5px;color:#4F4535;margin-top:8px">'+(cm.eventId?'This will become the food on that booking, at AED '+peMoney(t.price)+'/guest.':'Pick a booking above to put it straight onto an event.')+'</div>')+
    '</div>';
  return h;
}
// One dish list, used by both the swap picker and the add picker. The course's
// own kind comes first so a Secondi swap doesn't open on the caviar, but every
// dish stays reachable — she is the one talking to the guest.
function peCmAlcOptions(alc, course){
  var kind = peCmCourseKind(course);
  var pri = alc.filter(function(a){ return kind && a.course===kind; });
  var rest = alc.filter(function(a){ return pri.indexOf(a)<0; });
  function opt(a){
    return '<option value="'+a.id+'">'+peEsc(a.name)+' — '+peEsc(peAlcPriceText(a))+'</option>';
  }
  var h = '';
  if(pri.length) h += '<optgroup label="'+peEsc(peAlcSecLabel(kind))+' — the usual choice here">'+pri.map(opt).join('')+'</optgroup>';
  h += '<optgroup label="Everything else on the à la carte">'+rest.map(opt).join('')+'</optgroup>';
  return h;
}
// Guess what kind of course this is from its name, so the picker can lead with
// the right dishes. A guess only — it never restricts what she can pick.
function peCmCourseKind(course){
  var n = String((course&&course.name)||'').toLowerCase();
  // Dolci first: "Dolci" would otherwise never be reached, and a dessert course
  // offering secondi is exactly the mismatch this function exists to prevent.
  if(/dolci|dessert|dolce|pudding/.test(n)) return 'dolci';
  // "Primi" is NOT the pasta course here. Terra, Mare and Fuoco all open with a
  // Primi course of Burrata / Bresaola / Tonno Battuto and carry a separate
  // Pasta course — so treating Primi as pasta made "Burrata" resolve to the
  // gnocco with burrata in it, and printed that dish's description on a menu.
  if(/antipast|starter|crudo|insalat|salad|primo|primi/.test(n)) return 'antipasti';
  if(/pasta|riso|risotto/.test(n)) return 'pasta';
  if(/second|main|pesce|carne/.test(n)) return 'secondi';
  if(/contorn|side/.test(n)) return 'contorni';
  return '';
}
function peCmProblems(){
  var cm = peState.cm; if(!cm) return ['nothing to save'];
  var t = peCmTotals();
  var out = [];
  if(!String(cm.name||'').trim()) out.push('the menu needs a name');
  var dishes = 0;
  cm.courses.forEach(function(c){ c.lines.forEach(function(l){ if(String(l.name||'').trim()) dishes++; }); });
  if(!dishes) out.push('add at least one dish');
  if(t.price==null) out.push('set the price per guest');
  return out;
}
function peCmEventOptions(){
  var cm = peState.cm;
  var evs = (peState.events||[]).filter(function(e){ return e.status!=='cancelled' && e.status!=='done'; })
    .sort(function(a,b){ return String(a.event_date||'').localeCompare(String(b.event_date||'')); });
  return evs.map(function(e){
    return '<option value="'+e.id+'"'+(cm&&cm.eventId===e.id?' selected':'')+'>'+
      peEsc(e.client_name||'(no name)')+(e.event_date?' · '+peEsc(e.event_date):'')+(e.guests?' · '+e.guests+' guests':'')+'</option>';
  }).join('');
}
// Every menu we send carries the English description and the allergen codes.
// A set menu's courses hold plain dish NAMES, so a customised menu had neither
// — printing a legend of codes underneath dishes that carried none. This finds
// the dish in the à la carte (or the canapé library) and gives back both, so
// the documents can say what a dish is and what is in it.
// Deliberately STRICTER than the price matcher. A supplement she can see and
// overrule may be suggested on a loose match; a description is printed on a
// guest's proposal in our name with nobody checking it, so it is only taken on
// an exact name or a clean subset of words — "Burrata" → "Burrata Pugliese"
// yes, "Ribeye di Angus" → "Costata di Angus" no. Better a bare dish name than
// the wrong dish described.
function peCmDishInfo(name, courseKind){
  var n = String(name||'').trim();
  if(!n) return null;
  var want = peCmTokens(n);
  var cands = peAlcAll().filter(function(a){
    if(a.name.toLowerCase()===n.toLowerCase()) return true;
    if(!want.length) return false;
    var got = peCmTokens(a.name);
    if(!got.length) return false;
    var shared = want.filter(function(w){ return got.indexOf(w)>=0; });
    return shared.length===want.length || shared.length===got.length;
  });
  // Two dishes can legitimately share a name (Branzino the carpaccio and
  // Branzino the secondo) — the course decides which description is right.
  var pool = cands.filter(function(a){ return courseKind && a.course===courseKind; });
  if(!pool.length) pool = cands;
  // Then the CLOSEST name wins, not the first one found. "Burrata" belongs to
  // "Burrata Pugliese", not to "Gnocco all'nduja, Peperone Dolce e Burrata"
  // — both contain the word, only one is the dish.
  pool = pool.slice().sort(function(a,b){ return peCmTokens(a.name).length - peCmTokens(b.name).length; });
  var hit = pool[0];
  if(hit) return { desc:(hit.description||''), allergens:(hit.allergens||[]) };
  var d = (peState.dishes||[]).filter(function(x){ return String(x.name||'').toLowerCase()===n.toLowerCase(); })[0];
  if(d) return { desc:(d.description||''), allergens:(d.allergens||[]) };
  return null;
}
function peCmAlgCodes(al){
  return (al && al.length) ? ' (' + al.join(')(') + ')' : '';
}
// ── Set-menu allergens ──────────────────────────────────────────────────────
// They used to live inside the description prose — "…cartoccio style (R)(S)" —
// so nothing could cross-check them and they drifted permanently: the same
// Tonno Battuto said egg on the canapé list and dairy on the Mare menu, and an
// oven-baked seabass was flagged raw and shellfish on two menus at once.
//
// A course now carries a real field alongside the text:
//     courses[].allg = { "Tonno Battuto": ["D","E","N","R"] }
// Menus written before that still carry the codes in the prose, so both are
// read and the structured field wins. That means this code is correct before
// AND after the migration — there is no window where a menu renders wrong.
var PE_ALG_RE = /\s*\(([A-Za-z]{1,3})\)/g;
// known:false means nobody has recorded them. known:true with an empty list
// means someone checked and there are none. Those must never look alike.
function peAlgOf(c, dish){
  if(c && c.allg && Object.prototype.hasOwnProperty.call(c.allg, dish)){
    return { known:true, list:(c.allg[dish] || []) };
  }
  var t = (c && c.desc && c.desc[dish]) || '', out = [], m;
  PE_ALG_RE.lastIndex = 0;
  while((m = PE_ALG_RE.exec(t))) out.push(m[1].toUpperCase());
  return { known: out.length > 0, list: out };
}
function peDescOf(c, dish){
  var t = (c && c.desc && c.desc[dish]) || '';
  return t.replace(PE_ALG_RE, '').trim();
}
// What a course carries to the guest page and the documents. TWO maps now:
//   desc = { "Dish name": "what it is" }        — prose, no codes in it
//   allg = { "Dish name": ["D","E"] }           — a field that can be checked
// This used to be one map with the codes glued onto the end of the sentence,
// which is how the same dish ended up saying egg on one menu and dairy on
// another with nothing able to notice.
//
// inherited = what the menu she started from says about that dish. It wins:
// it was written for that menu, and it covers dishes the à la carte has never
// heard of. The à la carte only fills the gaps — the dishes she swapped in.
function peCmCourseDesc(courseName, names, inherited, inheritedAlg){
  var kind = peCmCourseKind({name:courseName});
  var inh = inherited || {};
  var inhA = inheritedAlg || {};
  var desc = {}, allg = {};
  (names||[]).forEach(function(n){
    if(inh[n] || inhA[n]){
      // The base menu wrote this line. Its allergens come across as a list if
      // it already had one; otherwise split them back out of the prose, so an
      // older menu is upgraded rather than losing them.
      var t = String(inh[n]||''), codes = [], m;
      PE_ALG_RE.lastIndex = 0;
      while((m = PE_ALG_RE.exec(t))) codes.push(m[1].toUpperCase());
      var clean = t.replace(PE_ALG_RE, '').trim();
      if(clean) desc[n] = clean;
      if(inhA[n]) allg[n] = inhA[n].slice();
      else if(codes.length) allg[n] = codes;
      return;
    }
    var info = peCmDishInfo(n, kind);
    if(!info) return;
    if(info.desc) desc[n] = String(info.desc).trim();
    // An à la carte dish always knows its allergens — including when the answer
    // is "none", which is a recorded fact, not a gap. Storing the empty array
    // is what lets the guest page tell those two apart.
    if(info.allergens) allg[n] = info.allergens.slice();
  });
  return { desc:desc, allg:allg };
}
// ── what she can do with a menu she has built ────────────────────────────────
// Open it exactly as the guest will see it. "Check the PDF" for a customised
// menu means this page — there is no designed PDF for a menu invented today.
function peCmOpen(key){
  window.open(peBaseUrl()+'client-setmenu.html?m='+encodeURIComponent(key), '_blank');
}
// ══ PRINT FOR THE TABLE ══════════════════════════════════════════════════════
// The menu a guest finds at their place when they sit down. Katarina prints it.
//
// It is the SAME Austin document as everything else — one standard, never a
// second design. What she chooses is what appears ON it: the guest's name, the
// price, the descriptions, the size. She can also tap any dish or course on the
// sheet and retype it, and that NEVER writes back to the saved menu: a one-off
// "Happy Birthday" or a dish swapped for one table must not change the menu
// every other booking is quoted from.
//
// Price is OFF by default — a menu handed to a guest at the table is not a quote.
// Allergens are not optional. The table is exactly where a guest reads them.
function peTmState(){
  if(!peState.tm) peState.tm = { key:'', eventId:'', price:false, desc:true, msg:'', size:'a4', layout:'full', title:'', edits:{} };
  if(!peState.tm.edits) peState.tm.edits = {};
  return peState.tm;
}
// Everything she retypes is HELD IN STATE, not just left in the DOM. The sheet
// is rebuilt from scratch on every toggle, so an edit that lived only in the
// page vanished the moment she ticked a box — she would have typed the title,
// turned the price off, and watched her wording disappear.
function peTmEditCapture(el){
  var k = el && el.getAttribute('data-k'); if(!k) return;
  peTmState().edits[k] = el.textContent;
}
function peTmEd(k, fallback){
  var e = peTmState().edits;
  return Object.prototype.hasOwnProperty.call(e, k) ? e[k] : fallback;
}
function peTmTitle(el){ peTmState().title = el.value; peTmDraw(); }
// A different menu makes the old edits meaningless — they are keyed by position.
function peTmSet(k, v){
  var t = peTmState();
  if(k==='key' && v!==t.key){ t.edits = {}; t.title = ''; }
  t[k]=v; renderMain();
}
function peTmToggle(k, el){ peTmState()[k] = !!el.checked; peTmDraw(); }
function peTmMsg(el){ peTmState().msg = el.value; peTmDraw(); }
// Bookings worth offering: from today, with a set menu on them.
function peTmBookings(){
  var today = new Date(Date.now()+4*3600*1000).toISOString().slice(0,10);
  return (peState.events||[]).filter(function(e){
    return e && e.set_menu && e.set_menu.key && String(e.event_date||'') >= today;
  }).sort(function(a,b){ return String(a.event_date).localeCompare(String(b.event_date)); });
}
function peTmPickBooking(id){
  var t = peTmState(); t.eventId = id;
  var e = (peState.events||[]).filter(function(x){ return String(x.id)===String(id); })[0];
  if(e && e.set_menu && e.set_menu.key !== t.key){ t.key = e.set_menu.key; t.edits = {}; t.title = ''; }
  renderMain();
}
// The library name carries our bookkeeping — "Giambartolo - customised" tells
// Valentina which record it is and tells a guest nothing. Off it comes.
function peTmDefaultTitle(m){
  return String((m&&m.name)||'').replace(/\s*[-—–]\s*customi[sz]ed\s*$/i,'').trim() || (m&&m.name) || '';
}
function peTmMenu(){ var t=peTmState(); return t.key ? peSetMenuByKey(t.key) : null; }
function peTmEvent(){ var t=peTmState(); return (peState.events||[]).filter(function(x){ return String(x.id)===String(t.eventId); })[0] || null; }
// The sheet itself. Built once here and used for BOTH the on-screen preview and
// the print, so what she checks is exactly what comes out of the printer.
function peTmSheetHTML(editable){
  var t = peTmState(), m = peTmMenu(), e = peTmEvent();
  if(!m) return '<div style="text-align:center;color:#4F4535;padding:40px 10px">Choose a booking or a menu to see the sheet.</div>';
  var ed = editable ? ' contenteditable="true"' : '';
  var used = {};
  // Wrapped so the menu can be CENTRED on the page and the footer pinned to the
  // foot of it. A short menu floating at the top of an A4 with a hand of empty
  // paper under it is what made this look unfinished.
  var h = '<div class="tm-body"><div class="tm-brand">'+peLogoImg(300)+'</div>';
  // No "Prepared for X · Tue 4 Aug" line (removed 3 Aug 2026). The guest knows
  // whose dinner it is and what day it is; that line reads like a work order on
  // something meant to sit on their table. The message field below is the only
  // personal line, and it is hers to write.
  if(String(t.msg||'').trim()) h += '<div class="tm-msg">'+peEsc(t.msg.trim())+'</div>';
  // "Giambartolo — customised" is our internal name for the record. It must
  // never be what a guest reads, so the title is hers to write.
  h += '<div class="tm-title"'+ed+' data-k="title" oninput="peTmEditCapture(this)">'+
       peEsc(String(t.title||'').trim() || peTmDefaultTitle(m))+'</div>';
  if(t.price && m.price!=null) h += '<div class="tm-price">'+pePerPerson(m.price)+'</div>';
  h += '<div class="tm-rule"></div>';
  (m.courses||[]).forEach(function(c, ci){
    h += '<div class="tm-course"><div class="sec"'+ed+' data-k="c'+ci+'" oninput="peTmEditCapture(this)">'+peEsc(peTmEd('c'+ci, c.name+(c.choose?peChooseLabel():'')))+'</div>';
    ((c.choose ? c.options : c.items)||[]).forEach(function(o, di){
      var stored = c.desc||{};
      var info = stored[o] ? null : peCmDishInfo(o, peCmCourseKind(c));
      var alg = peAlgOf(c, o);
      if(!alg.known && info && info.allergens && info.allergens.length) alg = { known:true, list:info.allergens };
      var line = stored[o] ? peDescOf(c, o) : ((info && info.desc) ? info.desc : '');
      var codes = (alg.known && alg.list.length) ? '('+alg.list.join(')(')+')' : '';
      (alg.known ? alg.list : []).forEach(function(k){ used[String(k).toUpperCase()] = 1; });
      h += '<div class="dish"><span'+ed+' data-k="d'+ci+'-'+di+'" oninput="peTmEditCapture(this)">'+peEsc(peTmEd('d'+ci+'-'+di, o))+'</span>'+
        (codes ? ' <span class="codes">'+peEsc(codes)+'</span>' : '')+
        // "Dish names only" is a SIZE of the same document, not a second design.
        (t.desc && t.layout==='full' && line ? '<br><span class="d">'+peEsc(line)+'</span>' : '')+'</div>';
    });
    h += '</div>';
  });
  var legend = ['A','D','E','H','N','R','S','V'].filter(function(k){ return used[k]; })
                 .map(function(k){ return k+' - '+PE_ALG_NAMES[k]; }).join(' | ');
  h += '</div><div class="ft">Our Chefs will do their best to accommodate your dietary requirements, please inform your waiter.'+
       // The VAT line is meaningless without a price, so it only appears with one.
       (t.price && m.price!=null ? '<br>All prices are in AED inclusive of 5% VAT, 7% DIFC Authority Fee and 10% Service Charge.' : '')+
       (legend ? '<br>'+legend : '')+'</div>';
  return h;
}
// Split in two on purpose. The PAGE half (@page, html, body) belongs only to the
// printed document; the INK half is the typography, and the on-screen preview
// reuses it verbatim under its own id. The preview used to build itself by
// regex-stripping the print CSS, which broke the moment a rule like
// "html,body{...}" appeared — leaving a dangling "html," behind.
function peTmCssInk(size, sel){
  var a5 = size==='a5', p = sel ? sel+' ' : '';
  return p+'.tm-brand{text-align:center;margin:0 0 2mm}'+
    p+'.tm-brand img{width:'+(a5?'46mm':'62mm')+';height:auto;display:block;margin:0 auto}'+
    p+'.tm-msg{text-align:center;font-family:\'Forum\',Georgia,serif;font-size:'+(a5?'13pt':'15pt')+';color:#450207;margin-top:6mm}'+
    p+'.tm-title{text-align:center;font-family:\'Forum\',Georgia,serif;font-size:'+(a5?'11pt':'12.5pt')+';color:#574232;letter-spacing:2px;text-transform:uppercase;margin-top:5mm}'+
    p+'.tm-price{text-align:center;font-size:'+(a5?'9pt':'10pt')+';color:#574232;margin-top:2mm}'+
    p+'.tm-rule{width:'+(a5?'16mm':'20mm')+';height:1px;background:#C9A84C;margin:5mm auto 0}'+
    p+'.tm-course{margin-top:'+(a5?'6mm':'7.5mm')+';break-inside:avoid;page-break-inside:avoid}'+
    p+'.sec{font-size:'+(a5?'8.5pt':'9.5pt')+';letter-spacing:3.4px;margin:0 0 3mm;color:#544418;text-transform:uppercase;text-align:center}'+
    p+'.dish{margin:'+(a5?'2.6mm':'3.4mm')+' 0;font-size:'+(a5?'11pt':'12.5pt')+';font-family:\'Forum\',Georgia,serif;text-align:center;color:#3A332C}'+
    p+'.dish .codes{font-size:'+(a5?'7.5pt':'8.5pt')+';font-family:\'Outfit\',Arial,sans-serif;color:#574232}'+
    p+'.dish .d{font-size:'+(a5?'8pt':'9pt')+';font-family:\'Outfit\',Arial,sans-serif;color:#574232;line-height:1.55;display:inline-block;max-width:'+(a5?'100%':'86%')+';margin-top:1mm}'+
    p+'.ft{font-size:'+(a5?'6.5pt':'7.5pt')+';line-height:1.9;text-align:center;color:#574232}';
}
function peTmCss(size){
  var a5 = size==='a5';
  return peTmCssInk(size, '') + (
    // ── the browser's own stamps ──────────────────────────────────────────
    // Printing into about:blank makes the browser stamp the date, the document
    // title, "about:blank" and "1/1" into the page margins. No CSS switches
    // those off — but with @page margin ZERO there is no margin for them to sit
    // in, so they go. The real margin becomes padding on the page, which is
    // ours and prints identically.
    '@page{size:'+(a5?'A5':'A4')+';margin:0}'+
    'html,body{height:100%}'+
    'body{margin:0;padding:'+(a5?'14mm 14mm':'19mm 24mm')+';max-width:none;min-height:100%;box-sizing:border-box;'+
      'display:flex;flex-direction:column;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    // The menu sits in the optical centre and the footer holds the foot of the
    // page, instead of everything crowding the top edge over empty paper.
    '.tm-body{flex:1 0 auto;display:flex;flex-direction:column;justify-content:center;padding-bottom:'+(a5?'5mm':'7mm')+'}'+
    '.ft{flex:0 0 auto;margin-top:auto;padding-top:'+(a5?'4mm':'6mm')+'}'
  );
}
// Print what is ON SCREEN, not a fresh build — so her edits go to the printer.
function peTmPrint(){
  var m = peTmMenu();
  if(!m){ peToast('Choose a booking or a menu first', true); return; }
  if(!peMenuSendable(m, 'printed')) return;
  var live = document.getElementById('pe-tm-sheet');
  var body = live ? live.innerHTML.replace(/\scontenteditable="true"/g, '') : peTmSheetHTML(false);
  // The document title becomes the suggested filename in "Save as PDF", so it
  // must be the guest-facing title — never "Giambartolo — customised".
  var t = peTmState();
  var docTitle = String(t.title||'').trim() || peTmDefaultTitle(m);
  pePrintHTML(peDocShell(docTitle, body, peTmCss(t.size)));
}
function peTmDraw(){
  var el = document.getElementById('pe-tm-sheet');
  if(el) el.innerHTML = peTmSheetHTML(true);
}
function peRenderTableMenu(){
  var t = peTmState(), h = peHeader('table');
  var bookings = peTmBookings();
  var menus = peSetMenusRaw().filter(function(m){ return m.active!==false; }).map(peNormSM);
  var chk = function(k, label, sub, locked){
    return '<label style="display:flex;gap:9px;align-items:flex-start;padding:7px 0;font-size:13px'+(locked?';opacity:.6':'')+'">'+
      '<input type="checkbox"'+(locked?' checked disabled':(t[k]?' checked':''))+' style="accent-color:#400207;margin-top:2px"'+
      (locked?'':' onchange="peTmToggle(\''+k+'\',this)"')+'>'+
      '<span>'+label+(sub?'<span style="display:block;font-size:11px;color:#574232">'+sub+'</span>':'')+'</span></label>';
  };
  var seg = function(k, val, label){
    return '<button class="pe-btn '+(t[k]===val?'':'sec ')+'sm" style="flex:1" onclick="peTmSet(\''+k+'\',\''+val+'\')">'+label+'</button>';
  };
  h += '<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">'+
    '<div class="pe-card" style="width:320px;flex:0 0 320px">'+
      '<b style="color:#400207">Print for the table</b>'+
      '<div style="font-size:11px;color:#4F4535;margin:2px 0 12px">The menu the guest finds at their place. Always the house standard — you choose what appears on it.</div>'+
      '<div class="pe-lbl">Booking</div>'+
      '<select class="pe-in" onchange="peTmPickBooking(this.value)">'+
        '<option value="">— just a menu, no booking —</option>'+
        bookings.map(function(e){
          return '<option value="'+peEsc(e.id)+'"'+(String(t.eventId)===String(e.id)?' selected':'')+'>'+
            peEsc(e.client_name||'Event')+' · '+peEsc(peDLabel(e.event_date))+(e.guests?' · '+e.guests+' guests':'')+'</option>';
        }).join('')+
      '</select>'+
      '<div class="pe-lbl" style="margin-top:10px">Menu</div>'+
      '<select class="pe-in" onchange="peTmSet(\'key\',this.value)">'+
        '<option value="">— choose —</option>'+
        menus.map(function(m){ return '<option value="'+peEsc(m.key)+'"'+(t.key===m.key?' selected':'')+'>'+peEsc(m.name)+'</option>'; }).join('')+
      '</select>'+
      // She should not have to discover that the title is tappable — the one
      // thing on the sheet that is always wrong for a guest gets its own field.
      '<div class="pe-lbl" style="margin-top:10px">Title on the menu</div>'+
      '<input class="pe-in" id="pe-tm-title" value="'+peEsc(t.title||'')+'" oninput="peTmTitle(this)" placeholder="'+
        peEsc(peTmMenu() ? peTmDefaultTitle(peTmMenu()) : 'e.g. Dinner Menu')+'">'+
      '<div style="font-size:11px;color:#4F4535;margin-top:4px">Leave it empty and we drop our own “— customised” from the name.</div>'+
      '<div class="pe-lbl" style="margin-top:12px">On the menu</div>'+
      chk('price','Price per person','off by default — this is not a quote')+
      chk('desc','Dish descriptions')+
      chk('allg','Allergen codes','always printed — the table is where a guest reads them', true)+
      '<div class="pe-lbl" style="margin-top:10px">A message (optional)</div>'+
      '<input class="pe-in" value="'+peEsc(t.msg||'')+'" oninput="peTmMsg(this)" placeholder="e.g. Happy Birthday, Gianbartolo">'+
      '<div class="pe-lbl" style="margin-top:12px">Size</div>'+
      '<div style="display:flex;gap:6px">'+seg('size','a4','A4 sheet')+seg('size','a5','A5 card')+'</div>'+
      '<div class="pe-lbl" style="margin-top:12px">Layout</div>'+
      '<div style="display:flex;gap:6px">'+seg('layout','full','Full')+seg('layout','short','Dish names only')+'</div>'+
      '<button class="pe-btn" style="width:100%;margin-top:14px" onclick="peTmPrint()">Print / Save as PDF</button>'+
      '<div style="font-size:11px;color:#4F4535;margin-top:10px;border-top:1px solid #E3D8C4;padding-top:9px">'+
        '<b>Editing:</b> tap any dish or course name on the sheet to change it for this print. It never changes the saved menu.</div>'+
    '</div>'+
    '<div style="flex:1;min-width:320px">'+
      '<div style="font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#4F4535;margin-bottom:7px">'+
        (t.size==='a4'?'A4 sheet':'A5 card')+' · '+(t.layout==='full'?'full':'dish names only')+' · '+(t.price?'with price':'no price')+'</div>'+
      // The preview carries the document's own styles, scoped to itself, so what
      // she sees on screen is the sheet — not an approximation of it.
      '<style>#pe-tm-sheet .sec{font-size:11px;letter-spacing:3px;color:#544418;text-transform:uppercase;text-align:center;margin:0 0 10px}'+
      '#pe-tm-sheet .dish{font-family:\'Forum\',Georgia,serif;text-align:center;font-size:13.5px;margin:7px 0;color:#3A332C}'+
      '#pe-tm-sheet .dish .d{font-family:\'Outfit\',Arial,sans-serif;font-size:11.5px;color:#574232}'+
      '#pe-tm-sheet .codes{font-family:\'Outfit\',Arial,sans-serif;font-size:11.5px;color:#574232}'+
      '#pe-tm-sheet .ft{text-align:center;font-size:10.5px;color:#574232;margin-top:30px;line-height:1.7}'+
      '#pe-tm-sheet img{display:block;margin:0 auto;max-width:62%;height:auto}'+
      '#pe-tm-sheet [contenteditable]:focus{outline:1px dashed #C9A84C;outline-offset:3px}'+
      peTmCssInk(t.size, '#pe-tm-sheet')+'</style>'+
      '<div id="pe-tm-sheet" style="background:#fff;border:1px solid #E3D8C4;border-radius:4px;padding:'+(t.size==='a5'?'26px 24px':'34px 40px')+';'+
        'max-width:'+(t.size==='a5'?'420':'640')+'px;font-family:\'Outfit\',Arial,sans-serif;color:#3A332C">'+
        peTmSheetHTML(true)+'</div>'+
    '</div>'+
  '</div>';
  return h+'</div></div>';
}
// ── Austin's menu is the standard ───────────────────────────────────────────
// The designed house menu ("Austin menu.pdf") is what a Roberto's set menu is
// supposed to look like, so the app's documents follow it rather than a layout
// we invented: dish and codes on one line, description under it, "(Choose 1)"
// on a choice course, "AED 380/person", and the legend below.
//
// Austin's legend lists only D E H N R S V — no Gluten, and no Alcohol. Our
// data agrees: across every menu and the whole à la carte, G is used ZERO
// times. So G is dropped. A is used exactly once, so it is printed only on a
// menu that actually carries it — an unexplained (A) on a guest's menu is
// worse than a slightly longer line. Austin's own line has a missing pipe
// ("H- Homemade N - Nuts"); that is a typo, not a standard, so it is not copied.
var PE_ALG_NAMES = { A:'Alcohol', D:'Dairy', E:'Egg', H:'Homemade', N:'Nuts', R:'Raw', S:'Shellfish', V:'Vegetarian' };
// Read from the finished page, not from the data behind it. Three different
// documents build their dishes three different ways (a set menu's courses, a
// canapé list, à la carte lines), and a legend derived from any one shape would
// be wrong on the others. Reading what was actually printed cannot list a code
// that is not on the page, or omit one that is.
// Returns the line already prefixed with its break, or nothing at all when the
// document carries no codes — so a menu without allergens gets no empty legend.
function peAlgLegend(html){
  var used = {};
  (String(html||'').match(/class="codes">[^<]*<\/span>/g) || []).forEach(function(s){
    s.replace(/\(([A-Za-z]{1,3})\)/g, function(_, c){ used[c.toUpperCase()] = 1; return ''; });
  });
  var order = ['A','D','E','H','N','R','S','V'].filter(function(k){ return used[k]; });
  if(!order.length) return '';
  return '<br>'+order.map(function(k){ return k+' - '+PE_ALG_NAMES[k]; }).join(' | ');
}
function peChooseLabel(){ return ' (Choose 1)'; }
function pePerPerson(p){ return 'AED '+peMoney(p)+'/person'; }
// ── the one gate ────────────────────────────────────────────────────────────
// A guest never reads "allergens not recorded" — that is our problem, not
// theirs. The consequence is that an incomplete menu must not be able to LEAVE
// the building, or we would simply be hiding the gap instead of closing it.
// Every route to a guest asks this first.
function peMenuAllergenGaps(m){
  var out = [];
  ((m&&m.courses)||[]).forEach(function(c){
    ((c.choose ? c.options : c.items)||[]).forEach(function(o){
      var n = String(o||'').trim(); if(!n) return;
      var alg = peAlgOf(c, n);
      if(!alg.known){
        // The à la carte answers for dishes the menu itself never spelled out.
        var info = peCmDishInfo(n, peCmCourseKind(c));
        if(info && info.allergens && info.allergens.length) return;
      } else return;
      if(out.indexOf(n) < 0) out.push(n);
    });
  });
  return out;
}
// Returns true when it is safe to continue. Names the dishes — never "invalid".
function peMenuSendable(m, what){
  var gaps = peMenuAllergenGaps(m);
  if(!gaps.length) return true;
  peToast('Not '+what+': '+gaps.length+' dish'+(gaps.length>1?'es have':' has')+' no allergens — '+gaps.join(', ')+
    '. Open the menu, add them, and it will go straight out.', true);
  return false;
}
// A printable/PDF copy on the house documents' shell, so it matches the
// proposal and the canapé menu rather than being a screenshot of a web page.
function peCmPrintMenu(key){
  var m = peSetMenuByKey(key); if(!m) return;
  if(!peMenuSendable(m, 'printed')) return;
  var body = '<div class="brand">'+peLogoImg()+'</div><div class="rule"></div>'+
    '<h2>'+peEsc(m.name)+'</h2>'+
    (m.price!=null ? '<div class="sub">'+pePerPerson(m.price)+'</div>' : '');
  (m.courses||[]).forEach(function(c){
    body += '<div class="sec">'+peEsc(c.name)+(c.choose?peChooseLabel():'')+'</div>';
    var stored = c.desc||{};
    ((c.choose ? c.options : c.items)||[]).forEach(function(o){
      // Codes after the name, description underneath — the house layout, and
      // the same shape peQuickPrint uses for canapés.
      // The menu's OWN text wins; the à la carte only fills a gap.
      var info = stored[o] ? null : peCmDishInfo(o, peCmCourseKind(c));
      var alg  = peAlgOf(c, o);
      if(!alg.known && info && info.allergens && info.allergens.length){
        alg = { known:true, list:info.allergens };
      }
      var line = stored[o] ? peDescOf(c, o) : ((info && info.desc) ? info.desc : '');
      // A GUEST NEVER READS OUR GAP. A dish we have not recorded simply shows
      // no codes; the footer already carries the line that is true for every
      // dish — ask your waiter. The alarm belongs inside: peMenuAllergenGaps
      // stops an incomplete menu being printed or sent at all.
      var codes = alg.known
        ? (alg.list.length ? '('+alg.list.join(')(')+')' : '')
        : '';
      body += '<div class="dish">'+peEsc(o)+(codes?' <span class="codes">'+peEsc(codes)+'</span>':'')+
        (line?'<br><span class="d">'+peEsc(line)+'</span>':'')+'</div>';
    });
  });
  body += '<div class="ft">Our Chefs will do their best to accommodate your dietary requirements, please inform your waiter.<br>'+
    (m.price!=null?'All prices are in AED inclusive of 5% VAT, 7% DIFC Authority Fee and 10% Service Charge.':'')+
    peAlgLegend(body)+'</div>';
  pePrintHTML(peDocShell(m.name, body));
}
// Email goes through the one guest-send card that already exists — this ticks
// the menu there and takes her to it, rather than growing a second send form
// that could drift from the first.
function peCmEmail(key){
  peState.mpPreTick = key;
  peState.packsTab = 'menus';
  peGo('packs');
  peToast('Ticked below — add the guest’s name and email, then Send email');
}
// Delete a menu she built. A menu that is the food on a booking is NOT
// deletable: the booking stores only its key, so removing the row would leave
// that event with a menu that cannot be resolved — the proposal and the kitchen
// brief would simply lose their food.
async function peCmDelete(key){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var m = peSetMenuByKey(key); if(!m) return;
  var used = (peState.events||[]).filter(function(e){ return e.set_menu && e.set_menu.key===key; });
  if(used.length){
    var names = used.map(function(e){ return e.client_name||'a booking'; }).join(', ');
    peToast('Can’t delete — it’s the food on '+names+'. Remove the set menu there first.', true);
    return;
  }
  var ok = await peConfirm({ title:'Delete this menu?',
    body:'“'+m.name+'” will be removed. Any WhatsApp link already sent for it will stop working.',
    ok:'Delete', cancel:'Keep it', danger:true });
  if(!ok){ renderMain(); return; }
  var r = await sb.from('event_set_menus').delete().eq('key', key);
  if(r.error){ peToast('NOT deleted — '+String(r.error.message||'').slice(0,110), true); return; }
  peState.setMenus = (peState.setMenus||[]).filter(function(x){ return x.key!==key; });
  peToast('Deleted ✓');
  renderMain();
}
// Save as a normal event_set_menus row flagged is_custom — see the SQL header
// for why that beats a table of its own.
async function peCmSave(){
  var cm = peState.cm; if(!cm) return;
  if(peCmProblems().length) return;
  // Saving a customised menu REPLACES the booking's set_menu. If the guest has
  // already sent their per-course numbers, those cannot survive — a customised
  // menu has different courses — and this used to happen silently, leaving the
  // prep sheet and the kitchen email printing "—" against every option.
  // Asked BEFORE the menu row is written, so cancelling leaves nothing behind.
  var prevEv = cm.eventId ? peEvById(cm.eventId) : null;
  var prevSm = (prevEv && prevEv.set_menu) || null;
  var prevChoices = (prevSm && prevSm.choices) ? Object.keys(prevSm.choices).length : 0;
  if(prevChoices){
    if(!(await peConfirm({
      title:'The guest has already sent their numbers',
      html:'This booking holds <b>'+prevChoices+'</b> course choice'+(prevChoices>1?'s':'')+
        ' the guest sent in. A customised menu has different courses, so those numbers cannot carry over — they will be cleared.'+
        '<br><br>Their note is kept. You can pull the numbers back in afterwards with <b>“Check for the guest’s numbers”</b>.'+
        '<br><br>Build the customised menu anyway?',
      ok:'Yes, customise', cancel:'Keep their numbers', danger:true}))){
      return;
    }
  }
  var t = peCmTotals();
  peState.cmBusy = true; renderMain();
  try{
    var courses = cm.courses.map(function(c){
      var names = c.lines.map(function(l){ return String(l.name||'').trim(); }).filter(Boolean);
      if(!names.length) return null;
      var out = c.choose ? { name:(c.name||'Choice'), choose:1, options:names }
                         : { name:(c.name||'Course'), items:names };
      // The description + allergen codes travel WITH the menu, in the shape
      // client-setmenu.html already renders — so the guest page shows them
      // without having to look every dish up again.
      var inh = {}, inhA = {};
      c.lines.forEach(function(l){
        var nm = String(l.name||'').trim();
        if(l.inherited) inh[nm] = l.inherited;
        if(l.inheritedAlg) inhA[nm] = l.inheritedAlg;
      });
      var dd = peCmCourseDesc(out.name, names, inh, inhA);
      if(Object.keys(dd.desc).length) out.desc = dd.desc;
      if(Object.keys(dd.allg).length) out.allg = dd.allg;
      return out;
    }).filter(Boolean);
    var key = 'custom-'+String(cm.basedOn||'menu')+'-'+Math.random().toString(36).slice(2,8);
    var row = {
      key: key,
      name: String(cm.name).trim(),
      price_pp: t.price,
      courses: courses,
      line: peSmSummary(courses),
      is_custom: true,
      based_on: cm.basedOn || null,
      event_id: cm.eventId || null,
      price_mode: cm.priceMode,
      detail: { swaps:t.swaps, adds:t.adds, base:t.base, supplements:t.supp, note:cm.note||'' },
      created_by: peActor()
    };
    var r = await sb.from('event_set_menus').insert(row).select().single();
    if(r.error) throw r.error;
    peState.setMenus = (peState.setMenus||[]).concat([r.data]);
    // On a booking: this becomes the food, exactly as applying a set menu does.
    // The guest's note travels in set_menu.note, which the proposal prints as
    // "Special arrangements" and the kitchen brief prints in red.
    if(cm.eventId){
      var sm = { key:key, choices:{} };
      // The note is the one thing that MUST survive — it is usually the guest's
      // allergy, and it is what the kitchen brief prints in red. Fall back to the
      // note already on the booking if she cleared the box.
      var carriedNote = cm.note || (prevSm && prevSm.note) || '';
      if(carriedNote) sm.note = carriedNote;
      var patch = { set_menu:sm, package_label:row.name, food_price_pp:t.price,
                    updated_at:new Date().toISOString() };
      var u = await sb.from('events_desk').update(patch).eq('id', cm.eventId);
      if(u.error) throw u.error;
      var ev = peEvById(cm.eventId);
      if(ev){ ev.set_menu = sm; ev.package_label = row.name; ev.food_price_pp = t.price; }
      await sb.from('event_log').insert({ event_id:cm.eventId, action:'edited', actor:peActor(),
        detail:('customised menu applied — '+row.name+' at AED '+t.price+'/guest'+
                (t.swaps.length?', '+t.swaps.length+' swap'+(t.swaps.length>1?'s':''):'')+
                (t.adds.length?', '+t.adds.length+' addition'+(t.adds.length>1?'s':''):'')).slice(0,400) });
    }
    peState.cm = null; peState.cmBusy = false;
    // Say what happens next. "Saved ✓" on its own leaves her wondering how the
    // guest ever sees it.
    peToast(cm.eventId
      ? 'Saved ✓ — it’s the food on that booking, and it goes out with the proposal'
      : 'Saved ✓ — tick it under “Set menus & beverage” to send it to a guest');
    if(cm.eventId) peGo('event', cm.eventId); else renderMain();
  }catch(err){
    peState.cmBusy = false; renderMain();
    peToast('NOT saved — '+String(err&&err.message||err).slice(0,120), true);
  }
}
function peSelLinks(kind){
  return '<span style="font-size:11px;color:#4F4535">tick <span style="color:#400207;text-decoration:underline;cursor:pointer" onclick="peMpSelectAll(\''+kind+'\',true)">all</span> · <span style="color:#400207;text-decoration:underline;cursor:pointer" onclick="peMpSelectAll(\''+kind+'\',false)">none</span></span>';
}
// A whole course in one tap — sending "the Secondi" is the common case, and
// ticking eleven boxes for it is not a workflow.
function peMpSelectSection(section){
  var any = false;
  document.querySelectorAll('.pe-mp-check[data-kind=alc]').forEach(function(el){
    if(el.getAttribute('data-section')===section && !el.checked) any = true;
  });
  document.querySelectorAll('.pe-mp-check[data-kind=alc]').forEach(function(el){
    if(el.getAttribute('data-section')===section) el.checked = any;
  });
  peMpCount();
}
function peMpSelectAll(kind, on){
  document.querySelectorAll('.pe-mp-check[data-kind='+kind+']').forEach(function(el){ el.checked = !!on; });
  peMpCount();
}
function peMpCount(){
  var t = peMpTicked();
  var n = t.food.length + t.bev.length + (t.alc||[]).length + (t.pack||[]).length;
  var el = document.getElementById('pe-mp-count');
  if(el) el.innerHTML = n ? 'Will send: <b style="color:#400207">'+peEsc(peMpSummary(t))+'</b> — by email, or one WhatsApp with one link.'
                          : 'Nothing ticked yet — tick at least one menu or package above.';
  var btn = document.getElementById('pe-mp-send');
  if(btn) btn.disabled = !n;
  var wa = document.getElementById('pe-mp-wa');
  if(wa) wa.disabled = !n;
}
function peRenderPacksLibView(){
  var h = peHeader('packs');
  h += '<div style="font-size:12px;color:#4F4535;margin-bottom:10px;cursor:pointer" onclick="peGo(\'packs\')">← Menu packages</div>';
  h += '<div style="font-size:12px;color:#4F4535;margin-bottom:10px">Ready-made canapé packages (like Canape Cortile) that start a quotation with one tap.</div>';
  h += peRenderPackLib();
  return h+PE_FOOT;
}
function peMenuPackEmailForm(){
  if(!peCanEdit()) return '';   // read-only users browse the menus; sending is the editors'
  return '<div class="pe-card" style="border-color:rgba(201,168,76,0.5)"><b style="color:#400207">Send to the guest</b>'+
    '<div style="font-size:11px;color:#4F4535;margin:2px 0 10px">Tick above once, then choose how it travels. <b>Email</b> — ONE branded email with everything ticked, you are copied and their reply comes to you. <b>WhatsApp</b> — ONE message with ONE link to a page holding everything ticked, food and beverage together.</div>'+
    '<div class="pe-grid2"><div><div class="pe-lbl">Guest name</div><input class="pe-in" id="pe-mp-name" placeholder="e.g. Sara"></div>'+
    '<div><div class="pe-lbl">Guest email (for email)</div><input class="pe-in" id="pe-mp-email" type="text" placeholder="guest@email.com, planner@email.com"></div></div>'+
    '<div style="margin-top:8px"><div class="pe-lbl">Guest mobile (for WhatsApp)</div><input class="pe-in" id="pe-mp-phone" type="tel" placeholder="e.g. 050 123 4567 — a UAE number needs no +971"></div>'+
    '<div style="margin-top:8px"><div class="pe-lbl">Personal note (optional — appears in the email and the WhatsApp message)</div>'+
    '<input class="pe-in" id="pe-mp-note" placeholder="e.g. It was lovely speaking with you today — as promised…"></div>'+
    '<div style="margin-top:10px;background:#F4EEE1;border:1px dashed #C9B48E;border-radius:10px;padding:10px 12px"><label style="font-size:12.5px;color:#6B4A33;cursor:pointer;display:inline-flex;align-items:center;gap:8px">'+
      '<input type="checkbox" id="pe-mp-noprice" style="accent-color:#400207"> <b style="color:#400207">Send without prices</b> — menu &amp; beverage only</label>'+
      '<div style="font-size:11px;color:#4F4535;margin-top:4px">For minimum-spend clients: the guest sees the dishes and packages, no per-person price. The price lives in the proposal / contract.</div></div>'+
    '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
    '<button class="pe-btn" id="pe-mp-send" onclick="peSendMenuPack()" disabled>Send email</button>'+
    '<button class="pe-btn sec" id="pe-mp-wa" onclick="peSendMenuPackWa()" disabled>Send by WhatsApp</button></div>'+
    '<div style="font-size:11.5px;color:#4F4535;margin-top:8px" id="pe-mp-count">Nothing ticked yet — tick at least one menu or package above.</div></div>';
}
// What Valentina has ticked, in the order the screen shows them — read once and
// used by both doors, so email and WhatsApp can never disagree about what's sent.
function peMpTicked(){
  var food = [], bev = [], alc = [], pack = [];
  document.querySelectorAll('.pe-mp-check:checked').forEach(function(el){
    var k = el.getAttribute('data-kind');
    (k==='food' ? food : k==='alc' ? alc : k==='pack' ? pack : bev).push(el.getAttribute('data-key'));
  });
  return { food:food, bev:bev, alc:alc, pack:pack };
}
// Nothing ticked is nothing ticked, whichever card it was on — every door out of
// this screen asks this one question so they can't disagree.
function peMpAny(t){ return !!(t.food.length || t.bev.length || (t.alc||[]).length || (t.pack||[]).length); }
function peMpSummary(t){
  var parts = [];
  if(t.food.length) parts.push(t.food.length+' set menu'+(t.food.length>1?'s':''));
  if((t.pack||[]).length) parts.push(t.pack.length+' canapé package'+(t.pack.length>1?'s':''));
  if((t.alc||[]).length) parts.push(t.alc.length+' à la carte dish'+(t.alc.length>1?'es':''));
  if(t.bev.length) parts.push(t.bev.length+' beverage package'+(t.bev.length>1?'s':''));
  return parts.join(' + ');
}
// The ONE guest link: a branded page carrying every ticked menu and package.
// One link, however many she ticked — never one WhatsApp per menu.
function peMenuPackUrl(t, name, noPrice){
  var p = [];
  if(t.food.length) p.push('food='+t.food.map(encodeURIComponent).join(','));
  if((t.pack||[]).length) p.push('pack='+t.pack.map(encodeURIComponent).join(','));
  if((t.alc||[]).length) p.push('alc='+t.alc.map(encodeURIComponent).join(','));
  if(t.bev.length)  p.push('bev='+t.bev.map(encodeURIComponent).join(','));
  if(name) p.push('n='+encodeURIComponent(name));
  if(noPrice) p.push('np=1');
  // The guest can tick the à la carte dishes they'd like and send them back.
  // 'pick' carries the reply address: an event's own token when she sent it
  // from a booking, so the reply lands on that booking; otherwise a fresh one.
  if((t.alc||[]).length) p.push('pick='+encodeURIComponent(peMpPickToken()));
  return peBaseUrl()+'client-menus.html?'+p.join('&');
}
// One reply token per send. Uses the booking's own token when there is one, so
// the guest's picks arrive against that event rather than floating free.
function peMpPickToken(){
  var e = peState.currentId ? peEvById(peState.currentId) : null;
  if(e && e.client_token) return e.client_token;
  if(!peState.mpToken) peState.mpToken = 'alc'+Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10);
  return peState.mpToken;
}
// A UAE mobile typed the way people actually type it (050…, 00971…, +971…) all
// reach the same number. Returns '' when it can't be one.
function peWaDigits(phone){
  var d = String(phone==null?'':phone).replace(/[^0-9]/g,'');
  if(d.indexOf('00')===0) d = d.slice(2);
  if(d.length && d[0]==='0') d = '971'+d.slice(1);
  if(d.length <= 9) d = '971'+d;
  return d.length >= 11 ? d : '';
}
async function peSendMenuPackWa(){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var g = function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
  var phone = g('pe-mp-phone'), name = g('pe-mp-name'), note = g('pe-mp-note');
  var pEl = document.getElementById('pe-mp-phone');
  if(!phone){ peToast('Type the guest’s mobile first', true); peInlineErr(pEl,'Type the guest’s mobile first.'); return; }
  var digits = peWaDigits(phone);
  if(!digits){ peToast('That mobile looks too short — check the number', true); peInlineErr(pEl,'That doesn’t look like a full mobile number.'); return; }
  peInlineErr(pEl,'');
  var noPriceElW = document.getElementById('pe-mp-noprice');
  var noPrice = !!(noPriceElW && noPriceElW.checked);
  var t = peMpTicked();
  if(!peMpAny(t)){ peToast('Tick at least one menu, dish or package to send', true); return; }
  // The guest page reads canapé packages from a guest-safe view that only exists
  // once foh-events-canape-public.sql has been run. Rather than send a link that
  // quietly arrives without the canapés, say so and let her choose.
  if((t.pack||[]).length && !(await peCanapeLinkReady())){
    if(!(await peConfirm({
      title:'The canapés can’t travel on a WhatsApp link yet',
      html:'One database step is still to be run, so the guest page can’t show canapé packages. The link would arrive with '+
        peEsc(peMpSummary({food:t.food, bev:t.bev, alc:t.alc, pack:[]})||'nothing else')+' and <b>no canapés</b>.<br><br>'+
        '<b>Send by email instead</b> — the email carries the canapés in full, written out canapé by canapé.',
      ok:'Send the link anyway', cancel:'I’ll use email', danger:true }))) return;
  }
  var msg = 'Ciao'+(name?' '+name.split(' ')[0]:'')+'! Thank you for thinking of Roberto’s for your occasion.'+
    (note?'\n\n'+note:'')+
    '\n\nHere is everything for your occasion ('+peMpSummary(t)+'), on one page:\n'+
    peMenuPackUrl(t, name, noPrice)+
    '\n\nIt will be our pleasure — '+peSignOff();
  window.open('https://wa.me/'+digits+'?text='+encodeURIComponent(msg), '_blank');
  // WhatsApp opens with the message written — she still presses send there, so
  // this never claims it has gone.
  peToast('WhatsApp opened for '+phone+' with '+peMpSummary(t)+' — press send in WhatsApp to deliver it');
}
// Asked once per session, and only when a canapé package is actually ticked for a
// WhatsApp link — an existing view answers instantly and is never asked again.
async function peCanapeLinkReady(){
  if(peState.canapeViewOk != null) return peState.canapeViewOk;
  try{
    var r = await sb.from('event_packages_public').select('id').limit(1);
    peState.canapeViewOk = !r.error;
  }catch(e){ peState.canapeViewOk = false; }
  return peState.canapeViewOk;
}
function peBaseUrl(){ return location.origin + location.pathname.replace(/[^\/]*$/, ''); }
function peGuestEmailHTML(title, intro, name, note, inner, noPrice){
  var body = '<div class="brand">'+peLogoImg()+'</div><div class="rule"></div>'+
    '<h2>'+peEsc(title)+'</h2>'+
    '<div class="sub">DIFC, Dubai · private dining &amp; events</div>'+
    '<p style="font-size:13.5px;margin-top:24px">Dear '+peEsc(name||'guest')+',</p>'+
    (note?'<p style="font-size:13.5px">'+peEsc(note)+'</p>':'')+
    '<p style="font-size:13.5px">'+intro+'</p>'+
    inner+
    '<p style="font-size:13.5px;margin-top:26px">Simply reply to this email to check availability or tailor anything to your occasion — it will be our pleasure.</p>'+
    '<div class="ft">'+(noPrice?'':'All prices are in AED and inclusive of 5% VAT, 7% DIFC Authority Fee and 10% Service Charge.<br>')+
    'Our Chefs will do their best to accommodate your dietary requirements.</div>';
  return peDocShell(title, body);
}
function peMailSection(label){
  return '<div style="text-align:center;margin:30px 0 2px"><span style="font-size:11px;letter-spacing:3px;color:#544418;text-transform:uppercase">'+label+'</span></div>';
}
function peMenuPackEmailHTML(foodKeys, bevKeys, name, note, noPrice, alcIds, pickUrl, packIds){
  alcIds = alcIds || [];
  packIds = packIds || [];
  var packs = packIds.map(peCanapePackById).filter(Boolean);
  // Include unpriced menus too — a no-price send (minimum-spend client) needs them,
  // and a priced send simply omits the price line for any that has none.
  // Resolve by KEY, not by filtering the designed-menu list — a menu Valentina
  // customised is a real menu she must be able to send, and it is deliberately
  // absent from that list. peSetMenuByKey finds both.
  var menus = foodKeys.map(peSetMenuByKey).filter(Boolean);
  var bevs = bevKeys.map(peBevById).filter(Boolean);
  var both = (menus.length || packs.length) && bevs.length;
  // More than one kind in the email means each kind is announced, so the guest
  // can tell the canapés from the set menus without reading every line.
  var kinds = [menus.length, packs.length, alcIds.length, bevs.length].filter(Boolean).length;
  var multi = kinds > 1;
  var title = both ? 'Menus & Beverage Packages'
            : menus.length ? 'Set Menus'
            : packs.length ? 'Canapé Packages'
            : alcIds.length ? 'Our À La Carte'
            : 'Beverage Packages';
  var intro = 'Thank you for thinking of Roberto’s for your occasion. ' + (both
    ? 'Please find our menus and beverage packages below — the button under each set menu opens the full menu.'
    : menus.length ? 'Please find our set menus below — the button under each one opens the full menu.'
    : packs.length ? 'Please find our canapé packages below, with everything served in each one.'
    : alcIds.length ? 'Please find our à la carte below.'
                   : 'Please find our beverage packages below.');
  var inner = '';
  if(menus.length){
    if(multi) inner += peMailSection('The food — set menus');
    inner += menus.map(function(m){
      // Menus with a designed PDF link to it; menus without one (chef-added)
      // print their courses inline so the guest still sees the full menu.
      var extra = m.pdf
        ? '<div style="text-align:center;margin:10px 0 20px"><a href="'+(/^https?:/i.test(m.pdf)?m.pdf:peBaseUrl()+m.pdf)+'" style="display:inline-block;background:#400207;color:#E8D9C7;padding:9px 24px;border-radius:20px;text-decoration:none;font-size:12.5px;letter-spacing:1px">View the full menu</a></div>'
        // This path used to print course names and a run-on list of dishes with
        // NO allergens at all — the only guest document that showed none. Same
        // shape as the printed menu now: dish, codes, description.
        : (m.courses||[]).map(function(c){
            var stored = c.desc||{};
            return '<div class="sec">'+peEsc(c.name)+(c.choose?peChooseLabel():'')+'</div>'+
              (((c.choose ? c.options : c.items)||[]).map(function(o){
                var info = stored[o] ? null : peCmDishInfo(o, peCmCourseKind(c));
                var alg  = peAlgOf(c, o);
                if(!alg.known && info && info.allergens && info.allergens.length) alg = { known:true, list:info.allergens };
                var line = stored[o] ? peDescOf(c, o) : ((info && info.desc) ? info.desc : '');
                var codes = (alg.known && alg.list.length) ? '('+alg.list.join(')(')+')' : '';
                return '<div class="dish">'+peEsc(o)+(codes?' <span class="codes">'+peEsc(codes)+'</span>':'')+
                  (line?'<br><span class="d">'+peEsc(line)+'</span>':'')+'</div>';
              }).join(''));
          }).join('');
      var priceTag = (noPrice || m.price==null) ? '' : ' — '+pePerPerson(m.price);
      return '<div class="sec">'+peEsc(m.name)+priceTag+'</div>'+
        '<div class="dish"><span class="d">'+peEsc(m.line||peSmSummary(m.courses))+'</span></div>'+extra;
    }).join('');
  }
  // The canapé packages, written out canapé by canapé. A package is a list of
  // dishes and nothing else, so unlike a set menu there is no PDF to link to —
  // the guest has to be able to read what they are getting here.
  if(packs.length){
    if(multi) inner += peMailSection(packs.length>1 ? 'The canapés — packages' : 'The canapés');
    inner += packs.map(function(p){
      var priceTag = (noPrice || p.price_pp==null) ? '' : ' — '+pePerPerson(p.price_pp);
      var dishes = (p.dish_ids||[]).map(peDishById).filter(Boolean);
      return '<div class="sec">'+peEsc(p.name)+priceTag+'</div>'+
        (dishes.length
          ? dishes.map(function(d){
              return '<div class="dish">'+peEsc(d.name)+peEsc(peCmAlgCodes(d.allergens))+
                (d.description?'<br><span class="d">'+peEsc(d.description)+'</span>':'')+'</div>';
            }).join('')
          : '');
    }).join('');
  }
  // The à la carte dishes she ticked, grouped the way the menu is printed, with
  // the English description and the allergens — the same standard as every
  // other menu we send.
  if(alcIds.length){
    var picked = alcIds.map(peAlcById).filter(Boolean);
    if(picked.length){
      inner += peMailSection('À la carte');
      peAlcSections().forEach(function(s){
        var rows = picked.filter(function(a){ return a.section===s; });
        if(!rows.length) return;
        inner += '<div class="sec">'+peEsc(peAlcSecLabel(s))+'</div>'+
          rows.map(function(a){
            var pr = (noPrice || peAlcPrice(a)==null) ? '' : ' — AED '+peMoney(peAlcPrice(a))+(a.unit==='per piece'?' per piece':'');
            return '<div class="dish">'+peEsc(a.name)+peEsc(peCmAlgCodes(a.allergens))+peEsc(pr)+
              (a.description?'<br><span class="d">'+peEsc(a.description)+'</span>':'')+'</div>';
          }).join('');
      });
      if(pickUrl){
        inner += '<div style="text-align:center;margin:16px 0 20px"><a href="'+pickUrl+'" style="display:inline-block;background:#400207;color:#E8D9C7;padding:9px 24px;border-radius:20px;text-decoration:none;font-size:12.5px;letter-spacing:1px">Choose your dishes</a></div>';
      }
    }
  }
  if(bevs.length){
    if(multi) inner += peMailSection('The beverages — packages');
    inner += bevs.map(function(b){
      var priceTag = (noPrice || b.price_pp==null) ? '' : ' · '+pePerPerson(b.price_pp);
      var extra = b.pdf
        ? '<div style="text-align:center;margin:10px 0 20px"><a href="'+(/^https?:/i.test(b.pdf)?b.pdf:peBaseUrl()+b.pdf)+'" style="display:inline-block;background:#400207;color:#E8D9C7;padding:9px 24px;border-radius:20px;text-decoration:none;font-size:12.5px;letter-spacing:1px">View the beverage package</a></div>'
        : '';
      return '<div class="sec">'+peEsc(b.name)+(b.duration_hours?' — '+b.duration_hours+' hours':'')+priceTag+'</div>'+
        (b.includes?'<div class="dish"><span class="d">'+peEsc(b.includes)+'</span></div>':'')+extra;
    }).join('');
  }
  return peGuestEmailHTML(title, intro, name, note, inner, noPrice);
}
async function peSendMenuPack(){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var g = function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
  var email = g('pe-mp-email'), name = g('pe-mp-name'), note = g('pe-mp-note');
  if(!email){ peToast('Type the guest’s email first', true); peInlineErr(document.getElementById('pe-mp-email'),'Type the guest’s email first.'); return; }
  if(!peEmailsValid(email)){ peToast('An email looks off — check each one, separate several with a comma', true); peInlineErr(document.getElementById('pe-mp-email'),'One of these isn’t a valid email — separate several with a comma.'); return; }
  peInlineErr(document.getElementById('pe-mp-email'),'');
  var noPriceEl = document.getElementById('pe-mp-noprice');
  var noPrice = !!(noPriceEl && noPriceEl.checked);
  var t = peMpTicked(), food = t.food, bev = t.bev, alc = t.alc||[], pack = t.pack||[];
  if(!peMpAny(t)){ peToast('Tick at least one menu, dish or package to send', true); return; }
  // The gate, on the way OUT. A menu whose allergens we have not finished can
  // no longer reach a guest quietly just because the guest-facing text stopped
  // announcing the gap.
  var blocked = food.map(peSetMenuByKey).filter(Boolean).filter(function(m){ return peMenuAllergenGaps(m).length; });
  if(blocked.length){
    var m0 = blocked[0];
    peToast('Not sent — “'+m0.name+'” is missing allergens for: '+peMenuAllergenGaps(m0).join(', ')+
      '. Open it in Set menus, fill them in, and send again.', true);
    return;
  }
  if(!(await peConfirm({title:'Send to the guest?', html:'Send <b>'+peEsc(peMpSummary(t))+'</b> to <b>'+peEsc(email)+'</b> in one email now?'+(noPrice?'<br><span style="color:#854F0B">Without prices — the guest sees the dishes and packages only.</span>':''), ok:'Send email', cancel:'Not yet'}))) return;
  // The sender is copied and set as reply-to, same as client proposals.
  var sender = state.userEmail || 'reservations@robertos.ae';
  var subject = (food.length||alc.length||pack.length) && bev.length ? 'Roberto’s — menus & beverage packages for your occasion'
              : food.length ? 'Roberto’s — our set menus'
              : pack.length ? 'Roberto’s — our canapé packages'
              : alc.length ? 'Roberto’s — our à la carte for your occasion'
              : 'Roberto’s — beverage packages for your occasion';
  var btn = document.getElementById('pe-mp-send'); if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
  try{
    var r = await sb.functions.invoke('send-event-email', { body:{
      to: peSendTo(email, sender), reply_to:sender, from_name:peSenderName(), subject:subject,
      html: peMenuPackEmailHTML(food, bev, name, note, noPrice, alc, alc.length ? peMenuPackUrl(t, name, noPrice) : '', pack)
    }});
    if(r.error || (r.data&&r.data.error)) throw (r.error||r.data.error);
    peToast('Sent to '+email+' ✓ — you are copied and replies come to you');
    if(btn){ btn.disabled=false; btn.textContent='Send email'; }
    var el = document.getElementById('pe-mp-email'); if(el) el.value='';
  }catch(err){
    peToast('NOT sent — '+String(err&&err.message||err).slice(0,120), true);
    if(btn){ btn.disabled=false; btn.textContent='Send email'; }
  }
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
      '<div style="font-size:11px;color:#4F4535;margin:2px 0 10px">Goes live for the events desk the moment you save.</div>'+
      '<div class="pe-grid3">'+
      '<div style="grid-column:1/3"><div class="pe-lbl">Dish name</div><input class="pe-in" id="pe-d-name" value="'+peEsc(ed.name||'')+'"></div>'+
      '<div><div class="pe-lbl">Cost (AED, net)</div><input class="pe-in" id="pe-d-cost" type="number" step="0.01" value="'+peEsc(ed.cost!=null?ed.cost:'')+'"></div>'+
      '</div><div class="pe-grid3" style="margin-top:8px">'+
      '<div><div class="pe-lbl">Category</div><select class="pe-in" id="pe-d-category">'+['Vegetarian','Fish','Beef','Chicken','Dessert'].map(function(c){ return '<option'+(ed.category===c?' selected':'')+'>'+c+'</option>'; }).join('')+'</select></div>'+
      '<div><div class="pe-lbl">Served</div><select class="pe-in" id="pe-d-serve">'+['Cold','Hot','Dessert'].map(function(c){ return '<option'+(ed.serve===c?' selected':'')+'>'+c+'</option>'; }).join('')+'</select></div>'+
      '<div><div class="pe-lbl">Minimum order (pieces)</div><input class="pe-in" id="pe-d-min_order" type="number" value="'+peEsc(ed.min_order!=null?ed.min_order:10)+'"></div>'+
      '</div>'+
      '<div style="margin-top:8px"><div class="pe-lbl">Allergens</div>'+PE_ALL_CODES.map(function(c){
        return '<span class="pe-chip'+(alg.indexOf(c)>=0?' on':'')+'" data-code="'+c+'" onclick="this.classList.toggle(\'on\')">'+c+'</span>';
      }).join('')+'<span style="font-size:10.5px;color:#4F4535;margin-left:6px">D dairy · E egg · G gluten · H homemade · N nuts · R raw · S shellfish · V vegetarian</span></div>'+
      '<div style="margin-top:8px"><div class="pe-lbl">What\'s in it (helps the menu line)</div><input class="pe-in" id="pe-d-notes" placeholder="e.g. burrata from Puglia, confit datterino, aged balsamic" value=""></div>'+
      '<div style="margin-top:10px;background:#F7EEE2;border-radius:10px;padding:11px 12px">'+
      '<div class="pe-lbl" style="color:#574232">Menu line — written for you</div>'+
      '<div style="font-family:Georgia,serif;font-size:13.5px;color:#400207;min-height:18px" id="pe-d-desc-show">'+peEsc(peState.aiDesc!=null?peState.aiDesc:(ed.description||'— tap Write it —'))+'</div>'+
      '<input class="pe-in" id="pe-d-description" style="margin-top:6px" placeholder="or type/edit it here" value="'+peEsc(peState.aiDesc!=null?peState.aiDesc:(ed.description||''))+'">'+
      '<div style="margin-top:6px"><button class="pe-btn sec sm" onclick="peDescribe()" '+(peState.aiBusy?'disabled':'')+'>'+(peState.aiBusy?'Writing…':(peState.aiDesc!=null||ed.description?'Try again':'Write it'))+'</button></div></div>'+
      '<div style="margin-top:8px;font-size:12px;color:#6B4A33" id="pe-d-tier"></div>'+
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="pe-btn" onclick="peSaveDish(\''+(ed.id||'')+'\')">Save dish</button>'+
      '<button class="pe-btn sec" onclick="peState.editDishId=null;peState.aiDesc=null;renderMain()">Cancel</button>'+
      (ed.id?'<button class="pe-btn sec" style="margin-left:auto" onclick="peToggleDish(\''+ed.id+'\','+(ed.active?'false':'true')+')">'+(ed.active?'Pause dish':'Resume dish')+'</button>':'')+
      '</div></div>';
  } else {
    h += '<div style="margin-bottom:10px"><button class="pe-btn" onclick="peState.editDishId=\'new\';peState.aiDesc=null;renderMain()">+ Add a dish</button></div>';
  }
  h += '<div class="pe-card">'+peState.dishes.map(function(d){
    var why = peDishLockReason(peDishUsage(d.id));
    return '<div class="pe-dishrow" style="opacity:'+(d.active?1:.55)+'">'+
      '<span><b>'+peEsc(d.name)+'</b>'+
      (d.active?'':' <span style="font-size:10px;background:#E4DBCC;color:#4E4433;border-radius:8px;padding:2px 7px;font-weight:600">paused</span>')+
      ' <span style="color:#574232;font-size:10.5px">'+peEsc(peAllergenText(d.allergens))+'</span><br>'+
      '<span style="font-size:11px;color:#4F4535">'+peEsc(d.category)+' · '+peEsc(d.serve)+' · '+peEsc(d.tier||'')+' · AED '+peMoney(d.sell_price)+'/pc · cost '+(d.cost!=null?d.cost:'—')+(d.description?' · “'+peEsc(d.description)+'”':' · <span style="color:#B00020">no menu line</span>')+'</span></span>'+
      '<span style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">'+
      '<button class="pe-btn sec sm" onclick="peState.editDishId=\''+d.id+'\';peState.aiDesc=null;renderMain()">Edit</button>'+
      '<button class="pe-btn sec sm" onclick="peToggleDish(\''+d.id+'\','+(d.active?'false':'true')+')">'+(d.active?'Pause':'Resume')+'</button>'+
      (why ? '<span style="font-size:10px;color:#4F4535;max-width:190px;text-align:right;line-height:1.35">'+peEsc(why)+'</span>'
           : '<button class="pe-btn sec sm" style="color:#B00020;border-color:#B00020" onclick="peDeleteDish(\''+d.id+'\')">Delete</button>')+
      '</span></div>';
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
  var on = (active==='true'||active===true);
  var r = await sb.from('event_dishes').update({active:on}).eq('id', id);
  if(r.error){ peToast('NOT changed — check connection', true); return; }
  var d = peDishById(id);
  peState.dishes.forEach(function(x){ if(x.id===id) x.active = on; });
  peState.editDishId = null;
  peToast((d?d.name:'Canapé')+(on?' is back on the list ✓':' paused ✓ — off the events desk, kept for later'));
  renderMain();
}
// Where a canapé is still in use. A package holds dish ids, and every quoted
// event holds line items — delete one of those and the package silently loses a
// canapé while past events lose the dish AND its money from their totals
// (peCalcTotals skips an item whose dish no longer resolves). So delete is
// offered only when both are clear; pause is always safe and always offered.
function peDishUsage(id){
  var packs = peState.packs.filter(function(p){ return (p.dish_ids||[]).indexOf(id) >= 0; })
                           .map(function(p){ return p.name; });
  var evs = 0;
  Object.keys(peState.items||{}).forEach(function(eid){
    var used = (peState.items[eid]||[]).some(function(it){ return it.dish_id===id; });
    if(used) evs++;
  });
  return { packs:packs, events:evs };
}
// The reason a canapé can't be deleted, said out loud in the row itself — never
// a hover tooltip, never a dead grey button with no explanation.
function peDishLockReason(use){
  var bits = [];
  if(use.packs.length) bits.push('in '+use.packs.join(', '));
  if(use.events) bits.push('used by '+use.events+' event'+(use.events>1?'s':''));
  return bits.length ? bits.join(' · ')+' — pause it instead' : '';
}
async function peDeleteDish(id){
  var d = peDishById(id); if(!d) return;
  var use = peDishUsage(id);
  if(use.packs.length || use.events){ peToast(d.name+' is '+peDishLockReason(use), true); return; }
  var ok = await peConfirm({
    title:'Delete '+d.name+'?',
    html:'It goes off the canapé list for everyone, for good. No package and no event uses it, so nothing else changes.<br><br>If you may want it back one day, <b>pause</b> it instead — paused canapés stay here and never reach the events desk.',
    ok:'Delete for good', cancel:'Keep it', danger:true
  });
  if(!ok) return;
  var r = await sb.from('event_dishes').delete().eq('id', id);
  if(r.error){ peToast('NOT deleted — '+String(r.error&&r.error.message||'').slice(0,90), true); return; }
  peState.dishes = peState.dishes.filter(function(x){ return x.id!==id; });
  peState.editDishId = null;
  peToast(d.name+' deleted ✓');
  renderMain();
}
// ── set-menu library (Chef Corner → Set menus) ───────────────────────────────
// Chef builds the menu + courses (open to whoever opens Chef Corner); the
// price/guest is editable only by the desk editors — an unpriced menu shows
// "price pending" and can't be quoted. Reuses the event_set_menus table.
function peSmRawById(id){ for(var i=0;i<peState.setMenus.length;i++){ if(peState.setMenus[i].id===id) return peState.setMenus[i]; } return null; }
function peSmDraftFrom(courses){
  return (courses||[]).map(function(c){
    // desc = {dish name: one-line English description}, allg = {dish name:
    // ["D","E"]} — both shown to the guest on the pick-your-numbers page and
    // carried through the editor untouched. allg MUST travel with desc: drop it
    // here and an edit quietly strips the allergens off a live menu.
    return { name:(c.name||''), choose:!!c.choose, lines:((c.choose?(c.options||[]):(c.items||[]))||[]).slice(), desc:(c.desc||null), allg:(c.allg||null) };
  });
}
// smKnown is per-menu — it must never carry one menu's dishes into the next.
function peSmNew(){ peState.editSetMenuId='new'; peState.smDraft=[{name:'',choose:false,lines:[]}]; peState.smName=''; peState.smText=''; peState.smPdf=null; peState.smBrandDoc=false; peState.smCost=null; peState.smPrice=null; peState.smKnown=null; renderMain(); }
function peSmEdit(id){ var m=peNormSM(peSmRawById(id)); peState.editSetMenuId=id; peState.smDraft=peSmDraftFrom(m&&m.courses); peState.smKnown=null; peSmSplitCodesFromNames(); peSmRemember(); peState.smName=(m&&m.name)||''; peState.smText=''; peState.smPdf=null; peState.smBrandDoc=false; peState.smCost=null; peState.smPrice=null; renderMain(); }
function peSmCancel(){ peState.editSetMenuId=null; peState.smDraft=null; peState.smName=''; peState.smText=''; peState.smPdf=null; peState.smBrandDoc=false; peState.smCost=null; peState.smPrice=null; peState.smKnown=null; renderMain(); }
// ── chef uploads the designed menu PDF ───────────────────────────────────────
// One upload does two jobs: the text is read out and laid into courses by the
// same "Structure it" flow the paste box uses, and the file itself is stored
// so the guest email gets its "View the full menu" button.
function peLoadPdfJs(){
  return new Promise(function(res, rej){
    if(window.pdfjsLib) return res(window.pdfjsLib);
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = function(){
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      res(window.pdfjsLib);
    };
    s.onerror = function(){ rej(new Error('the PDF reader could not load — check the connection')); };
    document.head.appendChild(s);
  });
}
async function peSmPdfText(file){
  var lib = await peLoadPdfJs();
  var doc = await lib.getDocument({data: await file.arrayBuffer()}).promise;
  var text = '';
  for(var i=1;i<=doc.numPages;i++){
    var tc = await (await doc.getPage(i)).getTextContent();
    text += tc.items.map(function(it){ return it.str; }).join(' ')+'\n';
  }
  return text.trim();
}
async function peSmPdfUpload(input){
  var f = input.files && input.files[0]; if(!f) return;
  input.value = '';
  if(!/pdf$/i.test(f.type||'') && !/\.pdf$/i.test(f.name||'')){ peToast('That file is not a PDF — export the menu as PDF first', true); return; }
  if(f.size > 8*1024*1024){ peToast('The PDF is over 8 MB — export a lighter version and try again', true); return; }
  peSmSync(); peState.smBusy = true; renderMain();
  var text = '';
  try{ text = await peSmPdfText(f); }
  catch(err){
    peState.smBusy = false; renderMain();
    peToast('Could not read the PDF — paste the menu text instead. '+String(err&&err.message||'').slice(0,60), true);
    return;
  }
  if(!text){ peState.smBusy = false; renderMain(); peToast('The PDF has no readable text (it may be a scan) — paste the menu text instead', true); return; }
  // Attach the file (non-fatal: without the storage bucket the menu still
  // saves and works — it just has no "View the full menu" button yet).
  peState.smPdf = null;
  try{
    var path = peSmSlug(peState.smName || f.name.replace(/\.pdf$/i,'')) + '.pdf';
    var up = await sb.storage.from('event-menus').upload(path, f, {contentType:'application/pdf', upsert:true});
    if(up.error) throw up.error;
    var pub = sb.storage.from('event-menus').getPublicUrl(path);
    peState.smPdf = (pub && pub.data && pub.data.publicUrl) || null;
  }catch(err2){
    peToast('Menu text read ✓ — but the PDF could not be attached (needs event-menus-bucket.sql). '+String(err2&&err2.message||'').slice(0,60), true);
  }
  peState.smText = text;
  peState.smBrandDoc = false;   // a designed PDF wins over the house template
  peState.smBusy = false;
  renderMain();
  await peStructureMenu();
  if(!(peState.smName||'').trim()){
    peState.smName = f.name.replace(/\.pdf$/i,'').replace(/[_-]+/g,' ').trim();
    renderMain();
  }
  if(peState.smPdf) peToast('PDF attached ✓ — check the courses below, then save');
}
// ── chef uploads a Word menu ─────────────────────────────────────────────────
// Most menus are written in Word long before anyone designs a PDF. A .docx has
// no designed artwork to attach, so the app does that half itself: it reads the
// courses out of the document and then publishes the menu on the house guest
// template (client-setmenu.html — the same wordmark, gold course headings and
// footer as every other document we send). The guest still gets a "View the
// full menu" button; it just opens a Roberto's-branded page instead of a file,
// and it stays correct when the chef edits a dish later.
function peLoadJsZip(){
  return new Promise(function(res, rej){
    if(window.JSZip) return res(window.JSZip);
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = function(){ window.JSZip ? res(window.JSZip) : rej(new Error('the Word reader did not start')); };
    s.onerror = function(){ rej(new Error('the Word reader could not load — check the connection')); };
    document.head.appendChild(s);
  });
}
function peXmlDecode(s){
  return String(s==null?'':s)
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
    .replace(/&#x([0-9a-f]+);/gi, function(_,h){ return String.fromCharCode(parseInt(h,16)); })
    .replace(/&#(\d+);/g, function(_,d){ return String.fromCharCode(parseInt(d,10)); })
    .replace(/&amp;/g,'&');
}
// A .docx is a zip; word/document.xml holds the text. One <w:p> is one line —
// which is also one table cell, so a menu laid out in a Word table still reads
// out course by course. Tracked deletions are <w:delText> and never <w:t>, so
// text the chef struck through is correctly left out.
function peDocxToText(xml){
  var out = [];
  String(xml||'').split(/<\/w:p>/).forEach(function(p){
    p = p.replace(/<w:(?:tab|br)\s*\/>/g, '<w:t> </w:t>');
    var line = '', re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, m;
    while((m = re.exec(p))) line += peXmlDecode(m[1]);
    line = line.replace(/\s+/g,' ').trim();
    if(line) out.push(line);
  });
  return out.join('\n').trim();
}
async function peSmDocxText(file){
  var JSZipLib = await peLoadJsZip();
  var zip = await JSZipLib.loadAsync(await file.arrayBuffer());
  var entry = zip.file('word/document.xml');
  if(!entry) throw new Error('this is not a Word document');
  return peDocxToText(await entry.async('string'));
}
// A Word menu arrives as dish names and nothing else — no description, no
// allergens. The guest page refuses to stay silent about that: a dish with
// nothing recorded cannot be printed or sent at all. So before the chef ever sees the
// menu, fill in every dish our own à la carte already knows — the same lookup
// Valentina's customised menus use — and name the ones it doesn't, so the gap
// is his to close rather than the guest's to discover.
// The chef writes the allergens INTO the menu — "Ricciola (R)(S)", "Branzino(D)(N)".
// Those codes are the declaration for THIS menu and nothing may outrank them, so
// they are read straight out of the uploaded text with no model in the way: the
// dish name, then any (X) groups that follow it. This runs before the à la carte
// fill, which then cannot touch a dish the document has already spoken for.
// Codes belong in the allergen field, NEVER in a dish's name. A Word menu
// writes "Spaghetto alle vongole(S)" and the layout step can keep the codes
// glued to the name — and then the whole chain fails quietly: the harvest looks
// for codes AFTER the name and finds none, so the à la carte is allowed to
// answer instead, and it answered "no allergens" for a Costata di Angus whose
// own name said (D)(N). The guest also reads the codes twice, once as part of
// the dish's name.
//
// So split them off before anything else looks at the menu. Codes written on
// the name are the chef's own declaration for THIS menu and outrank the à la
// carte, exactly like codes written after it.
function peSmSplitCodesFromNames(){
  var moved = 0;
  (peState.smDraft||[]).forEach(function(c){
    var desc = c.desc||{}, allg = c.allg||{}, nd = {}, na = {};
    c.lines = (c.lines||[]).map(function(raw){
      var n = String(raw||'').trim(); if(!n) return n;
      var codes = [];
      // Only letter codes — "Costata di Angus (300g)" keeps its weight.
      var clean = n.replace(/\s*\(([A-Za-z]{1,3})\)/g, function(_, code){ codes.push(code.toUpperCase()); return ''; }).trim();
      if(!clean) return n;
      if(desc[n]!=null) nd[clean] = desc[n]; else if(desc[clean]!=null) nd[clean] = desc[clean];
      if(codes.length){ na[clean] = codes; moved++; }
      else if(Object.prototype.hasOwnProperty.call(allg, n)) na[clean] = allg[n];
      else if(Object.prototype.hasOwnProperty.call(allg, clean)) na[clean] = allg[clean];
      return clean;
    });
    c.desc = Object.keys(nd).length ? nd : null;
    c.allg = Object.keys(na).length ? na : null;
  });
  return moved;
}
function peSmHarvestAllergens(){
  var txt = String(peState.smText||'');
  if(!txt) return 0;
  var found = 0;
  (peState.smDraft||[]).forEach(function(c){
    (c.lines||[]).forEach(function(dish){
      var n = String(dish||'').trim(); if(!n) return;
      if(c.allg && Object.prototype.hasOwnProperty.call(c.allg, n)) return;
      // Word writes a curly apostrophe, the saved dish name often has a straight
      // one, and spacing drifts — "Roberto's" must still find "Roberto’s (D)(R)"
      // in the document. A near-miss here would silently hand the answer to the
      // à la carte, which is exactly what must not decide this.
      var lit = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                 .replace(/['’‘`´]/g, "['’‘`´]")
                 .replace(/\s+/g, '\\s+');
      var m = new RegExp(lit+'\\s*((?:\\([A-Za-z]{1,3}\\)\\s*)+)', 'i').exec(txt);
      if(!m) return;
      var codes = [];
      String(m[1]).replace(/\(([A-Za-z]{1,3})\)/g, function(_, code){ codes.push(code.toUpperCase()); return ''; });
      if(!codes.length) return;
      c.allg = c.allg || {}; c.allg[n] = codes; found++;
    });
  });
  return found;
}
function peSmFillFromLibrary(){
  var filled = 0, missing = [], clashes = [];
  (peState.smDraft||[]).forEach(function(c){
    var kind = peCmCourseKind({name:c.name});
    (c.lines||[]).forEach(function(dish){
      var n = String(dish||'').trim(); if(!n) return;
      var has = function(map){ return map && Object.prototype.hasOwnProperty.call(map, n); };
      if(has(c.allg) && c.desc && c.desc[n]){
        // Already declared for this menu. Still LOOK at the à la carte: if the
        // two disagree the chef has to know, because one of them is wrong and
        // silently preferring either one is how an allergen drifts.
        var ref = peCmDishInfo(n, kind);
        if(ref && ref.allergens && (ref.allergens.slice().sort().join(',') !== (c.allg[n]||[]).slice().sort().join(','))){
          clashes.push(n+': this menu says '+((c.allg[n]||[]).join('')||'none')+', the à la carte says '+(ref.allergens.join('')||'none'));
        }
        return;
      }
      var info = peCmDishInfo(n, kind);
      if(info){
        if(info.desc && !(c.desc && c.desc[n])){ c.desc = c.desc||{}; c.desc[n] = String(info.desc).trim(); }
        // An à la carte dish always knows its allergens — including when the
        // answer is "none". The empty array is a recorded fact, not a gap.
        if(info.allergens && !has(c.allg)){ c.allg = c.allg||{}; c.allg[n] = info.allergens.slice(); filled++; }
      }
      if(!has(c.allg) && missing.indexOf(n)<0) missing.push(n);
    });
  });
  return { filled:filled, missing:missing, clashes:clashes };
}
// Every dish still carrying no allergens — what the guest would be asked about.
function peSmMissingAllergens(){
  var out = [];
  (peState.smDraft||[]).forEach(function(c){
    (c.lines||[]).forEach(function(dish){
      var n = String(dish||'').trim(); if(!n) return;
      if(!(c.allg && Object.prototype.hasOwnProperty.call(c.allg, n)) && out.indexOf(n)<0) out.push(n);
    });
  });
  return out;
}
async function peSmDocUpload(input){
  var f = input.files && input.files[0]; if(!f) return;
  input.value = '';
  var nm = f.name || '';
  if(/\.doc$/i.test(nm)){ peToast('That is the older .doc format — open it in Word, “Save as” .docx, then upload again', true); return; }
  if(!/\.(docx|dotx)$/i.test(nm)){ peToast('That file is not a Word document — upload a .docx', true); return; }
  if(f.size > 8*1024*1024){ peToast('The Word file is over 8 MB — remove the images and try again', true); return; }
  peSmSync(); peState.smBusy = true; renderMain();
  var text = '';
  try{ text = await peSmDocxText(f); }
  catch(err){
    peState.smBusy = false; renderMain();
    peToast('Could not read the Word file — paste the menu text instead. '+String(err&&err.message||'').slice(0,60), true);
    return;
  }
  if(!text){ peState.smBusy = false; renderMain(); peToast('That Word file has no readable text (the menu may be a picture) — paste the menu text instead', true); return; }
  peState.smText = text;
  peState.smPdf = null;        // no designed artwork came with a Word file…
  peState.smBrandDoc = true;   // …so on save we publish it on the house template
  peState.smBusy = false;
  renderMain();
  await peStructureMenu();
  if(!(peState.smName||'').trim()){
    peState.smName = nm.replace(/\.(docx|dotx)$/i,'').replace(/[_-]+/g,' ').trim();
    renderMain();
  }
  // ORDER MATTERS: what the document declares first, our à la carte only after.
  peSmSplitCodesFromNames();
  var own = peSmHarvestAllergens();
  var fill = peSmFillFromLibrary();
  renderMain();
  if(fill.clashes.length){
    peToast('Word menu read ✓ — but the allergens disagree with our à la carte. Check before sending: '+fill.clashes.join(' · '), true);
  } else if(fill.missing.length){
    peToast('Word menu read ✓ — but '+fill.missing.length+' dish'+(fill.missing.length>1?'es have':' has')+
      ' no allergens, and guests are told so. Add them before sending: '+fill.missing.slice(0,4).join(', ')+
      (fill.missing.length>4?'…':''), true);
  } else {
    peToast('Word menu read ✓ — '+(own?own+' dish'+(own>1?'es carried':' carried')+' its own allergens; the rest came from':'allergens and descriptions came from')+' our à la carte. Check, then save');
  }
}
// Read the live form back into state before any structural re-render so typing
// is never lost when a course is added/removed.
// What every dish in this menu knows about itself, kept for the whole edit and
// never pruned. The chef fixes a menu by cutting a dish out of one course and
// pasting it into another — and the description and allergens live on the
// COURSE, keyed by dish name, so without this they would stay behind on the old
// course and the dish would arrive stripped. It also survives him clearing a
// box to retype it, which a snapshot taken per keystroke would not.
function peSmRemember(){
  var k = peState.smKnown = peState.smKnown || {};
  (peState.smDraft||[]).forEach(function(c){
    var d = c.desc||{}, a = c.allg||{};
    Object.keys(d).forEach(function(n){ (k[n]=k[n]||{}).desc = d[n]; });
    Object.keys(a).forEach(function(n){ (k[n]=k[n]||{}).allg = a[n]; });
  });
  return k;
}
function peSmSync(){
  var nEl=document.getElementById('pe-sm-name'); if(nEl) peState.smName=nEl.value;
  var pEl=document.getElementById('pe-sm-paste'); if(pEl) peState.smText=pEl.value;
  var cEl=document.getElementById('pe-sm-cost'); if(cEl) peState.smCost=cEl.value;
  var prEl=document.getElementById('pe-sm-price'); if(prEl) peState.smPrice=prEl.value;
  var known = peSmRemember();
  (peState.smDraft||[]).forEach(function(c,i){
    var a=document.getElementById('pe-sm-cname-'+i), b=document.getElementById('pe-sm-citems-'+i), ch=document.getElementById('pe-sm-choose-'+i);
    if(a) c.name=a.value;
    if(b) c.lines=b.value.split('\n').map(function(s){return s.trim();}).filter(Boolean);
    if(ch) c.choose=ch.checked;
  });
  // Re-key every course to the dishes it now holds, so what a dish knows
  // follows it across and does not linger on the course it left.
  (peState.smDraft||[]).forEach(function(c){
    var nd={}, na={};
    (c.lines||[]).forEach(function(n){
      var k = known[n]; if(!k) return;
      if(k.desc!=null) nd[n]=k.desc;
      if(k.allg!=null) na[n]=k.allg;
    });
    c.desc = Object.keys(nd).length?nd:null;
    c.allg = Object.keys(na).length?na:null;
  });
}
function peSmAddCourse(){ peSmSync(); (peState.smDraft=peState.smDraft||[]).push({name:'',choose:false,lines:[]}); renderMain(); }
function peSmDelCourse(i){ peSmSync(); peState.smDraft.splice(i,1); renderMain(); }
// A menu reads in the order it is eaten. A course added to fix a missing Pasta
// lands at the bottom, so it has to be possible to walk it up to where it goes.
function peSmMoveCourse(i, dir){
  peSmSync();
  var d = peState.smDraft||[], j = i + dir;
  if(j < 0 || j >= d.length) return;
  var t = d[i]; d[i] = d[j]; d[j] = t;
  renderMain();
}
function peSmSlug(n){ return String(n||'menu').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32)+'-'+Date.now().toString(36).slice(-4); }
// Offline fallback parser: turns "Course: a, b · Secondi (choice): x / y" into
// the courses structure. The chef confirms/edits everything before saving.
function peParseMenuText(t){
  var out=[];
  var blocks=String(t||'').replace(/·/g,'\n').split(/\n+/).map(function(s){return s.trim();}).filter(Boolean);
  blocks.forEach(function(b){
    var m=b.match(/^([^:]{2,44}):\s*(.+)$/);
    if(m){
      var name=m[1].trim(), rest=m[2].trim();
      var isChoice=/choi|choose|either|\bor\b/i.test(name) || /choi|choose|either|\s+or\s+/i.test(rest);
      name=name.replace(/\s*\((?:choice|choose|guests?[' ]?s? choice)\)\s*/i,'').trim();
      var parts=rest.split(isChoice?/\s*(?:\/|,|\bor\b)\s*/i:/\s*,\s*/).map(function(s){return s.trim();}).filter(Boolean);
      if(isChoice) out.push({name:name,choose:1,options:parts});
      else out.push({name:name,items:parts});
    } else {
      out.push({name:'',items:[b]});
    }
  });
  return out.length?{name:'',courses:out}:null;
}
function peParseMenuJson(t){
  try{
    var s=String(t||''); var a=s.indexOf('{'), b=s.lastIndexOf('}');
    if(a<0||b<0) return null;
    var o=JSON.parse(s.slice(a,b+1));
    if(!o||!Array.isArray(o.courses)) return null;
    o.courses=o.courses.map(function(c){
      var out;
      if(c.choose||Array.isArray(c.options)) out={name:c.name||'',choose:1,options:(c.options||c.items||[]).map(String)};
      else out={name:c.name||'',items:(c.items||[]).map(String)};
      if(c.desc && typeof c.desc==='object' && !Array.isArray(c.desc)) out.desc=c.desc;
      if(c.allg && typeof c.allg==='object' && !Array.isArray(c.allg)) out.allg=c.allg;
      return out;
    }).filter(function(c){ return (c.items&&c.items.length)||(c.options&&c.options.length); });
    return o.courses.length?o:null;
  }catch(e){ return null; }
}
// "Structure it" — tries the AI proxy (revenue-assistant) then falls back to the
// offline parser, so it works even when the function or network is unavailable.
async function peStructureMenu(){
  peSmSync();
  var txt=peState.smText||'';
  if(!txt.trim()){ peToast('Paste the menu text first', true); return; }
  peState.smBusy=true; renderMain();
  var parsed=null;
  try{
    var r=await sb.functions.invoke('revenue-assistant',{ body:{
      max_tokens:900,
      system:'You convert a pasted restaurant set menu into strict JSON and nothing else. Output ONLY a JSON object of the form {"name": string, "courses": [ {"name": string, "items": [string], "desc": {string: string}} OR {"name": string, "choose": 1, "options": [string], "desc": {string: string}} ]}. A course where the guest picks one dish (words like choice, choose, or, either) becomes a choose course with options; every other course lists its dishes as items. Keep dish names short. When the text describes a dish (its ingredients or preparation), put that one-line English description in the course\'s desc object keyed by the exact dish name; omit desc when there are none. ALLERGENS: the menu may carry codes in brackets after a dish, like "Ricciola (R)(S)" or "Branzino(D)(N)". Never delete them and never invent them — copy them verbatim into the desc text for that dish. They are a safety declaration, not decoration. No commentary, no markdown code fences.',
      messages:[{role:'user',content:txt}]
    }});
    if(!r.error && r.data && r.data.text) parsed=peParseMenuJson(r.data.text);
  }catch(e){}
  if(!parsed) parsed=peParseMenuText(txt);
  if(!parsed || !parsed.courses || !parsed.courses.length){ peState.smBusy=false; peToast('Could not read that — add the courses by hand below', true); renderMain(); return; }
  if(!(peState.smName||'').trim() && parsed.name) peState.smName=parsed.name;
  peState.smDraft=peSmDraftFrom(parsed.courses);
  peState.smBusy=false;
  peToast('Laid out '+parsed.courses.length+' course'+(parsed.courses.length>1?'s':'')+' — check and edit below ✓');
  renderMain();
}
function peSmCourseHTML(c,i){
  return '<div style="border:1px solid #E3D8C4;border-radius:9px;padding:10px;margin-top:8px">'+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
      '<input class="pe-in" id="pe-sm-cname-'+i+'" style="flex:1;min-width:120px" value="'+peEsc(c.name||'')+'" placeholder="Course name (e.g. Secondi)">'+
      '<label style="font-size:12px;color:#6E5844;white-space:nowrap"><input type="checkbox" id="pe-sm-choose-'+i+'"'+(c.choose?' checked':'')+' style="accent-color:#400207;vertical-align:-2px;margin-right:4px">Guests choose one</label>'+
      '<button class="pe-btn sec sm" onclick="peSmMoveCourse('+i+',-1)" title="Move this course up">&uarr;</button>'+
      '<button class="pe-btn sec sm" onclick="peSmMoveCourse('+i+',1)" title="Move this course down">&darr;</button>'+
      '<button class="pe-btn sec sm" style="color:#B00020;border-color:#B00020" onclick="peSmDelCourse('+i+')">Remove</button>'+
    '</div>'+
    '<textarea class="pe-in" id="pe-sm-citems-'+i+'" rows="2" style="margin-top:6px" placeholder="One dish per line">'+peEsc((c.lines||[]).join('\n'))+'</textarea>'+
    // The box above holds dish NAMES. The description and the allergens live
    // beside them and used to be invisible here — so a menu read out of a Word
    // file looked as though nothing had been picked up, when in fact the
    // descriptions were already there. Show exactly what the guest will read.
    peSmCourseReadout(c)+
  '</div>';
}
function peSmCourseReadout(c){
  var lines = (c.lines||[]).map(function(d){ return String(d||'').trim(); }).filter(Boolean);
  if(!lines.length) return '';
  var rows = lines.map(function(n){
    var desc = (c.desc && c.desc[n]) || '';
    var known = c.allg && Object.prototype.hasOwnProperty.call(c.allg, n);
    var list = known ? (c.allg[n]||[]) : null;
    var alg = !known ? '<span style="color:#B00020">no allergens — guests are told to ask</span>'
            : (list.length ? '<span style="color:#2E6B34">('+peEsc(list.join(')('))+')</span>'
                           : '<span style="color:#2E6B34">no declared allergens</span>');
    return '<div style="padding:3px 0;border-top:1px solid #EFE7DA">'+
      '<b style="color:#400207">'+peEsc(n)+'</b> — '+
      (desc ? peEsc(desc) : '<span style="color:#B00020">no description</span>')+
      ' '+alg+'</div>';
  }).join('');
  return '<div style="margin-top:7px;font-size:11px;color:#6E5844">'+
    '<div style="font-size:10px;letter-spacing:1px;color:#4F4535;text-transform:uppercase">What the guest will read</div>'+
    rows+'</div>';
}
// Top up a menu that is already saved — Giambartolo and anything else added
// before the à la carte lookup existed — without re-uploading the Word file.
function peSmFillNow(){
  peSmSync();
  peSmSplitCodesFromNames();            // codes glued to a dish name are still the chef's
  peSmHarvestAllergens();               // anything the pasted/uploaded menu declares wins
  var r = peSmFillFromLibrary();
  renderMain();
  if(r.clashes.length) peToast('Careful — the allergens disagree with our à la carte. This menu is kept as written: '+r.clashes.join(' · '), true);
  else if(!r.filled && r.missing.length) peToast('Our à la carte does not know '+(r.missing.length>1?'these dishes':'this dish')+', so the allergens have to come from you: '+r.missing.join(', '), true);
  else if(r.missing.length) peToast('Filled '+r.filled+' dish'+(r.filled>1?'es':'')+' ✓ — still no allergens for: '+r.missing.join(', ')+'. Save to keep the rest.', true);
  else peToast('Every dish now has its description and allergens ✓ — press Save menu to keep it');
}
function peRenderSetMenuLib(){
  var raw = (peState.editSetMenuId && peState.editSetMenuId!=='new') ? peSmRawById(peState.editSetMenuId) : null;
  var editing = peState.editSetMenuId==='new' || !!raw;
  var curPrice = raw ? (raw.price_pp!=null?raw.price_pp:(raw.price!=null?raw.price:null)) : null;
  var curCost = raw ? (raw.cost_pp!=null?raw.cost_pp:null) : null;
  var ce = peCanEdit();
  var h='';
  if(editing){
    var priceVal2 = peState.smPrice!=null ? peState.smPrice : (curPrice!=null?curPrice:'');
    var costVal = peState.smCost!=null ? peState.smCost : (curCost!=null?curCost:'');
    var priceRow = ce
      ? '<input class="pe-in" id="pe-sm-price" type="number" min="0" style="max-width:190px" value="'+peEsc(priceVal2)+'" placeholder="e.g. 395">'
      : '<input class="pe-in" style="max-width:190px;background:#EFE7DA;color:#4F4535" value="'+(curPrice!=null?('AED '+peMoney(curPrice)):'Price pending')+'" disabled><div style="font-size:11px;color:#785F0E;margin-top:5px">Price is set by Katarina, Andrea or Francesco.</div>';
    h += '<div class="pe-card"><b style="color:#400207">'+(raw?'Edit set menu':'New set menu')+'</b>'+
      '<div style="font-size:11px;color:#4F4535;margin:2px 0 10px">Saved here it appears in the events desk dropdown, the guest proposal and the kitchen brief.</div>'+
      '<div class="pe-lbl">Menu name</div><input class="pe-in" id="pe-sm-name" value="'+peEsc(peState.smName||'')+'" placeholder="e.g. Vegetarian set menu">'+
      '<div style="margin-top:10px;background:#F4EEE1;border:1px dashed #C9B48E;border-radius:10px;padding:11px">'+
        '<div class="pe-lbl" style="color:#574232">Paste the menu — the app lays out the courses for you</div>'+
        '<textarea class="pe-in" id="pe-sm-paste" rows="3" placeholder="Antipasti: Burrata, artichokes · Primi: truffle risotto · Secondi (choice): melanzane / tortelli · Dolci: tiramisù">'+peEsc(peState.smText||'')+'</textarea>'+
        '<div style="margin-top:6px"><button class="pe-btn sec sm" onclick="peStructureMenu()"'+(peState.smBusy?' disabled':'')+'>'+(peState.smBusy?'Reading…':'Structure it')+'</button>'+
        '<span style="font-size:11px;color:#4F4535;margin-left:8px">or add courses by hand below</span></div>'+
        '<div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
          '<label class="pe-btn sec sm" style="cursor:pointer">'+(peState.smBusy?'Reading…':'…or upload the menu PDF')+
            '<input type="file" accept="application/pdf,.pdf" style="display:none" onchange="peSmPdfUpload(this)"'+(peState.smBusy?' disabled':'')+'></label>'+
          '<label class="pe-btn sec sm" style="cursor:pointer">'+(peState.smBusy?'Reading…':'…or a Word file')+
            '<input type="file" accept=".docx,.dotx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none" onchange="peSmDocUpload(this)"'+(peState.smBusy?' disabled':'')+'></label>'+
          '<span style="font-size:11px;color:#4F4535;flex-basis:100%">'+(peState.smPdf
            ? 'PDF attached ✓ — guests get a “View the full menu” button'
            : peState.smBrandDoc
              ? 'Word read ✓ — guests get this menu laid out on the Roberto’s template'
              : (raw&&raw.pdf ? 'this menu already has a guest menu — uploading either file replaces it'
                              : 'PDF: reads the courses and attaches your designed menu. Word: reads the courses and lays the menu out on the Roberto’s template for guests.'))+'</span></div>'+
      '</div>'+
      '<div class="pe-lbl" style="margin-top:12px">Courses</div>'+
      (peState.smDraft||[]).map(function(c,i){ return peSmCourseHTML(c,i); }).join('')+
      '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap"><button class="pe-btn sec sm" onclick="peSmAddCourse()">+ Add course</button>'+
        '<button class="pe-btn sec sm" onclick="peSmFillNow()">Fill descriptions &amp; allergens from our à la carte</button></div>'+
      // Say it here, in the editor, rather than let the guest find it. This is
      // the one thing a menu typed from Word cannot know about itself.
      (function(){
        var miss = peSmMissingAllergens();
        if(!miss.length) return '';
        return '<div style="margin-top:10px;background:#FAEEDA;border:1px solid #E4C98A;border-radius:9px;padding:10px 12px;font-size:12px;color:#854F0B">'+
          '<b>'+miss.length+' dish'+(miss.length>1?'es have':' has')+' no allergens recorded.</b> '+
          'This menu cannot be printed or sent to a guest until '+(miss.length>1?'they are':'it is')+' filled in: '+
          peEsc(miss.join(', '))+'.</div>';
      })()+
      '<div style="margin-top:12px"><div class="pe-lbl">Kitchen cost / guest (AED) — chef’s number, never shown to guests</div>'+
      '<input class="pe-in" id="pe-sm-cost" type="number" min="0" style="max-width:190px" value="'+peEsc(costVal)+'" placeholder="what it costs to produce"></div>'+
      '<div style="margin-top:12px"><div class="pe-lbl">Price / guest (AED)</div>'+priceRow+'</div>'+
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">'+
        '<button class="pe-btn" onclick="peSaveSetMenu(\''+(raw?raw.id:'')+'\')">Save menu</button>'+
        '<button class="pe-btn sec" onclick="peSmCancel()">Cancel</button>'+
        // "Is this really what the guest gets?" should never need asking twice.
        (raw&&raw.key?'<button class="pe-btn sec" onclick="peCmOpen(\''+peEsc(raw.key)+'\')">See it as the guest</button>':'')+
        (raw?'<button class="pe-btn sec" style="margin-left:auto;color:#B00020;border-color:#B00020" onclick="peToggleSetMenu(\''+raw.id+'\','+(raw.active===false?'true':'false')+')">'+(raw.active===false?'Reactivate':'Retire menu')+'</button>':'')+
      '</div></div>';
  } else {
    h += '<div style="margin-bottom:10px"><button class="pe-btn" onclick="peSmNew()">+ Add set menu</button></div>';
  }
  // The chef's library shows the DESIGNED menus only — a menu Valentina
  // customised for one booking is hers, and lives on that booking.
  var list = peSetMenusRaw().filter(function(m){ return !m.is_custom; });
  // ── Is the margin check actually running? ──
  // Every menu already says "no cost yet" on its own row, but nobody was told
  // that it is ALL of them — so the 27% guard reads as "nothing is over target"
  // when the truth is that it has never had a number to check. A guard that is
  // silently switched off is worse than no guard: it looks like a pass.
  var smNoCost = list.filter(function(m){ var c = peNormSM(m).cost; return c == null || c === ''; }).length;
  if(smNoCost){
    h += '<div style="margin-bottom:10px;padding:11px 14px;border-radius:10px;background:#fdf1d6;'+
      'border:1px solid #d9a441;color:#6b4a10;font:500 13px/1.45 var(--font-body,inherit)">'+
      '<strong>'+(smNoCost===list.length ? 'No menu has a cost yet' : smNoCost+' of '+list.length+' menus have no cost')+'.</strong> '+
      'Until the kitchen cost is filled in, the 27% margin check cannot run on '+(smNoCost===list.length?'any of them':'those')+' — '+
      'a menu priced too close to what it costs to make would pass without a word.'+
      '</div>';
  }
  h += '<div class="pe-card">'+(list.length?list.map(function(m){
    var mm=peNormSM(m); var pending=mm.price==null;
    var costPct = (mm.cost!=null && mm.price) ? Math.round((mm.cost/(mm.price/PE_GROSS))*100) : null;
    return '<div class="pe-dishrow" style="opacity:'+(mm.active===false?.45:1)+'">'+
      '<span><b style="color:#400207">'+peEsc(mm.name)+'</b> '+
      (pending?'<span style="background:#FAEEDA;color:#854F0B;font-size:11px;padding:2px 9px;border-radius:20px;margin-left:2px">Price pending</span>':'· AED '+peMoney(mm.price)+'/guest')+
      (mm.cost!=null
        ? ' <span style="font-size:11px;color:'+(costPct==null?'#8B7355':(costPct<=27?'#2E6B34':'#B00020'))+'">· cost '+peMoney(mm.cost)+(costPct!=null?' ('+costPct+'% of net'+(costPct<=27?'':' — above 27% target')+')':'')+'</span>'
        : ' <span style="font-size:11px;color:#B00020">· no cost yet — chef to add</span>')+
      (mm.active===false?' <span style="font-size:11px;color:#4F4535">· retired</span>':'')+
      '<br><span style="font-size:11px;color:#4F4535">'+peEsc(mm.line||peSmSummary(mm.courses))+'</span></span>'+
      // Seeing it is now one tap from the list, not something you have to open
      // the editor and save first to find out.
      '<span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">'+
        (mm.key?'<button class="pe-btn sec sm" onclick="peCmPrintMenu(\''+peEsc(mm.key)+'\')">PDF</button>'+
                '<button class="pe-btn sec sm" onclick="peCmOpen(\''+peEsc(mm.key)+'\')">View</button>':'')+
        (m.id?'<button class="pe-btn sec sm" onclick="peSmEdit(\''+m.id+'\')">Edit</button>'+
              '<button class="pe-btn sec sm" style="color:#B00020;border-color:#B00020" onclick="peSmDelete(\''+m.id+'\')">Delete</button>'
             :'<span style="font-size:11px;color:#574232;align-self:center">built-in</span>')+
      '</span>'+
    '</div>';
  }).join(''):'<div style="font-size:12px;color:#4F4535">No set menus yet — tap “+ Add set menu”.</div>')+'</div>';
  return h;
}
async function peSaveSetMenu(id){
  peSmSync();
  var name=(peState.smName||'').trim();
  if(!name){ peToast('Menu name is required', true); return; }
  var courses=(peState.smDraft||[]).map(function(c){
    var lines=(c.lines||[]).filter(Boolean);
    var out = c.choose ? {name:(c.name||'Choice'),choose:1,options:lines} : {name:(c.name||'Course'),items:lines};
    if(c.desc) out.desc = c.desc;
    if(c.allg) out.allg = c.allg;
    return out;
  }).filter(function(c){ return (c.items&&c.items.length)||(c.options&&c.options.length); });
  if(!courses.length){ peToast('Add at least one course with a dish in it', true); return; }
  var raw = id ? peSmRawById(id) : null;
  var priceVal = raw ? (raw.price_pp!=null?raw.price_pp:(raw.price!=null?raw.price:null)) : null;
  if(peCanEdit()){
    var pe=document.getElementById('pe-sm-price');
    if(pe){ var pv=pe.value.trim(); priceVal = pv===''?null:Number(pv); }
  }
  var row = { key:(raw&&raw.key)||peSmSlug(name), name:name, courses:courses,
              line:peSmSummary(courses), price_pp:priceVal, updated_at:new Date().toISOString() };
  var ce2 = document.getElementById('pe-sm-cost');
  if(ce2){ var cv = ce2.value.trim(); row.cost_pp = cv===''?null:Number(cv); }
  if(peState.smPdf) row.pdf = peState.smPdf;  // a fresh upload replaces the PDF; otherwise the existing one stays
  // A Word menu has no designed file to attach, so the guest's "View the full
  // menu" button points at the house template instead — same wordmark, course
  // headings, allergens and footer as every other document we send, and it
  // re-reads the courses so an edit here reaches the guest.
  else if(peState.smBrandDoc) row.pdf = 'client-setmenu.html?m='+encodeURIComponent(row.key);
  if(!id) row.created_by=peActor();
  var r = id ? await sb.from('event_set_menus').update(row).eq('id', id).select().single()
             : await sb.from('event_set_menus').insert(row).select().single();
  // Cost column not added yet (SQL pending) — save everything else rather than
  // losing the chef's work, and name exactly what's missing.
  if(r.error && ('cost_pp' in row) && peColMissing(r.error, 'cost_pp')){
    delete row.cost_pp;
    r = id ? await sb.from('event_set_menus').update(row).eq('id', id).select().single()
           : await sb.from('event_set_menus').insert(row).select().single();
    if(!r.error) peToast('Saved without the cost — the cost field needs foh-events-setmenu-cost.sql run first.', true);
  }
  if(r.error || !r.data){ peToast('Set menu NOT saved — '+String(r.error&&r.error.message||'').slice(0,110), true); return; }
  if(id){ peState.setMenus = peState.setMenus.map(function(m){ return m.id===id ? r.data : m; }); }
  else { if(!Array.isArray(peState.setMenus)) peState.setMenus=[]; peState.setMenus.push(r.data); }
  peState.editSetMenuId=null; peState.smDraft=null; peState.smName=''; peState.smText=''; peState.smPdf=null; peState.smBrandDoc=false;
  peToast(priceVal!=null ? 'Set menu saved ✓ — ready for the events desk' : 'Set menu saved ✓ — the events desk sets the price before it can be quoted');
  renderMain();
}
// Retire is for a menu that is off for a while — the Netflix menu between two
// Netflix nights. Delete is for a menu we are never running again, so the list
// stays a list of menus we actually sell rather than everything ever typed.
//
// A menu an event has already used can never be deleted: that event's own
// record points at it by key, and a guest's choices hang off it, so deleting
// would quietly rewrite a booking that has already been sent out. Those get
// told to retire instead, and told WHICH events are holding it.
async function peSmDelete(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var raw = peSmRawById(id); if(!raw || !raw.key) return;
  // TWO nets, because a query returning nothing does not mean nothing is there:
  // row-level security can hide a booking from the reader, and an empty answer
  // would then read as "safe to delete". The bookings this screen has already
  // loaded are checked too, and either one is enough to stop the delete.
  var ev = await sb.from('events_desk').select('event_date,client_name').eq('set_menu->>key', raw.key).limit(4);
  var ch = await sb.from('event_menu_choices').select('id').eq('menu_key', raw.key).limit(1);
  // Never delete on a failed check — not knowing is a reason to stop, not to guess.
  if(ev.error || ch.error){ peToast('Could not check whether this menu is in use, so nothing was deleted. Try again.', true); return; }
  var local = (peState.events||[]).filter(function(x){ return x && x.set_menu && x.set_menu.key===raw.key; });
  var rows = (ev.data||[]).concat(local.map(function(x){ return {event_date:x.event_date, client_name:x.client_name}; }));
  var seen = {};
  rows = rows.filter(function(x){ var k=(x.client_name||'')+'|'+(x.event_date||''); if(seen[k]) return false; seen[k]=1; return true; });
  var used = rows.length, chosen = (ch.data||[]).length;
  if(used || chosen){
    var who = rows.slice(0,4).map(function(x){ return (x.client_name||'an event')+(x.event_date?' — '+peDLabel(x.event_date):''); }).join(', ');
    peToast('“'+raw.name+'” is on '+(used?used+' booking'+(used>1?'s':''):'a booking')+(who?': '+who:'')+
      (chosen?', and a guest has already chosen from it':'')+'. Retire it instead — it leaves the dropdown but those bookings keep their menu.', true);
    return;
  }
  if(!(await peConfirm({ title:'Delete “'+raw.name+'”?',
    body:'This removes the menu for good. No booking is using it, so nothing else changes. If you might run it again one day, retire it instead.',
    ok:'Delete for good', cancel:'Keep it', danger:true }))) return;
  var r = await sb.from('event_set_menus').delete().eq('id', id);
  if(r.error){ peToast('Not deleted — '+String(r.error&&r.error.message||'').slice(0,90), true); return; }
  peState.setMenus = (peState.setMenus||[]).filter(function(m){ return m.id!==id; });
  if(peState.editSetMenuId===id){ peSmCancel(); return; }
  peToast('“'+raw.name+'” deleted');
  renderMain();
}
async function peToggleSetMenu(id, active){
  var on = (active==='true'||active===true);
  var r = await sb.from('event_set_menus').update({active:on, updated_at:new Date().toISOString()}).eq('id', id);
  if(r.error){ peToast('NOT changed — check connection', true); return; }
  peState.setMenus.forEach(function(m){ if(m.id===id) m.active=on; });
  peState.editSetMenuId=null; peState.smDraft=null;
  peToast(on?'Menu reactivated ✓':'Menu retired — existing bookings keep it, new quotes won’t show it');
  renderMain();
}
function peRenderBevLib(){
  var ed = peState.editBevId==='new' ? {} : (peState.editBevId ? peBevById(peState.editBevId)||{} : null);
  var curPdf = ed ? (peState.bevPdf || ed.pdf || null) : null;
  var h = '';
  if(ed){
    h += '<div class="pe-card"><b style="color:#400207">'+(ed.id?'Edit package':'Add a beverage package')+'</b>'+
      '<div class="pe-grid3" style="margin-top:10px">'+
      '<div style="grid-column:1/3"><div class="pe-lbl">Package name</div><input class="pe-in" id="pe-b-name" value="'+peEsc(ed.name||'')+'"></div>'+
      '<div><div class="pe-lbl">Hours (blank if per-drink)</div><input class="pe-in" id="pe-b-duration_hours" type="number" step="0.5" value="'+peEsc(ed.duration_hours!=null?ed.duration_hours:(ed.id?'':3))+'"></div>'+
      '</div><div class="pe-grid2" style="margin-top:8px">'+
      '<div><div class="pe-lbl">Price / guest (AED)</div><input class="pe-in" id="pe-b-price_pp" type="number" value="'+peEsc(ed.price_pp!=null?ed.price_pp:'')+'"></div>'+
      '<div><div class="pe-lbl">Cost / guest (AED) — our cost, never shown to clients</div><input class="pe-in" id="pe-b-cost_pp" type="number" step="0.01" value="'+peEsc(ed.cost_pp!=null?ed.cost_pp:'')+'"></div>'+
      '</div><div style="margin-top:8px"><div class="pe-lbl">Includes</div><input class="pe-in" id="pe-b-includes" value="'+peEsc(ed.includes||'')+'" placeholder="House wine, beers, soft drinks, water"></div>'+
      '<div style="margin-top:10px;background:#F4EEE1;border:1px dashed #C9B48E;border-radius:10px;padding:11px">'+
        '<div class="pe-lbl" style="color:#574232">Designed PDF for guests (optional)</div>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px">'+
          '<label class="pe-btn sec sm" style="cursor:pointer" id="pe-b-pdf-label">'+(peState.bevBusy?'Uploading…':(curPdf?'Replace the PDF':'Upload the package PDF'))+
            '<input type="file" accept="application/pdf,.pdf" style="display:none" onchange="peBevPdfUpload(this)"'+(peState.bevBusy?' disabled':'')+'></label>'+
          '<span style="font-size:11px;color:#4F4535" id="pe-b-pdf-status">'+(curPdf
            ? 'PDF attached ✓ — guests get a “View the beverage package” button'
            : 'attach the designed package PDF the guest can open')+'</span>'+
        '</div>'+
      '</div>'+
      '<div style="margin-top:10px"><label style="font-size:12.5px;color:#6B4A33;cursor:pointer;display:inline-flex;align-items:center;gap:7px"><input type="checkbox" id="pe-b-non_alcoholic" '+(ed.non_alcoholic?'checked':'')+' style="accent-color:#400207"> Alcohol-free package (soft drinks / mocktails only) — can be offered on a dry event</label></div>'+
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="pe-btn" onclick="peSaveBev(\''+(ed.id||'')+'\')">Save package</button>'+
      '<button class="pe-btn sec" onclick="peState.editBevId=null;peState.bevPdf=null;renderMain()">Cancel</button>'+
      (ed.id?'<button class="pe-btn sec" style="margin-left:auto;color:#B00020;border-color:#B00020" onclick="peToggleBev(\''+ed.id+'\','+(ed.active===false?'true':'false')+')">'+(ed.active===false?'Reactivate':'Retire package')+'</button>':'')+
      '</div></div>';
  } else {
    h += '<div style="margin-bottom:10px"><button class="pe-btn" onclick="peState.editBevId=\'new\';peState.bevPdf=null;renderMain()">+ Add a beverage package</button></div>';
  }
  h += '<div class="pe-card">'+(peState.bevs.length?peState.bevs.map(function(b){
    var pour = (b.cost_pp!=null && Number(b.price_pp)>0) ? Math.round(Number(b.cost_pp)/Number(b.price_pp)*100) : null;
    return '<div class="pe-dishrow" style="opacity:'+(b.active===false?.45:1)+'"><span><b>'+peEsc(b.name)+'</b> · '+(b.duration_hours?b.duration_hours+'h · ':'')+(b.price_pp!=null?'AED '+peMoney(b.price_pp)+'/guest':'price on the proposal')+
      (pour!=null?' · <span style="color:'+(pour>=30?'#B00020':'#2E6B34')+'">cost AED '+peMoney(b.cost_pp)+' → '+pour+'%</span>':' · <span style="color:#544418">no cost yet</span>')+
      '<br><span style="font-size:11px;color:#4F4535">'+peEsc(b.includes||'')+'</span>'+(b.pdf?' <span style="font-size:11px;color:#2E6B34">· PDF ✓</span>':'')+'</span>'+
      '<button class="pe-btn sec sm" onclick="peState.editBevId=\''+b.id+'\';peState.bevPdf=null;renderMain()">Edit</button></div>';
  }).join(''):'<div style="font-size:12px;color:#4F4535">No packages yet.</div>')+'</div>';
  return h;
}
// Upload a designed beverage-package PDF. Reuses the same event-menus bucket as
// set menus. Deliberately does NOT renderMain — the bev form reads typed fields
// from the DOM only at save, so a re-render here would wipe the name/price the
// user just typed. Instead it updates the label + status text in place.
async function peBevPdfUpload(input){
  var f = input.files && input.files[0]; if(!f) return;
  input.value = '';
  if(!/pdf$/i.test(f.type||'') && !/\.pdf$/i.test(f.name||'')){ peToast('That file is not a PDF — export the package as PDF first', true); return; }
  if(f.size > 8*1024*1024){ peToast('The PDF is over 8 MB — export a lighter version and try again', true); return; }
  var label = document.getElementById('pe-b-pdf-label');
  var status = document.getElementById('pe-b-pdf-status');
  var nameEl = document.getElementById('pe-b-name');
  peState.bevBusy = true;
  if(label){ label.firstChild && (label.firstChild.nodeValue = 'Uploading…'); }
  if(status){ status.textContent = 'Uploading…'; }
  try{
    var base = ((nameEl && nameEl.value) || f.name.replace(/\.pdf$/i,'') || 'beverage');
    var path = 'bev-'+peSmSlug(base)+'.pdf';
    var up = await sb.storage.from('event-menus').upload(path, f, {contentType:'application/pdf', upsert:true});
    if(up.error) throw up.error;
    var pub = sb.storage.from('event-menus').getPublicUrl(path);
    peState.bevPdf = (pub && pub.data && pub.data.publicUrl) || null;
    peState.bevBusy = false;
    if(peState.bevPdf){
      if(label && label.firstChild) label.firstChild.nodeValue = 'Replace the PDF';
      if(status) status.textContent = 'PDF attached ✓ — save the package to keep it';
      peToast('PDF attached ✓ — now press Save package');
    }
  }catch(err){
    peState.bevBusy = false; peState.bevPdf = null;
    if(label && label.firstChild) label.firstChild.nodeValue = 'Upload the package PDF';
    if(status) status.textContent = 'Could not attach the PDF — try again';
    peToast('PDF NOT attached — '+String(err&&err.message||'').slice(0,80), true);
  }
}
async function peSaveBev(id){
  var g = function(f){ var el=document.getElementById('pe-b-'+f); return el?el.value.trim():''; };
  if(!g('name')){ peToast('Package name is required', true); return; }
  // Price per guest is optional: a minimum-spend / confidential package carries no
  // per-guest price — the money lives on the proposal's minimum spend.
  var naEl = document.getElementById('pe-b-non_alcoholic');
  var existing = id ? peBevById(id) : null;
  var pdfUrl = peState.bevPdf || (existing && existing.pdf) || null;
  var row = { name:g('name'), duration_hours:g('duration_hours')?Number(g('duration_hours')):null,
              price_pp:g('price_pp')?Number(g('price_pp')):null, cost_pp:g('cost_pp')?Number(g('cost_pp')):null,
              includes:g('includes')||null, non_alcoholic: naEl?!!naEl.checked:false, pdf:pdfUrl, created_by:peActor() };
  async function saveRow(rr){
    return id ? await sb.from('event_bev_packages').update(rr).eq('id', id).select().single()
              : await sb.from('event_bev_packages').insert(rr).select().single();
  }
  var r = await saveRow(row);
  // Degrade gracefully if a column isn't in the DB yet — save the rest so the app
  // never breaks before the SQL is run, and name exactly what's missing.
  if(r.error && /non_alcoholic/.test(String(r.error.message||''))){
    delete row.non_alcoholic; r = await saveRow(row);
  }
  if(r.error && /\bpdf\b/.test(String(r.error.message||''))){
    delete row.pdf; r = await saveRow(row);
    if(!r.error) peToast('Saved without the PDF — the pdf field needs foh-events-bev-pdf.sql run first.', true);
  }
  // A price-free package needs price_pp to be nullable — name the SQL if it isn't yet.
  if(r.error && row.price_pp==null && /price_pp|not-null|null value/i.test(String(r.error.message||''))){
    peToast('To save without a price, run foh-events-bev-price-optional.sql first (makes price optional).', true); return;
  }
  if(r.error || !r.data){ peToast('NOT saved — '+String(r.error&&r.error.message||'').slice(0,100), true); return; }
  if(id){ peState.bevs = peState.bevs.map(function(b){ return b.id===id ? r.data : b; }); } else peState.bevs.push(r.data);
  peState.editBevId = null; peState.bevPdf = null; peToast('Beverage package saved ✓'); renderMain();
}
async function peToggleBev(id, active){
  var on = (active==='true'||active===true);
  // Retiring is destructive and client-facing \u2014 it pulls the package out of every
  // future quote. It used to happen on one tap with no confirm and no check-mark.
  if(!on){
    var b0 = (peState.bevs||[]).filter(function(b){ return b.id===id; })[0];
    if(!(await peConfirm({title:'Retire this beverage package?',
      html:'<b>'+peEsc((b0&&b0.name)||'This package')+'</b> will stop appearing when you build a quote.'+
        '<br><br>Bookings that already use it keep it. You can bring it back from this same screen.',
      ok:'Retire it', cancel:'Keep it', danger:true}))) { renderMain(); return; }
  }
  var r = await sb.from('event_bev_packages').update({active:on}).eq('id', id);
  if(r.error){ peToast('NOT changed \u2014 check connection', true); return; }
  peState.bevs.forEach(function(b){ if(b.id===id) b.active = on; });
  peState.editBevId = null;
  peToast(on ? 'Back in use \u2713' : 'Retired \u2713');
  renderMain();
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
    if(peCanEdit()) h += '<div style="margin-bottom:10px"><button class="pe-btn" onclick="peState.editPackId=\'new\';renderMain()">+ New menu package</button></div>';
  }
  h += '<div class="pe-card">'+(peState.packs.length?peState.packs.map(function(p){
    var names = (p.dish_ids||[]).map(function(id){ var d=peDishById(id); return d?d.name:null; }).filter(Boolean);
    return '<div class="pe-dishrow"><span><b>'+peEsc(p.name)+'</b> · AED '+peMoney(p.price_pp)+'/guest<br><span style="font-size:11px;color:#4F4535">'+peEsc(names.join(' · '))+'</span></span>'+
      (peCanEdit()?'<button class="pe-btn sec sm" onclick="peState.editPackId=\''+p.id+'\';renderMain()">Edit</button>':'')+'</div>';
  }).join(''):'<div style="font-size:12px;color:#4F4535">No packages yet.</div>')+'</div>';
  return h;
}
async function peSavePack(id){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
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

// ── budget proposal wizard ───────────────────────────────────────────────────
// Valentina types the facts of the enquiry (guests, budget, beverage package);
// the app does ALL the math on her own library — beverage total, balance for
// food per guest, then a canapé selection that FILLS that balance: pieces are
// scaled up (no piece cap) to spend as much of the budget as possible, held only
// by the real kitchen rules — variety cap (max 15 different canapés), minimum
// order per dish, tier pricing. No AI, no guessing.
var peWiz = { client:'', date:'', time:'', area:'Scala and Bar', guests:'', budget:'', bev:'', excl:{}, dietaryNote:'', vegonly:false, dry:false, busy:false };
function peWizReset(){ peWiz = { client:'', date:'', time:'', area:'Scala and Bar', guests:'', budget:'', bev:'', excl:{}, dietaryNote:'', vegonly:false, busy:false }; }
function peWizSet(f, v){ peWiz[f] = v; peWizPaint(); }
function peWizTogl(k){ peWiz.excl[k] = !peWiz.excl[k]; renderMain(); }
function peWizToglVeg(){ peWiz.vegonly = !peWiz.vegonly; renderMain(); }
function peWizCap(guests){ return guests>=30 ? 15 : (guests>=20 ? 8 : 5); }
// What the guest doesn't want, applied to the live library before any math —
// so the mix the wizard proposes is always actually serveable.
var PE_WIZ_EXCL = [['beef','No beef','Beef'],['chicken','No chicken','Chicken'],['fish','No fish / shellfish','Fish'],['dessert','No dessert','Dessert']];
function peWizPool(){
  return peState.dishes.filter(function(d){
    if(!d.active) return false;
    if(peWiz.vegonly && d.category!=='Vegetarian' && d.category!=='Dessert') return false;
    if(peWiz.excl.beef && d.category==='Beef') return false;
    if(peWiz.excl.chicken && d.category==='Chicken') return false;
    if(peWiz.excl.fish && d.category==='Fish') return false;
    if(peWiz.excl.dessert && d.category==='Dessert') return false;
    return true;
  });
}
function peWizAvail(pool){
  var a = {Signature:0, Elevated:0, Classic:0};
  pool.forEach(function(d){ if(a[d.tier]!=null) a[d.tier]++; });
  return a;
}
function peWizMix(foodPP, guests, pool){
  // Pieces per guest of each tier (Signature 35 / Elevated 20 / Classic 10) that
  // spends as CLOSE to the food balance as possible without going over. NO piece
  // cap — not per guest, not per dish. The only limits: a tier with no dishes in
  // the library can't be used, and we won't pile past a *sensible* ceiling of
  // canapés per guest (PE_WIZ_SANE_PCS) — beyond that the wizard offers a plated
  // course/station instead. We aim for a full, blended spread (~AED 20/piece →
  // roughly foodPP/20 pieces) rather than a handful of costly pieces.
  var avail = peWizAvail(pool);
  var maxS = avail.Signature>0 ? PE_WIZ_SANE_PCS : 0;
  var maxE = avail.Elevated>0  ? PE_WIZ_SANE_PCS : 0;
  var maxC = avail.Classic>0   ? PE_WIZ_SANE_PCS : 0;
  var targetPcs = Math.max(3, Math.min(PE_WIZ_SANE_PCS, Math.round(foodPP/PE_WIZ_AVG_PC)));
  var best = null;
  for(var s=0; s<=maxS; s++){
    if(35*s > foodPP) break;
    for(var e=0; e<=maxE && s+e<=PE_WIZ_SANE_PCS; e++){
      if(35*s + 20*e > foodPP) break;
      var cRoom = PE_WIZ_SANE_PCS - s - e;
      for(var c=0; c<=maxC && c<=cRoom; c++){
        var pcs = s+e+c;
        if(pcs<1) continue;
        var price = 35*s + 20*e + 10*c;
        if(price > foodPP) break;   // c only raises price — nothing better past here
        var leftover = foodPP - price;
        // fill the budget first (leftover dominates), then land near the blended
        // piece count, then lean to Elevated (the workhorse tier) and a little
        // Signature for a richer feel.
        var score = leftover*1000 + Math.abs(pcs-targetPcs)*8 - e*2 - s;
        if(!best || score < best.score) best = {s:s, e:e, c:c, pcs:pcs, price:price, score:score};
      }
    }
  }
  return best;   // null only when the library has no active dishes at all
}
function peWizPick(mix, guests, pool){
  // turn the tier mix into real dishes from the guest-allowed pool, balancing
  // cold/hot/dolci (~40/40/20 of pieces) and spreading categories.
  var cap = peWizCap(guests), avail = peWizAvail(pool);
  var hasDessert = pool.some(function(d){ return d.serve==='Dessert'; });
  // How many DISTINCT dishes each tier gets — as varied as the library and the
  // variety cap allow. Pieces then spread across them; a single dish may carry
  // several pcs/guest (no per-dish cap), so a big piece count needs few dishes.
  var plan = [['Signature',mix.s],['Elevated',mix.e],['Classic',mix.c]]
    .filter(function(t){ return t[1]>0; })
    .map(function(t){ return {tier:t[0], pcs:t[1], distinct:Math.min(t[1], avail[t[0]])}; });
  function totalDistinct(){ return plan.reduce(function(a,p){ return a+p.distinct; },0); }
  while(totalDistinct() > cap){
    // over the variety cap — use one fewer dish (it just carries more pieces),
    // trimming the tier that currently spreads across the most dishes first,
    // never below one dish per used tier.
    var cand = null;
    plan.forEach(function(p){ if(p.distinct > 1 && (!cand || p.distinct > cand.distinct)) cand = p; });
    if(!cand) break;
    cand.distinct--;
  }
  var used = {}, servePcs = {Cold:0, Hot:0, Dessert:0}, catCount = {}, totalAssigned = 0;
  var target = hasDessert ? {Cold:.4, Hot:.4, Dessert:.2} : {Cold:.5, Hot:.5, Dessert:0};
  var picked = [];
  plan.forEach(function(p){
    var n = p.distinct, remaining = p.pcs;
    for(var i=0; i<n; i++){
      // even spread of the tier's pieces across its dishes (22 over 5 → 5,5,4,4,4)
      var slotsLeft = n - i;
      var pcsHere = Math.ceil(remaining / slotsLeft);
      if(pcsHere < 1) pcsHere = 1;
      remaining -= pcsHere;
      var cand = pool.filter(function(d){
        return d.tier===p.tier && !used[d.id] && (d.min_order||10) <= guests*pcsHere;
      });
      if(!cand.length) cand = pool.filter(function(d){ return d.tier===p.tier && !used[d.id]; });
      if(!cand.length) continue;
      cand.sort(function(a,b){
        var pa = servePcs[a.serve]-target[a.serve]*(totalAssigned||1), pb = servePcs[b.serve]-target[b.serve]*(totalAssigned||1);
        if(pa!==pb) return pa-pb;
        var ca = catCount[a.category]||0, cb = catCount[b.category]||0;
        if(ca!==cb) return ca-cb;
        return (b.description?1:0)-(a.description?1:0);
      });
      var d = cand[0];
      used[d.id] = true;
      servePcs[d.serve] += pcsHere; catCount[d.category] = (catCount[d.category]||0)+1; totalAssigned += pcsHere;
      picked.push({dish:d, pcs:pcsHere});
    }
  });
  return picked;
}
function peWizCalc(){
  var guests = parseInt(peWiz.guests,10)||0;
  var budget = Number(peWiz.budget)||0;
  var bev = (peWiz.bev==='none' || peWiz.bev==='dry') ? null : (peWiz.bev ? peBevById(peWiz.bev) : undefined);
  if(!guests || !budget || bev===undefined) return {ready:false};
  if(guests < 15) return {ready:false, err:'Canapé receptions start at 15 guests — for smaller groups use a normal event.'};
  var bevPP = bev ? Number(bev.price_pp)||0 : 0;
  var bevTotal = bevPP*guests;
  var balance = budget - bevTotal;
  var foodPP = Math.floor(balance/guests);
  // Below AED 40/guest there isn't even a light reception to offer — stay honest.
  if(foodPP < 40){
    var err = bev ? (balance<=0
      ? 'The '+bev.name+' alone is AED '+peMoney(bevTotal)+' — '+(balance<0?'AED '+peMoney(-balance)+' OVER the budget.':'the whole budget.')+' Pick a lighter package or raise the budget.'
      : 'Only AED '+peMoney(foodPP)+'/guest left for food — too little for a canapé reception. Pick a lighter package or raise the budget.')
      : 'AED '+peMoney(foodPP)+'/guest is too little for a canapé reception (min ~AED 40/guest).';
    return {ready:false, err:err, bev:bev, bevPP:bevPP, bevTotal:bevTotal, balance:balance, foodPP:foodPP, guests:guests, budget:budget};
  }
  var pool = peWizPool();
  var exclOn = PE_WIZ_EXCL.filter(function(x){ return peWiz.excl[x[0]]; }).map(function(x){ return x[1].toLowerCase(); });
  if(peWiz.vegonly) exclOn.unshift('vegetarian only');
  var mix = peWizMix(foodPP, guests, pool);
  if(!mix) return {ready:false, err: exclOn.length
    ? 'With '+exclOn.join(' + ')+' the library cannot serve a full selection — relax one restriction or add matching canapés in the Chef corner.'
    : 'The dish library cannot serve a selection yet — add more active canapés in the Chef corner.'};
  var picked = peWizPick(mix, guests, pool);
  var realFoodPP = 0; picked.forEach(function(p){ realFoodPP += (Number(p.dish.sell_price)||0)*p.pcs; });
  var total = (realFoodPP+bevPP)*guests;
  var foodUnspentPP = foodPP - realFoodPP;
  // Pieces are scaled to fill the food balance, so normally almost nothing is left
  // over. Money is only genuinely stranded when the selection has already reached
  // the sensible ceiling (~PE_WIZ_SANE_PCS pcs/guest — a very heavy reception) and
  // the budget still isn't spent, OR the library is too thin/cheap to absorb it.
  // Then we say so and OFFER to add real value rather than parking the money.
  var addValue = foodUnspentPP >= 20 && mix.pcs >= PE_WIZ_SANE_PCS - 3;
  return {ready:true, guests:guests, budget:budget, bev:bev, bevPP:bevPP, bevTotal:bevTotal, balance:balance,
          foodPP:foodPP, mix:mix, picked:picked, realFoodPP:realFoodPP, total:total, gap:budget-total,
          cap:peWizCap(guests), excl:exclOn, foodUnspentPP:foodUnspentPP,
          addValue:addValue, addValueTotal:Math.round(foodUnspentPP*guests)};
}
function peRenderWizard(){
  var bevs = peState.bevs.filter(function(b){ return b.active!==false; })
    .sort(function(a,b){ return (a.name||'').localeCompare(b.name||'') || (Number(a.duration_hours)||0)-(Number(b.duration_hours)||0); });
  var h = peHeader('wizard');
  h += '<div class="pe-top"><div class="pe-title">New quote from a budget</div></div>';
  h += '<div style="font-size:12px;color:#4F4535;margin-bottom:10px">Type the enquiry as the guest gave it — the app computes the beverage, the balance for food, and builds a canapé selection that fits. You review, then send.</div>';
  h += '<div class="pe-card"><div class="pe-grid3">'+
    '<div><div class="pe-lbl">Client name</div><input class="pe-in" id="pe-w-client" value="'+peEsc(peWiz.client)+'" onchange="peWiz.client=this.value" placeholder="e.g. Mrs Anna"></div>'+
    '<div><div class="pe-lbl">Event date</div><input class="pe-in" type="date" id="pe-w-date" min="'+peToday()+'" value="'+peEsc(peWiz.date)+'" onchange="peWiz.date=this.value"></div>'+
    '<div><div class="pe-lbl">Start time (optional)</div><select class="pe-in" id="pe-w-time" onchange="peWiz.time=this.value">'+peTimeOptions(peWiz.time)+'</select></div>'+
    '</div><div class="pe-grid3" style="margin-top:8px">'+
    '<div><div class="pe-lbl">Area</div><select class="pe-in" onchange="peWiz.area=this.value">'+PE_AREAS.map(function(a){ return '<option'+(peWiz.area===a?' selected':'')+'>'+a+'</option>'; }).join('')+'</select></div>'+
    '<div><div class="pe-lbl">Guests</div>'+peStepWrap('<input class="pe-in" type="number" min="15" value="'+peEsc(peWiz.guests)+'" onchange="peWizSet(\'guests\',this.value)" placeholder="e.g. 30">')+'</div>'+
    '<div><div class="pe-lbl">Total budget (AED, incl. VAT &amp; service)</div><input class="pe-in" type="text" inputmode="numeric" id="pe-w-budget" value="'+(peWiz.budget?Number(peWiz.budget).toLocaleString('en-US'):'')+'" oninput="peWizBudget(this)" placeholder="e.g. 15,000"><div id="pe-w-budget-echo" style="font-size:12px;color:#4F4535;margin-top:3px">'+(peWiz.budget?'= <b style="color:#400207">AED '+Number(peWiz.budget).toLocaleString('en-US')+'</b>':'&nbsp;')+'</div></div>'+
    '</div><div style="margin-top:8px"><div class="pe-lbl">Beverage package the guest wants</div>'+
    '<select class="pe-in" onchange="peWizSet(\'bev\',this.value)"><option value="" '+(peWiz.bev===''?'selected':'')+'>Choose…</option>'+
    '<option value="none"'+(peWiz.bev==='none'?' selected':'')+'>No beverage package — whole budget on food</option>'+
    '<option value="dry"'+(peWiz.bev==='dry'?' selected':'')+'>No alcohol — soft drinks &amp; water (beverage charge AED 0)</option>'+
    bevs.map(function(b){ return '<option value="'+b.id+'"'+(peWiz.bev===b.id?' selected':'')+'>'+peEsc(b.name)+(b.duration_hours?' — '+b.duration_hours+'h':'')+(b.price_pp!=null?' — AED '+peMoney(b.price_pp)+'/guest':' — price on the proposal')+(b.non_alcoholic?' · alcohol-free':'')+'</option>'; }).join('')+
    '</select></div>'+
    '<div style="margin-top:8px"><div class="pe-lbl">The guest doesn’t want… (tap to exclude)</div>'+
    PE_WIZ_EXCL.map(function(x){
      return '<span class="pe-chip'+(peWiz.excl[x[0]]?' on':'')+'" onclick="peWizTogl(\''+x[0]+'\')">'+x[1]+'</span>';
    }).join('')+'</div>'+
    '<div style="margin-top:8px"><div class="pe-lbl">Menu style</div>'+
    '<span class="pe-chip'+(peWiz.vegonly?' on':'')+'" onclick="peWizToglVeg()">Vegetarian only</span></div>'+
    '<div style="margin-top:8px"><div class="pe-lbl">Other dietary / allergy notes (reaches the kitchen)</div>'+
    '<input class="pe-in" id="pe-w-diet" value="'+peEsc(peWiz.dietaryNote)+'" onchange="peWiz.dietaryNote=this.value" placeholder="e.g. one guest has a severe nut allergy; two gluten-free"></div></div>';
  h += '<div id="pe-wiz-out">'+peWizOutHTML()+'</div>';
  return h+PE_FOOT;
}
function peWizPaint(){
  var el = document.getElementById('pe-wiz-out');
  if(el) el.innerHTML = peWizOutHTML();
}
function peWizOutHTML(){
  var w = peWizCalc();
  if(w.err) return '<div class="pe-card" style="border-color:#B00020"><div style="font-size:13px;color:#B00020">'+w.err+'</div></div>';
  if(!w.ready) return '<div class="pe-card"><div style="font-size:12px;color:#4F4535">Fill guests, budget and the beverage choice — the proposal appears here instantly.</div></div>';
  function mrow(l, v){ return '<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span style="color:#6B4A33">'+l+'</span><span style="color:#400207;font-weight:600">'+v+'</span></div>'; }
  var perGuest = w.realFoodPP + w.bevPP;
  var summary = w.mix.pcs+' canapés per guest · AED '+peMoney(perGuest)+' per guest · '+
    (w.gap<0 ? 'AED '+peMoney(-w.gap)+' over budget' : 'AED '+peMoney(w.gap)+' under budget');
  var h = '<div class="pe-card" style="background:#F7EEE2;border-color:rgba(201,168,76,0.5)">'+
    '<div style="font-size:14.5px;color:#400207;font-weight:600;margin-bottom:8px">'+summary+'</div>'+
    '<div class="pe-lbl" style="color:#574232">The math — every number from your own prices</div>'+
    (w.bev ? mrow('Beverage — '+peEsc(w.bev.name)+(w.bev.duration_hours?' ('+w.bev.duration_hours+'h)':''), w.guests+' × AED '+peMoney(w.bevPP)+' = AED '+peMoney(w.bevTotal))
           : mrow('Beverage', peWiz.bev==='dry' ? 'no alcohol — soft drinks & water (AED 0)' : 'none — whole budget on food'))+
    mrow('Balance for food', 'AED '+peMoney(w.balance)+' → AED '+peMoney(w.foodPP)+' / guest')+
    mrow('Canapé selection — '+w.mix.pcs+' pieces/guest', [w.mix.s?w.mix.s+' Signature':null, w.mix.e?w.mix.e+' Elevated':null, w.mix.c?w.mix.c+' Classic':null].filter(Boolean).join(' + '))+
    mrow('Proposal total', w.guests+' × AED '+peMoney(w.realFoodPP+w.bevPP)+' = AED '+peMoney(w.total))+
    (w.gap<0
      ? '<div style="font-size:12px;margin-top:4px;color:#B00020">AED '+peMoney(-w.gap)+' OVER budget</div>'
      : w.addValue
        ? '<div style="font-size:12px;margin-top:4px;color:#7F5C00">This already fills a generous canapé reception — '+w.mix.pcs+' pieces per guest. AED '+peMoney(w.addValueTotal)+' of the budget is still free: add a plated course, a live station, or upgrade the beverage package to use it (add those in the event after creating the draft) rather than leaving it unspent.</div>'
        : '<div style="font-size:12px;margin-top:4px;color:#2E6B34">Spends the budget — '+w.mix.pcs+' pieces/guest'+(w.gap>0?' · only AED '+peMoney(w.gap)+' to spare':'')+' ✓</div>')+
    '<div style="font-size:10.5px;color:#4F4535;margin-top:4px">Kitchen rules applied: pieces scaled to fill the budget (no piece cap) · '+w.guests+' guests → up to '+w.cap+' different canapés · minimum orders respected'+(w.excl&&w.excl.length?' · <b style="color:#400207">guest requests: '+w.excl.join(', ')+'</b>':'')+'.</div></div>';
  var groups = [{k:'Cold',n:'Cold'},{k:'Hot',n:'Hot'},{k:'Dessert',n:'Dolci'}];
  h += '<div class="pe-card"><b style="color:#400207">Suggested menu — '+w.picked.length+' canapés</b>'+
    '<div style="font-size:11px;color:#4F4535;margin:2px 0 6px">Built from the live dish library. Create the draft, then swap any dish freely in the event before sending.</div>';
  groups.forEach(function(g){
    var list = w.picked.filter(function(p){ return p.dish.serve===g.k; });
    if(!list.length) return;
    h += '<div style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#544418;margin:8px 0 2px">'+g.n+'</div>';
    list.forEach(function(p){
      var d = p.dish;
      h += '<div class="pe-dishrow"><span><b>'+peEsc(d.name)+'</b> <span style="color:#574232;font-size:10.5px">'+peEsc(peAllergenText(d.allergens))+'</span>'+
        '<br><span style="font-size:11px;color:#4F4535">'+peEsc(d.tier||'')+' · AED '+peMoney(d.sell_price)+'/pc'+(p.pcs>1?' · ×'+p.pcs+' per guest':'')+'</span></span>'+
        '<span style="font-size:11.5px;color:#400207;white-space:nowrap">AED '+peMoney((Number(d.sell_price)||0)*p.pcs)+' /guest</span></div>';
    });
  });
  h += '<div style="margin-top:12px">'+(peCanEdit()
    ? '<button class="pe-btn" onclick="peWizCreate()" '+(peWiz.busy?'disabled':'')+'>'+(peWiz.busy?'Creating…':'Create the draft event')+'</button>'+
      '<span style="font-size:11px;color:#4F4535;margin-left:10px">Opens the event ready to print or email the proposal.</span>'
    : '<span style="font-size:12px;color:#6B5E4E">View only — creating the draft is done by Katarina, Andrea or Francesco.</span>')+'</div></div>';
  return h;
}
async function peWizCreate(){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var w = peWizCalc();
  if(!w.ready){ peToast('Fill guests, budget and beverage first', true); return; }
  if(peWiz.busy) return;
  var timeTo = null;
  if(peWiz.time){
    var hrs0 = (w.bev && w.bev.duration_hours) ? Number(w.bev.duration_hours) : 3;
    timeTo = peAddHoursTime(peWiz.time, hrs0);
  }
  // Is the space already taken? Every client-facing send is already gated on this,
  // but she can promise a date on the phone long before a send — so ask here too.
  // A warning, not a stop: two things in one room can be deliberate.
  var wClash = peClashPairs({ id:'__wizard__', event_date:peWiz.date||null, area:peWiz.area||null,
                              time_from:peWiz.time||null, time_to:timeTo, guests:w.guests });
  if(wClash.length){
    var names = wClash.map(function(p){
      return (p.ev.client_name||p.ev.company||'another booking')+(p.buyout?' (full venue)':'')+' — '+peDLabel(p.date)+(p.area?', '+p.area:'');
    });
    if(!(await peConfirm({title:'That space is already booked',
      html:'This date and area already hold:<br><br><b>'+peEsc(names.join('</b><br><b>'))+'</b>'+
        '<br><br>Create this booking anyway?',
      ok:'Create it anyway', cancel:'Change the date or area', danger:true}))) return;
  }
  peWiz.busy = true; peWizPaint();
  // The booking is written first and the dishes after. If the dishes fail, the
  // booking still exists — so the catch must not tell her nothing was created,
  // which is how the same event got built twice.
  var created = null;
  try{
    var dietParts = [];
    if(w.excl&&w.excl.length) dietParts.push('Guest requests: '+w.excl.join(', '));
    if(peWiz.dietaryNote && peWiz.dietaryNote.trim()) dietParts.push(peWiz.dietaryNote.trim());
    var row = { venue_id:'robertos-difc', status:'draft', updated_by:peActor(),
                client_name: peWiz.client||null, event_date: peWiz.date||null,
                time_from: peWiz.time||null, time_to: timeTo,
                area: peWiz.area||null, guests: w.guests,
                bev_package_id: w.bev ? w.bev.id : null,
                bev_mode: peWiz.bev==='dry' ? 'dry' : null,
                dietary: dietParts.length ? dietParts.join(' · ') : null,
                handled_by: peActor(),
                payment_terms:'50% deposit to confirm, balance on the day' };
    var r = await peInsertEvent(row);
    if(r.error || !r.data) throw (r.error||{message:'no data'});
    created = r.data;
    peState.events.push(r.data);
    var items = w.picked.map(function(p){ return {event_id:r.data.id, dish_id:p.dish.id, pcs_per_guest:p.pcs}; });
    if(items.length){
      var ri = await sb.from('event_items').insert(items).select();
      if(ri.error) throw ri.error;
      peState.items[r.data.id] = ri.data||[];
    }
    await sb.from('event_log').insert({event_id:r.data.id, action:'created',
      detail:'Budget proposal: AED '+peMoney(w.budget)+' · '+(w.bev?w.bev.name+' AED '+peMoney(w.bevTotal):'no beverage')+' · food AED '+peMoney(w.realFoodPP)+'/guest ('+w.mix.pcs+' pcs)'+(w.excl&&w.excl.length?' · guest requests: '+w.excl.join(', '):'')+' · total AED '+peMoney(w.total),
      actor:peActor()});
    peWiz.busy = false;
    peToast('Draft created ✓ — review it, then print or email the proposal');
    peGo('event', r.data.id);
  }catch(err){
    peWiz.busy = false;
    if(created){
      // It exists. Take her to it and name what is missing, rather than sending
      // her back to a form that would create the whole thing a second time.
      peToast('Booking created ✓ — but the dishes did not attach. Add them on the event.', true);
      peGo('event', created.id);
      return;
    }
    peWizPaint();
    peToast('NOT created — '+String(err&&err.message||err).slice(0,120), true);
  }
}

// ── guided setup — one question per screen, for a nervous first-timer ────────
// Sits ON TOP of the free-form editor: collect the essentials in 4 calm steps,
// then hand off to the full event (already filled in). Never removes a capability.
var peGuide = null;
// Work-in-progress key. The guided flow keeps everything in memory and only writes
// to the DB at the final step — so if her phone locks or a call reloads the app
// mid-setup, steps 1–3 would be lost. We mirror peGuide into localStorage on every
// change (minus the transient busy/emailErr flags) so an accidental reload recovers.
var PE_GUIDE_WIP = 'pe_guide_wip';
function peGuideStash(){
  try{
    if(!peGuide) return;
    var g = peGuide, out = {};
    for(var k in g){
      if(k==='busy' || k==='emailErr') continue;
      if(Object.prototype.hasOwnProperty.call(g,k)) out[k] = g[k];
    }
    localStorage.setItem(PE_GUIDE_WIP, JSON.stringify(out));
  }catch(e){}
}
function peGuideClearWip(){ try{ localStorage.removeItem(PE_GUIDE_WIP); }catch(e){} }
function peGuideLoadWip(){
  try{
    var raw = localStorage.getItem(PE_GUIDE_WIP); if(!raw) return null;
    var o = JSON.parse(raw); return (o && typeof o==='object') ? o : null;
  }catch(e){ return null; }
}
// True only if real content was entered (not just the empty defaults) — so we never
// nag about a stash that holds nothing.
function peGuideWipHasData(o){
  if(!o) return false;
  return !!((o.name&&String(o.name).trim())||(o.company&&String(o.company).trim())||
    (o.email&&String(o.email).trim())||(o.phone&&String(o.phone).trim())||
    o.date||o.guests||o.time||o.foodMode||o.packId||o.setKey||o.bevId);
}
function peGuideFresh(){ return { step:0, name:'', company:'', email:'', phone:'', date:'', time:'', area:'Scala and Bar', guests:'', foodMode:'', packId:'', setKey:'', bevId:'', busy:false }; }
async function peStartGuide(){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  // If she has an unfinished event stashed, offer to resume it rather than silently
  // overwriting her work with a blank form.
  var wip = peGuideLoadWip();
  if(peGuideWipHasData(wip)){
    var nm = (wip.name && String(wip.name).trim()) ? String(wip.name).trim() : 'unnamed';
    var resume = await peConfirm({
      title:'Resume the event you started?',
      html:'You have an unfinished event — <b>'+peEsc(nm)+'</b>. Pick up where you left off, or start a new one instead?',
      ok:'Resume', cancel:'Start fresh' });
    if(resume){
      peGuide = peGuideFresh();
      for(var k in wip){ if(Object.prototype.hasOwnProperty.call(wip,k)) peGuide[k] = wip[k]; }
      peGuide.busy = false; peGuide.emailErr = false;
      peGo('guided');
      return;
    }
    peGuideClearWip();   // Start fresh — drop the old work-in-progress.
  }
  peGuide = peGuideFresh(); peGuideStash(); peGo('guided');
}
function peGuideSet(f, v){ peGuide[f] = v; peGuideStash(); }
function peGuideFood(mode){ peGuide.foodMode = mode; peGuideStash(); renderMain(); }
async function peGuideBack(){
  if(!peGuide){ peGo('list'); return; }
  if(peGuide.step>0){ peGuide.step--; peGuideStash(); renderMain(); return; }
  // Step 0 → leaving the guided flow. If real data was entered, name the consequence
  // before discarding it. (An accidental reload still recovers from the stash — this
  // only fires on a deliberate Cancel/Back.)
  if(peGuideWipHasData(peGuide)){
    if(!(await peConfirm({title:'Discard this new event?', html:'You’ve started an event but haven’t created it yet. Leave now and what you entered won’t be kept.', ok:'Discard', cancel:'Keep editing', danger:true}))) return;
  }
  peGuideClearWip(); peGuide=null; peGo('list');
}
function peGuideNext(){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var g = peGuide;
  if(g.step===0 && !(g.name && g.name.trim())){ peToast('Add a name to continue', true); return; }
  if(g.step===0 && g.email && g.email.trim() && !peEmailsValid(g.email)){ g.emailErr=true; peToast('An email looks off — separate several with a comma', true); renderMain(); return; }
  if(g.step===0) g.emailErr=false;
  if(g.step===1){
    if(!g.date){ peToast('Add the date to continue', true); return; }
    if(!g.guests){ peToast('Add the number of guests', true); return; }
  }
  g.step++; peGuideStash(); renderMain();
}
function peRenderGuided(){
  if(!peGuide) peGuide = peGuideFresh();
  var g = peGuide;
  var names = ['Who','When','Food','Review'];
  var h = '<div class="pe-wrap" style="max-width:520px"><div class="pe-sheet">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
    '<span class="pe-tab" onclick="peGuideBack()">‹ '+(g.step===0?'Cancel':'Back')+'</span>'+
    '<span style="font-size:11.5px;color:#4F4535">Step '+(g.step+1)+' of 4 · '+names[g.step]+'</span></div>';
  h += '<div style="display:flex;gap:5px;margin-bottom:10px">'+[0,1,2,3].map(function(i){
    return '<span style="flex:1;height:4px;border-radius:2px;background:'+(i<=g.step?'#400207':'#E3D5C2')+'"></span>';
  }).join('')+'</div>';
  // Escape hatch — an experienced user skips the questions and jumps into the full
  // editor, carrying whatever's been entered so far. Reuses peGuideFinish('save').
  h += '<div style="text-align:right;margin:-2px 0 14px"><span style="font-size:11.5px;color:#574232;text-decoration:underline;cursor:pointer'+(g.busy?';opacity:.5;pointer-events:none':'')+'" onclick="peGuideFinish(\'save\')">Create it now and open the full form ›</span></div>';
  h += '<div class="pe-card">';
  if(g.step===0){
    h += '<div class="pe-title" style="font-size:19px">Who’s the booking for?</div>'+
      '<div style="font-size:12px;color:#4F4535;margin:2px 0 12px">Just a name is fine — you can add the rest as you go.</div>'+
      '<div class="pe-lbl">Name</div><input class="pe-in" value="'+peEsc(g.name)+'" oninput="peGuideSet(\'name\',this.value)" placeholder="e.g. Giovanna">'+
      '<div class="pe-lbl" style="margin-top:10px">Company (optional)</div><input class="pe-in" value="'+peEsc(g.company)+'" oninput="peGuideSet(\'company\',this.value)">'+
      '<div class="pe-lbl" style="margin-top:10px">Client email <span style="text-transform:none;letter-spacing:0;color:#574232">— so you can send the proposal</span></div><input class="pe-in" type="email" value="'+peEsc(g.email)+'" oninput="peGuideSet(\'email\',this.value);peGuide.emailErr=false" placeholder="name@email.com">'+
      (g.emailErr?'<div style="font-size:11px;color:#8A2A1A;margin:3px 2px 0">That doesn’t look like an email — check for a missing “@”.</div>':'')+
      '<div class="pe-lbl" style="margin-top:10px">Client phone (optional)</div><input class="pe-in" value="'+peEsc(g.phone)+'" oninput="peGuideSet(\'phone\',this.value)">';
  } else if(g.step===1){
    h += '<div class="pe-title" style="font-size:19px">When and where?</div>'+
      '<div class="pe-grid2" style="margin-top:12px"><div><div class="pe-lbl">Date</div><input class="pe-in" type="date" min="'+peToday()+'" value="'+peEsc(g.date)+'" oninput="peGuideSet(\'date\',this.value)"></div>'+
      '<div><div class="pe-lbl">Start time (optional)</div><select class="pe-in" onchange="peGuideSet(\'time\',this.value)">'+peTimeOptions(g.time)+'</select></div></div>'+
      '<div style="margin-top:10px"><div class="pe-lbl">Area</div><select class="pe-in" onchange="peGuideSet(\'area\',this.value)">'+PE_AREAS.map(function(a){ return '<option'+(g.area===a?' selected':'')+'>'+a+'</option>'; }).join('')+'</select></div>'+
      '<div style="margin-top:10px"><div class="pe-lbl">How many guests?</div>'+peStepWrap('<input class="pe-in" type="number" min="1" value="'+peEsc(g.guests)+'" oninput="peGuideSet(\'guests\',this.value)" placeholder="e.g. 25">')+'</div>';
  } else if(g.step===2){
    var card = function(mode, title, sub){
      var on = g.foodMode===mode;
      return '<div onclick="peGuideFood(\''+mode+'\')" style="border:'+(on?'2px solid #400207':'1px solid #C9AD96')+';border-radius:10px;background:'+(on?'#F7EEE2':'#fff')+';padding:11px 12px;margin-bottom:8px;cursor:pointer">'+
        '<div style="font-size:13.5px;color:'+(on?'#400207':'#2C1810')+';font-weight:'+(on?'600':'400')+'">'+title+'</div>'+
        (sub?'<div style="font-size:11px;color:#4F4535">'+sub+'</div>':'')+'</div>';
    };
    h += '<div class="pe-title" style="font-size:19px">What are they eating?</div>'+
      '<div style="font-size:12px;color:#4F4535;margin:2px 0 12px">Not sure? Start with a canapé package — you can change every dish later.</div>'+
      card('package','Canapé package','Pick a ready-made spread')+
      card('build','Build the menu myself','Add dishes one by one later')+
      card('setmenu','A plated set menu','Terra, Mare or Fuoco');
    if(g.foodMode==='package'){
      h += '<div style="margin-top:4px"><div class="pe-lbl">Which package?</div><select class="pe-in" onchange="peGuideSet(\'packId\',this.value)"><option value="">Choose a package…</option>'+
        peState.packs.map(function(p){ return '<option value="'+p.id+'"'+(g.packId===p.id?' selected':'')+'>'+peEsc(p.name)+' — AED '+peMoney(p.price_pp)+'/guest</option>'; }).join('')+'</select></div>';
    } else if(g.foodMode==='setmenu'){
      h += '<div style="margin-top:4px"><div class="pe-lbl">Which set menu?</div><select class="pe-in" onchange="peGuideSet(\'setKey\',this.value)"><option value="">Choose a set menu…</option>'+
        peSetMenusPick().map(function(m){ return '<option value="'+m.key+'"'+(g.setKey===m.key?' selected':'')+'>'+peEsc(m.name)+' — AED '+m.price+'/guest</option>'; }).join('')+'</select></div>'+
        '<div style="font-size:11px;color:#4F4535;margin-top:2px">Menus with a sharing version: pick individual or shared on the event’s Food card after this.</div>';
    }
    var bevs = peState.bevs.filter(function(b){ return b.active!==false; })
      .sort(function(a,b){ return (a.name||'').localeCompare(b.name||'') || (Number(a.duration_hours)||0)-(Number(b.duration_hours)||0); });
    h += '<div style="border-top:1px dashed rgba(107,31,42,0.15);margin-top:12px;padding-top:12px"><div class="pe-lbl">Drinks (optional)</div>'+
      '<select class="pe-in" onchange="peGuideSet(\'bevId\',this.value)">'+
      '<option value=""'+(g.bevId===''?' selected':'')+'>No beverage package</option>'+
      '<option value="dry"'+(g.bevId==='dry'?' selected':'')+'>No alcohol — soft drinks &amp; water</option>'+
      bevs.map(function(b){ return '<option value="'+b.id+'"'+(g.bevId===b.id?' selected':'')+'>'+peEsc(b.name)+(b.duration_hours?' — '+b.duration_hours+'h':'')+(b.price_pp!=null?' — AED '+peMoney(b.price_pp)+'/guest':' — price on the proposal')+(b.non_alcoholic?' · alcohol-free':'')+'</option>'; }).join('')+'</select></div>';
  } else {
    // Food is only "ready" if a package or set menu was actually chosen. If she
    // picked "build myself" (or nothing), there is NO menu yet — she must build it
    // first, so we never let a food-less proposal go to the guest.
    var hasFood = (g.foodMode==='package' && g.packId) || (g.foodMode==='setmenu' && g.setKey);
    var foodPP = null, foodLbl = '';
    if(g.foodMode==='setmenu' && g.setKey){ var m2 = peSetMenuByKey(g.setKey); if(m2){ foodPP = m2.price; foodLbl = m2.name; } }
    else if(g.foodMode==='package' && g.packId){ var pk = null; peState.packs.forEach(function(p){ if(p.id===g.packId) pk=p; }); if(pk){ foodPP = Number(pk.price_pp); foodLbl = pk.name; } }
    var bev = (g.bevId && g.bevId!=='dry') ? peBevById(g.bevId) : null;
    var bevPP = bev ? Number(bev.price_pp) : 0;
    var guests = parseInt(g.guests,10)||0;
    if(hasFood && foodPP!=null){
      var total = (foodPP+bevPP)*guests;
      h += '<div class="pe-title" style="font-size:19px">Ready to send</div>'+
        '<div style="background:#F3E9DA;border-radius:10px;padding:14px;text-align:center;margin:12px 0 10px">'+
        '<div style="font-size:12px;color:#4F4535">'+peEsc(g.name||'Booking')+(g.date?' · '+peDLabel(g.date):'')+'</div>'+
        '<div style="font-size:18px;color:#400207;font-weight:600;margin:3px 0">'+(guests?guests+' guests':'—')+' · AED '+peMoney(total)+'</div>'+
        '<div style="font-size:11px;color:#4F4535">'+peEsc(foodLbl)+(bev?' · '+peEsc(bev.name):(g.bevId==='dry'?' · no alcohol — soft drinks & water':''))+' — everything included</div></div>'+
        '<div style="font-size:11.5px;color:#2E6B34;margin-bottom:12px">Nothing is sent until you choose below.</div>';
      if(g.email){
        h += '<button class="pe-btn pe-primary" style="width:100%;box-sizing:border-box;padding:13px;margin-bottom:8px" onclick="peGuideFinish(\'send\')"'+(g.busy?' disabled':'')+'>'+(g.busy?'Working…':'Send proposal (they sign online)')+'</button>';
      } else {
        h += '<button class="pe-btn" style="width:100%;box-sizing:border-box;padding:13px;margin-bottom:2px;opacity:.55" onclick="peToast(\'Add the client email in step 1 to send\',true);peGuide.step=0;renderMain()">Send proposal (they sign online)</button>'+
          '<div style="font-size:11px;color:#8A2A1A;margin:0 0 8px">Add the client email in step 1 to send it to them.</div>';
      }
      h += '<button class="pe-btn sec" style="width:100%;box-sizing:border-box;padding:12px" onclick="peGuideFinish(\'save\')"'+(g.busy?' disabled':'')+'>Save and open the event</button>'+
        '<div style="font-size:10.5px;color:#4F4535;margin-top:10px;text-align:center">You can change anything later.</div>';
    } else {
      // No menu yet — build it before anything can be sent.
      h += '<div class="pe-title" style="font-size:19px">One more step — your menu</div>'+
        '<div style="background:#F3E9DA;border-radius:10px;padding:14px;text-align:center;margin:12px 0 10px">'+
        '<div style="font-size:12px;color:#4F4535">'+peEsc(g.name||'Booking')+(g.date?' · '+peDLabel(g.date):'')+'</div>'+
        '<div style="font-size:18px;color:#400207;font-weight:600;margin:3px 0">'+(guests?guests+' guests':'—')+'</div>'+
        '<div style="font-size:11px;color:#4F4535">'+(bev?peEsc(bev.name):(g.bevId==='dry'?'No alcohol — soft drinks & water':'No drinks yet'))+' · menu not built yet</div></div>'+
        '<div style="font-size:12px;color:#7F5C00;background:#FAF0DA;border-radius:8px;padding:10px 12px;margin-bottom:12px">Your menu isn’t built yet, so there’s nothing to send. Save this and add the dishes on the next screen — you can send the proposal once the food is on it.</div>'+
        '<button class="pe-btn pe-primary" style="width:100%;box-sizing:border-box;padding:13px" onclick="peGuideFinish(\'save\')"'+(g.busy?' disabled':'')+'>'+(g.busy?'Working…':'Save and build the menu')+'</button>'+
        '<div style="font-size:10.5px;color:#4F4535;margin-top:10px;text-align:center">This won’t send anything to the guest.</div>';
    }
  }
  h += '</div>';
  if(g.step<3){
    h += '<div style="margin-top:14px"><button class="pe-btn pe-primary" style="width:100%;box-sizing:border-box;padding:13px" onclick="peGuideNext()">Continue ›</button></div>';
  }
  return h+'</div></div>';   // pe-sheet, pe-wrap
}
async function peGuideFinish(action){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  var g = peGuide; if(!g || g.busy) return;
  var buildMode = !((g.foodMode==='package' && g.packId) || (g.foodMode==='setmenu' && g.setKey));
  if(action==='send' && !g.email){ peToast('Add the client email in step 1 to send', true); g.step=0; renderMain(); return; }
  if(action==='send' && !peEmailsValid(g.email)){ g.emailErr=true; peToast('An email looks off — separate several with a comma', true); g.step=0; renderMain(); return; }
  g.busy = true; renderMain();
  try{
    var gBev = (g.bevId && g.bevId!=='dry') ? peBevById(g.bevId) : null;
    var gEnd = g.time ? peAddHoursTime(g.time, (gBev && gBev.duration_hours)?Number(gBev.duration_hours):3) : null;
    var row = { venue_id:'robertos-difc', status:'draft', updated_by:peActor(),
      client_name:g.name||null, company:g.company||null,
      contact_email:g.email||null, contact_phone:g.phone||null,
      event_date:g.date||null, time_from:g.time||null, time_to:gEnd, area:g.area||null,
      guests:g.guests?parseInt(g.guests,10):null,
      bev_package_id:(g.bevId && g.bevId!=='dry')?g.bevId:null, bev_mode:g.bevId==='dry'?'dry':null,
      payment_terms:'50% deposit to confirm, balance on the day' };
    var pk = null;
    if(g.foodMode==='setmenu' && g.setKey){ var m = peSetMenuByKey(g.setKey); if(m){ row.set_menu={key:m.key, choices:{}}; row.package_label=m.name; row.food_price_pp=m.price; } }
    else if(g.foodMode==='package' && g.packId){ peState.packs.forEach(function(p){ if(p.id===g.packId) pk=p; }); if(pk){ row.package_label=pk.name; row.food_price_pp=Number(pk.price_pp); } }
    var r = await sb.from('events_desk').insert(row).select().single();
    if(r.error || !r.data) throw (r.error||{message:'no data'});
    peState.events.push(r.data);
    if(pk && (pk.dish_ids||[]).length){
      var items = (pk.dish_ids||[]).map(function(d){ return {event_id:r.data.id, dish_id:d, pcs_per_guest:1, qty_confirmed:false}; });
      var ri = await sb.from('event_items').insert(items).select();
      if(!ri.error) peState.items[r.data.id] = ri.data||[];
    }
    sb.from('event_log').insert({event_id:r.data.id, action:'created', detail:'guided setup', actor:peActor()});
    var id = r.data.id; peGuide = null; peGuideClearWip();
    peGo('event', id);
    if(action==='send'){ peEmailAgreement(id); }
    else {
      peToast(buildMode ? 'Event created ✓ — now build the menu below' : 'Event created ✓ — review it, then send when you’re ready');
      if(buildMode) setTimeout(function(){ peScrollToCard('food'); }, 350);
    }
  }catch(err){
    if(peGuide) peGuide.busy = false; renderMain();
    peToast('NOT created — '+String(err&&err.message||err).slice(0,120), true);
  }
}

// ── monthly report (replaces the Group Report + RLL financials) ──────────────
// Every headline figure for the month being VIEWED, in one pass. This used to be
// four raw sums pinned to today's month while the tables below followed the month
// navigator — so one screen showed August tables under July numbers.
// Andrea Sacchi, 17 Jul 2026, drives the rest of the shape:
//   "year to date should reflect year to date only, future confirmed event on the
//    book are converted pipeline"
//   "we need to know whats a prospect, tentative and converted"
//   "unconfirmed prospect without a date ... not included in the pipeline yet"
function peReportData(mk){
  var today = peToday();
  var plus30 = localISO(new Date(Date.now()+30*86400000));
  var yr = mk.slice(0,4);
  // Reporting year starts in JULY (Francesco, 21 Jul 2026: "Year to date clearly
  // labeled as from July"). So YTD runs from 1 July of the current reporting year
  // through today and does NOT reset in January. July is taken relative to TODAY,
  // not the month being viewed — "to date" always means up to the real today,
  // whatever month the navigator is parked on.
  var tM = +today.slice(5,7), tY = +today.slice(0,4);
  var fyYear = (tM >= 7) ? tY : tY - 1;
  var fyStart = fyYear + '-07-01';
  var K = { month:{n:0,v:0}, mtd:{n:0,v:0}, n30:{n:0,v:0},
            prospect:{n:0,v:0}, tentative:{n:0,v:0}, pipeline:{n:0,v:0},
            leads:{n:0,v:0}, needDate:{n:0,v:0},
            ytd:{n:0,v:0}, convPipe:{n:0,v:0},
            lost:{n:0,v:0}, wonYr:{n:0,v:0}, fyYear:fyYear, fyStart:fyStart };
  peState.events.forEach(function(e){
    // Scope every figure to the person the report is viewed as (e.g. Valentina's
    // budget excludes Ouafaa's direct bookings). 'all' = the whole book.
    if(!peReportLeadMatch(e)) return;
    var v = peEventValue(e) || 0;
    var d = e.event_date ? String(e.event_date).slice(0,10) : null;
    var s = peStage(e);
    var add = function(b){ b.n++; b.v += v; };
    if(s === 'converted' && d && peMonthKey(d) === mk) add(K.month);
    if(s === 'converted' && d && peMonthKey(d) === mk && d <= today) add(K.mtd);  // month to date
    if(s === 'converted' && d && d >= today && d < plus30) add(K.n30);
    if(s === 'prospect')  { add(K.prospect);  add(K.pipeline); }
    if(s === 'tentative') { add(K.tentative); add(K.pipeline); }
    if(s === 'lead') add(K.leads);
    if(peNeedsDate(e)) add(K.needDate);
    // Year to date runs from 1 June of the reporting year to today (see above),
    // independent of the month being viewed.
    if(s === 'converted' && d && d >= fyStart && d <= today) add(K.ytd);
    // Won and converted-pipeline still follow the year being VIEWED.
    if(s === 'converted' && d && d.slice(0,4) === yr){
      add(K.wonYr);
      if(d > today) add(K.convPipe);   // confirmed, still to come
    }
    if(s === 'lost' && d && d.slice(0,4) === yr) add(K.lost);
  });
  // Andrea: "What percentage of enquiries do we convert, and what did we walk away
  // from?" Won and lost are both counted on the viewed year so the rate is honest.
  var decided = K.wonYr.n + K.lost.n;
  K.winRate = decided ? Math.round(K.wonYr.n / decided * 100) : null;
  K.decided = decided;
  return K;
}
// ── The monthly events target ───────────────────────────────────────────────
// Andrea Sacchi, 17 Jul 2026: "minimum target sale expressed in number of events
// and revenue". Until now there was no target anywhere, so every figure on this
// report was an absolute with nothing to measure it against — it could state a
// number, never a verdict.
//
// He was asked for BOTH numbers and gave exactly one: "Target for the month of
// July and august for events is 150000 AED". So the revenue target is his, and
// the event COUNT is deliberately left empty rather than invented — a made-up
// count would read as his on his own report. The card says which is missing.
//
// This is an admin screen: it is set once a month by whoever sets budgets and
// Valentina never touches it, exactly as he was told when he approved it.
// Targets are keyed by month AND person (the report's current scope). The empty
// string is the "Everyone" / overall budget; a name is that person's own budget.
function peCurLeadKey(){ var L = peState.reportLead || 'all'; return L==='all' ? '' : L; }
function peTargetKey(mk){ return mk + '|' + peCurLeadKey(); }
function peTargetOf(mk){ return (peState.targets || {})[peTargetKey(mk)] || null; }
async function peSaveTarget(el, mk, field){
  if(!peCanEdit()){ peToast('View only — ask Andrea or Francesco to set the target', true); return; }
  var raw = String(el.value||'').trim();
  var v = raw === '' ? null : Number(raw);
  if(v != null && (isNaN(v) || v < 0)){ peInlineErr(el, 'That needs to be a number.'); return; }
  peInlineErr(el, '');
  var lead = peCurLeadKey();
  var row = { month:mk, lead:lead, updated_by:peActor(), updated_at:new Date().toISOString() };
  var cur = peTargetOf(mk) || {};
  row.target_events  = (field==='target_events')  ? (v==null?null:Math.round(v)) : (cur.target_events==null?null:cur.target_events);
  row.target_revenue = (field==='target_revenue') ? v : (cur.target_revenue==null?null:cur.target_revenue);
  var r = await sb.from('event_targets').upsert(row, {onConflict:'month,lead'});
  if(r.error){
    peToast('NOT saved — run foh-events-target-per-person.sql once in Supabase, then this saves.', true);
    return;
  }
  peState.targets = peState.targets || {};
  peState.targets[peTargetKey(mk)] = row;
  peState.targetsOk = true;
  peToast('Target saved ✓');
  renderMain();
}
// Target vs where the month actually stands. "Actual" here is the SAME figure
// the "converted" card above shows (K.month) — booked and won business for this
// month — so the two can never disagree.
function peTargetCardHTML(mk, K){
  var mLbl = new Date(+mk.slice(0,4), +mk.slice(5,7)-1, 1).toLocaleDateString('en-GB',{month:'long'});
  var ce = peCanEdit();
  var tg = peTargetOf(mk);
  var tv = tg && tg.target_revenue != null ? Number(tg.target_revenue) : null;
  var tn = tg && tg.target_events  != null ? Number(tg.target_events)  : null;
  var h = '<div class="pe-card" style="border-color:rgba(201,168,76,0.55);background:#FDFBF6">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
    '<b style="font-size:14px;color:#400207">Target for '+peEsc(mLbl)+'</b>'+
    '<span style="font-size:11px;color:#4F4535">Set once a month — nothing on the events desk changes</span></div>';
  if(peState.reportLead && peState.reportLead!=='all'){
    h += '<div style="margin-top:6px;font-size:11.5px;color:#6B4A33">This is <b>'+peEsc(peLeadLabel(peState.reportLead))+'</b>’s own budget and their bookings only. Switch to <b>Everyone</b> for the overall month target.</div>';
  }
  if(peState.targetsOk === false){
    h += '<div style="margin-top:8px;font-size:12.5px;color:#7A5500;background:#FBF0D6;border:1px solid #DFC680;border-radius:9px;padding:9px 12px">'+
      'Targets need <b>foh-events-oneevening.sql</b> run once in Supabase before they can be saved. Everything else on this report works as normal.</div>';
  }
  // Revenue — his number, and the pace verdict that was the whole point of it.
  //
  // The target is NET (Francesco, 18 Jul 2026). Every booking in this module is
  // valued GROSS — the price the client is quoted, carrying 10% service, 7% DIFC
  // and 5% VAT. So the CONVERTED figure is converted to net before it is compared,
  // and both sides of every comparison here are net. Comparing his net target
  // against a gross total would have flattered the month by about 23.6% — the
  // single most likely way this card could have lied.
  if(tv != null){
    var netConv = peNetOf(K.month.v) || 0;
    var pct = tv ? Math.round(netConv / tv * 100) : null;
    var gap = tv - netConv;
    var onPlan = gap <= 0;
    h += '<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">'+
      '<div style="flex:1;min-width:150px"><div class="pe-lbl">Revenue target (net)</div>'+
        '<div style="font-family:\'Playfair Display\',serif;font-size:19px;color:#400207">AED '+peMoney(tv)+'</div>'+
        '<div style="font-size:11px;color:#4F4535">AED '+peMoney(peGrossOf(tv))+' at menu prices</div></div>'+
      '<div style="flex:1;min-width:150px"><div class="pe-lbl">Converted so far (net)</div>'+
        '<div style="font-family:\'Playfair Display\',serif;font-size:19px;color:#400207">AED '+peMoney(netConv)+'</div>'+
        '<div style="font-size:11px;color:#4F4535">AED '+peMoney(K.month.v)+' gross</div></div>'+
      '<div style="flex:1;min-width:150px"><div class="pe-lbl">'+(onPlan?'Ahead by (net)':'Still to find (net)')+'</div>'+
        '<div style="font-family:\'Playfair Display\',serif;font-size:19px;color:'+(onPlan?'#1C5A25':'#7E1A0C')+'">AED '+peMoney(Math.abs(gap))+'</div>'+
        '<div style="font-size:11px;color:#4F4535">'+(pct==null?'':pct+'% of target')+'</div></div>'+
    '</div>'+
    '<div style="margin-top:9px;height:7px;border-radius:4px;background:#EDE7DC;overflow:hidden">'+
      '<i style="display:block;height:100%;width:'+Math.max(0,Math.min(100, tv? netConv/tv*100 : 0))+'%;background:'+(onPlan?'#4E9E56':'#C9A84C')+'"></i></div>'+
    '<div style="margin-top:7px;font-size:11px;color:#4F4535">Target and progress are both <b>net</b> — what finance books. Bookings are quoted gross, so each figure shows the other underneath it.</div>';
  }
  // The count he was asked for and did not give. Named as missing rather than
  // filled in with a guess — see the block comment above.
  var whoLbl = (peState.reportLead && peState.reportLead!=='all') ? ' — '+peEsc(peLeadLabel(peState.reportLead)) : '';
  h += '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:end">'+
    '<div style="flex:1;min-width:160px"><div class="pe-lbl">Revenue target for '+peEsc(mLbl)+whoLbl+' (AED, net)</div>'+
      '<input class="pe-in" type="number" value="'+peEsc(tv==null?'':tv)+'" placeholder="not set" onchange="peSaveTarget(this,\''+mk+'\',\'target_revenue\')"'+(ce?'':' disabled')+'></div>'+
    '<div style="flex:1;min-width:160px"><div class="pe-lbl">Number of events</div>'+
      '<input class="pe-in" type="number" value="'+peEsc(tn==null?'':tn)+'" placeholder="not set" onchange="peSaveTarget(this,\''+mk+'\',\'target_events\')"'+(ce?'':' disabled')+'></div>'+
    '</div>';
  if(tn != null){
    var gapN = tn - K.month.n;
    h += '<div style="margin-top:9px;font-size:12.5px;color:'+(gapN<=0?'#1C5A25':'#6B4A00')+'">'+
      '<b>'+K.month.n+' of '+tn+' events</b> converted'+(gapN>0?' — '+gapN+' more to hit the target':' — target met')+'.</div>';
  } else if(tv != null){
    h += '<div style="margin-top:9px;font-size:12px;color:#4F4535">The <b>number of events</b> target is not set. Andrea gave a revenue figure for July and August and did not give a count, so we have not put one here — type it above and it applies from now on.</div>';
  } else {
    h += '<div style="margin-top:9px;font-size:12px;color:#4F4535">No target set for '+peEsc(mLbl)+' yet, so nothing on this page can say whether the month is on plan. Type one above.</div>';
  }
  return h + '</div>';
}
function peKpiCard(lbl, b, sub, accent, note){
  return '<div class="pe-kpi" style="border-top:3px solid '+accent+'">'+
    '<div class="pe-kpi-l">'+lbl+'</div>'+
    '<div class="pe-kpi-v">AED '+peMoney(b.v)+'</div>'+
    '<div class="pe-kpi-s">'+b.n+' '+sub+'</div>'+
    (note ? '<div class="pe-kpi-s" style="color:#574232">'+note+'</div>' : '')+
  '</div>';
}
function peKpis(mk){
  mk = mk || peState.month || peMonthKey(peToday());
  var K = peReportData(mk);
  var mLbl = new Date(+mk.slice(0,4), +mk.slice(5,7)-1, 1).toLocaleDateString('en-GB',{month:'long'});
  var yr = mk.slice(0,4);
  var h = '<div class="pe-kpis">'+
    peKpiCard(mLbl+' — confirmed', K.month, 'events', '#6B1F2A', 'net AED '+peMoney(peNetOf(K.month.v)))+
    peKpiCard('Next 30 days', K.n30, 'events coming', '#C9A84C')+
    peKpiCard('Pipeline', K.pipeline, 'in play', '#3E7FBB',
      K.prospect.n+' prospect &middot; '+K.tentative.n+' tentative')+
    peKpiCard('Leads', K.leads, 'to action', '#8A6A4F', 'no date yet &mdash; not pipeline')+
  '</div>';
  h += '<div class="pe-kpis" style="margin-top:10px">'+
    peKpiCard('Year to date', K.ytd, 'since Jul '+K.fyYear, '#4E9E56', 'net AED '+peMoney(peNetOf(K.ytd.v)))+
    peKpiCard('Confirmed pipeline', K.convPipe, 'still to come', '#4E9E56', 'confirmed, later this year')+
    peKpiCard(yr+' lost', K.lost, 'walked away', '#BB3A28')+
    '<div class="pe-kpi" style="border-top:3px solid #3E7FBB">'+
      '<div class="pe-kpi-l">Conversion</div>'+
      '<div class="pe-kpi-v">'+(K.winRate == null ? '&mdash;' : K.winRate+'%')+'</div>'+
      '<div class="pe-kpi-s">'+(K.winRate == null ? 'nothing decided yet' : K.wonYr.n+' won of '+K.decided+' decided')+'</div>'+
    '</div>'+
  '</div>';
  // Real money that cannot be scheduled. It used to vanish from every screen.
  // It is deliberately NOT in the month/YTD/converted-pipeline figures above —
  // an undated booking cannot honestly sit in any time bucket — so this banner
  // says exactly that rather than implying it is counted somewhere.
  if(K.needDate.n){
    h += '<div style="margin-top:10px;background:#FBF0D6;border:1px solid #DFC680;border-radius:9px;padding:9px 13px;font-size:12.5px;color:#6B4A00;line-height:1.5">'+
      '&#9888; <b>'+K.needDate.n+' confirmed booking'+(K.needDate.n>1?'s have':' has')+' no date</b> &mdash; AED '+peMoney(K.needDate.v)+
      ' of real money that is in <b>none of the figures above</b>, because nothing undated can be put in a month or a year. '+
      'Open '+(K.needDate.n>1?'them':'it')+' and set the date to bring '+(K.needDate.n>1?'them':'it')+' in.</div>';
  }
  return h;
}
function peForecastData(){
  var from = peState.fcFrom, to = peState.fcTo;
  if(!from || !to) return null;
  // Lost used to be a bare count — Andrea asked what we walked away from, which is
  // a value, not a tally. Pipeline here means prospect + tentative only (a lead has
  // no date, so it cannot fall inside a date window anyway).
  var conf={n:0,v:0}, pipe={n:0,v:0}, lost={n:0,v:0}, rows=[];
  peState.events.forEach(function(e){
    var d = e.event_date ? String(e.event_date).slice(0,10) : null;
    if(!d || d<from || d>to) return;
    var v = peEventValue(e)||0, s = peStage(e);
    if(s==='converted'){ conf.n++; conf.v+=v; rows.push(e); }
    else if(s==='prospect' || s==='tentative'){ pipe.n++; pipe.v+=v; rows.push(e); }
    else if(s==='lost'){ lost.n++; lost.v+=v; }
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
  return '<div class="brand">'+peLogoImg()+'</div><div class="fs-h">EVENTS FORECAST \u2014 '+peEsc(fc.from)+' to '+peEsc(fc.to)+'</div>'+
    '<p style="font-family:Arial,sans-serif;font-size:13px">Confirmed &amp; definite: <b>AED '+peMoney(fc.conf.v)+'</b> ('+fc.conf.n+' events) \u00b7 '+
    'Pipeline: <b>AED '+peMoney(fc.pipe.v)+'</b> ('+fc.pipe.n+' enquiries) \u00b7 '+
    'Lost: <b>AED '+peMoney(fc.lost.v)+'</b> ('+fc.lost.n+')</p>'+
    '<p style="font-family:Arial,sans-serif;font-size:11.5px;color:#4F4535">All values are gross (they include service charge, DIFC fee and VAT). '+
    'Confirmed net: <b>AED '+peMoney(peNetOf(fc.conf.v))+'</b>.</p>'+
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
function peEmailForecast(){
  var fc = peForecastData(); if(!fc) return;
  var standard = ['asacchi@skelmore.com'].concat(state.userEmail?[state.userEmail]:[]);
  standard = standard.filter(function(x,i){ return standard.indexOf(x)===i; });
  // #20 — external (skelmore.com) addresses start unticked; the sender opts them in.
  var checked = standard.filter(function(x){ return !/skelmore\.com$/i.test(x); });
  pePickRecipients({
    title:'Email the forecast', subtitle:fc.from+' to '+fc.to,
    standard:standard, checked:checked, you:state.userEmail,
    onSend:function(list){ peDoEmailForecast(fc, list); }
  });
}
async function peDoEmailForecast(fc, list){
  if(!fc || !list.length) return;
  try{
    var r = await sb.functions.invoke('send-event-email', { body:{
      to:list, from_name:peSenderName(), subject:'Roberto\u2019s DIFC \u2014 Events forecast '+fc.from+' to '+fc.to,
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
  // Grouped by Andrea's stage, not by raw status. "Definite — deposit paid" also
  // used to claim a payment for every 'done' event, whether a deposit was ever taken.
  var groups = [
    {n:'Converted — deposit paid', st:['deposit']},
    {n:'Converted — delivered', st:['done']},
    {n:'Converted — no deposit yet', st:['confirmed']},
    {n:'Tentative — quoted, awaiting the client', st:['sent']},
    {n:'Prospect — dated, not quoted yet', st:['draft']},
    {n:'Lost', st:['lost']}
  ];
  var monthEvents = peState.events.filter(function(e){ return e.event_date && peMonthKey(e.event_date)===mk && peReportLeadMatch(e); })
    .sort(function(a,b){ return String(a.event_date).localeCompare(String(b.event_date)); });
  var secHd = function(t){ return '<div style="font-family:\'Playfair Display\',serif;font-size:16px;color:#400207;margin:24px 2px 11px">'+t+'</div>'; };
  var h = peHeader('report');
  h += '<div style="margin-bottom:14px"><div class="pe-title">Monthly report</div>'+
    '<div style="font-size:12px;color:#4F4535">Where the events business stands \u2014 confirmed, coming and in play.</div></div>';
  // Person scope \u2014 the target/budget is set per person (e.g. Valentina), so the whole
  // report can be read one lead at a time, excluding everyone else's bookings. Only
  // appears once more than one person has events on the book.
  var rlKeys = peReportLeadKeys();
  var curRL = peState.reportLead || 'all';
  if(curRL!=='all' && rlKeys.indexOf(curRL)<0){ peState.reportLead = 'all'; curRL = 'all'; }  // person left the book \u2014 reset
  if(rlKeys.length >= 2){
    var rlDefs = [{k:'all',n:'Everyone'}].concat(rlKeys.map(function(k){ return {k:k, n:peLeadLabel(k)}; }));
    peState._reportLeadDefs = rlDefs;
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 2px 12px"><span style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#544418;margin-right:2px">Whose events</span>'+
      rlDefs.map(function(d,i){
        return '<span class="pe-tab'+(curRL===d.k?' on':'')+'" style="font-size:11px;padding:4px 11px" onclick="peSetReportLead('+i+')">'+peEsc(d.n)+'</span>';
      }).join('')+'</div>';
  }
  var rlNote = curRL!=='all' ? ' \u00b7 <span style="color:#400207">'+peEsc(peLeadLabel(curRL))+' only</span>' : '';
  h += '<div class="pe-lbl" style="margin:0 2px 9px">At a glance &middot; '+peEsc(mLbl)+rlNote+'</div>';
  h += peKpis(mk);   // follows the month navigator — it used to be pinned to today
  // Andrea (coo-events-2 #11): the report could state a number but never a
  // verdict, because there was nothing to measure it against. The target sits
  // directly under the figures it judges.
  h += peTargetCardHTML(mk, peReportData(mk));
  var fc = peState.fcRun ? peForecastData() : null;
  h += secHd('Forecast any period');
  h += '<div class="pe-card" style="border-color:rgba(201,168,76,0.55);background:#FDFBF6">'+
    '<div style="font-size:12.5px;color:#6B4A33;margin-bottom:12px">Confirmed vs pipeline value for any dates you choose.</div>'+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
    '<span style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#4F4535">From</span>'+
    '<input class="pe-in" style="width:auto" type="date" id="pe-fc-from" value="'+peEsc(peState.fcFrom||'')+'">'+
    '<span style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#4F4535">to</span>'+
    '<input class="pe-in" style="width:auto" type="date" id="pe-fc-to" value="'+peEsc(peState.fcTo||'')+'">'+
    '<button class="pe-btn sm" onclick="peRunForecast()">Run forecast</button>'+
    '</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'+
    '<button class="pe-btn sec sm"'+(fc?'':' style="opacity:.5"')+' onclick="'+(fc?'pePrintForecastDoc()':'peToast(\'Run a forecast first\',true)')+'">Print / PDF</button>'+
    '<button class="pe-btn sec sm"'+(fc?'':' style="opacity:.5"')+' onclick="'+(fc?'peEmailForecast()':'peToast(\'Run a forecast first\',true)')+'">Email report</button>'+
    '</div>'+
    (fc?'':'<div style="font-size:11px;color:#4F4535;margin-top:6px">Pick the dates and tap <b>Run forecast</b> — then you can print or email it.</div>')+
    (fc?'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">'+
      '<div style="flex:1;min-width:145px;background:#EEF6EC;border:1px solid #BAD9B4;border-radius:9px;padding:10px 12px"><div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#2E6B34">Confirmed &amp; definite</div><div style="font-family:\'Playfair Display\',serif;font-size:18px;color:#1C5A25">AED '+peMoney(fc.conf.v)+'</div><div style="font-size:11px;color:#4F6849">'+fc.conf.n+' event'+(fc.conf.n===1?'':'s')+'</div></div>'+
      '<div style="flex:1;min-width:145px;background:#FBF3DE;border:1px solid #DFC680;border-radius:9px;padding:10px 12px"><div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#7F5C00">Pipeline</div><div style="font-family:\'Playfair Display\',serif;font-size:18px;color:#6B4A00">AED '+peMoney(fc.pipe.v)+'</div><div style="font-size:11px;color:#725F35">'+fc.pipe.n+' enquir'+(fc.pipe.n===1?'y':'ies')+'</div></div>'+
      '<div style="flex:1;min-width:110px;background:#F7E9E6;border:1px solid #DDBBB4;border-radius:9px;padding:10px 12px"><div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#933">Lost</div><div style="font-family:\'Playfair Display\',serif;font-size:18px;color:#7E1A0C">AED '+peMoney(fc.lost.v)+'</div><div style="font-size:11px;color:#86554D">'+fc.lost.n+' walked away</div></div>'+
    '</div>':'')+
  '</div>';
  // ── Month detail — branded month navigator section ──
  h += secHd('Month by month');
  h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--vino);color:var(--cream);border-radius:12px;padding:10px 14px;margin-bottom:14px">'+
       '<button class="pe-btn sec sm" style="background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.5);color:var(--cream)" onclick="peCalShift(-1)">‹ Prev</button>'+
       '<div style="font-family:\'Playfair Display\',serif;font-size:19px">'+mLbl+'</div>'+
       '<span style="display:flex;gap:6px"><button class="pe-btn sec sm" style="background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.5);color:var(--cream)" onclick="peCalShift(1)">Next ›</button>'+
       '<button class="pe-btn sec sm" style="background:var(--cream);border-color:var(--cream);color:var(--vino);font-weight:700" onclick="pePrintReport()">Print / PDF</button></span></div>';
  var ytd = 0, mtot = 0;
  // Andrea: "year to date should reflect year to date only, future confirmed event
  // on the book are converted pipeline". These now come from the one pass in
  // peReportData so the footer, the cards and the tables can never disagree.
  var RK = peReportData(mk);
  mtot = RK.month.v; ytd = RK.ytd.v;
  // Andrea asked whether 350k is a good month. It only means something next to
  // the month before it.
  // Build the previous month's key from the date parts directly. Going via
  // toISOString() converts Dubai local midnight back to UTC and lands on the last
  // day of the month BEFORE the one we want — July would compare itself to May.
  var pd = new Date(+mk.slice(0,4), +mk.slice(5,7)-2, 1);
  var prevMk = pd.getFullYear()+'-'+String(pd.getMonth()+1).padStart(2,'0');
  var prev = peReportData(prevMk).month;
  var prevLbl = new Date(+prevMk.slice(0,4), +prevMk.slice(5,7)-1, 1).toLocaleDateString('en-GB',{month:'long'});
  var chg = prev.v ? Math.round((mtot - prev.v) / prev.v * 100) : null;
  groups.forEach(function(g){
    var isLost = g.st.length===1 && g.st[0]==='lost';
    if(isLost && !peState.lostReasons) peLoadLostReasons();
    var list = monthEvents.filter(function(e){ return g.st.indexOf(e.status)>=0; });
    var dotc = PE_STATUS_COL[g.st[0]]||PE_STATUS_COL.draft;
    h += '<div style="display:flex;align-items:center;gap:7px;margin:18px 2px 7px"><span style="width:9px;height:9px;border-radius:50%;background:'+dotc.bg+';border:1px solid '+dotc.b+'"></span><span class="pe-lbl" style="margin:0;font-size:11px">'+g.n+' ('+list.length+')</span></div>';
    // The "Value" column is peEventValue — the SAME figure the totals below are
    // summed from. This column used to be "Min spend", a different number, so the
    // table never added up to its own total. Buyouts are marked because they take
    // the whole venue (Andrea: "affect the whole operation and our guest").
    h += '<div class="pe-card" style="overflow-x:auto"><table class="pe-report"><tr><th>Date</th><th>Name / Company</th><th>Venue</th><th>Type</th><th>Time</th><th>Pax</th><th>Package</th><th style="text-align:right">Value (gross)</th><th>Contact</th>'+(isLost?'<th>Why lost</th>':'')+'</tr>';
    if(!list.length) h += '<tr><td colspan="'+(isLost?10:9)+'" style="color:#4F4535">—</td></tr>';
    var gTot = 0;
    list.forEach(function(e){
      var v = peEventValue(e)||0; gTot += v;
      var bo = peIsBuyout(e);
      // Andrea: "who sold these, and where did they come from" — source · handler
      // ride under the client name so attribution is on the page, not in his head.
      var src = [e.lead_source, e.handled_by ? 'w/ '+String(e.handled_by).split('@')[0] : ''].filter(Boolean).join(' · ');
      h += '<tr style="cursor:pointer'+(bo?';background:#FBF0D6':'')+'" onclick="peGo(\'event\',\''+e.id+'\')"><td>'+peDLabel(e.event_date)+'</td>'+
        '<td>'+peEsc(e.client_name||'')+(e.company?'<br><span style="color:#4F4535">'+peEsc(e.company)+'</span>':'')+
        (src?'<br><span style="color:#574232;font-size:10px">'+peEsc(src)+'</span>':'')+'</td>'+
        '<td>'+peEsc(e.area||'')+'</td>'+
        '<td>'+peEsc(e.event_type||'')+(bo?' <b style="color:#7F5C00">&#9679; BUYOUT</b>':'')+'</td><td>'+peEsc(e.time_from||'')+'</td>'+
        '<td>'+(e.guests||'')+'</td><td>'+peEsc(e.package_label||'')+'</td>'+
        '<td style="text-align:right">'+peMoney(v)+(e.pricing_type==='min_spend'?'<br><span style="font-size:10px;color:#4F4535">min spend</span>':'')+'</td>'+
        '<td>'+peEsc(e.contact_name||'')+(e.contact_phone?'<br>'+peEsc(e.contact_phone):'')+'</td>'+
        (isLost?'<td>'+peEsc((peState.lostReasons||{})[e.id]||'')+'</td>':'')+'</tr>';
    });
    if(list.length) h += '<tr><td colspan="7" style="text-align:right;color:#4F4535">Subtotal</td>'+
      '<td style="text-align:right"><b>'+peMoney(gTot)+'</b></td><td'+(isLost?' colspan="2"':'')+'></td></tr>';
    h += '</table></div>';
  });
  function totRow(lbl, gross, sub, top){
    return '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0'+
      (top?';border-top:1px solid rgba(201,168,76,0.3);margin-top:4px':'')+'">'+
      '<span style="font-size:12.5px;color:#6B4A33">'+lbl+(sub?'<br><span style="font-size:11px;color:#4F4535">'+sub+'</span>':'')+'</span>'+
      '<b style="font-family:\'Playfair Display\',serif;font-size:19px;color:#400207;text-align:right">AED '+peMoney(gross)+
      '<br><span style="font-family:Arial,sans-serif;font-size:11px;font-weight:normal;color:#4F4535">net '+peMoney(peNetOf(gross))+'</span></b></div>';
  }
  h += '<div style="max-width:460px;margin-top:22px;background:#F7EEE2;border:1px solid rgba(201,168,76,0.45);border-radius:12px;padding:14px 16px">'+
    totRow(mLbl+' confirmed', mtot,
      (chg==null ? 'no '+prevLbl+' to compare with'
                 : prevLbl+' AED '+peMoney(prev.v)+' &middot; <b style="color:'+(chg>=0?'#2E6B34':'#8A2A1A')+'">'+(chg>=0?'+':'')+chg+'%</b>'), false)+
    totRow('Month to date', RK.mtd.v, mLbl+' — delivered on or before today', true)+
    totRow('Year to date', ytd, 'since 1 July '+RK.fyYear+' — delivered on or before today', true)+
    totRow('Confirmed pipeline', RK.convPipe.v, 'confirmed, still to come', true)+
    '<div style="border-top:1px solid rgba(201,168,76,0.3);margin-top:6px;padding-top:8px;font-size:11px;color:#4F4535;line-height:1.5">'+
      'Values are <b>gross</b> — they include 10% service charge, 7% DIFC fee and 5% VAT. '+
      'Net is what finance books. A minimum-spend booking is valued at its minimum: the balance between that and what the guest consumes is billed as venue rental.</div>'+
  '</div>';
  h += peScrollTopBtn();
  return h+PE_FOOT;
}
function pePrintReport(){
  var el = document.getElementById('main-content');
  if(!el) return;
  pePrintHTML(peDocShell('Group report', '<div class="brand">'+peLogoImg()+'</div><div class="fs-h">GROUP REPORT — '+peEsc(peState.month)+'</div>'+
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
// Every à la carte line on the quick menu, in printed-menu order.
function peQuickAlcLines(){
  return peAlcAll().filter(function(a){ return (Number(peQuick.alc[a.id])||0) > 0; })
    .sort(function(x,y){ return (x.sort_order||999)-(y.sort_order||999); })
    .map(function(a){ return { a:a, qty:Number(peQuick.alc[a.id])||0 }; });
}
function peQuickTotals(){
  var pieces=0, price=0, distinct=0, minViol=[];
  peState.dishes.forEach(function(d){
    var q = Number(peQuick.qty[d.id])||0;
    if(q<=0) return;
    distinct++; pieces += q; price += q*(Number(d.sell_price)||0);
    if(d.min_order && q < d.min_order) minViol.push(d.name+' (min '+d.min_order+')');
  });
  // À la carte portions. A market-price or by-weight dish can be ON the menu
  // but has no number to multiply, so it adds nothing to the total and is named
  // instead — a quoted total must never quietly treat "no price" as zero.
  var alcPortions=0, alcPrice=0, alcCount=0, alcNoPrice=[];
  var alcLines = peQuickAlcLines();
  alcLines.forEach(function(l){
    alcCount++; alcPortions += l.qty;
    var p = peAlcPrice(l.a);
    if(p==null) alcNoPrice.push(l.a.name); else alcPrice += l.qty*p;
  });
  price += alcPrice;
  // The 15-dish cap is a kitchen VARIETY limit, and an à la carte portion is
  // another dish to prep — counting only canapés would let a 12-canapé menu
  // with 6 à la carte dishes read as 12 and pass a cap it actually breaks.
  distinct += alcCount;
  var guests = Number(peQuick.guests)||0;
  return { pieces:pieces, price:price, distinct:distinct, minViol:minViol, guests:guests,
           alcPortions:alcPortions, alcPrice:alcPrice, alcCount:alcCount, alcNoPrice:alcNoPrice,
           anything: (pieces>0 || alcPortions>0),
           perGuest: guests?price/guests:null, pcsPerGuest: guests?pieces/guests:null };
}
function peQuickSetAlc(id, val){
  peQuickRead();
  var n = Number(val)||0;
  if(n>0) peQuick.alc[id] = n; else delete peQuick.alc[id];
  renderMain();
}
function peRenderQuick(){
  var tt = peQuickTotals();
  var h = '<div class="pe-wrap"><div class="pe-sheet"><div class="pe-top"><span class="pe-tab" onclick="peGo(\'list\')">\u2039 Events</span>'+
    '<span style="font-size:12px;color:#4F4535">Quick menu \u2014 like the Excel, but it prints itself</span></div>';
  h += '<div class="pe-card"><div class="pe-grid3">'+
    '<div style="grid-column:1/3"><div class="pe-lbl">Menu title</div><input class="pe-in" id="pe-q-title" value="'+peEsc(peQuick.title)+'" onchange="peQuickRead()"></div>'+
    '<div><div class="pe-lbl">Number of guests</div><input class="pe-in" id="pe-q-guests" type="number" value="'+peEsc(peQuick.guests)+'" onchange="peQuickRead();renderMain()"></div>'+
    '</div></div>';
  // Saved: say so, and keep the three things she does next in one place. The
  // menu stays on screen so Print and WhatsApp still have something to send.
  if(peQuick.savedId){
    var savedEv = peEvById(peQuick.savedId);
    h += '<div class="pe-card" style="border-color:#2E6B34;background:#F1F6EF"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
      '<b style="color:#2E6B34">Saved ✓ '+peEsc(peQuick.title)+' is a draft booking</b>'+
      '<span style="display:flex;gap:8px;flex-wrap:wrap">'+
        '<button class="pe-btn sec sm" onclick="peQuickPrint()">Print / PDF menu</button>'+
        '<button class="pe-btn sec sm" onclick="peQuickWhatsApp()">Send by WhatsApp</button>'+
        '<button class="pe-btn sec sm" onclick="peGo(\'event\',\''+peQuick.savedId+'\')">Open the booking</button>'+
        '<button class="pe-btn sec sm" onclick="peQuickReset()">Start a new one</button>'+
      '</span></div>'+
      '<div style="font-size:11px;color:#6B4A33;margin-top:6px">The menu below is still here — printing or sending uses exactly what you see. '+
      (savedEv&&!savedEv.client_name?'Open the booking to add the client’s name and date.':'')+'</div></div>';
  }
  // A quick menu is for counting canapés. The moment the guest wants courses —
  // a set menu with a dish changed, a plated menu of her own — that is the
  // customise builder, and it is one tap from here rather than a screen away.
  if(peCanEdit()){
    h += '<div class="pe-card" style="border-color:rgba(201,168,76,0.5)"><b style="color:#400207">Or build a plated menu she can change</b>'+
      '<div style="font-size:11px;color:#4F4535;margin:2px 0 9px">Courses instead of pieces — start from a set menu and swap or add anything from the à la carte, or start from nothing. You set the price.</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
        '<select class="pe-in" style="width:auto;max-width:100%" onchange="if(this.value)peCmStart(this.value,null)">'+
          '<option value="">Start from a set menu…</option>'+
          peSetMenusPickInc().map(function(m){
            return '<option value="'+peSmEsc(m.key)+'">'+peEsc(m.name)+(m.price!=null?' — AED '+m.price+'/guest':'')+'</option>';
          }).join('')+
        '</select>'+
        '<button class="pe-btn sec sm" onclick="peCmStart(null,null)">Start from nothing</button>'+
        '<button class="pe-btn sec sm"'+(tt.anything?'':' disabled')+' onclick="peCmFromQuick()">Turn what’s below into a menu she can edit</button>'+
      '</div>'+
      (tt.anything?'':'<div style="font-size:11px;color:#8A2A1A;margin-top:6px">Add some dishes below first, then you can turn them into a menu.</div>')+
      (peState.alacarteOk?'':'<div style="font-size:11px;color:#B00020;margin-top:8px">The à la carte isn’t loaded yet — run foh-events-alacarte.sql to swap dishes from it.</div>')+
      '</div>';
  }
  h += '<div class="pe-2col"><div>';
  peQuickGroups().forEach(function(g){
    var subP=0, subQ=0;
    g.dishes.forEach(function(d){ var q=Number(peQuick.qty[d.id])||0; subQ+=q; subP+=q*(Number(d.sell_price)||0); });
    h += '<div class="pe-card" style="padding:10px 14px">'+
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:13px;color:#400207">'+g.label+'</b>'+
      (subQ?'<span style="font-size:11px;color:#574232">'+subQ+' pcs \u00b7 AED '+peMoney(subP)+'</span>':'')+'</div>';
    g.dishes.forEach(function(d){
      var q = Number(peQuick.qty[d.id])||0;
      var bad = q>0 && d.min_order && q<d.min_order;
      h += '<div class="pe-dishrow"><span><b style="font-weight:600">'+peEsc(d.name)+'</b>'+
        ' <span style="color:#574232;font-size:10px">'+peEsc(peAllergenText(d.allergens))+'</span>'+
        '<br><span style="font-size:11px;color:#4F4535">'+peEsc(d.tier||'')+' \u00b7 AED '+peMoney(d.sell_price)+'/pc \u00b7 min '+(d.min_order||10)+' pcs'+
        (d.description?' \u00b7 '+peEsc(d.description):'')+'</span>'+
        (bad?'<br><span style="font-size:10.5px;color:#B00020">below the minimum order of '+d.min_order+'</span>':'')+'</span>'+
        '<span style="display:flex;align-items:center;gap:5px;flex-shrink:0">'+
        '<input class="pe-in" style="width:62px;padding:4px 7px;text-align:center'+(bad?';border-color:#B00020;color:#B00020':'')+'" type="number" min="0" placeholder="qty" value="'+(q||'')+'" onchange="peQuickSetQty(\''+d.id+'\',this.value)">'+
        (q?'<span style="font-size:11px;color:#6B4A33;min-width:56px;text-align:right">'+peMoney(q*(Number(d.sell_price)||0))+'</span>':'<span style="min-width:56px"></span>')+
        '</span></div>';
    });
    h += '</div>';
  });
  // The à la carte, by the portion, under the canapés — so one quick menu can
  // mix canapés with dishes off the printed menu without leaving the screen.
  if(peState.alacarteOk){
    h += '<div class="pe-card" style="padding:10px 14px;border-color:rgba(201,168,76,0.5)">'+
      '<b style="font-size:13px;color:#400207">À la carte</b>'+
      '<div style="font-size:11px;color:#4F4535;margin-top:2px">By the portion, at menu price. Everything here prints on the menu and counts in the totals.</div></div>';
    peAlcSections().forEach(function(s){
      var rows = peAlcAll().filter(function(a){ return a.section===s; })
        .sort(function(x,y){ return (x.sort_order||999)-(y.sort_order||999); });
      if(!rows.length) return;
      var subQ=0, subP=0;
      rows.forEach(function(a){ var q=Number(peQuick.alc[a.id])||0; if(!q) return; subQ+=q; var p=peAlcPrice(a); if(p!=null) subP+=q*p; });
      h += '<div class="pe-card" style="padding:10px 14px">'+
        '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:13px;color:#400207">'+peEsc(peAlcSecLabel(s))+'</b>'+
        (subQ?'<span style="font-size:11px;color:#574232">'+subQ+' portion'+(subQ>1?'s':'')+(subP?' · AED '+peMoney(subP):'')+'</span>':'')+'</div>';
      rows.forEach(function(a){
        var q = Number(peQuick.alc[a.id])||0;
        var p = peAlcPrice(a);
        h += '<div class="pe-dishrow"><span><b style="font-weight:600">'+peEsc(a.name)+'</b>'+
          ((a.allergens&&a.allergens.length)?' <span style="color:#574232;font-size:10px">('+a.allergens.join(')(')+')</span>':'')+
          '<br><span style="font-size:11px;color:#4F4535">'+peEsc(peAlcPriceText(a))+
          (a.description?' · '+peEsc(a.description):'')+'</span>'+
          (q>0 && p==null?'<br><span style="font-size:10.5px;color:#B00020">no fixed price — it will be quoted on the night, so it adds nothing to the total below</span>':'')+
          '</span>'+
          '<span style="display:flex;align-items:center;gap:5px;flex-shrink:0">'+
          '<input class="pe-in" style="width:62px;padding:4px 7px;text-align:center" type="number" min="0" placeholder="qty" value="'+(q||'')+'" onchange="peQuickSetAlc(\''+a.id+'\',this.value)">'+
          (q&&p!=null?'<span style="font-size:11px;color:#6B4A33;min-width:56px;text-align:right">'+peMoney(q*p)+'</span>':'<span style="min-width:56px"></span>')+
          '</span></div>';
      });
      h += '</div>';
    });
  }
  h += '</div><div><div class="pe-tot" style="position:sticky;top:10px">'+
    '<div class="pe-lbl" style="color:#574232">Live totals</div>'+
    '<div class="pe-tot-row"><span>Total pieces</span><b>'+tt.pieces+'</b></div>'+
    (tt.alcPortions?'<div class="pe-tot-row"><span>À la carte portions</span><b>'+tt.alcPortions+' · AED '+peMoney(tt.alcPrice)+'</b></div>':'')+
    '<div class="pe-tot-row"><span>Total price</span><b>AED '+peMoney(tt.price)+'</b></div>'+
    '<div class="pe-tot-row" style="border-top:1px solid #DCC9B2;margin-top:4px;padding-top:7px"><span>Price / guest</span><b>'+(tt.perGuest!=null&&tt.guests?('AED '+peMoney(tt.perGuest)):'\u2014')+'</b></div>'+
    '<div class="pe-tot-row"><span>Different dishes on the menu</span><b>'+tt.distinct+'</b></div>';
  if(tt.distinct>15) h += '<div class="pe-flag" style="color:#B00020">\u25b2 Above the 15-dish kitchen cap \u2014 reduce variety</div>';
  else if(tt.distinct>10) h += '<div class="pe-flag" style="color:#7A5500">\u25b2 Within range \u2014 confirm lead time with the kitchen</div>';
  if(tt.pcsPerGuest!=null && tt.pieces>0){
    // Informational \u2014 no piece-count norm; only the 15-dish variety cap above binds.
    h += '<div class="pe-flag" style="color:#6B4A33">'+tt.pcsPerGuest.toFixed(1)+' pieces / guest</div>';
  }
  if(tt.minViol.length) h += '<div class="pe-flag" style="color:#B00020">\u25b2 Below minimum order: '+peEsc(tt.minViol.join(', '))+'</div>';
  h += '<div style="display:flex;flex-direction:column;gap:7px;margin-top:12px">'+
    // One visible line for the whole group — three identical hover tooltips
    // told her nothing on a phone.
    (tt.anything?'':'<div style="font-size:11px;color:#8A2A1A;margin-bottom:2px">Add a dish below before you can print, send or save this menu.</div>')+
    '<button class="pe-btn" onclick="peQuickPrint()" '+(tt.anything?'':'disabled')+'>Print / PDF menu</button>'+
    (peCanEdit()?'<button class="pe-btn sec" onclick="peQuickWhatsApp()" '+(tt.anything?'':'disabled')+'>Send by WhatsApp</button>':'')+
    (peCanEdit()&&!peQuick.savedId?'<button class="pe-btn sec" onclick="peQuickSave()" '+(tt.anything?'':'disabled')+'>Save as event draft</button>':'')+
    '</div></div></div></div>';
  return h+'</div></div>';   // pe-sheet, pe-wrap
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
  var alcLines = peQuickAlcLines();
  if(!dishes.length && !alcLines.length) return;
  var tt = peQuickTotals();
  var groups = [{k:'Cold',n:'Cold'},{k:'Hot',n:'Hot'},{k:'Dessert',n:'Dolci'}];
  var body = '<div class="brand">'+peLogoImg()+'</div><div class="rule"></div>'+
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
  // À la carte portions print under their own menu headings, after the
  // canapés — the guest reads one document, not two.
  peAlcSections().forEach(function(s){
    var list = alcLines.filter(function(l){ return l.a.section===s; });
    if(!list.length) return;
    body += '<div class="sec">'+peEsc(peAlcSecLabel(s))+'</div>';
    list.forEach(function(l){
      var a = l.a;
      body += '<div class="dish">'+peEsc(a.name)+((a.allergens||[]).length?' <span class="codes">('+(a.allergens||[]).join(')(')+')</span>':'')+
        (a.description?'<br><span class="d">'+peEsc(a.description)+'</span>':'')+'</div>';
    });
  });
  body += '<div class="ft">Our Chefs will do their best to accommodate your dietary requirements, please inform your waiter.<br>'+
    'All prices are in AED inclusive of 5% VAT, 7% DIFC Authority Fee and 10% Service Charge.'+
    peAlgLegend(body)+'</div>';
  pePrintHTML(peDocShell(peQuick.title, body));
}
async function peQuickSave(){
  if(!peCanEdit()){ peToast('View only — ask Katarina, Andrea or Francesco to make changes', true); return; }
  peQuickRead();
  var dishes = peQuickDishes();
  var alcLines = peQuickAlcLines();
  if(!dishes.length && !alcLines.length) return;
  var tt = peQuickTotals();
  var row = { venue_id:'robertos-difc', status:'draft', updated_by:peActor(),
              package_label:peQuick.title,
              guests: tt.guests||null,
              food_price_pp: (tt.perGuest!=null && tt.guests) ? Math.round(tt.perGuest*100)/100 : null,
              // À la carte portions have no dish_id to live in event_items, so
              // they travel in off_menu — the one field that already reaches
              // EVERY kitchen document (#17). Their money is already in the
              // price above, so the quote and the prep list agree.
              off_menu: alcLines.length
                ? alcLines.map(function(l){ return l.qty+'× '+l.a.name; }).join(', ')
                : null,
              payment_terms:'50% deposit to confirm, balance on the day' };
  var r = await sb.from('events_desk').insert(row).select().single();
  if(r.error || !r.data){ peToast('Could not save \u2014 check connection', true); return; }
  peState.events.push(r.data);
  var g = tt.guests||0;
  var items = dishes.map(function(d){
    var q = Number(peQuick.qty[d.id])||0;
    return {event_id:r.data.id, dish_id:d.id, pcs_per_guest: g ? Math.round(q/g*100)/100 : q};
  });
  // A quick menu can now be à la carte only, in which case there is nothing to
  // put in event_items — inserting an empty array is a pointless round trip
  // that some clients treat as an error.
  if(items.length){
    var ir = await sb.from('event_items').insert(items).select();
    if(!ir.error) peState.items[r.data.id] = ir.data||[];
  } else {
    peState.items[r.data.id] = [];
  }
  sb.from('event_log').insert({event_id:r.data.id, action:'created',
    detail:('from quick menu'+(alcLines.length?' — including '+alcLines.length+' à la carte dish'+(alcLines.length>1?'es':''):'')).slice(0,400),
    actor:peActor()});
  // Keep the selections and stay on the screen \u2014 printing the menu or sending
  // it is what she does next, and both need the dishes still on the page.
  peQuick.savedId = r.data.id;
  peQuick.savedToken = r.data.client_token || null;
  peToast('Saved as a draft event \u2014 now print it or send it, or open the booking to add the client');
  renderMain();
  return r.data;
}
// Start a fresh one. The only thing that clears the screen, and it says so.
function peQuickReset(){
  peQuick.qty = {}; peQuick.alc = {};
  peQuick.savedId = null; peQuick.savedToken = null; peQuick.sharedKey = null;
  peQuick.title = 'Canap\u00e9 selection';
  renderMain();
}
// WhatsApp the quick menu to a guest.
//
// NOT client-event.html: that is the canap\u00e9 PICKER, a tick-list of the whole
// library, and it does not show \u00e0 la carte lines at all \u2014 sending it would put
// a selection form in front of the guest instead of the menu she just built.
// Instead the menu is written as a customised menu row and shared through
// client-setmenu.html, the page that prints a menu's courses in full for any
// key. The guest sees their menu; she sends one link.
async function peQuickWhatsApp(){
  if(!peCanEdit()){ peToast('View only \u2014 ask Katarina, Andrea or Francesco to make changes', true); return; }
  peQuickRead();
  var tt = peQuickTotals();
  if(!tt.anything){ peToast('Add a dish first', true); return; }
  var courses = peQuickCourses().map(function(c){
    return { name:c.name, items:c.lines.map(function(l){ return l.name; }).filter(Boolean) };
  }).filter(function(c){ return c.items.length; });
  try{
    // One shareable menu per quick menu \u2014 tapping twice reuses the same link
    // rather than littering the table with near-identical rows.
    if(!peQuick.sharedKey){
      var key = 'custom-quick-'+Math.random().toString(36).slice(2,8);
      var row = { key:key, name:(peQuick.title||'Your menu'),
                  price_pp:(tt.perGuest!=null && tt.guests) ? Math.round(tt.perGuest) : null,
                  courses:courses, line:peSmSummary(courses),
                  is_custom:true, based_on:null, event_id:peQuick.savedId||null,
                  price_mode:'sum', created_by:peActor(),
                  detail:{ from:'quick menu', pieces:tt.pieces, alacarte:tt.alcPortions } };
      var r = await sb.from('event_set_menus').insert(row).select().single();
      if(r.error) throw r.error;
      peState.setMenus = (peState.setMenus||[]).concat([r.data]);
      peQuick.sharedKey = key;
    }
    var url = peBaseUrl() + 'client-setmenu.html?m=' + encodeURIComponent(peQuick.sharedKey);
    var msg = 'Roberto\u2019s \u2014 ' + (peQuick.title||'your menu') +
      (tt.perGuest!=null && tt.guests ? ' \u00b7 AED '+peMoney(tt.perGuest)+' per guest' : '') +
      '. Tap to see it:\n' + url;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    if(peQuick.savedId) sb.from('event_log').insert({event_id:peQuick.savedId, action:'whatsapp',
      detail:'quick menu sent by WhatsApp', actor:peActor()});
    renderMain();
  }catch(err){
    peToast('NOT sent \u2014 '+String(err&&err.message||err).slice(0,120), true);
  }
}


// the standing guest link: full canape selection, no event needed — a guest
// enquiry from it arrives as a new draft with the selection attached
// Guest link, unchanged in name and place. The only new thing is the question:
// the canapé link she has always sent, or the à la carte. Two buttons, no third
// option, no new screen to learn.
function peGuestLinkChoose(){
  var bg = document.createElement('div'); bg.className='pe-modal-bg';
  var close = function(){ bg.remove(); };
  bg.addEventListener('click', function(ev){ if(ev.target===bg) close(); });
  var m = document.createElement('div'); m.className='pe-modal'; m.style.maxWidth='420px';
  m.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
    '<b style="color:#400207">Guest link</b><span class="pe-x">✕</span></div>'+
    '<div style="font-size:12.5px;color:#6B4A33;margin:6px 0 14px;line-height:1.55">Which link would you like to send?</div>'+
    '<div style="display:flex;flex-direction:column;gap:9px">'+
      '<button class="pe-btn" data-g="canape" style="text-align:left">Canapé selection'+
        '<div style="font-size:11px;font-weight:normal;opacity:.85;margin-top:2px">The guest picks canapés — it arrives here as a new draft.</div></button>'+
      '<button class="pe-btn sec" data-g="alc" style="text-align:left">À la carte — with prices'+
        '<div style="font-size:11px;margin-top:2px;color:#4F4535">The whole menu, prices shown. The guest ticks what they would like.</div></button>'+
      '<button class="pe-btn sec" data-g="alcnp" style="text-align:left">À la carte — without prices'+
        '<div style="font-size:11px;margin-top:2px;color:#4F4535">The same, with no prices — for a minimum-spend guest.</div></button>'+
    '</div>'+
    '<div style="font-size:11px;color:#4F4535;margin-top:12px;text-align:center">'+
      '<span style="text-decoration:underline;cursor:pointer" data-g="pick">…or pick only certain dishes</span></div>';
  m.querySelector('.pe-x').addEventListener('click', close);
  m.querySelector('[data-g="canape"]').addEventListener('click', function(){ close(); peCopyGuestLink(); });
  // Both à la carte buttons behave exactly like the canapé one: copy, paste,
  // done. No screen, no form, no ticking — that was the whole complaint.
  m.querySelector('[data-g="alc"]').addEventListener('click', function(){ close(); peCopyAlaCarteLink(false); });
  m.querySelector('[data-g="alcnp"]').addEventListener('click', function(){ close(); peCopyAlaCarteLink(true); });
  // Narrowing it down stays possible — it is just no longer compulsory.
  m.querySelector('[data-g="pick"]').addEventListener('click', function(){
    close();
    peState.packsTab = 'menus';
    peGo('packs');
    peToast('Tick the dishes you want to show, then send by email or WhatsApp');
  });
  bg.appendChild(m); document.body.appendChild(bg);
}
// The à la carte link, copied the same way the canapé one is: one click, in the
// clipboard, paste it into WhatsApp. alc=all keeps the URL short instead of
// carrying fifty-five ids, and 'pick' is how the guest's ticks find their way
// back to her.
function peCopyAlaCarteLink(noPrice){
  var url = peBaseUrl()+'client-menus.html?alc=all'+(noPrice?'&np=1':'')+
            '&pick='+encodeURIComponent(peMpPickToken());
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function(){
    peToast('À la carte link copied'+(noPrice?' (no prices)':'')+' — paste it to the guest; what they tick comes back to you');
  }).catch(function(){ prompt('Copy this link:', url); });
}
function peCopyGuestLink(){
  var base = location.origin + location.pathname.replace(/[^\/]*$/, '');
  var url = base + 'client-event.html';
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function(){
    peToast('Guest link copied — send it to anyone; their picks arrive here as a new draft');
  }).catch(function(){ prompt('Copy this link:', url); });
}
