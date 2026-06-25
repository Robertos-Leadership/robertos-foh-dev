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
function clToday(){ var n=new Date(), d=new Date(n.getTime()+n.getTimezoneOffset()*60000+4*3600000-6*3600000); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function clNum(id){ var el=document.getElementById(id); if(!el) return null; var v=String(el.value||'').trim(); if(v==='') return null; v=Number(v.replace(/[^0-9.\-]/g,'')); return isFinite(v)?v:null; }
function clVal(id){ var el=document.getElementById(id); return el?String(el.value||'').trim():''; }
function clEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
async function clOpen(ds){
  var C=clInit(); ds=ds||clToday(); C.date=ds;
  var row=null;
  try{ var res=await sb.from('closing_reports').select('*').eq('service_date',ds).limit(1); if(!res.error && res.data && res.data.length) row=res.data[0]; }catch(e){}
  C.loadedRow=row;
  C.comps=(row&&Array.isArray(row.comps))?row.comps.slice():[];
  C.good=(row&&Array.isArray(row.comments_good))?row.comments_good.slice():[];
  C.bad=(row&&Array.isArray(row.comments_bad))?row.comments_bad.slice():[];
  // SevenRooms covers SERVED — live from the Kitchen edge function (actual COMPLETE
  // bookings, split by venue: PIEMONTE = Restaurant, everything else = Scala Lounge).
  // Fetched non-blocking so the modal opens immediately; clRecalc re-runs when it lands.
  C.srCovers=null; C.srCoversError=false;
  (function(){ var d=ds;
    fetch(KITCHEN_URL+'/functions/v1/sevenrooms-sync?covers_actual='+d,{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+KITCHEN_KEY,'x-proxy-secret':'Kitchen'}
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
  C.onDuty=[];
  try{
    var stf=await sb.from('foh_staff').select('id,name').eq('section','Management').eq('active',true);
    var byId={}; (stf.data||[]).forEach(function(s){byId[s.id]=s.name;}); var ids=Object.keys(byId);
    if(ids.length){
      var ros=await sb.from('foh_roster').select('staff_id,status,shift_start').eq('work_date',ds).in('staff_id',ids);
      C.onDuty=(ros.data||[]).filter(function(r){return r.status==='working';}).map(function(r){return {name:byId[r.staff_id], start:r.shift_start};}).filter(function(x){return x.name;});
    }
  }catch(e){}
  document.getElementById('cl-modal').style.display='flex';
  var delBtn=document.getElementById('cl-delete'); if(delBtn) delBtn.style.display = row ? '' : 'none';   // only deletable once saved
  clFill(row); clRenderComps(); clRenderComments();
  // Auto-fill manager on duty for a NEW report (never overwrite a saved one)
  if(!row && C.onDuty.length){
    var am=C.onDuty.filter(function(x){return x.start && x.start<'15:00';}).map(function(x){return x.name;});
    var pm=C.onDuty.filter(function(x){return !x.start || x.start>='15:00';}).map(function(x){return x.name;});
    var amEl=document.getElementById('cl-mgr-am'), pmEl=document.getElementById('cl-mgr-pm');
    if(amEl && !amEl.value && am.length) amEl.value=am.join(', ');
    if(pmEl && !pmEl.value) pmEl.value=(pm.length?pm:C.onDuty.map(function(x){return x.name;})).join(', ');
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
  set('cl-food',row.food_net); set('cl-bev',row.bev_net); set('cl-tob',row.tobacco_net);
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
  var fb=(clNum('cl-food')||0)+(clNum('cl-bev')||0)+(clNum('cl-tob')||0);
  if(g('cl-fnb-chk')) g('cl-fnb-chk').textContent= fb===0?'Optional — leave blank and the model estimates Food 48% / Bev 51% / Tobacco 1%.':('F&B '+revMoney(fb)+' vs net '+revMoney(tot)+(Math.abs(fb-tot)<1?'  ✓':''));
  var tips=(clNum('cl-cc')||0)+(clNum('cl-cash')||0);
  if(g('cl-tips-tot')) g('cl-tips-tot').textContent=revMoney(tips);
  var ct=clInit().comps.reduce(function(s,c){return s+(Number(c.amount)||0);},0);
  if(g('cl-comps-tot')) g('cl-comps-tot').innerHTML= clInit().comps.length?('Comps total <b>'+revMoney(ct)+'</b>'+(tot?' · '+(ct/tot*100).toFixed(1)+'% of net':'')):'';
  var sr=clInit().srCovers;
  if(g('cl-sr-covers')){
    if(sr){
      var cmp=function(entered,actual){ if(!entered) return ''; if(entered===actual) return ' <b style="color:#2d7a4f">✓</b>'; var df=entered-actual; return ' <span style="color:#b3402f">('+(df>=0?'+':'')+df+')</span>'; };
      g('cl-sr-covers').innerHTML='SevenRooms served &mdash; Restaurant <b>'+sr.restaurant+'</b>'+cmp(restCov,sr.restaurant)
        +' &middot; Scala <b>'+sr.lounge+'</b>'+cmp(lounCov,sr.lounge)
        +' &middot; total <b>'+sr.total+'</b>'+cmp(totCov,sr.total);
    } else if(clInit().srCoversError){
      g('cl-sr-covers').innerHTML='<span style="color:#b3402f">SevenRooms covers couldn’t load &mdash; enter and verify covers manually.</span>';
    } else g('cl-sr-covers').textContent='';
  }
}
function clAddComp(){ clInit().comps.push({table:'',guest:'',amount:'',reason:'',manager:''}); clRenderComps(); }
function clRemoveComp(i){ clInit().comps.splice(i,1); clRenderComps(); clRecalc(); }
function clCompField(i,f,v){ clInit().comps[i][f]=v; if(f==='amount') clRecalc(); }
function clRenderComps(){
  var C=clInit(), box=document.getElementById('cl-comps'); if(!box) return; var h='';
  C.comps.forEach(function(c,i){
    h+='<div class="cl-comp-row">'
      +'<input placeholder="Table" value="'+clEsc(c.table)+'" oninput="clCompField('+i+',\'table\',this.value)">'
      +'<input placeholder="Guest" value="'+clEsc(c.guest)+'" oninput="clCompField('+i+',\'guest\',this.value)">'
      +'<input placeholder="AED" type="number" inputmode="decimal" value="'+clEsc(c.amount)+'" oninput="clCompField('+i+',\'amount\',this.value)">'
      +'<input placeholder="Reason" value="'+clEsc(c.reason)+'" oninput="clCompField('+i+',\'reason\',this.value)">'
      +'<input placeholder="Mgr" value="'+clEsc(c.manager)+'" oninput="clCompField('+i+',\'manager\',this.value)">'
      +'<button class="cl-x" onclick="clRemoveComp('+i+')" title="Remove">&times;</button></div>';
  });
  box.innerHTML=h;
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
function clEmailHTML(c, ds){
  function n(x){ return x==null?0:Number(x); }
  function m(x){ return 'AED '+Math.round(n(x)).toLocaleString(); }
  function e(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  var rln=n(c.rest_lunch_net),rlc=n(c.rest_lunch_covers),rdn=n(c.rest_dinner_net),rdc=n(c.rest_dinner_covers);
  var lln=n(c.lounge_lunch_net),llc=n(c.lounge_lunch_covers),ldn=n(c.lounge_dinner_net),ldc=n(c.lounge_dinner_covers);
  var restNet=rln+rdn,restCov=rlc+rdc,lounNet=lln+ldn,lounCov=llc+ldc,net=restNet+lounNet,totCov=restCov+lounCov;
  function avg(x,cov){ return cov?('AED '+Math.round(x/cov).toLocaleString()):'—'; }
  var sr=clInit().srCovers,srLine='';
  if(sr){ srLine='SevenRooms served — Restaurant <b>'+n(sr.restaurant)+'</b> · Scala <b>'+n(sr.lounge)+'</b> · total <b>'+n(sr.total)+'</b> covers'+(n(sr.total)===totCov?' &check;':' · entered '+totCov); }
  var tips=n(c.cc_tips)+n(c.cash_tips), comps=c.comps||[], compsTot=comps.reduce(function(s,x){return s+n(x.amount);},0);
  var dateLabel=new Date(ds+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  var sh=c.shifts||{}, good=c.comments_good||[], bad=c.comments_bad||[];
  var TD='style="text-align:right;padding:8px 9px;"', TH='style="text-align:right;padding:7px 9px;font-size:11px;text-transform:uppercase;"';
  function row(name,lun,din,cov,av){ return '<tr style="border-bottom:1px solid #E3D8C6;"><td style="padding:8px 9px;font-weight:bold;">'+name+'</td><td '+TD+'>'+lun+'</td><td '+TD+'>'+din+'</td><td '+TD+'>'+cov+'</td><td '+TD+'>'+av+'</td></tr>'; }
  var compRows = comps.length? comps.map(function(x){ return '<tr style="border-top:1px solid #E3D8C6;"><td style="padding:6px;">'+e(x.table)+'</td><td style="padding:6px;">'+e(x.guest)+'</td><td style="padding:6px;text-align:right;">'+m(x.amount)+'</td><td style="padding:6px;">'+e(x.reason)+'</td><td style="padding:6px;">'+e(x.manager)+'</td></tr>'; }).join('') : '<tr><td style="padding:6px;color:#9c8a72;" colspan="5">None</td></tr>';
  function shiftLine(label,o){ o=o||{}; return '<strong style="color:#400207;">'+label+':</strong> '+(e(o.feedback)||'—')+(o.challenges?(' &nbsp;<em>Challenges:</em> '+e(o.challenges)):'')+'<br>'; }
  function bullets(arr){ return arr.length? arr.map(function(t){return '&bull; '+e(t);}).join('<br>') : '<span style="color:#9c8a72;">—</span>'; }
  return '<!doctype html><html><body style="margin:0;padding:0;background:#EFE7DA;font-family:Georgia,serif;color:#2C1810;"><div style="max-width:640px;margin:0 auto;background:#FBF7F0;">'
    +'<div style="background:#400207;padding:24px 30px;"><div style="font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:#C9A84C;font-weight:bold;">Roberto\'s DIFC &middot; Operations</div><div style="font-family:Georgia,serif;font-size:25px;color:#FBF7F0;margin-top:8px;">Daily Closing Report</div><div style="font-size:13px;color:#E8D9C7;margin-top:6px;">'+dateLabel+'</div></div>'
    +'<div style="padding:16px 30px;border-bottom:1px solid #E3D8C6;font-family:Arial,sans-serif;font-size:13px;color:#5b4a36;"><strong style="color:#400207;">Manager on duty</strong> &middot; AM: '+(e(c.manager_am)||'—')+' &middot; PM: '+(e(c.manager_pm)||'—')+'</div>'
    +'<div style="padding:20px 30px 6px;"><div style="font-family:Georgia,serif;font-size:16px;color:#400207;border-bottom:2px solid #C9A84C;padding-bottom:6px;margin-bottom:12px;">Revenue</div>'
    +'<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;"><tr style="background:#400207;color:#FBF7F0;"><th style="text-align:left;padding:7px 9px;font-size:11px;text-transform:uppercase;">Area</th><th '+TH+'>Lunch</th><th '+TH+'>Dinner</th><th '+TH+'>Covers</th><th '+TH+'>Avg</th></tr>'
    +row('Restaurant', rln?m(rln):'—', rdn?m(rdn):'—', restCov, avg(restNet,restCov))
    +row('Scala Lounge &amp; Bar', lln?m(lln):'—', ldn?m(ldn):'—', lounCov, avg(lounNet,lounCov))
    +'<tr style="background:#F3EADA;font-weight:bold;color:#400207;"><td style="padding:9px;">Total</td><td style="padding:9px;text-align:right;">'+((rln+lln)?m(rln+lln):'—')+'</td><td style="padding:9px;text-align:right;">'+m(rdn+ldn)+'</td><td style="padding:9px;text-align:right;">'+totCov+'</td><td style="padding:9px;text-align:right;">'+avg(net,totCov)+'</td></tr></table>'
    +(srLine?'<div style="font-family:Arial,sans-serif;font-size:11px;color:#8B7355;margin-top:8px;">'+srLine+'</div>':'')+'</div>'
    +'<div style="padding:12px 30px;"><table style="width:100%;font-family:Arial,sans-serif;font-size:13px;"><tr><td style="vertical-align:top;width:50%;padding-right:12px;"><div style="font-family:Georgia,serif;font-size:14px;color:#400207;margin-bottom:6px;">Sales split</div><div style="color:#5b4a36;line-height:1.7;">Food <strong>'+m(c.food_net)+'</strong><br>Beverage <strong>'+m(c.bev_net)+'</strong><br>Tobacco <strong>'+m(c.tobacco_net)+'</strong></div></td><td style="vertical-align:top;width:50%;padding-left:12px;border-left:1px solid #E3D8C6;"><div style="font-family:Georgia,serif;font-size:14px;color:#400207;margin-bottom:6px;">Tips</div><div style="color:#5b4a36;line-height:1.7;">CC <strong>'+m(c.cc_tips)+'</strong><br>Cash <strong>'+m(c.cash_tips)+'</strong><br>Total <strong>'+m(tips)+'</strong></div></td></tr></table></div>'
    +'<div style="padding:10px 30px;"><div style="font-family:Georgia,serif;font-size:14px;color:#400207;border-bottom:2px solid #C9A84C;padding-bottom:5px;margin-bottom:10px;">Comps &middot; '+m(compsTot)+(net?(' ('+(compsTot/net*100).toFixed(1)+'% of net)'):'')+'</div><table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;color:#5b4a36;"><tr style="color:#9c8a72;text-transform:uppercase;font-size:10px;"><td style="padding:3px 6px;">Table</td><td style="padding:3px 6px;">Guest</td><td style="padding:3px 6px;text-align:right;">Amount</td><td style="padding:3px 6px;">Reason</td><td style="padding:3px 6px;">Mgr</td></tr>'+compRows+'</table></div>'
    +(c.private_events?'<div style="padding:8px 30px;font-family:Arial,sans-serif;font-size:13px;color:#5b4a36;"><span style="font-family:Georgia,serif;color:#400207;">Private events:</span> '+e(c.private_events)+'</div>':'')
    +'<div style="padding:12px 30px;"><div style="font-family:Georgia,serif;font-size:14px;color:#400207;border-bottom:2px solid #C9A84C;padding-bottom:5px;margin-bottom:10px;">Shift logs</div><div style="font-family:Arial,sans-serif;font-size:12px;color:#5b4a36;line-height:1.7;">'+shiftLine('Day (12&ndash;7)',sh.day)+shiftLine('Night (7&ndash;11)',sh.night)+shiftLine('Late (11&ndash;close)',sh.late)+'</div></div>'
    +'<div style="padding:8px 30px 14px;"><table style="width:100%;font-family:Arial,sans-serif;font-size:12px;"><tr><td style="vertical-align:top;width:50%;padding-right:12px;"><div style="color:#2d7a4f;text-transform:uppercase;font-size:11px;font-weight:bold;margin-bottom:6px;">What went well</div><div style="color:#5b4a36;line-height:1.7;">'+bullets(good)+'</div></td><td style="vertical-align:top;width:50%;padding-left:12px;border-left:1px solid #E3D8C6;"><div style="color:#b3402f;text-transform:uppercase;font-size:11px;font-weight:bold;margin-bottom:6px;">What didn\'t</div><div style="color:#5b4a36;line-height:1.7;">'+bullets(bad)+'</div></td></tr></table></div>'
    +(c.support?'<div style="padding:4px 30px 18px;font-family:Arial,sans-serif;font-size:13px;color:#5b4a36;"><span style="font-family:Georgia,serif;color:#400207;">Support needed:</span> '+e(c.support)+'</div>':'')
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
  function sum(a,b){ return (a==null&&b==null)?null:((a||0)+(b||0)); }
  var rl=clNum('cl-rl-net'),rlc=clNum('cl-rl-cov'),rd=clNum('cl-rd-net'),rdc=clNum('cl-rd-cov');
  var ll=clNum('cl-ll-net'),llc=clNum('cl-ll-cov'),ld=clNum('cl-ld-net'),ldc=clNum('cl-ld-cov');
  var food=clNum('cl-food'),bev=clNum('cl-bev'),tob=clNum('cl-tob');
  var restNet=sum(rl,rd), restCov=sum(rlc,rdc), lounNet=sum(ll,ld), lounCov=sum(llc,ldc);
  var net=(restNet==null&&lounNet==null)?null:((restNet||0)+(lounNet||0));
  var shifts={ day:{feedback:clVal('cl-day-fb'),challenges:clVal('cl-day-ch')}, night:{feedback:clVal('cl-night-fb'),challenges:clVal('cl-night-ch')}, late:{feedback:clVal('cl-late-fb'),challenges:clVal('cl-late-ch')} };
  var comps=C.comps.filter(function(c){return c.table||c.guest||c.amount||c.reason||c.manager;}).map(function(c){return {table:c.table,guest:c.guest,amount:(Number(c.amount)||0),reason:c.reason,manager:c.manager};});
  var good=C.good.filter(function(t){return t&&t.trim();}), bad=C.bad.filter(function(t){return t&&t.trim();});
  var crow={ service_date:ds,
    rest_lunch_net:rl, rest_lunch_covers:rlc, rest_dinner_net:rd, rest_dinner_covers:rdc,
    lounge_lunch_net:ll, lounge_lunch_covers:llc, lounge_dinner_net:ld, lounge_dinner_covers:ldc,
    food_net:food, bev_net:bev, tobacco_net:tob, cc_tips:clNum('cl-cc'), cash_tips:clNum('cl-cash'),
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
    var hasAny = net!=null || clVal('cl-mgr-am') || clVal('cl-mgr-pm') || good.length || bad.length || comps.length || clVal('cl-events') || clVal('cl-support') || anyShiftNote;
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
    food_net:food, bev_net:bev, tobacco_net:tob, net_actual:net, updated_at:new Date().toISOString() };
  var res2=await sb.from('rev_daily').upsert(revRow,{onConflict:'service_date'});
  var R=revInit();
  // Only mirror into the local cache when the DB write actually succeeded —
  // otherwise the Revenue view would show numbers that aren't in the database,
  // leaving a silent hole in MTD that only surfaces on the next reload.
  if(!res2.error){
    var idx=R.daily.findIndex(function(x){return String(x.service_date).slice(0,10)===ds;});
    if(idx>=0) R.daily[idx]=Object.assign({},R.daily[idx],revRow); else R.daily.push(revRow);
  }
  var emailMsg='';
  if(andEmail){ var em=await clEmail(crow, ds); emailMsg = em.ok ? ' · emailed to the team' : ('\n\n⚠️ Email NOT sent: '+em.msg+'\n(Deploy send-closing-report + set RESEND_API_KEY.)'); if(em.ok && clSendWho && typeof fohLogSend==='function') fohLogSend(clSendWho, 'closing_report_send', ds); }
  setBusy(false);
  if(res2.error){
    // Closing report itself saved (source of truth), but the revenue rollup did
    // not. Keep the form open so the manager can fix and re-save without re-typing.
    alert('⚠️ Closing report saved, but the REVENUE ROLLUP FAILED — revenue numbers were NOT updated.\n\n'+res2.error.message+'\n\nFix the issue and tap Save again to update Revenue.'+emailMsg);
    return;
  }
  clClose();
  revInit().opsRecentLoaded=false;
  if(state.currentTab==='revenue'||state.currentTab==='operations') renderMain();
  alert('Closing report saved · revenue updated.'+emailMsg);
}
