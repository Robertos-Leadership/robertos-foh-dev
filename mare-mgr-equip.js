/* Roberto's Mare — Crockery & equipment (6 Nov 2026).
   Zeljko's inventory list (Big kitchen + Small kitchen, with photographs) as data, so the team
   knows what Mare has, and the monthly count done in the app against it.
   Tables mare_equip_items / mare_equip_counts, RPCs mare_m_equip_* (mare-equipment-schema.sql).
   Photos are files: mare-equip/t/<key>.jpg (small) and mare-equip/p/<key>.jpg (big). */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;
  var EQ = { q: '', sheet: 'all', grp: '', month: null, show: 'all', data: null };
  // Zeljko's two kitchen lists (5 Nov 2026) and Milica's four areas (9 Nov 2026, Lista Inventara-2026 nova)
  var AREAS = [['big', 'Big kitchen'], ['small', 'Small kitchen'], ['cutlery', 'Cutlery & small items'], ['bar', 'Bar'], ['store', 'Storeroom'], ['rest', 'Restaurant']];
  function areaIx(k) { for (var i = 0; i < AREAS.length; i++) if (AREAS[i][0] === k) return i; return 99; }
  function areaName(it) { var i = areaIx(it.sheet); return i < 99 ? T(AREAS[i][1]) : it.sheet; }
  function isZ(it) { return it.sheet === 'big' || it.sheet === 'small'; }   // Zeljko's lists carry groups and yearly numbers
  function subOf(it) { return isZ(it) ? T(it.grp || 'Other') + (it.sheet === 'small' ? ' \u00b7 ' + T('Small kitchen') : '') : areaName(it); }
  function headOf(it) { return isZ(it) ? areaName(it) + ' \u00b7 ' + T(it.grp || 'Other') : areaName(it); }

  function ms() { if (!EQ.month) EQ.month = M.monthStart(M.today()); return EQ.month; }
  function load() { return App.call('mare_m_equip_data', { p_month: ms() }).then(function (r) { if (r) { EQ.data = r; if (r.items) r.items.sort(function (a, b) { return areaIx(a.sheet) - areaIx(b.sheet) || (a.sort - b.sort); }); } return r; }); }
  function css() {
    if (document.getElementById('eq-css')) return;
    var s = document.createElement('style'); s.id = 'eq-css';
    s.textContent =
      '.eq-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.eq-bar input[type=search],.eq-bar select{min-height:40px;padding:8px 12px;border:1px solid #D6CABA;border-radius:8px;font:inherit;background:#fff}' +
      '.eq-bar input[type=search]{flex:1 1 200px}.eq-bar .seg{flex-wrap:wrap}' +
      '.eq-grp{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin:10px 0 0;display:flex;justify-content:space-between}' +
      '.eq-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px}' +
      '.eq-it{display:flex;gap:12px;align-items:center;text-align:left;width:100%;background:linear-gradient(180deg,#fff,#FBF7F1);border:1px solid rgba(168,131,75,.24);border-radius:12px;padding:8px 12px 8px 8px;box-shadow:var(--lift);font:inherit;color:inherit;cursor:pointer}' +
      '.eq-ph{flex:0 0 76px;height:76px;border-radius:8px;background:#EFE8DC;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#9A8F83}' +
      '.eq-ph img{width:100%;height:100%;object-fit:contain;border-radius:0}' +
      '.eq-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}.eq-tx b{font-size:14.5px;line-height:1.25;font-weight:600;overflow-wrap:anywhere}' +
      '.eq-tx .tiny{color:var(--muted)}.eq-n{flex:0 0 auto;text-align:right;font-family:"Cormorant Garamond",Georgia,serif;font-size:34px;line-height:1;font-variant-numeric:lining-nums}.eq-n i{display:block;font:11px/1.2 Inter,system-ui,sans-serif;color:var(--muted);font-style:normal;letter-spacing:.5px}' +
      '.eq-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:20px;padding:1px 8px;margin-right:4px;background:#EFE8DC;color:#5C5246}.eq-tag.red{background:#F4DADA;color:#8A2E2E}.eq-tag.green{background:#DDEBDD;color:#285C36}.eq-tag.amber{background:#F5E8C9;color:#7A5A12}' +
      '.eq-row{display:flex;gap:12px;align-items:center;padding:8px 10px;border-bottom:1px solid #EDE5D8}.eq-row .eq-ph{flex-basis:56px;height:56px}' +
      '.eq-row .eq-tx{flex:1 1 180px}.eq-row label{display:flex;flex-direction:column;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);gap:2px}.eq-row input{width:84px;min-height:42px;font-size:18px;text-align:center;border:1px solid #D6CABA;border-radius:8px}' +
      '.eq-row.done{background:rgba(221,235,221,.35)}.eq-row.diff{background:rgba(245,232,201,.45)}' +
      '@media(max-width:640px){.eq-kp{grid-template-columns:repeat(3,1fr)!important;gap:8px!important}.eq-kp .kpi{padding:10px}.eq-kp .kpi b{font-size:26px}.eq-kp .kpi span{font-size:9px;letter-spacing:1px}.eq-kp .kpi i{display:none}.eq-list{grid-template-columns:1fr}}' +
      '.eq-hist{border-collapse:collapse;width:100%}.eq-hist td,.eq-hist th{padding:6px 8px;border-bottom:1px solid #EDE5D8;text-align:center;font-size:14px}.eq-hist th{font-size:11px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase}';
    document.head.appendChild(s);
  }
  function now(it) { // latest number in the lists, and which year it is from
    if (it.q2026 != null) return [+it.q2026, '2026'];
    if (it.q2025 != null) return [+it.q2025, '2025'];
    if (it.q2024 != null) return [+it.q2024, '2024'];
    return [null, null];
  }
  function thumb(it) { return it.has_photo ? '<img loading="lazy" src="mare-equip/t/' + E(it.src_key) + '.jpg" alt="">' : M.icon('stock', 26); }
  function nameOf(it) { return it.name; }
  function fnum(v) { return v == null ? '—' : String(+v); }
  function parseCount(s) {
    s = String(s || '').trim(); if (s === '') return { v: null };
    if (!/^\d{1,5}([.,]\d)?$/.test(s)) return { err: true };
    return { v: parseFloat(s.replace(',', '.')) };
  }
  function items() {
    var q = EQ.q.trim().toLowerCase();
    return EQ.data.items.filter(function (it) {
      if (!it.active) return false;
      if (EQ.sheet !== 'all' && it.sheet !== EQ.sheet) return false;
      if (EQ.grp && it.grp !== EQ.grp) return false;
      if (q && (it.name + ' ' + (it.note || '') + ' ' + (it.grp || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function groupsOf() { var g = {}; EQ.data.items.forEach(function (i) { if (i.active && i.grp) g[i.grp] = 1; }); return Object.keys(g).sort(); }
  function filterBar(withShow) {
    return '<div class="eq-bar"><input type="search" id="eqq" placeholder="' + E(T('Search the list')) + '" value="' + E(EQ.q) + '" aria-label="' + E(T('Search the list')) + '">' +
      '<div class="seg" role="group">' + [['all', 'All']].concat(AREAS).map(function (s) { return '<button data-sh="' + s[0] + '" class="' + (EQ.sheet === s[0] ? 'on' : '') + '">' + E(T(s[1])) + '</button>'; }).join('') + '</div>' +
      '<select id="eqg" aria-label="' + E(T('Group')) + '"><option value="">' + E(T('Every group')) + '</option>' + groupsOf().map(function (g) { return '<option value="' + E(g) + '"' + (EQ.grp === g ? ' selected' : '') + '>' + E(T(g)) + '</option>'; }).join('') + '</select>' +
      (withShow ? '<div class="seg" role="group">' + [['all', 'All'], ['todo', 'To count'], ['diff', 'Different']].map(function (s) { return '<button data-show="' + s[0] + '" class="' + (EQ.show === s[0] ? 'on' : '') + '">' + E(T(s[1])) + '</button>'; }).join('') + '</div>' : '') + '</div>';
  }
  function bindBar(main, redraw) {
    var q = main.querySelector('#eqq'); q.oninput = function () { EQ.q = q.value; redraw(); };
    main.querySelector('#eqg').onchange = function () { EQ.grp = this.value; redraw(); };
    App.on(main, '[data-sh]', function (b) { EQ.sheet = b.getAttribute('data-sh'); main.querySelectorAll('[data-sh]').forEach(function (x) { x.classList.toggle('on', x === b); }); redraw(); });
    App.on(main, '[data-show]', function (b) { EQ.show = b.getAttribute('data-show'); main.querySelectorAll('[data-show]').forEach(function (x) { x.classList.toggle('on', x === b); }); redraw(); });
  }

  App.register('equipment', {
    title: 'Crockery & equipment', icon: 'stock', group: 'kitchen', desc: 'What Mare has, with photos, and the monthly count.',
    tabs: [['have', 'What we have'], ['count', 'Count']],
    stat: function () { return [T('List of Nov 2026'), false]; },
    render: function (main, sub) {
      css();
      return load().then(function (r) {
        if (!r) { main.innerHTML = App.empty(T('Could not load.')); return; }
        if (sub === 'count') count(main); else have(main);
      });
    }
  });

  // ════════════════ WHAT WE HAVE ════════════════
  function have(main) {
    var all = EQ.data.items.filter(function (i) { return i.active; });
    var pieces = 0, broken = 0;
    all.forEach(function (i) { if (i.q2026 != null) pieces += +i.q2026; if (+i.broken2026) broken += +i.broken2026; });
    main.innerHTML = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Crockery & equipment')) + '</h2></div>' +
      '<div class="kpis eq-kp"><div class="kpi"><span>' + E(T('Lines')) + '</span><b>' + all.length + '</b></div>' +
      '<div class="kpi"><span>' + E(T('Pieces on the list')) + '</span><b>' + pieces.toLocaleString('en') + '</b><i>' + E(T('Zeljko 5 Nov \u00b7 Milica 9 Nov 2026')) + '</i></div>' +
      '<div class="kpi red"><span>' + E(T('Broken in 2026')) + '</span><b>' + broken + '</b></div></div>' +
      filterBar(false) + '<div id="eqlist" class="stack"></div>' +
      '<p class="small muted" style="margin:0">' + E(T('Big and Small kitchen numbers are from Zeljko\'s inventory list of 5 Nov 2026 (where he left 2026 empty, the last year that has a number is shown). Cutlery & small items, Bar, Storeroom and Restaurant are from Milica\'s list of 9 Nov 2026. Count in the Count tab.')) + '</p></section>';
    function draw() {
      var box = main.querySelector('#eqlist'); var list = items(); if (!list.length) { box.innerHTML = App.empty(T('Nothing found.')); return; }
      var by = {}, order = [];
      list.forEach(function (i) { var k = headOf(i); if (!by[k]) { by[k] = []; order.push(k); } by[k].push(i); });
      box.innerHTML = order.map(function (k) {
        return '<div class="eq-grp"><span>' + E(k) + '</span><span>' + by[k].length + '</span></div><div class="eq-list">' + by[k].map(function (i) {
          var n = now(i), tags = '';
          if (+i.broken2026) tags += '<span class="eq-tag red">' + E(T('broken {n}', { n: +i.broken2026 })) + '</span>';
          if (i.rec2027 != null) tags += '<span class="eq-tag amber">' + E(T('2027: {n}', { n: +i.rec2027 })) + '</span>';
          if (n[1] && n[1] !== '2026') tags += '<span class="eq-tag">' + E(T('list of {y}', { y: n[1] })) + '</span>';
          return '<button class="eq-it" data-eq="' + i.id + '"><span class="eq-ph">' + thumb(i) + '</span><span class="eq-tx"><b>' + E(nameOf(i)) + '</b><span>' + tags + '</span></span><span class="eq-n">' + fnum(n[0]) + '<i>' + E(i.unit || 'KOM') + '</i></span></button>';
        }).join('') + '</div>';
      }).join('');
    }
    bindBar(main, draw); draw();
    App.on(main, '[data-eq]', function (b) { detail(b.getAttribute('data-eq'), main); });
  }

  function detail(id, main) {
    var it = EQ.data.items.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    var big = it.has_photo ? '<img class="photo" src="mare-equip/p/' + E(it.src_key) + '.jpg" alt="' + E(it.name) + '">' : '';
    var o = App.overlay('<div class="row between"><h3>' + E(it.name) + '</h3><button class="btn ghost sm" data-close>' + E(T('Close')) + '</button></div>' + big +
      '<div class="small muted">' + E(headOf(it)) + '</div>' +
      (isZ(it) ?
      '<table class="eq-hist"><thead><tr><th>2019</th><th>2024</th><th>2025</th><th>2026</th><th>' + E(T('Broken')) + '</th><th>2027</th></tr></thead><tbody><tr><td>' + fnum(it.q2019) + '</td><td>' + fnum(it.q2024) + '</td><td>' + fnum(it.q2025) + '</td><td><b>' + fnum(it.q2026) + '</b></td><td>' + fnum(it.broken2026) + '</td><td>' + fnum(it.rec2027) + '</td></tr></tbody></table>' +
      '<div class="grid2"><label class="f">' + E(T('Wanted for 2027')) + '<input type="text" inputmode="decimal" id="er" value="' + (it.rec2027 != null ? +it.rec2027 : '') + '"></label>' +
      '<label class="f">' + E(T('Note')) + '<input type="text" id="en" value="' + E(it.note || '') + '"></label></div>' :
      '<table class="eq-hist"><thead><tr><th>' + E(T('On the list')) + '</th></tr></thead><tbody><tr><td><b>' + fnum(it.q2026) + '</b> ' + E(it.unit || 'PCS') + '</td></tr></tbody></table>' +
      '<div class="small muted">' + E(T("Milica's list, 9 Nov 2026")) + '</div>' +
      '<label class="f">' + E(T('Note')) + '<input type="text" id="en" value="' + E(it.note || '') + '"></label>') +
      '<div class="row"><button class="btn" id="es">' + E(T('Save')) + '</button><button class="btn ghost" id="ex">' + E(T('Take off the list')) + '</button></div>' +
      '<p class="small muted" style="margin:0">' + E(T('Nothing is deleted. A piece taken off the list stays in the database.')) + '</p>');
    o.querySelector('#es').onclick = function () {
      var er = o.querySelector('#er'), rc = er ? parseCount(er.value) : { v: it.rec2027 == null ? null : +it.rec2027 }; if (rc.err) { App.say(T('Write a number.')); return; }
      var btn = this; btn.disabled = true;
      App.call('mare_m_equip_save', { p_row: { id: it.id, rec2027: rc.v == null ? '' : String(rc.v), note: o.querySelector('#en').value.trim() }, p_by: App.S.me }).then(function (r) {
        btn.disabled = false; if (!r) return; Object.assign(it, r.row); o.close(); App.say(T('Saved.')); App.reload();
      });
    };
    o.querySelector('#ex').onclick = function () {
      this.disabled = true;
      App.call('mare_m_equip_save', { p_row: { id: it.id, active: false }, p_by: App.S.me }).then(function (r) { if (!r) return; it.active = false; o.close(); App.say(T('Taken off the list.')); App.reload(); });
    };
  }

  // ════════════════ COUNT ════════════════
  function count(main) {
    var mstart = ms(), cur = M.monthStart(M.today());
    var cmap = {}; EQ.data.counts.forEach(function (c) { cmap[c.item_id] = c; });
    function stats() {
      var act = EQ.data.items.filter(function (i) { return i.active; }), done = 0, pieces = 0, diff = 0;
      act.forEach(function (i) { var c = cmap[i.id]; if (c && c.counted != null) { done++; pieces += +c.counted; var e = now(i)[0]; if (e != null && +c.counted !== e) diff++; } });
      return { total: act.length, done: done, pieces: pieces, diff: diff };
    }
    main.innerHTML = '<section class="stack"><div class="row between"><h2 class="serif">' + E(M.monthName(mstart)) + '</h2><div class="row"><button class="btn ghost" id="cp">‹ ' + E(T('Earlier')) + '</button>' +
      (mstart < cur ? '<button class="btn ghost" id="cn">' + E(T('Later')) + ' ›</button>' : '') + '</div></div>' +
      '<div class="kpis eq-kp" id="eqk"></div>' + filterBar(true) +
      '<div class="box" id="eqlist"></div>' +
      '<p class="small muted" style="margin:0">' + E(T('Type what you count. The number from the list is not shown until you have counted the line, so nobody counts to it. Broken pieces are counted apart.')) + '</p></section>';
    function kpis() {
      var s = stats();
      main.querySelector('#eqk').innerHTML = '<div class="kpi"><span>' + E(T('Lines counted')) + '</span><b>' + s.done + ' / ' + s.total + '</b></div>' +
        '<div class="kpi"><span>' + E(T('Pieces counted')) + '</span><b>' + s.pieces.toLocaleString('en') + '</b></div>' +
        '<div class="kpi' + (s.diff ? ' red' : '') + '"><span>' + E(T('Different from the list')) + '</span><b>' + s.diff + '</b></div>';
    }
    function rowHtml(i) {
      var c = cmap[i.id] || {}, e = now(i)[0], counted = c.counted != null, d = counted && e != null && +c.counted !== e;
      return '<div class="eq-row' + (counted ? (d ? ' diff' : ' done') : '') + '" data-row="' + i.id + '"><span class="eq-ph">' + thumb(i) + '</span>' +
        '<span class="eq-tx"><b>' + E(i.name) + '</b><span class="tiny">' + E(subOf(i)) + '</span>' +
        (counted && e != null ? '<span class="tiny">' + (d ? '<span class="eq-tag amber">' + E(T('list says {n}', { n: e })) + '</span>' : '<span class="eq-tag green">' + E(T('as in the list')) + '</span>') + '</span>' : '') + '</span>' +
        '<label>' + E(T('Counted')) + '<input type="text" inputmode="decimal" data-cf="counted" data-id="' + i.id + '" value="' + (c.counted != null ? +c.counted : '') + '"></label>' +
        '<label>' + E(T('Broken')) + '<input type="text" inputmode="decimal" data-cf="broken" data-id="' + i.id + '" value="' + (c.broken != null ? +c.broken : '') + '"></label></div>';
    }
    function draw() {
      var list = items().filter(function (i) {
        var c = cmap[i.id], counted = c && c.counted != null;
        if (EQ.show === 'todo') return !counted;
        if (EQ.show === 'diff') { var e = now(i)[0]; return counted && e != null && +c.counted !== e; }
        return true;
      });
      var box = main.querySelector('#eqlist');
      box.innerHTML = list.length ? list.map(rowHtml).join('') : App.empty(T(EQ.show === 'todo' ? 'Everything here is counted.' : 'Nothing found.'));
      kpis();
    }
    bindBar(main, draw); draw();
    main.querySelector('#cp').onclick = function () { EQ.month = M.addMonths(mstart, -1); App.reload(); };
    var cn = main.querySelector('#cn'); if (cn) cn.onclick = function () { EQ.month = M.addMonths(mstart, 1); App.reload(); };
    App.on(main, '[data-cf]', function (inp) {
      var id = inp.getAttribute('data-id'), field = inp.getAttribute('data-cf'), p = parseCount(inp.value);
      if (p.err) { App.say(T('Write a number.')); inp.focus(); return; }
      App.call('mare_m_equip_count', { p_item: id, p_month: mstart, p_field: field, p_val: p.v, p_by: App.S.me }).then(function (r) {
        if (!r) return;
        var c = cmap[id] || (cmap[id] = { item_id: id, counted: null, broken: null }); c[field] = p.v;
        EQ.data.counts = Object.keys(cmap).map(function (k) { return cmap[k]; });
        var rowEl = inp.closest('[data-row]'), it = EQ.data.items.filter(function (x) { return x.id === id; })[0];
        if (rowEl && it) { var keepF = field === 'counted' ? 'broken' : 'counted'; var tmp = document.createElement('div'); tmp.innerHTML = rowHtml(it); var nr = tmp.firstChild; rowEl.className = nr.className; rowEl.querySelector('.eq-tx').innerHTML = nr.querySelector('.eq-tx').innerHTML; }
        kpis(); App.say(T('Saved.'));
      });
    }, 'change');
  }
})(window);
