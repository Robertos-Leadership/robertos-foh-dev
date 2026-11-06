/* Roberto's Mare — the page is always the latest (Francesco, 6 Nov 2026).

   Milica was looking at yesterday's menu for hours: the app is a single page that never reloads
   by itself, and a phone keeps it open for days. Now, on every Mare page (the management app,
   and the tablet / phone team app):

   · when the app comes back to the front, and every 3 minutes while it is in front, the page is
     read again from the server and its script list compared with the one this page was built from;
   · if a file has a newer ?v=, the page reloads BY ITSELF, but only when nobody is in the middle
     of something: no window open, no field being typed in or half-filled, no photo picked, the
     camera or microphone not running, and no tap or key for 15 seconds;
   · otherwise a bar says "A newer version of the app is ready" with an Update button, and the page
     reloads the moment it is safe.

   The reload goes to the same address with a ?u= stamp, so the phone cannot hand back its saved
   copy of the old page (GitHub Pages lets a browser keep a page for 10 minutes).
   Two reloads are never closer than 2 minutes, so a copy that cannot update can never loop. */
(function (w) {
  'use strict';
  var d = w.document, M = w.Mare, T = M && M.T ? M.T : function (x) { return x; }, E = M && M.esc ? M.esc : function (x) { return x; };
  var lastCheck = 0, lastTouch = Date.now(), pending = false, barShown = false;

  ['pointerdown', 'keydown', 'touchstart', 'input'].forEach(function (ev) { d.addEventListener(ev, function () { lastTouch = Date.now(); }, true); });

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
  // Nobody in the middle of anything.
  function safe() {
    if (Date.now() - lastTouch < 15000) return false;
    if (d.querySelector('.overlay,.mz,#mi-panel,.scrim.on,dialog[open]')) return false;
    var a = d.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'button') return false;
    var vids = d.querySelectorAll('video'), i;
    for (i = 0; i < vids.length; i++) if (vids[i].srcObject) return false;
    var f = d.querySelectorAll('textarea,input:not([type=button]):not([type=checkbox]):not([type=radio]):not([type=search]):not([type=hidden]):not([type=range])');
    for (i = 0; i < f.length; i++) {
      if (f[i].type === 'file') { if (f[i].files && f[i].files.length) return false; continue; }
      if (f[i].value !== f[i].defaultValue) return false;
    }
    return true;
  }
  function reload() {
    var now = Date.now(), last = 0;
    try { last = +w.sessionStorage.getItem('mare_upd') || 0; } catch (e) {}
    if (now - last < 120000) return false;
    try { w.sessionStorage.setItem('mare_upd', String(now)); } catch (e) {}
    var u = new URL(w.location.href); u.searchParams.set('u', String(now));
    w.location.replace(u.toString());
    return true;
  }
  function bar() {
    if (barShown) return; barShown = true;
    if (!d.getElementById('mi-css')) { var s = d.createElement('style'); s.id = 'mu-css';
      s.textContent = '.mi-bar{position:fixed;left:12px;right:12px;bottom:12px;z-index:880;background:#0E3B3F;color:#fff;border-radius:12px;padding:12px 14px;display:flex;gap:12px;align-items:center;justify-content:space-between;font-weight:600}' +
        '.mi-bar button{all:unset;box-sizing:border-box;cursor:pointer;background:#fff;color:#0E3B3F;border-radius:8px;min-height:44px;padding:0 18px;font-weight:700;display:inline-flex;align-items:center}';
      d.head.appendChild(s); }
    var b = d.createElement('div'); b.className = 'mi-bar'; b.id = 'mi-bar'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>' + E(T('A newer version of the app is ready.')) + '</span><button type="button">' + E(T('Update')) + '</button>';
    d.body.appendChild(b);
    b.querySelector('button').onclick = function () { try { w.sessionStorage.removeItem('mare_upd'); } catch (e) {} reload(); };
  }
  function found() { pending = true; if (safe() && reload()) return; bar(); }
  function check(force) {
    if (d.visibilityState !== 'visible') return;
    if (pending) { if (safe()) reload(); return; }
    var now = Date.now(); if (!force && now - lastCheck < 60000) return; lastCheck = now;
    w.fetch(w.location.pathname, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      var want = stamped(t); if (!want.length) return;           // not the app's page (offline, error): say nothing
      var got = have();
      for (var i = 0; i < want.length; i++) if (!got[want[i]]) { found(); return; }
    }).catch(function () {});
  }
  d.addEventListener('visibilitychange', function () { check(true); });
  w.addEventListener('focus', function () { check(false); });
  w.addEventListener('pageshow', function () { check(true); });
  w.setInterval(function () { check(false); }, 3 * 60 * 1000);
  w.setInterval(function () { if (pending && d.visibilityState === 'visible' && safe()) reload(); }, 15000);
  w.setTimeout(function () { check(true); }, 4000);              // a page opened from a saved copy checks at once

  // The newest ?v= among this page's scripts: written on every activity line, so the Mare admin can see
  // which version a person is looking at (Francesco, 6 Nov 2026).
  function build() {
    var m = '';
    Array.prototype.forEach.call(d.querySelectorAll('script[src*="?v="]'), function (s) { var v = (s.getAttribute('src').split('?v=')[1] || '').split('&')[0]; if (v > m) m = v; });
    return 'v' + m;
  }

  w.MareUpdate = { check: function () { check(true); }, safe: safe, build: build };
})(window);
