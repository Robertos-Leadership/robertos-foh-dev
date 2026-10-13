/* Roberto's Mare — keep the app on the phone or the laptop, like the Dubai app.

   Two small jobs, both outside the modules:

   1. INSTALL. A button ("Put the app on this phone / laptop") in the top left corner of
      the sign-in screen, at the top of the side menu, and ("Install") in the phone's top
      bar: always where a phone shows it without scrolling (Francesco, 13 Oct 2026). Where the browser can install by itself (Chrome, Edge, Android) one
      tap does it. Where it cannot (iPhone, Safari) a panel shows the two taps to make, and
      the address of the app with a Copy button, so nobody has to dig the link out of an
      old email. Inside the installed app the button is not shown at all.

   2. NEW VERSION. An installed app usually wakes up with the page it had yesterday. When
      the app comes back to the front we read mare.html again and compare its script list
      with the one this page was built from. If a file has a newer ?v= we show a bar with
      an Update button. It never reloads by itself: somebody may be half-way through
      writing a briefing. */
(function (w) {
  'use strict';
  var d = w.document, M = w.Mare, T = M.T, E = M.esc;
  var deferred = null;

  function standalone() {
    try { return (w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) || w.navigator.standalone === true; }
    catch (e) { return false; }
  }
  // Identify the device by what it is, not by one browser name.
  function device() {
    var ua = w.navigator.userAgent || '';
    var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && w.navigator.maxTouchPoints > 1);
    if (ios) return 'ios';
    if (/Android/.test(ua)) return 'android';
    var chromium = /Chrome\/|Edg\//.test(ua);
    if (/Macintosh/.test(ua) && !chromium && /Safari\//.test(ua)) return 'macsafari';
    if (chromium) return 'chromium';
    return 'other';
  }
  function phone() { var k = device(); return k === 'ios' || k === 'android'; }
  function address() { return (w.location.origin + w.location.pathname).replace(/\.html$/, ''); }

  function css() {
    if (d.getElementById('mi-css')) return;
    var s = d.createElement('style'); s.id = 'mi-css';
    s.textContent =
      '.mi-btn{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:48px;padding:10px 16px;border-radius:8px;font-weight:700;font-size:16px;text-align:center}' +
      '.mi-btn.light{background:#fff;color:#0E3B3F;border:1px solid #0E4A50}' +
      '.mi-btn.dark{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.55);font-size:14px;min-height:44px}' +
      '.mi-btn.top{width:auto;max-width:230px;min-height:44px;padding:8px 14px;line-height:1.25;background:rgba(8,30,33,.55)}' +
      '.mi-btn.short{width:auto;margin-left:auto;min-height:44px;padding:6px 10px;font-size:13px;white-space:nowrap}' +
      '.mi-btn:focus-visible{outline:3px solid #A8834B;outline-offset:2px}' +
      '.mi-scrim{position:fixed;inset:0;background:rgba(8,30,33,.72);z-index:900;display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.mi-card{background:#fff;color:#1B2426;border-radius:14px;max-width:440px;width:100%;max-height:90vh;overflow:auto;padding:22px 20px 18px;box-shadow:0 24px 60px -20px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:14px;font-size:17px;line-height:1.45}' +
      '.mi-card h2{margin:0;font-size:24px;color:#0E3B3F}' +
      '.mi-card ol{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:8px}' +
      '.mi-card b{color:#0E3B3F}' +
      '.mi-addr{display:flex;gap:8px;align-items:stretch}' +
      '.mi-addr input{flex:1;min-width:0;font:inherit;font-size:15px;color:#1B2426;background:#EEF3F2;border:1px solid #9FB3B1;border-radius:8px;padding:10px 12px}' +
      '.mi-addr button,.mi-close{all:unset;box-sizing:border-box;cursor:pointer;min-height:44px;padding:0 16px;border-radius:8px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}' +
      '.mi-addr button{background:#0E4A50;color:#fff}' +
      '.mi-close{background:#fff;color:#0E3B3F;border:1px solid #0E4A50;align-self:flex-end}' +
      '.mi-small{font-size:15px;color:#3A4648}' +
      '.mi-bar{position:fixed;left:12px;right:12px;bottom:12px;z-index:880;background:#0E3B3F;color:#fff;border-radius:12px;padding:12px 14px;display:flex;gap:12px;align-items:center;justify-content:space-between;font-weight:700;font-size:16px;box-shadow:0 14px 30px -12px rgba(0,0,0,.6);max-width:560px;margin:0 auto}' +
      '.mi-bar button{all:unset;box-sizing:border-box;cursor:pointer;background:#fff;color:#0E3B3F;border-radius:8px;min-height:44px;padding:0 18px;font-weight:700;display:inline-flex;align-items:center}';
    d.head.appendChild(s);
  }

  function label() { return phone() ? T('Put the app on this phone') : T('Put the app on this laptop'); }

  // The button, always at the top left where a phone shows it without scrolling:
  // 'top' = full wording (sign-in corner, top of the side menu); 'short' = the phone's top bar.
  function html(kind) {
    if (standalone()) return '';
    css();
    return '<button type="button" class="mi-btn dark ' + (kind === 'short' ? 'short' : 'top') + '" data-install="1">' + E(kind === 'short' ? T('Install') : label()) + '</button>';
  }

  function steps() {
    var k = device();
    if (k === 'ios') return [T('Tap the Share button (the square with the arrow).'), T('Choose "Add to Home Screen", then "Add".')];
    if (k === 'android') return [T('Tap the three dots at the top right.'), T('Choose "Add to Home screen" or "Install app".')];
    if (k === 'macsafari') return [T('Open the File menu at the top of the screen.'), T('Choose "Add to Dock".')];
    if (k === 'chromium') return [T('Look at the end of the address bar for the small screen with an arrow, and press it.'), T('If it is not there: the three dots, then "Cast, save and share", then "Install page as app".')];
    return [T('Open this address in Chrome, Edge or Safari.'), T('Then press this button again.')];
  }

  function panel() {
    css();
    var old = d.getElementById('mi-panel'); if (old) old.remove();
    var s = d.createElement('div'); s.className = 'mi-scrim'; s.id = 'mi-panel';
    s.innerHTML = '<div class="mi-card" role="dialog" aria-modal="true" aria-labelledby="mi-h">' +
      '<h2 class="serif" id="mi-h">' + E(label()) + '</h2>' +
      '<ol>' + steps().map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ol>' +
      '<div class="mi-small">' + E(T('The app then has its own icon. You sign in once on each device.')) + '</div>' +
      '<div><b>' + E(T('The address of the app')) + '</b><div class="mi-addr" style="margin-top:6px"><input id="mi-url" readonly value="' + E(address()) + '" aria-label="' + E(T('The address of the app')) + '">' +
      '<button type="button" id="mi-copy">' + E(T('Copy')) + '</button></div>' +
      '<div class="mi-small" style="margin-top:6px">' + E(T('It is the same on the phone and on the laptop.')) + '</div></div>' +
      '<button type="button" class="mi-close" id="mi-x">' + E(T('Close')) + '</button></div>';
    d.body.appendChild(s);
    function close() { s.remove(); }
    s.addEventListener('click', function (ev) { if (ev.target === s) close(); });
    d.getElementById('mi-x').onclick = close;
    d.getElementById('mi-copy').onclick = function () {
      var b = this, inp = d.getElementById('mi-url');
      function ok() { b.textContent = T('Copied'); }
      function old() { try { inp.focus(); inp.select(); d.execCommand('copy'); ok(); } catch (e) {} }
      if (w.navigator.clipboard && w.navigator.clipboard.writeText) w.navigator.clipboard.writeText(inp.value).then(ok, old); else old();
    };
    d.getElementById('mi-x').focus();
  }

  function refresh() {
    var gone = standalone();
    Array.prototype.forEach.call(d.querySelectorAll('[data-install]'), function (b) { b.hidden = gone; if (gone) b.style.display = 'none'; });
  }

  w.addEventListener('beforeinstallprompt', function (ev) { ev.preventDefault(); deferred = ev; });
  w.addEventListener('appinstalled', function () {
    deferred = null;
    var p = d.getElementById('mi-panel'); if (p) p.remove();
    Array.prototype.forEach.call(d.querySelectorAll('[data-install]'), function (b) { b.style.display = 'none'; });
  });
  d.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-install]') : null;
    if (!b) return;
    ev.preventDefault();
    d.body.classList.remove('menu-open');
    if (deferred) {
      var p = deferred; deferred = null;
      p.prompt();
      if (p.userChoice && p.userChoice.then) p.userChoice.then(function (c) { if (!c || c.outcome !== 'accepted') panel(); }, function () {});
      return;
    }
    panel();
  });

  // ── a newer version is ready ──
  var lastCheck = 0, barShown = false;
  function stamped(text) {
    var out = [], re = /<script[^>]*\ssrc="([^"]*\?v=[^"]*)"/g, m;
    while ((m = re.exec(text))) out.push(m[1]);
    return out;
  }
  function have() {
    var o = {};
    Array.prototype.forEach.call(d.querySelectorAll('script[src]'), function (s) { o[s.getAttribute('src')] = 1; });
    return o;
  }
  function bar() {
    if (barShown) return; barShown = true; css();
    var b = d.createElement('div'); b.className = 'mi-bar'; b.id = 'mi-bar'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>' + E(T('A newer version of the app is ready.')) + '</span><button type="button">' + E(T('Update')) + '</button>';
    d.body.appendChild(b);
    b.querySelector('button').onclick = function () { w.location.reload(); };
  }
  function check() {
    if (barShown || d.visibilityState !== 'visible') return;
    var now = Date.now(); if (now - lastCheck < 5 * 60 * 1000) return; lastCheck = now;
    w.fetch(w.location.pathname, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      var want = stamped(t); if (!want.length) return;         // not the app's page (offline page, error): say nothing
      var got = have();
      for (var i = 0; i < want.length; i++) if (!got[want[i]]) { bar(); return; }
    }).catch(function () {});
  }
  lastCheck = Date.now();                                        // the page has just loaded: nothing to compare yet
  d.addEventListener('visibilitychange', check);
  w.addEventListener('focus', check);

  w.MareInstall = { html: html, open: panel, refresh: refresh, standalone: standalone, check: function () { lastCheck = 0; check(); } };
})(window);
