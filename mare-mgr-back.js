/* Roberto's Mare — kitchen, cost and people modules: Recipes, Costing,
   Stock & breakage, Leave, Speak up. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;

  // ════════════════ RECIPES ════════════════
  // Mare's own book (mare_recipes) + Roberto's Dubai cards, read-only from the Kitchen app.
  var RC = { q: '', kind: 'main', dubai: null };
  App.register('recipes', {
    title: 'Recipes', icon: 'recipe', group: 'kitchen', desc: 'Mare\'s own recipe book, and Roberto\'s Dubai recipe cards to learn from.',
    tabs: [['mare', 'Roberto\'s Mare'], ['dubai', 'From Dubai']],
    stat: function () { return [T('Mare + Dubai cards'), false]; },
    render: function (main, sub) { return sub === 'dubai' ? dubai(main) : mareBook(main); }
  });
  function mareBook(main) {
    return App.fetch(['recipes']).then(function (f) {
      if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
      var list = f.recipes.filter(function (r) { return r.active; });
      var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Roberto\'s Mare recipe book')) + '</h2><button class="btn" id="nr">' + E(T('New recipe')) + '</button></div>';
      if (!list.length) h += App.empty(T('No Mare recipes yet. Start with the dishes the team cooks every day: carbonara, tartare, mash, lamb shank.'));
      else {
        var cats = {}; list.forEach(function (r) { (cats[r.category || T('Other')] = cats[r.category || T('Other')] || []).push(r); });
        Object.keys(cats).sort().forEach(function (c) {
          h += '<h3 class="muted" style="letter-spacing:2px;font-size:13px;text-transform:uppercase">' + E(c) + '</h3><div class="rlist">' + cats[c].map(function (r) {
            return '<button class="rcard" data-r="' + r.id + '"><div class="ph">' + M.icon('recipe', 34) + '</div><div class="tx"><b>' + E(r.name) + '</b><span class="small muted">' + E(r.portions || '') + '</span></div></button>';
          }).join('') + '</div>';
        });
      }
      var off = f.recipes.filter(function (r) { return !r.active; });
      if (off.length) h += '<details><summary>' + E(T('Taken off the book · {n}', { n: off.length })) + '</summary><div class="row" style="margin-top:8px">' + off.map(function (r) { return '<button class="btn ghost sm" data-r="' + r.id + '">' + E(r.name) + '</button>'; }).join('') + '</div></details>';
      main.innerHTML = h + '</section>';
      main.querySelector('#nr').onclick = function () { recipeForm({ active: true }, f); };
      App.on(main, '[data-r]', function (b) { var r = f.recipes.filter(function (x) { return x.id === b.getAttribute('data-r'); })[0]; recipeForm(r, f); });
    });
  }
  function recipeForm(r, f) {
    var cats = {}; f.recipes.forEach(function (x) { if (x.category) cats[x.category] = 1; });
    var o = App.overlay('<div class="row between"><h3>' + E(r.id ? r.name : T('New recipe')) + '</h3><button class="btn ghost sm" data-close>' + E(T('Close')) + '</button></div>' +
      '<div id="ph"></div><label class="f">' + E(T('Photo')) + '<input type="file" accept="image/*" id="pf"></label>' +
      '<div class="grid2"><label class="f">' + E(T('Name')) + '<input type="text" id="rn" value="' + E(r.name || '') + '"></label>' +
      '<label class="f">' + E(T('Section')) + '<input type="text" id="rc" list="rcats" value="' + E(r.category || '') + '" placeholder="' + E(T('e.g. Pasta, Starters, Desserts')) + '"><datalist id="rcats">' + Object.keys(cats).map(function (c) { return '<option value="' + E(c) + '">'; }).join('') + '</datalist></label>' +
      '<label class="f">' + E(T('Makes')) + '<input type="text" id="rp" value="' + E(r.portions || '') + '" placeholder="' + E(T('e.g. 1 portion, 2 kg')) + '"></label>' +
      '<label class="f">' + E(T('Allergens')) + '<input type="text" id="ra" value="' + E(r.allergens || '') + '"></label></div>' +
      '<label class="f">' + E(T('Ingredients (one per line, with quantity)')) + '<textarea id="ri" style="min-height:140px">' + E(r.ingredients || '') + '</textarea></label>' +
      '<label class="f">' + E(T('Method')) + '<textarea id="rm" style="min-height:160px">' + E(r.method || '') + '</textarea></label>' +
      '<label class="f">' + E(T('Plating and garnish')) + '<textarea id="rl">' + E(r.plating || '') + '</textarea></label>' +
      '<div class="row"><button class="btn" id="rs">' + E(T('Save')) + '</button>' + (r.id ? '<button class="btn ' + (r.active ? 'warn' : 'ghost') + '" id="rt">' + E(r.active ? T('Take off the book') : T('Put back in the book')) + '</button>' : '') +
      (r.updated_by ? '<span class="small muted">' + E(T('Last saved by {w}', { w: r.updated_by })) + '</span>' : '') + '</div>');
    var photo;   // undefined = unchanged
    function showPh(u) { o.querySelector('#ph').innerHTML = u ? '<img class="recipe-photo" src="' + u + '" alt="">' : ''; }
    if (r.has_photo) App.photo('mare_recipes', r.id).then(showPh);
    o.querySelector('#pf').onchange = function () { var fl = this.files[0]; if (!fl) return; M.photoFromFile(fl, 1200).then(function (u) { photo = u; showPh(u); }, function () { App.say(T('That photo could not be read.')); }); };
    o.querySelector('#rs').onclick = function () {
      var name = o.querySelector('#rn').value.trim(); if (!name) { App.say(T('Type a name.')); return; }
      var row = { name: name, category: o.querySelector('#rc').value.trim() || null, portions: o.querySelector('#rp').value.trim() || null, allergens: o.querySelector('#ra').value.trim() || null,
        ingredients: o.querySelector('#ri').value.trim() || null, method: o.querySelector('#rm').value.trim() || null, plating: o.querySelector('#rl').value.trim() || null, active: r.active !== false };
      if (r.id) row.id = r.id; if (photo !== undefined) row.photo = photo;
      this.disabled = true; var btn = this;
      App.save('mare_recipes', row).then(function (x) { if (x) { App.say(T('Saved.')); o.close(); App.reload(); } else btn.disabled = false; });
    };
    var tg = o.querySelector('#rt'); if (tg) tg.onclick = function () { App.save('mare_recipes', { id: r.id, active: !r.active }).then(function (x) { if (x) { o.close(); App.reload(); } }); };
  }
  App.dubaiCard = function (id) {
    return Promise.all([M.kitchen('recipes?select=id,name,kind,section,makes_qty,makes_unit,allergens,method,photos,notes&show_mare=is.true&id=eq.' + encodeURIComponent(id)),
                        M.kitchen('recipe_lines?select=position,typed_text,stock_name,qty,unit,child_recipe_id,note&recipe_id=eq.' + encodeURIComponent(id) + '&order=position')])
      .then(function (r) { if (!r[0][0]) throw new Error('hidden'); return { r: r[0][0], lines: r[1] }; });
  };
  App.dubaiHtml = function (c) {
    var r = c.r, m = (r.method && typeof r.method === 'object') ? r.method : {}, ph = (Array.isArray(r.photos) ? r.photos : []).map(function (p) { return M.safeImg(p && p.u); }).filter(Boolean)[0];
    function blk(title, txt) { return txt ? '<div><h3 style="margin:6px 0">' + E(title) + '</h3><div class="pre">' + E(txt) + '</div></div>' : ''; }
    var lines = c.lines.length ? '<ul style="margin:0;padding-left:20px;line-height:1.6">' + c.lines.map(function (l) {
      var name = l.stock_name || l.typed_text || ''; var q = l.qty != null ? (l.qty + ' ' + (l.unit || '')).trim() : '';
      return '<li>' + (q && l.stock_name ? '<b>' + E(q) + '</b> ' : '') + E(l.stock_name ? name : (l.typed_text || '')) + (l.note ? ' <span class="muted">(' + E(l.note) + ')</span>' : '') + '</li>';
    }).join('') + '</ul>' : '';
    return (ph ? '<img class="recipe-photo" src="' + ph + '" alt="">' : '') +
      '<div class="row"><span class="tag teal">' + E(T('ROBERTO\'S DUBAI · READ ONLY')) + '</span>' + (r.section ? '<span class="tag grey">' + E(r.section) + '</span>' : '') +
      (r.makes_qty ? '<span class="tag grey">' + E(T('Makes {q}', { q: r.makes_qty + ' ' + (r.makes_unit || '') })) + '</span>' : '') + '</div>' +
      blk(T('What the guest is told'), m.foh) +
      (lines ? '<div><h3 style="margin:6px 0">' + E(T('Ingredients')) + '</h3>' + lines + '</div>' : blk(T('Ingredients'), m.ing)) +
      blk(T('Mise en place'), m.mise) + blk(T('Method'), m.method) + blk(T('Plating'), m.plating) + blk(T('Garnish'), m.garnish) + blk(T('Good to know'), m.more) +
      ((r.allergens && r.allergens.length) ? '<div><h3 style="margin:6px 0">' + E(T('Allergens')) + '</h3>' + r.allergens.map(function (a) { return '<span class="tag amber">' + E(a) + '</span>'; }).join(' ') + '</div>' : '') +
      blk(T('Notes'), r.notes);
  };
  function dubai(main) {
    main.innerHTML = '<div class="muted">' + E(T('Loading the Dubai recipe cards…')) + '</div>';
    return M.dubaiBook().then(function (book) {
      function paint() {
        var x = M.dubaiBookHtml(book, RC.q), total = book.reduce(function (a, g) { return a + g.dishes.length; }, 0);
        main.querySelector('#dl').innerHTML = !total ? App.empty(T('No Dubai cards are shared with Mare yet. The Dubai chef chooses them in the Kitchen recipe book: the Mare switch on each dish.')) : (x.n ? x.html : App.empty(T('Nothing matches.')));
        main.querySelector('#dc').textContent = T('{n} cards', { n: x.n });
      }
      main.innerHTML = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Roberto\'s Dubai recipe cards')) + '</h2><span class="muted" id="dc"></span></div>' +
        '<p class="muted" style="margin:0">' + E(T('The dishes the Dubai chef has finished and shared with Mare, as on the Dubai menu. Read only; Mare\'s own versions go in the Mare book.')) + '</p>' +
        '<input type="text" id="dq" value="' + E(RC.q) + '" placeholder="' + E(T('Search a dish')) + '" aria-label="' + E(T('Search')) + '">' +
        '<div class="stack" id="dl"></div></section>';
      main.querySelector('#dq').oninput = function () { RC.q = this.value; paint(); };
      paint();
      App.on(main, '[data-k]', function (b) {
        var o = App.overlay('<div class="muted">' + E(T('Loading…')) + '</div>');
        App.dubaiCard(b.getAttribute('data-k')).then(function (c) {
          o.firstChild.innerHTML = '<div class="row between"><h3 class="serif" style="font-size:28px">' + E(c.r.name) + '</h3><button class="btn ghost sm" data-close>' + E(T('Close')) + '</button></div>' + App.dubaiHtml(c);
        }, function () { o.firstChild.innerHTML = '<div>' + E(T('Could not load this card.')) + '</div><button class="btn ghost" data-close>' + E(T('Close')) + '</button>'; });
      });
    }, function () { main.innerHTML = App.empty(T('Could not reach the Dubai recipe cards. Check the internet.')); });
  }

  // ════════════════ SALES VS PURCHASE ════════════════
  // As Dubai's "Daily Food Purchases & Sales" sheet (Francesco, 6 Oct 2026): one line a
  // day — purchase, sales, cost % — the month total, the staff meal / internal use
  // allowance spread over the days so far (Dubai: =-22000/31*days), and the closing
  // stock at each month end. Sales come from the Closing report. All math here; plain.
  var CO = { m: null };
  function coSet(f, key) { return (f.settings.filter(function (s) { return s.key === key; })[0] || {}).value || {}; }
  App.register('costing', {
    title: 'Sales vs purchase', icon: 'costing', group: 'kitchen', desc: 'Daily purchases against sales, cost %, staff meal and closing stock, as the Dubai sheet.',
    tabs: [['food', 'Food'], ['beverage', 'Beverage']],
    stat: function (H) { return [T('Purchases vs sales'), false]; },
    render: function (main, sub) {
      var cat = sub === 'beverage' ? 'beverage' : 'food';
      if (!CO.m) CO.m = M.monthStart(M.today());
      var ms = CO.m, me = M.addDays(M.addMonths(ms, 1), -1), prevM = M.addMonths(ms, -1), mKey = ms.slice(0, 7), pKey = prevM.slice(0, 7);
      return App.fetch(['purchases', 'closing', 'settings'], ms, me).then(function (f) {
        if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var tg = coSet(f, 'cost_targets'), meal = coSet(f, 'staff_meal'), stock = coSet(f, 'closing_stock');
        var pur = f.purchases.filter(function (p) { return !p.voided && p.category === cat; });
        var dim = +me.slice(8, 10), days = [];
        for (var k = ms; k <= me; k = M.addDays(k, 1)) days.push(k);
        var rows = days.map(function (d) {
          var c = f.closing.filter(function (x) { return x.date === d; })[0];
          var p = pur.filter(function (x) { return x.date === d; }).reduce(function (s, x) { return s + +x.amount; }, 0);
          var sl = c ? (+c[cat] || 0) : null;
          return { d: d, p: Math.round(p * 100) / 100, s: sl, inv: pur.filter(function (x) { return x.date === d; }) };
        });
        var P = rows.reduce(function (a, r) { return a + r.p; }, 0), SL = rows.reduce(function (a, r) { return a + (r.s || 0); }, 0);
        P = Math.round(P * 100) / 100; SL = Math.round(SL * 100) / 100;
        var lastSold = rows.filter(function (r) { return r.s > 0; }).map(function (r) { return +r.d.slice(8, 10); }).pop() || 0;
        var mealM = meal[cat] != null ? +meal[cat] : null;
        var allow = mealM ? Math.round(mealM * lastSold / dim * 100) / 100 : 0;
        var open = stock[pKey] && stock[pKey][cat] != null ? +stock[pKey][cat] : null, close = stock[mKey] && stock[mKey][cat] != null ? +stock[mKey][cat] : null;
        var used = open != null && close != null ? Math.round((open + P - close - allow) * 100) / 100 : null;
        var target = tg[cat] != null ? +tg[cat] : null;
        function pc(a, b) { var v = M.pct(a, b); return v == null ? '—' : v + '%'; }
        function cls(a, b) { var v = M.pct(a, b); return v != null && target != null ? (v > target ? 'red' : 'green') : ''; }
        var catName = T(cat === 'food' ? 'Food' : 'Beverage');

        var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(M.monthName(ms)) + ' · ' + E(catName) + '</h2><div class="row"><button class="btn ghost" id="cp">‹ ' + E(T('Earlier')) + '</button>' +
          (ms < M.monthStart(M.today()) ? '<button class="btn ghost" id="cn">' + E(T('Later')) + ' ›</button>' : '') + '<button class="btn ghost" id="cx">' + E(T('Excel')) + '</button></div></div>' +
          '<div class="kpis"><div class="kpi ' + cls(P, SL) + '"><span>' + E(T('Cost %')) + '</span><b>' + pc(P, SL) + '</b><i>' + E(T('{a} bought / {b} sold', { a: M.money(P), b: M.money(SL) })) + (target != null ? ' · ' + E(T('target {n}%', { n: target })) : '') + '</i></div>' +
          '<div class="kpi ' + (allow ? cls(P - allow, SL) : '') + '"><span>' + E(T('After staff meal')) + '</span><b>' + (allow ? pc(P - allow, SL) : '—') + '</b><i>' + E(allow ? T('{a} off for staff meal / internal use', { a: M.money(allow) }) : T('Set the monthly staff meal below')) + '</i></div>' +
          '<div class="kpi ' + (used != null ? cls(used, SL) : '') + '"><span>' + E(T('With stock')) + '</span><b>' + (used != null ? pc(used, SL) : '—') + '</b><i>' + E(used != null ? T('opening + purchases − closing − staff meal') : T('needs last month\'s and this month\'s closing stock')) + '</i></div></div></section>';

        // add a purchase
        var sup = {}; f.purchases.forEach(function (p) { sup[p.supplier] = 1; });
        h += '<section class="card stack"><h3>' + E(T('Add a purchase (invoice or delivery)')) + '</h3><div class="grid4">' +
          '<label class="f">' + E(T('Date')) + '<input type="date" id="pd" value="' + (M.today() <= me && M.today() >= ms ? M.today() : ms) + '"></label>' +
          '<label class="f">' + E(T('Supplier')) + '<input type="text" id="ps" list="sups"><datalist id="sups">' + Object.keys(sup).map(function (s) { return '<option value="' + E(s) + '">'; }).join('') + '</datalist></label>' +
          '<label class="f">' + E(T('For')) + '<select id="pc"><option value="food"' + (cat === 'food' ? ' selected' : '') + '>' + E(T('Food')) + '</option><option value="beverage"' + (cat === 'beverage' ? ' selected' : '') + '>' + E(T('Beverage')) + '</option></select></label>' +
          '<label class="f">' + E(T('Amount (€, without VAT)')) + '<input type="text" inputmode="decimal" data-num="1" id="pa"></label>' +
          '<label class="f">' + E(T('Invoice number')) + '<input type="text" id="pi"></label></div>' +
          '<button class="btn" id="padd" style="align-self:flex-start">' + E(T('Add')) + '</button></section>';

        // the sheet: Date · Purchase · Sales · Cost %
        h += '<section class="stack"><div class="box"><table class="sheet"><thead><tr><th>' + E(T('Date')) + '</th><th class="num">' + E(T('Purchase')) + '</th><th class="num">' + E(T('Sales')) + '</th><th class="num">' + E(T('Cost %')) + '</th></tr></thead><tbody>';
        rows.forEach(function (r) {
          var fut = r.d > M.today();
          h += '<tr class="' + (fut ? 'fut' : '') + (r.inv.length ? ' has' : '') + '"' + (r.inv.length ? ' data-day="' + r.d + '"' : '') + '><td class="nw">' + E(M.shortDate(r.d)) + (r.inv.length ? ' <span class="tiny muted">▾ ' + r.inv.length + '</span>' : '') + '</td>' +
            '<td class="num">' + (r.p ? M.money(r.p) : '') + '</td><td class="num">' + (r.s != null ? M.money(r.s) : (fut ? '' : '<span class="tiny muted">' + E(T('no report')) + '</span>')) + '</td>' +
            '<td class="num ' + (r.p && r.s ? cls(r.p, r.s) : '') + '">' + (r.p && r.s ? pc(r.p, r.s) : '') + '</td></tr>';
          if (r.inv.length) h += '<tr class="inv" data-inv="' + r.d + '" hidden><td colspan="4"><div class="stack" style="gap:6px">' + r.inv.map(function (p) {
            return '<div class="row between"><span>' + E(p.supplier) + (p.invoice_no ? ' <span class="muted">· ' + E(p.invoice_no) + '</span>' : '') + '</span><span class="row"><b>' + M.money(+p.amount) + '</b><button class="btn ghost sm" data-pv="' + p.id + '">' + E(T('Remove…')) + '</button></span></div>';
          }).join('') + '</div></td></tr>';
        });
        h += '</tbody><tfoot><tr><th>' + E(T('Total')) + '</th><th class="num">' + M.money(P) + '</th><th class="num">' + M.money(SL) + '</th><th class="num ' + cls(P, SL) + '">' + pc(P, SL) + '</th></tr>' +
          (allow ? '<tr><td>' + E(T('Staff meal / internal use')) + '<div class="tiny muted">' + E(T('{a} a month × {n} of {d} days', { a: M.money(mealM), n: lastSold, d: dim })) + '</div></td><td class="num">−' + M.money(allow) + '</td><td class="num">' + M.money(SL) + '</td><td class="num ' + cls(P - allow, SL) + '">' + pc(P - allow, SL) + '</td></tr>' : '') +
          '</tfoot></table></div><p class="small muted" style="margin:0">' + E(T('Sales come from the Closing report. Tap a day to see its invoices.')) + '</p></section>';

        // closing stock, as the bottom of the Dubai sheet
        var months = []; for (var i = 0; i < 6; i++) months.push(M.addMonths(ms, -i));
        h += '<section class="stack"><h2 class="serif">' + E(T('Closing stock')) + ' · ' + E(catName) + '</h2><div class="box"><table><thead><tr><th>' + E(T('Month')) + '</th><th class="num">' + E(T('Closing stock')) + '</th></tr></thead><tbody>' +
          months.map(function (m) { var v = stock[m.slice(0, 7)] && stock[m.slice(0, 7)][cat];
            return '<tr><td>' + E(M.monthName(m)) + '</td><td class="num"><input type="text" inputmode="decimal" data-num="1" data-stk="' + m.slice(0, 7) + '" value="' + (v != null ? v : '') + '" style="width:130px;text-align:right" aria-label="' + E(T('Closing stock')) + ' ' + E(M.monthName(m)) + '"></td></tr>'; }).join('') +
          '</tbody></table></div>' +
          (used != null ? '<p class="small muted" style="margin:0">' + E(T('With stock: {o} opening + {p} purchases − {c} closing − {m} staff meal = {u} used, on {s} sales.', { o: M.money(open), p: M.money(P), c: M.money(close), m: M.money(allow), u: M.money(used), s: M.money(SL) })) + '</p>' : '') +
          '</section>';

        // settings
        h += '<details class="card"><summary>' + E(T('Staff meal and targets')) + '</summary><div class="grid4" style="margin-top:10px">' +
          '<label class="f">' + E(T('Staff meal / internal use, € a month')) + '<input type="text" inputmode="decimal" data-num="1" id="sm" value="' + (mealM != null ? mealM : '') + '"></label>' +
          '<label class="f">' + E(T('Cost target %')) + '<input type="text" inputmode="decimal" data-num="1" id="tt" value="' + (target != null ? target : '') + '"></label></div>' +
          '<p class="small muted">' + E(T('As in Dubai: the monthly amount is spread over the days up to the last closing report, and taken off the purchases.')) + '</p>' +
          '<button class="btn sm" id="ss" style="align-self:flex-start">' + E(T('Save')) + '</button></details>';
        main.innerHTML = h;

        main.querySelector('#cp').onclick = function () { CO.m = M.addMonths(ms, -1); App.reload(); };
        var cn = main.querySelector('#cn'); if (cn) cn.onclick = function () { CO.m = M.addMonths(ms, 1); App.reload(); };
        App.on(main, '[data-day]', function (tr) { var x = main.querySelector('[data-inv="' + tr.getAttribute('data-day') + '"]'); if (x) x.hidden = !x.hidden; });
        main.querySelector('#padd').onclick = function () {
          var a = M.num(main.querySelector('#pa').value), s = main.querySelector('#ps').value.trim(), d = main.querySelector('#pd').value;
          if (!s) { App.say(T('Type the supplier.')); return; } if (!(a > 0)) { App.say(T('Type the amount.')); return; } if (!d) { App.say(T('Pick the date.')); return; }
          this.disabled = true; var btn = this;
          App.save('mare_purchases', { date: d, supplier: s, category: main.querySelector('#pc').value, amount: Math.round(a * 100) / 100, invoice_no: main.querySelector('#pi').value.trim() || null })
            .then(function (x) { if (x) { App.say(T('Added.')); App.reload(); } else btn.disabled = false; });
        };
        App.on(main, '[data-pv]', function (b, e) {
          if (e) e.stopPropagation();
          var box = b.parentNode; box.innerHTML = '<input type="text" placeholder="' + E(T('Why remove it?')) + '" aria-label="' + E(T('Reason')) + '"><button class="btn warn sm" data-pvok="' + b.getAttribute('data-pv') + '">' + E(T('Remove')) + '</button>';
        });
        App.on(main, '[data-pvok]', function (b) {
          var why = b.parentNode.querySelector('input').value.trim(); if (why.length < 2) { App.say(T('Write why.')); return; }
          App.save('mare_purchases', { id: b.getAttribute('data-pvok'), voided: true, void_reason: why }).then(function (x) { if (x) App.reload(); });
        });
        App.on(main, '[data-stk]', function (inp) {
          var v = inp.value.trim() === '' ? null : M.num(inp.value);
          var all = JSON.parse(JSON.stringify(stock)), mk = inp.getAttribute('data-stk');
          all[mk] = all[mk] || {}; all[mk][cat] = v == null ? null : Math.round(v * 100) / 100;
          App.save('mare_settings', { key: 'closing_stock', value: all }).then(function (x) { if (x) { App.say(T('Saved.')); App.reload(); } });
        }, 'change');
        main.querySelector('#ss').onclick = function () {
          var m2 = JSON.parse(JSON.stringify(meal)), t2 = JSON.parse(JSON.stringify(tg)), sv = main.querySelector('#sm').value.trim(), tv = main.querySelector('#tt').value.trim();
          m2[cat] = sv === '' ? null : M.num(sv); t2[cat] = tv === '' ? null : M.num(tv);
          Promise.all([App.save('mare_settings', { key: 'staff_meal', value: m2 }), App.save('mare_settings', { key: 'cost_targets', value: t2 })])
            .then(function (x) { if (x[0] && x[1]) { App.say(T('Saved.')); App.reload(); } });
        };
        main.querySelector('#cx').onclick = function () {
          var btn = this; btn.disabled = true;
          App.xlsx(function () {
            var aoa = [['ROBERTO\'S MARE'], [T('Daily {c} purchases & sales', { c: catName.toLowerCase() }) + ' · ' + M.monthName(ms)], [], [T('Date'), T('Purchase'), T('Sales'), T('Cost %')]];
            rows.forEach(function (r) { aoa.push([r.d, r.p || '', r.s != null ? r.s : '', r.p && r.s ? Math.round(r.p / r.s * 1000) / 1000 : '']); });
            aoa.push([], [T('Total'), P, SL, SL ? Math.round(P / SL * 1000) / 1000 : '']);
            if (allow) aoa.push([T('Staff meal / internal use'), -allow, SL, SL ? Math.round((P - allow) / SL * 1000) / 1000 : '']);
            aoa.push([], [T('Month'), T('Closing stock')]);
            months.forEach(function (m) { var v = stock[m.slice(0, 7)] && stock[m.slice(0, 7)][cat]; aoa.push([M.monthName(m), v != null ? v : '']); });
            var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), catName);
            XLSX.writeFile(wb, 'Robertos-Mare-sales-vs-purchase-' + cat + '-' + mKey + '.xlsx'); btn.disabled = false;
          }, btn);
        };
      });
    }
  });

  // ════════════════ BREAKAGE ════════════════
  // Breakage only (Francesco, 6 Oct 2026: Montenegro does not need waste). The monthly
  // stock count moved into Sales vs purchase as one closing-stock figure, as in Dubai.
  var ST = { m: null };
  App.register('stock', {
    title: 'Breakage', icon: 'breakage', group: 'kitchen', desc: 'What was broken, why, and what it cost.',
    stat: function (H) { var n = H.f.breakage.filter(function (b) { return !b.reviewed && b.kind !== 'wastage'; }).length; return n ? [T('{n} to review', { n: n }), true] : [T('Nothing to review'), false]; },
    render: function (main) { if (!ST.m) ST.m = M.monthStart(M.today()); return breakage(main); }
  });
  function breakage(main) {
    var ms = ST.m, me = M.addDays(M.addMonths(ms, 1), -1);
    return App.fetch(['breakage'], ms, me).then(function (f) {
      if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
      f.breakage = f.breakage.filter(function (b) { return b.kind !== 'wastage'; });   // older waste entries stay in the database, not on this page
      var cost = f.breakage.reduce(function (s, b) { return s + (+b.cost || 0); }, 0);
      var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(M.monthName(ms)) + '</h2><div class="row"><button class="btn ghost" id="bp">‹ ' + E(T('Earlier')) + '</button>' +
        (ms < M.monthStart(M.today()) ? '<button class="btn ghost" id="bn">' + E(T('Later')) + ' ›</button>' : '') + '</div></div>' +
        '<div class="kpis"><div class="kpi"><span>' + E(T('Breakages')) + '</span><b>' + f.breakage.length + '</b></div>' +
        '<div class="kpi"><span>' + E(T('Cost written in')) + '</span><b>' + M.money(cost) + '</b></div></div>' +
        '<div class="card stack"><h3>' + E(T('Add one')) + '</h3><div class="grid4"><label class="f">' + E(T('What')) + '<input type="text" id="bi"></label>' +
        '<label class="f">' + E(T('How many')) + '<input type="text" inputmode="decimal" data-num="1" id="bq" value="1" min="0" step="0.5"></label>' +
        '<label class="f">' + E(T('Cost (€)')) + '<input type="text" inputmode="decimal" data-num="1" id="bc" step="0.01" min="0"></label></div>' +
        '<label class="f">' + E(T('Reason')) + '<input type="text" id="br"></label><button class="btn" id="badd" style="align-self:flex-start">' + E(T('Add')) + '</button></div>';
      h += f.breakage.length ? '<div class="box"><table><thead><tr><th>' + E(T('Date')) + '</th><th>' + E(T('What')) + '</th><th class="num">' + E(T('How many')) + '</th><th>' + E(T('Reason')) + '</th><th>' + E(T('By')) + '</th><th>' + E(T('Cost (€)')) + '</th><th>' + E(T('Checked')) + '</th></tr></thead><tbody>' +
        f.breakage.map(function (b) {
          return '<tr><td class="nw">' + E(M.shortDate(b.date)) + '</td><td><b>' + E(b.item) + '</b>' + (b.has_photo ? ' <a href="#" data-bph="' + b.id + '">' + E(T('photo')) + '</a>' : '') + '</td>' +
            '<td class="num">' + (+b.qty) + '</td><td class="small">' + E(b.reason || '—') + '</td><td class="nw">' + E(b.reported_by || '—') + '</td>' +
            '<td><input type="text" inputmode="decimal" data-num="1" step="0.01" min="0" value="' + (b.cost != null ? b.cost : '') + '" data-bcost="' + b.id + '" aria-label="' + E(T('Cost (€)')) + '" style="width:100px"></td>' +
            '<td><input type="checkbox" data-brev="' + b.id + '"' + (b.reviewed ? ' checked' : '') + ' style="width:22px;height:22px" aria-label="' + E(T('Checked')) + '"></td></tr>';
        }).join('') + '</tbody></table></div>' : App.empty(T('Nothing reported this month.'));
      main.innerHTML = h + '<p class="small muted" style="margin:0">' + E(T('Staff report a breakage on the tablet with a photo. Write in the cost and tick "Checked" once you have seen it.')) + '</p></section>';
      main.querySelector('#bp').onclick = function () { ST.m = M.addMonths(ms, -1); App.reload(); };
      var bn = main.querySelector('#bn'); if (bn) bn.onclick = function () { ST.m = M.addMonths(ms, 1); App.reload(); };
      main.querySelector('#badd').onclick = function () {
        var it = main.querySelector('#bi').value.trim(); if (!it) { App.say(T('Write what.')); return; }
        this.disabled = true; var btn = this;
        App.save('mare_breakage', { date: M.today(), item: it, qty: M.num(main.querySelector('#bq').value) || 1, kind: 'breakage', cost: M.num(main.querySelector('#bc').value),
          reason: main.querySelector('#br').value.trim() || null, reported_by: App.S.me, reviewed: true }).then(function (x) { if (x) App.reload(); else btn.disabled = false; });
      };
      App.on(main, '[data-bcost]', function (i) { App.save('mare_breakage', { id: i.getAttribute('data-bcost'), cost: M.num(i.value) }).then(function (x) { if (x) App.say(T('Saved.')); }); }, 'change');
      App.on(main, '[data-brev]', function (i) { App.save('mare_breakage', { id: i.getAttribute('data-brev'), reviewed: i.checked }).then(function (x) { if (x) App.say(T('Saved.')); }); }, 'change');
      App.on(main, '[data-bph]', function (a, e) { e.preventDefault(); App.photo('mare_breakage', a.getAttribute('data-bph')).then(function (u) { App.overlay((u ? '<img src="' + u + '" alt="">' : E(T('No photo.'))) + '<button class="btn ghost" data-close>' + E(T('Close')) + '</button>'); }); });
    });
  }

  // ════════════════ LEAVE ════════════════
  var LV = { m: null };
  App.register('leave', {
    title: 'Leave', icon: 'leave', group: 'team', desc: 'Requests from the team, the kitchen-cover check, and days left.',
    stat: function (H) { var n = H.f.leave.filter(function (l) { return l.status === 'pending'; }).length; return n ? [T('{n} waiting for you', { n: n }), true] : [T('Nothing waiting'), false]; },
    render: function (main) {
      if (!LV.m) LV.m = M.monthStart(M.today());
      var ms = LV.m, me = M.addDays(M.addMonths(ms, 1), -1), yr = M.today().slice(0, 4) + '-01-01';
      return Promise.all([App.fetch(['leave', 'settings', 'staff'], yr < ms ? yr : ms, me > M.today() ? me : M.today()), App.refreshStaff()]).then(function (r) {
        var f = r[0]; if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var minK = +((f.settings.filter(function (s) { return s.key === 'kitchen_min'; })[0] || {}).value || 3);
        var staff = f.staff.filter(function (s) { return s.active; }), kitchen = staff.filter(function (s) { return s.team === 'Kitchen'; });
        var appr = f.leave.filter(function (l) { return l.status === 'approved'; }), pend = f.leave.filter(function (l) { return l.status === 'pending'; });
        function daysOf(l) { return M.daysBetween(l.date_from, l.date_to) + 1; }
        function kitchenShort(l) {
          var bad = []; if (!kitchen.some(function (s) { return s.id === l.staff_id; })) return bad;
          for (var k = l.date_from; k <= l.date_to; k = M.addDays(k, 1)) {
            var away = appr.filter(function (a) { return a.date_from <= k && a.date_to >= k && kitchen.some(function (s) { return s.id === a.staff_id; }); }).length + 1;
            if (kitchen.length - away < minK) bad.push(k);
          }
          return bad;
        }
        var h = '<section class="stack"><h2 class="serif">' + E(T('Waiting for you')) + ' · ' + pend.length + '</h2>';
        h += pend.length ? '<div class="cards">' + pend.map(function (l) {
          var bad = kitchenShort(l);
          return '<div class="card stack"><div class="row between"><h3>' + E(App.staffName(l.staff_id)) + '</h3><span class="tag blue">' + E(T({ annual: 'Annual', unpaid: 'Unpaid', sick: 'Sick', other: 'Other' }[l.kind])) + '</span></div>' +
            '<div><b>' + E(M.shortDate(l.date_from)) + ' → ' + E(M.shortDate(l.date_to)) + '</b> · ' + E(T('{n} days', { n: daysOf(l) })) + '</div>' +
            (l.note ? '<div class="small">“' + E(l.note) + '”</div>' : '') +
            (bad.length ? '<div class="tag red" style="white-space:normal">' + E(T('Kitchen would drop under {n} on {d}', { n: minK, d: bad.slice(0, 4).map(M.shortDate).join(', ') + (bad.length > 4 ? '…' : '') })) + '</div>' : (kitchen.some(function (s) { return s.id === l.staff_id; }) ? '<div class="tag green">' + E(T('Kitchen stays at {n} or more', { n: minK })) + '</div>' : '')) +
            '<input type="text" data-ln="' + l.id + '" placeholder="' + E(T('Note to them (optional)')) + '" aria-label="' + E(T('Note')) + '">' +
            '<div class="row"><button class="btn" data-ld="' + l.id + '" data-s="approved">' + E(T('Approve')) + '</button><button class="btn warn" data-ld="' + l.id + '" data-s="declined">' + E(T('Decline')) + '</button></div></div>';
        }).join('') + '</div>' : App.empty(T('No requests waiting.'));
        h += '</section>';
        // calendar
        var days = []; for (var k = ms; k <= me; k = M.addDays(k, 1)) days.push(k);
        h += '<section class="stack"><div class="row between"><h2 class="serif">' + E(M.monthName(ms)) + '</h2><div class="row"><button class="btn ghost" id="lp">‹ ' + E(T('Earlier')) + '</button><button class="btn ghost" id="ln">' + E(T('Later')) + ' ›</button></div></div>' +
          '<div class="box"><table class="rota"><thead><tr><th>' + E(T('Name')) + '</th>' + days.map(function (k) { return '<th style="text-align:center;padding:6px 3px;font-size:11px">' + (+k.slice(8)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          staff.map(function (s) {
            return '<tr><td class="nw"><b>' + E(s.name) + '</b></td>' + days.map(function (k) {
              var l = f.leave.filter(function (x) { return x.staff_id === s.id && x.date_from <= k && x.date_to >= k && (x.status === 'approved' || x.status === 'pending'); })[0];
              return '<td style="padding:3px;text-align:center">' + (l ? '<span title="' + E(T(l.status === 'approved' ? 'Approved' : 'Asked')) + '" style="display:block;height:20px;border-radius:4px;background:' + (l.status === 'approved' ? 'var(--blue)' : 'repeating-linear-gradient(45deg,var(--blue-bg),var(--blue-bg) 4px,#c8d5f5 4px,#c8d5f5 8px)') + '"></span>' : '') + '</td>';
            }).join('') + '</tr>';
          }).join('') + '<tr><td class="nw small"><b>' + E(T('Kitchen left')) + '</b></td>' + days.map(function (k) {
            var n = kitchen.length - appr.filter(function (a) { return a.date_from <= k && a.date_to >= k && kitchen.some(function (s) { return s.id === a.staff_id; }); }).length;
            return '<td style="padding:3px;text-align:center"><span class="tiny" style="font-weight:700;color:' + (n < minK ? 'var(--red)' : 'var(--green)') + '">' + n + '</span></td>';
          }).join('') + '</tr></tbody></table></div><p class="small muted" style="margin:0">' + E(T('Solid = approved, striped = asked. "Kitchen left" counts kitchen people not on approved leave.')) + '</p></section>';
        // balances
        var yrStart = M.today().slice(0, 4) + '-01-01', yrEnd = M.today().slice(0, 4) + '-12-31';
        h += '<section class="stack"><h2 class="serif">' + E(T('Annual leave · {y}', { y: M.today().slice(0, 4) })) + '</h2><div class="box"><table><thead><tr><th>' + E(T('Name')) + '</th><th class="num">' + E(T('Days a year')) + '</th><th class="num">' + E(T('Approved')) + '</th><th class="num">' + E(T('Asked')) + '</th><th class="num">' + E(T('Left')) + '</th></tr></thead><tbody>' +
          staff.map(function (s) {
            function sum(st) { return f.leave.filter(function (l) { return l.staff_id === s.id && l.kind === 'annual' && l.status === st; }).reduce(function (t, l) {
              var a = l.date_from < yrStart ? yrStart : l.date_from, b = l.date_to > yrEnd ? yrEnd : l.date_to; return t + (b >= a ? M.daysBetween(a, b) + 1 : 0); }, 0); }
            var ent = s.annual_days != null ? s.annual_days : 21, used = sum('approved'), asked = sum('pending');
            return '<tr><td><b>' + E(s.name) + '</b></td><td class="num">' + ent + '</td><td class="num">' + used + '</td><td class="num">' + (asked || '—') + '</td><td class="num"><b style="color:' + (ent - used < 0 ? 'var(--red)' : 'inherit') + '">' + (ent - used) + '</b></td></tr>';
          }).join('') + '</tbody></table></div><p class="small muted" style="margin:0">' + E(T('Calendar days, as asked. Days a year is set per person in People.')) + '</p></section>';
        // add for someone
        h += '<section class="card stack"><h3>' + E(T('Put in leave for someone')) + '</h3><div class="grid4"><label class="f">' + E(T('Who')) + '<select id="aw">' + staff.map(function (s) { return '<option value="' + s.id + '">' + E(s.name) + '</option>'; }).join('') + '</select></label>' +
          '<label class="f">' + E(T('From')) + '<input type="date" id="af"></label><label class="f">' + E(T('To')) + '<input type="date" id="at"></label>' +
          '<label class="f">' + E(T('Kind')) + '<select id="ak"><option value="annual">' + E(T('Annual')) + '</option><option value="unpaid">' + E(T('Unpaid')) + '</option><option value="sick">' + E(T('Sick')) + '</option><option value="other">' + E(T('Other')) + '</option></select></label></div>' +
          '<label class="f">' + E(T('Note')) + '<input type="text" id="an"></label><button class="btn" id="aadd" style="align-self:flex-start">' + E(T('Add as approved')) + '</button></section>';
        // history
        var past = f.leave.filter(function (l) { return l.status !== 'pending'; }).slice().reverse();
        if (past.length) h += '<details><summary>' + E(T('Decided · {n}', { n: past.length })) + '</summary><div class="box" style="margin-top:10px"><table><tbody>' + past.map(function (l) {
          return '<tr><td><b>' + E(App.staffName(l.staff_id)) + '</b></td><td class="nw">' + E(M.shortDate(l.date_from)) + ' → ' + E(M.shortDate(l.date_to)) + '</td><td>' + E(T({ annual: 'Annual', unpaid: 'Unpaid', sick: 'Sick', other: 'Other' }[l.kind])) + '</td>' +
            '<td><span class="tag ' + (l.status === 'approved' ? 'green' : 'grey') + '">' + E(T({ approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' }[l.status])) + '</span></td><td class="small">' + E(l.decided_by || '') + '</td>' +
            '<td>' + (l.status === 'approved' && l.date_to >= M.today() ? '<button class="btn ghost sm" data-ld="' + l.id + '" data-s="cancelled">' + E(T('Cancel it')) + '</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></details>';
        main.innerHTML = h;
        main.querySelector('#lp').onclick = function () { LV.m = M.addMonths(ms, -1); App.reload(); };
        main.querySelector('#ln').onclick = function () { LV.m = M.addMonths(ms, 1); App.reload(); };
        App.on(main, '[data-ld]', function (b) {
          var id = b.getAttribute('data-ld'), n = main.querySelector('[data-ln="' + id + '"]'); b.disabled = true;
          App.call('mare_m_leave_decide', { p_id: id, p_status: b.getAttribute('data-s'), p_note: n ? n.value.trim() : null }).then(function (x) { if (x) { App.say(T('Done. The rota is updated.')); App.reload(); } else b.disabled = false; });
        });
        main.querySelector('#aadd').onclick = function () {
          var a = main.querySelector('#af').value, b2 = main.querySelector('#at').value || a; if (!a) { App.say(T('Pick the dates.')); return; } if (b2 < a) { App.say(T('The end is before the start.')); return; }
          this.disabled = true; var btn = this;
          App.save('mare_leave', { staff_id: main.querySelector('#aw').value, date_from: a, date_to: b2, kind: main.querySelector('#ak').value, note: main.querySelector('#an').value.trim() || null, created_via: 'manager' })
            .then(function (x) { if (!x) { btn.disabled = false; return null; } return App.call('mare_m_leave_decide', { p_id: x.id, p_status: 'approved', p_note: null }); })
            .then(function (x) { if (x) { App.say(T('Added. The rota is updated.')); App.reload(); } });
        };
      });
    }
  });

  // ════════════════ SPEAK UP ════════════════
  App.register('speakup', {
    title: 'Speak up', icon: 'speak', group: 'team', desc: 'Anonymous messages from the team: ideas, problems, respect.',
    stat: function (H) { var n = H.f.speakup.filter(function (s) { return s.status === 'new'; }).length; return n ? [T('{n} new', { n: n }), true] : [T('Nothing new'), false]; },
    render: function (main) {
      return App.fetch(['speakup']).then(function (f) {
        if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var KIND = { idea: ['Idea', 'green'], problem: ['Problem', 'amber'], respect: ['Respect at work', 'red'], other: ['Other', 'grey'] };
        var h = '<section class="stack"><h2 class="serif">' + E(T('Messages')) + '</h2><p class="muted" style="margin:0">' + E(T('Sent from the tablet or a phone with no name, unless they chose to sign it. Nobody can see who sent an unsigned one, not even here.')) + '</p>';
        h += f.speakup.length ? '<div class="stack">' + f.speakup.map(function (s) {
          var k = KIND[s.kind] || KIND.other;
          return '<div class="card stack" style="' + (s.status === 'done' ? 'opacity:.7' : '') + '"><div class="row between"><div class="row"><span class="tag ' + k[1] + '">' + E(T(k[0])) + '</span>' +
            (s.status === 'new' ? '<span class="tag teal">' + E(T('NEW')) + '</span>' : '') + '<span class="small muted">' + E(M.shortDate(M.dateKey(s.at))) + ' ' + M.hhmm(s.at) + ' · ' + E(s.name || T('No name')) + '</span></div>' +
            '<select data-ss="' + s.id + '" aria-label="' + E(T('Status')) + '">' + ['new', 'seen', 'done'].map(function (x) { return '<option value="' + x + '"' + (s.status === x ? ' selected' : '') + '>' + E(T({ new: 'New', seen: 'Seen', done: 'Dealt with' }[x])) + '</option>'; }).join('') + '</select></div>' +
            '<div class="pre" style="font-size:17px">' + E(s.text) + '</div>' +
            // The note is for managers only: an unsigned message has nobody to answer, so it is never a reply.
            '<label class="f" style="margin:0">' + E(T('Managers’ note: what was done about it. The team never sees this.')) + '<div class="row"><input type="text" data-sn="' + s.id + '" value="' + E(s.note || '') + '" placeholder="' + E(T('e.g. Spoke to the kitchen about the staff meal')) + '" aria-label="' + E(T('Note')) + '" style="flex:1 1 260px"><button class="btn ghost sm" data-ssave="' + s.id + '">' + E(T('Save')) + '</button></div></label></div>';
        }).join('') + '</div>' : App.empty(T('No messages yet.'));
        main.innerHTML = h + '</section>';
        App.on(main, '[data-ss]', function (sel) { App.save('mare_speakup', { id: sel.getAttribute('data-ss'), status: sel.value }).then(function (x) { if (x) { App.say(T('Saved.')); } }); }, 'change');
        App.on(main, '[data-ssave]', function (b) { var id = b.getAttribute('data-ssave'); App.save('mare_speakup', { id: id, note: main.querySelector('[data-sn="' + id + '"]').value.trim() || null, status: main.querySelector('[data-ss="' + id + '"]').value === 'new' ? 'seen' : main.querySelector('[data-ss="' + id + '"]').value }).then(function (x) { if (x) { App.say(T('Saved.')); App.reload(); } }); });
      });
    }
  });
})(window);
