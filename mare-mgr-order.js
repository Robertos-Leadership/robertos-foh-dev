/* Roberto's Mare — Ordering (14 Oct 2026): articles, suppliers, price upload, orders.
   Milica's request: the kitchen and bar article lists with supplier and price, prices
   updated by uploading the stock-system export, and kitchen and bar ordering from the app.
   Decided by Francesco: an article needs no supplier to go in (Milica assigns them later);
   suppliers have their own page with any field she adds; every order comes to Milica first,
   and a tick per supplier (admin only, off at the start) lets its orders go straight out.
   Viber / WhatsApp / email open on the sender's own device with the order written in: the
   app never sends to a supplier by itself. Matching is always on the stock code, never the name. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;
  var O = { d: null, store: 'all', flt: 'all', q: '', sup: '', tick: {}, show: 150, basket: {}, bstore: 'kitchen', nq: '', up: null };

  if (!document.getElementById('mo-css')) {
    var st = document.createElement('style'); st.id = 'mo-css';
    st.textContent =
      '.mo-chips{display:flex;gap:8px;flex-wrap:wrap}' +
      '.mo-chip{border:1px solid var(--line);background:#fff;border-radius:20px;padding:7px 14px;font-size:13px;font-weight:700;color:var(--teal);min-height:36px}' +
      '.mo-chip.on{background:var(--teal);color:#fff;border-color:var(--teal)} .mo-chip.amber{color:var(--amber);background:var(--amber-bg);border-color:rgba(122,74,18,.35)} .mo-chip.amber.on{background:var(--amber);color:#fff}' +
      '.mo-chip.red{color:var(--red);background:var(--red-bg);border-color:rgba(138,46,46,.35)} .mo-chip.red.on{background:var(--red);color:#fff}' +
      '.mo-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center} .mo-tools input[type=text]{flex:1;min-width:180px} .mo-tools select{max-width:260px}' +
      '.mo-list{padding:0!important} .mo-row{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line-2);min-height:56px}' +
      '.mo-row:last-child{border-bottom:0} .mo-row.ticked{background:#FBF6EE} .mo-row input[type=checkbox]{width:22px;height:22px;flex-shrink:0}' +
      '.mo-main{flex:1;min-width:0;cursor:pointer} .mo-main b{display:block;font-size:16px;font-weight:600;overflow-wrap:anywhere} .mo-main span{font-size:13px;color:var(--muted)}' +
      '.mo-price{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;font-weight:700;min-width:84px} .mo-price.none{color:var(--red);font-weight:600;font-size:13px}' +
      '.mo-sup{min-width:150px;max-width:220px;text-align:right} .mo-sup .tag{white-space:normal;text-align:left}' +
      '.mo-add{background:none;border:1px dashed rgba(122,74,18,.5);color:var(--amber);border-radius:8px;padding:6px 10px;font-weight:700;font-size:13px;min-height:36px}' +
      '.mo-bulk{position:sticky;top:0;z-index:20;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--rail);color:#fff;border-radius:10px;padding:10px 14px}' +
      '.mo-bulk select{max-width:260px} .mo-bulk .btn.ghost{min-height:38px}' +
      '.mo-sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}' +
      '.mo-scard{text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:6px;font:inherit;color:inherit}' +
      '.mo-scard b{font-family:"Cormorant Garamond",Georgia,serif;font-size:24px;font-weight:600}' +
      '.mo-kv{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:10px 14px;align-items:center}' +
      '.mo-kv > label{font-size:10.5px;letter-spacing:2px;font-weight:700;color:var(--muted);text-transform:uppercase}' +
      '.mo-kv > label.mine{color:var(--gold)} .mo-kv input,.mo-kv select,.mo-kv textarea{width:100%}' +
      '.mo-ord{display:flex;flex-direction:column;gap:12px} .mo-ohead{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline}' +
      '.mo-ohead h3{margin:0;font-family:"Cormorant Garamond",Georgia,serif;font-size:24px}' +
      '.mo-lines{width:100%;border-collapse:collapse} .mo-lines td{padding:7px 4px;border-bottom:1px solid var(--line-2);vertical-align:middle} .mo-lines td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.mo-lines input{width:84px;text-align:right}' +
      '.mo-send{display:flex;gap:8px;flex-wrap:wrap} .mo-send .btn{min-height:44px;text-decoration:none;display:inline-flex;align-items:center} .mo-ord [hidden]{display:none!important}' +
      '.mo-qty{display:flex;align-items:center;gap:6px} .mo-qty button{width:40px;height:40px;border-radius:8px;border:1px solid var(--line);background:#fff;font-size:20px;color:var(--teal)}' +
      '.mo-qty input{width:68px;text-align:center}' +
      '.mo-basket{position:sticky;bottom:0;z-index:20;background:var(--rail);color:#fff;border-radius:12px 12px 0 0;padding:14px 16px;display:flex;flex-direction:column;gap:10px}' +
      '.mo-basket .row{gap:10px} .mo-basket label.f{color:#C9D8D6} .mo-basket b.tot{font-size:22px}' +
      '.mo-diff{width:100%;border-collapse:collapse;font-size:14px} .mo-diff td,.mo-diff th{padding:6px 4px;border-bottom:1px solid var(--line-2);text-align:left} .mo-diff td.n{text-align:right;white-space:nowrap}' +
      '.mo-up{color:var(--red);font-weight:700} .mo-down{color:var(--green);font-weight:700}' +
      '@media (max-width:700px){.mo-row{flex-wrap:wrap;padding:10px 12px}.mo-sup{min-width:0;max-width:none;flex-basis:100%;text-align:left;padding-left:34px}.mo-kv{grid-template-columns:1fr}.mo-tools select{max-width:none;width:100%}}';
    document.head.appendChild(st);
  }

  // ── names in two languages ──
  // The stock list often holds both: "krastavac / cucumber local". A name typed in the app wins.
  function split(n) {
    n = String(n || '');
    var i = n.lastIndexOf(' / ');
    if (i > 0) return [n.slice(0, i).trim(), n.slice(i + 3).trim()];
    var m = n.match(/^([^/]*[^/\d\s])\s*\/\s*([^/\d\s][^/]*)$/);
    return m ? [m[1].trim(), m[2].trim()] : [n, n];
  }
  function nm(a) { var s = split(a.name); return M.lang() === 'me' ? (a.name_me || s[0]) : (a.name_en || s[1]); }
  function nm2(a) { var s = split(a.name); var o = M.lang() === 'me' ? (a.name_en || s[1]) : (a.name_me || s[0]); return o !== nm(a) ? o : ''; }
  O.nm = nm;
  var STORES = { kitchen: 'Kitchen', bar: 'Bar' };
  var UNITS = { kom: 'pcs', KG: 'kg', L: 'L' };
  function unit(u) { return u ? T(UNITS[u] || u) : ''; }
  function price(a) { return a.price == null ? '<span class="mo-price none">' + E(T('no price')) + '</span>' : '<span class="mo-price">' + M.money(+a.price) + '<small class="muted"> / ' + E(unit(a.unit)) + '</small></span>'; }
  function supName(id) { var s = O.d && O.d.suppliers.filter(function (x) { return x.id === id; })[0]; return s ? s.name : ''; }
  function load() { return App.call('mare_m_ord_data', { p_days: 60 }).then(function (d) { if (d) O.d = d; return d; }); }
  function supOptions(sel, withNone) {
    return (withNone ? '<option value="">' + E(T('No supplier yet')) + '</option>' : '') + O.d.suppliers.filter(function (s) { return s.active || s.id === sel; }).map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + E(s.name) + '</option>'; }).join('');
  }

  App.register('ordering', {
    title: 'Ordering', icon: 'stock', group: 'kitchen', desc: 'Kitchen and bar articles, suppliers and prices; orders from the team, checked by Milica.',
    tabs: [['orders', 'Orders'], ['new', 'New order'], ['articles', 'Articles'], ['suppliers', 'Suppliers'], ['upload', 'Price upload']],
    render: function (main, sub) {
      main.innerHTML = '<div class="muted">' + E(T('Loading…')) + '</div>';
      return load().then(function (d) {
        if (!d) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var waiting = d.orders.filter(function (o) { return o.status === 'waiting'; }).length;
        App.S.counts.ordering = waiting || 0; if (!waiting) delete App.S.counts.ordering;
        ({ orders: orders, 'new': newOrder, articles: articles, suppliers: suppliers, upload: upload })[sub || 'orders'](main);
      });
    }
  });

  // ════════════════ ARTICLES ════════════════
  function articles(main) {
    var all = O.d.articles;
    function pass(a, f) {
      if (O.store !== 'all' && a.store !== O.store) return false;
      f = f || O.flt;
      if (f === 'nosup' && (a.supplier_id || !a.active)) return false;
      if (f === 'noprice' && (a.price != null || !a.active)) return false;
      if (f === 'off' && a.active) return false;
      if (f === 'all' && !a.active) return false;
      if (O.sup && a.supplier_id !== O.sup) return false;
      if (O.q) { var q = O.q.toLowerCase(); if ((a.name + ' ' + (a.name_me || '') + ' ' + (a.name_en || '') + ' ' + a.code + ' ' + (a.grp || '')).toLowerCase().indexOf(q) < 0) return false; }
      return true;
    }
    function count(f, store) { var keep = O.store; O.store = store || O.store; var n = all.filter(function (a) { return pass(a, f); }).length; O.store = keep; return n; }
    function chip(k, label, f, cls, store) {
      var on = store ? O.store === store : O.flt === f;
      return '<button class="mo-chip ' + (cls || '') + (on ? ' on' : '') + '" ' + (store ? 'data-store="' + store + '"' : 'data-flt="' + f + '"') + '>' + E(T(label)) + ' · ' + (store ? (store === 'all' ? all.filter(function (a) { return a.active; }).length : all.filter(function (a) { return a.store === store && a.active; }).length) : count(f)) + '</button>';
    }
    function paint() {
      var list = all.filter(function (a) { return pass(a); });
      var ticked = Object.keys(O.tick).filter(function (id) { return O.tick[id]; });
      var h = '<section class="stack">' +
        '<div class="row between"><h2 class="serif">' + E(T('Articles')) + '</h2><div class="row"><button class="btn ghost" data-go-up>' + E(T('Upload new prices')) + '</button><button class="btn" id="mo-newa">' + E(T('New article')) + '</button></div></div>' +
        '<div class="mo-chips">' + chip('', 'All', null, '', 'all') + chip('', 'Kitchen', null, '', 'kitchen') + chip('', 'Bar', null, '', 'bar') + '</div>' +
        '<div class="mo-chips">' + chip('all', 'On the list', 'all') + chip('nosup', 'No supplier yet', 'nosup', 'amber') + chip('noprice', 'No price', 'noprice', 'red') + chip('off', 'Off the list', 'off') + '</div>' +
        '<div class="mo-tools"><input type="text" id="mo-q" value="' + E(O.q) + '" placeholder="' + E(T('Search a name or a code')) + '" aria-label="' + E(T('Search')) + '">' +
        '<select id="mo-sf" aria-label="' + E(T('Supplier')) + '"><option value="">' + E(T('Every supplier')) + '</option>' + supOptions(O.sup) + '</select></div>' +
        (ticked.length ? '<div class="mo-bulk"><b>' + E(T('{n} ticked', { n: ticked.length })) + '</b><select id="mo-bs"><option value="">' + E(T('Choose a supplier…')) + '</option>' + supOptions('') + '<option value="__new">+ ' + E(T('New supplier')) + '</option><option value="__none">' + E(T('Take the supplier off')) + '</option></select>' +
          '<button class="btn ghost sm" id="mo-ba">' + E(T('Set supplier')) + '</button><button class="btn ghost sm" id="mo-bc">' + E(T('Untick all')) + '</button></div>' : '') +
        '<div class="small muted">' + E(T('{n} articles', { n: list.length })) + (list.length ? ' · <button class="lnk" style="margin:0" id="mo-tall">' + E(T('Tick all shown')) + '</button>' : '') + '</div>';
      h += list.length ? '<div class="card mo-list">' + list.slice(0, O.show).map(function (a) {
        var o2 = nm2(a);
        return '<div class="mo-row' + (O.tick[a.id] ? ' ticked' : '') + '"><input type="checkbox" data-tk="' + a.id + '"' + (O.tick[a.id] ? ' checked' : '') + ' aria-label="' + E(T('Tick')) + '">' +
          '<div class="mo-main" data-a="' + a.id + '"><b>' + E(nm(a)) + '</b><span>' + E(a.code) + ' · ' + E(T(STORES[a.store])) + (o2 ? ' · ' + E(o2) : '') + (a.pack ? ' · ' + E(a.pack) : '') + '</span></div>' +
          price(a) + '<div class="mo-sup">' + (a.supplier_id ? '<span class="tag teal">' + E(supName(a.supplier_id)) + '</span>' : '<button class="mo-add" data-pick="' + a.id + '">+ ' + E(T('Choose supplier')) + '</button>') + '</div></div>';
      }).join('') + '</div>' + (list.length > O.show ? '<button class="btn ghost" id="mo-more">' + E(T('Show all {n}', { n: list.length })) + '</button>' : '')
        : App.empty(T('Nothing matches.'));
      main.innerHTML = h + '</section>';
      var q = main.querySelector('#mo-q');
      q.oninput = function () { O.q = q.value; var p = q.selectionStart; paint(); var n = main.querySelector('#mo-q'); n.focus(); n.setSelectionRange(p, p); };
      main.querySelector('#mo-sf').onchange = function () { O.sup = this.value; paint(); };
      main.querySelector('#mo-newa').onclick = function () { articleForm({ store: O.store === 'bar' ? 'bar' : 'kitchen', active: true }); };
      var mr = main.querySelector('#mo-more'); if (mr) mr.onclick = function () { O.show = 100000; paint(); };
      var ta = main.querySelector('#mo-tall'); if (ta) ta.onclick = function () { list.forEach(function (a) { O.tick[a.id] = true; }); paint(); };
      var bc = main.querySelector('#mo-bc'); if (bc) bc.onclick = function () { O.tick = {}; paint(); };
      var ba = main.querySelector('#mo-ba'); if (ba) ba.onclick = function () {
        var v = main.querySelector('#mo-bs').value; if (!v) { App.say(T('Choose a supplier first.')); return; }
        if (v === '__new') { supplierForm({ active: true }, function (s) { setSup(ticked, s.id); }); return; }
        setSup(ticked, v === '__none' ? null : v);
      };
    }
    function setSup(ids, sid) {
      App.call('mare_m_ord_set_supplier', { p_ids: ids, p_supplier: sid }).then(function (r) {
        if (!r) return; App.say(T('{n} articles updated.', { n: r.n })); O.tick = {};
        load().then(function () { all = O.d.articles; paint(); });
      });
    }
    App.on(main, '[data-store]', function (b) { O.store = b.getAttribute('data-store'); O.show = 150; paint(); });
    App.on(main, '[data-flt]', function (b) { O.flt = b.getAttribute('data-flt'); O.show = 150; paint(); });
    App.on(main, '[data-tk]', function (b) { O.tick[b.getAttribute('data-tk')] = b.checked; paint(); }, 'change');
    App.on(main, '[data-a]', function (b) { articleForm(all.filter(function (a) { return a.id === b.getAttribute('data-a'); })[0]); });
    App.on(main, '[data-pick]', function (b) { pickSupplier(all.filter(function (a) { return a.id === b.getAttribute('data-pick'); })[0]); });
    App.on(main, '[data-go-up]', function () { App.go('ordering', 'upload'); });
    paint();
  }
  // One article: one tap on "+ Choose supplier".
  function pickSupplier(a) {
    var o = App.overlay('<div class="row between"><h3>' + E(nm(a)) + '</h3><button class="btn ghost sm" data-close>' + E(T('Close')) + '</button></div>' +
      '<label class="f">' + E(T('Supplier')) + '<select id="ps">' + '<option value="">' + E(T('Choose a supplier…')) + '</option>' + supOptions(a.supplier_id) + '</select></label>' +
      '<div class="row"><button class="btn" id="pok">' + E(T('Save')) + '</button><button class="btn ghost" id="pnew">+ ' + E(T('New supplier')) + '</button></div>');
    o.querySelector('#pok').onclick = function () {
      var v = o.querySelector('#ps').value; if (!v) { App.say(T('Choose a supplier first.')); return; }
      App.call('mare_m_ord_set_supplier', { p_ids: [a.id], p_supplier: v }).then(function (r) { if (r) { o.close(); App.say(T('Saved.')); App.reload(); } });
    };
    o.querySelector('#pnew').onclick = function () { o.close(); supplierForm({ active: true }, function (s) { App.call('mare_m_ord_set_supplier', { p_ids: [a.id], p_supplier: s.id }).then(function () { App.reload(); }); }); };
  }
  function articleForm(a) {
    var s = split(a.name || '');
    var o = App.overlay('<div class="row between"><h3>' + E(a.id ? nm(a) : T('New article')) + '</h3><button class="btn ghost sm" data-close>' + E(T('Close')) + '</button></div>' +
      (a.id ? '<div class="small muted">' + E(T('In the stock list: {n}', { n: a.name })) + '</div>' : '') +
      '<div class="grid2">' +
      (a.id ? '' : '<label class="f">' + E(T('Code (Šifra)')) + '<input type="text" id="ac"></label><label class="f">' + E(T('Name as in the stock list')) + '<input type="text" id="an"></label>') +
      '<label class="f">' + E(T('Name in Montenegrin')) + '<input type="text" id="ame" value="' + E(a.name_me || '') + '" placeholder="' + E(a.id ? s[0] : '') + '"></label>' +
      '<label class="f">' + E(T('Name in English')) + '<input type="text" id="aen" value="' + E(a.name_en || '') + '" placeholder="' + E(a.id ? s[1] : '') + '"></label>' +
      '<label class="f">' + E(T('Kitchen or bar')) + '<select id="ast"><option value="kitchen"' + (a.store === 'kitchen' ? ' selected' : '') + '>' + E(T('Kitchen')) + '</option><option value="bar"' + (a.store === 'bar' ? ' selected' : '') + '>' + E(T('Bar')) + '</option></select></label>' +
      '<label class="f">' + E(T('Unit')) + '<select id="au">' + ['KG', 'L', 'kom'].map(function (u) { return '<option value="' + u + '"' + (a.unit === u ? ' selected' : '') + '>' + E(unit(u)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">' + E(T('Price per unit (€)')) + '<input type="text" inputmode="decimal" data-num="1" id="ap" value="' + (a.price != null ? String(Math.round(a.price * 100) / 100).replace('.', M.lang() === 'me' ? ',' : '.') : '') + '"></label>' +
      '<label class="f">' + E(T('How it is bought (optional)')) + '<input type="text" id="apk" value="' + E(a.pack || '') + '" placeholder="' + E(T('e.g. box of 6 bottles')) + '"></label>' +
      '<label class="f">' + E(T('Supplier')) + '<select id="asu">' + supOptions(a.supplier_id, true) + '</select></label></div>' +
      '<div class="small muted">' + E(T('Price {p} from {d}. Upload a new stock list to update every price at once.', { p: a.price != null ? M.money(+a.price) : '—', d: a.price_at ? M.shortDate(a.price_at) : '—' })) + '</div>' +
      '<div id="ph"></div>' +
      '<div class="row"><button class="btn" id="as">' + E(T('Save')) + '</button>' + (a.id ? '<button class="btn ' + (a.active ? 'warn' : 'ghost') + '" id="aoff">' + E(a.active ? T('Take off the order list') : T('Put back on the order list')) + '</button><button class="btn ghost" id="ahist">' + E(T('Price history')) + '</button>' : '') + '</div>');
    o.querySelector('#as').onclick = function () {
      var p; try { p = M.num(o.querySelector('#ap').value); } catch (e) { App.say(e.message); return; }
      var row = { name_me: o.querySelector('#ame').value.trim() || null, name_en: o.querySelector('#aen').value.trim() || null, store: o.querySelector('#ast').value, unit: o.querySelector('#au').value,
        pack: o.querySelector('#apk').value.trim() || null, supplier_id: o.querySelector('#asu').value || null };
      if (p !== (a.price == null ? null : Math.round(a.price * 100) / 100)) row.price = p;
      if (a.id) row.id = a.id;
      else {
        row.code = o.querySelector('#ac').value.trim(); row.name = o.querySelector('#an').value.trim(); row.active = true; row.price = p;
        if (!row.code || !row.name) { App.say(T('Type the code and the name.')); return; }
        if (O.d.articles.some(function (x) { return x.store === row.store && x.code === row.code; })) { App.say(T('That code is already on the list.')); return; }
      }
      App.call('mare_m_ord_save', { p_table: 'mare_articles', p_row: row }).then(function (r) { if (r) { o.close(); App.say(T('Saved.')); App.reload(); } });
    };
    var off = o.querySelector('#aoff'); if (off) off.onclick = function () { App.call('mare_m_ord_save', { p_table: 'mare_articles', p_row: { id: a.id, active: !a.active } }).then(function (r) { if (r) { o.close(); App.reload(); } }); };
    var hi = o.querySelector('#ahist'); if (hi) hi.onclick = function () {
      App.call('mare_m_price_history', { p_article: a.id }).then(function (r) {
        if (!r) return;
        o.querySelector('#ph').innerHTML = '<table class="mo-diff"><tr><th>' + E(T('When')) + '</th><th>' + E(T('From')) + '</th><th>' + E(T('To')) + '</th><th>' + E(T('How')) + '</th></tr>' + r.log.map(function (l) {
          return '<tr><td>' + E(M.shortDate(M.dateKey(l.at))) + '</td><td class="n">' + (l.old_price != null ? M.money(+l.old_price) : '—') + '</td><td class="n">' + (l.new_price != null ? M.money(+l.new_price) : '—') + '</td><td>' + E(T({ upload: 'Upload', edit: 'Typed in', 'first load': 'First list' }[l.source] || l.source)) + '</td></tr>';
        }).join('') + '</table>';
      });
    };
  }

  // ════════════════ SUPPLIERS ════════════════
  var FIXED = [['contact', 'Contact person', 'text'], ['phone', 'Phone', 'phone'], ['viber', 'Viber', 'phone'], ['whatsapp', 'WhatsApp', 'phone'], ['email', 'Email', 'email'],
               ['delivery_days', 'Delivers on', 'text'], ['cutoff', 'Order before', 'text'], ['notes', 'Notes', 'area']];
  var BY = { viber: 'Viber', whatsapp: 'WhatsApp', email: 'Email', phone: 'Phone call' };
  function suppliers(main) {
    var list = O.d.suppliers;
    var on = list.filter(function (s) { return s.active; }), off = list.filter(function (s) { return !s.active; });
    var nosup = O.d.articles.filter(function (a) { return a.active && !a.supplier_id; }).length;
    var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Suppliers')) + '</h2><div class="row"><button class="btn ghost" id="mo-fld">+ ' + E(T('Add a field')) + '</button><button class="btn" id="mo-ns">' + E(T('New supplier')) + '</button></div></div>' +
      (nosup ? '<button class="notice" style="text-align:left;cursor:pointer;font:inherit" data-nosup><b>' + E(T('{n} articles have no supplier yet', { n: nosup })) + '</b><span>' + E(T('Open Articles → No supplier yet, tick several and set their supplier in one go.')) + '</span></button>' : '');
    h += on.length ? '<div class="mo-sgrid">' + on.map(function (s) {
      return '<button class="card mo-scard" data-s="' + s.id + '"><b>' + E(s.name) + '</b><span class="muted">' + E(T('{n} articles', { n: s.n_articles })) + (s.order_by ? ' · ' + E(T(BY[s.order_by])) : '') + '</span>' +
        '<span>' + (s.direct ? '<span class="tag green">' + E(T('Orders go straight')) + '</span>' : '<span class="tag grey">' + E(T('Orders via Milica')) + '</span>') + '</span>' +
        (s.last_order ? '<span class="small muted">' + E(T('Last order {d}', { d: M.shortDate(M.dateKey(s.last_order)) })) + '</span>' : '') + '</button>';
    }).join('') + '</div>' : App.empty(T('No suppliers yet. Add the first one, then give it its articles from the Articles tab.'));
    if (off.length) h += '<details><summary>' + E(T('No longer used · {n}', { n: off.length })) + '</summary><div class="row" style="margin-top:8px">' + off.map(function (s) { return '<button class="btn ghost sm" data-s="' + s.id + '">' + E(s.name) + '</button>'; }).join('') + '</div></details>';
    if (O.d.fields.length) h += '<div class="small muted">' + E(T('Fields you added: {f}', { f: O.d.fields.map(function (f) { return f.label; }).join(', ') })) + '</div>';
    main.innerHTML = h + '</section>';
    main.querySelector('#mo-ns').onclick = function () { supplierForm({ active: true }); };
    main.querySelector('#mo-fld').onclick = fieldForm;
    App.on(main, '[data-s]', function (b) { supplierForm(list.filter(function (s) { return s.id === b.getAttribute('data-s'); })[0]); });
    App.on(main, '[data-nosup]', function () { O.flt = 'nosup'; O.store = 'all'; App.go('ordering', 'articles'); });
  }
  function supplierForm(s, then) {
    var ex = s.extra || {}, admin = !!(O.d && O.d.admin);
    function inp(id, kind, v) {
      if (kind === 'area') return '<textarea id="' + id + '">' + E(v || '') + '</textarea>';
      return '<input id="' + id + '" type="' + (kind === 'email' ? 'email' : kind === 'date' ? 'date' : 'text') + '"' + (kind === 'phone' ? ' inputmode="tel"' : kind === 'number' ? ' inputmode="decimal"' : '') + ' value="' + E(v || '') + '">';
    }
    var arts = s.id ? O.d.articles.filter(function (a) { return a.supplier_id === s.id && a.active; }) : [];
    var o = App.overlay('<div class="row between"><h3 class="serif" style="font-size:28px">' + E(s.id ? s.name : T('New supplier')) + '</h3><button class="btn ghost sm" data-close>' + E(T('Close')) + '</button></div>' +
      '<div class="mo-kv"><label for="sn">' + E(T('Name')) + '</label><input id="sn" type="text" value="' + E(s.name || '') + '">' +
      '<label for="sb">' + E(T('Takes orders by')) + '</label><select id="sb"><option value="">—</option>' + Object.keys(BY).map(function (k) { return '<option value="' + k + '"' + (s.order_by === k ? ' selected' : '') + '>' + E(T(BY[k])) + '</option>'; }).join('') + '</select>' +
      FIXED.map(function (f) { return '<label for="s_' + f[0] + '">' + E(T(f[1])) + '</label>' + inp('s_' + f[0], f[2], s[f[0]]); }).join('') +
      O.d.fields.map(function (f) { return '<label class="mine" for="x_' + f.id + '">' + E(f.label) + '</label>' + inp('x_' + f.id, f.kind, ex[f.id]); }).join('') + '</div>' +
      '<button class="lnk" style="align-self:flex-start" id="sfld">+ ' + E(T('Add a field')) + '</button>' +
      '<label class="row" style="gap:10px;align-items:flex-start;flex-wrap:nowrap;font-size:16px' + (admin ? '' : ';opacity:.6') + '"><input type="checkbox" id="sd" style="width:22px;height:22px;flex-shrink:0"' + (s.direct ? ' checked' : '') + (admin ? '' : ' disabled') + '><span><b>' + E(T('Send orders straight to this supplier')) + '</b><br><span class="small muted">' +
        E(admin ? T('Off: every order comes to you first. On: the person who orders sends it to the supplier themselves. Articles without a supplier always come to you.') : T('Only the Mare admin can change this.')) + '</span></span></label>' +
      (arts.length ? '<details><summary>' + E(T('Its articles · {n}', { n: arts.length })) + '</summary><table class="mo-diff">' + arts.map(function (a) { return '<tr><td>' + E(nm(a)) + '</td><td>' + E(T(STORES[a.store])) + '</td><td class="n">' + (a.price != null ? M.money(+a.price) + ' / ' + E(unit(a.unit)) : '—') + '</td></tr>'; }).join('') + '</table></details>' : '') +
      '<div class="row"><button class="btn" id="ss">' + E(T('Save')) + '</button>' + (s.id ? '<button class="btn ' + (s.active ? 'warn' : 'ghost') + '" id="soff">' + E(s.active ? T('No longer used') : T('Use again')) + '</button>' : '') + '</div>');
    function collect() {
      var row = { name: o.querySelector('#sn').value.trim(), order_by: o.querySelector('#sb').value || null, active: s.active !== false };
      FIXED.forEach(function (f) { row[f[0]] = o.querySelector('#s_' + f[0]).value.trim() || null; });
      var x = {}; Object.keys(ex).forEach(function (k) { x[k] = ex[k]; });
      O.d.fields.forEach(function (f) { var el = o.querySelector('#x_' + f.id); if (!el) return; var v = el.value.trim(); if (v) x[f.id] = v; else delete x[f.id]; });
      row.extra = x;
      if (admin && !!o.querySelector('#sd').checked !== !!s.direct) row.direct = o.querySelector('#sd').checked;
      if (s.id) row.id = s.id;
      return row;
    }
    o.querySelector('#ss').onclick = function () {
      var row = collect(); if (row.name.length < 2) { App.say(T('Type the name.')); return; }
      if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) { App.say(T('That email does not look right.')); return; }
      var btn = this; btn.disabled = true;
      App.call('mare_m_ord_save', { p_table: 'mare_suppliers', p_row: row }).then(function (r) {
        btn.disabled = false; if (!r) return; o.close(); App.say(T('Saved.'));
        if (then) then(r.row); else App.reload();
      });
    };
    // A new field must not lose what was already typed: reopen with the typed values.
    o.querySelector('#sfld').onclick = function () {
      fieldForm(function () { var cur = collect(), keep = {}; Object.keys(s).forEach(function (k) { keep[k] = s[k]; }); Object.keys(cur).forEach(function (k) { keep[k] = cur[k]; });
        if (!('direct' in cur)) keep.direct = s.direct; o.close(); supplierForm(keep, then); });
    };
    var so = o.querySelector('#soff'); if (so) so.onclick = function () { App.call('mare_m_ord_save', { p_table: 'mare_suppliers', p_row: { id: s.id, active: !s.active } }).then(function (r) { if (r) { o.close(); App.reload(); } }); };
  }
  // A field Milica adds shows on every supplier.
  function fieldForm(then) {
    var KINDS = [['text', 'Text'], ['number', 'Number'], ['phone', 'Phone'], ['email', 'Email'], ['date', 'Date']];
    var o = App.overlay('<div class="row between"><h3>' + E(T('Add a field')) + '</h3><button class="btn ghost sm" data-close>' + E(T('Close')) + '</button></div>' +
      '<p class="muted" style="margin:0">' + E(T('It appears on every supplier.')) + '</p>' +
      '<label class="f">' + E(T('Name of the field')) + '<input type="text" id="fl" placeholder="' + E(T('e.g. Minimum order, VAT number, Bank account')) + '"></label>' +
      '<label class="f">' + E(T('Kind')) + '<select id="fk">' + KINDS.map(function (k) { return '<option value="' + k[0] + '">' + E(T(k[1])) + '</option>'; }).join('') + '</select></label>' +
      (O.d.fields.length ? '<div class="small muted">' + E(T('Already there: {f}', { f: O.d.fields.map(function (f) { return f.label; }).join(', ') })) + '</div>' : '') +
      '<div class="row"><button class="btn" id="fs">' + E(T('Add field')) + '</button></div>');
    o.querySelector('#fs').onclick = function () {
      var l = o.querySelector('#fl').value.trim(); if (l.length < 2) { App.say(T('Type the name of the field.')); return; }
      if (O.d.fields.some(function (f) { return f.label.toLowerCase() === l.toLowerCase(); })) { App.say(T('That field is already there.')); return; }
      App.call('mare_m_ord_save', { p_table: 'mare_supplier_fields', p_row: { label: l, kind: o.querySelector('#fk').value, sort: O.d.fields.length + 1 } }).then(function (r) {
        if (!r) return; o.close(); App.say(T('Field added.'));
        load().then(function () { if (typeof then === 'function') then(); else App.reload(); });
      });
    };
  }

  // ════════════════ ORDERS ════════════════
  // The order as the supplier reads it. Names as in the stock list (what the supplier knows).
  function orderText(o, sup) {
    var me = M.lang() === 'me';
    var t = (me ? 'Narudžba' : 'Order') + ' — Roberto\'s Mare (' + (me ? 'br.' : 'no.') + ' ' + o.no + ')\n' +
      (o.deliver_on ? (me ? 'Isporuka: ' : 'Delivery: ') + M.niceDate(o.deliver_on) + '\n' : '') + '\n' +
      o.lines.map(function (l) { return '• ' + l.name + ' — ' + fmtQty(l.qty) + ' ' + unit(l.unit); }).join('\n') +
      (o.note ? '\n\n' + (me ? 'Napomena: ' : 'Note: ') + o.note : '') + '\n\n' + (me ? 'Hvala,' : 'Thank you,') + '\nRoberto\'s Mare, Porto Montenegro';
    return t;
  }
  O.orderText = orderText;
  function fmtQty(q) { q = Math.round(+q * 1000) / 1000; return M.lang() === 'me' ? String(q).replace('.', ',') : String(q); }
  O.fmtQty = fmtQty;
  function digits(p) { return String(p || '').replace(/[^\d+]/g, '').replace(/^00/, '+'); }
  // Buttons that open the sender's own Viber, WhatsApp or email with the order written in.
  function sendButtons(o, sup) {
    var txt = orderText(o, sup), h = '';
    h += '<a class="btn" href="viber://forward?text=' + encodeURIComponent(txt) + '" data-via="viber">' + E(T('Send on Viber')) + '</a>';
    if (sup && sup.whatsapp) h += '<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/' + digits(sup.whatsapp).replace('+', '') + '?text=' + encodeURIComponent(txt) + '" data-via="whatsapp">WhatsApp</a>';
    if (sup && sup.email) h += '<a class="btn ghost" href="mailto:' + encodeURIComponent(sup.email) + '?subject=' + encodeURIComponent((M.lang() === 'me' ? 'Narudžba' : 'Order') + ' — Roberto\'s Mare ' + o.no) + '&body=' + encodeURIComponent(txt) + '" data-via="email">' + E(T('Email')) + '</a>';
    if (sup && sup.phone) h += '<a class="btn ghost" href="tel:' + digits(sup.phone) + '" data-via="phone">' + E(T('Call')) + '</a>';
    h += '<button class="btn ghost" data-copy="' + o.id + '">' + E(T('Copy the order')) + '</button>';
    return h;
  }
  O.sendButtons = sendButtons;
  function orders(main) {
    var d = O.d, sups = {}; d.suppliers.forEach(function (s) { sups[s.id] = s; });
    var wait = d.orders.filter(function (o) { return o.status === 'waiting'; }).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
    var direct = d.orders.filter(function (o) { return o.status === 'direct'; });
    var done = d.orders.filter(function (o) { return o.status === 'sent' || o.status === 'cancelled'; });
    function card(o, open) {
      var sup = o.supplier_id ? sups[o.supplier_id] : null;
      var h = '<div class="card mo-ord" data-o="' + o.id + '"><div class="mo-ohead"><h3>' + E(sup ? sup.name : T('Supplier to choose')) + '</h3><span class="muted">' + E(T('Order {n}', { n: o.no })) + ' · ' + E(T(STORES[o.store])) + ' · ' + E(o.by_name || '') + ' · ' + E(M.shortDate(M.dateKey(o.created_at))) + ' ' + E(M.hhmm(o.created_at)) + '</span></div>';
      if (!sup && open) h += '<div class="notice"><b>' + E(T('Choose the supplier for this order')) + '</b><div class="row"><select data-osup="' + o.id + '"><option value="">' + E(T('Choose a supplier…')) + '</option>' + supOptions('') + '</select>' +
        '<label class="row small" style="gap:6px"><input type="checkbox" data-oall="' + o.id + '" checked> ' + E(T('Also give these articles this supplier from now on')) + '</label></div></div>';
      h += '<table class="mo-lines">' + o.lines.map(function (l, i) {
        return '<tr><td>' + E(nmLine(l)) + '<div class="small muted">' + E(l.code) + '</div></td><td class="n">' + (open ? '<input type="text" inputmode="decimal" data-num="1" data-q="' + o.id + '|' + i + '" value="' + E(fmtQty(l.qty)) + '">' : E(fmtQty(l.qty))) + ' ' + E(unit(l.unit)) + '</td><td class="n">' + (l.price != null ? M.money(+l.qty * +l.price) : '—') + '</td></tr>';
      }).join('') + '<tr><td><b>' + E(T('Total')) + '</b></td><td></td><td class="n"><b>' + M.money(+o.total || 0) + '</b></td></tr></table>' +
        (o.lines.some(function (l) { return l.price == null; }) ? '<div class="small muted">' + E(T('Lines without a price are not in the total.')) + '</div>' : '') +
        (o.deliver_on ? '<div>' + E(T('Delivery: {d}', { d: M.niceDate(o.deliver_on) })) + '</div>' : '') + (o.note ? '<div class="excerpt serif" style="margin-top:0;padding-top:8px;font-size:18px">“' + E(o.note) + '”</div>' : '');
      if (open && sup) h += '<div class="mo-send">' + sendButtons(o, sup) + '</div><div class="row" data-mark="' + o.id + '" hidden><span class="muted">' + E(T('Did it go to the supplier?')) + '</span><button class="btn" data-sent="' + o.id + '">' + E(T('Yes, mark as sent')) + '</button></div>' +
        (sup.viber ? '<div class="small muted">' + E(T('Viber: choose {n} ({p}) in the list that opens.', { n: sup.name, p: sup.viber })) + '</div>' : '');
      if (open) h += '<div class="row"><button class="btn ghost sm" data-sent="' + o.id + '">' + E(T('Already sent another way')) + '</button><button class="btn warn sm" data-cancel="' + o.id + '">' + E(T('Cancel the order')) + '</button></div>';
      if (o.status === 'direct') h += '<div><span class="tag amber">' + E(T('Waiting for {n} to send it', { n: o.by_name || '' })) + '</span></div>';
      if (o.status === 'sent') h += '<div><span class="tag green">' + E(T('Sent {d} by {w}', { d: M.shortDate(M.dateKey(o.sent_at)) + ' ' + M.hhmm(o.sent_at), w: o.sent_by || '' })) + (o.sent_via ? ' · ' + E(o.sent_via) : '') + '</span></div>';
      if (o.status === 'cancelled') h += '<div><span class="tag grey">' + E(T('Cancelled')) + '</span></div>';
      return h + '</div>';
    }
    var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Waiting for you · {n}', { n: wait.length })) + '</h2><button class="btn" data-go-new>' + E(T('New order')) + '</button></div>' +
      (wait.length ? wait.map(function (o) { return card(o, true); }).join('') : App.empty(T('No orders waiting. When the kitchen or the bar orders, it comes here first.')));
    if (direct.length) h += App.sec(T('Going straight to the supplier')) + direct.map(function (o) { return card(o, false); }).join('');
    if (done.length) h += '<details><summary>' + E(T('Sent and cancelled, last 60 days · {n}', { n: done.length })) + '</summary><div class="stack" style="margin-top:10px">' + done.map(function (o) { return card(o, false); }).join('') + '</div></details>';
    main.innerHTML = h + '</section>';
    function byId(id) { return d.orders.filter(function (o) { return o.id === id; })[0]; }
    App.on(main, '[data-go-new]', function () { App.go('ordering', 'new'); });
    App.on(main, '[data-via]', function (a) { var c = a.closest('[data-o]'); var m = c.querySelector('[data-mark]'); if (m) { m.hidden = false; m.setAttribute('data-v', a.getAttribute('data-via')); } });
    App.on(main, '[data-copy]', function (b) {
      var o = byId(b.getAttribute('data-copy')), t = orderText(o, sups[o.supplier_id]);
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { App.say(T('Copied. Paste it in the supplier\'s chat.')); }, function () { App.overlay('<textarea style="min-height:260px">' + E(t) + '</textarea><button class="btn ghost" data-close>' + E(T('Close')) + '</button>'); });
      var m = b.closest('[data-o]').querySelector('[data-mark]'); if (m) { m.hidden = false; m.setAttribute('data-v', 'copy'); }
    });
    App.on(main, '[data-sent]', function (b) {
      var id = b.getAttribute('data-sent'), m = main.querySelector('[data-mark="' + id + '"]');
      App.call('mare_m_ord_save', { p_table: 'mare_orders', p_row: { id: id, status: 'sent', sent_at: new Date().toISOString(), sent_by: App.S.me || null, sent_via: (m && m.getAttribute('data-v')) || 'other' } })
        .then(function (r) { if (r) { App.say(T('Marked as sent.')); App.reload(); } });
    });
    App.on(main, '[data-cancel]', function (b) {
      var id = b.getAttribute('data-cancel'), row = b.closest('.row');
      if (row.getAttribute('data-sure')) { App.call('mare_m_ord_save', { p_table: 'mare_orders', p_row: { id: id, status: 'cancelled' } }).then(function (r) { if (r) App.reload(); }); return; }
      row.setAttribute('data-sure', '1'); b.textContent = T('Tap again to cancel');
    });
    App.on(main, '[data-osup]', function (sel) {
      var o = byId(sel.getAttribute('data-osup')), v = sel.value; if (!v) return;
      var all = main.querySelector('[data-oall="' + o.id + '"]').checked;
      App.call('mare_m_ord_save', { p_table: 'mare_orders', p_row: { id: o.id, supplier_id: v } }).then(function (r) {
        if (!r) return;
        var p = all ? App.call('mare_m_ord_set_supplier', { p_ids: o.lines.map(function (l) { return l.article_id; }), p_supplier: v }) : Promise.resolve();
        p.then(function () { App.say(T('Saved.')); App.reload(); });
      });
    }, 'change');
    App.on(main, '[data-q]', function (inp) {
      var k = inp.getAttribute('data-q').split('|'), o = byId(k[0]), q;
      try { q = M.num(inp.value); } catch (e) { return; }
      var lines = JSON.parse(JSON.stringify(o.lines));
      if (!q) lines.splice(+k[1], 1); else lines[+k[1]].qty = q;
      if (!lines.length) { App.say(T('An order needs at least one line. Cancel it instead.')); App.reload(); return; }
      var tot = lines.reduce(function (s, l) { return s + (l.price != null ? +l.qty * +l.price : 0); }, 0);
      App.call('mare_m_ord_save', { p_table: 'mare_orders', p_row: { id: o.id, lines: lines, total: Math.round(tot * 100) / 100 } }).then(function (r) { if (r) { App.say(T('Saved.')); App.reload(); } });
    }, 'change');
  }
  function nmLine(l) { return nm({ name: l.name, name_me: l.name_me, name_en: l.name_en }); }

  // ════════════════ NEW ORDER (a manager orders herself) ════════════════
  function newOrder(main) {
    var arts = O.d.articles.filter(function (a) { return a.active; });
    function paint() {
      var q = O.nq.toLowerCase();
      var list = arts.filter(function (a) { return a.store === O.bstore && (!q || (a.name + ' ' + (a.name_me || '') + ' ' + (a.name_en || '') + ' ' + a.code).toLowerCase().indexOf(q) >= 0); });
      var inB = Object.keys(O.basket).filter(function (id) { return O.basket[id] > 0; }).map(function (id) { return arts.filter(function (a) { return a.id === id; })[0]; }).filter(Boolean);
      var tot = inB.reduce(function (s, a) { return s + (a.price != null ? a.price * O.basket[a.id] : 0); }, 0);
      var nsup = {}; inB.forEach(function (a) { nsup[a.supplier_id || 'none'] = 1; });
      var h = '<section class="stack"><div class="mo-chips">' + ['kitchen', 'bar'].map(function (s) { return '<button class="mo-chip' + (O.bstore === s ? ' on' : '') + '" data-bst="' + s + '">' + E(T(STORES[s])) + '</button>'; }).join('') + '</div>' +
        '<input type="text" id="nq" value="' + E(O.nq) + '" placeholder="' + E(T('Search: vongole, spinach, Heineken…')) + '" aria-label="' + E(T('Search')) + '">';
      if (!q && inB.length) h += App.sec(T('In this order')) + rows(inB);
      h += (q ? '' : App.sec(T('Everything · {n}', { n: list.length }))) + (list.length ? rows(q ? list : list.slice(0, 60)) : App.empty(T('Nothing matches.'))) + (!q && list.length > 60 ? '<div class="small muted">' + E(T('Search to find the other {n}.', { n: list.length - 60 })) + '</div>' : '');
      if (inB.length) h += '<div class="mo-basket"><div class="row between"><span>' + E(T('{n} lines · suppliers: {s}', { n: inB.length, s: Object.keys(nsup).length })) + '</span><b class="tot">' + M.money(tot) + '</b></div>' +
        '<div class="grid2"><label class="f">' + E(T('Delivery day')) + '<input type="date" id="nd" value="' + E(O.nd || M.addDays(M.today(), 1)) + '"></label><label class="f">' + E(T('Note for the supplier (optional)')) + '<input type="text" id="nn" value="' + E(O.nn || '') + '"></label></div>' +
        '<button class="btn" id="ngo" style="background:var(--gold-2);color:var(--rail);border-color:var(--gold-2)">' + E(T('Create the order')) + '</button></div>';
      main.innerHTML = h + '</section>';
      var nq = main.querySelector('#nq'); nq.oninput = function () { O.nq = nq.value; var p = nq.selectionStart; paint(); var n = main.querySelector('#nq'); n.focus(); n.setSelectionRange(p, p); };
      var go = main.querySelector('#ngo'); if (go) go.onclick = function () {
        var lines = inB.map(function (a) { return { id: a.id, qty: O.basket[a.id] }; }); go.disabled = true;
        App.call('mare_m_ord_create', { p_store: O.bstore, p_lines: lines, p_note: main.querySelector('#nn').value, p_deliver: main.querySelector('#nd').value || null }).then(function (r) {
          go.disabled = false; if (!r) return;
          O.basket = {}; O.nn = ''; App.say(T('Orders made: {n}. Send them from Orders.', { n: r.orders.length })); App.go('ordering', 'orders');
        });
      };
      ['nd', 'nn'].forEach(function (k) { var el = main.querySelector('#' + k); if (el) el.onchange = function () { O[k] = el.value; }; });
    }
    function rows(list) {
      return '<div class="card mo-list">' + list.map(function (a) {
        var q = O.basket[a.id] || 0;
        return '<div class="mo-row"><div class="mo-main"><b>' + E(nm(a)) + '</b><span>' + (a.price != null ? M.money(+a.price) + ' / ' + E(unit(a.unit)) : E(T('no price'))) + ' · ' + E(a.supplier_id ? supName(a.supplier_id) : T('Supplier to choose')) + '</span></div>' +
          '<div class="mo-qty"><button data-dq="' + a.id + '" aria-label="' + E(T('Less')) + '">−</button><input type="text" inputmode="decimal" data-num="1" data-nqty="' + a.id + '" value="' + (q ? E(fmtQty(q)) : '') + '" aria-label="' + E(T('Quantity')) + '"><button data-iq="' + a.id + '" aria-label="' + E(T('More')) + '">+</button></div></div>';
      }).join('') + '</div>';
    }
    App.on(main, '[data-bst]', function (b) { O.bstore = b.getAttribute('data-bst'); paint(); });
    App.on(main, '[data-iq]', function (b) { var id = b.getAttribute('data-iq'); O.basket[id] = (O.basket[id] || 0) + 1; paint(); });
    App.on(main, '[data-dq]', function (b) { var id = b.getAttribute('data-dq'); O.basket[id] = Math.max(0, (O.basket[id] || 0) - 1); paint(); });
    App.on(main, '[data-nqty]', function (inp) { var v; try { v = M.num(inp.value); } catch (e) { return; } O.basket[inp.getAttribute('data-nqty')] = v || 0; paint(); }, 'change');
    paint();
  }

  // ════════════════ PRICE UPLOAD ════════════════
  // The stock system's export ("Lager artikala"): Šifra, Naziv, Grupa, J.M., Sr.nab.cij.
  // First it only SAYS what would change; nothing changes until "Update the prices".
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  function xlsxLib() {
    if (w.XLSX) return Promise.resolve(w.XLSX);
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = XLSX_URL; s.onload = function () { res(w.XLSX); }; s.onerror = rej; document.head.appendChild(s); });
  }
  function readSheet(file) {
    return xlsxLib().then(function (X) {
      return file.arrayBuffer().then(function (buf) {
        var wb = X.read(buf, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]];
        var rows = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        var hi = -1, col = {};
        for (var i = 0; i < Math.min(rows.length, 15) && hi < 0; i++) {
          var r = rows[i] || [], c = {};
          r.forEach(function (v, j) { var s = String(v == null ? '' : v).toLowerCase();
            if (/ifra|^code$|^kod$/.test(s)) c.code = j; else if (/naziv|^name$/.test(s)) c.name = j; else if (/grupa|group/.test(s)) c.grp = j;
            else if (/^j\.?\s*m\.?$|jedinica|unit/.test(s)) c.unit = j; else if (/nab|cij|cen|price/.test(s)) c.price = j; });
          if (c.code != null && c.name != null && c.price != null) { hi = i; col = c; }
        }
        if (hi < 0) throw new Error(T('This file has no Šifra, Naziv and price columns. Upload the stock list export (Lager artikala).'));
        var out = [], bad = 0;
        rows.slice(hi + 1).forEach(function (r) {
          if (!r || r[col.code] == null || r[col.name] == null || String(r[col.code]).trim() === '') return;
          var p = r[col.price];
          if (typeof p === 'string') { var x = M.numSafe(p.replace(/\s/g, '')); if (x == null && p.trim() !== '') bad++; p = x; }
          out.push({ code: String(r[col.code]).trim(), name: String(r[col.name]).trim(), grp: col.grp != null && r[col.grp] != null ? String(r[col.grp]).trim() : null,
                     unit: col.unit != null && r[col.unit] != null ? String(r[col.unit]).trim() : null, price: typeof p === 'number' && p > 0 ? Math.round(p * 1e6) / 1e6 : null });
        });
        return { rows: out, bad: bad };
      });
    });
  }
  function upload(main) {
    var U = O.up || (O.up = { store: null, file: null, rows: null, res: null, retire: false });
    function paint() {
      var h = '<section class="stack"><h2 class="serif">' + E(T('Upload new prices')) + '</h2>' +
        '<p class="muted" style="margin:0">' + E(T('Export the stock list (Lager artikala) for the kitchen or the bar and upload it here. Articles are matched on the code (Šifra). You see every change before anything is saved.')) + '</p>' +
        '<div class="card stack"><div class="mo-chips">' + ['kitchen', 'bar'].map(function (s) { return '<button class="mo-chip' + (U.store === s ? ' on' : '') + '" data-ust="' + s + '">' + E(T(STORES[s])) + '</button>'; }).join('') + '</div>' +
        '<label class="f">' + E(T('The file')) + '<input type="file" id="uf" accept=".xlsx,.xls,.csv"></label>' + (U.file ? '<div class="small muted">' + E(U.file) + (U.rows ? ' · ' + E(T('{n} lines read', { n: U.rows.length })) : '') + '</div>' : '') + '</div>';
      if (U.res) {
        var r = U.res, ch = r.changed.slice().sort(function (a, b) { return Math.abs(pc(b)) - Math.abs(pc(a)); });
        h += '<div class="card stack"><h3 style="margin:0">' + E(r.applied ? T('Done') : T('What would change')) + ' · ' + E(T(STORES[U.store])) + '</h3><div class="figs">' +
          '<div><b>' + r.changed.length + '</b><span>' + E(T('Price changed').toUpperCase()) + '</span></div><div><b>' + r['new'].length + '</b><span>' + E(T('New articles').toUpperCase()) + '</span></div>' +
          '<div><b>' + r.same + '</b><span>' + E(T('Same price').toUpperCase()) + '</span></div></div>';
        if (r.gone.length) h += '<div class="notice"><b>' + E(T('{n} articles on the app list are not in this file', { n: r.gone.length })) + '</b><span>' + E(r.gone.slice(0, 12).map(function (g) { return g.name; }).join(', ') + (r.gone.length > 12 ? ' …' : '')) + '</span>' +
          (r.applied ? '' : '<label class="row" style="gap:8px"><input type="checkbox" id="uret"' + (U.retire ? ' checked' : '') + ' style="width:22px;height:22px"> ' + E(T('Take them off the order list (they are kept, not deleted)')) + '</label>') + '</div>';
        if (ch.length) h += '<details' + (ch.length <= 30 ? ' open' : '') + '><summary>' + E(T('Price changes · {n}', { n: ch.length })) + '</summary><table class="mo-diff"><tr><th>' + E(T('Article')) + '</th><th>' + E(T('Was')) + '</th><th>' + E(T('Now')) + '</th><th></th></tr>' + ch.map(function (c) {
          var p = pc(c);
          return '<tr><td>' + E(nm({ name: c.name })) + '<div class="small muted">' + E(c.code) + '</div></td><td class="n">' + (c.old != null ? M.money(+c.old) : '—') + '</td><td class="n">' + (c['new'] != null ? M.money(+c['new']) : E(T('no price'))) + '</td><td class="n ' + (p > 0 ? 'mo-up' : p < 0 ? 'mo-down' : '') + '">' + (p != null && isFinite(p) ? (p > 0 ? '+' : '') + Math.round(p) + '%' : '') + '</td></tr>';
        }).join('') + '</table></details>';
        if (r['new'].length) h += '<details><summary>' + E(T('New articles · {n}', { n: r['new'].length })) + '</summary><table class="mo-diff">' + r['new'].map(function (c) { return '<tr><td>' + E(c.name) + '<div class="small muted">' + E(c.code) + '</div></td><td class="n">' + (c.price != null ? M.money(+c.price) : '—') + '</td></tr>'; }).join('') + '</table></details>';
        if (r.renamed.length) h += '<details><summary>' + E(T('Name changed in the stock list · {n}', { n: r.renamed.length })) + '</summary><table class="mo-diff">' + r.renamed.map(function (c) { return '<tr><td>' + E(c.old) + '</td><td>→ ' + E(c['new']) + '</td></tr>'; }).join('') + '</table></details>';
        h += r.applied ? '<div class="row"><span class="tag green">' + E(T('Prices updated')) + '</span><button class="btn ghost" data-go-art>' + E(T('Open the articles')) + '</button></div>'
          : '<div class="row"><button class="btn" id="uapply">' + E(T('Update the prices')) + '</button><button class="btn ghost" id="ucan">' + E(T('Cancel')) + '</button></div>';
        h += '</div>';
      }
      main.innerHTML = h + '</section>';
      main.querySelector('#uf').onchange = function () {
        var f = this.files[0]; if (!f) return;
        if (!U.store) U.store = /bar/i.test(f.name) ? 'bar' : /kuhinj|kitchen/i.test(f.name) ? 'kitchen' : null;
        U.file = f.name; U.res = null; U.rows = null;
        readSheet(f).then(function (x) {
          U.rows = x.rows; if (x.bad) App.say(T('{n} prices could not be read and count as no price.', { n: x.bad }));
          if (!U.store) { App.say(T('Is this the kitchen or the bar list? Tap one.')); paint(); return; }
          preview();
        }, function (e) { App.say(e && e.message ? e.message : T('That file could not be read.')); U.file = null; paint(); });
      };
      var ap = main.querySelector('#uapply'); if (ap) ap.onclick = function () {
        ap.disabled = true; var ret = main.querySelector('#uret'); U.retire = !!(ret && ret.checked);
        App.call('mare_m_ord_upload', { p_store: U.store, p_rows: U.rows, p_apply: true, p_retire: U.retire }).then(function (r) { ap.disabled = false; if (r) { U.res = r; load().then(paint); } });
      };
      var cn = main.querySelector('#ucan'); if (cn) cn.onclick = function () { O.up = null; upload(main); };
      var ur = main.querySelector('#uret'); if (ur) ur.onchange = function () { U.retire = ur.checked; };
    }
    function pc(c) { return c.old != null && c['new'] != null && +c.old > 0 ? (c['new'] - c.old) / c.old * 100 : null; }
    function preview() { App.call('mare_m_ord_upload', { p_store: U.store, p_rows: U.rows, p_apply: false }).then(function (r) { if (r) U.res = r; paint(); }); }
    App.on(main, '[data-ust]', function (b) { U.store = b.getAttribute('data-ust'); U.res = null; if (U.rows) preview(); else paint(); });
    App.on(main, '[data-go-art]', function () { O.up = null; O.store = U.store; O.flt = 'all'; App.go('ordering', 'articles'); });
    paint();
  }
  w.MareOrder = O;
})(window);
