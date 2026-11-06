/* Roberto's Mare — read the invoice photo (6 Nov 2026), manager side.
   Opens inside a delivery of the Delivery report. Only when a manager presses "Read the invoice" the photo goes to the
   reader (edge function mare-invoice-read, which writes nothing); the lines come back as printed text and the app parses
   the numbers itself. Anything unclear is left EMPTY, never guessed. The person corrects the lines, ticks "checked", and
   only then can the prices be put into Ordering, line by line, each linked to an article by the person.
   Tables mare_delivery_lines (+ columns on mare_deliveries), RPCs mare_m_deliv_lines* (mare-invoice-schema.sql). */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;
  var ART = null;

  function arts() {
    if (ART) return Promise.resolve(ART);
    return App.call('mare_m_ord_data', { p_days: 1 }).then(function (r) { ART = ((r && r.articles) || []).filter(function (a) { return a.active; }); return ART; });
  }
  function aLabel(a) { return (a.store === 'bar' ? 'Bar' : 'Kitchen') + ' ' + a.code + ' · ' + (a.name || ''); }
  function eur(v) { return v == null ? '—' : (+v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // A number as it is printed on an invoice. {v: number|null, amb: true when it could be read two ways}
  function pnum(text) {
    var s = String(text == null ? '' : text).replace(/[€%\s]|EUR|eur/g, '').replace(/^[-+]?(?=\.)/, '');
    if (s === '') return { v: null };
    var m;
    if (/^\d+$/.test(s)) return { v: parseInt(s, 10) };
    if ((m = /^(\d{1,3}(?:\.\d{3})+),(\d+)$/.exec(s))) return { v: parseFloat(m[1].replace(/\./g, '') + '.' + m[2]) };      // 1.234,50
    if ((m = /^(\d{1,3}(?:,\d{3})+)\.(\d+)$/.exec(s))) return { v: parseFloat(m[1].replace(/,/g, '') + '.' + m[2]) };      // 1,234.50
    if ((m = /^(\d+)([.,])(\d+)$/.exec(s))) {
      if (m[3].length === 3) return { v: null, amb: true };                       // 1.800 or 1,800: thousands or decimals? ask
      return { v: parseFloat(m[1] + '.' + m[3]) };                                 // 12,5  12.50  0,125
    }
    if (/^\d{1,3}([.,]\d{3}){2,}$/.test(s)) return { v: parseInt(s.replace(/[.,]/g, ''), 10) };   // 1.234.567
    return { v: null, amb: true };
  }
  function toNum(s) { var p = pnum(s); return p.v; }
  function unitKey(u) {
    u = String(u || '').toLowerCase().replace(/[^a-zčćžšđ]/g, '');
    if (/^(kom|kos|pcs|pc|komad|komada|kos)$/.test(u)) return 'kom';
    if (/^(kg|kgs|kilo|kilogram)$/.test(u)) return 'kg';
    if (/^(l|lit|ltr|litar|litra|lt)$/.test(u)) return 'l';
    return u;
  }
  function toks(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9čćžšđ ]/g, ' ').split(/\s+/).filter(function (x) { return x.length > 2; }); }
  // A suggestion only: the closest article by words in common, when it is clearly the best.
  function suggest(line, list) {
    var lt = toks(line.name); if (!lt.length) return null; var best = null, second = 0, bs = 0;
    list.forEach(function (a) {
      var at = toks(a.name + ' ' + (a.name_me || '') + ' ' + (a.name_en || '')), hit = lt.filter(function (x) { return at.indexOf(x) >= 0; }).length, sc = hit / lt.length;
      if (sc > bs) { second = bs; bs = sc; best = a; } else if (sc > second) second = sc;
    });
    return best && bs >= 0.6 && bs - second >= 0.2 ? best : null;
  }

  function mount(o, d) {
    var box = o.querySelector('#dinv'); if (!box) return;
    var S = { lines: [], status: null, note: null, invTotal: null, busy: false, sug: {} };

    function load() {
      return App.call('mare_m_deliv_lines', { p_delivery: d.id }).then(function (r) {
        if (!r) { box.innerHTML = ''; return; }
        S.status = r.status; S.note = r.note; S.invTotal = r.inv_total; S.lines = r.lines || [];
        return arts().then(function (list) {
          S.lines.forEach(function (l) { if (!l.article_id && !(l.id in S.sug)) { var a = suggest(l, list); S.sug[l.id] = a ? a.id : null; } });
          paint();
        });
      });
    }
    function paint() {
      if (!S.lines.length && !S.status) {
        box.innerHTML = '<div class="card stack" style="background:#FBF7F1"><b>' + E(T('Invoice lines')) + '</b><div class="small muted">' + E(T('The system reads the photo and writes the lines: item, quantity, unit and price. It only happens when you press the button. You check the lines before anything is used.')) + '</div>' +
          '<button class="btn" id="irun" style="align-self:flex-start">' + E(T('Read the invoice')) + '</button></div>';
        box.querySelector('#irun').onclick = read; return;
      }
      var list = ART || [], byId = {}; list.forEach(function (a) { byId[a.id] = a; });
      var sum = 0, has = false; S.lines.forEach(function (l) { if (l.line_total != null) { sum += +l.line_total; has = true; } });
      var diff = (S.invTotal != null && has) ? Math.round((sum - +S.invTotal) * 100) / 100 : null;
      var h = '<div class="card stack" style="background:#FBF7F1"><div class="row between"><b>' + E(T('Invoice lines')) + '</b><span class="dv-tag' + (S.status === 'checked' ? '' : ' red') + '" style="' + (S.status === 'checked' ? 'background:#DDEBDD;color:#285C36' : '') + '">' + E(S.status === 'checked' ? T('checked') : T('read by the computer, not checked yet')) + '</span></div>' +
        (S.note ? '<div class="small" style="color:#7A5A12">' + E(S.note) + '</div>' : '') +
        '<div style="overflow-x:auto"><table class="inv"><thead><tr><th>' + E(T('Item')) + '</th><th>' + E(T('Qty')) + '</th><th>' + E(T('Unit')) + '</th><th>' + E(T('Unit price')) + '</th><th>' + E(T('Line total')) + '</th><th>' + E(T('Ordering article')) + '</th><th></th></tr></thead><tbody>' +
        S.lines.map(function (l, i) {
          var a = l.article_id ? byId[l.article_id] : null, sg = !a && S.sug[l.id] ? byId[S.sug[l.id]] : null;
          return '<tr data-i="' + i + '"><td><input type="text" data-f="name" value="' + E(l.name || '') + '" style="min-width:170px"></td>' +
            '<td><input type="text" inputmode="decimal" data-f="qty" data-o="' + (l.qty != null ? +l.qty : '') + '" value="' + (l.qty != null ? +l.qty : '') + '" style="width:70px"></td>' +
            '<td><input type="text" data-f="unit" value="' + E(l.unit || '') + '" style="width:56px"></td>' +
            '<td><input type="text" inputmode="decimal" data-f="unit_price" data-o="' + (l.unit_price != null ? +l.unit_price : '') + '" value="' + (l.unit_price != null ? +l.unit_price : '') + '" style="width:84px"></td>' +
            '<td><input type="text" inputmode="decimal" data-f="line_total" data-o="' + (l.line_total != null ? +l.line_total : '') + '" value="' + (l.line_total != null ? +l.line_total : '') + '" style="width:90px"></td>' +
            '<td><input type="text" data-f="article" list="ial" value="' + E(a ? aLabel(a) : '') + '" placeholder="' + E(sg ? T('suggested: ') + aLabel(sg) : T('Type to find an article')) + '" style="min-width:190px;' + (sg ? 'border-color:#BA7517' : '') + '">' +
            (sg ? '<div><button type="button" class="btn ghost sm" data-use="' + i + '">' + E(T('Use the suggestion')) + '</button></div>' : '') + '</td>' +
            '<td><button type="button" class="btn ghost sm" data-del="' + i + '" aria-label="' + E(T('Remove this line')) + '">×</button></td></tr>';
        }).join('') + '</tbody></table></div><datalist id="ial">' + list.map(function (a) { return '<option value="' + E(aLabel(a)) + '">'; }).join('') + '</datalist>' +
        '<div class="small">' + E(T('The lines add up to €{a}.', { a: eur(sum) })) + (S.invTotal != null ? ' ' + E(T('The invoice total is €{b}.', { b: eur(S.invTotal) })) : '') +
        (diff != null && Math.abs(diff) > 0.05 ? ' <b style="color:#8A2E2E">' + E(T('Difference €{d}: check the lines. (Lines may be without PDV.)', { d: eur(diff) })) + '</b>' : '') + '</div>' +
        '<div class="row"><button type="button" class="btn ghost" id="iadd">' + E(T('Add a line')) + '</button><button type="button" class="btn" id="isave">' + E(T('Save lines')) + '</button>' +
        (S.status !== 'checked' ? '<button type="button" class="btn" id="ichk">' + E(T('Mark as checked')) + '</button>' : '') + '<button type="button" class="btn ghost" id="irerun">' + E(T('Read again')) + '</button></div>' +
        '<div class="small muted">' + E(T('"Read again" replaces these lines with a new reading.')) + '</div>' + (S.status === 'checked' ? pricesHtml(byId) : '') + '</div>';
      box.innerHTML = h; bind(byId);
    }
    function pricesHtml(byId) {
      var rows = S.lines.filter(function (l) { return l.article_id && byId[l.article_id] && +l.unit_price > 0; });
      if (!rows.length) return '<div class="small muted">' + E(T('To update prices in Ordering, link each line to its article above, then save.')) + '</div>';
      return '<div class="stack"><b>' + E(T('Update prices in Ordering')) + '</b><div class="small muted">' + E(T('Tick the prices to change. A line is not ticked when the units differ or the price moves by more than half: check those first.')) + '</div>' +
        rows.map(function (l) {
          var a = byId[l.article_id], old = a.price == null ? null : +a.price, nw = +l.unit_price, same = old != null && Math.abs(old - nw) < 0.005;
          var unitsDiffer = l.unit && a.unit && unitKey(l.unit) !== unitKey(a.unit), big = old != null && old > 0 && Math.abs(nw / old - 1) > 0.5;
          var on = !same && !unitsDiffer && !big && !l.price_applied_at;
          return '<label class="row" style="gap:10px;align-items:flex-start"><input type="checkbox" data-pl="' + l.id + '" data-art="' + a.id + '" data-pr="' + nw + '"' + (on ? ' checked' : '') + (same ? ' disabled' : '') + ' style="width:22px;height:22px;margin-top:4px">' +
            '<span>' + E(a.name) + ' — ' + E(old == null ? T('no price') : '€' + eur(old)) + ' → <b>€' + eur(nw) + '</b>' + (same ? ' <span class="dv-tag" style="background:#DDEBDD;color:#285C36">' + E(T('same price')) + '</span>' : '') +
            (l.price_applied_at ? ' <span class="dv-tag" style="background:#DDEBDD;color:#285C36">' + E(T('updated')) + '</span>' : '') +
            (unitsDiffer ? '<br><span class="small" style="color:#7A5A12">' + E(T('Units differ: invoice {a}, article {b}.', { a: l.unit, b: a.unit })) + '</span>' : '') +
            (big ? '<br><span class="small" style="color:#7A5A12">' + E(T('The price moves by more than half.')) + '</span>' : '') + '</span></label>';
        }).join('') + '<button type="button" class="btn" id="iapply" style="align-self:flex-start">' + E(T('Update the ticked prices')) + '</button></div>';
    }
    function collect(byId) {
      box.querySelectorAll('tr[data-i]').forEach(function (tr) {
        var l = S.lines[+tr.getAttribute('data-i')];
        l.name = tr.querySelector('[data-f=name]').value.trim(); l.unit = tr.querySelector('[data-f=unit]').value.trim();
        ['qty', 'unit_price', 'line_total'].forEach(function (f) { var el = tr.querySelector('[data-f=' + f + ']'); if (el.value === el.getAttribute('data-o')) { l['_bad_' + f] = false; return; } var p = pnum(el.value); l[f] = p.v; l['_bad_' + f] = !!p.amb; });
        var av = tr.querySelector('[data-f=article]').value.trim(), hit = null;
        if (av) (ART || []).forEach(function (a) { if (aLabel(a) === av) hit = a; });
        l.article_id = hit ? hit.id : null;
      });
    }
    function payload() {
      return S.lines.filter(function (l) { return l.name; }).map(function (l) {
        return { id: l.id || '', code: l.code || '', name: l.name, unit: l.unit || '', qty: l.qty == null ? '' : String(l.qty), unit_price: l.unit_price == null ? '' : String(l.unit_price),
          discount_pct: l.discount_pct == null ? '' : String(l.discount_pct), vat_pct: l.vat_pct == null ? '' : String(l.vat_pct), line_total: l.line_total == null ? '' : String(l.line_total), article_id: l.article_id || '' };
      });
    }
    function bind(byId) {
      box.querySelector('#iadd').onclick = function () { collect(byId); S.lines.push({ id: '', name: '', unit: '', qty: null, unit_price: null, line_total: null, article_id: null }); paint(); };
      App.on(box, '[data-del]', function (b) { collect(byId); S.lines.splice(+b.getAttribute('data-del'), 1); paint(); });
      App.on(box, '[data-use]', function (b) { collect(byId); var l = S.lines[+b.getAttribute('data-use')]; l.article_id = S.sug[l.id] || null; paint(); });
      function save(status) {
        collect(byId);
        if (S.lines.some(function (l) { return l._bad_qty || l._bad_unit_price || l._bad_line_total; })) { App.say(T('Write the numbers like 12.50 or 12,50.')); return; }
        return App.call('mare_m_deliv_lines_save', { p_delivery: d.id, p_lines: payload(), p_status: status || S.status || 'read', p_note: null, p_inv_total: null, p_by: App.S.me }).then(function (r) { if (r) { App.say(T('Saved.')); return load(); } });
      }
      box.querySelector('#isave').onclick = function () { save(null); };
      var chk = box.querySelector('#ichk'); if (chk) chk.onclick = function () { save('checked'); };
      box.querySelector('#irerun').onclick = read;
      var ap = box.querySelector('#iapply');
      if (ap) ap.onclick = function () {
        var items = []; box.querySelectorAll('[data-pl]:checked').forEach(function (c) { items.push({ line_id: c.getAttribute('data-pl'), article_id: c.getAttribute('data-art'), price: c.getAttribute('data-pr') }); });
        if (!items.length) { App.say(T('Tick at least one price.')); return; }
        ap.disabled = true;
        App.call('mare_m_deliv_apply_prices', { p_delivery: d.id, p_items: items, p_by: App.S.me }).then(function (r) { ap.disabled = false; if (!r) return; ART = null; App.say(T('{n} prices updated in Ordering.', { n: r.applied })); load(); });
      };
    }
    function read() {
      if (S.busy) return; S.busy = true;
      var b = box.querySelector('#irun') || box.querySelector('#irerun'); if (b) b.disabled = true;
      App.say(T('Reading the invoice…'));
      App.fn('mare-invoice-read', { delivery_id: d.id }).then(function (x) {
        S.busy = false; if (b) b.disabled = false;
        if (!x || !x.ok) { App.say(T('Could not read the invoice. Try again, or type the lines.')); return; }
        var inv = x.invoice || {}, unclear = [], lines = (inv.lines || []).map(function (l, i) {
          function cell(label, txt) { var p = pnum(txt); if (p.amb) unclear.push(T('line {n} {f} ("{t}")', { n: i + 1, f: label, t: txt })); return p.v; }
          return { id: '', code: l.code || '', name: l.name || '', unit: l.unit || '', qty: cell(T('quantity'), l.qty_text), unit_price: cell(T('unit price'), l.unit_price_text),
            discount_pct: toNum(l.discount_text), vat_pct: toNum(l.vat_text), line_total: cell(T('total'), l.total_text), article_id: '' };
        });
        var note = [];
        if (inv.quality && inv.quality !== 'good') note.push(T('The photo is hard to read.'));
        if (inv.unreadable_note) note.push(inv.unreadable_note);
        if (unclear.length) note.push(T('Left empty because they can be read two ways: {l}.', { l: unclear.join(', ') }));
        if (inv.invoice_no && d.invoice_no && String(inv.invoice_no).trim() !== String(d.invoice_no).trim()) note.push(T('The invoice says number {n}.', { n: inv.invoice_no }));
        App.call('mare_m_deliv_lines_save', { p_delivery: d.id, p_lines: lines.map(function (l) { return { id: '', code: l.code, name: l.name, unit: l.unit, qty: l.qty == null ? '' : String(l.qty), unit_price: l.unit_price == null ? '' : String(l.unit_price), discount_pct: l.discount_pct == null ? '' : String(l.discount_pct), vat_pct: l.vat_pct == null ? '' : String(l.vat_pct), line_total: l.line_total == null ? '' : String(l.line_total), article_id: '' }; }),
          p_status: 'read', p_note: note.join(' '), p_inv_total: toNum(inv.total_text), p_by: App.S.me }).then(function (r) { if (r) { App.say(T('{n} lines read. Check them against the photo.', { n: lines.length })); load(); } });
      });
    }
    load();
  }

  w.MareInvoice = { mount: mount, pnum: pnum };
})(window);
