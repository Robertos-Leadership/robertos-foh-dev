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
// relay, key stays server-side) to group them. AI narrates only — it never invents
// numbers; the app supplies the raw notes verbatim.
//
// It shows RECURRING issues ONLY: something written up on OPS_MIN_NIGHTS or more
// SEPARATE nights inside the chosen window. A one-off is noise here — it already
// reads in Recent reports, and dressing it up as an "insight" misleads. So the AI
// only groups notes that mean the same thing and cites the dates it took them
// from; the APP counts those dates, drops anything under the floor, and throws out
// any date that is not a real report. The AI never counts and never calculates.
var OPS_MIN_NIGHTS = 3;
function opsFeedbackHTML(){
  var R=revInit(), days=R.opsInsightDays||14;
  var h='';
  h+='<div class="rev-section-h">Recurring issues · AI read of the closing notes</div>';
  h+='<div class="rev-mut" style="padding:0 0 10px;font-size:13px">Reads the day/night/late shift notes &amp; comps from the closing reports and shows only what managers wrote up on <b>'+OPS_MIN_NIGHTS+' or more separate nights</b> — the things that keep happening. One-off nights are left out on purpose: they are in Recent reports, and treating them as a pattern is misleading. It only groups what managers wrote — it never invents figures.</div>';
  h+='<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">';
  [7,14,30].forEach(function(d){ h+='<button onclick="opsSetInsightDays('+d+')" style="padding:5px 12px;border-radius:14px;border:1px solid var(--vino);cursor:pointer;font-size:12px;font-family:var(--font-sans);'+(d===days?'background:var(--vino);color:var(--cream);font-weight:700':'background:transparent;color:var(--vino)')+'">'+d+' days</button>'; });
  h+='<button onclick="opsGenInsights()" style="padding:6px 16px;border-radius:6px;border:none;background:var(--vino);color:var(--cream);font-weight:700;cursor:pointer;font-size:13px;font-family:var(--font-sans)">&#10024; Find recurring issues</button>';
  h+='</div>';
  h+='<div id="ops-insights">'+(R.opsInsights?opsRenderInsights(R.opsInsights):'<div class="rev-mut">Tap &ldquo;Find recurring issues&rdquo; to read the last '+days+' days of closing notes.</div>')+'</div>';
  return h;
}
function opsSetInsightDays(d){ revInit().opsInsightDays=d; if(typeof renderMain==='function') renderMain(); }
// Day number (noon-anchored, so DST/timezone can never shift a date by one).
function opsDayNum(d){ return Math.round(new Date(String(d).slice(0,10)+'T12:00:00').getTime()/86400000); }
function opsFDate(d){ return new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}); }
// Tightest run: the fewest days that contain OPS_MIN_NIGHTS of these nights.
// 3 nights inside 6 days is a fire; 3 nights spread over 30 is a slow drip.
function opsTightestRun(ds){
  var best=9999;
  for(var i=0;i+OPS_MIN_NIGHTS-1<ds.length;i++){
    var w=opsDayNum(ds[i+OPS_MIN_NIGHTS-1])-opsDayNum(ds[i])+1;
    if(w<best) best=w;
  }
  return best;
}
// Plain English for how often and how bunched — never "3 of them inside 22 days",
// which sounds tight when it is actually a slow drip across the whole window.
function opsCountLine(p){
  if(p.n===OPS_MIN_NIGHTS) return p.n+' nights, inside '+p.run+' days';
  if(p.run<=14) return p.n+' nights &middot; the closest '+OPS_MIN_NIGHTS+' inside '+p.run+' days';
  return p.n+' nights, spread across the window';
}
function opsTier(run){
  if(run<=7)  return { label:OPS_MIN_NIGHTS+'+ in one week', colour:'var(--vino)',        text:'var(--cream)' };
  if(run<=14) return { label:OPS_MIN_NIGHTS+'+ in two weeks', colour:'var(--gold-dim)',   text:'var(--cream)' };
  return            { label:OPS_MIN_NIGHTS+'+ in a month',    colour:'var(--sabbia-dark)', text:'var(--ink)' };
}
async function opsGenInsights(){
  var R=revInit(), days=R.opsInsightDays||14;
  var box=document.getElementById('ops-insights'); if(box) box.innerHTML='<div class="rev-mut" style="padding:12px">Reading the closing notes&hellip;</div>';
  try{
    var s=new Date(); s.setDate(s.getDate()-days);
    var since=s.getFullYear()+'-'+String(s.getMonth()+1).padStart(2,'0')+'-'+String(s.getDate()).padStart(2,'0');
    var res=await sb.from('closing_reports').select('service_date,manager_am,manager_pm,comps,shifts').gte('service_date',since).order('service_date',{ascending:false}).limit(60);
    if(res.error){ if(box) box.innerHTML='<div class="rev-mut">Could not load reports: '+clEsc(res.error.message)+'</div>'; return; }
    var rows=res.data||[];
    if(!rows.length){ if(box) box.innerHTML='<div class="rev-mut">No closing reports in the last '+days+' days.</div>'; return; }
    // Only nights that actually say something are sent: an empty night cannot be
    // part of a pattern, and shipping it just makes the read slower.
    var real={}, nights=[];
    rows.forEach(function(r){
      var d=String(r.service_date).slice(0,10); real[d]=true;
      var sh=r.shifts||{};
      function t(k){ var x=sh[k]||{}; var p=[]; if(x.feedback&&x.feedback.trim())p.push(x.feedback.trim()); if(x.challenges&&x.challenges.trim())p.push('CHALLENGE: '+x.challenges.trim()); return p.join('\n'); }
      var notes=['day','night','late'].map(function(k){ var v=t(k); return v?('['+k+'] '+v):''; }).filter(Boolean).join('\n');
      var comps=(r.comps||[]).map(function(c){ return (Number(c.amount)||0)+' '+(c.reason||'')+' ('+(c.manager||'?')+(c.table?' t'+c.table:'')+')'; }).join('; ');
      if(!notes && !comps) return;
      nights.push('=== '+d+' === manager: '+([r.manager_am,r.manager_pm].filter(Boolean).join(' / ')||'—')+(comps?('\nComps: '+comps):'')+(notes?('\nNotes:\n'+notes):''));
    });
    if(nights.length<OPS_MIN_NIGHTS){
      if(box) box.innerHTML='<div class="rev-mut" style="padding:12px">Only '+nights.length+' of the last '+rows.length+' closing reports have any notes or comps written in. Nothing can repeat '+OPS_MIN_NIGHTS+' times yet — try a longer window.</div>';
      return;
    }
    var SYS="You are the operations analyst for Roberto's DIFC, a luxury Italian restaurant in Dubai (the restaurant is called Piemonte; the lounge/bar is Scala). Below are the managers' nightly CLOSING NOTES and COMPS.\n\nYOUR ONLY JOB: find what RECURS. A topic qualifies ONLY if it is written up on "+OPS_MIN_NIGHTS+" or more SEPARATE dates below. Anything that happened once or twice is OUT, no matter how dramatic or expensive — a one-off is not a pattern and reporting it as one is misleading. Do not include it.\n\nGroup notes that mean the same thing even when the wording differs (\"terrace freezing\", \"heaters off outside\", \"guests moved in from the terrace\" = ONE topic). Keep each topic specific and concrete — \"starters slow on full nights\", not \"service issues\".\n\nRules:\n- Use ONLY what is written. Never invent, estimate, total, average or otherwise CALCULATE anything — the app does all arithmetic, never you.\n- Every date you list must be a date that literally heads the note you took it from.\n- Give a few words quoted verbatim from the notes as evidence.\n\nReturn STRICT JSON and NOTHING else — no markdown, no code fences, no preamble:\n{\"patterns\":[{\"topic\":\"short name, max 6 words\",\"kind\":\"service|food|staffing|facility|comps|guest\",\"dates\":[\"YYYY-MM-DD\"],\"detail\":\"one plain sentence: what keeps happening and what it costs us\",\"evidence\":[\"short verbatim quote\"]}]}\n\nList only topics with "+OPS_MIN_NIGHTS+" or more distinct dates, most serious first. If nothing recurs that often, return {\"patterns\":[]} — that is a perfectly good answer, do not pad it.";
    var resp=await fetch(REV_AI_URL,{ method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_KEY,'apikey':SUPABASE_KEY}, body:JSON.stringify({ action:'chat', model:'claude-sonnet-4-6', max_tokens:900, system:SYS, messages:[{role:'user', content:'CLOSING NOTES (newest first):\n\n'+nights.join('\n\n')}] }) });
    var data=await resp.json();
    if(!resp.ok || data.error){ if(box) box.innerHTML='<div class="rev-mut">Insights not available: '+clEsc((data&&data.error)||('HTTP '+resp.status))+'. The revenue-assistant Edge Function must be deployed.</div>'; return; }
    var raw=String(data.text||'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
    var parsed=null;
    try{ parsed=JSON.parse(raw); }catch(e){ var m=raw.match(/\{[\s\S]*\}/); if(m){ try{ parsed=JSON.parse(m[0]); }catch(e2){} } }
    if(!parsed || !Array.isArray(parsed.patterns)){ if(box) box.innerHTML='<div class="rev-mut">The analyst did not answer in a readable format. Tap again.</div>'; return; }
    // ── The app does the counting, not the AI. A topic survives only if it cites
    // OPS_MIN_NIGHTS+ distinct dates that each match a real closing report.
    var pats=parsed.patterns.map(function(p){
      var seen={}, ds=[];
      ((p&&p.dates)||[]).forEach(function(d){ var k=String(d).slice(0,10); if(real[k] && !seen[k]){ seen[k]=1; ds.push(k); } });
      ds.sort();
      return { topic:String((p&&p.topic)||'').trim(), kind:String((p&&p.kind)||'').trim(), detail:String((p&&p.detail)||'').trim(),
               evidence:((p&&p.evidence)||[]).slice(0,3).map(String), dates:ds, n:ds.length, run:opsTightestRun(ds) };
    }).filter(function(p){ return p.topic && p.n>=OPS_MIN_NIGHTS; });
    pats.sort(function(a,b){ return (a.run-b.run) || (b.n-a.n); });
    R.opsInsights={ pats:pats, nights:nights.length, reports:rows.length, days:days };
    R.opsInsightsAt='Read the '+nights.length+' night'+(nights.length===1?'':'s')+' with notes out of '+rows.length+' report'+(rows.length===1?'':'s')+' · last '+days+' days';
    if(box) box.innerHTML=opsRenderInsights(R.opsInsights);
  }catch(e){ if(box) box.innerHTML='<div class="rev-mut">Insights error: '+clEsc(String(e&&e.message||e))+'</div>'; }
}
// Renders the verified pattern list. Every card names the count and the exact
// nights it happened on, so the chef can open those reports and check us.
function opsRenderInsights(res){
  var R=revInit();
  var pats=(res&&res.pats)||[], html='';
  if(!pats.length){
    html='<div style="font-size:14px;color:var(--ink);line-height:1.5">Nothing was written up on '+OPS_MIN_NIGHTS+' or more separate nights in this window — no recurring issue to report.'
      +'<div class="rev-mut" style="margin-top:6px;font-size:13px">One-off notes from single nights are deliberately not shown here. They are in Recent reports.</div></div>';
  } else {
    html=pats.map(function(p){
      var tier=opsTier(p.run);
      var chips=p.dates.map(function(d){ return '<span style="display:inline-block;background:var(--cream);border:1px solid var(--sabbia-dark);border-radius:10px;padding:1px 8px;font-size:11px;color:var(--vino);margin:2px 4px 0 0;white-space:nowrap">'+clEsc(opsFDate(d))+'</span>'; }).join('');
      var quotes=p.evidence.length?('<div class="rev-mut" style="margin-top:6px;font-size:12px;font-style:italic;line-height:1.4">'+p.evidence.map(function(q){ return '&ldquo;'+clEsc(q)+'&rdquo;'; }).join(' &middot; ')+'</div>'):'';
      return '<div style="border-left:3px solid '+tier.colour+';background:var(--cream);border-radius:5px;padding:10px 12px;margin-bottom:10px">'
        +'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">'
        +'<span style="background:'+tier.colour+';color:'+tier.text+';border-radius:10px;padding:2px 9px;font-size:11px;font-weight:700;white-space:nowrap">'+tier.label+'</span>'
        +'<span style="font-family:var(--font-serif);font-size:15px;font-weight:700;color:var(--vino)">'+clEsc(p.topic)+'</span>'
        +'<span class="rev-mut" style="font-size:12px">'+opsCountLine(p)+'</span>'
        +'</div>'
        +(p.detail?'<div style="font-size:14px;color:var(--ink);line-height:1.45">'+clEsc(p.detail)+'</div>':'')
        +'<div style="margin-top:6px">'+chips+'</div>'+quotes+'</div>';
    }).join('');
  }
  return '<div style="background:var(--sabbia-light);border-radius:6px;padding:14px 16px;overflow-x:auto">'+html
    +(R.opsInsightsAt?'<div class="rev-mut" style="margin-top:12px;font-size:11px;border-top:1px solid rgba(65,2,7,.2);padding-top:8px">'+clEsc(R.opsInsightsAt)+' &middot; only what repeats on '+OPS_MIN_NIGHTS+'+ nights is shown &middot; regenerate any time</div>':'')
    +'</div>';
}
