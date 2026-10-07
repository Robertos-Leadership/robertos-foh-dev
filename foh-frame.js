// foh-frame.js — the house frame for the modules that did not have one (7 Oct 2026).
//
// Francesco, 7 Oct 2026, after seeing every module side by side: Closing Report is how a module
// should look — the burgundy header card (.ops-hero) and one centred ~980px column (.ops-wrap /
// .rev-wrap). Reservations and Reservation reports ran edge to edge, Guest reviews, Admin and
// Stock take each had their own width, and none of the six had the header card. He approved
// "now vs recommended" for all six and asked for it on DEV and LIVE.
//
// Done here, in ONE place, instead of inside six render functions: several of those files differ
// between the DEV and LIVE repos, and a frame is presentation, not module logic. The modules are
// untouched — their buttons, tables and data render exactly as before; this only puts the header
// card on top and holds everything to the column.
//
// How: #main-content is rewritten by renderMain() (and by a module's own refresh). A
// MutationObserver on it marks the current tab on the element (data-frame) and puts the header
// card back as the first child whenever a rewrite removed it. Cheap: it only looks at direct
// children and does nothing on the tabs that are not listed.
(function(){
  var FRAME = {
    revenue:      { k:'Business',               t:'Revenue',             s:'Daily budget, covers, spend and the month review.' },
    stocktake:    { k:'Stock',                  t:'Stock Take',          s:'The monthly count by section: food & drink, and equipment.' },
    reviews:      { k:'Guests',                 t:'Guest Reviews',       s:'Our Google rating, what guests write, and how DIFC compares.' },
    reservations: { k:'SevenRooms · Live',      t:'Reservations',        s:'Tonight’s book and the next 7 days, straight from SevenRooms.' },
    resreports:   { k:'Reservations · Reports', t:'Reservation Reports', s:'Pick a report and the dates, then read it here or download the Excel.' },
    bizlunch:     { k:'Lunch · set menu',       t:'Business Lunch',      s:'Menus sold, what guests chose and spend — straight from the checks.' },
    admin:        { k:'Both apps',              t:'Admin',               s:'People, usage, feedback, emails and settings.' }
  };

  var css = document.createElement('style');
  css.id = 'foh-frame-css';
  css.textContent =
    // the column every framed module sits in — the same as .ops-wrap / .rev-wrap
    '#main-content[data-frame]>*{max-width:980px;margin-left:auto;margin-right:auto}' +
    '#main-content[data-frame] .res-wrap,#main-content[data-frame] .gr-wrap{padding:8px 4px 60px}' +
    '#main-content[data-frame]>.ops-hero.foh-frame-hero{margin-top:8px;margin-bottom:16px}' +
    // the header card already says what these headings said
    '#main-content[data-frame=reservations] .res-kicker{display:none}' +
    '#main-content[data-frame=resreports] .res-head-l{display:none}' +
    '#main-content[data-frame=resreports] .res-head{justify-content:flex-end}' +
    '#main-content[data-frame=bizlunch] .res-head-l{display:none}' +
    '#main-content[data-frame=bizlunch] .res-head{justify-content:flex-end}' +
    '#main-content[data-frame=admin] .adm-head h2{display:none}' +
    '#main-content[data-frame=admin] .adm-head{justify-content:flex-end}';
  document.head.appendChild(css);

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function tab(){ return (typeof state === 'object' && state && state.currentTab) || ''; }

  function frame(){
    var mc = document.getElementById('main-content');
    if(!mc) return;
    var f = FRAME[tab()];
    if(!f){ if(mc.hasAttribute('data-frame')) mc.removeAttribute('data-frame'); return; }
    if(mc.getAttribute('data-frame') !== tab()) mc.setAttribute('data-frame', tab());
    var first = mc.firstElementChild;
    // an old card from another framed tab is replaced, never stacked
    if(first && first.classList.contains('foh-frame-hero')){
      if(first.getAttribute('data-for') === tab()) return;
      first.remove();
    }
    // nothing rendered yet ("Loading…" included): the card waits for the module
    if(!mc.firstElementChild) return;
    var h = document.createElement('div');
    h.className = 'ops-hero foh-frame-hero';
    h.setAttribute('data-for', tab());
    h.innerHTML = '<div class="ops-hero-k">' + esc(f.k) + '</div><div class="ops-hero-t">' + esc(f.t) + '</div><div class="ops-hero-s">' + esc(f.s) + '</div>';
    mc.insertBefore(h, mc.firstChild);
  }

  function start(){
    var mc = document.getElementById('main-content');
    if(!mc) return;
    new MutationObserver(frame).observe(mc, { childList:true });
    frame();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
