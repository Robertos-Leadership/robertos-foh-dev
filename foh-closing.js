// foh-closing.js — Daily Closing Report module (extracted from index.html for build 2026-06-20.2).
// PURE RELOCATION of the cl* functions out of the index.html inline <script>. No renames.
// Classic (non-module) script: every function stays a global, so inline onclick="clX()" handlers
// and the ops* page (renderOperations/opsRecentHTML) keep calling them across files unchanged.
// Depends on globals defined in index.html: sb, KITCHEN_URL, KITCHEN_KEY, revInit, revMoney, state, renderMain.

// ══════════════════════════════════════════════
//  CLOSING REPORT (Daily Snapshot) — primary daily entry; rolls revenue fields into rev_daily.
// ══════════════════════════════════════════════
function clInit(){ var R=revInit(); if(!R.closing) R.closing={date:null, comps:[], good:[], bad:[], loadedRow:null}; return R.closing; }
// Business date for the closing report. Service runs past midnight and managers submit
// between 2–4 AM, so a report saved before 6 AM Dubai belongs to the PREVIOUS calendar day
// (the night that just ended). Shift Dubai time back 6 h, then take the date. The date field
// in the modal stays editable, so a manager can still override it for an unusual case.
function clToday(){ return RC.dubaiBusinessDate(new Date()); }   // shared operational-night helper (common.js) — one source of truth
function clNum(id){ var el=document.getElementById(id); if(!el) return null; var v=String(el.value||'').trim(); if(v==='') return null; v=Number(v.replace(/[^0-9.\-]/g,'')); return isFinite(v)?v:null; }
function clVal(id){ var el=document.getElementById(id); return el?String(el.value||'').trim():''; }
function clEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
async function clOpen(ds){
  var C=clInit(); ds=ds||clToday(); C.date=ds;
  var row=null;
  // A failed read must not look like "no report yet": saving the blank form would
  // overwrite the real night. Remember the failure and refuse to save that date.
  C.loadFailed=null;
  try{ var res=await sb.from('closing_reports').select('*').eq('service_date',ds).limit(1); if(res.error) C.loadFailed=ds; else if(res.data && res.data.length) row=res.data[0]; }catch(e){ C.loadFailed=ds; }
  if(C.loadFailed && typeof toast==='function') toast('Could not load the saved closing report for '+ds+' — close and reopen before saving.', true);
  C.loadedRow=row;
  C.comps=(row&&Array.isArray(row.comps))?row.comps.slice():[];
  C.good=(row&&Array.isArray(row.comments_good))?row.comments_good.slice():[];
  C.bad=(row&&Array.isArray(row.comments_bad))?row.comments_bad.slice():[];
  // Any issue on the shift? An old report has no answer saved: a written challenge means yes.
  C.issue={}; CL_SHIFTS.forEach(function(k){ var o=(row&&row.shifts&&row.shifts[k])||{}; C.issue[k]=(o.issue===true||o.issue===false)?o.issue:((o.challenges&&String(o.challenges).trim())?true:null); });
  clHostInit(row);
  // SevenRooms covers SERVED — live from the Kitchen edge function (actual COMPLETE
  // bookings, split by venue: PIEMONTE = Restaurant, everything else = Scala Lounge).
  // Fetched non-blocking so the modal opens immediately; clRecalc re-runs when it lands.
  C.srCovers=null; C.srCoversError=false;
  (function(){ var d=ds;
    fetch(KITCHEN_URL+'/functions/v1/sevenrooms-sync?covers_actual='+d,{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+KITCHEN_KEY,'x-proxy-secret':KITCHEN_PROXY_SECRET}
    }).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }).then(function(sd){
      if(sd&&sd.ok&&typeof sd.covers==='number'){
        C.srCovers={restaurant:Number(sd.restaurant_covers)||0, lounge:Number(sd.lounge_covers)||0, total:Number(sd.covers)||0};
      } else {
        C.srCoversError=true;   // reached the server but it didn't return usable covers
      }
      clRecalc();
    }).catch(function(e){
      // Network/HTTP/parse failure — surface it so a manager knows the sync broke
      // (vs. genuinely zero covers), rather than seeing a blank line.
      console.warn('[closing] SevenRooms covers fetch failed', e);
      C.srCoversError=true; clRecalc();
    });
  })();
  // Manager(s) on duty — from the schedule (foh_staff Management + foh_roster working)
  C.onDuty=[]; C.mgrAll=[];
  // (clOnAt is defined at the foot of this file — "is this shift running at hh:mm?")
  try{
    var stf=await sb.from('foh_staff').select('id,name').eq('section','Management').eq('active',true);
    var byId={}; (stf.data||[]).forEach(function(s){byId[s.id]=s.name;}); var ids=Object.keys(byId);
    C.mgrAll=(stf.data||[]).map(function(s){return s.name;}).filter(Boolean).sort();   // the pick lists: who approved a comp, who hosted
    if(ids.length){
      var ros=await sb.from('foh_roster').select('staff_id,status,shift_start,shift_end').eq('work_date',ds).in('staff_id',ids);
      C.onDuty=(ros.data||[]).filter(function(r){return r.status==='working';}).map(function(r){return {name:byId[r.staff_id], start:r.shift_start, end:r.shift_end};}).filter(function(x){return x.name;});
    }
  }catch(e){}
  document.getElementById('cl-modal').style.display='flex';
  var delBtn=document.getElementById('cl-delete'); if(delBtn) delBtn.style.display = row ? '' : 'none';   // only deletable once saved
  clFill(row); clRenderComps(); clRenderComments(); clRenderIssues(); clHostRender();
  clHostLoad(ds);   // not awaited: the form opens at once, the first-time list lands when SevenRooms answers
  // Auto-fill manager on duty for a NEW report (never overwrite a saved one).
  //
  // A manager belongs to the service they were actually STANDING IN, not the one
  // their clock-in hour suggests. This used to split on shift START at 15:00 --
  // and Roberto's dinner managers come in at 14:00 and work to midnight, so they
  // were classed AM, PM came out empty, and a fallback then pasted the ENTIRE
  // on-duty list into the PM box. Six of the twelve reports to 29 Aug 2026 named
  // the same three managers for both services. (Francesco, 2 Sep 2026)
  //
  // Note the old asymmetry, which is what made it silent: AM was filled only
  // `if(am.length)`, but PM had no such guard and fell through to everybody.
  if(!row && C.onDuty.length){
    var am=C.onDuty.filter(function(x){return clOnAt(x,'13:00');}).map(function(x){return x.name;});
    var pm=C.onDuty.filter(function(x){return clOnAt(x,'20:00');}).map(function(x){return x.name;});
    var amEl=document.getElementById('cl-mgr-am'), pmEl=document.getElementById('cl-mgr-pm');
    // NO cross-fallback, in either direction. An empty side stays empty: "we do
    // not know who ran that service" must never be written down as "all of them",
    // which is the exact shape the old bug took. Somebody types it, or it is blank.
    if(amEl && !amEl.value && am.length) amEl.value=am.join(', ');
    if(pmEl && !pmEl.value && pm.length) pmEl.value=pm.join(', ');
  }
  var od=document.getElementById('cl-onduty'); if(od) od.innerHTML=C.onDuty.length?('&#128197; From schedule — Management on duty: <b>'+C.onDuty.map(function(x){return clEsc(x.name);}).join(', ')+'</b>'):'No Management rostered for this date.';
  clRecalc();
}
function clClose(){ document.getElementById('cl-modal').style.display='none'; }
// Delete a saved closing report (super-user only, e.g. 1212). Removes the report
// AND its revenue rollup in rev_daily for that date — both keyed by service_date.
async function clDeleteReport(){
  var C=clInit(); var ds=C.date;
  if(!ds || !C.loadedRow){ alert('There’s no saved report for this date to delete.'); return; }
  var who = await fohRequireStaffId('delete the closing report for '+ds, null, { codeOnly:true, superOnly:true, title:'Manager code to delete' });
  if(!who) return;
  if(!confirm('Delete the closing report for '+ds+'?\n\nThis also removes that day’s revenue from the month. This cannot be undone.')) return;
  var r1=await sb.from('closing_reports').delete().eq('service_date',ds);
  if(r1.error){ alert('Could not delete the report: '+r1.error.message); return; }
  var r2=await sb.from('rev_daily').delete().eq('service_date',ds);
  if(r2.error){ alert('Report deleted, but its revenue row for '+ds+' could not be removed:\n'+r2.error.message+'\nClear it in Revenue if needed.'); }
  if(typeof fohLogSend==='function') fohLogSend(who, 'closing_report_delete', ds);
  C.loadedRow=null; clClose();
  try{ if(typeof loadRevenue==='function') loadRevenue(); }catch(e){}
  try{ if(typeof renderMain==='function') renderMain(); }catch(e){}
  alert('The closing report for '+ds+' has been removed.');
}
function clFill(row){
  row=row||{}; function set(id,v){ var el=document.getElementById(id); if(el) el.value=(v!=null?v:''); }
  set('cl-date',clInit().date);
  set('cl-rl-net',row.rest_lunch_net); set('cl-rl-cov',row.rest_lunch_covers);
  set('cl-rd-net',row.rest_dinner_net); set('cl-rd-cov',row.rest_dinner_covers);
  set('cl-ll-net',row.lounge_lunch_net); set('cl-ll-cov',row.lounge_lunch_covers);
  set('cl-ld-net',row.lounge_dinner_net); set('cl-ld-cov',row.lounge_dinner_covers);
  set('cl-food',row.food_net); set('cl-bev',row.bev_net); set('cl-tob',row.tobacco_net); set('cl-misc',row.other_net);
  set('cl-cc',row.cc_tips); set('cl-cash',row.cash_tips);
  set('cl-mgr-am',row.manager_am); set('cl-mgr-pm',row.manager_pm);
  var sh=row.shifts||{};
  set('cl-day-fb',(sh.day||{}).feedback); set('cl-day-ch',(sh.day||{}).challenges);
  set('cl-night-fb',(sh.night||{}).feedback); set('cl-night-ch',(sh.night||{}).challenges);
  set('cl-late-fb',(sh.late||{}).feedback); set('cl-late-ch',(sh.late||{}).challenges);
  set('cl-events',row.private_events); set('cl-support',row.support);
}
function clAvg(net,cov){ return (net!=null&&cov)?revMoney(net/cov).replace('AED ',''):'—'; }
function clRecalc(){
  var rl=clNum('cl-rl-net'),rlc=clNum('cl-rl-cov'),rd=clNum('cl-rd-net'),rdc=clNum('cl-rd-cov');
  var ll=clNum('cl-ll-net'),llc=clNum('cl-ll-cov'),ld=clNum('cl-ld-net'),ldc=clNum('cl-ld-cov');
  var g=function(id){return document.getElementById(id);};
  if(g('cl-rl-avg')) g('cl-rl-avg').textContent=clAvg(rl,rlc);
  if(g('cl-rd-avg')) g('cl-rd-avg').textContent=clAvg(rd,rdc);
  if(g('cl-ll-avg')) g('cl-ll-avg').textContent=clAvg(ll,llc);
  if(g('cl-ld-avg')) g('cl-ld-avg').textContent=clAvg(ld,ldc);
  var restNet=(rl||0)+(rd||0), lounNet=(ll||0)+(ld||0), tot=restNet+lounNet;
  var restCov=(rlc||0)+(rdc||0), lounCov=(llc||0)+(ldc||0), totCov=restCov+lounCov;
  if(g('cl-tot')) g('cl-tot').innerHTML='<div><span>Restaurant</span><b>'+revMoney(restNet)+' · '+restCov+' cov</b></div>'
    +'<div><span>Scala Lounge &amp; Bar</span><b>'+revMoney(lounNet)+' · '+lounCov+' cov</b></div>'
    +'<div class="rev-edit-tot-total"><span>Total net</span><b>'+revMoney(tot)+' · '+totCov+' cov · avg '+(totCov?revMoney(tot/totCov).replace('AED ',''):'—')+'</b></div>';
  // Miscellaneous counts INTO the split: it is money the guest was charged (flowers,
  // cake, corkage), so it sits inside net alongside Food/Bev/Tobacco. Before it existed
  // any such charge left the reconciliation permanently short and the ✓ never appeared.
  var fb=(clNum('cl-food')||0)+(clNum('cl-bev')||0)+(clNum('cl-tob')||0)+(clNum('cl-misc')||0);
  if(g('cl-fnb-chk')){
    if(fb===0) g('cl-fnb-chk').textContent='Optional — leave blank and the model estimates Food 48% / Bev 51% / Tobacco 1%.';
    else {
      // Say the gap out loud rather than just withholding the tick — a missing ✓ never
      // told the manager how far out they were, or which box to look at.
      var fbGap=fb-tot;
      g('cl-fnb-chk').innerHTML='Split '+revMoney(fb)+' vs net '+revMoney(tot)+' · '
        +(Math.abs(fbGap)<1?'<b style="color:#296E48">matches ✓</b>'
          :'<b style="color:#AB3D2D">off by '+revMoney(Math.abs(fbGap))+'</b>');
    }
  }
  var tips=(clNum('cl-cc')||0)+(clNum('cl-cash')||0);
  if(g('cl-tips-tot')) g('cl-tips-tot').textContent=revMoney(tips);
  var ct=clInit().comps.reduce(function(s,c){return s+(Number(c.amount)||0);},0);
  if(g('cl-comps-tot')) g('cl-comps-tot').innerHTML= clInit().comps.length?('Comps total <b>'+revMoney(ct)+'</b>'+(tot?' · '+(ct/tot*100).toFixed(1)+'% of net':'')):'';
  var sr=clInit().srCovers;
  if(g('cl-sr-covers')){
    if(sr){
      var cmp=function(entered,actual){ if(!entered) return ''; if(entered===actual) return ' <b style="color:#296E48">✓</b>'; var df=entered-actual; return ' <span style="color:#AB3D2D">('+(df>=0?'+':'')+df+')</span>'; };
      g('cl-sr-covers').innerHTML='SevenRooms served &mdash; Restaurant <b>'+sr.restaurant+'</b>'+cmp(restCov,sr.restaurant)
        +' &middot; Scala <b>'+sr.lounge+'</b>'+cmp(lounCov,sr.lounge)
        +' &middot; total <b>'+sr.total+'</b>'+cmp(totCov,sr.total);
    } else if(clInit().srCoversError){
      g('cl-sr-covers').innerHTML='<span style="color:#AB3D2D">SevenRooms covers couldn’t load &mdash; enter and verify covers manually.</span>';
    } else g('cl-sr-covers').textContent='';
  }
}
// ── Tidy pass, 26 Nov 2026 (Francesco: "easy to fill and easy to read once we received it") ──
// Read off the 25 Nov report: 14 comps as loose rows, the Guest box empty on all 14, reasons
// typed three ways ("DRINK", "DRINKS", blank), manager names typed five ways, three long shift
// paragraphs that all said "no issues", and the five Host cards buried inside the dinner one.
// So: reason and manager are picked, a shift is one question and one line, and the Host
// programme is its own list. Old reports still open: a reason or a name that is not on the
// list is kept exactly as it was typed.
var CL_REASONS=['Dessert','Drinks','Side dish','Voucher','Business meeting','Complaint','Other'];
var CL_HOST_ITEMS=['Pistachio Tiramisu','Choc-Choc','Roberto’s Pizza','Bresaola','Mushroom risotto','Glass of Prosecco'];
// One name for the same reason, so the email can add them up. Anything it does not
// recognise is shown as it was typed, never forced into a group it may not belong to.
function clReasonGroup(c){
  var t=String((c&&c.reason)==null?'':c.reason).trim(); if(!t) return '';
  var l=t.toLowerCase();
  for(var i=0;i<CL_REASONS.length;i++) if(CL_REASONS[i].toLowerCase()===l){
    if(CL_REASONS[i]==='Other' && c.note && String(c.note).trim()) return 'Other: '+String(c.note).trim();
    return CL_REASONS[i];
  }
  if(l.indexOf('dessert')>=0) return 'Dessert';
  if(l.indexOf('drink')>=0) return 'Drinks';
  if(l.indexOf('side')>=0) return 'Side dish';
  if(l.indexOf('voucher')>=0) return 'Voucher';
  if(l.indexOf('meeting')>=0) return 'Business meeting';
  if(l.indexOf('complain')>=0) return 'Complaint';
  return t.charAt(0).toUpperCase()+t.slice(1).toLowerCase();
}
function clMgrNames(){
  var out=[], seen={};
  (clInit().mgrAll||[]).forEach(function(nm){ nm=String(nm||'').trim(); if(nm && !seen[nm]){ seen[nm]=1; out.push(nm); } });
  return out;
}
function clAddComp(){ clInit().comps.push({table:'',guest:'',amount:'',reason:'',manager:''}); clRenderComps(); }
function clRemoveComp(i){ clInit().comps.splice(i,1); clRenderComps(); clRecalc(); }
function clCompField(i,f,v){ clInit().comps[i][f]=v; if(f==='amount') clRecalc(); }
function clCompReason(i,v){ clInit().comps[i].reason=v; clRenderComps(); }
function clCompMgr(i,v){
  var c=clInit().comps[i];
  if(v==='__other'){ c._typed=true; c.manager=''; clRenderComps(); var el=document.getElementById('cl-comp-mgr-'+i); if(el) el.focus(); return; }
  c.manager=v;
}
function clRenderComps(){
  var C=clInit(), box=document.getElementById('cl-comps'); if(!box) return; var h='', mgrs=clMgrNames();
  if(C.comps.length) h+='<div class="cl-comp-row cl-comp-head"><span>Table</span><span>AED</span><span>Reason</span><span>Approved by</span><span></span></div>';
  C.comps.forEach(function(c,i){
    var r=String(c.reason==null?'':c.reason), inList=CL_REASONS.indexOf(r)>=0;
    var need=(c.table||c.amount) && !r.trim();
    var ro='<option value="">Choose a reason</option>'
      +CL_REASONS.map(function(o){ return '<option'+(o===r?' selected':'')+'>'+clEsc(o)+'</option>'; }).join('')
      +((r && !inList)?'<option selected>'+clEsc(r)+'</option>':'');
    var m=String(c.manager==null?'':c.manager), typed=c._typed || (m && mgrs.indexOf(m)<0) || !mgrs.length;
    var mg= typed
      ? '<input id="cl-comp-mgr-'+i+'" placeholder="Approved by" value="'+clEsc(m)+'" oninput="clCompField('+i+',\'manager\',this.value)">'
      : '<select aria-label="Approved by" onchange="clCompMgr('+i+',this.value)"><option value="">Approved by</option>'
        +mgrs.map(function(o){ return '<option'+(o===m?' selected':'')+'>'+clEsc(o)+'</option>'; }).join('')
        +'<option value="__other">Someone else…</option></select>';
    h+='<div class="cl-comp-row">'
      +'<input placeholder="Table" value="'+clEsc(c.table)+'" oninput="clCompField('+i+',\'table\',this.value)">'
      +'<input placeholder="AED" type="number" inputmode="decimal" value="'+clEsc(c.amount)+'" oninput="clCompField('+i+',\'amount\',this.value)">'
      +'<select aria-label="Reason"'+(need?' class="cl-need"':'')+' onchange="clCompReason('+i+',this.value)">'+ro+'</select>'
      +mg
      +'<button class="cl-x" onclick="clRemoveComp('+i+')" title="Remove">&times;</button>'
      +(r==='Other'?'<input class="cl-comp-note" placeholder="What for" value="'+clEsc(c.note)+'" oninput="clCompField('+i+',\'note\',this.value)">':'')
      +'</div>';
  });
  box.innerHTML=h;
}

