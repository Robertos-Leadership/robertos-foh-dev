/* Roberto's Mare — Team activity (9 Oct 2026).
   Francesco: "how I can check who's using what, what network they are connected to ... I need an admin
   for Montenegro specifically". One screen: who has set up the app, when each person last opened it,
   which modules, from which device, whether on the restaurant's internet, their Learning results,
   and the kitchen closing reports. A web page cannot read the wifi name: the restaurant's internet is
   marked once, from here, while connected at Mare. RPCs: mare_m_activity, mare_m_my_ip, mare_m_site_ip. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;
  var A = { from: null, to: null, tab: 'people', open: null };
  var MOD = { home: 'Home', rota: 'Schedule', recipes: 'Recipes', kclose: 'Closing report', learn: 'Learning', brief: 'Briefing', check: 'Checklists', breakage: 'Breakage', leave: 'Leave', speak: 'Speak up', hours: 'My hours', more: 'More' };
  function when(t) { if (!t) return T('never'); var d = new Date(t); return M.shortDate(M.dateKey(d)) + ' · ' + M.hhmm(d); }
  function site(v) { return v === true ? '<span class="tag green">' + E(T('Restaurant')) + '</span>' : v === false ? '<span class="tag amber">' + E(T('Elsewhere')) + '</span>' : '<span class="tag grey">—</span>'; }

  App.register('activity', {
    title: 'Team activity', icon: 'people', group: 'team', desc: 'Who uses the app, when, on which device, at the restaurant or not; test results and closing reports.',
    render: function (main) {
      if (!A.to) { A.to = M.today(); A.from = M.addDays(A.to, -6); }
      return Promise.all([App.call('mare_m_activity', { p_from: A.from, p_to: A.to }), App.call('mare_m_my_ip', {})]).then(function (r) {
        var d = r[0], me = r[1]; if (!d) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Team activity')) + '</h2><div class="row">' +
          '<label class="f">' + E(T('From')) + '<input type="date" id="af" value="' + A.from + '"></label><label class="f">' + E(T('To')) + '<input type="date" id="at" value="' + A.to + '"></label></div></div>';
        // the restaurant's internet
        var nSite = (d.site_ips || []).length;
        h += '<div class="card stack"><div class="row between"><b>' + E(T('The restaurant\'s internet')) + '</b>' +
          (nSite ? '<span class="tag green">' + E(T('{n} connection(s) marked', { n: nSite })) + '</span>' : '<span class="tag amber">' + E(T('Not marked yet')) + '</span>') + '</div>' +
          '<div class="small muted" style="text-transform:none;letter-spacing:0">' + E(T('A phone cannot tell an app the wifi name. Instead, mark the restaurant\'s internet once, from this screen, while you are connected to the Mare wifi. Every visit then shows Restaurant or Elsewhere.')) + '</div>' +
          (me && me.ip ? (me.is_site ? '<div class="row"><span class="tag green">' + E(T('You are on the restaurant\'s internet now')) + '</span><button class="btn ghost sm" id="unsite">' + E(T('Unmark this connection')) + '</button></div>'
                                    : '<div class="row"><button class="btn sm" id="mksite">' + E(T('I am at Mare now: this is the restaurant\'s internet')) + '</button></div>') : '') + '</div>';
        h += '<div class="tabs">' + [['people', 'People'], ['recent', 'Every visit'], ['reports', 'Kitchen closing reports'], ['learn', 'Learning results']].map(function (t) {
          return '<button data-atab="' + t[0] + '" class="' + (A.tab === t[0] ? 'on' : '') + '">' + E(T(t[1])) + '</button>'; }).join('') + '</div>';
        if (A.tab === 'people') {
          h += '<div class="box"><table class="rota"><thead><tr><th>' + E(T('Name')) + '</th><th>' + E(T('App set up')) + '</th><th>' + E(T('Last opened')) + '</th><th>' + E(T('Where')) + '</th><th>' + E(T('Device')) + '</th><th>' + E(T('Opens')) + '</th><th>' + E(T('Modules used')) + '</th></tr></thead><tbody>' +
            (d.people.length ? d.people.map(function (p) {
              var mods = Object.keys(p.modules).sort(function (a, b) { return p.modules[b] - p.modules[a]; }).map(function (k) { return E(T(MOD[k] || k)) + ' ' + p.modules[k]; }).join(' · ');
              return '<tr><td class="nw"><b>' + E(p.name) + '</b><div class="tiny muted">' + E(T(p.team)) + '</div></td>' +
                '<td>' + (p.set_up ? '<span class="tag green">' + E(T('Yes')) + '</span>' : '<span class="tag amber">' + E(T('Not yet')) + '</span>') + '</td>' +
                '<td class="nw">' + E(when(p.last_seen)) + '</td><td>' + site(p.last_on_site) + '</td><td class="small" style="text-transform:none;letter-spacing:0">' + E(p.last_device || '—') + '</td>' +
                '<td class="nw">' + p.opens + (p.opens ? ' <span class="tiny muted">(' + E(T('{n} at Mare', { n: p.on_site_opens })) + ')</span>' : '') + '</td>' +
                '<td class="small" style="text-transform:none;letter-spacing:0">' + (mods || '—') + '</td></tr>';
            }).join('') : '<tr><td colspan="7">' + E(T('No team members yet.')) + '</td></tr>') + '</tbody></table></div>';
        } else if (A.tab === 'recent') {
          h += d.recent.length ? '<div class="box"><table class="rota"><thead><tr><th>' + E(T('When')) + '</th><th>' + E(T('Name')) + '</th><th>' + E(T('Module')) + '</th><th>' + E(T('Where')) + '</th><th>' + E(T('Device')) + '</th></tr></thead><tbody>' +
            d.recent.map(function (x) { return '<tr><td class="nw">' + E(when(x.at)) + '</td><td class="nw">' + E(x.name) + '</td><td>' + E(T(MOD[x.module] || x.module)) + '</td><td>' + site(x.on_site) +
              (x.on_site === false && x.ip ? ' <button class="lnk" data-markip="' + E(x.ip) + '" style="margin:0">' + E(T('This is the restaurant')) + '</button>' : '') + '</td><td class="small" style="text-transform:none;letter-spacing:0">' + E(x.device || '—') + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : App.empty(T('Nobody opened the app in these days.'));
        } else if (A.tab === 'reports') {
          var ENT = { complaint: 'Guest complaints', unavailable: 'Ran out', operation: 'Problems' };
          h += d.reports.length ? d.reports.map(function (k) {
            var avg = k.guests ? M.money((+k.revenue || 0) / k.guests) : '—';
            return '<div class="card stack"><div class="row between"><b>' + E(M.niceDate(k.date)) + '</b>' + (k.sent_at ? '<span class="tag green">' + E(T('Sent {t} by {n}', { t: M.hhmm(k.sent_at), n: k.sent_by || '' })) + '</span>' : '<span class="tag amber">' + E(T('Saved, not sent')) + '</span>') + '</div>' +
              '<div class="row"><span class="tag grey">' + E(T('{n} guests', { n: k.guests == null ? '—' : k.guests })) + '</span><span class="tag grey">' + E(M.money(+k.revenue || 0)) + ' ' + E(T('gross')) + '</span><span class="tag grey">' + E(T('{m} per guest', { m: avg })) + '</span>' +
              (k.rating ? '<span class="tag grey">' + ['😖', '😕', '😐', '🙂', '🔥'][k.rating - 1] + '</span>' : '') + '</div>' +
              (k.entries.length ? k.entries.map(function (e) { return '<div><b>' + E(T(ENT[e.type] || e.type)) + ':</b> ' + E(e.detail || e.item || '') + '</div>'; }).join('') : '<div class="muted">' + E(T('Nothing ran out, no complaints, no problems.')) + '</div>') +
              (k.feedback ? '<div class="muted">' + E(k.feedback) + '</div>' : '') +
              '<div class="tiny muted">' + E(T('On duty: {n}', { n: (k.chefs_on || []).join(', ') || '—' })) + '</div></div>';
          }).join('') : App.empty(T('No kitchen closing reports in these days.'));
        } else {
          h += '<div class="box"><table class="rota"><thead><tr><th>' + E(T('Name')) + '</th><th>' + E(T('Tests taken')) + '</th><th>' + E(T('Best score')) + '</th><th>' + E(T('Passed')) + '</th><th>' + E(T('Last test')) + '</th></tr></thead><tbody>' +
            d.people.map(function (p) { var l = p.learn || {};
              return '<tr><td class="nw"><b>' + E(p.name) + '</b></td><td>' + (l.tests || 0) + '</td><td>' + (l.tests ? l.best + '/' + l.total : '—') + '</td><td>' +
                (l.passed ? '<span class="tag green">' + E(T('Yes')) + '</span>' : l.tests ? '<span class="tag amber">' + E(T('Not yet')) + '</span>' : '—') + '</td><td class="nw">' + E(l.last_at ? when(l.last_at) : '—') + '</td></tr>'; }).join('') +
            '</tbody></table></div>';
        }
        h += '<p class="small muted" style="margin:0;text-transform:none;letter-spacing:0">' + E(T('The team app records each person\'s visits: when, which screen, the device and the internet connection. Test people (ZZ) are not listed.')) + '</p></section>';
        main.innerHTML = h;
        main.querySelector('#af').onchange = function () { if (this.value) { A.from = this.value; App.reload(); } };
        main.querySelector('#at').onchange = function () { if (this.value) { A.to = this.value; App.reload(); } };
        App.on(main, '[data-atab]', function (b) { A.tab = b.getAttribute('data-atab'); App.reload(); });
        function mark(ip, on) { App.call('mare_m_site_ip', { p_ip: ip, p_on: on }).then(function (x) { if (x) { App.say(on ? T('Marked: this is the restaurant\'s internet.') : T('Unmarked.')); App.reload(); } }); }
        var mk = main.querySelector('#mksite'); if (mk) mk.onclick = function () { mark(me.ip, true); };
        var um = main.querySelector('#unsite'); if (um) um.onclick = function () { mark(me.ip, false); };
        App.on(main, '[data-markip]', function (b) { mark(b.getAttribute('data-markip'), true); });
      });
    }
  });
})(window);
