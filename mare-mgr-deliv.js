/* Roberto's Mare — Deliveries (6 Nov 2026), manager side.
   The team records each delivery on the tablet or phone (mare-team.js, module "deliveries"):
   who received it, the supplier, the date, the invoice total and a photo of the invoice.
   Here Milica sees them by month, opens the photo, corrects or cancels, adds one by hand, exports to Excel.
   Table mare_deliveries, RPCs mare_m_deliv_* (mare-deliveries-schema.sql). Nothing is deleted. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;
  var DV = { m: null, sup: '', data: null };

  function css() {
    if (document.getElementById('dv-css')) return;
    var s = document.createElement('style'); s.id = 'dv-css';
    s.textContent = '.dv-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.dv-bar select{min-height:40px;padding:8px 12px;border:1px solid #D6CABA;border-radius:8px;font:inherit;background:#fff}' +
      'tr.dv-x td{color:#9A8F83;text-decoration:line-through}tr.dv-x td.nostrike{text-decoration:none}.dv-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:20px;padding:1px 8px;background:#F5E8C9;color:#7A5A12}' +
      '.dv-tag.red{background:#F4DADA;color:#8A2E2E}.dv-tot{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}';
    document.head.appendChild(s);
  }
  function eur(v) { return v == null ? '—' : (+v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function parseAmt(s) {
    s = String(s == null ? '' : s).trim(); if (s === '') return { v: null };
    s = s.replace(/\s/g, '');
    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');        // 1.234,50
    else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '');                      // 1,234.50
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');                                      // 412,60
    else if (!/^\d+(\.\d{1,2})?$/.test(s)) return { err: true };
    return { v: parseFloat(s) };
  }
  function vatTxt(v) { return v === 'without' ? T('without PDV') : T('with PDV'); }

  App.register('deliveries', {
    title: 'Delivery report', icon: 'stock', group: 'kitchen', desc: 'Goods received from suppliers: who, when, the invoice total and its photo.',
    tabs: [['list', 'Report'], ['receive', 'Receive a delivery']],
    stat: function () { return [T('Recorded by the team'), false]; },
    render: function (main, sub) { css(); if (!DV.m) DV.m = M.monthStart(M.today()); return sub === 'receive' ? receive(main) : paint(main); }
  });

  // A manager takes a delivery in too (Francesco, 6 Nov 2026): the same form the team has, under the manager's own name.
  function receive(main) {
    var t = M.today();
    return App.call('mare_m_deliv_data', { p_from: t, p_to: t }).then(function (r) {
      if (!r) { main.innerHTML = App.empty(T('Could not load.')); return; }
      var sups = r.suppliers || [], photo = null, warned = false;
      main.innerHTML = '<section class="stack"><h2 class="serif">' + E(T('Receive a delivery')) + '</h2><div class="card stack">' +
        '<label class="f">' + E(T('Supplier')) + '<select id="rs"><option value="">' + E(T('Choose the supplier')) + '</option>' + sups.map(function (s) { return '<option value="' + s.id + '">' + E(s.name) + '</option>'; }).join('') +
        '<option value="__other">' + E(T('Another supplier…')) + '</option></select></label>' +
        '<label class="f" id="rol" style="display:none">' + E(T('Supplier name')) + '<input type="text" id="ro"></label>' +
        '<div class="grid2"><label class="f">' + E(T('Date of delivery')) + '<input type="date" id="rd" value="' + E(t) + '"></label>' +
        '<label class="f">' + E(T('Invoice total (€)')) + '<input type="text" inputmode="decimal" id="rt"></label></div>' +
        '<div class="grid2"><label class="f">' + E(T('The total is')) + '<select id="rv"><option value="with">' + E(T('with PDV')) + '</option><option value="without">' + E(T('without PDV')) + '</option></select></label>' +
        '<label class="f">' + E(T('Invoice number (optional)')) + '<input type="text" id="ri"></label></div>' +
        '<label class="f">' + E(T('Anything missing or damaged?')) + '<input type="text" id="rn"></label>' +
        '<label class="f">' + E(T('Invoice photo')) + '<input type="file" accept="image/*" capture="environment" id="rp"></label>' +
        '<div class="small muted">' + E(T('Received by {n}', { n: App.S.me || '—' })) + '</div>' +
        '<div class="msg err" id="rm"></div><button class="btn" id="rsave" style="align-self:flex-start">' + E(T('Save delivery')) + '</button></div></section>';
      var $ = function (id) { return main.querySelector('#' + id); };
      $('rs').onchange = function () { $('rol').style.display = this.value === '__other' ? '' : 'none'; };
      $('rp').onchange = function () { var fl = this.files[0]; if (!fl) return; M.photoFromFile(fl, 1600).then(function (u) { photo = u; $('rm').textContent = ''; App.say(T('Photo added.')); }); };
      $('rsave').onclick = function () {
        var msg = $('rm'), sv = $('rs').value, nm = sv === '__other' ? $('ro').value.trim() : '';
        if (!sv || (sv === '__other' && nm.length < 2)) { msg.textContent = T('Choose or write the supplier.'); return; }
        var a = parseAmt($('rt').value); if (a.err || a.v == null) { msg.textContent = T('Write the invoice total as a number, like 412.60'); return; }
        if (!$('rd').value) { msg.textContent = T('Choose the date.'); return; }
        if (!photo && !warned) { warned = true; msg.textContent = T('No invoice photo yet. Tap Save again to save without it.'); return; }
        var sp = sv === '__other' ? null : sups.filter(function (s) { return s.id === sv; })[0], btn = this; btn.disabled = true;
        App.call('mare_m_deliv_save', { p_row: { supplier_name: sp ? sp.name : nm, supplier_id: sp ? sp.id : '', date: $('rd').value, total: String(a.v), vat: $('rv').value, invoice_no: $('ri').value.trim(), note: $('rn').value.trim(), photo: photo || '', received_by: App.S.me }, p_by: App.S.me })
          .then(function (x) { btn.disabled = false; if (!x) return; App.say(T('Saved.')); App.go('deliveries', 'list'); });
      };
    });
  }

  function paint(main) {
    var ms = DV.m, me = M.addDays(M.addMonths(ms, 1), -1);
    return App.call('mare_m_deliv_data', { p_from: ms, p_to: me }).then(function (r) {
      if (!r) { main.innerHTML = App.empty(T('Could not load.')); return; }
      DV.data = r;
      var all = r.deliveries, live = all.filter(function (d) { return !d.cancelled; });
      var sups = {}; all.forEach(function (d) { sups[d.supplier_name] = 1; });
      var rows = all.filter(function (d) { return !DV.sup || d.supplier_name === DV.sup; });
      var total = live.reduce(function (s, d) { return s + (+d.total || 0); }, 0), nophoto = live.filter(function (d) { return !d.has_photo; }).length;
      var cur = M.monthStart(M.today());
      var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(M.monthName(ms)) + '</h2><div class="row"><button class="btn ghost" id="dp">‹ ' + E(T('Earlier')) + '</button>' +
        (ms < cur ? '<button class="btn ghost" id="dn">' + E(T('Later')) + ' ›</button>' : '') + '</div></div>' +
        '<div class="kpis"><div class="kpi"><span>' + E(T('Deliveries')) + '</span><b>' + live.length + '</b></div>' +
        '<div class="kpi"><span>' + E(T('Invoiced')) + '</span><b>€' + eur(total) + '</b><i>' + E(T('as written on each invoice')) + '</i></div>' +
        '<div class="kpi' + (nophoto ? ' red' : '') + '"><span>' + E(T('No invoice photo')) + '</span><b>' + nophoto + '</b></div></div>' +
        '<div class="dv-bar"><select id="ds" aria-label="' + E(T('Supplier')) + '"><option value="">' + E(T('Every supplier')) + '</option>' +
        Object.keys(sups).sort().map(function (n) { return '<option value="' + E(n) + '"' + (DV.sup === n ? ' selected' : '') + '>' + E(n) + '</option>'; }).join('') + '</select>' +
        '<button class="btn" id="da">' + E(T('Add a delivery')) + '</button><button class="btn ghost" id="dx">' + E(T('Excel')) + '</button></div>';
      h += rows.length ? '<div class="box"><table><thead><tr><th>' + E(T('Date')) + '</th><th>' + E(T('Supplier')) + '</th><th>' + E(T('Received by')) + '</th><th class="dv-tot">' + E(T('Total (€)')) + '</th><th></th></tr></thead><tbody>' +
        rows.map(function (d) {
          return '<tr class="has' + (d.cancelled ? ' dv-x' : '') + '" data-d="' + d.id + '" style="cursor:pointer"><td class="nw">' + E(M.shortDate(d.date)) + '</td><td><b>' + E(d.supplier_name) + '</b>' + (d.invoice_no ? '<div class="small muted">' + E(d.invoice_no) + '</div>' : '') + '</td>' +
            '<td class="nw">' + E(d.received_by || '—') + '</td><td class="dv-tot">' + eur(d.total) + '<div class="small muted">' + E(vatTxt(d.vat)) + '</div></td>' +
            '<td class="nostrike nw">' + (d.cancelled ? '<span class="dv-tag red">' + E(T('cancelled')) + '</span>' : d.has_photo ? M.icon('eye', 18) : '<span class="dv-tag">' + E(T('no photo')) + '</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : App.empty(T('No deliveries recorded this month.'));
      main.innerHTML = h + '<p class="small muted" style="margin:0">' + E(T('The team records each delivery on the tablet or phone: who received it, the supplier, the date, the invoice total and a photo of the invoice. Tap a line to see the photo, correct it or cancel it.')) + '</p></section>';
      main.querySelector('#dp').onclick = function () { DV.m = M.addMonths(ms, -1); App.reload(); };
      var dn = main.querySelector('#dn'); if (dn) dn.onclick = function () { DV.m = M.addMonths(ms, 1); App.reload(); };
      main.querySelector('#ds').onchange = function () { DV.sup = this.value; paint(main); };
      main.querySelector('#da').onclick = function () { form({ date: M.today(), vat: 'with' }); };
      main.querySelector('#dx').onclick = function () { xl(rows, ms, this); };
      App.on(main, '[data-d]', function (tr) { var d = all.filter(function (x) { return x.id === tr.getAttribute('data-d'); })[0]; if (d) form(d); });
    });
  }

  function form(d) {
    var isNew = !d.id, sups = (DV.data && DV.data.suppliers) || [];
    var o = App.overlay('<div class="row between"><h3>' + E(isNew ? T('Add a delivery') : d.supplier_name) + '</h3><button class="btn ghost sm" data-close>' + E(T('Close')) + '</button></div>' +
      '<div id="dph"></div>' +
      '<label class="f">' + E(T('Supplier')) + '<input type="text" id="fs" list="fsl" value="' + E(d.supplier_name || '') + '"><datalist id="fsl">' + sups.map(function (s) { return '<option value="' + E(s.name) + '">'; }).join('') + '</datalist></label>' +
      '<div class="grid2"><label class="f">' + E(T('Date')) + '<input type="date" id="fd" value="' + E(d.date || '') + '"></label>' +
      '<label class="f">' + E(T('Invoice total (€)')) + '<input type="text" inputmode="decimal" id="ft" value="' + (d.total != null ? E(String(+d.total)) : '') + '"></label></div>' +
      '<div class="grid2"><label class="f">' + E(T('The total is')) + '<select id="fv"><option value="with"' + (d.vat !== 'without' ? ' selected' : '') + '>' + E(T('with PDV')) + '</option><option value="without"' + (d.vat === 'without' ? ' selected' : '') + '>' + E(T('without PDV')) + '</option></select></label>' +
      '<label class="f">' + E(T('Invoice number')) + '<input type="text" id="fi" value="' + E(d.invoice_no || '') + '"></label></div>' +
      '<label class="f">' + E(T('Note')) + '<input type="text" id="fn" value="' + E(d.note || '') + '" placeholder="' + E(T('Missing or damaged goods')) + '"></label>' +
      (isNew ? '' : '<div class="small muted">' + E(T('Received by {n}', { n: d.received_by || '—' })) + (d.at ? ' · ' + E(M.niceDate(String(d.at).slice(0, 10))) : '') + '</div>') +
      '<label class="f">' + E(T('Invoice photo')) + '<input type="file" accept="image/*" id="fp"></label>' +
      '<div class="row"><button class="btn" id="fsave">' + E(T('Save')) + '</button>' +
      (isNew ? '' : (d.cancelled ? '<button class="btn ghost" id="fcx">' + E(T('Bring back')) + '</button>' : '<button class="btn ghost" id="fcx">' + E(T('Cancel this delivery')) + '</button>')) + '</div>' +
      (isNew || d.cancelled ? (d.cancel_reason ? '<div class="small muted">' + E(T('Cancelled: {r}', { r: d.cancel_reason })) + '</div>' : '') : '<label class="f">' + E(T('Reason, if you cancel')) + '<input type="text" id="fr"></label>') +
      '<p class="small muted" style="margin:0">' + E(T('Nothing is deleted. A cancelled delivery stays in the list.')) + '</p>');
    if (!isNew && d.has_photo) {
      App.call('mare_m_deliv_photo', { p_id: d.id }).then(function (r) {
        var u = r && M.safeJpeg(r.photo); if (!u) return;
        o.querySelector('#dph').innerHTML = '<img class="photo" src="' + u + '" alt="' + E(T('Invoice photo')) + '">';
      });
    }
    var photo = null;
    o.querySelector('#fp').onchange = function () { var fl = this.files[0]; if (!fl) return; M.photoFromFile(fl, 1600).then(function (u) { photo = u; App.say(T('Photo added.')); }); };
    function row() {
      var a = parseAmt(o.querySelector('#ft').value); if (a.err) { App.say(T('Write the total as a number.')); return null; }
      var nm = o.querySelector('#fs').value.trim(); if (nm.length < 2) { App.say(T('Write the supplier.')); return null; }
      var sp = sups.filter(function (s) { return s.name.toLowerCase() === nm.toLowerCase(); })[0];
      var r = { supplier_name: sp ? sp.name : nm, supplier_id: sp ? sp.id : '', date: o.querySelector('#fd').value, total: a.v == null ? '' : String(a.v), vat: o.querySelector('#fv').value,
        invoice_no: o.querySelector('#fi').value.trim(), note: o.querySelector('#fn').value.trim() };
      if (!isNew) r.id = d.id; if (photo) r.photo = photo; return r;
    }
    o.querySelector('#fsave').onclick = function () {
      var r = row(); if (!r) return; var btn = this; btn.disabled = true;
      App.call('mare_m_deliv_save', { p_row: r, p_by: App.S.me }).then(function (x) { btn.disabled = false; if (!x) return; o.close(); App.say(T('Saved.')); App.reload(); });
    };
    var cx = o.querySelector('#fcx');
    if (cx) cx.onclick = function () {
      var btn = this; btn.disabled = true;
      var rs = o.querySelector('#fr'), r = { id: d.id, cancelled: !d.cancelled, cancel_reason: d.cancelled ? '' : (rs ? rs.value.trim() : '') };
      App.call('mare_m_deliv_save', { p_row: r, p_by: App.S.me }).then(function (x) { btn.disabled = false; if (!x) return; o.close(); App.say(T('Saved.')); App.reload(); });
    };
  }

  function xl(rows, ms, btn) {
    btn.disabled = true;
    App.xlsx(function () {
      var aoa = [[T('Date'), T('Supplier'), T('Invoice number'), T('Received by'), T('Total (€)'), T('The total is'), T('Note'), T('Invoice photo'), T('Status')]];
      rows.forEach(function (d) { aoa.push([d.date, d.supplier_name, d.invoice_no || '', d.received_by || '', d.total == null ? '' : +d.total, vatTxt(d.vat), d.note || '', d.has_photo ? T('yes') : T('no'), d.cancelled ? T('cancelled') : '']); });
      var sh = XLSX.utils.aoa_to_sheet(aoa); sh['!cols'] = [12, 24, 16, 20, 12, 12, 30, 12, 12].map(function (n) { return { wch: n }; });
      var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sh, T('Deliveries'));
      XLSX.writeFile(wb, 'Robertos-Mare-deliveries-' + ms.slice(0, 7) + '.xlsx'); btn.disabled = false;
    }, btn);
  }
})(window);
