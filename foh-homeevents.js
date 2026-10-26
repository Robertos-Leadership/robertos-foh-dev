/* ── Team Home — upcoming events ──────────────────────────────────────────
   Alessandro, "Tell us", 26 Oct 2026: "add the same pop up for event in program
   for the future weeks same as the BOH home page".

   The Kitchen home already shows what is coming: today's events, this week, the
   week after, and one line for anything further out. This is the same list on
   the FOH Team Home, read from the SAME feed (the kitchen-events function), so
   the two screens can never disagree about what is booked.

   Read-only, and it shows what the floor needs: who, when, how many, where, the
   menu and its allergens, dietary notes. Not the kitchen's prep quantities, not
   Print menu, not the portion editor, not the complimentary-tasting panel —
   those belong to the chefs. The feed itself carries no prices.

   Tap a row to open it in place (no browser pop-up). Rows beyond two weeks sit
   behind one "+ N more" button, closed by default, exactly like the Kitchen. */
(function(){
  var FEED = 'https://paoaivwtkzujmrgrfjuq.supabase.co/functions/v1/kitchen-events';
  var WINDOW_DAYS = 14;
  var ALG = {D:'dairy',E:'egg',H:'homemade',N:'nuts',R:'raw',S:'shellfish',V:'vegetarian'};
  var laterOpen = false, opened = {}, last = null, loading = false;

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function algText(a){ return (a||[]).map(function(c){ return ALG[c]||String(c).toLowerCase(); }).join(', '); }
  function dayBadge(ds){
    var d = new Date(String(ds).slice(0,10)+'T12:00:00');
    return { day:d.getDate(), mon:d.toLocaleDateString('en-GB',{weekday:'short',month:'short'}) };
  }
  function daysUntil(d, today){
    return Math.round((new Date(String(d).slice(0,10)+'T12:00:00') - new Date(today+'T12:00:00'))/86400000);
  }
  function meta(e){
    return [ (e.guests!=null ? e.guests+' guests' : ''), [e.time_from,e.time_to].filter(Boolean).join('–'), esc(e.area||'') ]
      .filter(Boolean).join(' · ');
  }
  // A briefed event the events desk has not confirmed: labelled, never hidden —
  // strictly === false so an older feed without the field labels nothing.
  function draftTag(e){ return e && e.confirmed === false ? '<span class="fhe-draft">Draft &mdash; not confirmed</span>' : ''; }

  // What the dish IS, with its allergens — the part the floor has to be able to answer a guest on.
  function menuBody(e){
    var rows = Array.isArray(e.menu) ? e.menu : [];
    var h = '';
    if(rows.length){
      var lastG = null;
      rows.forEach(function(m){
        if(m.group && m.group !== lastG){ lastG = m.group; h += '<div class="fhe-grp">'+esc(m.group)+'</div>'; }
        h += '<div class="fhe-dish"><b>'+esc(m.name)+'</b>'
          + (m.sub ? ' <span class="fhe-sub">'+esc(m.sub)+'</span>' : '')
          + (m.comp ? ' <span class="fhe-comp">on the house</span>' : '')
          + (m.unconfirmed ? ' <span class="fhe-tbc">to confirm</span>' : '')
          + (m.allergens && m.allergens.length ? ' <span class="fhe-alg">'+esc(algText(m.allergens))+'</span>' : '')
          + (m.desc ? '<div class="fhe-desc">'+esc(m.desc)+'</div>' : '')
          + '</div>';
      });
      if(e.kind === 'set' && e.set_menu && e.set_menu.name) h += '<div class="fhe-total">'+esc(e.set_menu.name)+'</div>';
    } else {
      h += '<div class="fhe-empty">'+(e.bev_only ? 'Beverage only' : 'No menu listed yet &mdash; check with the events desk')+'</div>';
    }
    if(e.dietary) h += '<div class="fhe-diet"><b>Dietary:</b> '+esc(e.dietary)+'</div>';
    return h;
  }

  function hlTag(){ return '<span class="fhe-hl-tag">&#9733; From the events desk</span>'; }
  function hlMeta(x){ return [ (x.guests!=null ? x.guests+' guests' : ''), esc(x.time_from||'') ].filter(Boolean).join(' · '); }
  function hlNote(x){ return x.note ? '<div class="fhe-hl-note">'+esc(x.note)+'</div>' : ''; }

  function openAttrs(id){
    return ' role="button" tabindex="0" aria-expanded="'+(opened[id]?'true':'false')+'" data-fhe="'+esc(id)+'"';
  }
  function row(e, today){
    var d = dayBadge(e.date), isToday = daysUntil(e.date, today) <= 0, o = !!opened[e.id];
    return '<div class="fhe-wrap'+(o?' open':'')+'">'
      + '<div class="fhe-row'+(isToday?' fhe-today':'')+'"'+openAttrs(e.id)+'>'
      + (isToday
          ? '<div class="fhe-badge fhe-badge-t"><div class="fhe-bd-day">Today</div></div>'
          : '<div class="fhe-badge"><div class="fhe-bd-day">'+d.day+'</div><div class="fhe-bd-mon">'+d.mon+'</div></div>')
      + '<div class="fhe-mid"><div class="fhe-name">'+esc(e.name)+draftTag(e)+'</div><div class="fhe-meta">'+meta(e)+'</div></div>'
      + '<div class="fhe-chev" aria-hidden="true">&#9662;</div></div>'
      + '<div class="fhe-body" id="fhe-b-'+esc(e.id)+'"'+(o?'':' style="display:none"')+'>'+menuBody(e)+'</div></div>';
  }
  function hlRow(x, today){
    var d = dayBadge(x.date), isToday = daysUntil(x.date, today) <= 0;
    return '<div class="fhe-wrap"><div class="fhe-row fhe-hl'+(isToday?' fhe-today':'')+'">'
      + (isToday
          ? '<div class="fhe-badge fhe-badge-t"><div class="fhe-bd-day">Today</div></div>'
          : '<div class="fhe-badge"><div class="fhe-bd-day">'+d.day+'</div><div class="fhe-bd-mon">'+d.mon+'</div></div>')
      + '<div class="fhe-mid"><div class="fhe-name">'+esc(x.title)+' '+hlTag()+'</div><div class="fhe-meta">'+hlMeta(x)+'</div>'+hlNote(x)+'</div>'
      + '</div></div>';
  }

  function css(){
    if(document.getElementById('fhe-css')) return;
    var s = document.createElement('style'); s.id = 'fhe-css';
    s.textContent =
      '#foh-ev-strip{flex-shrink:0;background:#F5F0E8;padding:4px 12px 14px}'
      +'#foh-ev-strip:empty{display:none}'
      +'.fhe-band{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6B1F2A;font-weight:700;margin:2px 2px 8px}'
      +'.fhe-h{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#544418;font-weight:700;margin:10px 2px 6px}'
      +'.fhe-wrap{margin-bottom:6px}'
      +'.fhe-row{display:flex;align-items:center;gap:12px;min-height:56px;box-sizing:border-box;background:#fff;border:1px solid rgba(107,31,42,.12);border-left:4px solid #6B1F2A;border-radius:8px;padding:9px 12px;cursor:pointer;-webkit-tap-highlight-color:transparent}'
      +'.fhe-row:active{background:#EFE6D6}'
      +'.fhe-row:focus-visible{outline:2px solid #6B1F2A;outline-offset:2px}'
      +'.fhe-row.fhe-hl{cursor:default;border-left-color:#C9A227;align-items:flex-start}'
      +'.fhe-row.fhe-hl:active{background:#fff}'
      +'.fhe-wrap.open .fhe-row{border-bottom-left-radius:0;border-bottom-right-radius:0}'
      +'.fhe-badge{width:48px;text-align:center;flex-shrink:0}'
      +'.fhe-bd-day{font-family:"Playfair Display",serif;font-size:21px;color:#6B1F2A;line-height:1}'
      +'.fhe-badge-t .fhe-bd-day{font-family:inherit;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700}'
      +'.fhe-bd-mon{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#4F4535;margin-top:2px}'
      +'.fhe-mid{flex:1;min-width:0}'
      +'.fhe-name{font-size:15px;color:#2C1810;font-weight:600;line-height:1.25;overflow-wrap:anywhere}'
      +'.fhe-meta{font-size:12px;color:#4F4535;margin-top:2px}'
      +'.fhe-chev{font-size:12px;color:#6B1F2A;transition:transform .15s;flex-shrink:0}'
      +'.fhe-wrap.open .fhe-chev{transform:rotate(180deg)}'
      +'.fhe-body{background:#fff;border:1px solid rgba(107,31,42,.12);border-top:none;border-left:4px solid #6B1F2A;border-radius:0 0 8px 8px;padding:4px 14px 12px}'
      +'.fhe-grp{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#544418;font-weight:700;margin:9px 0 3px}'
      +'.fhe-dish{font-size:13.5px;color:#2C1810;padding:4px 0;border-bottom:1px solid rgba(207,192,173,.5)}'
      +'.fhe-dish:last-of-type{border-bottom:none}'
      +'.fhe-dish b{color:#6B1F2A}'
      +'.fhe-sub{font-size:11px;color:#4F4535}'
      +'.fhe-alg{font-size:11px;color:#5C3B1F}'
      +'.fhe-comp{font-size:11px;color:#2F4A1F}'
      +'.fhe-tbc{font-size:11px;color:#5F3604}'
      +'.fhe-desc{font-size:12px;line-height:1.4;color:#4F3524;margin-top:2px}'
      +'.fhe-total{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#544418;font-weight:700;padding-top:8px}'
      +'.fhe-diet{font-size:12.5px;color:#8A1020;margin-top:8px}'
      +'.fhe-empty{font-size:12.5px;color:#4F4535;font-style:italic;padding:6px 0}'
      +'.fhe-draft{display:inline-block;background:#FAEEDA;color:#5F3604;border:1px solid #D9B66A;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:2px 8px;border-radius:20px;margin-left:6px;vertical-align:middle;white-space:nowrap}'
      +'.fhe-hl-tag{display:inline-block;background:#FFF4D6;color:#5A3A00;border:1px solid #C9A227;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:20px;margin-left:4px;vertical-align:middle;white-space:nowrap;font-weight:600}'
      +'.fhe-hl-note{font-size:12px;line-height:1.4;color:#4F3524;margin-top:3px}'
      +'.fhe-more{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;min-height:44px;box-sizing:border-box;background:none;border:0;margin:0;padding:6px 2px;text-align:left;font-family:inherit;font-size:12px;font-style:italic;color:#4F4535;cursor:pointer;-webkit-tap-highlight-color:transparent}'
      +'.fhe-more-act{font-style:normal;font-size:11px;letter-spacing:.08em;text-transform:uppercase;border:1px solid currentColor;border-radius:20px;padding:3px 10px}'
      +'.fhe-err{font-size:12.5px;color:#7A1A10;background:#FBE9E7;border:1px solid #F3C6BF;border-radius:8px;padding:8px 11px}';
    document.head.appendChild(s);
  }

  function render(data){
    var box = document.getElementById('foh-ev-strip'); if(!box) return;
    css();
    var today = data.today, events = data.events || [];
    var hl = Array.isArray(data.highlights) ? data.highlights : [];
    var hlErr = data.highlights === null ? '<div class="fhe-err" style="margin-bottom:8px">Couldn’t check the highlights from the events desk — check the connection.</div>' : '';
    if(!events.length && !hl.length){ box.innerHTML = hlErr; return; }
    var all = events.map(function(e){ return {d:String(e.date).slice(0,10), t:e.time_from||'', e:e}; })
      .concat(hl.map(function(x){ return {d:String(x.date).slice(0,10), t:x.time_from||'', x:x}; }))
      .sort(function(a,b){ return a.d<b.d ? -1 : a.d>b.d ? 1 : (a.t<b.t ? -1 : a.t>b.t ? 1 : 0); });
    var h = '<div class="fhe-band">Events</div>'+hlErr, lastLb = null, shown = 0, hidden = 0, later = '';
    function bucket(n){ return n<=0 ? 'Today' : n<=7 ? 'This week' : 'The week after'; }
    all.forEach(function(r){
      var n = daysUntil(r.d, today), html = r.x ? hlRow(r.x, today) : row(r.e, today);
      if(n > WINDOW_DAYS){ hidden++; later += html; return; }
      var lb = bucket(n);
      if(lb !== lastLb){ lastLb = lb; h += '<div class="fhe-h">'+lb+'</div>'; }
      h += html; shown++;
    });
    if(hidden > 0){
      h += '<button type="button" class="fhe-more" id="fhe-more" aria-expanded="'+laterOpen+'" aria-controls="fhe-later">'
        + (!shown ? 'No events in the next 2 weeks &middot; '+hidden : '+ '+hidden+' more')+' event'+(hidden>1?'s':'')+' beyond 2 weeks'
        + ' <span class="fhe-more-act">'+(laterOpen?'Hide':'Show')+'</span></button>'
        + '<div id="fhe-later"'+(laterOpen?'':' style="display:none"')+'><div class="fhe-h">Later</div>'+later+'</div>';
    }
    box.innerHTML = h;
  }

  function toggle(rowEl){
    var id = rowEl.getAttribute('data-fhe'); if(!id) return;
    var body = document.getElementById('fhe-b-'+id); if(!body) return;
    var open = body.style.display === 'none';
    opened[id] = open;
    body.style.display = open ? '' : 'none';
    rowEl.setAttribute('aria-expanded', String(open));
    rowEl.parentNode.classList.toggle('open', open);
  }
  function toggleLater(btn){
    var b = document.getElementById('fhe-later'); if(!b) return;
    laterOpen = b.style.display === 'none';
    b.style.display = laterOpen ? '' : 'none';
    btn.setAttribute('aria-expanded', String(laterOpen));
    var a = btn.querySelector('.fhe-more-act'); if(a) a.textContent = laterOpen ? 'Hide' : 'Show';
  }

  function wire(){
    var box = document.getElementById('foh-ev-strip');
    if(!box || box._fheWired) return;
    box._fheWired = true;
    box.addEventListener('click', function(ev){
      var more = ev.target.closest && ev.target.closest('#fhe-more');
      if(more){ toggleLater(more); return; }
      var r = ev.target.closest && ev.target.closest('.fhe-row[data-fhe]');
      if(r) toggle(r);
    });
    box.addEventListener('keydown', function(ev){
      if(ev.key !== 'Enter' && ev.key !== ' ') return;
      var r = ev.target.closest && ev.target.closest('.fhe-row[data-fhe]');
      if(r){ ev.preventDefault(); toggle(r); }
    });
  }

  function load(){
    var box = document.getElementById('foh-ev-strip');
    if(!box || loading) return;
    wire();
    loading = true;
    fetch(FEED, { headers:{ 'x-proxy-secret': KITCHEN_PROXY_SECRET } })
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(data){
        if(data && data.error) throw new Error(data.error);
        last = data; render(data);
      })
      .catch(function(err){
        console.warn('[home-events] load failed', err);
        // Keep what was already on screen if a later refresh fails; only a first load says it could not.
        if(!last){ css(); box.innerHTML = '<div class="fhe-err">Couldn’t load upcoming events — check the connection.</div>'; }
      })
      .then(function(){ loading = false; });
  }

  window.fohHomeEventsLoad = load;
  // Home is redrawn by renderFohHome() each time the tab is opened — refresh the list with it.
  if(typeof window.renderFohHome === 'function'){
    var orig = window.renderFohHome;
    window.renderFohHome = function(){ var r = orig.apply(this, arguments); load(); return r; };
  }
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) load(); });
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
