// ──────────────────────────────────────────────────────────────────────────
// FOH Operations page (ops*) — slice 2 of the index.html split.
// Hosts the Daily Closing Report launcher + the recent-reports history table.
//
// PURE RELOCATION (no renames). Loaded as a classic <script> AFTER the main
// inline script and foh-closing.js, so its functions stay global (inline
// onclick handlers keep working) and it sees the shared globals it needs:
//   sb, state, revInit, revMoney  (main script)
//   clToday, clOpen               (foh-closing.js)
// These functions run only on tab navigation / realtime refresh, never at boot.
// ──────────────────────────────────────────────────────────────────────────
function renderOperations(){
  var today=clToday(), h=[];
  var view=revInit().opsView||'recent';
  h.push('<div class="ops-wrap">');
  h.push('<div class="ops-hero"><div class="ops-hero-k">Operations</div><div class="ops-hero-t">Daily Closing Report</div>'
    +'<div class="ops-hero-s">Capture the night at close — revenue, tips, comps and shift notes. It flows into Revenue automatically and feeds the Analyst for patterns.</div>'
    +'<div class="ops-hero-actions"><button class="ops-btn-primary" onclick="clOpen()">&#128203; Start today’s report</button>'
    +'<span class="ops-date">Another day <input type="date" id="ops-date" value="'+today+'"><button class="ops-btn-sec" onclick="clOpen(document.getElementById(\'ops-date\').value)">Open</button></span></div></div>');
  // Sub-view toggle: recent reports list vs the Service feedback History & Trends.
  function pill(k,label){ var on=(view===k); return '<button onclick="opsSetView(\''+k+'\')" style="padding:6px 14px;border-radius:16px;border:1px solid var(--vino);cursor:pointer;font-family:var(--font-sans);font-size:13px;'+(on?'background:var(--vino);color:var(--cream);font-weight:700':'background:transparent;color:var(--vino)')+'">'+label+'</button>'; }
  h.push('<div style="display:flex;gap:8px;margin:14px 0 4px">'+pill('recent','Recent reports')+pill('feedback','History & Trends')+'</div>');
  if(view==='feedback'){
    h.push('<div id="ops-feedback">'+opsFeedbackHTML()+'</div>');
  } else {
    h.push('<div class="rev-section-h">Recent closing reports</div><div id="ops-recent">'+opsRecentHTML()+'</div>');
    if(!revInit().opsRecentLoaded) opsLoadRecent();
  }
  h.push('</div>');
  return h.join('');
}
function opsSetView(v){ revInit().opsView=v; if(typeof renderMain==='function') renderMain(); }
function opsRecentHTML(){
  var R=revInit();
  if(!R.opsRecent) return '<div class="rev-mut" style="padding:12px">Loading…</div>';
  if(!R.opsRecent.length) return '<div class="rev-mut" style="padding:12px">No closing reports yet — start today’s above.</div>';
  function fdate(ds){ return new Date(String(ds).slice(0,10)+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}); }
  var rows=R.opsRecent.map(function(r){
    var net=Number(r.rest_lunch_net||0)+Number(r.rest_dinner_net||0)+Number(r.lounge_lunch_net||0)+Number(r.lounge_dinner_net||0);
    var cov=Number(r.rest_lunch_covers||0)+Number(r.rest_dinner_covers||0)+Number(r.lounge_lunch_covers||0)+Number(r.lounge_dinner_covers||0);
    var nc=((r.comments_good||[]).length)+((r.comments_bad||[]).length);
    return '<tr onclick="clOpen(\''+String(r.service_date).slice(0,10)+'\')"><td class="rev-day">'+fdate(r.service_date)+'</td><td>'+revMoney(net)+'</td><td>'+cov+'</td><td>'+(r.manager_pm||r.manager_am||'—')+'</td><td>'+(nc?nc+' note'+(nc>1?'s':''):'—')+'</td></tr>';
  }).join('');
  return '<div class="rev-grid-wrap"><table class="rev-grid"><thead><tr><th>Date</th><th>Net</th><th>Covers</th><th>Manager</th><th>Notes</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
async function opsLoadRecent(){
  var R=revInit(); R.opsRecentLoaded=true;
  try{
    var res=await sb.from('closing_reports').select('service_date,rest_lunch_net,rest_dinner_net,lounge_lunch_net,lounge_dinner_net,rest_lunch_covers,rest_dinner_covers,lounge_lunch_covers,lounge_dinner_covers,manager_am,manager_pm,comments_good,comments_bad').order('service_date',{ascending:false}).limit(30);
    if(res.error){ R.opsRecent=[]; if(typeof toast==='function') toast('Could not load recent reports — check connection.', true); }
    else { R.opsRecent=(res.data||[]); }
  }catch(e){ R.opsRecent=[]; if(typeof toast==='function') toast('Could not load recent reports — check connection.', true); }
  if(state.currentTab==='operations'){ var box=document.getElementById('ops-recent'); if(box) box.innerHTML=opsRecentHTML(); }
}

