/* Roberto's Mare — "Logins": the Mare admin (Milica) adds and removes the people who can
   open THIS management app. A new login gets its own no-password link; nothing to type.
   Only a Mare admin sees the screen, and the mare-logins function checks that again. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;
  var L = { made: null, rm: null, busy: false };
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
      E(T('This is their own link. It signs them in: no password. It is shown only now, so send it before you leave this page.')) + '</span>' +
      '<input type="text" readonly id="llink" value="' + E(m.link) + '" aria-label="' + E(T('Their link')) + '" style="width:100%">' +
      '<span class="row"><button class="btn sm" data-lmail="' + E(m.email) + '">' + E(T('Email it to them')) + '</button><button class="btn ghost sm" data-lcopy="1">' + E(T('Copy')) + '</button>' +
      '<a class="btn ghost sm" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(T('Your Roberto\'s Mare app: {l}', { l: m.link })) + '">' + E(T('Send by WhatsApp')) + '</a>' +
      '<button class="btn ghost sm" data-ldone="1">' + E(T('Done')) + '</button></span></div>';
  }

  App.register('logins', {
    title: 'Logins', icon: 'people', group: 'setup', desc: 'Who can open this management app. Add a login or remove one.',
    render: function (main) {
      return App.call('mare_m_managers', {}).then(function (mg) {
        if (!mg) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var h = '<section class="card stack"><h3>' + E(T('Add a login')) + '</h3>' +
          '<div class="row padd"><input type="text" id="lname" placeholder="' + E(T('Name')) + '" aria-label="' + E(T('Name')) + '" style="flex:1 1 180px" maxlength="80">' +
          '<input type="email" id="lemail" placeholder="' + E(T('Their email')) + '" aria-label="' + E(T('Email')) + '" style="flex:2 1 220px" maxlength="250" autocomplete="off">' +
          '<input type="text" id="ltitle" placeholder="' + E(T('Role (e.g. F&B Manager)')) + '" aria-label="' + E(T('Role')) + '" style="flex:1 1 180px" maxlength="80">' +
          '<label class="row small" style="gap:6px"><input type="checkbox" id="ladmin" style="width:22px;height:22px"> ' + E(T('Admin')) + '</label>' +
          '<button class="btn" id="ladd">' + E(T('Add')) + '</button></div>' +
          '<details><summary>' + E(T('What is a login?')) + '</summary><div class="small muted" style="margin-top:8px;line-height:1.6">' +
          E(T('A login opens this management app: attendance, schedule, reports, people, everything. Use it for managers. The team (chefs, waiters, bar) do not need one: add them in People and send them their phone link.')) + '<br>' +
          E(T('An Admin can also add and remove logins. Choose which modules a login can open in Set-up → View as.')) + '</div></details>' +
          (L.made ? linkPanel(L.made) : '') + '</section>';

        h += '<section class="stack"><h2 class="serif">' + E(T('Who can open the Mare app')) + ' · ' + mg.managers.length + '</h2><div class="card plist">';
        mg.managers.forEach(function (u) {
          var me = u.email === mg.me, canLink = (u.mare_only || App.S.fohAdmin) && !u.is_admin;
          h += '<div class="prow"><div class="phead" style="cursor:default"><span class="thumb">' + E(u.name.slice(0, 1).toUpperCase()) + '</span><span class="pwho"><b class="serif">' + E(u.name) + '</b><span>' + E(u.email) + (u.title ? ' · ' + E(u.title) : '') + '</span></span>' +
            (me ? '<span class="tag grey">' + E(T('YOU')) + '</span>' : '') +
            (u.mare_admin ? '<span class="tag teal">' + E(T('ADMIN')) + '</span>' : '') +
            (!u.mare_only ? '<span class="tag blue">' + E(T('DUBAI LOGIN')) + '</span>' : u.has_link ? '<span class="tag grey">' + E(u.last_used ? T('LINK USED {d}', { d: M.shortDate(M.dateKey(u.last_used)) }) : T('LINK NOT OPENED YET')) + '</span>' : '<span class="tag amber">' + E(T('NO LINK')) + '</span>') + '</div>' +
            '<div class="pacts">' +
            (canLink ? '<button class="btn ghost sm" data-lnew="' + E(u.email) + '">' + E(T('New link')) + '</button>' : '') +
            (me || u.is_admin ? '' : '<button class="btn ghost sm" data-ladm="' + E(u.email) + '" data-on="' + (u.mare_admin ? '0' : '1') + '">' + E(u.mare_admin ? T('Not admin') : T('Make admin')) + '</button>' +
              '<button class="btn warn sm" data-lrm="' + E(u.email) + '">' + E(T('Remove')) + '</button>') + '</div>';
          if (L.rm === u.email) h += '<div class="pconf"><span><b>' + E(T('Remove {n}\'s Mare access?', { n: u.name })) + '</b> ' + E(T('Their link stops working at once. You can add them again later.')) + '</span>' +
            '<span class="row"><button class="btn warn sm" data-lrmyes="' + E(u.email) + '">' + E(T('Yes, remove')) + '</button><button class="btn ghost sm" data-lcancel="1">' + E(T('Cancel')) + '</button></span></div>';
          h += '</div>';
        });
        main.innerHTML = h + '</div></section>';

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
          fn({ action: 'remove', email: b.getAttribute('data-lrmyes') }).then(function (r) { L.rm = null; if (r) { App.say(T('Removed. Their link no longer works.')); App.reload(); } else b.disabled = false; });
        });
      });
    }
  });
})(window);
