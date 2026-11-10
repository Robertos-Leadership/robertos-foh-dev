/* FOH "How we work" (10 Nov 2026): the SOPs and policies — the door. The section itself is sop.html (Employee ID,
   or a manager's app login; everything that decides is in the `sop` edge function). This file only opens it full
   screen from the "How we work" tile, next to Learning. Loaded after foh-core.js. */
(function(){
  var wrap = null;
  window.fohSopOpen = function(){
    if(wrap){ wrap.remove(); wrap = null; }
    wrap = document.createElement('div');
    wrap.id = 'sop-view';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9500;background:#2b0104;display:flex;flex-direction:column';
    wrap.innerHTML =
      '<div style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 14px;background:#6B1F2A;border-bottom:2px solid #C9A84C;color:#F8F4EC">'
      + '<div style="font-family:\'Playfair Display\',serif;font-size:15px">SOPs &amp; policies</div>'
      + '<button id="sop-close" style="background:none;border:1px solid #C9A84C;color:#C9A84C;font-size:12px;letter-spacing:.06em;padding:6px 12px;cursor:pointer">Close</button></div>'
      + '<iframe title="SOPs and policies" src="sop.html?embed=1&v=20261110d" style="flex:1 1 auto;width:100%;border:0;background:#ede5d8"></iframe>';
    document.body.appendChild(wrap);
    document.getElementById('sop-close').onclick = function(){ wrap.remove(); wrap = null; };
  };
})();