// ── History & Trends: AI "Service insights" from the nightly closing narratives ──
// Managers write the real signal (complaints, VIPs, events, issues) into the
// free-text shift notes + comps — NOT the structured comment boxes. So this reads
// those notes for a chosen window and asks the analyst (the same revenue-assistant
// relay, key stays server-side) to EXTRACT and group what matters. AI narrates only
// — it never invents numbers; the app supplies the raw notes verbatim.
function opsFeedbackHTML(){
  var R=revInit(), days=R.opsInsightDays||14;
  var h='';
  h+='<div class="rev-section-h">Service insights · AI read of the closing notes</div>';
  h+='<div class="rev-mut" style="padding:0 0 10px;font-size:13px">Reads the night/day/late shift notes &amp; comps from recent closing reports and pulls out complaints, recurring issues, VIPs, events and a comps watch. It only summarises what managers wrote — it never invents figures.</div>';
  h+='<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">';
  [7,14,30].forEach(function(d){ h+='<button onclick="opsSetInsightDays('+d+')" style="padding:5px 12px;border-radius:14px;border:1px solid var(--vino);cursor:pointer;font-size:12px;font-family:var(--font-sans);'+(d===days?'background:var(--vino);color:var(--cream);font-weight:700':'background:transparent;color:var(--vino)')+'">'+d+' days</button>'; });
  h+='<button onclick="opsGenInsights()" style="padding:6px 16px;border-radius:6px;border:none;background:var(--vino);color:var(--cream);font-weight:700;cursor:pointer;font-size:13px;font-family:var(--font-sans)">&#10024; Generate insights</button>';
  h+='</div>';
  h+='<div id="ops-insights">'+(R.opsInsights?opsRenderInsights(R.opsInsights):'<div class="rev-mut">Tap &ldquo;Generate insights&rdquo; to read the last '+days+' days of closing notes.</div>')+'</div>';
  return h;
}
function opsSetInsightDays(d){ revInit().opsInsightDays=d; if(typeof renderMain==='function') renderMain(); }
async function opsGenInsights(){
  var R=revInit(), days=R.opsInsightDays||14;
  var box=document.getElementById('ops-insights'); if(box) box.innerHTML='<div class="rev-mut" style="padding:12px">Reading the closing notes&hellip;</div>';
  try{
    var s=new Date(); s.setDate(s.getDate()-days);
    var since=s.getFullYear()+'-'+String(s.getMonth()+1).padStart(2,'0')+'-'+String(s.getDate()).padStart(2,'0');
    var res=await sb.from('closing_reports').select('service_date,manager_am,manager_pm,comps,shifts,rest_lunch_covers,rest_dinner_covers,lounge_lunch_covers,lounge_dinner_covers').gte('service_date',since).order('service_date',{ascending:false}).limit(60);
    if(res.error){ if(box) box.innerHTML='<div class="rev-mut">Could not load reports: '+clEsc(res.error.message)+'</div>'; return; }
    var rows=res.data||[];
    if(!rows.length){ if(box) box.innerHTML='<div class="rev-mut">No closing reports in the last '+days+' days.</div>'; return; }
    var digest=rows.map(function(r){
      var sh=r.shifts||{};
      function t(k){ var x=sh[k]||{}; var p=[]; if(x.feedback&&x.feedback.trim())p.push(x.feedback.trim()); if(x.challenges&&x.challenges.trim())p.push('CHALLENGE: '+x.challenges.trim()); return p.join('\n'); }
      var notes=['day','night','late'].map(function(k){ var v=t(k); return v?('['+k+'] '+v):''; }).filter(Boolean).join('\n');
      var comps=(r.comps||[]).map(function(c){ return (Number(c.amount)||0)+' '+(c.reason||'')+' ('+(c.manager||'?')+(c.table?' t'+c.table:'')+')'; }).join('; ');
      var cov=(Number(r.rest_lunch_covers)||0)+(Number(r.rest_dinner_covers)||0)+(Number(r.lounge_lunch_covers)||0)+(Number(r.lounge_dinner_covers)||0);
      return '=== '+String(r.service_date).slice(0,10)+' === manager: '+([r.manager_am,r.manager_pm].filter(Boolean).join(' / ')||'—')+' · covers: '+cov+(comps?('\nComps: '+comps):'')+(notes?('\nNotes:\n'+notes):'\n(no notes)');
    }).join('\n\n');
    var SYS="You are the operations analyst for Roberto's DIFC, a luxury Italian restaurant in Dubai (the restaurant is called Piemonte; the lounge/bar is Scala). You are given the managers' nightly CLOSING NOTES and COMPS for the last "+days+" days. Read them and surface what matters to the Group Executive Chef. Use ONLY what is written — never invent or estimate numbers or facts; if something is not mentioned, leave it out. Be specific: cite the date and the table/guest name when given. CRITICAL: do NOT add up, total, average or otherwise CALCULATE any figure — repeat amounts exactly as they appear in a note, and describe comp/spend patterns in WORDS (e.g. \"dessert comps on most nights, mostly authorised by Jins\") rather than computing a sum. The app does all arithmetic, never you. Group your answer into these sections, and SKIP any section with nothing to report:\n\n## Complaints & service issues\n- each guest complaint or service problem: date, table/guest, what happened, and any recovery done.\n## Recurring patterns\n- issues that repeat across nights (staffing shortfalls, wait times, food consistency, terrace/weather, etc.).\n## Comps watch\n- what is being comped and any pattern (e.g. dessert comps used as a default), and who comps most.\n## VIPs & notable guests\n- named VIPs, regulars and influencers, with the date seen.\n## Events & standout nights\n- private events, big spenders, and noticeably strong or weak nights.\n## What to watch\n- 2-3 short lines: the most important things for the chef to act on next.\n\nKeep it tight and scannable — short bullets, no fluff, no preamble.";
    var resp=await fetch(REV_AI_URL,{ method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_KEY,'apikey':SUPABASE_KEY}, body:JSON.stringify({ action:'chat', model:'claude-sonnet-4-6', max_tokens:1900, system:SYS, messages:[{role:'user', content:'CLOSING NOTES (newest first):\n\n'+digest}] }) });
    var data=await resp.json();
    if(!resp.ok || data.error){ if(box) box.innerHTML='<div class="rev-mut">Insights not available: '+clEsc((data&&data.error)||('HTTP '+resp.status))+'. The revenue-assistant Edge Function must be deployed.</div>'; return; }
    R.opsInsights=data.text||'(no insights returned)'; R.opsInsightsAt=String(rows.length)+' reports · last '+days+' days';
    if(box) box.innerHTML=opsRenderInsights(R.opsInsights);
  }catch(e){ if(box) box.innerHTML='<div class="rev-mut">Insights error: '+clEsc(String(e&&e.message||e))+'</div>'; }
}
// Light markdown → HTML for the analyst output: ## headers, - bullets, **bold**,
// | pipe tables |, and --- rules.
function opsRenderInsights(md){
  var R=revInit();
  var lines=String(md).split('\n'), html='', inList=false, i=0;
  function inline(s){ return clEsc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>'); }
  function closeList(){ if(inList){html+='</ul>';inList=false;} }
  function isRow(t){ return /^\|.*\|$/.test(t); }
  function isSep(t){ return /^\|[\s:|-]+\|$/.test(t); }
  function cells(t){ return t.replace(/^\|/,'').replace(/\|$/,'').split('|').map(function(c){return c.trim();}); }
  while(i<lines.length){
    var t=lines[i].trim();
    if(isRow(t)){
      var blk=[]; while(i<lines.length && isRow(lines[i].trim())){ blk.push(lines[i].trim()); i++; }
      closeList();
      var header=null, body=[];
      blk.forEach(function(r){ if(isSep(r)) return; if(header===null) header=cells(r); else body.push(cells(r)); });
      var th=header?('<tr>'+header.map(function(c){return '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid rgba(65,2,7,.25);font-size:12px;color:var(--vino-light);white-space:nowrap">'+inline(c)+'</th>';}).join('')+'</tr>'):'';
      var tb=body.map(function(row){ return '<tr>'+row.map(function(c){return '<td style="padding:4px 8px;border-bottom:1px solid rgba(65,2,7,.08);font-size:13px;color:var(--ink)">'+inline(c)+'</td>';}).join('')+'</tr>'; }).join('');
      html+='<table style="border-collapse:collapse;width:100%;margin:6px 0 12px">'+th+tb+'</table>';
      continue;
    }
    if(/^#{1,3}\s+/.test(t)){ closeList(); html+='<div style="font-family:var(--font-serif);color:var(--vino);font-size:15px;font-weight:700;margin:14px 0 6px">'+inline(t.replace(/^#{1,3}\s+/,''))+'</div>'; }
    else if(/^-{3,}$/.test(t)){ closeList(); }
    else if(/^[-*]\s+/.test(t)){ if(!inList){html+='<ul style="margin:4px 0 8px 2px;padding-left:18px">';inList=true;} html+='<li style="font-size:14px;color:var(--ink);margin-bottom:5px;line-height:1.4">'+inline(t.replace(/^[-*]\s+/,''))+'</li>'; }
    else if(t===''){ closeList(); }
    else { closeList(); html+='<div style="font-size:14px;color:var(--ink);margin:4px 0;line-height:1.4">'+inline(t)+'</div>'; }
    i++;
  }
  closeList();
  return '<div style="background:var(--sabbia-light);border-radius:6px;padding:14px 16px;overflow-x:auto">'+html
    +(R.opsInsightsAt?'<div class="rev-mut" style="margin-top:12px;font-size:11px;border-top:1px solid rgba(65,2,7,.2);padding-top:8px">Analyst read of '+clEsc(R.opsInsightsAt)+' · regenerate any time</div>':'')
    +'</div>';
}