// ── Shifts: one question, one line. The second box only opens on Yes. ──
var CL_SHIFTS=['day','night','late'];
function clSetIssue(k,v){ var C=clInit(); if(!C.issue) C.issue={}; C.issue[k]=(C.issue[k]===v)?null:v; clRenderIssues(); }
function clRenderIssues(){
  var C=clInit(); if(!C.issue) C.issue={};
  CL_SHIFTS.forEach(function(k){
    var v=C.issue[k], box=document.getElementById('cl-'+k+'-issue'), ch=document.getElementById('cl-'+k+'-ch');
    if(box) box.innerHTML='<span>Any issue on this shift?</span>'
      +'<button type="button" class="cl-yn'+(v===false?' on-no':'')+'" aria-pressed="'+(v===false)+'" onclick="clSetIssue(\''+k+'\',false)">No</button>'
      +'<button type="button" class="cl-yn'+(v===true?' on-yes':'')+'" aria-pressed="'+(v===true)+'" onclick="clSetIssue(\''+k+'\',true)">Yes</button>';
    if(ch) ch.style.display=(v===true)?'':'none';
  });
}

// ── Host programme (ROB-SOP-GX-001): who got the card tonight, and what was promised. ──
// The list is tonight's guests SevenRooms shows no earlier visit for. It is a help, not a
// gate: a guest it misses is added by hand, and a guest it could not check is said so.
function clHostInit(row){
  var C=clInit(), saved=((row&&row.shifts&&row.shifts.host)||{}), cards=Array.isArray(saved.cards)?saved.cards:[];
  C.host={ status:'idle', unknown:0, firstN:(typeof saved.first_tables==='number'?saved.first_tables:null),
    by:(cards[0]&&cards[0].host)||'',
    first:[], rows:cards.map(function(x){ return {client:x.client||'', name:x.name||'', table:x.table||'', pax:x.pax||null, promised:x.promised||'', given:true, manual:!x.client}; }) };
}
function clHostKey(x){ return x.client ? ('c:'+x.client) : ('n:'+String(x.name||'').trim().toLowerCase()); }
async function clHostLoad(ds){
  var C=clInit(), H=C.host; if(!H) return;
  H.status='loading'; clHostRender();
  try{
    if(typeof resFetchDaysheet!=='function' || typeof rrProfiles!=='function' || typeof rrProf!=='function') throw new Error('reservations module not loaded');
    var j=await resFetchDaysheet(ds);
    if(clInit().date!==ds || clInit().host!==H) return;
    var seen={}, list=[], venue='';
    (j.reservations||[]).forEach(function(r){
      var st=String(r.state||r.status||'').toLowerCase();
      if(st.indexOf('cancel')>=0 || st.indexOf('no_show')>=0 || st.indexOf('noshow')>=0) return;
      if(r.venue && !venue) venue=r.venue;
      if(!r.client || seen[r.client]) return; seen[r.client]=1;
      list.push({client:r.client, name:String(r.name||'').trim(), table:Array.isArray(r.tables)?r.tables.join('–'):String(r.tables||''), pax:Number(r.pax)||null});
    });
    await rrProfiles(list.map(function(x){ return x.client; }), venue);
    if(clInit().date!==ds || clInit().host!==H) return;
    var first=[], unknown=0;
    list.forEach(function(x){ var p=rrProf(x.client); if(!p){ unknown++; return; } if((Number(p.visits)||0)<=1) first.push(x); });
    var have={}; H.rows.forEach(function(x){ have[clHostKey(x)]=x; });
    first.forEach(function(x){
      var old=have['c:'+x.client] || have['n:'+x.name.toLowerCase()];
      if(old){ old.client=x.client; old.manual=false; if(!old.table) old.table=x.table; if(!old.pax) old.pax=x.pax; }
    });
    // 25 first-time guests on 24 Nov: listing every one made the form three screens long.
    // Only the cards are rows; the rest wait in a pick list.
    H.first=first; H.firstN=first.length; H.unknown=unknown; H.status='ok';
  }catch(e){
    console.warn('[closing] first-time guests not read', e);
    if(clInit().host===H) H.status='err';
  }
  if(clInit().host===H) clHostRender();
}
function clHostAdd(){ var H=clInit().host; if(!H) return; H.rows.push({client:'', name:'', table:'', pax:null, promised:'', given:true, manual:true}); clHostRender(); }
function clHostField(i,f,v){ var H=clInit().host; if(H && H.rows[i]) H.rows[i][f]=v; }
function clHostPick(id){
  var H=clInit().host; if(!H || !id) return;
  var x=(H.first||[]).filter(function(f){ return f.client===id; })[0]; if(!x) return;
  H.rows.push({client:x.client, name:x.name, table:x.table, pax:x.pax, promised:'', given:true, manual:false});
  clHostRender();
  var el=document.getElementById('cl-host-item-'+(H.rows.length-1)); if(el) el.focus();
}
// The promised item: pick one of the usual ones, or "Something else" to type it.
// (26 Nov 2026, Francesco: "need an option to pick by hand too". A typing box with
// suggestions already took any text, but it looked like a closed list.)
function clHostItem(i,v){
  var H=clInit().host; if(!H || !H.rows[i]) return;
  if(v==='__other'){ H.rows[i]._typed=true; H.rows[i].promised=''; clHostRender(); var el=document.getElementById('cl-host-item-'+i); if(el) el.focus(); return; }
  H.rows[i].promised=v; clHostRender();
}
function clHostItemList(i){ var H=clInit().host; if(!H || !H.rows[i]) return; H.rows[i]._typed=false; H.rows[i].promised=''; clHostRender(); }
function clHostItemBox(x,i,need){
  var p=String(x.promised==null?'':x.promised), typed=x._typed || (p && CL_HOST_ITEMS.indexOf(p)<0);
  if(typed) return '<span class="cl-host-item cl-host-typed"><input id="cl-host-item-'+i+'" placeholder="Type the item promised" value="'+clEsc(p)+'"'+(need?' class="cl-need"':'')
    +' oninput="clHostField('+i+',\'promised\',this.value);this.classList.remove(\'cl-need\')"><button type="button" class="cl-host-back" title="Back to the list" onclick="clHostItemList('+i+')">List</button></span>';
  return '<select id="cl-host-item-'+i+'" class="cl-host-item'+(need?' cl-need':'')+'" aria-label="Item promised" onchange="clHostItem('+i+',this.value)"><option value="">Choose the item promised</option>'
    +CL_HOST_ITEMS.map(function(o){ return '<option'+(o===p?' selected':'')+'>'+clEsc(o)+'</option>'; }).join('')
    +'<option value="__other">Something else — type it…</option></select>';
}
function clHostRemove(i){ var H=clInit().host; if(!H) return; H.rows.splice(i,1); clHostRender(); }
function clHostRender(){
  var C=clInit(), H=C.host, box=document.getElementById('cl-host'), note=document.getElementById('cl-host-note'); if(!box || !H) return;
  var given=H.rows.filter(function(x){ return x.given; }).length;
  if(note){
    var t='';
    if(H.status==='loading') t='Reading tonight’s first-time guests from SevenRooms…';
    else if(H.status==='err') t='<span style="color:#8E2C1F">SevenRooms could not be read — add the guests who got a card by hand.</span>';
    else if(H.status==='ok') t='First-time guests tonight: <b>'+H.firstN+'</b> · cards given: <b>'+given+'</b>'+(H.unknown?(' · '+H.unknown+' guest'+(H.unknown>1?'s':'')+' could not be checked'):'');
    note.innerHTML=t;
  }
  var h='';
  if(H.rows.length) h+='<div class="cl-host-row cl-host-head"><span>Guest</span><span>Table</span><span>Promised for next visit</span><span></span></div>';
  H.rows.forEach(function(x,i){
    var need=x.given && !String(x.promised||'').trim();
    h+='<div class="cl-host-row'+(x.given?' is-on':'')+'">'
      +(x.manual
        ? '<input placeholder="Guest name" value="'+clEsc(x.name)+'" oninput="clHostField('+i+',\'name\',this.value)">'
          +'<input placeholder="Table" value="'+clEsc(x.table)+'" oninput="clHostField('+i+',\'table\',this.value)">'
        : '<span class="cl-host-name">'+clEsc(x.name||'Guest')+(x.pax?(' · '+x.pax):'')+'</span><span>'+clEsc(x.table||'—')+'</span>')
      +clHostItemBox(x,i,need)
      +'<button type="button" class="cl-x" title="Remove this card" onclick="clHostRemove('+i+')">&times;</button>'
      +'</div>';
  });
  var taken={}; H.rows.forEach(function(x){ if(x.client) taken[x.client]=1; });
  var left=(H.first||[]).filter(function(f){ return !taken[f.client]; });
  if(left.length) h+='<select class="cl-inp cl-host-pick" aria-label="Add a first-time guest" onchange="clHostPick(this.value)"><option value="">Who got a card? Pick a first-time guest…</option>'
    +left.map(function(f){ return '<option value="'+clEsc(f.client)+'">'+clEsc(f.name||'Guest')+(f.table?(' · table '+clEsc(f.table)):'')+(f.pax?(' · '+f.pax+' guests'):'')+'</option>'; }).join('')+'</select>';
  box.innerHTML=h;
  var by=document.getElementById('cl-host-by');
  if(by){
    var mgrs=clMgrNames(), cur=H.by||'';
    by.innerHTML='<option value="">Choose the host</option>'+mgrs.map(function(o){ return '<option'+(o===cur?' selected':'')+'>'+clEsc(o)+'</option>'; }).join('')
      +((cur && mgrs.indexOf(cur)<0)?'<option selected>'+clEsc(cur)+'</option>':'');
  }
}
// What is saved with the report: only the cards given, plus how many first-time tables
// SevenRooms showed (null when it could not be read — unknown is never written as 0).
function clHostForSave(){
  var H=clInit().host; if(!H) return null;
  var byEl=document.getElementById('cl-host-by'); if(byEl) H.by=byEl.value||'';
  var cards=H.rows.filter(function(x){ return x.given && String(x.name||'').trim(); }).map(function(x){
    return {client:x.client||null, name:String(x.name).trim(), table:String(x.table||'').trim(), pax:x.pax||null, promised:String(x.promised||'').trim(), host:H.by||''};
  });
  if(!cards.length && H.firstN==null) return null;
  return {first_tables:H.firstN, cards:cards};
}
function clAddComment(type){ (type==='good'?clInit().good:clInit().bad).push(''); clRenderComments(); }
function clRemoveComment(type,i){ (type==='good'?clInit().good:clInit().bad).splice(i,1); clRenderComments(); }
function clCommentField(type,i,v){ (type==='good'?clInit().good:clInit().bad)[i]=v; }
function clRenderComments(){
  var C=clInit();
  ['good','bad'].forEach(function(type){
    var box=document.getElementById('cl-'+type); if(!box) return;
    var arr=type==='good'?C.good:C.bad, h='';
    arr.forEach(function(t,i){ h+='<div class="cl-bullet"><input placeholder="'+(type==='good'?'What went well…':'What didn’t…')+'" value="'+clEsc(t)+'" oninput="clCommentField(\''+type+'\','+i+',this.value)"><button class="cl-x" onclick="clRemoveComment(\''+type+'\','+i+')">&times;</button></div>'; });
    box.innerHTML=h;
  });
}
// Build the branded HTML email from a saved closing-report row.
// Reordered 26 Nov 2026 so it reads top-down: the four numbers, then anything that does not
// add up, then the detail. A section with nothing in it is left out rather than shown empty.
function clEmailHTML(c, ds){
  function n(x){ return x==null?0:Number(x); }
  function m(x){ return 'AED '+Math.round(n(x)).toLocaleString(); }
  function num(x){ return Math.round(n(x)).toLocaleString(); }
  function e(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  var rln=n(c.rest_lunch_net),rlc=n(c.rest_lunch_covers),rdn=n(c.rest_dinner_net),rdc=n(c.rest_dinner_covers);
  var lln=n(c.lounge_lunch_net),llc=n(c.lounge_lunch_covers),ldn=n(c.lounge_dinner_net),ldc=n(c.lounge_dinner_covers);
  var restNet=rln+rdn,restCov=rlc+rdc,lounNet=lln+ldn,lounCov=llc+ldc,net=restNet+lounNet,totCov=restCov+lounCov;
  function avg(x,cov){ return cov?('AED '+Math.round(x/cov).toLocaleString()):'—'; }
  var sr=clInit().srCovers;
  var tips=n(c.cc_tips)+n(c.cash_tips), comps=c.comps||[], compsTot=comps.reduce(function(s,x){return s+n(x.amount);},0);
  var dateLabel=new Date(ds+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  var sh=c.shifts||{}, good=c.comments_good||[], bad=c.comments_bad||[], host=sh.host||null;
  var SANS='font-family:Arial,sans-serif;', SERIF='font-family:Georgia,serif;';
  var H2='style="'+SERIF+'font-size:15px;color:#400207;border-bottom:2px solid #C9A84C;padding-bottom:5px;margin-bottom:10px;"';
  var TD='style="text-align:right;padding:8px 9px;"', TH='style="text-align:right;padding:7px 9px;font-size:11px;text-transform:uppercase;"';

  // ── To check: only what does not add up. Nothing to check, no box. ──
  var chk=[];
  function off(a,b){ var d=Math.abs(a-b); return d>=5 && d>0.1*Math.max(a,b); }
  if(sr){
    var ar=[];
    if(off(restCov,n(sr.restaurant))) ar.push('Restaurant '+restCov+' typed, '+n(sr.restaurant)+' served');
    if(off(lounCov,n(sr.lounge))) ar.push('Scala '+lounCov+' typed, '+n(sr.lounge)+' served');
    if(ar.length) chk.push('Guests by area do not match SevenRooms: '+ar.join(' &middot; '));
    else if(off(totCov,n(sr.total))) chk.push('Guests do not match SevenRooms: '+totCov+' typed, '+n(sr.total)+' served');
  }
  var noReason=comps.filter(function(x){ return n(x.amount) && !String(x.reason==null?'':x.reason).trim(); });
  if(noReason.length) chk.push(noReason.length+' comp'+(noReason.length>1?'s have':' has')+' no reason: '+noReason.map(function(x){ return e(x.table||'no table')+' '+m(x.amount); }).join(' &middot; '));
  var split=n(c.food_net)+n(c.bev_net)+n(c.tobacco_net)+n(c.other_net);
  if(split>0 && Math.abs(split-net)>=1) chk.push('Sales split is '+m(Math.abs(split-net))+' '+(split>net?'over':'under')+' net revenue');
  var cards=(host&&Array.isArray(host.cards))?host.cards:[];
  var noItem=cards.filter(function(x){ return !String(x.promised||'').trim(); });
  if(noItem.length) chk.push(noItem.length+' Host card'+(noItem.length>1?'s':'')+' with no item promised: '+noItem.map(function(x){ return e(x.name); }).join(', '));
  var chkBox=chk.length?('<div style="background:#FBF0D9;border:1px solid #E3C77A;border-radius:6px;padding:10px 14px;margin:14px 0 0;'+SANS+'font-size:13px;color:#5A3D05;line-height:1.6;"><strong>To check</strong><br>'+chk.join('<br>')+'</div>'):'';

  // ── The four numbers ──
  function cell(lbl,val){ return '<td style="width:25%;padding:0 4px;vertical-align:top;"><div style="background:#F3EADA;border-radius:6px;padding:10px 8px;text-align:center;"><div style="'+SANS+'font-size:11px;color:#5b4a36;">'+lbl+'</div><div style="'+SERIF+'font-size:19px;color:#400207;font-weight:bold;margin-top:4px;white-space:nowrap;">'+val+'</div></div></td>'; }
  var head4='<table style="width:100%;border-collapse:collapse;margin:0 -4px;"><tr>'
    +cell('Net revenue',m(net))+cell('Guests',num(totCov))+cell('Per guest',avg(net,totCov))+cell('Comps',net?((compsTot/net*100).toFixed(1)+'%'):'—')+'</tr></table>';

  function row(name,lun,din,cov,av){ return '<tr style="border-bottom:1px solid #E3D8C6;"><td style="padding:8px 9px;font-weight:bold;">'+name+'</td><td '+TD+'>'+lun+'</td><td '+TD+'>'+din+'</td><td '+TD+'>'+cov+'</td><td '+TD+'>'+av+'</td></tr>'; }

  // ── Comps, added up by reason. The tables stay visible under each line. ──
  var groups={}, order=[];
  comps.forEach(function(x){
    var k=clReasonGroup(x); if(!groups[k]){ groups[k]={n:0,amt:0,mgr:[],tables:[]}; order.push(k); }
    var g=groups[k]; g.n++; g.amt+=n(x.amount);
    var mg=String(x.manager==null?'':x.manager).trim(); if(mg && g.mgr.indexOf(mg)<0) g.mgr.push(mg);
    if(x.table) g.tables.push(String(x.table)+(n(x.amount)?(' '+num(x.amount)):''));
  });
  order.sort(function(a,b){ return groups[b].amt-groups[a].amt; });
  var compRows=order.map(function(k){ var g=groups[k];
    return '<tr style="border-top:1px solid #E3D8C6;"><td style="padding:7px 6px;'+(k?'':'color:#8E2C1F;font-weight:bold;')+'">'+(k?e(k):'No reason given')
      +'<div style="font-size:11px;color:#6b5a45;font-weight:normal;margin-top:2px;">'+e(g.tables.join(' · '))+'</div></td>'
      +'<td style="padding:7px 6px;text-align:right;vertical-align:top;">'+g.n+'</td><td style="padding:7px 6px;text-align:right;vertical-align:top;white-space:nowrap;">'+m(g.amt)+'</td>'
      +'<td style="padding:7px 6px;vertical-align:top;">'+(e(g.mgr.join(', '))||'—')+'</td></tr>'; }).join('');
  var compsBlock=comps.length?('<div style="padding:10px 30px;"><div '+H2+'>Comps &middot; '+m(compsTot)+' &middot; '+comps.length+' table'+(comps.length>1?'s':'')+'</div>'
    +'<table style="width:100%;border-collapse:collapse;'+SANS+'font-size:13px;color:#3d2f20;"><tr style="color:#5b4a36;font-size:11px;"><td style="padding:3px 6px;">Reason</td><td style="padding:3px 6px;text-align:right;">Tables</td><td style="padding:3px 6px;text-align:right;">Amount</td><td style="padding:3px 6px;">Approved by</td></tr>'+compRows+'</table></div>'):'';

  // ── Host programme ──
  var hostBlock='';
  if(host && (cards.length || typeof host.first_tables==='number')){
    var hostBy=''; cards.forEach(function(x){ if(x.host && !hostBy) hostBy=x.host; });
    hostBlock='<div style="padding:10px 30px;"><div '+H2+'>Host programme &middot; '+cards.length+' card'+(cards.length===1?'':'s')+' given</div>'
      +'<div style="'+SANS+'font-size:13px;color:#3d2f20;line-height:1.6;">'
      +(typeof host.first_tables==='number'?('First-time guests tonight (SevenRooms): <strong>'+host.first_tables+'</strong>'+(hostBy?' &middot; ':'')):'')
      +(hostBy?('Host: <strong>'+e(hostBy)+'</strong>'):'')+'</div>'
      +(cards.length?('<table style="width:100%;border-collapse:collapse;'+SANS+'font-size:13px;color:#3d2f20;margin-top:6px;"><tr style="color:#5b4a36;font-size:11px;"><td style="padding:3px 6px;">Guest</td><td style="padding:3px 6px;">Table</td><td style="padding:3px 6px;">Promised for next visit</td></tr>'
        +cards.map(function(x){ return '<tr style="border-top:1px solid #E3D8C6;"><td style="padding:6px;">'+e(x.name)+(x.pax?(' &middot; '+e(x.pax)):'')+'</td><td style="padding:6px;">'+(e(x.table)||'—')+'</td><td style="padding:6px;">'+(e(x.promised)||'<span style="color:#8E2C1F;">not written</span>')+'</td></tr>'; }).join('')+'</table>'):'')
      +'</div>';
  }

  // ── Shifts: a mark, then the line. An old report with no answer shows no mark. ──
  function pill(txt,bg){ return '<span style="display:inline-block;background:'+bg+';color:#FFFFFF;border-radius:10px;padding:1px 9px;font-size:11px;font-weight:bold;">'+txt+'</span> '; }
  function shiftLine(label,o){ o=o||{};
    var fb=String(o.feedback||'').trim(), ch=String(o.challenges||'').trim();
    var issue=(o.issue===true || o.issue===false) ? o.issue : (ch?true:null);
    if(!fb && !ch && issue==null) return '';
    return '<div style="margin-bottom:8px;">'+(issue===true?pill('Issue','#8E2C1F'):(issue===false?pill('No issues','#1F5A3A'):''))
      +'<strong style="color:#400207;">'+label+'</strong>'+(fb?(' &middot; '+e(fb)):'')
      +(ch?('<div style="margin-top:3px;color:#8E2C1F;"><strong>Issue:</strong> '+e(ch)+'</div>'):'')+'</div>'; }
  var shiftsHtml=shiftLine('Day (12&ndash;7)',sh.day)+shiftLine('Night (7&ndash;11)',sh.night)+shiftLine('Late (11&ndash;close)',sh.late);
  function bullets(arr){ return arr.map(function(t){return '&bull; '+e(t);}).join('<br>'); }

  return '<!doctype html><html><body style="margin:0;padding:0;background:#EFE7DA;font-family:Georgia,serif;color:#2C1810;"><div style="max-width:640px;margin:0 auto;background:#FBF7F0;">'
    +'<div style="background:#400207;padding:24px 30px;"><div style="font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:#C9A84C;font-weight:bold;">Roberto\'s DIFC &middot; Operations</div><div style="font-family:Georgia,serif;font-size:25px;color:#FBF7F0;margin-top:8px;">Daily Closing Report</div><div style="font-size:13px;color:#E8D9C7;margin-top:6px;">'+dateLabel+'</div></div>'
    +'<div style="padding:18px 30px 6px;">'+head4+chkBox+'</div>'
    +'<div style="padding:14px 30px 6px;"><div '+H2+'>Revenue</div>'
    +'<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;"><tr style="background:#400207;color:#FBF7F0;"><th style="text-align:left;padding:7px 9px;font-size:11px;text-transform:uppercase;">Area</th><th '+TH+'>Lunch<br><span style="font-weight:400;font-size:10px;">12:00–17:00</span></th><th '+TH+'>Dinner<br><span style="font-weight:400;font-size:10px;">17:01–close</span></th><th '+TH+'>Guests</th><th '+TH+'>Per guest</th></tr>'
    +row('Restaurant', rln?m(rln):'—', rdn?m(rdn):'—', restCov, avg(restNet,restCov))
    +row('Scala Lounge &amp; Bar', lln?m(lln):'—', ldn?m(ldn):'—', lounCov, avg(lounNet,lounCov))
    +'<tr style="background:#F3EADA;font-weight:bold;color:#400207;"><td style="padding:9px;">Total</td><td style="padding:9px;text-align:right;">'+((rln+lln)?m(rln+lln):'—')+'</td><td style="padding:9px;text-align:right;">'+m(rdn+ldn)+'</td><td style="padding:9px;text-align:right;">'+totCov+'</td><td style="padding:9px;text-align:right;">'+avg(net,totCov)+'</td></tr></table>'
    +'<div style="'+SANS+'font-size:13px;color:#3d2f20;margin-top:10px;line-height:1.7;">Food <strong>'+m(c.food_net)+'</strong> &middot; Beverage <strong>'+m(c.bev_net)+'</strong> &middot; Tobacco <strong>'+m(c.tobacco_net)+'</strong>'+(n(c.other_net)?' &middot; Miscellaneous <strong>'+m(c.other_net)+'</strong>':'')
    +'<br>Tips <strong>'+m(tips)+'</strong> (card '+num(c.cc_tips)+' &middot; cash '+num(c.cash_tips)+')'
    +(sr?('<br><span style="font-size:12px;color:#5b4a36;">SevenRooms served: Restaurant '+n(sr.restaurant)+' &middot; Scala '+n(sr.lounge)+' &middot; total '+n(sr.total)+'</span>'):'')+'</div></div>'
    +compsBlock
    +hostBlock
    +(c.private_events?'<div style="padding:10px 30px;"><div '+H2+'>Private events and groups</div><div style="'+SANS+'font-size:13px;color:#3d2f20;line-height:1.6;">'+e(c.private_events)+'</div></div>':'')
    +(shiftsHtml?'<div style="padding:10px 30px;"><div '+H2+'>Shifts</div><div style="'+SANS+'font-size:13px;color:#3d2f20;line-height:1.6;">'+shiftsHtml+'</div></div>':'')
    +((good.length||bad.length)?'<div style="padding:8px 30px 10px;'+SANS+'font-size:13px;color:#3d2f20;line-height:1.6;">'+(good.length?('<div style="color:#1F5A3A;font-weight:bold;">What went well</div>'+bullets(good)):'')+(bad.length?('<div style="color:#8E2C1F;font-weight:bold;margin-top:6px;">What didn\'t</div>'+bullets(bad)):'')+'</div>':'')
    +(c.support?'<div style="padding:10px 30px;"><div '+H2+'>Support needed</div><div style="'+SANS+'font-size:13px;color:#3d2f20;line-height:1.6;">'+e(c.support)+'</div></div>':'')
    +'<div style="padding:12px 30px 16px;'+SANS+'font-size:12px;color:#5b4a36;border-top:1px solid #E3D8C6;margin-top:8px;"><strong style="color:#400207;">Managers on duty</strong> &middot; AM: '+(e(c.manager_am)||'—')+' &middot; PM: '+(e(c.manager_pm)||'—')+'</div>'
    +'<div style="background:#400207;padding:14px 30px;font-family:Arial,sans-serif;font-size:11px;color:#C9A84C;">Submitted by '+(e(c.created_by)||'—')+' &middot; Roberto\'s DIFC</div></div></body></html>';
}
var CL_EMAIL_URL='https://paoaivwtkzujmrgrfjuq.supabase.co/functions/v1/send-closing-report';
async function clEmail(crow, ds){
  var subject="Roberto's DIFC — Daily Closing Report · "+new Date(ds+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  try{
    var resp=await fetch(CL_EMAIL_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_KEY,'apikey':SUPABASE_KEY},body:JSON.stringify({subject:subject, html:clEmailHTML(crow,ds)})});
    var data=await resp.json();
    if(!resp.ok) return {ok:false, msg:data.error||('HTTP '+resp.status)};
    return {ok:true};
  }catch(e){ return {ok:false, msg:String(e)}; }
}
// Load recent closing-report operational history (for the Analyst's pattern-reading).
async function clLoadHistory(){
  var R=revInit(); if(R.closingsLoaded) return;
  try{
    var res=await sb.from('closing_reports').select('service_date,manager_am,manager_pm,comps,shifts,comments_good,comments_bad,support,private_events').order('service_date',{ascending:false}).limit(60);
    if(res.error){ console.warn('[clLoadHistory] load failed — will retry next time', res.error); R.closings=[]; return; }   // leave closingsLoaded false so the AI never narrates from a failed (empty) load
    R.closings = res.data||[];
    R.closingsLoaded = true;   // only mark loaded once we actually have the data
  }catch(e){ console.warn('[clLoadHistory]', e); R.closings=[]; }
}
// Compact text digest of the operations log → appended to the Analyst briefing.
function revOpsDigest(){
  var cl=revInit().closings||[]; if(!cl.length) return '';
  var L=['\nOPERATIONS LOG (closing reports, newest first — use to spot recurring patterns/themes across nights):'];
  cl.slice(0,30).forEach(function(c){
    var ds=String(c.service_date).slice(0,10), sh=c.shifts||{}, ch=[];
    ['day','night','late'].forEach(function(k){ if((sh[k]||{}).challenges) ch.push(k+': '+sh[k].challenges); });
    var comps=c.comps||[], compTot=comps.reduce(function(s,x){return s+(Number(x.amount)||0);},0);
    var parts=[ds+' ('+revWeekday(ds).slice(0,3)+')'];
    var mgr=[c.manager_am,c.manager_pm].filter(Boolean).join('/'); if(mgr) parts.push('mgr '+mgr);
    if(comps.length) parts.push('comps '+comps.length+' (AED '+Math.round(compTot)+')');
    if(ch.length) parts.push('challenges — '+ch.join('; '));
    if((c.comments_good||[]).length) parts.push('good: '+c.comments_good.join('; '));
    if((c.comments_bad||[]).length) parts.push('bad: '+c.comments_bad.join('; '));
    if(c.support) parts.push('support: '+c.support);
    if(c.private_events) parts.push('events: '+c.private_events);
    L.push('  '+parts.join(' | '));
  });
  return L.join('\n');
}
async function clSave(andEmail){
  var C=clInit(), ds=clVal('cl-date')||C.date;
  if(C.loadFailed && C.loadFailed===ds){ if(typeof toast==='function') toast('Not saved — the existing report for '+ds+' could not be loaded, so saving could overwrite it. Close and reopen, then try again.', true); return; }
  function sum(a,b){ return (a==null&&b==null)?null:((a||0)+(b||0)); }
  var rl=clNum('cl-rl-net'),rlc=clNum('cl-rl-cov'),rd=clNum('cl-rd-net'),rdc=clNum('cl-rd-cov');
  var ll=clNum('cl-ll-net'),llc=clNum('cl-ll-cov'),ld=clNum('cl-ld-net'),ldc=clNum('cl-ld-cov');
  var food=clNum('cl-food'),bev=clNum('cl-bev'),tob=clNum('cl-tob'),misc=clNum('cl-misc');
  var restNet=sum(rl,rd), restCov=sum(rlc,rdc), lounNet=sum(ll,ld), lounCov=sum(llc,ldc);
  var net=(restNet==null&&lounNet==null)?null:((restNet||0)+(lounNet||0));
  // The issue box only counts when the answer is Yes; a No never carries an old challenge along.
  var shifts={};
  CL_SHIFTS.forEach(function(k){ var is=(C.issue||{})[k]; shifts[k]={feedback:clVal('cl-'+k+'-fb'), challenges:(is===false?'':clVal('cl-'+k+'-ch')), issue:(is===true||is===false)?is:null}; });
  var hostSave=clHostForSave(); if(hostSave) shifts.host=hostSave;
  var comps=C.comps.filter(function(c){return c.table||c.guest||c.amount||c.reason||c.manager;}).map(function(c){var o={table:c.table,guest:c.guest||'',amount:(Number(c.amount)||0),reason:c.reason,manager:c.manager}; if(c.reason==='Other'&&c.note&&String(c.note).trim()) o.note=String(c.note).trim(); return o;});
  var good=C.good.filter(function(t){return t&&t.trim();}), bad=C.bad.filter(function(t){return t&&t.trim();});
  var crow={ service_date:ds,
    rest_lunch_net:rl, rest_lunch_covers:rlc, rest_dinner_net:rd, rest_dinner_covers:rdc,
    lounge_lunch_net:ll, lounge_lunch_covers:llc, lounge_dinner_net:ld, lounge_dinner_covers:ldc,
    food_net:food, bev_net:bev, tobacco_net:tob, other_net:misc, cc_tips:clNum('cl-cc'), cash_tips:clNum('cl-cash'),
    manager_am:clVal('cl-mgr-am')||null, manager_pm:clVal('cl-mgr-pm')||null,
    comps:comps, shifts:shifts, private_events:clVal('cl-events')||null,
    comments_good:good, comments_bad:bad, support:clVal('cl-support')||null,
    created_by:(state.userEmail||null), updated_at:new Date().toISOString() };
  // Guard: revenue entered without covers would silently inflate spend-per-cover
  // on the board's MTD averages (net ÷ understated covers). Require covers for
  // any daypart that has a net figure.
  var coverChecks=[
    {net:rl,cov:rlc,label:'Restaurant lunch'},
    {net:rd,cov:rdc,label:'Restaurant dinner'},
    {net:ll,cov:llc,label:'Lounge lunch'},
    {net:ld,cov:ldc,label:'Lounge dinner'}
  ];
  var missingCovers=coverChecks.filter(function(c){ return c.net!=null && c.net!==0 && !(c.cov>0); }).map(function(c){ return c.label; });
  if(missingCovers.length){
    alert('Please add covers for: '+missingCovers.join(', ')+'.\n\nRevenue without covers makes the average-spend numbers wrong on the Revenue dashboard.');
    return;
  }
  // Block blank emails: don't fire a closing-report email to the team when the
  // snapshot has no real content (mirrors the kitchen blank-submit guard).
  var clSendWho = null;
  if(andEmail){
    var anyShiftNote=['day','night','late'].some(function(k){ return (shifts[k].feedback||'').trim() || (shifts[k].challenges||'').trim(); });
    var hasAny = net!=null || (hostSave&&hostSave.cards.length) || clVal('cl-mgr-am') || clVal('cl-mgr-pm') || good.length || bad.length || comps.length || clVal('cl-events') || clVal('cl-support') || anyShiftNote;
    if(!hasAny){ alert('Nothing to email — this closing report is empty.\n\nAdd revenue, a manager, or notes before using Save & Email.'); return; }
  }
  // Traceable: require a validated Employee ID to EMAIL the team OR to EDIT an
  // already-saved report, so changing a past report is never anonymous. A brand-
  // new plain Save (no saved row yet) stays frictionless.
  var clIsEdit = !!C.loadedRow, clActor = null;
  if((andEmail || clIsEdit) && typeof fohRequireStaffId === 'function'){
    clActor = await fohRequireStaffId(andEmail ? 'email the closing report to the team' : ('edit the saved closing report for '+ds), 'closing_report');
    if(!clActor) return;
    if(andEmail) clSendWho = clActor;
  }
  var btns=[document.getElementById('cl-save'),document.getElementById('cl-save-email')];
  function setBusy(t){ btns.forEach(function(b){ if(b){ b.disabled=!!t; } }); var se=document.getElementById('cl-save-email'); if(se) se.textContent=t?(andEmail?'Saving & emailing…':'Saving…'):'Save & Email'; }
  setBusy(true);
  var res=await sb.from('closing_reports').upsert(crow,{onConflict:'service_date'});
  if(res.error){ setBusy(false); alert('Could not save closing report: '+res.error.message+(res.error.code==='PGRST204'?'\n\nRun closing-report-schema.sql in Supabase first.':'')); return; }
  if(clIsEdit && clActor && typeof fohLogSend==='function') fohLogSend(clActor, 'closing_report_edit', ds);
  C.loadedRow = crow;   // once saved, further saves this session count as traced edits
  // ── Rollup into rev_daily (revenue fields only) ──
  var revRow={ service_date:ds,
    rest_lunch_net:rl, rest_lunch_covers:rlc, rest_dinner_net:rd, rest_dinner_covers:rdc,
    lounge_lunch_net:ll, lounge_lunch_covers:llc, lounge_dinner_net:ld, lounge_dinner_covers:ldc,
    rest_net:restNet, rest_covers_actual:restCov, lounge_net:lounNet, lounge_covers_actual:lounCov,
    food_net:food, bev_net:bev, tobacco_net:tob, other_net:misc, net_actual:net, updated_at:new Date().toISOString() };
  var res2=await sb.from('rev_daily').upsert(revRow,{onConflict:'service_date'});
  var R=revInit();
  // Only mirror into the local cache when the DB write actually succeeded —
  // otherwise the Revenue view would show numbers that aren't in the database,
  // leaving a silent hole in MTD that only surfaces on the next reload.
  if(!res2.error){
    var idx=R.daily.findIndex(function(x){return String(x.service_date).slice(0,10)===ds;});
    if(idx>=0) R.daily[idx]=Object.assign({},R.daily[idx],revRow); else R.daily.push(revRow);
  }
  if(res2.error){
    // Closing report itself saved (source of truth), but the revenue rollup did not —
    // so the EMAIL DOES NOT GO OUT. Leadership must never receive figures the app's own
    // Revenue page can't back up (16 Jul 2026: the email went out, rev_daily stayed empty,
    // and the gap only surfaced on the unfiled-nights banner the next day). Keep the form
    // open so the manager can just press the button again — nothing needs re-typing.
    setBusy(false);
    alert('⚠️ Your report is SAVED — nothing is lost.\n\nBut it could not be added to the Revenue page, so '+(andEmail?'the email was NOT sent yet':'Revenue was NOT updated')+'.\n\nPress '+(andEmail?'Save & Email':'Save')+' once more.\n\n(Technical detail: '+res2.error.message+')');
    return;
  }
  var emailMsg='';
  if(andEmail){ var em=await clEmail(crow, ds); emailMsg = em.ok ? ' · emailed to the team' : ('\n\n⚠️ Email NOT sent: '+em.msg+'\n(Deploy send-closing-report + set RESEND_API_KEY.)'); if(em.ok && clSendWho && typeof fohLogSend==='function') fohLogSend(clSendWho, 'closing_report_send', ds); }
  setBusy(false);
  clClose();
  revInit().opsRecentLoaded=false;
  if(state.currentTab==='revenue'||state.currentTab==='operations') renderMain();
  alert('Closing report saved · revenue updated.'+emailMsg);
}

// Is a shift running at hh:mm? Sounds trivial and is not: 1209 of the last sixty
// days' shifts END BEFORE THEY START (14:00–00:00, 16:00–02:00), so a plain
// `start <= t < end` range test gets every single one of them wrong. An open-ended
// shift is treated as running from its start; a shift with no start claims nothing,
// because a guess here is written into an accountability record.
function clOnAt(x, hhmm){
  var s = x && x.start, e = x && x.end;
  if(!s) return false;
  s = String(s).slice(0,5);
  e = e ? String(e).slice(0,5) : null;
  if(!e) return hhmm >= s;
  return (e > s) ? (hhmm >= s && hhmm < e)      // ordinary same-day shift
                 : (hhmm >= s || hhmm < e);     // runs past midnight
}
