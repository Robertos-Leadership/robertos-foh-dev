/* Roberto's Mare — "View as": see the app exactly as a colleague sees it,
   read-only, and choose which modules each manager and each team can open.
   Managers → the Mare app (this page) with only their modules + a banner.
   Team     → mare-clock.html?viewas=<id> (their phone) or ?viewas=tablet. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;
  var TEAM_MODS = [['brief', 'Today\'s briefing'], ['check', 'Checklists'], ['rota', 'Rota'], ['recipes', 'Recipes'],
                   ['kclose', 'Closing report'], ['learn', 'Learning'], ['breakage', 'Breakage'], ['leave', 'Ask for leave'], ['speak', 'Speak up']];
  var TEAMS = ['Kitchen', 'Service', 'Bar', 'Other'];
  var V = { open: null };

  function openTeamApp(target) {
    try { sessionStorage.setItem('mare_viewas_token', App.S.token); sessionStorage.setItem('mare_viewas_back', location.href.split('#')[0] + '#viewas'); } catch (e) {}
    location.href = 'mare-clock.html?viewas=' + encodeURIComponent(target);
  }

  App.register('viewas', {
    title: 'View as', icon: 'eye', group: 'setup', desc: 'See the app exactly as Milica, a chef, the floor or the tablet sees it, and choose what each can open.',
    render: function (main) {
      return Promise.all([App.call('mare_m_managers', {}), App.fetch(['settings', 'staff'])]).then(function (r) {
        var mg = r[0], f = r[1]; if (!mg || !f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var set = {}; f.settings.forEach(function (s) { set[s.key] = s.value; });
        var mgrMods = set.mgr_modules || {}, teamMods = set.team_modules || {};
        var all = App.order.filter(function (k) { return k !== 'viewas'; });
        var h = '<section class="vahero"><div class="k">' + E(T('SET-UP')) + '</div><h2 class="serif">' + E(T('View as')) + '</h2>' +
          '<div style="font-size:17px;line-height:1.5">' + E(T('See the app exactly as a colleague sees it. It is read only, and a banner lets you switch back at any time.')) + '</div></section>';

        // ── managers ──
        h += '<section class="stack"><h2 class="serif">' + E(T('Managers · the Mare app')) + '</h2><div class="card" style="padding:0">';
        mg.managers.forEach(function (u) {
          var mods = Array.isArray(mgrMods[u.email]) ? mgrMods[u.email] : null;
          var tag = u.is_admin ? T('Admin · everything') : mods ? T('{a} of {b} modules', { a: mods.filter(function (k) { return all.indexOf(k) >= 0; }).length, b: all.length }) : T('All modules');
          h += '<div class="varow"><div class="who"><b>' + E(u.name) + (u.email === mg.me ? ' <span class="tag grey" style="font-family:Karla;font-size:11px;vertical-align:middle">' + E(T('YOU')) + '</span>' : '') + '</b><span>' + E(u.email) + '</span></div>' +
            '<div class="acts">' + (u.title ? '<span class="tag grey">' + E(u.title) + '</span>' : '') + '<span class="tag ' + (mods ? 'amber' : 'teal') + '">' + E(tag) + '</span>' +
            (u.is_admin ? '' : '<button class="vabtn" data-mm="' + E(u.email) + '">' + E(T('Modules')) + '</button>') +
            (u.email === mg.me ? '' : '<button class="vabtn" data-vm="' + E(u.email) + '">' + M.icon('eye', 18) + E(T('View as')) + '</button>') + '</div></div>';
          if (V.open === 'm:' + u.email) {
            h += '<div class="ticks" data-for="' + E(u.email) + '">' + all.map(function (k) {
              return '<label><input type="checkbox" value="' + k + '"' + (!mods || mods.indexOf(k) >= 0 ? ' checked' : '') + '> ' + E(T(App.mods[k].title)) + '</label>';
            }).join('') + '<button class="btn sm" data-msave="' + E(u.email) + '">' + E(T('Save')) + '</button></div>';
          }
        });
        h += '<div class="varow"><div class="who"><span>' + E(T('Milica appears here as soon as her Roberto\'s login has Mare access (FOH Admin → Users & Access → Mare Attendance).')) + '</span></div></div>';
        h += '</div></section>';

        // ── tablet ──
        h += '<section class="stack"><h2 class="serif">' + E(T('The staff tablet')) + '</h2><div class="card" style="padding:0"><div class="varow"><div class="who"><b>' + E(T('Staff entrance tablet')) + '</b>' +
          '<span>' + E(T('Clock-in for everyone, and the modules of every team.')) + '</span></div><div class="acts"><button class="vabtn" data-vt="1">' + M.icon('eye', 18) + E(T('View as')) + '</button></div></div></div></section>';

        // ── team, by team ──
        h += '<section class="stack"><h2 class="serif">' + E(T('The team · tablet and phone')) + '</h2>';
        TEAMS.forEach(function (team) {
          var ppl = f.staff.filter(function (s) { return s.active && s.team === team; });
          if (!ppl.length) return;
          var tm = Array.isArray(teamMods[team]) ? teamMods[team] : TEAM_MODS.map(function (x) { return x[0]; });
          h += '<div class="card" style="padding:0"><div class="varow" style="background:#FCFAF7"><div class="who"><b>' + E(T(team)) + '</b><span>' + E(T('{a} of {b} modules on their phone', { a: tm.length, b: TEAM_MODS.length })) + '</span></div>' +
            '<div class="acts"><button class="vabtn" data-tm="' + team + '">' + E(T('What {t} sees', { t: T(team) })) + '</button></div></div>';
          if (V.open === 't:' + team) {
            h += '<div class="ticks" data-team="' + team + '">' + TEAM_MODS.map(function (x) {
              return '<label><input type="checkbox" value="' + x[0] + '"' + (tm.indexOf(x[0]) >= 0 ? ' checked' : '') + '> ' + E(T(x[1])) + '</label>';
            }).join('') + '<span class="small muted">' + E(T('Clock-in and My hours are always there.')) + '</span><button class="btn sm" data-tsave="' + team + '">' + E(T('Save')) + '</button></div>';
          }
          ppl.forEach(function (s) {
            h += '<div class="varow"><div class="who"><b>' + E(s.name) + '</b><span>' + E(s.role || '') + '</span></div><div class="acts"><span class="tag grey">' + E(T(team)) + '</span>' +
              '<button class="vabtn" data-vs="' + s.id + '">' + M.icon('eye', 18) + E(T('View as')) + '</button></div></div>';
          });
          h += '</div>';
        });
        main.innerHTML = h + '</section>';

        App.on(main, '[data-mm]', function (b) { var k = 'm:' + b.getAttribute('data-mm'); V.open = V.open === k ? null : k; App.reload(); });
        App.on(main, '[data-tm]', function (b) { var k = 't:' + b.getAttribute('data-tm'); V.open = V.open === k ? null : k; App.reload(); });
        App.on(main, '[data-msave]', function (b) {
          var em = b.getAttribute('data-msave'), box = b.closest('.ticks');
          var on = Array.prototype.filter.call(box.querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; });
          var v = JSON.parse(JSON.stringify(mgrMods));
          if (on.length === all.length) delete v[em]; else v[em] = on;
          b.disabled = true;
          App.save('mare_settings', { key: 'mgr_modules', value: v }).then(function (x) { if (x) { App.say(T('Saved.')); V.open = null; App.loadMyMods().then(App.reload); } else b.disabled = false; });
        });
        App.on(main, '[data-tsave]', function (b) {
          var team = b.getAttribute('data-tsave'), box = b.closest('.ticks');
          var v = JSON.parse(JSON.stringify(teamMods));
          TEAMS.forEach(function (t) { if (!Array.isArray(v[t])) v[t] = TEAM_MODS.map(function (x) { return x[0]; }); });
          v[team] = Array.prototype.filter.call(box.querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; });
          b.disabled = true;
          App.save('mare_settings', { key: 'team_modules', value: v }).then(function (x) { if (x) { App.say(T('Saved. Tablets and phones show it at their next refresh.')); V.open = null; App.reload(); } else b.disabled = false; });
        });
        App.on(main, '[data-vm]', function (b) {
          var em = b.getAttribute('data-vm'), u = mg.managers.filter(function (x) { return x.email === em; })[0];
          App.S.viewAs = { name: u.name, mods: u.is_admin ? null : (Array.isArray(mgrMods[em]) ? mgrMods[em] : null) };
          App.go(null);
        });
        App.on(main, '[data-vt]', function () { openTeamApp('tablet'); });
        App.on(main, '[data-vs]', function (b) { openTeamApp(b.getAttribute('data-vs')); });
      });
    }
  });
})(window);
