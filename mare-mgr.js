/* Roberto's Mare — management app core: sign-in, home, navigation, helpers,
   and the Attendance, People and Tablet modules. Other modules register
   themselves from mare-mgr-ops.js and mare-mgr-back.js. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc;
  var App = { S: { token: null, me: null, staff: [], mod: null, sub: null }, mods: {}, order: [] };
  w.MareApp = App;
  var sb = null;

  // ── helpers every module uses ──
  App.say = function (t) { var s = document.getElementById('status'); s.textContent = t; s.style.display = 'block'; clearTimeout(App.say.t); App.say.t = setTimeout(function () { s.style.display = 'none'; }, 2800); };
  // While "viewing as" a colleague, only reads go through: the screens are theirs, the account is still yours.
  var READS = ['mare_mgr_overview', 'mare_m_fetch', 'mare_mgr_photos', 'mare_m_photo', 'mare_m_managers', 'mare_m_view_as', 'mare_m_recipe', 'mare_m_media_list', 'mare_m_media_get'];
  App.call = function (name, args) {
    if (App.S.viewAs && READS.indexOf(name) < 0) { App.say(T('Read only: you are viewing as {n}. Nothing is saved.', { n: App.S.viewAs.name })); return Promise.resolve(null); }
    return M.rpc(name, args, App.S.token).then(function (r) {
      if (r.error) {
        if (r.error.status === 401) { App.signIn(T('Please sign in again.')); return null; }
        App.say(r.error.network ? T('No internet. Nothing was saved.') : T('Something went wrong: {m}', { m: r.error.message })); return null;
      }
      if (r.data && r.data.ok === false) { App.say(r.data.error === 'access' ? T('Your account has no Mare access.') : T('Not saved: {m}', { m: r.data.error })); return null; }
      return r.data;
    });
  };
  // An edge function, as the signed-in manager.
  App.fn = function (name, body) {
    if (App.S.viewAs) { App.say(T('Read only: you are viewing as {n}. Nothing is saved.', { n: App.S.viewAs.name })); return Promise.resolve(null); }
    return fetch(M.SB_URL + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: M.SB_KEY, Authorization: 'Bearer ' + App.S.token }, body: JSON.stringify(body || {}) })
      .then(function (r) { if (r.status === 401) { App.signIn(T('Please sign in again.')); return null; } return r.json(); })
      .catch(function () { App.say(T('No internet. Nothing was saved.')); return null; });
  };
  App.fetch = function (tables, from, to) { return App.call('mare_m_fetch', { p_tables: tables, p_from: from || M.today(), p_to: to || M.today() }); };
  App.save = function (table, row) { return App.call('mare_m_save', { p_table: table, p_row: row }).then(function (r) { return r && r.row; }); };
  App.register = function (key, def) { def.key = key; App.mods[key] = def; App.order.push(key); };
  // Delegated handler; binding the same selector again REPLACES the old handler
  // (screens redraw in place, and must not stack duplicate clicks).
  App.on = function (root, sel, fn, ev) {
    ev = ev || 'click'; root._mh = root._mh || {}; var key = ev + '|' + sel;
    if (!root._mh[key]) root.addEventListener(ev, function (e) { var t = e.target.closest(sel); if (t && root.contains(t)) root._mh[key](t, e); });
    root._mh[key] = fn;
  };
  // Drag to reorder (mouse and touch). The WHOLE row is the handle; inputs and
  // buttons inside it still work. onDrop gets the new order of data-id values.
  App.sortable = function (list, onDrop) {
    var drag = null;
    list.addEventListener('pointerdown', function (e) {
      var row = e.target.closest('[data-id]'); if (!row || !list.contains(row) || e.target.closest('input,button,select,textarea,label,a')) return;
      // On touch only the grip drags, so a finger on the row still scrolls the page.
      if (e.pointerType === 'touch' && !e.target.closest('.grip')) return;
      drag = { row: row, y0: e.clientY, on: false, id: e.pointerId };
    });
    list.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.on) { if (Math.abs(e.clientY - drag.y0) < 6) return; drag.on = true; drag.row.style.opacity = '.6'; drag.row.style.background = 'var(--tint-2)'; try { list.setPointerCapture(drag.id); } catch (x) {} }
      e.preventDefault();
      var rows = Array.prototype.slice.call(list.querySelectorAll(':scope > [data-id]'));
      var over = rows.filter(function (r) { var b = r.getBoundingClientRect(); return e.clientY > b.top && e.clientY < b.bottom; })[0];
      if (!over || over === drag.row) return;
      var b = over.getBoundingClientRect();
      list.insertBefore(drag.row, e.clientY < b.top + b.height / 2 ? over : over.nextSibling);
    });
    function end() {
      if (!drag) return; var was = drag.on; drag.row.style.opacity = ''; drag.row.style.background = ''; drag = null;
      if (was) onDrop(Array.prototype.map.call(list.querySelectorAll(':scope > [data-id]'), function (r) { return r.getAttribute('data-id'); }));
    }
    list.addEventListener('pointerup', end); list.addEventListener('pointercancel', end);
  };
  App.grip = '<span class="grip" aria-hidden="true" style="touch-action:none;cursor:grab;color:#9A8F83;padding:6px 4px;font-size:20px;line-height:1">⋮⋮</span>';
  App.val = function (root, sel) { var el = root.querySelector(sel); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : null; };
  App.staffName = function (id) { var s = App.S.staff.filter(function (x) { return x.id === id; })[0]; return s ? s.name : '—'; };
  App.overlay = function (html) {
    var o = document.createElement('div'); o.className = 'overlay';
    o.innerHTML = '<div class="card" role="dialog">' + html + '</div>';
    document.body.appendChild(o);
    o.close = function () { o.remove(); };
    o.addEventListener('click', function (e) { if (e.target === o || e.target.closest('[data-close]')) o.close(); });
    return o;
  };
  App.photo = function (table, id) { return App.call('mare_m_photo', { p_table: table, p_id: id }).then(function (r) { return r && M.safeJpeg(r.photo); }); };
  App.empty = function (t) { return '<div class="empty">' + E(t) + '</div>'; };
  App.reload = function () { var y = w.scrollY; return App.render().then(function () { w.scrollTo(0, y); }); };

  // ── language switch (any page) ──
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lang]'); if (!b) return;
    M.setLang(b.getAttribute('data-lang')); document.documentElement.lang = M.lang() === 'me' ? 'sr-Latn-ME' : 'en'; App.reload();
  });
  document.documentElement.lang = M.lang() === 'me' ? 'sr-Latn-ME' : 'en';

  // ── sign-in ──
  App.start = function () {
    sb = supabase.createClient(M.SB_URL, M.SB_KEY);
    sb.auth.onAuthStateChange(function (ev, s) { if (s) App.S.token = s.access_token; });
    // A personal test link (mare.html?try=…) signs the reviewer in as himself: no password.
    var tryTok = new URLSearchParams(location.search).get('try');
    if (tryTok) {
      history.replaceState(null, '', location.pathname + location.hash);
      fetch(M.SB_URL + '/functions/v1/mare-try', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: M.SB_KEY, Authorization: 'Bearer ' + M.SB_KEY }, body: JSON.stringify({ token: tryTok }) })
        .then(function (r) { return r.json(); })
        .then(function (x) { if (!x || !x.ok) throw new Error('link'); return sb.auth.verifyOtp({ token_hash: x.token_hash, type: 'magiclink' }); })
        .then(function (v) { if (v.error || !v.data.session) throw new Error('otp'); App.S.token = v.data.session.access_token; App.S.email = (v.data.session.user.email || '').toLowerCase(); App.boot(); },
              function () { App.signIn(T('This test link has expired. Sign in with your Roberto’s login, or ask Francesco for a new link.')); });
    } else
    sb.auth.getSession().then(function (x) {
      var s = x.data && x.data.session;
      if (!s) { App.signIn(); return; }
      App.S.token = s.access_token; App.S.email = (s.user && s.user.email || '').toLowerCase(); App.boot();
    });
    w.addEventListener('hashchange', function () { App.fromHash(); App.render(); });
  };
  App.signIn = function (err) {
    var a = document.getElementById('app');
    a.innerHTML = '<div class="hero" style="min-height:100vh;justify-content:center"><div class="hero-top"><span></span>' + M.langSwitch() + '</div>' +
      '<div style="padding:20px 16px 60px"><form class="signin card" id="f" style="color:var(--ink)">' +
      '<div class="row"><img src="mare-logo-teal.svg" alt="" style="width:56px;height:56px"><h2 class="serif">' + E(T('Sign in')) + '</h2></div>' +
      '<p class="muted" style="margin:0">' + E(T('Use your Roberto\'s app account.')) + '</p>' +
      '<label class="f" for="em">' + E(T('Email')) + '<input id="em" type="email" autocomplete="username" required></label>' +
      '<label class="f" for="pw">' + E(T('Password')) + '<input id="pw" type="password" autocomplete="current-password" required></label>' +
      '<div class="err">' + E(err || '') + '</div><button class="btn" type="submit">' + E(T('Sign in')) + '</button></form></div></div>';
    document.getElementById('f').onsubmit = function (ev) {
      ev.preventDefault();
      sb.auth.signInWithPassword({ email: document.getElementById('em').value.trim(), password: document.getElementById('pw').value }).then(function (r) {
        if (r.error) { App.signIn(T('Email or password not right.')); return; }
        App.S.token = r.data.session.access_token; App.S.email = (r.data.session.user.email || '').toLowerCase(); App.boot();
      });
    };
  };
  App.signOut = function () { sb.auth.signOut().then(function () { App.S.token = null; App.signIn(); }); };

  App.boot = function () {
    return M.rpc('mare_mgr_overview', { p_from: M.today(), p_to: M.today() }, App.S.token).then(function (r) {
      if (r.error) { if (r.error.status === 401) { App.signIn(T('Please sign in again.')); return; } document.getElementById('app').innerHTML = '<div class="wrap" style="padding-top:40px">' + App.empty(T('No internet. Try again in a moment.')) + '</div>'; return; }
      if (!r.data.ok) {
        document.getElementById('app').innerHTML = '<div class="wrap" style="padding-top:40px"><div class="card" style="max-width:560px"><h2 class="serif">' + E(T('No access')) + '</h2><p>' +
          E(T('This app is for the Roberto\'s Mare team. Ask Francesco to give your account Mare access.')) + '</p><button class="btn ghost" id="so">' + E(T('Sign out')) + '</button></div></div>';
        document.getElementById('so').onclick = App.signOut; return;
      }
      App.S.me = r.data.me; App.S.staff = r.data.staff;
      return App.loadMyMods().then(function () { App.fromHash(); App.render(); });
    }).then(function () {
      setInterval(function () {
        var a = document.activeElement;
        if (document.visibilityState !== 'visible' || document.querySelector('.overlay') || (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) return;
        if (!App.S.mod || (App.mods[App.S.mod] && App.mods[App.S.mod].live)) App.reload();
      }, 90000);
    });
  };
  // Which Mare modules this login may open (Mare app → View as → Modules). No entry = all.
  App.loadMyMods = function () {
    return M.rpc('mare_m_fetch', { p_tables: ['settings'], p_from: M.today(), p_to: M.today() }, App.S.token).then(function (r) {
      var mm = r.data && r.data.ok && (r.data.settings.filter(function (s) { return s.key === 'mgr_modules'; })[0] || {}).value;
      App.S.myMods = (mm && App.S.email && Array.isArray(mm[App.S.email])) ? mm[App.S.email] : null;
    });
  };
  App.allowed = function (k) { var mods = App.S.viewAs ? App.S.viewAs.mods : App.S.myMods; return !mods || mods.indexOf(k) >= 0 || (k === 'viewas' && !App.S.viewAs && !App.S.myMods); };
  App.banner = function () {
    if (!App.S.viewAs) return '';
    return '<div class="vabar">' + M.icon('eye', 18) + '<span>' + E(T('Viewing as {n} — read only', { n: App.S.viewAs.name })) + '</span><button data-vaback>' + E(T('Switch back')) + '</button></div>';
  };
  document.addEventListener('click', function (e) { if (e.target.closest('[data-vaback]')) { App.S.viewAs = null; App.go('viewas'); } });
  App.refreshStaff = function () {
    return M.rpc('mare_mgr_overview', { p_from: M.today(), p_to: M.today() }, App.S.token).then(function (r) { if (r.data && r.data.ok) App.S.staff = r.data.staff; });
  };

  // ── routing: #module/sub ──
  App.fromHash = function () {
    var h = (location.hash || '').replace(/^#/, '').split('/');
    App.S.mod = App.mods[h[0]] ? h[0] : null; App.S.sub = h[1] || null;
  };
  App.go = function (mod, sub) { var h = mod ? '#' + mod + (sub ? '/' + sub : '') : '#'; if (location.hash === h || (!mod && !location.hash)) { App.fromHash(); App.render(); } else location.hash = h; };

  // ── the Concierge shell: a teal side menu + the page ──
  var GROUPS = [['today', 'Daily service'], ['team', 'Team'], ['kitchen', 'Kitchen & cost'], ['setup', 'Set-up']];
  App.S.counts = {};
  App.side = function () {
    var cur = App.S.mod || '';
    var h = '<aside class="side" id="side"><div class="side-top"><img src="mare-logo-white.svg" alt="Roberto\'s Mare"><div class="side-k">PORTO MONTENEGRO</div></div>' +
      '<nav class="side-nav" aria-label="' + E(T('Modules')) + '"><button class="sn' + (!cur ? ' on' : '') + '" data-nav="">' + E(T('Today')) + '</button>';
    GROUPS.forEach(function (g) {
      var ms = App.order.filter(function (k) { return App.mods[k].group === g[0] && App.allowed(k); });
      if (!ms.length) return;
      h += '<div class="sg">' + E(T(g[1]).toUpperCase()) + '</div>' + ms.map(function (k) {
        var c = App.S.counts[k];
        return '<button class="sn' + (cur === k ? ' on' : '') + '" data-nav="' + k + '"><span>' + E(T(App.mods[k].title)) + '</span>' + (c ? '<span class="cnt">' + c + '</span>' : '') + '</button>';
      }).join('');
    });
    h += '</nav><div class="side-foot">' + M.langSwitch() + '<div class="side-me">' + E(App.S.me || '') + '</div>' +
      '<div class="side-links"><a href="./">' + E(T('Roberto\'s FOH')) + ' &rarr;</a><button id="so">' + E(T('Sign out')) + '</button></div></div></aside>';
    return h;
  };
  App.shell = function (inner) {
    var a = document.getElementById('app');
    a.innerHTML = App.banner() + '<div class="shell">' + App.side() +
      '<div class="page"><div class="mtop"><button class="burger" id="burger" aria-label="' + E(T('Menu')) + '"><span></span><span></span><span></span></button>' +
      '<img src="mare-logo-white.svg" alt=""><span class="mtop-t serif">Roberto\'s Mare</span></div>' + inner + '</div><div class="scrim" id="scrim"></div></div>';
    App.on(a, '[data-nav]', function (b) { document.body.classList.remove('menu-open'); App.go(b.getAttribute('data-nav') || null); });
    a.querySelector('#so').onclick = App.signOut;
    a.querySelector('#burger').onclick = function () { document.body.classList.add('menu-open'); };
    a.querySelector('#scrim').onclick = function () { document.body.classList.remove('menu-open'); };
    return a;
  };
  function strip(title, kicker, big) {
    return '<header class="pstrip' + (big ? ' big' : '') + '"><div class="pstrip-in"><div class="pk">' + E(kicker) + '</div><h1 class="serif">' + E(title) + '</h1></div></header>';
  }
  App.sec = function (title) { return '<div class="sec"><span>' + E(title) + '</span><i></i></div>'; };

  App.render = function () {
    if (App.S.mod && !App.allowed(App.S.mod)) App.S.mod = null;
    if (!App.S.mod) return App.home();
    var def = App.mods[App.S.mod];
    var sub = App.S.sub || (def.tabs ? def.tabs[0][0] : null);
    var grp = (GROUPS.filter(function (g) { return g[0] === def.group; })[0] || ['', ''])[1];
    var a = App.shell(strip(T(def.title), T(grp).toUpperCase() + ' · ' + M.niceDate(M.today()).toUpperCase()) +
      (def.tabs ? '<div class="tabs" role="tablist">' + def.tabs.map(function (t) { return '<button role="tab" data-tab="' + t[0] + '" class="' + (t[0] === sub ? 'on' : '') + '">' + E(T(t[1])) + '</button>'; }).join('') + '</div>' : '') +
      '<main id="main"><div class="muted">' + E(T('Loading…')) + '</div></main>');
    Array.prototype.forEach.call(a.querySelectorAll('[data-tab]'), function (b) { b.onclick = function () { App.go(def.key, b.getAttribute('data-tab')); }; });
    w.scrollTo(0, 0);
    var main = document.getElementById('main');
    return Promise.resolve(def.render(main, sub)).catch(function (e) { main.innerHTML = App.empty(T('Something went wrong: {m}', { m: e && e.message })); console.error(e); });
  };

  // ── Today: what needs Milica, tonight, who is in, the month so far ──
  App.home = function () {
    var t = M.today(), hr = M.parts(new Date()).hh;
    var greet = hr < 12 ? T('Good morning') : hr < 18 ? T('Good afternoon') : T('Good evening');
    var first = ((App.S.viewAs ? App.S.viewAs.name : App.S.me) || '').split(' ')[0];
    App.shell(strip(greet + (first ? ', ' + first : ''), M.niceDate(t).toUpperCase(), true) +
      '<main id="main" class="today"><div class="muted">' + E(T('Loading…')) + '</div></main>');
    var main = document.getElementById('main'), ms = M.monthStart(t);
    return Promise.all([
      M.rpc('mare_mgr_overview', { p_from: M.addDays(t, -13), p_to: t }, App.S.token),
      App.fetch(['shifts', 'briefings', 'reads', 'leave', 'speakup', 'ticks', 'check_items', 'actions', 'breakage', 'settings'], M.addDays(t, -13), t),
      App.fetch(['closing', 'purchases'], ms, t)
    ]).then(function (res) {
      var ov = res[0].data, f = res[1], mo = res[2]; if (!ov || !ov.ok || !f || !mo) { main.innerHTML = App.empty(T('Could not load.')); return; }
      App.S.staff = ov.staff;
      var d = index(JSON.parse(JSON.stringify(ov)), f.shifts), act = d.staff.filter(function (s) { return s.active; });
      // needs you
      var needs = [];
      act.forEach(function (s) {
        s.shifts.forEach(function (x) { if ((x.missing || x.orphan) && x.date >= M.addDays(t, -13)) needs.push({ mod: 'attendance', t: T(x.missing ? '{n} forgot to clock out' : '{n} has no clock-in', { n: s.name }), s: M.niceDate(x.date), go: T('Resolve') }); });
        for (var i = 0; i < 7; i++) { var k = M.addDays(t, -i), di = dayInfo(d, s, k);
          if (di.late && !d.noteKey[s.id + '|' + k + '|late_accepted'] && !d.noteKey[s.id + '|' + k + '|warning']) needs.push({ mod: 'attendance', t: T('{n} arrived {m} minutes late', { n: s.name, m: di.late }), s: M.niceDate(k) + ' · ' + T('due {d}', { d: di.due }), go: T('Review') }); }
      });
      f.leave.filter(function (l) { return l.status === 'pending'; }).forEach(function (l) { needs.push({ mod: 'leave', t: T('{n} asks for leave', { n: App.staffName(l.staff_id) }), s: M.shortDate(l.date_from) + ' – ' + M.shortDate(l.date_to), go: T('Decide') }); });
      var sp = f.speakup.filter(function (x) { return x.status === 'new'; }).length;
      if (sp) needs.push({ mod: 'speakup', t: T('{n} new messages in Speak up', { n: sp }), s: T('Anonymous, from the team'), go: T('Read') });
      var br = f.breakage.filter(function (b) { return !b.reviewed; }).length;
      if (br) needs.push({ mod: 'stock', t: T('{n} breakage or waste to check', { n: br }), s: T('Write in the cost and tick Checked'), go: T('Check') });
      needs = needs.filter(function (n) { return App.allowed(n.mod); });
      // sidebar counters
      var miss = needs.filter(function (n) { return n.mod === 'attendance'; }).length;
      App.S.counts = { attendance: miss || 0, leave: f.leave.filter(function (l) { return l.status === 'pending'; }).length, speakup: sp, stock: br };
      Object.keys(App.S.counts).forEach(function (k) { if (!App.S.counts[k]) delete App.S.counts[k]; });
      var nav = document.querySelector('.side-nav'); if (nav) { var tmp = document.createElement('div'); tmp.innerHTML = App.side(); nav.innerHTML = tmp.querySelector('.side-nav').innerHTML; }
      // tonight
      var b = f.briefings.filter(function (x) { return x.date === t; })[0], reads = f.reads.filter(function (r) { return r.date === t; }).length;
      var onToday = act.filter(function (s) { var di = dayInfo(d, s, t); return di.shifts.length || (di.due && !di.off); }).length;
      // who is in
      var inNow = [], later = [];
      act.forEach(function (s) { var di = dayInfo(d, s, t);
        if (di.live) inNow.push({ n: s.name, team: s.team, since: M.hhmm(di.shifts.filter(function (x) { return x.live; })[0].inP.at), late: di.late });
        else if (di.due && !di.off && !di.shifts.length) later.push({ n: s.name, team: s.team, due: di.due }); });
      later.sort(function (x, y) { return x.due < y.due ? -1 : 1; });
      // month so far
      var sales = 0, food = 0, fb = 0; mo.closing.forEach(function (c) { sales += (+c.food || 0) + (+c.beverage || 0) + (+c.other || 0); food += +c.food || 0; });
      mo.purchases.forEach(function (p) { if (!p.voided && p.category === 'food') fb += +p.amount; });
      var h = '<div class="tgrid"><div class="tcol">';
      if (App.allowed('attendance') || App.allowed('leave')) {
        h += '<section>' + App.sec(T('Needs you') + ' · ' + needs.length) + (needs.length ? '<div class="card list">' + needs.map(function (n, i) {
          return '<button class="li" data-go="' + n.mod + '"><span class="li-t"><b class="serif">' + E(n.t) + '</b><span>' + E(n.s) + '</span></span><span class="li-go">' + E(n.go.toUpperCase()) + '</span></button>';
        }).join('') + '</div>' : '<div class="card calm serif">' + E(T('Nothing waiting. A calm day.')) + '</div>') + '</section>';
      }
      if (App.allowed('briefing')) {
        h += '<section>' + App.sec(T('Tonight')) + '<div class="card"><div class="figs">' +
          '<div><b>' + (b && b.covers_lunch != null ? b.covers_lunch : '—') + '</b><span>' + E(T('Covers · lunch').toUpperCase()) + '</span></div>' +
          '<div><b>' + (b && b.covers_dinner != null ? b.covers_dinner : '—') + '</b><span>' + E(T('Covers · dinner').toUpperCase()) + '</span></div>' +
          '<div><b>' + (b ? reads + '<small> / ' + onToday + '</small>' : '—') + '</b><span>' + E(T('Read the briefing').toUpperCase()) + '</span></div></div>' +
          (b ? '<div class="excerpt serif">' + [['specials', 'Specials'], ['eighty_six', 'Not today'], ['allergies', 'Allergies'], ['vip', 'Bookings']].filter(function (q) { return b[q[0]]; }).map(function (q) {
            return '<i>' + E(T(q[1])) + '</i> — ' + E(b[q[0]]); }).join('<br>') + '</div>' : '<div class="excerpt serif"><i>' + E(T('Today\'s briefing is not written yet.')) + '</i></div>') +
          '<button class="lnk" data-go="briefing">' + E((b ? T('Open the briefing') : T('Write the briefing')).toUpperCase()) + '</button></div></section>';
      }
      h += '</div><div class="tcol">';
      if (App.allowed('attendance')) {
        h += '<section>' + App.sec(T('Who is in')) + '<div class="card list">' +
          (inNow.length ? inNow.map(function (p) { return '<div class="li"><span>' + E(p.n) + ' · <span class="muted">' + E(T(p.team)) + '</span></span><span class="li-in">' + E(T('since {t}', { t: p.since })) + (p.late ? ' · <em>' + E(T('late {m}′', { m: p.late })) + '</em>' : '') + '</span></div>'; }).join('') : '<div class="li muted">' + E(T('Nobody is in yet.')) + '</div>') +
          later.slice(0, 6).map(function (p) { return '<div class="li muted"><span>' + E(p.n) + ' · ' + E(T(p.team)) + '</span><span>' + E(T('due {d}', { d: p.due })) + '</span></div>'; }).join('') + '</div></section>';
      }
      if (App.allowed('closing') || App.allowed('costing')) {
        h += '<section>' + App.sec(M.monthName(ms) + ' · ' + T('so far')) + '<div class="card"><div class="figs two">' +
          '<div><b>' + M.money0(sales) + '</b><span>' + E(T('Sales').toUpperCase()) + '</span></div>' +
          '<div><b>' + (M.pct(fb, food) != null ? M.pct(fb, food) + '%' : '—') + '</b><span>' + E(T('Food cost').toUpperCase()) + '</span></div></div>' +
          '<div class="small muted" style="margin-top:10px">' + E(T('{n} closing reports this month', { n: mo.closing.length })) + '</div></div></section>';
      }
      main.innerHTML = h + '</div></div>';
      App.on(main, '[data-go]', function (x) { App.go(x.getAttribute('data-go')); });
    });
  };

  // ════════════════ ATTENDANCE ════════════════
  function index(d, rota) {
    var now = new Date(d.now);
    d.byId = {}; d.staff.forEach(function (s) { d.byId[s.id] = s; s.punches = []; });
    d.punches.forEach(function (p) { var s = d.byId[p.staff_id]; if (s) s.punches.push(p); });
    d.staff.forEach(function (s) { s.shifts = M.shifts(s.punches, now); });
    d.noteKey = {}; (d.notes || []).forEach(function (n) { d.noteKey[n.staff_id + '|' + n.ref_date + '|' + n.kind] = n; if (n.punch_id) d.noteKey['p|' + n.punch_id] = n; });
    d.rota = {}; (rota || []).forEach(function (r) { d.rota[r.staff_id + '|' + r.date] = r; });
    return d;
  }
  function dayInfo(d, s, key) {
    var ds = s.shifts.filter(function (x) { return x.date === key; }), tot = 0, missing = false;
    ds.forEach(function (x) { if (x.min != null) tot += x.min; if (x.missing || x.orphan) missing = true; });
    var r = d.rota[s.id + '|' + key], lt = M.lateness(ds, s.start_times, key, r);
    return { shifts: ds, min: ds.length ? tot : null, missing: missing, late: lt.late, due: lt.due, off: lt.off, rota: r, live: ds.some(function (x) { return x.live; }) };
  }
  function attendanceNumbers(ov, rota, t) {
    var d = index(JSON.parse(JSON.stringify(ov)), rota), inNow = 0, late = 0, onToday = 0;
    d.staff.filter(function (s) { return s.active; }).forEach(function (s) {
      var di = dayInfo(d, s, t); if (di.live) inNow++; if (di.late) late++;
      if (di.shifts.length || (di.due && !di.off)) onToday++;
    });
    var miss = 0; d.staff.forEach(function (s) { s.shifts.forEach(function (x) { if ((x.missing || x.orphan) && x.date >= M.addDays(t, -7)) miss++; }); });
    return { inNow: inNow, lateToday: late, onToday: onToday, missing: miss };
  }

  var A = { ws: null, sel: null, confirm: null, photos: {} };
  function attLoad() {
    var t = M.today(); if (!A.ws) A.ws = M.weekStart(t);
    var from = M.addDays(A.ws < t ? A.ws : t, -7), to = M.addDays(A.ws, 6) > t ? M.addDays(A.ws, 6) : t;
    return Promise.all([M.rpc('mare_mgr_overview', { p_from: from, p_to: to }, App.S.token), App.fetch(['shifts'], from, to)]).then(function (r) {
      if (!r[0].data || !r[0].data.ok || !r[1]) return null;
      App.S.staff = r[0].data.staff;
      return index(r[0].data, r[1].shifts);
    });
  }
  function photosFor(ids) {
    var need = ids.filter(function (id) { return !(id in A.photos); });
    if (!need.length) return Promise.resolve(false);
    return M.rpc('mare_mgr_photos', { p_ids: need.slice(0, 400) }, App.S.token).then(function (r) {
      if (r.data && r.data.ok) need.forEach(function (id) { A.photos[id] = r.data.photos[id] || null; }); return true;
    });
  }
  function img(pid, fb) { var u = pid && M.safeJpeg(A.photos[pid]); return u ? '<img src="' + u + '" alt="">' : E(fb || ''); }

  App.register('attendance', {
    title: 'Attendance', icon: 'clock', group: 'today', live: true, desc: 'Who is in, late, missing clock-outs, hours and payroll.',
    tabs: [['today', 'Today'], ['week', 'Week'], ['faces', 'Check faces']],
    stat: function (H) { return H.att.missing ? [T('{n} missing clock times', { n: H.att.missing }), true] : [T('{n} in now', { n: H.att.inNow }), false]; },
    render: function (main, sub) {
      return attLoad().then(function (d) {
        if (!d) { main.innerHTML = App.empty(T('Could not load.')); return; }
        ({ today: attToday, week: attWeek, faces: attFaces })[sub](main, d);
      });
    }
  });

  function lateCount(d, s, t) { var n = 0; for (var k = M.monthStart(t); k <= t; k = M.addDays(k, 1)) if (dayInfo(d, s, k).late) n++; return n; }
  function attToday(main, d) {
    var t = M.dateKey(new Date(d.now)), since = M.addDays(t, -13), items = [];
    var act = d.staff.filter(function (s) { return s.active; });
    act.forEach(function (s) {
      s.shifts.forEach(function (x) { if (x.date < since) return; if (x.missing) items.push({ kind: 'out', s: s, x: x }); if (x.orphan) items.push({ kind: 'in', s: s, x: x }); });
      for (var i = 0; i < 7; i++) {
        var k = M.addDays(t, -i), di = dayInfo(d, s, k);
        if (di.late && !d.noteKey[s.id + '|' + k + '|late_accepted'] && !d.noteKey[s.id + '|' + k + '|warning'])
          items.push({ kind: 'late', s: s, key: k, late: di.late, due: di.due, inAt: di.shifts.filter(function (x) { return x.inP; })[0].inP.at });
      }
    });
    var h = '<section class="stack"><h2 class="serif">' + E(T('Needs you')) + ' · ' + items.length + '</h2>';
    if (!items.length) h += App.empty(T('Nothing waiting. Every shift has a clock-in and a clock-out, and nobody was late without a note.'));
    else {
      h += '<div class="cards">';
      items.forEach(function (it, n) {
        if (it.kind !== 'late') h += '<div class="card stack"><span class="tag amber" style="align-self:flex-start">' + E(it.kind === 'out' ? T('NO CLOCK-OUT') : T('NO CLOCK-IN')) + '</span>' +
          '<h3>' + E(it.s.name) + ' · ' + E(M.shortDate(it.x.date)) + '</h3><div class="muted">' +
          E(it.kind === 'out' ? T('Clocked in {t}. Never clocked out.', { t: M.hhmm(it.x.inP.at) }) : T('Clocked out {t} with no clock-in before it.', { t: M.hhmm(it.x.outP.at) })) + '</div>' +
          '<div class="row"><label class="small row" style="gap:6px">' + E(it.kind === 'out' ? T('Out at') : T('In at')) + ' <input type="time" id="nt' + n + '"></label>' +
          '<input type="text" id="nr' + n + '" placeholder="' + E(T('Reason')) + '" aria-label="' + E(T('Reason')) + '" style="flex:1 1 140px"></div>' +
          '<button class="btn" data-fix="' + n + '" style="align-self:flex-start">' + E(T('Save')) + '</button></div>';
        else {
          var c = lateCount(d, it.s, t);
          h += '<div class="card stack"><span class="tag red" style="align-self:flex-start">' + E(T('LATE {n} MIN', { n: it.late })) + '</span>' +
            '<h3>' + E(it.s.name) + ' · ' + E(it.key === t ? T('today') : M.shortDate(it.key)) + '</h3><div class="muted">' + E(T('Due {d} · in {t}.', { d: it.due, t: M.hhmm(it.inAt) })) +
            (c > 1 ? ' ' + E(T('Late {n} times this month.', { n: c })) : '') + '</div>' +
            '<input type="text" id="nr' + n + '" placeholder="' + E(T('Note (what happened)')) + '" aria-label="' + E(T('Note')) + '">' +
            '<div class="row"><button class="btn ghost" data-late="' + n + '" data-k="late_accepted">' + E(T('Accept')) + '</button>' +
            '<button class="btn warn" data-late="' + n + '" data-k="warning">' + E(T('Write it down for a warning')) + '</button></div></div>';
        }
      });
      h += '</div>';
    }
    h += '</section>';
    var rows = act.map(function (s) {
      var di = dayInfo(d, s, t), first = di.shifts.filter(function (x) { return x.inP; })[0], last = di.shifts[di.shifts.length - 1], st;
      if (di.live) st = di.late ? '<span class="tag red">' + E(T('IN · LATE {n} MIN', { n: di.late })) + '</span>' : '<span class="tag teal">' + E(T('IN')) + '</span>';
      else if (di.shifts.length) st = di.missing ? '<span class="tag amber">' + E(T('NO CLOCK-OUT')) + '</span>' : '<span class="tag grey">' + E(T('GONE HOME')) + '</span>';
      else if (di.off) st = '<span class="tag blue">' + E(T(di.off === 'off' ? 'DAY OFF' : di.off === 'sick' ? 'SICK' : 'ON LEAVE')) + '</span>';
      else if (di.due) st = (M.timeToMin(M.hhmm(new Date())) > M.timeToMin(di.due) + M.GRACE_MIN) ? '<span class="tag amber">' + E(T('NOT IN YET')) + '</span>' : '<span class="tag grey">' + E(T('DUE {t}', { t: di.due })) + '</span>';
      else st = '<span class="tag grey">' + E(T('NOT ON THE ROTA')) + '</span>';
      var lastP = null; s.punches.forEach(function (p) { if (!p.voided && p.has_photo && M.dateKey(p.at) === t) lastP = p; });
      return { s: s, st: st, di: di, first: first, last: last, photo: lastP };
    });
    h += '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Today')) + '</h2><span class="muted">' +
      E(T('{a} in · {b} late · {c} on the team', { a: rows.filter(function (r) { return r.di.live; }).length, b: rows.filter(function (r) { return r.di.late; }).length, c: rows.length })) + '</span></div>';
    h += rows.length ? '<div class="box"><table><thead><tr><th>' + E(T('Photo')) + '</th><th>' + E(T('Name')) + '</th><th>' + E(T('Team')) + '</th><th>' + E(T('Due')) + '</th><th>' + E(T('In')) + '</th><th>' + E(T('Out')) + '</th><th>' + E(T('Hours')) + '</th><th>' + E(T('Status')) + '</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><div class="thumb">' + img(r.photo && r.photo.id, r.s.name[0]) + '</div></td><td><b>' + E(r.s.name) + '</b></td><td>' + E(T(r.s.team)) + '</td><td class="nw">' + (r.di.due || '—') + '</td>' +
          '<td class="nw">' + (r.first ? M.hhmm(r.first.inP.at) : '—') + '</td><td class="nw">' + (r.last && r.last.outP ? M.hhmm(r.last.outP.at) : '—') + '</td>' +
          '<td class="nw">' + (r.di.min != null ? M.durShort(r.di.min) : '—') + '</td><td>' + r.st + '</td></tr>';
      }).join('') + '</tbody></table></div>' : App.empty(T('No people yet. Add the team in People.'));
    h += '</section>';
    var pe = d.pin_events.filter(function (e) { return e.kind !== 'set' && new Date(e.at) > new Date(Date.now() - 7 * 864e5); });
    if (pe.length) h += '<section class="stack"><h2 class="serif">' + E(T('Codes · last 7 days')) + '</h2><div class="box"><table><tbody>' + pe.map(function (e) {
      var s = d.byId[e.staff_id], txt = { reset: T('Code reset by {w}', { w: e.by || '' }), locked: T('Locked after 5 wrong codes'), offline_wrong_pin: T('Wrong code typed while the tablet was offline. That clock-in was not counted.') }[e.kind] || e.kind;
      return '<tr><td><b>' + E(s ? s.name : '?') + '</b></td><td class="nw">' + E(M.shortDate(M.dateKey(e.at))) + ' ' + M.hhmm(e.at) + '</td><td>' + E(txt) + '</td></tr>';
    }).join('') + '</tbody></table></div></section>';
    main.innerHTML = h;
    App.on(main, '[data-fix]', function (b) {
      var n = +b.getAttribute('data-fix'), it = items[n], tm = document.getElementById('nt' + n).value, why = document.getElementById('nr' + n).value.trim();
      if (!tm) { App.say(T('Type the time.')); return; } if (why.length < 2) { App.say(T('Write a short reason.')); return; }
      var at;
      if (it.kind === 'out') { at = M.toInstant(it.x.date, tm); if (at <= new Date(it.x.inP.at)) at = M.toInstant(M.addDays(it.x.date, 1), tm); }
      else { at = M.toInstant(it.x.date, tm); if (at >= new Date(it.x.outP.at)) at = M.toInstant(M.addDays(it.x.date, -1), tm); }
      b.disabled = true;
      App.call('mare_mgr_punch_add', { p_staff: it.s.id, p_dir: it.kind, p_at: at.toISOString(), p_reason: why }).then(function (r) { if (r) { App.say(T('Saved.')); App.reload(); } else b.disabled = false; });
    });
    App.on(main, '[data-late]', function (b) {
      var n = +b.getAttribute('data-late'), it = items[n], why = document.getElementById('nr' + n).value.trim(), k = b.getAttribute('data-k');
      if (k === 'warning' && why.length < 2) { App.say(T('Write what happened first.')); return; }
      b.disabled = true;
      App.call('mare_mgr_note_add', { p_staff: it.s.id, p_kind: k, p_date: it.key, p_text: why || T('Late {n} min', { n: it.late }), p_punch: null }).then(function (r) {
        if (r) { App.say(k === 'warning' ? T('Written down.') : T('Accepted.')); App.reload(); } else b.disabled = false;
      });
    });
    var ids = rows.filter(function (r) { return r.photo; }).map(function (r) { return r.photo.id; });
    photosFor(ids).then(function (ch) { if (ch && App.S.mod === 'attendance') attToday(main, d); });
  }

  function weekInfo(d, s, ws) {
    var days = [], tot = 0, lates = 0, miss = 0;
    for (var i = 0; i < 7; i++) { var k = M.addDays(ws, i), di = dayInfo(d, s, k); di.key = k; days.push(di); if (di.min) tot += di.min; if (di.late) lates++; if (di.missing) miss++; }
    var ot = tot - Math.round(Number(s.contract_hours) * 60);
    return { days: days, min: tot, ot: ot > 0 ? ot : 0, lates: lates, missing: miss };
  }
  function weekNav(ws, id) {
    var t = M.today();
    return '<div class="row"><button class="btn ghost" id="' + id + 'prev">‹ ' + E(T('Earlier')) + '</button>' +
      (ws !== M.weekStart(t) ? '<button class="btn ghost" id="' + id + 'now">' + E(T('This week')) + '</button>' : '') +
      (ws < M.weekStart(t) ? '<button class="btn ghost" id="' + id + 'next">' + E(T('Later')) + ' ›</button>' : '') + '</div>';
  }
  function bindWeekNav(main, id, get, set) {
    var el;
    if ((el = main.querySelector('#' + id + 'prev'))) el.onclick = function () { set(M.addDays(get(), -7)); App.reload(); };
    if ((el = main.querySelector('#' + id + 'next'))) el.onclick = function () { set(M.addDays(get(), 7)); App.reload(); };
    if ((el = main.querySelector('#' + id + 'now'))) el.onclick = function () { set(M.weekStart(M.today())); App.reload(); };
  }
  App.weekNav = weekNav; App.bindWeekNav = bindWeekNav;

  function attWeek(main, d) {
    var ws = A.ws, t = M.dateKey(new Date(d.now)), list = d.staff.filter(function (s) { return s.active; });
    var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Week of {d}', { d: M.shortDate(ws) })) + '</h2>' +
      '<div class="row">' + weekNav(ws, 'aw') + '<button class="btn" id="xls">' + E(T('Download for payroll (Excel)')) + '</button></div></div>';
    if (!list.length) { main.innerHTML = h + App.empty(T('No people yet. Add the team in People.')) + '</section>'; bindWeekNav(main, 'aw', function () { return A.ws; }, function (v) { A.ws = v; A.sel = null; }); return; }
    h += '<div class="box"><table><thead><tr><th>' + E(T('Name')) + '</th>';
    for (var i = 0; i < 7; i++) h += '<th>' + E(M.day(i)) + ' ' + (+M.addDays(ws, i).slice(8)) + '</th>';
    h += '<th>' + E(T('Total')) + '</th><th>' + E(T('Contract')) + '</th><th>' + E(T('Overtime')) + '</th><th>' + E(T('Late')) + '</th></tr></thead><tbody>';
    list.forEach(function (s) {
      var wi = weekInfo(d, s, ws);
      h += '<tr><td class="nw"><b>' + E(s.name) + '</b></td>';
      wi.days.forEach(function (di) {
        var sel = A.sel && A.sel.staff === s.id && A.sel.key === di.key;
        var v = di.missing ? '<span class="tag amber">' + (di.min ? M.durShort(di.min) + ' + ?' : '?') + '</span>'
          : di.min != null ? M.durShort(di.min) : di.off ? '<span class="muted">' + E(T(di.off === 'off' ? 'Off' : di.off === 'sick' ? 'Sick' : 'Leave')) + '</span>' : (di.key > t ? '' : '<span class="muted">—</span>');
        if (di.late) v += ' <span class="tag red" title="' + E(T('Late')) + '">' + di.late + '′</span>';
        if (di.shifts.some(function (x) { return (x.inP && x.inP.source === 'manager') || (x.outP && x.outP.source === 'manager'); })) v += ' <span class="tag blue" title="' + E(T('A time entered by hand')) + '">✎</span>';
        h += '<td class="cell' + (sel ? ' sel' : '') + '" data-s="' + s.id + '" data-k="' + di.key + '">' + v + '</td>';
      });
      h += '<td class="nw"><b>' + M.durShort(wi.min) + '</b>' + (wi.missing ? ' <span class="tag amber">+ ?</span>' : '') + '</td><td class="nw">' + Number(s.contract_hours) + ' h</td>' +
        '<td class="nw">' + (wi.ot ? '<b style="color:var(--red)">+' + M.durShort(wi.ot) + '</b>' : '—') + '</td><td>' + (wi.lates || '—') + '</td></tr>';
    });
    h += '</tbody></table></div><p class="small muted" style="margin:0">' + E(T('Tap a day to see the clock times, fix one, or add one. Orange ? = a clock time is missing, so that day is not counted yet. ✎ = a time entered by hand. Overtime = hours above the contract week.')) + '</p></section>';
    if (A.sel) h += dayPanel(d);
    main.innerHTML = h;
    bindWeekNav(main, 'aw', function () { return A.ws; }, function (v) { A.ws = v; A.sel = null; });
    main.querySelector('#xls').onclick = function () { exportWeek(d, this); };
    App.on(main, 'td.cell', function (td) { A.sel = { staff: td.getAttribute('data-s'), key: td.getAttribute('data-k') }; A.confirm = null; attWeek(main, d); var p = document.getElementById('daypanel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    if (A.sel) bindDayPanel(main, d);
  }
  function dayPanel(d) {
    var s = d.byId[A.sel.staff], key = A.sel.key, di = dayInfo(d, s, key);
    var ps = s.punches.filter(function (p) {
      return s.shifts.some(function (x) { return x.date === key && ((x.inP && x.inP.id === p.id) || (x.outP && x.outP.id === p.id)); }) || (p.voided && M.dateKey(p.at) === key);
    });
    var h = '<section class="card stack" id="daypanel"><div class="row between"><h3>' + E(s.name) + ' · ' + E(M.niceDate(key)) + '</h3><button class="btn ghost sm" id="dpx">' + E(T('Close')) + '</button></div>' +
      '<div class="muted">' + E(di.due ? T('Due {t}.', { t: di.due }) : T('Not on the rota that day.')) + ' ' + E(di.min != null ? T('Counted: {d}.', { d: M.dur(di.min) }) : '') + '</div>';
    h += ps.length ? '<div class="box"><table><tbody>' + ps.map(function (p) {
      var src = p.source === 'manager' ? T('Entered by {w}', { w: p.entered_by || '' }) + (p.reason ? ': “' + p.reason + '”' : '') : (p.offline ? T('Tablet (sent late: no internet)') : T('Tablet'));
      var conf = A.confirm === p.id;
      return '<tr style="' + (p.voided ? 'opacity:.55' : '') + '"><td><div class="thumb">' + (p.has_photo ? img(p.id, '…') : '—') + '</div></td>' +
        '<td class="nw"><b>' + E(T(p.dir === 'in' ? 'IN' : 'OUT')) + '</b> ' + M.hhmm(p.at) + (M.dateKey(p.at) !== key ? ' (' + E(M.shortDate(M.dateKey(p.at))) + ')' : '') + '</td><td class="small">' + E(src) +
        (p.voided ? '<br><span class="tag grey">' + E(T('REMOVED')) + '</span> ' + E(p.void_reason || '') : '') + '</td><td>' +
        (p.voided ? '' : conf ? '<div class="row"><input type="text" id="vr" placeholder="' + E(T('Why remove it?')) + '" aria-label="' + E(T('Reason')) + '"><button class="btn warn sm" data-void="' + p.id + '">' + E(T('Remove')) + '</button><button class="btn ghost sm" data-cancel="1">' + E(T('Keep')) + '</button></div>'
          : '<button class="btn ghost sm" data-ask="' + p.id + '">' + E(T('Remove…')) + '</button>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="muted">' + E(T('No clock times this day.')) + '</div>';
    h += '<div class="row"><b>' + E(T('Add a time')) + '</b><select id="ad" aria-label="' + E(T('In or out')) + '"><option value="in">' + E(T('IN')) + '</option><option value="out">' + E(T('OUT')) + '</option></select>' +
      '<input type="time" id="at" aria-label="' + E(T('Time')) + '"><input type="text" id="ar" placeholder="' + E(T('Reason')) + '" aria-label="' + E(T('Reason')) + '" style="flex:1 1 160px"><button class="btn" id="add">' + E(T('Add')) + '</button></div>' +
      '<div class="small muted">' + E(T('Nothing is ever deleted. A removed time stays here, crossed out, with its reason.')) + '</div></section>';
    return h;
  }
  function bindDayPanel(main, d) {
    var s = d.byId[A.sel.staff], key = A.sel.key;
    main.querySelector('#dpx').onclick = function () { A.sel = null; attWeek(main, d); };
    var ids = s.punches.filter(function (p) { return p.has_photo; }).map(function (p) { return p.id; });
    photosFor(ids).then(function (ch) { if (ch && A.sel) { var y = w.scrollY; attWeek(main, d); w.scrollTo(0, y); } });
    App.on(main, '[data-ask]', function (b) { A.confirm = b.getAttribute('data-ask'); var y = w.scrollY; attWeek(main, d); w.scrollTo(0, y); });
    App.on(main, '[data-cancel]', function () { A.confirm = null; var y = w.scrollY; attWeek(main, d); w.scrollTo(0, y); });
    App.on(main, '[data-void]', function (b) {
      var why = document.getElementById('vr').value.trim(); if (why.length < 2) { App.say(T('Write why.')); return; }
      b.disabled = true;
      App.call('mare_mgr_punch_void', { p_id: b.getAttribute('data-void'), p_reason: why }).then(function (r) { if (r) { A.confirm = null; App.say(T('Removed.')); App.reload(); } else b.disabled = false; });
    });
    main.querySelector('#add').onclick = function () {
      var dir = document.getElementById('ad').value, tm = document.getElementById('at').value, why = document.getElementById('ar').value.trim(), btn = this;
      if (!tm) { App.say(T('Type the time.')); return; } if (why.length < 2) { App.say(T('Write a short reason.')); return; }
      var at = M.toInstant(key, tm), firstIn = s.shifts.filter(function (x) { return x.date === key && x.inP; })[0];
      if (dir === 'out' && firstIn && at <= new Date(firstIn.inP.at)) at = M.toInstant(M.addDays(key, 1), tm);
      if (at > new Date(Date.now() + 5 * 60000)) { App.say(T('That time is in the future.')); return; }
      btn.disabled = true;
      App.call('mare_mgr_punch_add', { p_staff: s.id, p_dir: dir, p_at: at.toISOString(), p_reason: why }).then(function (r) { if (r) { App.say(T('Added.')); App.reload(); } else btn.disabled = false; });
    };
  }
  App.xlsx = function (go, btn) {
    if (w.XLSX) return go();
    var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = go; sc.onerror = function () { App.say(T('Could not load the Excel maker. Check the internet.')); if (btn) btn.disabled = false; };
    document.head.appendChild(sc);
  };
  function exportWeek(d, btn) {
    btn.disabled = true;
    App.xlsx(function () {
      var ws = A.ws, list = d.staff.filter(function (s) { return s.active; }), hours = [], times = [];
      var head = [T('Name'), T('Team')]; for (var i = 0; i < 7; i++) head.push(M.day(i) + ' ' + M.addDays(ws, i));
      head = head.concat([T('Total (h:mm)'), T('Total (hours)'), T('Contract (h)'), T('Overtime (h:mm)'), T('Overtime (hours)'), T('Late days'), T('Days missing a clock time')]);
      hours.push(head);
      list.forEach(function (s) {
        var wi = weekInfo(d, s, ws), row = [s.name, T(s.team)];
        wi.days.forEach(function (di) { row.push(di.missing ? (di.min ? M.durShort(di.min) + ' + ' + T('missing') : T('missing')) : di.min != null ? M.durShort(di.min) : di.off ? T(di.off === 'off' ? 'Off' : di.off === 'sick' ? 'Sick' : 'Leave') : ''); });
        row = row.concat([M.durShort(wi.min), Math.round(wi.min / 0.6) / 100, Number(s.contract_hours), wi.ot ? M.durShort(wi.ot) : '', Math.round(wi.ot / 0.6) / 100, wi.lates, wi.missing]);
        hours.push(row);
        wi.days.forEach(function (di) {
          di.shifts.forEach(function (x, xi) {
            times.push([s.name, di.key, x.inP ? M.hhmm(x.inP.at) : T('missing'), x.outP ? M.hhmm(x.outP.at) : (x.live ? T('still in') : T('missing')),
              x.min != null ? M.durShort(x.min) : '', xi === 0 ? (di.due || '') : '', xi === 0 && di.late ? di.late + ' min' : '',
              [x.inP && x.inP.source === 'manager' ? T('IN') + ' ' + x.inP.entered_by + ': ' + x.inP.reason : '', x.outP && x.outP.source === 'manager' ? T('OUT') + ' ' + x.outP.entered_by + ': ' + x.outP.reason : ''].filter(Boolean).join(' · ')]);
          });
        });
      });
      times.unshift([T('Name'), T('Date'), T('In'), T('Out'), T('Hours'), T('Due'), T('Late'), T('Entered by hand')]);
      var wb = XLSX.utils.book_new(), a = XLSX.utils.aoa_to_sheet(hours), b = XLSX.utils.aoa_to_sheet(times);
      a['!cols'] = head.map(function (_, i) { return { wch: i === 0 ? 22 : 14 }; }); b['!cols'] = [22, 12, 9, 9, 9, 9, 9, 50].map(function (x) { return { wch: x }; });
      XLSX.utils.book_append_sheet(wb, a, T('Hours')); XLSX.utils.book_append_sheet(wb, b, T('Clock times'));
      XLSX.writeFile(wb, 'Robertos-Mare-hours-week-' + ws + '.xlsx');
      btn.disabled = false;
    }, btn);
  }

  function attFaces(main, d) {
    var ws = A.ws, we = M.addDays(ws, 7), ids = [], any = false;
    var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Check faces · week of {d}', { d: M.shortDate(ws) })) + '</h2>' + weekNav(ws, 'af') + '</div>' +
      '<p class="muted" style="margin:0">' + E(T('Every clock-in and clock-out photo, one row per person. A face that does not belong stands out. Tap a photo to look closer.')) + '</p>';
    d.staff.filter(function (s) { return s.active; }).forEach(function (s) {
      var ps = s.punches.filter(function (p) { var k = M.dateKey(p.at); return !p.voided && p.source === 'tablet' && k >= ws && k < we; });
      if (!ps.length) return; any = true;
      h += '<div class="card row" style="align-items:flex-start;gap:12px"><div style="width:110px;font-weight:700;padding-top:20px">' + E(s.name) + '</div>';
      ps.forEach(function (p) {
        if (p.has_photo) ids.push(p.id);
        var flag = d.noteKey['p|' + p.id];
        h += '<button data-p="' + p.id + '" data-s="' + s.id + '" style="background:none;border:0;padding:0;display:flex;flex-direction:column;align-items:center;gap:4px;width:84px">' +
          '<span class="thumb" style="width:80px;height:60px;' + (flag ? 'outline:3px solid var(--red)' : '') + '">' + (p.has_photo ? img(p.id, '…') : '<span class="tiny">' + E(T('No photo')) + '</span>') + '</span>' +
          '<span class="tiny muted">' + E(M.day(M.dow(M.dateKey(p.at)) - 1)) + ' ' + E(T(p.dir === 'in' ? 'IN' : 'OUT')) + ' ' + M.hhmm(p.at) + '</span></button>';
      });
      h += '</div>';
    });
    if (!any) h += App.empty(T('No tablet clock-ins this week.'));
    main.innerHTML = h + '</section>';
    bindWeekNav(main, 'af', function () { return A.ws; }, function (v) { A.ws = v; });
    App.on(main, '[data-p]', function (b) {
      var pid = b.getAttribute('data-p'), s = d.byId[b.getAttribute('data-s')], p = s.punches.filter(function (x) { return x.id === pid; })[0], flag = d.noteKey['p|' + pid];
      var o = App.overlay('<h3>' + E(s.name) + ' · ' + E(T(p.dir === 'in' ? 'IN' : 'OUT')) + ' ' + E(M.shortDate(M.dateKey(p.at))) + ' ' + M.hhmm(p.at) + '</h3>' +
        (M.safeJpeg(A.photos[pid]) ? '<img src="' + A.photos[pid] + '" alt="">' : '<div class="muted">' + E(T('No photo for this one (camera was off).')) + '</div>') +
        (flag ? '<span class="tag red" style="align-self:flex-start">' + E(T('MARKED')) + ': ' + E(flag.text) + '</span>' :
          '<input type="text" id="fl" placeholder="' + E(T('What is wrong? (e.g. this is not Vinay)')) + '" aria-label="' + E(T('What is wrong?')) + '">' +
          '<button class="btn warn" id="flb" style="align-self:flex-start">' + E(T('Not this person: write it down')) + '</button>') +
        '<button class="btn ghost" data-close style="align-self:flex-start">' + E(T('Close')) + '</button>');
      var fb = o.querySelector('#flb');
      if (fb) fb.onclick = function () {
        fb.disabled = true;
        App.call('mare_mgr_note_add', { p_staff: s.id, p_kind: 'photo_flag', p_date: M.dateKey(p.at), p_text: o.querySelector('#fl').value.trim() || T('Not this person'), p_punch: pid }).then(function (r) {
          if (r) { App.say(T('Written down.')); o.close(); App.reload(); } else fb.disabled = false;
        });
      };
    });
    photosFor(ids).then(function (ch) { if (ch && App.S.mod === 'attendance') attFaces(main, d); });
  }

  // ════════════════ PEOPLE ════════════════
  var P = { confirm: null };
  App.register('people', {
    title: 'People', icon: 'people', group: 'team', desc: 'The team, start times, contract hours, codes and phone links.',
    stat: function (H) { var n = H.ov.staff.filter(function (s) { return s.active; }).length, np = H.ov.staff.filter(function (s) { return s.active && !s.has_pin; }).length; return [T('{n} people', { n: n }) + (np ? ' · ' + T('{n} without a code', { n: np }) : ''), false]; },
    render: function (main) {
      return Promise.all([M.rpc('mare_mgr_overview', { p_from: M.today(), p_to: M.today() }, App.S.token), App.fetch(['staff'])]).then(function (r) {
        var ov = r[0].data; if (!ov || !ov.ok || !r[1]) { main.innerHTML = App.empty(T('Could not load.')); return; }
        App.S.staff = ov.staff;
        var extra = {}; r[1].staff.forEach(function (s) { extra[s.id] = s; });
        peopleView(main, ov, extra);
      });
    }
  });
  function peopleView(main, d, extra) {
    var base = new URL('mare-clock.html', location.href).href, teams = ['Kitchen', 'Service', 'Bar', 'Other'];
    var h = '<section class="card stack"><h3>' + E(T('Add a person')) + '</h3><div class="row"><input type="text" id="nn" placeholder="' + E(T('Name as the team knows them')) + '" aria-label="' + E(T('Name')) + '" style="flex:1 1 220px" maxlength="60">' +
      '<select id="nteam" aria-label="' + E(T('Team')) + '">' + teams.map(function (t) { return '<option value="' + t + '"' + (t === 'Service' ? ' selected' : '') + '>' + E(T(t)) + '</option>'; }).join('') + '</select>' +
      '<button class="btn" id="nadd">' + E(T('Add')) + '</button></div><div class="small muted">' + E(T('They choose their own 4-digit code the first time they tap their name on the tablet.')) + '</div></section>';
    var list = d.staff.slice().sort(function (a, b) { return (b.active - a.active) || (teams.indexOf(a.team) - teams.indexOf(b.team)) || a.name.localeCompare(b.name); });
    h += '<section class="stack"><h2 class="serif">' + E(T('The team')) + '</h2>';
    if (!list.length) h += App.empty(T('Nobody yet.'));
    list.forEach(function (s) {
      var x = extra[s.id] || {}, resets = d.pin_events.filter(function (e) { return e.staff_id === s.id && e.kind === 'reset' && new Date(e.at) > new Date(Date.now() - 30 * 864e5); }).length;
      var notes = d.notes.filter(function (n) { return n.staff_id === s.id; }), link = base + '?me=' + s.phone_token, conf = P.confirm === s.id;
      h += '<div class="card stack" data-id="' + s.id + '" style="' + (s.active ? '' : 'opacity:.65') + '">' +
        '<div class="row between"><div class="row"><input type="text" class="f-name" value="' + E(s.name) + '" aria-label="' + E(T('Name')) + '" maxlength="60" style="font-weight:700;font-size:18px">' +
        '<select class="f-team" aria-label="' + E(T('Team')) + '">' + teams.map(function (t) { return '<option value="' + t + '"' + (t === s.team ? ' selected' : '') + '>' + E(T(t)) + '</option>'; }).join('') + '</select>' +
        '<input type="text" class="f-role" value="' + E(x.role || '') + '" placeholder="' + E(T('Role (e.g. Head chef)')) + '" aria-label="' + E(T('Role')) + '">' +
        '<label class="row small" style="gap:6px"><input type="checkbox" class="f-active" ' + (s.active ? 'checked' : '') + ' style="width:22px;height:22px"> ' + E(T('Works here now')) + '</label></div>' +
        '<div class="row">' + (s.has_pin ? '<span class="tag teal">' + E(T('CODE SET')) + '</span>' : '<span class="tag amber">' + E(T('NO CODE YET')) + '</span>') +
        (resets >= 2 ? ' <span class="tag blue">' + E(T('CODE RESET {n}× IN 30 DAYS', { n: resets })) + '</span>' : '') + '</div></div>' +
        '<div class="grid4"><label class="f">' + E(T('Contract hours a week')) + '<input type="text" inputmode="decimal" data-num="1" class="f-hours" value="' + Number(s.contract_hours) + '" min="0" max="84" step="0.5"></label>' +
        '<label class="f">' + E(T('Annual leave days a year')) + '<input type="text" inputmode="decimal" data-num="1" class="f-annual" value="' + (x.annual_days != null ? x.annual_days : 21) + '" min="0" max="60"></label></div>' +
        '<div><div class="small" style="font-weight:700;margin-bottom:6px">' + E(T('Usual start time (used when the rota is empty; leave empty on days off)')) + '</div><div class="grid4" style="grid-template-columns:repeat(auto-fit,minmax(96px,1fr))">' +
        [0, 1, 2, 3, 4, 5, 6].map(function (i) { var v = (s.start_times || {})[String(i + 1)] || ''; return '<label class="f">' + E(M.day(i)) + '<input type="time" class="f-st" data-d="' + (i + 1) + '" value="' + v + '"></label>'; }).join('') + '</div></div>' +
        '<div class="row"><button class="btn" data-save="' + s.id + '">' + E(T('Save')) + '</button>' +
        (conf ? '<span><b>' + E(T('Reset {n}\'s code?', { n: s.name })) + '</b> ' + E(T('They choose a new one on the tablet.')) + '</span><button class="btn warn" data-reset="' + s.id + '">' + E(T('Yes, reset')) + '</button><button class="btn ghost" data-cancel="1">' + E(T('Cancel')) + '</button>'
          : (s.has_pin ? '<button class="btn ghost" data-askpin="' + s.id + '">' + E(T('Reset code…')) + '</button>' : '')) + '</div>' +
        '<details><summary>' + E(T('Phone link: their own app')) + '</summary><div class="stack" style="margin-top:10px">' +
        '<div class="small muted">' + E(T('Send this to {n} only, by WhatsApp. After their 4-digit code it shows their hours, shifts, the briefing, recipes, leave and Speak up. Phones never clock in.', { n: s.name })) + '</div>' +
        '<input type="text" readonly value="' + E(link) + '" aria-label="' + E(T('Phone link')) + '" style="width:100%">' +
        '<div class="row"><button class="btn ghost sm" data-copy="' + E(link) + '">' + E(T('Copy')) + '</button>' +
        '<a class="btn ghost sm" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(T('Your Roberto\'s Mare app: {l}', { l: link })) + '">' + E(T('Send by WhatsApp')) + '</a>' +
        '<button class="btn ghost sm" data-newlink="' + s.id + '">' + E(T('Make a new link (the old one stops)')) + '</button></div></div></details>' +
        (notes.length ? '<details><summary>' + E(T('Notes')) + ' · ' + notes.length + '</summary><div class="stack" style="margin-top:10px;gap:6px">' + notes.map(function (n) {
          var k = { late_accepted: T('Late, accepted'), warning: T('For a warning'), photo_flag: T('Photo marked'), general: T('Note') }[n.kind];
          return '<div class="small"><b>' + E(n.ref_date ? M.shortDate(n.ref_date) : M.shortDate(M.dateKey(n.at))) + ' · ' + E(k) + '</b> ' + E(n.text) + ' <span class="muted">(' + E(n.by || '') + ')</span></div>'; }).join('') + '</div></details>' : '') +
        '</div>';
    });
    main.innerHTML = h + '</section>';
    main.querySelector('#nadd').onclick = function () {
      var n = main.querySelector('#nn').value.trim(); if (!n) { App.say(T('Type a name.')); return; }
      if (d.staff.some(function (s) { return s.active && s.name.toLowerCase() === n.toLowerCase(); })) { App.say(T('There is already an active {n}. Add a surname initial.', { n: n })); return; }
      this.disabled = true;
      App.call('mare_mgr_staff_save', { p: { name: n, team: main.querySelector('#nteam').value } }).then(function (r) { if (r) { App.say(T('Added {n}.', { n: n })); App.reload(); } });
    };
    App.on(main, '[data-save]', function (b) {
      var c = b.closest('.card'), st = {};
      Array.prototype.forEach.call(c.querySelectorAll('.f-st'), function (i) { st[i.getAttribute('data-d')] = i.value || null; });
      var hrs = M.num(c.querySelector('.f-hours').value), ann = M.num(c.querySelector('.f-annual').value);
      if (!(hrs >= 0 && hrs <= 84)) { App.say(T('Contract hours must be between 0 and 84.')); return; }
      b.disabled = true;
      App.call('mare_mgr_staff_save', { p: { id: b.getAttribute('data-save'), name: c.querySelector('.f-name').value.trim(), team: c.querySelector('.f-team').value,
        active: c.querySelector('.f-active').checked, contract_hours: hrs, start_times: st } }).then(function (r) {
        if (!r) { b.disabled = false; return null; }
        return App.call('mare_m_staff_extra', { p_staff: b.getAttribute('data-save'), p_role: c.querySelector('.f-role').value.trim(), p_annual: ann == null ? 21 : Math.round(ann) });
      }).then(function (r) { if (r) { App.say(T('Saved.')); App.reload(); } });
    });
    App.on(main, '[data-askpin]', function (b) { P.confirm = b.getAttribute('data-askpin'); App.reload(); });
    App.on(main, '[data-cancel]', function () { P.confirm = null; App.reload(); });
    App.on(main, '[data-reset]', function (b) { b.disabled = true; App.call('mare_mgr_reset_pin', { p_staff: b.getAttribute('data-reset') }).then(function (r) { P.confirm = null; if (r) { App.say(T('Code reset.')); App.reload(); } }); });
    App.on(main, '[data-copy]', function (b) {
      var v = b.getAttribute('data-copy');
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { App.say(T('Copied.')); }, function () { b.closest('details').querySelector('input').select(); App.say(T('Selected. Copy it now.')); });
    });
    App.on(main, '[data-newlink]', function (b) { b.disabled = true; App.call('mare_mgr_phone_link_new', { p_staff: b.getAttribute('data-newlink') }).then(function (r) { if (r) { App.say(T('New link made. The old one no longer works.')); App.reload(); } }); });
  }

  // ════════════════ TABLET ════════════════
  var TB = { code: null, confirm: null };
  App.register('tablet', {
    title: 'Tablet', icon: 'tablet', group: 'setup', desc: 'Set up the staff tablet, or switch a lost one off.',
    render: function (main) {
      return M.rpc('mare_mgr_overview', { p_from: M.today(), p_to: M.today() }, App.S.token).then(function (r) {
        var d = r.data; if (!d || !d.ok) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var url = new URL('mare-clock.html', location.href).href;
        var h = '<section class="card stack"><h2 class="serif">' + E(T('Set up a tablet')) + '</h2><ol style="margin:0;padding-left:20px;line-height:1.7">' +
          '<li>' + E(T('On the tablet, open')) + ' <a href="' + E(url) + '" target="_blank" rel="noopener">' + E(url) + '</a></li>' +
          '<li>' + E(T('Make a tablet code below and type it on the tablet. You only do this once.')) + '</li>' +
          '<li>' + E(T('Allow the camera when the tablet asks. Leave it on its charger by the staff entrance.')) + '</li></ol>';
        if (TB.code) h += '<div class="card" style="background:var(--tint);border-color:var(--tint)"><div class="small"><b>' + E(T('Tablet code for “{n}”. It is shown only now:', { n: TB.code.name })) + '</b></div><div class="code">' + E(TB.code.code) + '</div></div>';
        h += '<div class="row"><input type="text" id="tn" placeholder="' + E(T('Tablet name (e.g. Staff entrance)')) + '" aria-label="' + E(T('Tablet name')) + '" style="flex:1 1 240px"><button class="btn" id="tadd">' + E(T('Make a tablet code')) + '</button></div></section>';
        h += '<section class="stack"><h2 class="serif">' + E(T('Tablets')) + '</h2>';
        h += d.devices.length ? '<div class="box"><table><thead><tr><th>' + E(T('Name')) + '</th><th>' + E(T('Made')) + '</th><th>' + E(T('Last used')) + '</th><th>' + E(T('Status')) + '</th><th></th></tr></thead><tbody>' + d.devices.map(function (v) {
          var conf = TB.confirm === v.id;
          return '<tr><td><b>' + E(v.name) + '</b></td><td class="nw">' + E(M.shortDate(M.dateKey(v.created_at))) + '</td><td class="nw">' + (v.last_seen ? E(M.shortDate(M.dateKey(v.last_seen))) + ' ' + M.hhmm(v.last_seen) : E(T('Never'))) + '</td>' +
            '<td>' + (v.active ? '<span class="tag teal">' + E(T('ON')) + '</span>' : '<span class="tag grey">' + E(T('OFF')) + '</span>') + '</td><td>' +
            (!v.active ? '' : conf ? '<div class="row"><span>' + E(T('Switch it off? It stops working at once.')) + '</span><button class="btn warn sm" data-off="' + v.id + '">' + E(T('Switch off')) + '</button><button class="btn ghost sm" data-cancel="1">' + E(T('Cancel')) + '</button></div>'
              : '<button class="btn ghost sm" data-askoff="' + v.id + '">' + E(T('Switch off…')) + '</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : App.empty(T('No tablet yet.'));
        main.innerHTML = h + '<p class="small muted" style="margin:0">' + E(T('If a tablet is lost or stolen, switch it off here. Make a new code for the new one.')) + '</p></section>';
        main.querySelector('#tadd').onclick = function () {
          var n = main.querySelector('#tn').value.trim() || T('Staff entrance'); this.disabled = true;
          App.call('mare_mgr_device_new', { p_name: n }).then(function (r) { if (r) { TB.code = { name: n, code: r.code }; App.reload(); } });
        };
        App.on(main, '[data-askoff]', function (b) { TB.confirm = b.getAttribute('data-askoff'); App.reload(); });
        App.on(main, '[data-cancel]', function () { TB.confirm = null; App.reload(); });
        App.on(main, '[data-off]', function (b) { b.disabled = true; App.call('mare_mgr_device_off', { p_id: b.getAttribute('data-off') }).then(function (r) { TB.confirm = null; if (r) { App.say(T('Switched off.')); App.reload(); } }); });
      });
    }
  });
})(window);
