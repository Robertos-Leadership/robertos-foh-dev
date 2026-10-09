/* Roberto's Mare — the TEAM app logic (mare-clock.html): tablet kiosk + staff phone. */
(function () {
  var M = window.Mare, T = M.T, E = M.esc;
  var LS_DEV = 'mare_device', LS_Q = 'mare_queue', LS_BOARD = 'mare_board', LS_FEED = 'mare_feed';
  var params = new URLSearchParams(location.search), meToken = params.get('me');
  // ── View as (opened from the Mare app → View as): a manager sees this screen
  // exactly as one person (?viewas=<staff id>) or as the tablet (?viewas=tablet).
  // Read-only: every action is stopped before it reaches the database.
  var VIEWAS = params.get('viewas'), PREVIEW = !!VIEWAS, PV_TOKEN = null, PV_BACK = 'mare.html#viewas';
  if (PREVIEW) {
    try { PV_TOKEN = sessionStorage.getItem('mare_viewas_token'); PV_BACK = sessionStorage.getItem('mare_viewas_back') || PV_BACK; } catch (e) {}
    if (VIEWAS !== 'tablet') meToken = '__preview__';   // the phone layout, for that person
  }
  var main = document.getElementById('main');
  var S = { screen: '', board: [], feed: null, who: null, pin: '', pin1: null, msg: '', msgErr: false, online: navigator.onLine,
            cam: null, camOk: false, resetT: null, id: null, mod: null, sub: null, dubai: null };
  // S.id = the person doing module actions on the tablet: {staff, name, pin, until}. Kept 2 minutes.
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function queue() { try { return JSON.parse(ls(LS_Q) || '[]'); } catch (e) { return []; } }
  function setQueue(q) { ls(LS_Q, JSON.stringify(q)); }
  function on(sel, fn, ev) { main.querySelectorAll(sel).forEach(function (b) { b.addEventListener(ev || 'click', function (e) { fn(b, e); }); }); }
  function idle(ms) { clearTimeout(S.resetT); if (!meToken) S.resetT = setTimeout(home, ms); }
  function dev() { return meToken ? null : ls(LS_DEV); }
  function pinArg() { return meToken ? S.mePin : null; }
  function ident() { return meToken ? { staff: null, pin: S.mePin, name: S.meName } : (S.id && S.id.until > Date.now() ? S.id : null); }

  // ── header: clock + language ──
  function tick() { var n = new Date(); document.getElementById('clk').textContent = M.hhmm(n); document.getElementById('clkd').textContent = M.niceDate(M.dateKey(n)); }
  tick(); setInterval(tick, 1000);
  function paintLang() { document.getElementById('lng').innerHTML = M.langSwitch(); document.documentElement.lang = M.lang() === 'me' ? 'sr-Latn-ME' : 'en'; document.getElementById('ttl2').textContent = meToken ? T('My Mare') : T('Team · Porto Montenegro'); tick(); }
  paintLang();
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-lang]'); if (!b) return; M.setLang(b.getAttribute('data-lang')); paintLang(); redraw(); });
  function redraw() {
    if (S.screen === 'mod' && S.mod) openMod(S.mod, S.sub);
    else if (S.screen === 'home') home();
    else if (S.screen === 'pin') pinScreen();
    else if (S.screen === 'setup') setup();
    else if (S.screen === 'mepin') phonePin();
  }

  function wake() { try { if (navigator.wakeLock && !meToken) navigator.wakeLock.request('screen').then(function () {}, function () {}); } catch (e) {} }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') wake(); });

  // ════════════════ START (called at the very end, once every list below exists) ════════════════
  function previewFail() {
    main.innerHTML = '<div class="card stack"><h1 class="serif">' + E(T('View as')) + '</h1><p class="big">' + E(T('Open View as from the Mare app (signed in) to see this screen as someone else.')) + '</p>' +
      '<a class="btn" style="align-self:flex-start;text-decoration:none" href="mare.html#viewas">' + E(T('Open the Mare app')) + '</a></div>';
  }
  function previewStart() {
    var who = VIEWAS === 'tablet' ? T('the staff tablet') : '…';
    var bar = document.createElement('div'); bar.id = 'pvbar';
    bar.style.cssText = 'position:sticky;top:0;z-index:80;background:#1E2A2C;color:#fff;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 16px;padding:10px 16px;font-weight:700;font-size:15px';
    document.body.insertBefore(bar, document.body.firstChild);
    function paintBar() {
      var n = VIEWAS === 'tablet' ? T('the staff tablet') : (S.meName ? S.meName + (S.meData && S.meData.team ? ' · ' + T(S.meData.team) : '') : who);
      bar.innerHTML = '<span>' + M.icon('people', 18) + ' ' + E(T('Viewing as {n} — read only', { n: n })) + '</span>' +
        '<a href="' + E(PV_BACK) + '" style="color:#1E2A2C;background:#fff;border-radius:999px;padding:6px 14px;text-decoration:none">' + E(T('Switch back')) + '</a>';
    }
    paintBar(); document.addEventListener('click', function (e) { if (e.target.closest('[data-lang]')) setTimeout(paintBar, 0); });
    if (!PV_TOKEN) { previewFail(); return; }
    if (VIEWAS === 'tablet') { document.body.classList.add('kiosk'); S.screen = 'home'; refresh().then(function () { if (!S.feed) previewFail(); else home(); }); }
    else { document.body.classList.add('phone', 'pvphone'); phoneLoad().then(paintBar); }
  }
  function start() {
  if (PREVIEW) { previewStart(); return; }
  if (meToken) { document.body.classList.add('phone'); phoneStart(); }
  else {
    document.body.classList.add('kiosk'); wake();
    window.addEventListener('online', function () { S.online = true; flush(); foot(); });
    window.addEventListener('offline', function () { S.online = false; foot(); });
    // mare-clock.html?tablet=CODE connects the tablet in one tap (a test link); the code then leaves the address bar.
    var tabletCode = params.get('tablet');
    if (tabletCode) history.replaceState(null, '', location.pathname);
    if (!ls(LS_DEV) && tabletCode) { setup(); document.getElementById('code').value = tabletCode; document.getElementById('go').click(); }
    else if (!ls(LS_DEV)) setup(); else { loadCache(); home(); refresh(); startCamera(); }
    setInterval(function () { if (S.screen === 'home') refresh(); }, 60000);
    setInterval(flush, 20000);
    flush();
  }
  }

  function setup(err) {
    S.screen = 'setup';
    main.innerHTML = '<div class="setup"><h1 class="serif">' + E(T('SET UP THIS TABLET')) + '</h1>' +
      '<p class="muted big" style="margin:0">' + E(T('Type the tablet code from the management app (Tablet). You only do this once.')) + '</p>' +
      '<label class="f" for="code">' + E(T('Tablet code')) + '<input id="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12"></label>' +
      '<div class="msg err">' + E(err || '') + '</div><button class="btn" id="go">' + E(T('Connect this tablet')) + '</button></div>';
    document.getElementById('go').onclick = function () {
      var c = document.getElementById('code').value.trim().toUpperCase().replace(/\s+/g, '');
      if (c.length < 6) { setup(T('Type the whole code.')); return; }
      this.disabled = true;
      M.rpc('mare_kiosk_board', { p_device: c }).then(function (r) {
        if (r.error) { setup(r.error.network ? T('No internet. Connect the tablet to Wi-Fi and try again.') : T('Something went wrong. Try again.')); return; }
        if (!r.data.ok) { setup(T('That code is not right, or it was switched off.')); return; }
        ls(LS_DEV, c); S.board = r.data.staff; ls(LS_BOARD, JSON.stringify(S.board)); home(); refresh(); startCamera();
      });
    };
  }
  function loadCache() { try { S.board = JSON.parse(ls(LS_BOARD) || '[]'); S.feed = JSON.parse(ls(LS_FEED) || 'null'); } catch (e) { S.board = []; } }

  function refresh() {
    if (PREVIEW) return M.rpc('mare_m_view_as', { p_staff: null }, PV_TOKEN).then(function (r) {
      if (r.data && r.data.ok) { S.feed = r.data; S.board = r.data.board; if (S.screen === 'home') home(); } });
    var d = ls(LS_DEV); if (!d) return Promise.resolve();
    return Promise.all([M.rpc('mare_kiosk_board', { p_device: d }), M.rpc('mare_s_feed', { p_device: d, p_token: null, p_pin: null })]).then(function (r) {
      if (r[0].error) { if (r[0].error.network) { S.online = false; foot(); } return; }
      S.online = true;
      if (!r[0].data.ok) { ls(LS_DEV, null); setup(T('This tablet was switched off. Type a new tablet code.')); return; }
      var keep = {}; S.board.forEach(function (p) { if (p.lastAt) keep[p.id] = p.lastAt; });
      S.board = r[0].data.staff; S.board.forEach(function (p) { if (keep[p.id]) p.lastAt = keep[p.id]; });
      queue().forEach(function (q) { var p = S.board.filter(function (b) { return b.id === q.staff; })[0]; if (p && q.guessDir) { p.in = q.guessDir === 'in'; p.since = p.in ? q.at : null; } });
      ls(LS_BOARD, JSON.stringify(S.board));
      if (r[1].data && r[1].data.ok) { S.feed = r[1].data; ls(LS_FEED, JSON.stringify(S.feed)); }
      if (S.screen === 'home') home();
    });
  }

  // ════════════════ HOME ════════════════
  // "Tell us" asks this which screen the message is about.
  window.__mareScreen = function () {
    var m = S.mod && MODS.filter(function (x) { return x[0] === S.mod; })[0];
    return (meToken ? 'Mare phone' : 'Mare tablet') + ' · ' + (m ? m[2] : S.screen === 'home' || !S.screen ? 'Home' : S.screen);
  };
  var MODS = [
    ['brief', 'brief', 'Today\'s briefing'], ['check', 'check', 'Checklists'], ['rota', 'rota', 'Schedule'], ['recipes', 'recipe', 'Recipes'],
    ['kclose', 'closing', 'Closing report'], ['breakage', 'breakage', 'Breakage'], ['leave', 'leave', 'Ask for leave'], ['speak', 'speak', 'Speak up']
  ];
  function teamMods() {
    var tm = S.feed && S.feed.team_modules; if (!tm) return MODS;
    var allow = {};
    if (S.meData && S.meData.team) (tm[S.meData.team] || []).forEach(function (k) { allow[k] = 1; });
    else Object.keys(tm).forEach(function (t) { (tm[t] || []).forEach(function (k) { allow[k] = 1; }); });   // the tablet: every team's
    return MODS.filter(function (m) { return allow[m[0]]; });
  }
  function modStat(k) {
    var f = S.feed; if (!f) return ['', false];
    if (k === 'brief') return f.briefing ? [T('{n} read', { n: f.reads.length }), false] : [T('Not written yet'), false];
    if (k === 'check') { var open = f.check_items.filter(function (i) { return /^open/.test(i.list); }), done = f.ticks.filter(function (t) { return open.some(function (i) { return i.id === t.item_id; }); }).length; return [T('Opening {a}/{b}', { a: done, b: open.length }), open.length > 0 && done < open.length]; }
    if (k === 'rota') { var n = f.shifts.filter(function (s) { return s.date === f.today && s.kind === 'work'; }).length; return [T('{n} on today', { n: n }), false]; }
    if (k === 'recipes') return [T('Mare + Dubai'), false];
    if (k === 'kclose') return [T('Send it at the end of service'), false];
    return ['', false];
  }
  function home() {
    S.mod = null; S.sub = null; S.who = null; S.pin = ''; S.pin1 = null; S.msg = ''; S.msgErr = false; clearTimeout(S.resetT);
    S.id = null;   // whoever was using a module is forgotten the moment the tablet goes home
    if (meToken) return phoneHome();
    S.screen = 'home';
    var inN = S.board.filter(function (p) { return p.in; }).length;
    var h = '<div class="mods">' + teamMods().map(function (m) { var s = modStat(m[0]);
      return '<button class="mod" data-mod="' + m[0] + '"><span class="ic">' + M.icon(m[1], 24) + '</span><b>' + E(T(m[2])) + '</b><span class="s' + (s[1] ? ' alert' : '') + '">' + E(s[0]) + '</span></button>'; }).join('') + '</div>';
    h += '<div class="row" style="justify-content:space-between;align-items:baseline"><h1 class="serif">' + E(T('CLOCK IN · TAP YOUR NAME')) + '</h1><div class="muted big">' + E(T('{n} in now', { n: inN })) + '</div></div><div class="groups">';
    ['Kitchen', 'Service', 'Bar', 'Other'].forEach(function (t) {
      var ppl = S.board.filter(function (p) { return p.team === t; }); if (!ppl.length) return;
      h += '<section class="group"><h2>' + E(T(t).toUpperCase()) + '</h2><div class="names">' + ppl.map(function (p) {
        var pill = !p.has_pin ? '<span class="pill new">' + E(T('NEW · SET CODE')) + '</span>' : p.in ? '<span class="pill in">' + E(T('IN')) + ' · ' + M.hhmm(p.since) + '</span>' : '<span class="pill out">' + E(T('NOT IN')) + '</span>';
        return '<button class="name" data-id="' + E(p.id) + '"><span>' + E(p.name) + '</span>' + pill + '</button>';
      }).join('') + '</div></section>';
    });
    if (!S.board.length) h += '<div class="card muted big" style="grid-column:1/-1">' + E(T('No names yet. The manager adds the team in the management app (People).')) + '</div>';
    main.innerHTML = h + '</div><div class="foot" id="foot"></div>';
    on('.name', function (b) { if (PREVIEW) { M.toast(T('Read only: you are viewing as someone else. Nothing is saved.')); return; } var id = b.getAttribute('data-id'); S.who = S.board.filter(function (p) { return p.id === id; })[0]; pinScreen(); });
    on('[data-mod]', function (b) { openMod(b.getAttribute('data-mod')); });
    foot();
  }
  function foot() {
    var f = document.getElementById('foot'); if (!f) return;
    if (PREVIEW) { f.innerHTML = '<span>' + E(T('Read only: you are viewing as someone else. Nothing is saved.')) + '</span>'; return; }
    var q = queue().length;
    f.innerHTML = '<span><span class="dot' + (S.online ? '' : ' off') + '"></span>' + E(S.online ? T('Online') : T('Offline. Clock-ins are saved on this tablet')) + '</span>' +
      (q ? '<span style="color:var(--amber);font-weight:700">' + E(T('{n} waiting to send', { n: q })) + '</span>' : '') +
      '<span id="camhint">' + E(S.camOk ? T('A photo is taken at every clock-in') : T('Camera is off: tap here to allow it')) + '</span>';
    if (!S.camOk) f.querySelector('#camhint').onclick = startCamera;
  }

  // ════════════════ CLOCK-IN ════════════════
  function startCamera() {
    if (S.cam || meToken || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { foot(); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then(function (st) { S.cam = st; S.camOk = true; foot(); attachVideo(); }, function () { S.camOk = false; foot(); });
  }
  function attachVideo() { var v = document.getElementById('vid'); if (!v || !S.cam) return; v.srcObject = S.cam; v.play().catch(function () {}); }
  function snap() {
    try {
      var v = document.getElementById('vid'); if (!v || !S.camOk || !v.videoWidth) return null;
      var c = document.getElementById('snap'), x = c.getContext('2d'), vw = v.videoWidth, vh = v.videoHeight, r = 240 / 180, sw = vw, sh = vw / r;
      if (sh > vh) { sh = vh; sw = vh * r; }
      x.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, 240, 180);
      return c.toDataURL('image/jpeg', 0.6);
    } catch (e) { return null; }
  }
  function pinScreen() {
    S.screen = 'pin';
    var p = S.who, setting = !p.has_pin;
    var act = setting ? (S.pin1 ? T('TYPE IT AGAIN') : T('CHOOSE YOUR CODE')) : (p.in ? T('CLOCKING OUT') : T('CLOCKING IN'));
    var lbl = setting ? (S.pin1 ? T('Type the same 4 digits again') : T('Choose a 4-digit code. Keep it to yourself.')) : T('Your 4-digit code');
    main.innerHTML = '<div class="pinwrap"><div class="who"><button class="back" id="back">' + M.icon('back', 20) + E(T('Not me')) + '</button>' +
      '<div><div class="act">' + E(act) + '</div><div class="nm serif">' + E(p.name) + '</div></div>' +
      '<div class="cam">' + (S.camOk ? '<video id="vid" autoplay playsinline muted></video>' : E(T('Camera off. Your clock-in still counts.'))) + '</div></div>' +
      '<div class="pad"><div class="lbl">' + E(lbl) + '</div><div class="dots" id="dots"></div><div class="msg ' + (S.msgErr ? 'err' : '') + '" id="msg">' + E(S.msg) + '</div><div class="keys" id="keys"></div></div></div>';
    document.getElementById('back').onclick = home;
    attachVideo(); drawKeys(pinDone); idle(45000);
  }
  function drawKeys(onFour) {
    var dots = document.getElementById('dots');
    function paint() { dots.innerHTML = [0, 1, 2, 3].map(function (i) { return '<span class="' + (i < S.pin.length ? 'on' : '') + '"></span>'; }).join(''); }
    paint();
    var k = document.getElementById('keys'), keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '<'];
    k.innerHTML = keys.map(function (c) {
      if (c === 'C') return '<button class="small" data-k="C" aria-label="' + E(T('Clear')) + '">' + E(T('Clear')) + '</button>';
      if (c === '<') return '<button class="small" data-k="<" aria-label="' + E(T('Delete last digit')) + '">' + E(T('Delete')) + '</button>';
      return '<button data-k="' + c + '">' + c + '</button>';
    }).join('');
    k.onclick = function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var c = b.getAttribute('data-k');
      if (c === 'C') S.pin = ''; else if (c === '<') S.pin = S.pin.slice(0, -1); else if (S.pin.length < 4) S.pin += c;
      paint();
      if (S.pin.length === 4) { k.onclick = null; setTimeout(onFour, 120); }
    };
  }
  function pinDone() {
    var p = S.who;
    if (!p.has_pin) {
      if (!S.pin1) { S.pin1 = S.pin; S.pin = ''; S.msg = ''; S.msgErr = false; pinScreen(); return; }
      if (S.pin1 !== S.pin) { S.pin1 = null; S.pin = ''; S.msg = T('The two codes were different. Start again.'); S.msgErr = true; pinScreen(); return; }
      var photo = snap(), chosen = S.pin;
      M.rpc('mare_kiosk_set_pin', { p_device: ls(LS_DEV), p_staff: p.id, p_pin: chosen }).then(function (r) {
        if (r.error) { S.pin1 = null; S.pin = ''; S.msg = r.error.network ? T('No internet. Setting a code needs the internet. Try again in a moment.') : T('Something went wrong. Try again.'); S.msgErr = true; pinScreen(); return; }
        if (!r.data.ok && r.data.error !== 'already_set') { S.pin1 = null; S.pin = ''; S.msg = T('Something went wrong. Try again.'); S.msgErr = true; pinScreen(); return; }
        p.has_pin = true; S.pin = chosen; S.pin1 = null; sendPunch(photo);
      });
      return;
    }
    sendPunch(snap());
  }
  function uid() { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  // The database refuses a second punch within 2 minutes (a double tap, not a clock-out). Check it here too.
  function lastAt(p) { return p.lastAt || (p.since ? new Date(p.since).getTime() : 0); }
  function sendPunch(photo) {
    var p = S.who, d = ls(LS_DEV);
    if (lastAt(p) && Date.now() - lastAt(p) < 120000) { S.pin = ''; doneScreen({ dir: p.in ? 'in' : 'out', at: new Date(lastAt(p)).toISOString(), name: p.name, already: true }); return; }
    var item = { client_id: uid(), staff: p.id, name: p.name, pin: S.pin, photo: photo, at: new Date().toISOString(), guessDir: p.in ? 'out' : 'in' };
    M.rpc('mare_kiosk_punch', { p_device: d, p_staff: p.id, p_pin: S.pin, p_photo: photo, p_client_id: item.client_id, p_client_at: item.at }).then(function (r) {
      if (r.error && r.error.network) {
        var q = queue(); q.push(item); setQueue(q);
        p.in = item.guessDir === 'in'; p.since = p.in ? item.at : null; p.lastAt = Date.now(); ls(LS_BOARD, JSON.stringify(S.board));
        S.online = false; doneScreen({ dir: item.guessDir, at: item.at, name: p.name, queued: true }); return;
      }
      if (r.error) { S.pin = ''; S.msg = T('Something went wrong. Try again.'); S.msgErr = true; pinScreen(); return; }
      var x = r.data;
      if (!x.ok) {
        S.pin = '';
        if (x.error === 'wrong_pin') { S.msg = T('Wrong code. Try again.'); S.msgErr = true; pinScreen(); return; }
        if (x.error === 'locked') { S.msg = T('Too many wrong codes. Ask the manager to reset your code.'); S.msgErr = true; pinScreen(); return; }
        if (x.error === 'just_punched') { doneScreen({ dir: x.dir, at: x.at, name: x.name, already: true }); return; }
        if (x.error === 'device') { ls(LS_DEV, null); setup(T('This tablet was switched off. Type a new tablet code.')); return; }
        S.msg = T('Something went wrong. Try again.'); S.msgErr = true; pinScreen(); return;
      }
      S.lastPin = { staff: p.id, name: p.name, pin: S.pin };
      p.in = x.dir === 'in'; p.since = p.in ? x.at : null; p.lastAt = new Date(x.at).getTime(); ls(LS_BOARD, JSON.stringify(S.board));
      S.online = true; doneScreen(x); refresh();
    });
  }
  function doneScreen(d) {
    S.screen = 'done'; S.msg = ''; S.msgErr = false;
    var line, sub;
    if (d.already) { line = T('Already clocked {d} at {t}', { d: T(d.dir === 'in' ? 'IN' : 'OUT'), t: M.hhmm(d.at) }); sub = T('Nothing changed. If this is wrong, tell the manager.'); }
    else if (d.custom) { line = d.custom; sub = d.sub || ''; }
    else {
      line = T(d.dir === 'in' ? 'Clocked IN at {t}' : 'Clocked OUT at {t}', { t: M.hhmm(d.at) });
      sub = d.queued ? T('No internet right now. This is saved on the tablet and will send by itself.')
        : d.dir === 'out' ? (d.worked_min != null ? T('{d} this shift. Thank you.', { d: M.dur(d.worked_min) }) : T('Thank you.'))
        : (S.camOk ? T('Photo saved. Have a good shift.') : T('Have a good shift.'));
    }
    var brief = !d.custom && !d.already && !d.queued && d.dir === 'in' && S.feed && S.feed.briefing && S.lastPin;
    main.innerHTML = '<div class="done"><div class="tick' + (d.already ? ' warn' : '') + '"><svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (d.already ? '<path d="M12 7v6"/><path d="M12 17h.01"/>' : '<path d="M20 6L9 17l-5-5"/>') + '</svg></div>' +
      (d.name ? '<div class="nm serif">' + E(d.name) + '</div>' : '') + '<div class="l1">' + E(line) + '</div><div class="l2">' + E(sub) + '</div>' +
      '<div class="row" style="justify-content:center;margin-top:10px">' + (brief ? '<button class="btn" id="rb">' + E(T('Read today\'s briefing')) + '</button>' : '') + '<button class="btn ghost" id="ok">' + E(T('Done')) + '</button></div></div>';
    document.getElementById('ok').onclick = home;
    if (brief) document.getElementById('rb').onclick = function () { S.id = { staff: S.lastPin.staff, name: S.lastPin.name, pin: S.lastPin.pin, until: Date.now() + 120000 }; openMod('brief'); };
    idle(brief ? 12000 : 5000);
  }
  var flushing = false;
  function flush() {
    var q = queue(), d = ls(LS_DEV);
    if (!q.length || flushing || !d) return;
    flushing = true;
    var item = q[0];
    M.rpc('mare_kiosk_punch', { p_device: d, p_staff: item.staff, p_pin: item.pin, p_photo: item.photo, p_client_id: item.client_id, p_client_at: item.at }).then(function (r) {
      flushing = false;
      if (r.error && r.error.network) { S.online = false; foot(); return; }
      // Sent, or refused for good (e.g. a wrong code typed offline; the database records that). It leaves the queue.
      var rest = queue().filter(function (x) { return x.client_id !== item.client_id; }); setQueue(rest);
      S.online = true; foot();
      if (rest.length) flush(); else refresh();
    });
  }

  // ════════════════ WHO ARE YOU? (module actions on the tablet) ════════════════
  // Name + code, then act(staff, pin) → {ok}. A wrong code asks again. A good code is
  // remembered for 2 minutes, so ticking several checklist lines needs it once.
  function rpcS(name, args) {
    if (PREVIEW) {
      if (name === 'mare_s_recipe') return M.rpc('mare_m_recipe', { p_id: args.p_id }, PV_TOKEN).then(function (r) { return r.data || { ok: false }; });
      if (name === 'mare_s_media_get') return M.rpc('mare_m_media_get', { p_id: args.p_id }, PV_TOKEN).then(function (r) { return r.data || { ok: false }; });
      M.toast(T('Read only: you are viewing as someone else. Nothing is saved.')); return Promise.resolve({ ok: false, error: 'preview' });
    }
    return M.rpc(name, args).then(function (r) { if (r.error) return { ok: false, network: !!r.error.network, error: r.error.network ? 'network' : 'error' }; return r.data; });
  }
  function askWho(title, act) {
    if (PREVIEW) { M.toast(T('Read only: you are viewing as someone else. Nothing is saved.')); return Promise.resolve(null); }
    var me = ident();
    if (me) return act(me.staff, me.pin).then(function (x) {
      if (x && x.ok) { if (S.id) S.id.until = Date.now() + 120000; return x; }
      if (x && (x.error === 'wrong_pin' || x.error === 'locked') && !meToken) { S.id = null; return askWho(title, act); }
      if (meToken && x && !x.ok) phoneToast(x.network ? T('No internet. Try again in a moment.') : T('Something went wrong. Try again.'));
      return x;
    });
    return new Promise(function (res) {
      S.screen = 'who';
      main.innerHTML = '<div class="topbar"><button class="back" id="bk">' + M.icon('back', 20) + E(T('Back')) + '</button><h1 class="serif">' + E(T('Who are you?')) + '</h1></div>' +
        '<p class="muted big" style="margin:0">' + E(title) + '</p><div class="groups">' + ['Kitchen', 'Service', 'Bar', 'Other'].map(function (t) {
          var ppl = S.board.filter(function (p) { return p.team === t && p.has_pin; }); if (!ppl.length) return '';
          return '<section class="group"><h2>' + E(T(t).toUpperCase()) + '</h2><div class="names">' + ppl.map(function (p) { return '<button class="name" data-id="' + p.id + '"><span>' + E(p.name) + '</span></button>'; }).join('') + '</div></section>';
        }).join('') + '</div>';
      var back = function () { res(null); openMod(S.mod, S.sub); };
      document.getElementById('bk').onclick = back;
      idle(60000);
      on('.name', function (b) {
        var p = S.board.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0];
        askPin(p, title, back, function (pin) {
          return act(p.id, pin).then(function (x) {
            if (x && x.ok) { S.id = { staff: p.id, name: p.name, pin: pin, until: Date.now() + 120000 }; res(x); return true; }
            return x;
          });
        });
      });
    });
  }
  function askPin(p, title, back, tryPin) {
    S.pin = '';
    function draw(msg) {
      main.innerHTML = '<div class="pinwrap"><div class="who"><button class="back" id="bk">' + M.icon('back', 20) + E(T('Not me')) + '</button><div><div class="act">' + E(title.toUpperCase()) + '</div><div class="nm serif">' + E(p.name) + '</div></div></div>' +
        '<div class="pad"><div class="lbl">' + E(T('Your 4-digit code')) + '</div><div class="dots" id="dots"></div><div class="msg err" id="msg">' + E(msg || '') + '</div><div class="keys" id="keys"></div></div></div>';
      document.getElementById('bk').onclick = back;
      drawKeys(function () {
        tryPin(S.pin).then(function (x) {
          if (x === true) return;
          S.pin = '';
          if (x && x.error === 'locked') draw(T('Too many wrong codes. Ask the manager to reset your code.'));
          else if (x && x.error === 'wrong_pin') draw(T('Wrong code. Try again.'));
          else if (x && x.network) draw(T('No internet. Try again in a moment.'));
          else draw(T('Something went wrong. Try again.'));
        });
      });
      idle(60000);
    }
    draw();
  }
  function idChip() {
    var me = ident(); if (!me || meToken) return '';
    return '<span class="idchip">' + E(T('As {n}', { n: me.name })) + ' <button id="notme">' + E(T('not you?')) + '</button></span>';
  }

  // ════════════════ MODULES ════════════════
  function frame(title, inner, tabs) {
    return '<div class="topbar"><button class="back" id="bk">' + M.icon(meToken ? 'home' : 'back', 20) + E(T(meToken ? 'My Mare' : 'Home')) + '</button><h1 class="serif" style="flex:1">' + E(T(title)) + '</h1>' + idChip() + '</div>' +
      (tabs ? '<div class="tabs">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (t[0] === S.sub ? 'on' : '') + '">' + E(T(t[1])) + '</button>'; }).join('') + '</div>' : '') + inner;
  }
  function bindFrame(backTo) {
    document.getElementById('bk').onclick = backTo || home;
    var nm = document.getElementById('notme'); if (nm) nm.onclick = function () { S.id = null; openMod(S.mod, S.sub); };
    on('[data-tab]', function (b) { openMod(S.mod, b.getAttribute('data-tab')); });
    idle(120000);
  }
  function openMod(k, sub) {
    S.mod = k; S.screen = 'mod'; if (sub) S.sub = sub; else if (k !== S.lastMod) S.sub = null; S.lastMod = k;
    ({ brief: modBrief, check: modCheck, rota: modRota, recipes: modRecipes, kclose: modKclose, breakage: modBreakage, leave: modLeave, speak: modSpeak, hours: modHours, more: modMore })[k]();
    if (meToken) bnav(k === 'rota' || k === 'recipes' || k === 'kclose' ? k : 'more');
  }
  function feed() { return S.feed || { briefing: null, reads: [], staff: [], shifts: [], check_items: [], ticks: [], recipes: [], actions: [], today: M.today() }; }
  function afterAction(line, sub) {
    var p = meToken ? phoneLoad(true) : refresh();
    Promise.resolve(p).then(function () {
      if (meToken) { home(); phoneToast(line + ' ' + sub); return; }
      doneScreen({ custom: line, sub: sub, name: '' });
    });
  }

  // ── briefing ──
  var BF = [['message', 'Message of the day'], ['specials', 'Specials'], ['eighty_six', 'Not available today (86)'], ['allergies', 'Allergies and dietary notes'],
            ['vip', 'VIPs, groups and special bookings'], ['kitchen_note', 'For the kitchen'], ['foh_note', 'For the floor and bar']];
  function modBrief() {
    var f = feed(), b = f.briefing, h = '';
    if (!b) h = '<div class="card big muted">' + E(T('Today\'s briefing is not written yet.')) + '</div>';
    else {
      h = '<div class="row">' + (b.covers_lunch != null ? '<span class="tag green" style="font-size:17px">' + E(T('Lunch {n} covers', { n: b.covers_lunch })) + '</span>' : '') +
        (b.covers_dinner != null ? '<span class="tag green" style="font-size:17px">' + E(T('Dinner {n} covers', { n: b.covers_dinner })) + '</span>' : '') + '</div><div class="bf">' +
        BF.filter(function (q) { return b[q[0]]; }).map(function (q) { return '<div class="card"><h3>' + E(T(q[1])) + '</h3><div>' + E(b[q[0]]) + '</div></div>'; }).join('') + '</div>';
      if ((f.briefing_media || []).length) h += '<div class="card stack"><div class="sec"><span>' + E(T('Voice note & files')) + '</span><i></i></div><div id="bmedia"></div></div>';
      var readers = f.reads.map(function (id) { var p = f.staff.filter(function (s) { return s.id === id; })[0]; return p ? p.name : ''; }).filter(Boolean);
      var mine = meToken && S.meId && f.reads.indexOf(S.meId) >= 0;
      h += '<div class="card stack">' + (mine ? '<span class="tag green" style="align-self:flex-start;font-size:17px">' + E(T('You have read it ✓')) + '</span>' : '<button class="btn" id="read" style="align-self:flex-start">' + E(T('I have read it')) + '</button>') +
        '<div class="small muted">' + (readers.length ? E(T('Read by: {n}', { n: readers.join(', ') })) : E(T('Nobody has tapped "read" yet.'))) + '</div></div>';
    }
    if (f.actions && f.actions.length) h += '<div class="card stack"><h2 class="serif">' + E(T('Open actions from the weekly meeting')) + '</h2>' + f.actions.map(function (a) {
      return '<div class="row" style="justify-content:space-between"><span class="big">' + E(a.text) + '</span><span class="muted">' + E([a.owner, a.due ? M.shortDate(a.due) : ''].filter(Boolean).join(' · ')) + '</span></div>'; }).join('') + '</div>';
    main.innerHTML = frame('Today\'s briefing', '<div class="stack">' + h + '</div>');
    bindFrame();
    var bm = document.getElementById('bmedia');
    if (bm) MareMedia.list(bm, f.briefing_media, function (id) { return rpcS('mare_s_media_get', { p_device: dev(), p_token: meToken, p_pin: pinArg(), p_id: id }).then(function (x) { return x && x.ok && x.data; }); }, null);
    var rd = document.getElementById('read');
    if (rd) rd.onclick = function () {
      askWho(T('Mark today\'s briefing as read'), function (staff, pin) { return rpcS('mare_s_brief_read', { p_device: dev(), p_token: meToken, p_staff: staff, p_pin: pin || pinArg() }); })
        .then(function (x) { if (x && x.ok) afterAction(T('Thank you, {n}.', { n: x.name }), T('Marked as read.')); });
    };
  }

  // ── checklists ──
  var LISTS = [['open_foh', 'Opening · floor & bar'], ['open_kitchen', 'Opening · kitchen'], ['close_foh', 'Closing · floor & bar'], ['close_kitchen', 'Closing · kitchen']];
  function modCheck() {
    var f = feed(), hr = M.parts(new Date()).hh;
    if (!S.sub) S.sub = hr >= 16 ? 'close_foh' : 'open_foh';
    var items = f.check_items.filter(function (i) { return i.list === S.sub; }), dl = (f.deadlines || {})[S.sub];
    var h = (dl ? '<div class="muted big">' + E(T('To be done by {t}', { t: dl })) + '</div>' : '') + '<div class="stack">' +
      (items.length ? items.map(function (i) {
        var t = f.ticks.filter(function (x) { return x.item_id === i.id; })[0];
        return '<button class="chk' + (t ? ' on' : '') + '" data-i="' + i.id + '"><span class="b">' + (t ? '✓' : '') + '</span><span style="flex:1">' + E(M.lang() === 'me' && i.text_me ? i.text_me : i.text) +
          (i.needs_photo ? ' <span class="tag grey">' + E(T('PHOTO')) + '</span>' : '') + (t ? '<br><span class="small muted">' + E(t.name || '') + ' · ' + M.hhmm(t.at) + '</span>' : '') + '</span></button>';
      }).join('') : '<div class="card muted big">' + E(T('This list is empty.')) + '</div>') + '</div>' +
      '<input type="file" accept="image/*" capture="environment" id="camf" style="display:none">';
    main.innerHTML = frame('Checklists', h, LISTS);
    bindFrame();
    on('[data-i]', function (b) {
      var it = items.filter(function (i) { return i.id === b.getAttribute('data-i'); })[0], done = f.ticks.some(function (x) { return x.item_id === it.id; });
      var txt = M.lang() === 'me' && it.text_me ? it.text_me : it.text;
      function doTick(photo) {
        return askWho(done ? T('Untick “{t}”', { t: txt }) : T('Tick “{t}”', { t: txt }), function (staff, pin) {
          return rpcS('mare_s_tick', { p_device: dev(), p_token: meToken, p_staff: staff, p_pin: pin || pinArg(), p_item: it.id, p_photo: photo || null, p_undo: done });
        }).then(function (x) { if (x && x.ok) { var r = meToken ? phoneLoad(true) : refresh(); Promise.resolve(r).then(function () { openMod('check', S.sub); }); } });
      }
      if (!done && it.needs_photo) {
        var fi = document.getElementById('camf');
        fi.onchange = function () { var fl = fi.files[0]; if (!fl) return; M.photoFromFile(fl, 1024).then(doTick, function () { doTick(null); }); };
        fi.click();
      } else doTick(null);
    });
  }

  // ── schedule (9 Oct 2026: the Dubai Kitchen schedule's format) ──
  // Name · Role · Mon–Sun · Hrs · Days, people grouped by team, a split shift on a second line,
  // a "Kitchen on duty" count under the grid. Everyone with a link sees it; only a can_rota
  // person (Vinay) taps a day to set it, for their own team. The database checks the same rule.
  function shiftLbl(r) { if (!r) return ''; if (r.kind === 'off') return T('OFF'); if (r.kind === 'leave') return T('LEAVE'); if (r.kind === 'sick') return T('SICK'); return (r.start_t || '?') + '–' + (r.end_t || '?'); }
  function shiftMins(r) {
    if (!r || r.kind !== 'work') return 0;
    function seg(a, b) { if (!a || !b) return 0; var x = M.timeToMin(a), y = M.timeToMin(b); if (y <= x) y += 1440; return y - x; }
    return seg(r.start_t, r.end_t) + seg(r.start2_t, r.end2_t);
  }
  var R = { ws: null, data: null, prev: null };
  function rotaLoad(ws) {
    if (PREVIEW) {   // View as: the feed's two weeks, read-only
      var f = feed();
      return Promise.resolve({ ok: true, week_start: ws, today: f.today, now: f.now, can_rota: false, my_team: S.meData && S.meData.team, kitchen_min: 3,
        staff: f.staff, shifts: f.shifts.filter(function (x) { return x.date >= ws && x.date <= M.addDays(ws, 6); }), punches: f.punches || [] });
    }
    return rpcS('mare_s_rota', { p_device: dev(), p_token: meToken, p_staff: null, p_pin: pinArg(), p_ws: ws });
  }
  function modRota() {
    if (!R.ws) R.ws = M.weekStart(feed().today || M.today());
    main.innerHTML = frame('Schedule', '<div class="card big muted" style="font-family:inherit;font-size:17px">' + E(T('Loading…')) + '</div>');
    bindFrame();
    var ws = R.ws;
    Promise.all([rotaLoad(ws), rotaLoad(M.addDays(ws, -7))]).then(function (r) {
      if (S.mod !== 'rota' || R.ws !== ws) return;
      var d = r[0];
      if (!d || !d.ok) { main.innerHTML = frame('Schedule', '<div class="card big">' + E(d && d.network ? T('No internet. Try again in a moment.') : T('Something went wrong. Try again.')) + '</div>'); bindFrame(); return; }
      R.data = d; R.prev = r[1] && r[1].ok ? r[1] : null;
      rotaDraw();
    });
  }
  function rotaDraw() {
    var d = R.data, ws = d.week_start, days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return M.addDays(ws, i); });
    var rota = {}; d.shifts.forEach(function (x) { rota[x.staff_id + '|' + x.date] = x; });
    // Clock times only once the clock-in is in use: without punches every past day would read "No clock-in".
    var clockOn = (d.punches || []).length > 0, act = clockOn ? M.actualByDay(d.punches, d.now) : {};
    var canEdit = !!d.can_rota && !PREVIEW;
    var h = '<div class="rw-nav"><button class="btn ghost sm" data-wk="-7">‹</button><b>' + E(T('Week of {d}', { d: M.shortDate(ws) })) + '</b><button class="btn ghost sm" data-wk="7">›</button>' +
      (ws !== M.weekStart(d.today) ? '<button class="lnk" data-wk="0">' + E(T('This week')) + '</button>' : '') + '</div>';
    if (!d.staff.length) h += '<div class="card big muted">' + E(T('No rota yet.')) + '</div>';
    else {
      h += '<div class="boxx"><table class="rota dsch"><thead><tr><th>' + E(T('Name')) + '</th><th>' + E(T('Role')) + '</th>' +
        days.map(function (k, i) { return '<th class="' + (k === d.today ? 'td' : '') + '">' + E(M.day(i)) + '<br><span>' + E(M.shortDate(k).split(' ').slice(1).join(' ')) + '</span></th>'; }).join('') +
        '<th>' + E(T('Hrs')) + '</th><th>' + E(T('Days')) + '</th></tr></thead><tbody>';
      var lastTeam = null;
      d.staff.forEach(function (s) {
        if (s.team !== lastTeam) { h += '<tr class="team"><td colspan="11">' + E(T(s.team).toUpperCase()) + '</td></tr>'; lastTeam = s.team; }
        var mins = 0, nd = 0, mine = canEdit && s.team === d.my_team;
        h += '<tr class="' + (s.id === S.meId ? 'me' : '') + '"><td>' + E(s.name) + '</td><td class="role">' + E(s.role || '—') + '</td>' + days.map(function (k) {
          var x = rota[s.id + '|' + k]; mins += shiftMins(x); if (x && x.kind === 'work') nd++;
          var cell = x ? '<span class="sh ' + x.kind + '">' + E(shiftLbl(x)) + '</span>' + (x.kind === 'work' && x.start2_t ? '<div class="sh2">' + E(x.start2_t + '–' + x.end2_t) + '</div>' : '') : (mine ? '<span class="add">+</span>' : '');
          cell += clockOn ? M.actualHtml(act[s.id + '|' + k], x, k, d.now) : '';
          return '<td class="' + (k === d.today ? 'td' : '') + (mine ? ' ed' : '') + '"' + (mine ? ' data-s="' + s.id + '" data-k="' + k + '"' : '') + '>' + cell + '</td>';
        }).join('') + '<td><b>' + M.durShort(mins) + '</b></td><td><b>' + nd + '</b></td></tr>';
      });
      var minK = d.kitchen_min || 3;
      if (d.staff.some(function (s) { return s.team === 'Kitchen'; })) {
        h += '<tr class="sum"><td colspan="2">' + E(T('Kitchen on duty')) + '</td>' + days.map(function (k) {
          var n = d.staff.filter(function (s) { var x = rota[s.id + '|' + k]; return s.team === 'Kitchen' && x && x.kind === 'work'; }).length;
          return '<td><span class="tag ' + (n < minK ? 'red' : 'green') + '">' + n + '</span></td>'; }).join('') + '<td></td><td></td></tr>';
      }
      h += '</tbody></table></div>';
    }
    if (canEdit) h += '<div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn ghost" id="rcopy">' + E(T('Copy last week into this week')) + '</button></div>' +
      '<p class="small muted" style="margin:0">' + E(T('Tap a day to set the shift. The whole team sees it straight away.')) + '</p>';
    else h += '<p class="small muted" style="margin:0">' + E(T('{n} sets the schedule. Ask them to change a day.', { n: rotaEditors() })) + '</p>';
    main.innerHTML = frame('Schedule', '<div class="stack">' + h + '</div>');
    bindFrame();
    on('[data-wk]', function (b) { var n = +b.getAttribute('data-wk'); R.ws = n ? M.addDays(R.ws, n) : M.weekStart(d.today); modRota(); });
    on('td.ed', function (b) { rotaEdit(b.getAttribute('data-s'), b.getAttribute('data-k'), rota); });
    var cp = document.getElementById('rcopy'); if (cp) cp.onclick = function () { rotaCopy(this); };
  }
  function rotaEditors() { var n = (R.data.editors || []).map(function (x) { return x.split(' ')[0]; }); return n.length ? n.join(', ') : T('The manager'); }
  // Quick fill = the shift times already used this week and last (no invented times), as in Dubai.
  function rotaPresets() {
    var seen = {}, out = [];
    [R.data, R.prev].forEach(function (d) { (d ? d.shifts : []).forEach(function (x) {
      if (x.kind !== 'work' || !x.start_t || !x.end_t) return;
      var k = x.start_t + '–' + x.end_t + (x.start2_t ? ' / ' + x.start2_t + '–' + x.end2_t : '');
      if (!seen[k]) { seen[k] = 1; out.push(x); } }); });
    return out.slice(0, 8);
  }
  function hmSel(id, val) {
    var hv = val ? val.slice(0, 2) : '', mv = val ? val.slice(3, 5) : '00', h = '<select id="' + id + 'h"><option value="">--</option>', m = '<select id="' + id + 'm">';
    for (var i = 0; i < 24; i++) { var x = (i < 10 ? '0' : '') + i; h += '<option' + (x === hv ? ' selected' : '') + '>' + x + '</option>'; }
    ['00', '15', '30', '45'].concat(['00', '15', '30', '45'].indexOf(mv) < 0 ? [mv] : []).forEach(function (x) { m += '<option' + (x === mv ? ' selected' : '') + '>' + x + '</option>'; });
    return '<span class="hm">' + h + '</select>:' + m + '</select></span>';
  }
  function hmVal(o, id) { var h = o.querySelector('#' + id + 'h').value, m = o.querySelector('#' + id + 'm').value; return h ? h + ':' + m : ''; }
  function rotaEdit(sid, key, rota) {
    var x = rota[sid + '|' + key] || { kind: 'work' }, name = (R.data.staff.filter(function (s) { return s.id === sid; })[0] || {}).name || '';
    var pre = rotaPresets(), split = !!x.start2_t;
    var o = document.createElement('div'); o.className = 'rsheet-bg';
    o.innerHTML = '<div class="rsheet" role="dialog" aria-label="' + E(name) + '"><div class="sec"><span>' + E(name + ' · ' + M.niceDate(key)) + '</span><i></i></div>' +
      '<div class="tabs" id="rk">' + [['work', 'Working'], ['off', 'Day off'], ['leave', 'Leave'], ['sick', 'Sick']].map(function (k) { return '<button data-k="' + k[0] + '" class="' + (x.kind === k[0] ? 'on' : '') + '">' + E(T(k[1])) + '</button>'; }).join('') + '</div>' +
      '<div id="rtimes">' +
      (pre.length ? '<div class="rq-hd">' + E(T('Quick fill')) + '</div><div class="rq">' + pre.map(function (p, i) { return '<button data-p="' + i + '">' + E(p.start_t + '–' + p.end_t) + (p.start2_t ? '<small>' + E(p.start2_t + '–' + p.end2_t) + '</small>' : '') + '</button>'; }).join('') + '</div>' : '') +
      '<div class="rt"><label>' + E(T('Start')) + hmSel('a', x.start_t) + '</label><label>' + E(T('End')) + hmSel('b', x.end_t) + '</label></div>' +
      '<button class="lnk" id="rsp">' + E(split ? T('− Remove split shift') : T('+ Add split shift')) + '</button>' +
      '<div class="rt" id="rsplit"' + (split ? '' : ' hidden') + '><label>' + E(T('Start')) + hmSel('c', x.start2_t) + '</label><label>' + E(T('End')) + hmSel('d', x.end2_t) + '</label></div></div>' +
      '<label class="f">' + E(T('Note')) + '<input type="text" id="rn" maxlength="200" value="' + E(x.note || '') + '"></label>' +
      '<div class="msg err" id="rm"></div>' +
      '<div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn" id="rsv">' + E(T('Save')) + '</button>' +
      (rota[sid + '|' + key] ? '<button class="btn ghost" id="rcl">' + E(T('Clear the day')) + '</button>' : '') +
      '<button class="btn ghost" id="rx">' + E(T('Cancel')) + '</button></div></div>';
    document.body.appendChild(o);
    var kind = x.kind;
    function paintKind() { o.querySelectorAll('#rk button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-k') === kind); }); o.querySelector('#rtimes').hidden = kind !== 'work'; }
    paintKind();
    function close() { o.remove(); }
    o.addEventListener('click', function (e) { if (e.target === o) close(); });
    o.querySelector('#rx').onclick = close;
    o.querySelectorAll('#rk button').forEach(function (b) { b.onclick = function () { kind = b.getAttribute('data-k'); paintKind(); }; });
    function setHM(id, v) { if (!v) return; o.querySelector('#' + id + 'h').value = v.slice(0, 2); var m = o.querySelector('#' + id + 'm'); if (![].some.call(m.options, function (op) { return op.value === v.slice(3, 5); })) m.add(new Option(v.slice(3, 5))); m.value = v.slice(3, 5); }
    function setSplit(on) { split = on; o.querySelector('#rsplit').hidden = !on; o.querySelector('#rsp').textContent = on ? T('− Remove split shift') : T('+ Add split shift'); }
    o.querySelector('#rsp').onclick = function () { setSplit(!split); };
    function save(k, a, b, c, dd) {
      var btn = o.querySelector('#rsv'); btn.disabled = true;
      rpcS('mare_s_shift_save', { p_device: dev(), p_token: meToken, p_staff: null, p_pin: pinArg(), p_for: sid, p_date: key, p_kind: k,
        p_start: a || null, p_end: b || null, p_start2: c || null, p_end2: dd || null, p_note: o.querySelector('#rn').value.trim() || null }).then(function (r) {
        btn.disabled = false;
        if (r && r.ok) { close(); modRota(); return; }
        o.querySelector('#rm').textContent = r && r.network ? T('No internet. Try again in a moment.') : r && r.error === 'not_allowed' ? T('Only the person who sets the schedule can change it.') : r && r.error === 'times' ? T('Pick the start and the end.') : T('Something went wrong. Try again.');
      });
    }
    o.querySelectorAll('[data-p]').forEach(function (b) { b.onclick = function () {   // one tap fills AND saves, as in Dubai
      var p = pre[+b.getAttribute('data-p')]; kind = 'work'; save('work', p.start_t, p.end_t, p.start2_t, p.end2_t); }; });
    o.querySelector('#rsv').onclick = function () {
      if (kind !== 'work') { save(kind); return; }
      var a = hmVal(o, 'a'), b = hmVal(o, 'b'), c = split ? hmVal(o, 'c') : '', dd = split ? hmVal(o, 'd') : '';
      if (!a || !b || (split && (!c || !dd))) { o.querySelector('#rm').textContent = T('Pick the start and the end.'); return; }
      save('work', a, b, c, dd);
    };
    var cl = o.querySelector('#rcl'); if (cl) cl.onclick = function () {
      this.disabled = true;
      rpcS('mare_s_shift_clear', { p_device: dev(), p_token: meToken, p_staff: null, p_pin: pinArg(), p_for: sid, p_date: key }).then(function (r) {
        if (r && r.ok) { close(); modRota(); } else o.querySelector('#rm').textContent = T('Something went wrong. Try again.'); });
    };
  }
  // Copy last week into this week: only days still empty this week are filled; nothing is overwritten.
  function rotaCopy(btn) {
    if (!R.prev) { phoneToast(T('Could not load last week.')); return; }
    var d = R.data, have = {}; d.shifts.forEach(function (x) { have[x.staff_id + '|' + x.date] = 1; });
    var mine = {}; d.staff.forEach(function (s) { if (s.team === d.my_team) mine[s.id] = 1; });
    var todo = R.prev.shifts.filter(function (x) { return mine[x.staff_id] && !have[x.staff_id + '|' + M.addDays(x.date, 7)]; });
    if (!todo.length) { phoneToast(T('Nothing to copy: this week is already planned.')); return; }
    btn.disabled = true; var n = 0, bad = 0;
    todo.reduce(function (p, x) { return p.then(function () {
      return rpcS('mare_s_shift_save', { p_device: dev(), p_token: meToken, p_staff: null, p_pin: pinArg(), p_for: x.staff_id, p_date: M.addDays(x.date, 7), p_kind: x.kind,
        p_start: x.start_t, p_end: x.end_t, p_start2: x.start2_t || null, p_end2: x.end2_t || null, p_note: x.note || null }).then(function (r) { if (r && r.ok) n++; else bad++; }); }); }, Promise.resolve())
      .then(function () { phoneToast(bad ? T('{n} days copied, {b} could not be copied.', { n: n, b: bad }) : T('{n} days copied. Days already planned were left alone.', { n: n })); modRota(); });
  }

  // ── kitchen closing report (9 Oct 2026) ──
  // Francesco: "make the closing report easy to fill for the team, not too complicated".
  // Three yes/no questions (a text box only after Yes), the service faces, an optional note,
  // one big Send. Who was on duty comes from the schedule. Emailed to mare_settings 'kitchen_report_to'.
  // Guests served and total revenue are asked first and must be filled to send (Francesco, 9 Oct).
  var KR_Q = [
    ['unavailable', 'Did anything run out?', 'What ran out, and at what time?'],
    ['complaint', 'Any guest complaints?', 'Which dish, what happened, what you did'],
    ['operation', 'Any problem with equipment, deliveries or the team?', 'What happened'],
  ];
  var KR = { date: null, data: null, ans: {}, chefs: null, rating: null, note: '', guests: '', revenue: '', editChefs: false, loadedFor: null };
  function krDefaultDate() { var t = feed().today || M.today(); return M.parts(new Date()).hh < 6 ? M.addDays(t, -1) : t; }   // before 6 AM = last night's report
  function krDraftKey() { return 'mare_kr_' + (S.meId || 'x') + '_' + KR.date; }
  function krKeep() { if (KR.loadedFor === KR.date) ls(krDraftKey(), JSON.stringify({ a: KR.ans, c: KR.chefs, r: KR.rating, n: KR.note, g: KR.guests, v: KR.revenue })); }
  function modKclose() {
    if (!KR.date) KR.date = krDefaultDate();
    main.innerHTML = frame('Closing report', '<div class="card big muted" style="font-family:inherit;font-size:17px">' + E(T('Loading…')) + '</div>');
    bindFrame();
    var d0 = KR.date;
    (PREVIEW ? Promise.resolve({ ok: true, date: d0, today: feed().today, report: null, kitchen: [], recent: [] })
             : rpcS('mare_s_kreport_get', { p_device: dev(), p_token: meToken, p_staff: null, p_pin: pinArg(), p_date: d0 })).then(function (r) {
      if (S.mod !== 'kclose' || KR.date !== d0) return;
      if (!r || !r.ok) { main.innerHTML = frame('Closing report', '<div class="card big">' + E(r && r.network ? T('No internet. Try again in a moment.') : T('Something went wrong. Try again.')) + '</div>'); bindFrame(); return; }
      KR.data = r;
      if (KR.loadedFor !== d0) {
        var rep = r.report, dr = null;
        try { dr = JSON.parse(ls(krDraftKey()) || 'null'); } catch (e) {}
        if (dr && !(rep && rep.sent_at)) { KR.ans = dr.a || {}; KR.chefs = dr.c; KR.rating = dr.r || null; KR.note = dr.n || ''; KR.guests = dr.g || ''; KR.revenue = dr.v || ''; }   // an unsent draft on this phone
        else if (rep) {   // a saved report: every question was answered (no line = No)
          KR.ans = {}; KR_Q.forEach(function (q) { var e = (rep.entries || []).filter(function (x) { return x.type === q[0]; }); KR.ans[q[0]] = e.length ? e.map(function (x) { return x.detail || x.item || ''; }).join('\n') : false; });
          KR.chefs = (rep.chefs_on || []).slice(); KR.rating = rep.rating || null; KR.note = rep.feedback || '';
          KR.guests = rep.guests != null ? String(rep.guests) : ''; KR.revenue = rep.revenue != null ? String(rep.revenue) : '';
        } else { KR.ans = {}; KR.chefs = null; KR.rating = null; KR.note = ''; KR.guests = ''; KR.revenue = ''; }
        if (!KR.chefs || !KR.chefs.length) KR.chefs = r.kitchen.filter(function (k) { return k.on; }).map(function (k) { return k.name; });
        KR.editChefs = false; KR.loadedFor = d0;
      }
      krDraw();
    });
  }
  function krDraw() {
    var r = KR.data, rep = r.report || {}, faces = ['😖', '😕', '😐', '🙂', '🔥'];
    var h = '<div class="tabs">' + [r.today, M.addDays(r.today, -1)].map(function (k, i) { return '<button data-d="' + k + '" class="' + (k === KR.date ? 'on' : '') + '">' + E(i ? T('Yesterday') : T('Today')) + '</button>'; }).join('') + '</div>';
    if (rep.sent_at) h += '<div class="kr-sent">' + E(T('Sent to {to} at {t} by {n}.', { to: r.send_to, t: M.hhmm(rep.sent_at), n: rep.sent_by || '' })) + '</div>';
    h += '<div class="kr-card"><div class="kr-fig"><label class="f">' + E(T('Guests served')) + '<input type="text" inputmode="numeric" data-num="1" id="krg" value="' + E(KR.guests) + '" placeholder="' + E(T('e.g. 85')) + '"></label>' +
      '<label class="f">' + E(T('Total revenue (€)')) + '<input type="text" inputmode="decimal" data-num="1" id="krv" value="' + E(KR.revenue) + '" placeholder="' + E(T('e.g. 4250')) + '"></label></div><div class="kr-avg" id="kravg"></div></div>';
    h += '<div class="kr-card"><div class="kr-q">' + E(T('How was service?')) + '</div><div class="kr-faces">' + faces.map(function (f, i) { return '<button data-r="' + (i + 1) + '" class="' + (KR.rating === i + 1 ? 'on' : '') + '" aria-label="' + (i + 1) + '/5">' + f + '</button>'; }).join('') + '</div></div>';
    KR_Q.forEach(function (q, i) {
      var a = KR.ans[q[0]], yes = typeof a === 'string', no = a === false;
      h += '<div class="kr-card"><div class="kr-q">' + (i + 1) + '. ' + E(T(q[1])) + '</div><div class="kr-yn">' +
        '<button data-yn="' + q[0] + '" data-v="no" class="' + (no ? 'on' : '') + '">' + E(T('No')) + '</button><button data-yn="' + q[0] + '" data-v="yes" class="' + (yes ? 'on yes' : '') + '">' + E(T('Yes')) + '</button></div>' +
        (yes ? '<textarea data-tx="' + q[0] + '" maxlength="600" placeholder="' + E(T(q[2])) + '">' + E(a) + '</textarea>' : '') + '</div>';
    });
    h += '<div class="kr-card"><div class="kr-q">' + E(T('Note for Chef Francesco')) + ' <span class="kr-opt">' + E(T('(optional)')) + '</span></div><textarea id="krn" maxlength="2000">' + E(KR.note || '') + '</textarea></div>';
    var duty = KR.chefs.map(function (n) { return n.split(' ')[0]; });
    h += '<div class="kr-duty"><span>' + E(T('On duty')) + ': <b>' + E(duty.length ? duty.join(', ') : T('nobody ticked')) + '</b></span><button class="lnk" id="krc">' + E(KR.editChefs ? T('Done') : T('Change')) + '</button></div>';
    if (KR.editChefs) h += '<div class="kr-chips">' + r.kitchen.map(function (k) { return '<button data-c="' + E(k.name) + '" class="' + (KR.chefs.indexOf(k.name) >= 0 ? 'on' : '') + '">' + E(k.name.split(' ')[0]) + '</button>'; }).join('') + '</div>';
    h += '<div class="msg err" id="krm"></div><button class="btn" id="krsend">' + E(rep.sent_at ? T('Send again') : T('Send to {to}', { to: r.send_to })) + '</button>' +
      '<button class="lnk" id="krsave" style="align-self:center">' + E(T('Save, send later')) + '</button>';
    main.innerHTML = frame('Closing report', '<div class="stack">' + h + '</div>');
    bindFrame(); idle(600000);
    on('[data-d]', function (b) { KR.date = b.getAttribute('data-d'); modKclose(); });
    on('[data-r]', function (b) { var v = +b.getAttribute('data-r'); KR.rating = KR.rating === v ? null : v; krKeep(); krDraw(); });
    on('[data-yn]', function (b) {
      var k = b.getAttribute('data-yn');
      KR.ans[k] = b.getAttribute('data-v') === 'yes' ? (typeof KR.ans[k] === 'string' ? KR.ans[k] : '') : false;
      krKeep(); krDraw();
      var t = main.querySelector('[data-tx="' + k + '"]'); if (t) t.focus();
    });
    on('[data-tx]', function (t) { KR.ans[t.getAttribute('data-tx')] = t.value; krKeep(); }, 'input');
    document.getElementById('krn').oninput = function () { KR.note = this.value; krKeep(); };
    function avg() { var g = M.numSafe(KR.guests), v = M.numSafe(KR.revenue); document.getElementById('kravg').textContent = g > 0 && v != null ? T('{m} per guest', { m: M.money(v / g) }) : ''; }
    document.getElementById('krg').oninput = function () { KR.guests = this.value; krKeep(); avg(); };
    document.getElementById('krv').oninput = function () { KR.revenue = this.value; krKeep(); avg(); };
    avg();
    document.getElementById('krc').onclick = function () { KR.editChefs = !KR.editChefs; krDraw(); };
    on('[data-c]', function (b) { var n = b.getAttribute('data-c'), i = KR.chefs.indexOf(n); if (i >= 0) KR.chefs.splice(i, 1); else KR.chefs.push(n); krKeep(); krDraw(); });
    document.getElementById('krsend').onclick = function () { krSave(true, this); };
    document.getElementById('krsave').onclick = function () { krSave(false, this); };
  }
  function krSave(send, btn) {
    if (PREVIEW) { M.toast(T('Read only: you are viewing as someone else. Nothing is saved.')); return; }
    var m = document.getElementById('krm'); m.textContent = '';
    var guests = null, revenue = null;
    try { guests = M.num(KR.guests); } catch (e) { m.textContent = T('Check the guests: write a whole number, e.g. 85.'); document.getElementById('krg').focus(); return; }
    try { revenue = M.num(KR.revenue); } catch (e) { m.textContent = T('Check the revenue: write it like 4250 or 4250,50, without a thousands dot.'); document.getElementById('krv').focus(); return; }
    if (guests != null && (guests < 0 || Math.round(guests) !== guests)) { m.textContent = T('Check the guests: write a whole number, e.g. 85.'); document.getElementById('krg').focus(); return; }
    if (send && guests == null) { m.textContent = T('Write how many guests were served.'); document.getElementById('krg').focus(); return; }
    if (send && revenue == null) { m.textContent = T('Write the total revenue.'); document.getElementById('krv').focus(); return; }
    var miss = KR_Q.filter(function (q) { return KR.ans[q[0]] === undefined; });
    if (send && miss.length) { m.textContent = T('Answer question {n}: tap No or Yes.', { n: KR_Q.indexOf(miss[0]) + 1 }); return; }
    var empty = KR_Q.filter(function (q) { return typeof KR.ans[q[0]] === 'string' && !KR.ans[q[0]].trim(); });
    if (send && empty.length) { m.textContent = T('You said Yes to question {n}: write one line about it.', { n: KR_Q.indexOf(empty[0]) + 1 }); var t = main.querySelector('[data-tx="' + empty[0][0] + '"]'); if (t) t.focus(); return; }
    var entries = KR_Q.filter(function (q) { return typeof KR.ans[q[0]] === 'string' && KR.ans[q[0]].trim(); }).map(function (q) { return { type: q[0], category: '', detail: KR.ans[q[0]].trim() }; });
    btn.disabled = true;
    rpcS('mare_s_kreport_save', { p_device: dev(), p_token: meToken, p_staff: null, p_pin: pinArg(), p_date: KR.date, p_entries: entries, p_chefs: KR.chefs,
      p_feedback: KR.note.trim() || null, p_rating: KR.rating, p_guests: guests, p_revenue: revenue, p_send: send }).then(function (r) {
      btn.disabled = false;
      if (r && r.ok) { ls(krDraftKey(), null); KR.loadedFor = null; phoneToast(r.sent ? T('Sent to {to}. Thank you.', { to: KR.data.send_to }) : T('Saved. Send it when you finish.')); if (r.sent && meToken) home(); else modKclose(); return; }
      m.textContent = r && r.network ? T('No internet. Your answers stay on this phone; try again in a moment.') : r && r.error === 'not_allowed' ? T('Only the kitchen team can send this report.') : T('Something went wrong. Try again.');
    });
  }

  // ── recipes ──
  function dubaiBlk(t, v) { return v ? '<div class="card"><h2 class="serif">' + E(t) + '</h2><div class="pre big">' + E(v) + '</div></div>' : ''; }
  function modRecipes() {
    var f = feed(); if (!S.sub) S.sub = 'mare';
    var TABS = [['mare', 'Roberto\'s Mare'], ['dubai', 'From Dubai']];
    if (S.sub === 'mare') {
      var h = f.recipes.length ? '<div class="rlist">' + f.recipes.map(function (r) { return '<button class="rcard" data-r="' + r.id + '"><b>' + E(r.name) + '</b><span class="muted">' + E(r.category || '') + '</span></button>'; }).join('') + '</div>'
        : '<div class="card muted big">' + E(T('No Mare recipes yet.')) + '</div>';
      main.innerHTML = frame('Recipes', h, TABS);
      bindFrame();
      on('[data-r]', function (b) { mareCard(b.getAttribute('data-r')); });
      return;
    }
    main.innerHTML = frame('Recipes', '<div class="muted big">' + E(T('Loading the Dubai recipe cards…')) + '</div>', TABS);
    bindFrame();
    var load = S.dubai ? Promise.resolve(S.dubai) : M.dubaiBook().then(function (r) { S.dubai = r; return r; });
    load.then(function (book) {
      if (S.mod !== 'recipes' || S.sub !== 'dubai') return;
      main.innerHTML = frame('Recipes', '<div class="stack"><p class="muted" style="margin:0">' + E(T('Roberto\'s Dubai recipe cards, read only. Learn the standard here.')) + '</p>' +
        '<input type="text" id="q" placeholder="' + E(T('Search a dish')) + '" aria-label="' + E(T('Search')) + '"><div class="stack" id="rl"></div></div>', TABS);
      bindFrame();
      function paint(q) {
        var x = M.dubaiBookHtml(book, q);
        document.getElementById('rl').innerHTML = !book.length ? '<div class="card muted">' + E(T('No Dubai cards are shared with Mare yet. The Dubai chef chooses them in the Kitchen recipe book: the Mare switch on each dish.')) + '</div>'
          : (x.n ? x.html : '<div class="muted">' + E(T('Nothing matches.')) + '</div>');
      }
      paint(''); document.getElementById('q').oninput = function () { paint(this.value); };
      document.getElementById('rl').onclick = function (e) {
        var b = e.target.closest('[data-k]'); if (!b) return;
        dubaiCard(b.getAttribute('data-k'), false, []);
      };
    }, function () { main.innerHTML = frame('Recipes', '<div class="card big">' + E(T('Could not reach the Dubai recipe cards. Check the internet.')) + '</div>', TABS); bindFrame(); });
  }

  function mareCard(rid, then) {
    rpcS('mare_s_recipe', { p_device: dev(), p_token: meToken, p_pin: pinArg(), p_id: rid }).then(function (x) {
      if (!x || !x.ok || !x.recipe) return;
      var r = x.recipe, ph = M.safeJpeg(r.photo);
      main.innerHTML = frame(r.name, '<div class="stack">' + (ph ? '<img class="photo" src="' + ph + '" alt="">' : '') +
        '<div class="row">' + (r.category ? '<span class="tag grey">' + E(r.category) + '</span>' : '') + (r.portions ? '<span class="tag grey">' + E(r.portions) + '</span>' : '') + (r.allergens ? '<span class="tag amber">' + E(r.allergens) + '</span>' : '') + '</div>' +
        dubaiBlk(T('Ingredients'), r.ingredients) + dubaiBlk(T('Method'), r.method) + dubaiBlk(T('Plating and garnish'), r.plating) + askBox() + '</div>');
      bindFrame(function () { openMod('recipes', 'mare'); });
      askLoad('mare', rid, r.name, function (t) { S.mod = 'recipes'; S.sub = 'mare'; S.screen = 'mod'; mareCard(rid, t); });
      if (then) then(); else window.scrollTo(0, 0);
    });
  }

  // ── Ask the chef (Andrea Falcone, Tell us 2bf15403, 8 Oct 2026) ──
  // At the end of every recipe card: a team member asks about anything not clear. The database
  // mails the chef (mare_settings 'recipe_question_to'); he answers from the link in the mail and
  // the answer shows here, under the question, for the whole team. Either side can write again
  // below it, like a small chat. A question starting "zz" is a test: it mails Francesco only.
  function askBox() { return '<div class="card stack" id="rq"><h2 class="serif" style="margin:0">' + E(T('Not clear? Ask the chef')) + '</h2>' +
    '<p class="muted" style="margin:0">' + E(T('Your question goes to the chef in Dubai by email. The answer comes back here, under your question, within 24 hours.')) + '</p>' +
    '<div class="stack" id="rqt"></div>' +
    '<label class="f"><span id="rql">' + E(T('Your question')) + '</span><textarea id="rqn" style="min-height:96px"></textarea></label>' +
    '<div class="msg err" id="rqm" style="text-align:left"></div><button class="btn" id="rqs" style="align-self:flex-start">' + E(T('Send to the chef')) + '</button></div>'; }
  function rqWhen(at) { var d = new Date(at); return M.niceDate(M.dateKey(d)) + ' · ' + M.hhmm(d); }
  function rqThread(t) {
    return '<div class="rq-th">' + t.msgs.map(function (m) {
      return '<div class="rq-m' + (m.from_chef ? ' chef' : '') + '"><div class="rq-w">' + E(m.author) + ' · ' + E(rqWhen(m.at)) + '</div><div class="pre">' + E(m.text) + '</div></div>';
    }).join('') + (t.answered ? '' : '<div class="muted small">' + E(T('Waiting for the chef’s answer.')) + '</div>') +
      '<button class="btn ghost" data-rq="' + E(t.id) + '" style="min-height:40px;padding:8px 16px;align-self:flex-start">' + E(T('Write below this')) + '</button></div>';
  }
  function askLoad(kind, rid, rname, reopen) {
    var box = document.getElementById('rqt'); if (!box) return;
    var replyTo = null;
    document.getElementById('rqs').onclick = function () {
      var ta = document.getElementById('rqn'), msg = document.getElementById('rqm'), t = ta.value.trim();
      if (t.length < 3) { msg.textContent = T('Write your question first.'); ta.focus(); return; }
      var btn = this; btn.disabled = true; msg.textContent = '';
      askWho(T('Question about {r}', { r: rname }), function (staff, pin) {
        return rpcS('mare_s_rq_ask', { p_device: dev(), p_token: meToken, p_staff: staff, p_pin: pin || pinArg(), p_kind: kind, p_recipe: String(rid), p_name: rname, p_q: replyTo, p_text: t });
      }).then(function (x) {
        if (x && x.ok) { reopen(function () { var b = document.getElementById('rq'); if (b) b.scrollIntoView({ block: 'start' }); phoneToast(T('Sent to the chef. The answer will show here.')); }); return; }
        if (!document.getElementById('rqs')) return;   // left the card (Back on Who are you?)
        btn.disabled = false;
        if (x) msg.textContent = x.network ? T('No internet. Try again in a moment.') : x.error === 'busy' ? T('Too many questions today. Try again tomorrow.') : T('Something went wrong. Try again.');
      });
    };
    document.getElementById('rqn').oninput = function () { idle(300000); };
    if (PREVIEW) { box.innerHTML = '<div class="muted small">' + E(T('Questions are not shown in View as.')) + '</div>'; return; }
    rpcS('mare_s_rq_list', { p_device: dev(), p_token: meToken, p_pin: pinArg(), p_kind: kind, p_recipe: String(rid) }).then(function (x) {
      if (box !== document.getElementById('rqt') || !x || !x.ok) return;
      var th = x.threads || [];
      box.innerHTML = th.length ? '<div class="muted small">' + E(T('Questions about this recipe')) + '</div>' + th.map(rqThread).join('') : '';
      box.querySelectorAll('[data-rq]').forEach(function (b) {
        b.onclick = function () {
          replyTo = b.getAttribute('data-rq');
          box.querySelectorAll('.rq-th').forEach(function (z) { z.classList.toggle('on', z === b.parentNode); });
          document.getElementById('rql').textContent = T('Your reply');
          document.getElementById('rqs').textContent = T('Send my reply');
          var ta = document.getElementById('rqn'); ta.scrollIntoView({ block: 'center' }); ta.focus();
        };
      });
    });
  }

  // One Dubai card as a full screen. A batch line (data-b) opens that batch recipe;
  // trail = the cards above it, so Back goes to the dish, then to the list.
  function dubaiCard(id, isBatch, trail, then) {
    Promise.all([M.dubaiRecipe(id, isBatch), M.dubaiLines(id)]).then(function (x) {
      if (S.mod !== 'recipes' || S.sub !== 'dubai') return;
      var r = x[0], m = (r.method && typeof r.method === 'object') ? r.method : {}, ph = (Array.isArray(r.photos) ? r.photos : []).map(function (p) { return M.safeImg(p && p.u); }).filter(Boolean)[0];
      var prev = trail[trail.length - 1];
      var ing = x[1].length ? '<div class="card"><h2 class="serif">' + E(T('Ingredients')) + '</h2>' + M.dubaiLinesHtml(x[1]) + '</div>' : dubaiBlk(T('Ingredients'), m.ing);
      main.innerHTML = frame(r.name, '<div class="stack">' +
        (prev ? '<button class="btn ghost" data-bk style="align-self:flex-start">‹ ' + E(T('Back to {n}', { n: prev.name })) + '</button>' : '') +
        '<div class="row"><span class="tag blue">' + E(T('ROBERTO\'S DUBAI · READ ONLY')) + '</span>' + (r.kind === 'batch' ? '<span class="tag amber">' + E(T('Batch recipe')) + '</span>' : '') +
        (r.makes_qty ? '<span class="tag grey">' + E(T('Makes {q}', { q: r.makes_qty + ' ' + (r.makes_unit || '') })) + '</span>' : '') + '</div>' +
        (ph ? '<img class="photo" src="' + ph + '" alt="">' : '') +
        dubaiBlk(T('What the guest is told'), m.foh) + ing + dubaiBlk(T('Mise en place'), m.mise) + dubaiBlk(T('Method'), m.method) + dubaiBlk(T('Plating'), m.plating) + dubaiBlk(T('Garnish'), m.garnish) + dubaiBlk(T('Storage'), m.store) + dubaiBlk(T('Good to know'), m.more) +
        ((r.allergens && r.allergens.length) ? '<div class="row">' + r.allergens.map(function (a) { return '<span class="tag amber">' + E(a) + '</span>'; }).join('') + '</div>' : '') + askBox() + '</div>');
      function up() { if (prev) dubaiCard(prev.id, prev.isBatch, trail.slice(0, -1)); else openMod('recipes', 'dubai'); }
      bindFrame(function () { openMod('recipes', 'dubai'); });
      on('[data-bk]', up);
      var here = { id: id, isBatch: isBatch, name: r.name };
      on('[data-b]', function (b) { dubaiCard(b.getAttribute('data-b'), true, trail.concat([here])); });
      askLoad(isBatch ? 'batch' : 'dubai', id, r.name, function (t) { S.mod = 'recipes'; S.sub = 'dubai'; S.screen = 'mod'; dubaiCard(id, isBatch, trail, t); });
      if (then) then(); else window.scrollTo(0, 0);
    }, function () { main.innerHTML = frame('Recipes', '<div class="card big">' + E(T('Could not load this card.')) + '</div>'); bindFrame(function () { openMod('recipes', 'dubai'); }); });
  }

  // ── breakage (Montenegro: no waste, Francesco 6 Oct 2026) ──
  function modBreakage() {
    var h = '<div class="card stack"><div class="grid2"><label class="f">' + E(T('What')) + '<input type="text" id="bi" placeholder="' + E(T('e.g. wine glass, plate')) + '"></label>' +
      '<label class="f">' + E(T('How many')) + '<input type="text" inputmode="decimal" data-num="1" id="bq" value="1" min="0" step="0.5"></label></div>' +
      '<label class="f">' + E(T('Why it happened')) + '<input type="text" id="br"></label>' +
      '<div class="row"><button class="btn ghost" id="bph">' + E(T('Add a photo')) + '</button><span id="bphs" class="muted"></span></div>' +
      '<input type="file" accept="image/*" capture="environment" id="bfile" style="display:none">' +
      '<div class="msg err" id="bm"></div><button class="btn" id="bs" style="align-self:flex-start">' + E(T('Send')) + '</button></div>';
    main.innerHTML = frame('Breakage', h);
    bindFrame();
    var kind = 'breakage', photo = null;
    document.getElementById('bph').onclick = function () { document.getElementById('bfile').click(); };
    document.getElementById('bfile').onchange = function () { var fl = this.files[0]; if (!fl) return; M.photoFromFile(fl, 1024).then(function (u) { photo = u; document.getElementById('bphs').textContent = T('Photo added.'); }); };
    document.getElementById('bs').onclick = function () {
      var it = document.getElementById('bi').value.trim(); if (it.length < 2) { document.getElementById('bm').textContent = T('Write what.'); return; }
      var q = M.num(document.getElementById('bq').value) || 1, why = document.getElementById('br').value.trim();
      askWho(T('Report: {w}', { w: it }), function (staff, pin) {
        return rpcS('mare_s_breakage', { p_device: dev(), p_token: meToken, p_staff: staff, p_pin: pin || pinArg(), p_kind: kind, p_item: it, p_qty: q, p_reason: why || null, p_photo: photo });
      }).then(function (x) { if (x && x.ok) afterAction(T('Thank you.'), T('The manager will see it.')); });
    };
  }

  // ── leave ──
  var KINDS = { annual: 'Annual', unpaid: 'Unpaid', sick: 'Sick', other: 'Other' };
  function modLeave() {
    var me = meToken ? S.meData : null;
    var h = '<div class="card stack"><div class="grid2"><label class="f">' + E(T('From')) + '<input type="date" id="lf"></label><label class="f">' + E(T('To')) + '<input type="date" id="lt"></label></div>' +
      '<div class="tabs" id="lk">' + Object.keys(KINDS).map(function (k, i) { return '<button data-k="' + k + '" class="' + (i ? '' : 'on') + '">' + E(T(KINDS[k])) + '</button>'; }).join('') + '</div>' +
      '<label class="f">' + E(T('Note (optional)')) + '<input type="text" id="ln"></label><div class="msg err" id="lm"></div>' +
      '<button class="btn" id="ls" style="align-self:flex-start">' + E(T('Ask for it')) + '</button></div>';
    if (me) {
      var yr = M.today().slice(0, 4), used = 0;
      (me.leave || []).forEach(function (l) { if (l.kind === 'annual' && l.status === 'approved' && l.date_from.slice(0, 4) === yr) used += M.daysBetween(l.date_from, l.date_to) + 1; });
      h += '<div class="tot"><div><span>' + E(T('Annual days left')) + '</span><b>' + ((me.annual_days != null ? me.annual_days : 21) - used) + '</b></div><div><span>' + E(T('Taken this year')) + '</span><b>' + used + '</b></div></div>';
      h += (me.leave || []).length ? '<div class="stack">' + me.leave.map(function (l) {
        var st = { pending: ['Waiting', 'amber'], approved: ['Approved', 'green'], declined: ['Declined', 'red'], cancelled: ['Cancelled', 'grey'] }[l.status];
        return '<div class="day"><div><b>' + E(M.shortDate(l.date_from)) + ' → ' + E(M.shortDate(l.date_to)) + '</b><div class="small muted">' + E(T(KINDS[l.kind])) + (l.decision_note ? ' · “' + E(l.decision_note) + '”' : '') + '</div></div><span class="tag ' + st[1] + '">' + E(T(st[0])) + '</span></div>';
      }).join('') + '</div>' : '';
    } else h += '<p class="muted big">' + E(T('To see your requests and days left, open your own phone link.')) + '</p>';
    main.innerHTML = frame('Ask for leave', '<div class="stack">' + h + '</div>');
    bindFrame();
    var kind = 'annual';
    on('#lk [data-k]', function (b) { kind = b.getAttribute('data-k'); main.querySelectorAll('#lk button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
    document.getElementById('ls').onclick = function () {
      var a = document.getElementById('lf').value, b = document.getElementById('lt').value || a, m = document.getElementById('lm'), note = document.getElementById('ln').value;
      if (!a) { m.textContent = T('Pick the dates.'); return; } if (b < a) { m.textContent = T('The end is before the start.'); return; }
      askWho(T('Ask for leave {a} → {b}', { a: M.shortDate(a), b: M.shortDate(b) }), function (staff, pin) {
        return rpcS('mare_s_leave', { p_device: dev(), p_token: meToken, p_staff: staff, p_pin: pin || pinArg(), p_from: a, p_to: b, p_kind: kind, p_note: note });
      }).then(function (x) { if (x && x.ok) afterAction(T('Sent.'), T('The manager will answer. You see the answer on your phone link.')); });
    };
  }

  // ── speak up ──
  function modSpeak() {
    var KS = [['idea', 'An idea'], ['problem', 'A problem'], ['respect', 'Respect at work'], ['other', 'Something else']];
    var h = '<div class="card stack"><p class="big" style="margin:0">' + E(T('Say what you think. No name is needed: nobody will know it was you, not even the manager.')) + '</p>' +
      '<div class="tabs" id="sk">' + KS.map(function (k, i) { return '<button data-k="' + k[0] + '" class="' + (i ? '' : 'on') + '">' + E(T(k[1])) + '</button>'; }).join('') + '</div>' +
      '<label class="f">' + E(T('Your message')) + '<textarea id="st"></textarea></label>' +
      '<label class="f">' + E(T('Your name (only if you want)')) + '<input type="text" id="sn"></label>' +
      '<div class="msg err" id="sm"></div><button class="btn" id="ss" style="align-self:flex-start">' + E(T('Send')) + '</button></div>';
    main.innerHTML = frame('Speak up', h);
    bindFrame(); idle(240000);
    var kind = 'idea';
    on('#sk [data-k]', function (b) { kind = b.getAttribute('data-k'); main.querySelectorAll('#sk button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
    document.getElementById('ss').onclick = function () {
      var t = document.getElementById('st').value.trim(); if (t.length < 3) { document.getElementById('sm').textContent = T('Write a few words first.'); return; }
      this.disabled = true; var btn = this;
      rpcS('mare_s_speak', { p_device: dev(), p_token: meToken, p_kind: kind, p_text: t, p_name: document.getElementById('sn').value.trim() || null }).then(function (x) {
        if (x && x.ok) { if (meToken) { home(); phoneToast(T('Sent. Thank you for saying it.')); } else doneScreen({ custom: T('Sent. Thank you for saying it.'), sub: T('The manager reads every message.') }); }
        else { btn.disabled = false; document.getElementById('sm').textContent = x && x.network ? T('No internet. Try again in a moment.') : T('Something went wrong. Try again.'); }
      });
    };
  }

  // ════════════════ PHONE ════════════════
  function phoneStart() {
    var saved = null; try { saved = sessionStorage.getItem('mare_me_pin'); } catch (e) {}
    M.rpc('mare_me', { p_token: meToken, p_pin: null }).then(function (r) {
      if (r.error) { main.innerHTML = '<div class="card big">' + E(r.error.network ? T('No internet. Try again in a moment.') : T('Something went wrong. Try again.')) + '</div>'; return; }
      var d = r.data;
      if (!d.ok) { main.innerHTML = '<div class="card stack"><h1 class="serif">' + E(T('Link not valid')) + '</h1><p class="big">' + E(T('This link is no longer active. Ask the manager for a new one.')) + '</p></div>'; return; }
      S.meName = d.name;
      if (!d.has_pin) { phoneSetPin(); return; }   // first visit: choose the code here (8 Oct 2026, no tablet needed)
      if (saved) { S.mePin = saved; phoneLoad(); } else phonePin();
    });
  }
  // First time on this link: choose a 4-digit code, then type it again. mare_me_set_pin only
  // works while the person has no code, so a link can never overwrite one.
  function phoneSetPin(msg) {
    S.screen = 'mepin'; S.pin = '';
    var again = !!S.pin1;
    main.innerHTML = '<div class="pinwrap"><div class="pad"><div class="who" style="align-items:center;text-align:center"><div class="act">' + E(again ? T('TYPE IT AGAIN') : T('CHOOSE YOUR CODE')) + '</div><div class="nm serif">' + E(S.meName || '') + '</div></div>' +
      '<div class="lbl">' + E(again ? T('Type the same 4 digits again') : T('Choose a 4-digit code. Keep it to yourself.')) + '</div><div class="dots" id="dots"></div><div class="msg err" id="msg">' + E(msg || '') + '</div><div class="keys" id="keys"></div></div></div>';
    drawKeys(function () {
      if (!S.pin1) { S.pin1 = S.pin; phoneSetPin(); return; }
      if (S.pin1 !== S.pin) { S.pin1 = null; phoneSetPin(T('The two codes were different. Start again.')); return; }
      var chosen = S.pin; S.pin1 = null;
      M.rpc('mare_me_set_pin', { p_token: meToken, p_pin: chosen }).then(function (r) {
        if (r.error) { phoneSetPin(r.error.network ? T('No internet. Try again in a moment.') : T('Something went wrong. Try again.')); return; }
        if (!r.data.ok && r.data.error !== 'already_set') { phoneSetPin(T('Something went wrong. Try again.')); return; }
        if (!r.data.ok) { phonePin(); return; }   // a code was set meanwhile (e.g. on the tablet): type that one
        S.mePin = chosen; phoneLoad();
      });
    });
  }
  function phonePin(msg) {
    S.screen = 'mepin'; S.pin = '';
    main.innerHTML = '<div class="pinwrap"><div class="pad"><div class="who" style="align-items:center;text-align:center"><div class="act">' + E(T('MY MARE')) + '</div><div class="nm serif">' + E(S.meName || '') + '</div></div>' +
      '<div class="lbl">' + E(T('Your 4-digit code')) + '</div><div class="dots" id="dots"></div><div class="msg err" id="msg">' + E(msg || '') + '</div><div class="keys" id="keys"></div></div></div>';
    drawKeys(function () { S.mePin = S.pin; phoneLoad(); });
  }
  function phoneLoad(quiet) {
    if (PREVIEW) return M.rpc('mare_m_view_as', { p_staff: VIEWAS }, PV_TOKEN).then(function (r) {
      if (!r.data || !r.data.ok) { previewFail(); return; }
      S.feed = r.data; S.meData = r.data.me; S.meId = r.data.me.id; S.meName = r.data.me.name; if (!quiet) home();
    });
    return M.rpc('mare_s_feed', { p_device: null, p_token: meToken, p_pin: S.mePin }).then(function (x) {
      if (x.error) { if (!quiet) phonePin(x.error.network ? T('No internet. Try again.') : T('Something went wrong.')); return; }
      if (!x.data.ok) { try { sessionStorage.removeItem('mare_me_pin'); } catch (e) {} phonePin(x.data.error === 'locked' ? T('Too many wrong codes. Wait 15 minutes or ask the manager.') : T('Wrong code. Try again.')); return; }
      try { sessionStorage.setItem('mare_me_pin', S.mePin); } catch (e) {}
      S.feed = x.data; S.meData = x.data.me; S.meId = x.data.me.id; S.meName = x.data.me.name;
      if (!quiet) home();
    });
  }
  function phoneToast(t) { var d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#1E2A2C;color:#fff;border-radius:999px;padding:12px 20px;font-weight:700;z-index:60;max-width:90vw;text-align:center'; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3500); }
  function weekMin(sh, ws) { var t = 0; sh.forEach(function (s) { if (s.min != null && s.date >= ws && s.date < M.addDays(ws, 7)) t += s.min; }); return t; }
  // ── the staff phone (Concierge): next shift, today's briefing, the figures, and a bottom bar ──
  function bnav(active) {
    var b = document.getElementById('bnav');
    if (!b) { b = document.createElement('nav'); b.id = 'bnav'; b.className = 'bnav'; b.setAttribute('aria-label', T('Sections')); document.body.appendChild(b);
      b.addEventListener('click', function (e) { var x = e.target.closest('[data-b]'); if (!x) return; var k = x.getAttribute('data-b'); if (k === 'today') home(); else openMod(k); }); }
    var tm = teamMods().map(function (m) { return m[0]; });
    var items = [['today', 'Today'], ['rota', 'Schedule'], ['recipes', 'Recipes'], ['kclose', 'Report'], ['more', 'More']].filter(function (x) { return x[0] === 'today' || (x[0] === 'more' ? moreTiles().length > 0 : tm.indexOf(x[0]) >= 0); });
    b.style.gridTemplateColumns = 'repeat(' + items.length + ',minmax(0,1fr))';
    b.innerHTML = items.map(function (x) { return '<button data-b="' + x[0] + '" class="' + (x[0] === active ? 'on' : '') + '"><i></i>' + E(T(x[1])) + '</button>'; }).join('');
  }
  function phoneHome() {
    if (!S.feed || !S.meData) { phoneLoad(); return; }
    S.screen = 'home';
    var f = S.feed, me = S.meData, sh = M.shifts(me.punches, new Date(f.now)), open = sh.filter(function (s) { return s.live; })[0];
    var next = f.shifts.filter(function (x) { return x.staff_id === me.id && x.date >= f.today && x.kind === 'work'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
    var hr = M.parts(new Date()).hh, greet = hr < 12 ? T('Good morning') : hr < 18 ? T('Good afternoon') : T('Good evening');
    var mates = next ? f.shifts.filter(function (x) { return x.date === next.date && x.kind === 'work' && x.staff_id !== me.id && f.staff.some(function (s) { return s.id === x.staff_id && s.team === me.team; }); })
      .map(function (x) { return (f.staff.filter(function (s) { return s.id === x.staff_id; })[0] || {}).name; }).filter(Boolean) : [];
    var b = f.briefing, read = f.reads.indexOf(me.id) >= 0, tm = teamMods().map(function (m) { return m[0]; });
    var yr = M.today().slice(0, 4), used = 0;
    (me.leave || []).forEach(function (l) { if (l.kind === 'annual' && l.status === 'approved' && l.date_from.slice(0, 4) === yr) used += M.daysBetween(l.date_from, l.date_to) + 1; });
    var h = '<div><div class="sec" style="margin-bottom:8px"><span>' + E(M.niceDate(f.today).toUpperCase()) + '</span><i></i></div><h1 class="serif">' + E(greet + ', ' + me.name.split(' ')[0]) + '</h1></div>';
    h += '<div class="card nextshift">' + (open
      ? '<div class="k">' + E(T('AT WORK')) + '</div><div class="v">' + E(T('In since {t}', { t: M.hhmm(open.inP.at) })) + '</div>'
      : '<div class="k">' + E(T('YOUR NEXT SHIFT')) + '</div><div class="v">' + (next ? E((next.date === f.today ? T('Today') : M.shortDate(next.date)) + ' · ' + (next.start_t || '') + ' – ' + (next.end_t || '')) : E(T('No shift on the rota yet'))) + '</div>') +
      (mates.length ? '<div class="s">' + E(T('With {n}', { n: mates.slice(0, 3).join(', ') })) + '</div>' : '') + '</div>';
    if (tm.indexOf('brief') >= 0) {
      h += '<div class="card" style="display:flex;flex-direction:column"><div class="row between"><span class="sec" style="flex:1"><span>' + E(T('Today\'s briefing')) + '</span></span>' +
        (b ? (read ? '<span class="tag green">' + E(T('Read')) + '</span>' : '<span class="tag red">' + E(T('Not read')) + '</span>') : '') + '</div>' +
        (b ? '<div class="bexc">' + [['specials', 'Specials'], ['eighty_six', 'Not today'], ['allergies', 'Allergies']].filter(function (q) { return b[q[0]]; }).slice(0, 3).map(function (q) {
          return '<i>' + E(T(q[1])) + '</i> — ' + E(b[q[0]]); }).join('<br>') + '</div><button class="lnk" data-open="brief">' + E(read ? T('Open the briefing') : T('Read all & sign')) + '</button>'
          : '<div class="bexc muted"><i>' + E(T('Today\'s briefing is not written yet.')) + '</i></div>') + '</div>';
    }
    // Hours and leave only when they mean something: no clock-ins yet would read "0:00 this week".
    var hasClock = (me.punches || []).length > 0, hasLeave = tm.indexOf('leave') >= 0;
    if (hasClock || hasLeave) h += '<div class="tot">' + (hasClock ? '<div><span>' + E(T('Hours this week')) + '</span><b>' + M.durShort(weekMin(sh, M.weekStart(f.today))) + '</b></div>' : '') +
      (hasLeave ? '<div><span>' + E(T('Leave days left')) + '</span><b>' + ((me.annual_days != null ? me.annual_days : 21) - used) + '</b></div>' : '') + '</div>';
    var cards = teamMods().filter(function (m) { return m[0] === 'rota' || m[0] === 'recipes' || m[0] === 'kclose'; });
    if (cards.length) h += '<div class="mods">' + cards.map(function (m) { var st = modStat(m[0]);
      return '<button class="mod" data-open="' + m[0] + '"><span class="ic">' + M.icon(m[1], 22) + '</span><b>' + E(T(m[2])) + '</b><span class="s' + (st[1] ? ' alert' : '') + '">' + E(st[0]) + '</span></button>'; }).join('') + '</div>';
    if (hasClock) h += '<div class="small muted" style="text-align:center;font-family:\'Cormorant Garamond\',serif;font-style:italic;font-size:17px">' + E(T('Clock in at the tablet by the staff entrance.')) + '</div>';
    main.innerHTML = h;
    on('[data-open]', function (x) { openMod(x.getAttribute('data-open')); });
    bnav('today');
  }
  // "More" holds what the bottom bar does not: My hours once the person has clock-ins, and any other module switched on.
  function moreTiles() {
    var hasClock = !!(S.meData && (S.meData.punches || []).length);
    return (hasClock ? [['hours', 'hours', 'My hours']] : []).concat(teamMods().filter(function (m) { return m[0] !== 'rota' && m[0] !== 'recipes' && m[0] !== 'kclose'; }));
  }
  function modMore() {
    var tiles = moreTiles();
    main.innerHTML = frame('More', '<div class="mods">' + tiles.map(function (m) { var s = m[0] === 'hours' ? ['', false] : modStat(m[0]);
      return '<button class="mod" data-mod="' + m[0] + '"><span class="ic">' + M.icon(m[1], 22) + '</span><b>' + E(T(m[2])) + '</b><span class="s' + (s[1] ? ' alert' : '') + '">' + E(s[0]) + '</span></button>'; }).join('') + '</div>');
    bindFrame();
    on('[data-mod]', function (b) { openMod(b.getAttribute('data-mod')); });
  }
  function modHours() {
    var f = S.feed, me = S.meData, now = new Date(f.now), today = f.today, sh = M.shifts(me.punches, now);
    var thisW = M.weekStart(today), lastW = M.addDays(thisW, -7);
    function rows(ws) {
      var out = '';
      for (var i = 6; i >= 0; i--) {
        var k = M.addDays(ws, i); if (k > today) continue;
        var ds = sh.filter(function (s) { return s.date === k; }), tot = 0, lines = [], notes = [];
        ds.forEach(function (s) {
          if (s.min != null) tot += s.min;
          lines.push((s.inP ? M.hhmm(s.inP.at) : '?') + ' → ' + (s.outP ? M.hhmm(s.outP.at) : (s.live ? T('still in') : '?')));
          if (s.missing) notes.push(T('No clock-out yet. The manager will check it.'));
          if ((s.inP && s.inP.source === 'manager') || (s.outP && s.outP.source === 'manager')) notes.push(T('A time here was entered by the manager.'));
        });
        out += '<div class="day' + (k === today ? ' today' : '') + '"><div><b>' + E(M.shortDate(k)) + (k === today ? ' · ' + E(T('today')) : '') + '</b><div class="small muted">' + (lines.length ? E(lines.join(' · ')) : E(T('Day off'))) + '</div>' +
          notes.map(function (n) { return '<div class="note">' + E(n) + '</div>'; }).join('') + '</div><b>' + (lines.length ? M.dur(tot) : '—') + '</b></div>';
      }
      return out;
    }
    main.innerHTML = frame('My hours', '<div class="stack"><div class="tot"><div><span>' + E(T('This week')) + '</span><b>' + M.dur(weekMin(sh, thisW)) + '</b></div><div><span>' + E(T('Last week')) + '</span><b>' + M.dur(weekMin(sh, lastW)) + '</b></div></div>' +
      '<div class="muted" style="letter-spacing:2px;font-weight:700">' + E(T('This week').toUpperCase()) + '</div>' + rows(thisW) +
      '<div class="muted" style="letter-spacing:2px;font-weight:700">' + E(T('Last week').toUpperCase()) + '</div>' + rows(lastW) + '</div>');
    bindFrame();
  }
  start();
})();
