/* Roberto's Mare — "Admin": the Mare admin (Milica) runs access from one page, like the
   Dubai Admin → Users & Access. Per login: add / remove, which modules they open, which emails
   they receive. Per team: what their phone shows. A new login gets its own no-password link.
   Only a Mare admin sees the screen, and the mare-logins function checks that again. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;
  var L = { made: null, rm: null, acc: null, team: null };
  // The emails the Mare app sends, and the mare_settings key that holds who receives each.
  var MAILS = [['kitchen_report_to', 'The kitchen closing report, after every service'],
               ['recipe_question_to', 'Questions the team asks under a recipe'],
               ['link_mail_cc', 'A copy when a team member is emailed their phone link']];
  var TEAM_MODS = [['brief', 'Today\'s briefing'], ['check', 'Checklists'], ['rota', 'Rota'], ['recipes', 'Recipes'],
                   ['kclose', 'Closing report'], ['learn', 'Learning'], ['breakage', 'Breakage'], ['leave', 'Ask for leave'], ['speak', 'Speak up'], ['order', 'Order']];
  var TEAMS = ['Kitchen', 'Service', 'Bar', 'Other'];
  var ERR = {
    email: 'That email address does not look right.', name: 'Type their name.', admin: 'Only a Mare admin can change logins.',
    self: 'You cannot do this to your own login.', fohadmin: 'This login belongs to the Roberto\'s admin and cannot be changed here.',
    dubai: 'This person signs in with their Roberto\'s Dubai login, so no link is made here.', nologin: 'This email has no Mare access.'
  };
  function fn(body) {
    return App.fn('mare-logins', body).then(function (r) {
      if (!r) return null;
      if (!r.ok) { App.say(T(ERR[r.error] || 'Not saved: {m}', { m: r.error })); return null; }
      return r;
    });
  }
  function linkPanel(m) {
    if (m.existing) return '<div class="pconf ok"><span><b>' + E(T('{n} can now open the Mare app.', { n: m.name })) + '</b> ' + E(T('They already have a Roberto\'s login: they sign in with their own email and password.')) + '</span>' +
      '<span class="row"><button class="btn ghost sm" data-ldone="1">' + E(T('Done')) + '</button></span></div>';
    return '<div class="pconf ok" style="flex-direction:column;align-items:stretch"><span><b>' + E(T('{n} can now open the Mare app.', { n: m.name })) + '</b> ' +
      E(T('This is their own link. They open it once and choose their own password; after that they sign in with email and password. It is shown only now, so send it before you leave this page.')) + '</span>' +
      '<input type="text" readonly id="llink" value="' + E(m.link) + '" aria-label="' + E(T('Their link')) + '" style="width:100%">' +
      '<span class="row"><button class="btn sm" data-lmail="' + E(m.email) + '">' + E(T('Email it to them')) + '</button><button class="btn ghost sm" data-lcopy="1">' + E(T('Copy')) + '</button>' +
      '<a class="btn ghost sm" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(T('Your Roberto\'s Mare app: {l}', { l: m.link })) + '">' + E(T('Send by WhatsApp')) + '</a>' +
      '<button class="btn ghost sm" data-ldone="1">' + E(T('Done')) + '</button></span></div>';
  }

  App.register('logins', {
    title: 'Admin', icon: 'people', group: 'setup', desc: 'Who can open the app, what each person sees, and which emails they receive.',
    render: function (main) {
      return Promise.all([App.call('mare_m_managers', {}), App.fetch(['settings', 'staff'])]).then(function (res) {
        var mg = res[0], f = res[1];
        if (!mg || !f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var set = {}; f.settings.forEach(function (x) { set[x.key] = x.value; });
        var mgrMods = set.mgr_modules || {}, teamMods = set.team_modules || {};
        var GO = ['today', 'team', 'kitchen', 'setup'];
        var all = App.order.filter(function (k) { return k !== 'viewas' && k !== 'logins'; })
          .sort(function (a, b) { return GO.indexOf(App.mods[a].group) - GO.indexOf(App.mods[b].group); });
        function mailList(k) { return (Array.isArray(set[k]) ? set[k] : []).map(function (x) { return String(x).toLowerCase(); }); }
        var h = '<section class="card stack"><h3>' + E(T('Add a login')) + '</h3>' +
          '<div class="row padd"><input type="text" id="lname" placeholder="' + E(T('Name')) + '" aria-label="' + E(T('Name')) + '" style="flex:1 1 180px" maxlength="80">' +
          '<input type="email" id="lemail" placeholder="' + E(T('Their email')) + '" aria-label="' + E(T('Email')) + '" style="flex:2 1 220px" maxlength="250" autocomplete="off">' +
          '<input type="text" id="ltitle" placeholder="' + E(T('Role (e.g. F&B Manager)')) + '" aria-label="' + E(T('Role')) + '" style="flex:1 1 180px" maxlength="80">' +
          '<label class="row small" style="gap:6px"><input type="checkbox" id="ladmin" style="width:22px;height:22px"> ' + E(T('Admin')) + '</label>' +
          '<button class="btn" id="ladd">' + E(T('Add')) + '</button></div>' +
          '<details><summary>' + E(T('What is a login?')) + '</summary><div class="small muted" style="margin-top:8px;line-height:1.6">' +
          E(T('A login opens this management app: attendance, schedule, reports, people, everything. Use it for managers. The team (chefs, waiters, bar) do not need one: add them in People and send them their phone link.')) + '<br>' +
          E(T('An Admin can also add and remove logins. Press “Access & emails” on a person to choose what they open and which emails they get.')) + '</div></details>' +
          (L.made ? linkPanel(L.made) : '') + '</section>';

        h += '<section class="stack"><h2 class="serif">' + E(T('Who can open the Mare app')) + ' · ' + mg.managers.length + '</h2><div class="card plist">';
        mg.managers.forEach(function (u) {
          var me = u.email === mg.me, canLink = (u.mare_only || App.S.fohAdmin) && !u.is_admin, everything = u.is_admin || u.mare_admin;
          var mods = Array.isArray(mgrMods[u.email]) ? mgrMods[u.email].filter(function (k) { return all.indexOf(k) >= 0; }) : null;
          var nMail = MAILS.filter(function (m) { return mailList(m[0]).indexOf(u.email) >= 0; }).length;
          h += '<div class="prow"><div class="phead" style="cursor:default"><span class="thumb">' + E(u.name.slice(0, 1).toUpperCase()) + '</span><span class="pwho"><b class="serif">' + E(u.name) + '</b><span>' + E(u.email) + (u.title ? ' · ' + E(u.title) : '') + '</span></span>' +
            (me ? '<span class="tag grey">' + E(T('YOU')) + '</span>' : '') +
            (u.mare_admin ? '<span class="tag teal">' + E(T('ADMIN')) + '</span>' : '<span class="tag ' + (mods ? 'amber' : 'grey') + '">' + E(mods ? T('{a} of {b} modules', { a: mods.length, b: all.length }) : T('All modules')) + '</span>') +
            '<span class="tag grey">' + E(nMail === 1 ? T('1 email') : T('{n} emails', { n: nMail })) + '</span>' +
            (!u.mare_only ? '<span class="tag blue">' + E(T('DUBAI LOGIN')) + '</span>' : u.pw_set ? '<span class="tag green">' + E(T('PASSWORD SET')) + '</span>' : u.has_link ? '<span class="tag amber">' + E(T('LINK SENT · NO PASSWORD YET')) + '</span>' : '<span class="tag red">' + E(T('NO LINK')) + '</span>') + '</div>' +
            '<div class="pacts"><button class="btn ghost sm" data-lacc="' + E(u.email) + '">' + E(L.acc === u.email ? T('Close') : T('Access & emails')) + '</button>' +
            (canLink ? '<button class="btn ghost sm" data-lnew="' + E(u.email) + '">' + E(u.pw_set ? T('Forgot password: new link') : T('New link')) + '</button>' : '') +
            (me || u.is_admin ? '' : '<button class="btn ghost sm" data-ladm="' + E(u.email) + '" data-on="' + (u.mare_admin ? '0' : '1') + '">' + E(u.mare_admin ? T('Not admin') : T('Make admin')) + '</button>' +
              '<button class="btn warn sm" data-lrm="' + E(u.email) + '">' + E(T('Remove')) + '</button>') + '</div>';
          if (L.rm === u.email) h += '<div class="pconf"><span><b>' + E(T('Remove {n}\'s Mare access?', { n: u.name })) + '</b> ' + E(T('Their link stops working at once. You can add them again later.')) + '</span>' +
            '<span class="row"><button class="btn warn sm" data-lrmyes="' + E(u.email) + '">' + E(T('Yes, remove')) + '</button><button class="btn ghost sm" data-lcancel="1">' + E(T('Cancel')) + '</button></span></div>';
          if (L.acc === u.email) {
            h += '<div class="pbody stack" data-acc="' + E(u.email) + '"><div><div class="sec"><span>' + E(T('Can open')) + '</span><i></i></div>' +
              (everything ? '<div class="small muted">' + E(T('Admin: opens every module.')) + '</div>'
                : '<div class="ticks2 mods">' + all.map(function (k) { return '<label><input type="checkbox" value="' + k + '"' + (!mods || mods.indexOf(k) >= 0 ? ' checked' : '') + '> ' + E(T(App.mods[k].title)) + '</label>'; }).join('') + '</div>') + '</div>' +
              '<div><div class="sec"><span>' + E(T('Receives by email')) + '</span><i></i></div><div class="ticks2 mails one">' + MAILS.map(function (m) {
                return '<label><input type="checkbox" value="' + m[0] + '"' + (mailList(m[0]).indexOf(u.email) >= 0 ? ' checked' : '') + '> ' + E(T(m[1])) + '</label>'; }).join('') + '</div></div>' +
              '<div class="row"><button class="btn" data-lsave="' + E(u.email) + '">' + E(T('Save')) + '</button><button class="btn ghost" data-lacc="' + E(u.email) + '">' + E(T('Cancel')) + '</button></div></div>';
          }
          h += '</div>';
        });
        h += '</div></section>';

        // ── the team: what each team's phone shows ──
        h += '<section class="stack"><h2 class="serif">' + E(T('The team · what their phone shows')) + '</h2><div class="card plist">';
        TEAMS.forEach(function (team) {
          var n = f.staff.filter(function (x) { return x.active && x.team === team; }).length;
          if (!n && team === 'Other') return;
          var tm = Array.isArray(teamMods[team]) ? teamMods[team] : TEAM_MODS.map(function (x) { return x[0]; });
          h += '<div class="prow"><div class="phead" style="cursor:default"><span class="thumb">' + n + '</span><span class="pwho"><b class="serif">' + E(T(team)) + '</b><span>' +
            E(TEAM_MODS.filter(function (x) { return tm.indexOf(x[0]) >= 0; }).map(function (x) { return T(x[1]); }).join(' · ') || T('Nothing yet')) + '</span></span></div>' +
            '<div class="pacts"><button class="btn ghost sm" data-lteam="' + team + '">' + E(L.team === team ? T('Close') : T('Choose')) + '</button></div>';
          if (L.team === team) h += '<div class="pbody stack" data-team="' + team + '"><div class="ticks2">' + TEAM_MODS.map(function (x) {
            return '<label><input type="checkbox" value="' + x[0] + '"' + (tm.indexOf(x[0]) >= 0 ? ' checked' : '') + '> ' + E(T(x[1])) + '</label>'; }).join('') + '</div>' +
            '<div class="row"><button class="btn" data-ltsave="' + team + '">' + E(T('Save')) + '</button><button class="btn ghost" data-lteam="' + team + '">' + E(T('Cancel')) + '</button></div></div>';
          h += '</div>';
        });
        main.innerHTML = h + '</div></section>';

        App.on(main, '[data-lacc]', function (b) { var em = b.getAttribute('data-lacc'); L.acc = L.acc === em ? null : em; L.rm = null; App.reload(); });
        App.on(main, '[data-lteam]', function (b) { var t = b.getAttribute('data-lteam'); L.team = L.team === t ? null : t; App.reload(); });
        App.on(main, '[data-lsave]', function (b) {
          var em = b.getAttribute('data-lsave'), box = b.closest('.pbody'), jobs = [];
          var mbox = box.querySelector('.mods');
          if (mbox) {
            var picked = Array.prototype.filter.call(mbox.querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; });
            var v = JSON.parse(JSON.stringify(mgrMods));
            if (picked.length === all.length) delete v[em]; else v[em] = picked;
            if (JSON.stringify(v) !== JSON.stringify(mgrMods)) jobs.push({ key: 'mgr_modules', value: v });
          }
          var empty = null;
          Array.prototype.forEach.call(box.querySelectorAll('.mails input'), function (i) {
            var cur = mailList(i.value), has = cur.indexOf(em) >= 0;
            if (i.checked === has) return;
            var next = i.checked ? cur.concat([em]) : cur.filter(function (x) { return x !== em; });
            if (!next.length) empty = i; else jobs.push({ key: i.value, value: next });
          });
          // An email nobody receives is a report that silently goes nowhere: refuse it.
          if (empty) { App.say(T('Somebody must receive this email. Tick another person first.')); return; }
          if (!jobs.length) { L.acc = null; App.reload(); return; }
          b.disabled = true;
          jobs.reduce(function (p, j) { return p.then(function (ok) { return ok && App.save('mare_settings', j); }); }, Promise.resolve(true)).then(function (ok) {
            if (!ok) { b.disabled = false; return; }
            App.say(T('Saved.')); L.acc = null; App.loadMyMods().then(App.reload);
          });
        });
        App.on(main, '[data-ltsave]', function (b) {
          var team = b.getAttribute('data-ltsave'), box = b.closest('.pbody');
          var v = JSON.parse(JSON.stringify(teamMods));
          TEAMS.forEach(function (t) { if (!Array.isArray(v[t])) v[t] = TEAM_MODS.map(function (x) { return x[0]; }); });
          v[team] = Array.prototype.filter.call(box.querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; });
          b.disabled = true;
          App.save('mare_settings', { key: 'team_modules', value: v }).then(function (x) { if (x) { App.say(T('Saved. Tablets and phones show it at their next refresh.')); L.team = null; App.reload(); } else b.disabled = false; });
        });

        function add() {
          var b = main.querySelector('#ladd'), name = App.val(main, '#lname'), email = App.val(main, '#lemail').toLowerCase();
          var known = mg.managers.some(function (u) { return u.email === email; });
          if (!/^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(email)) { App.say(T(ERR.email)); main.querySelector('#lemail').focus(); return; }
          if (known) { App.say(T('{e} already has a login here.', { e: email })); return; }
          b.disabled = true;
          fn({ action: 'add', name: name, email: email, title: App.val(main, '#ltitle'), admin: App.val(main, '#ladmin') }).then(function (r) {
            if (!r) { b.disabled = false; return; }
            L.made = { name: r.name || name || email, email: email, link: r.link, existing: !!r.existing }; L.rm = null; App.reload();
          });
        }
        main.querySelector('#ladd').onclick = add;
        App.on(main, '.padd input', function (i, e) { if (e.key === 'Enter') add(); }, 'keydown');
        App.on(main, '[data-ldone]', function () { L.made = null; App.reload(); });
        App.on(main, '[data-lcopy]', function () {
          var i = main.querySelector('#llink');
          (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(function () { App.say(T('Copied.')); }, function () { i.select(); App.say(T('Selected. Copy it now.')); });
        });
        App.on(main, '[data-lmail]', function (b) {
          b.disabled = true;
          fn({ action: 'mail', email: b.getAttribute('data-lmail') }).then(function (r) {
            if (!r) { b.disabled = false; return; }
            // Mailing made a fresh link, so the one on screen has stopped: take it away.
            App.say(T(r.test ? 'Test login: the email went to Francesco only.' : 'Sent to {e}, with a copy to you.', { e: b.getAttribute('data-lmail') })); L.made = null; App.reload();
          });
        });
        App.on(main, '[data-lnew]', function (b) {
          var em = b.getAttribute('data-lnew'), u = mg.managers.filter(function (x) { return x.email === em; })[0];
          b.disabled = true;
          fn({ action: 'link', email: em }).then(function (r) { if (!r) { b.disabled = false; return; } L.made = { name: u.name, email: em, link: r.link }; App.reload().then(function () { w.scrollTo(0, 0); }); });
        });
        App.on(main, '[data-ladm]', function (b) {
          b.disabled = true;
          fn({ action: 'admin', email: b.getAttribute('data-ladm'), on: b.getAttribute('data-on') === '1' }).then(function (r) { if (r) { App.say(T('Saved.')); App.reload(); } else b.disabled = false; });
        });
        App.on(main, '[data-lrm]', function (b) { L.rm = b.getAttribute('data-lrm'); App.reload(); });
        App.on(main, '[data-lcancel]', function () { L.rm = null; App.reload(); });
        App.on(main, '[data-lrmyes]', function (b) {
          b.disabled = true;
          fn({ action: 'remove', email: b.getAttribute('data-lrmyes') }).then(function (r) { L.rm = null; if (r) { App.say(T(r.kept_mail ? 'Removed. They still receive an email nobody else gets: tick another person for it.' : 'Removed. Their link no longer works.')); App.reload(); } else b.disabled = false; });
        });
      });
    }
  });
})(window);
