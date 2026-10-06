/* Roberto's Mare — daily-operations modules: Schedule, Daily briefing,
   Closing report, Checklists, Weekly meetings. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc, App = w.MareApp;
  var TEAMS = ['Kitchen', 'Service', 'Bar', 'Other'];
  function active() { return App.S.staff.filter(function (s) { return s.active; }).sort(function (a, b) { return (TEAMS.indexOf(a.team) - TEAMS.indexOf(b.team)) || a.name.localeCompare(b.name); }); }
  function datePicker(id, key) {
    return '<div class="row"><button class="btn ghost sm" id="' + id + 'p" aria-label="' + E(T('Day before')) + '">‹</button>' +
      '<input type="date" id="' + id + '" value="' + key + '" aria-label="' + E(T('Date')) + '"><button class="btn ghost sm" id="' + id + 'n" aria-label="' + E(T('Day after')) + '">›</button>' +
      (key !== M.today() ? '<button class="btn ghost sm" id="' + id + 't">' + E(T('Today')) + '</button>' : '') + '</div>';
  }
  function bindDate(main, id, set) {
    var i = main.querySelector('#' + id);
    i.onchange = function () { if (i.value) { set(i.value); App.reload(); } };
    main.querySelector('#' + id + 'p').onclick = function () { set(M.addDays(i.value, -1)); App.reload(); };
    main.querySelector('#' + id + 'n').onclick = function () { set(M.addDays(i.value, 1)); App.reload(); };
    var t = main.querySelector('#' + id + 't'); if (t) t.onclick = function () { set(M.today()); App.reload(); };
  }
  App.datePicker = datePicker; App.bindDate = bindDate;
  function shiftLabel(r) {
    if (!r) return '';
    if (r.kind === 'off') return T('OFF'); if (r.kind === 'leave') return T('LEAVE'); if (r.kind === 'sick') return T('SICK');
    return (r.start_t || '?') + '–' + (r.end_t || '?');
  }
  function shiftMin(r) { if (!r || r.kind !== 'work' || !r.start_t || !r.end_t) return 0; var a = M.timeToMin(r.start_t), b = M.timeToMin(r.end_t); if (b <= a) b += 1440; return b - a; }

  // ════════════════ SCHEDULE ════════════════
  var R = { ws: null };
  App.register('schedule', {
    title: 'Schedule', icon: 'rota', group: 'team', desc: 'The weekly rota for kitchen, service and bar.',
    stat: function (H) {
      var t = H.t, on = H.f.shifts.filter(function (r) { return r.date === t && r.kind === 'work'; }).length;
      return on ? [T('{n} working today', { n: on }), false] : [T('No rota for today'), true];
    },
    render: function (main) {
      if (!R.ws) R.ws = M.weekStart(M.today());
      var ws = R.ws;
      return Promise.all([App.fetch(['shifts', 'leave', 'settings'], ws, M.addDays(ws, 6)), App.refreshStaff()]).then(function (r) {
        var f = r[0]; if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var rota = {}; f.shifts.forEach(function (x) { rota[x.staff_id + '|' + x.date] = x; });
        var minK = +((f.settings.filter(function (s) { return s.key === 'kitchen_min'; })[0] || {}).value || 3);
        var people = active(), days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return M.addDays(ws, i); });
        var pending = f.leave.filter(function (l) { return l.status === 'pending'; });
        // presets = the shift times already used this week and last (no invented times)
        var presets = {}; f.shifts.forEach(function (x) { if (x.kind === 'work' && x.start_t && x.end_t) presets[x.start_t + '–' + x.end_t] = 1; });
        var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Rota · week of {d}', { d: M.shortDate(ws) })) + '</h2>' +
          '<div class="row">' + App.weekNav(ws, 'rw') + '<button class="btn ghost" id="copy">' + E(T('Copy last week into this week')) + '</button><button class="btn" id="rx">' + E(T('Excel')) + '</button></div></div>';
        if (!people.length) { main.innerHTML = h + App.empty(T('No people yet. Add the team in People.')) + '</section>'; App.bindWeekNav(main, 'rw', function () { return R.ws; }, function (v) { R.ws = v; }); return; }
        h += '<div class="box"><table class="rota"><thead><tr><th>' + E(T('Name')) + '</th>' + days.map(function (k, i) { return '<th style="text-align:center">' + E(M.day(i)) + ' ' + (+k.slice(8)) + '</th>'; }).join('') + '<th>' + E(T('Hours')) + '</th></tr></thead><tbody>';
        var lastTeam = null;
        people.forEach(function (s) {
          if (s.team !== lastTeam) { h += '<tr><td colspan="9" style="background:#FCFAF7;font-size:12px;letter-spacing:2px;font-weight:700;color:var(--muted)">' + E(T(s.team).toUpperCase()) + '</td></tr>'; lastTeam = s.team; }
          var tot = 0;
          h += '<tr><td class="nw"><b>' + E(s.name) + '</b></td>' + days.map(function (k) {
            var x = rota[s.id + '|' + k]; tot += shiftMin(x);
            var pend = pending.some(function (l) { return l.staff_id === s.id && l.date_from <= k && l.date_to >= k; });
            return '<td><button class="shift ' + (x ? x.kind : 'empty') + '" data-s="' + s.id + '" data-k="' + k + '">' + E(x ? shiftLabel(x) : '+') + '</button>' +
              (pend ? '<div class="tiny" style="color:var(--blue);font-weight:700">' + E(T('leave asked')) + '</div>' : '') + '</td>';
          }).join('') + '<td class="nw"><b>' + M.durShort(tot) + '</b></td></tr>';
        });
        h += '<tr><td class="nw small"><b>' + E(T('Kitchen on duty')) + '</b></td>' + days.map(function (k) {
          var n = people.filter(function (s) { var x = rota[s.id + '|' + k]; return s.team === 'Kitchen' && x && x.kind === 'work'; }).length;
          return '<td><span class="tag ' + (n < minK ? 'red' : 'green') + '">' + n + '</span></td>';
        }).join('') + '<td></td></tr></tbody></table></div>' +
          '<p class="small muted" style="margin:0">' + E(T('Tap a day to set the shift. Kitchen on duty turns red under {n} people (Milica\'s winter rule). Approved leave fills in by itself.', { n: minK })) + '</p></section>';
        main.innerHTML = h;
        App.bindWeekNav(main, 'rw', function () { return R.ws; }, function (v) { R.ws = v; });
        main.querySelector('#copy').onclick = function () {
          this.disabled = true;
          App.call('mare_m_rota_copy', { p_from: M.addDays(ws, -7), p_to: ws }).then(function (r) { if (r) { App.say(T('{n} shifts copied. Days already planned were left alone.', { n: r.copied })); App.reload(); } });
        };
        main.querySelector('#rx').onclick = function () {
          var btn = this; btn.disabled = true;
          App.xlsx(function () {
            var rows = [[T('Name'), T('Team')].concat(days.map(function (k, i) { return M.day(i) + ' ' + k; })).concat([T('Hours')])];
            people.forEach(function (s) { var tot = 0; rows.push([s.name, T(s.team)].concat(days.map(function (k) { var x = rota[s.id + '|' + k]; tot += shiftMin(x); return x ? shiftLabel(x) : ''; })).concat([M.durShort(tot)])); });
            var wb = XLSX.utils.book_new(), sh = XLSX.utils.aoa_to_sheet(rows); sh['!cols'] = rows[0].map(function (_, i) { return { wch: i === 0 ? 20 : 14 }; });
            XLSX.utils.book_append_sheet(wb, sh, T('Rota')); XLSX.writeFile(wb, 'Robertos-Mare-rota-' + ws + '.xlsx'); btn.disabled = false;
          }, btn);
        };
        App.on(main, '.shift', function (b) { editShift(b.getAttribute('data-s'), b.getAttribute('data-k'), rota, Object.keys(presets)); });
      });
    }
  });
  function editShift(sid, key, rota, presets) {
    var x = rota[sid + '|' + key] || { kind: 'work' };
    var o = App.overlay('<h3>' + E(App.staffName(sid)) + ' · ' + E(M.niceDate(key)) + '</h3>' +
      '<div class="row">' + ['work', 'off', 'leave', 'sick'].map(function (k) { return '<label class="row small" style="gap:6px"><input type="radio" name="kd" value="' + k + '"' + (x.kind === k ? ' checked' : '') + '> ' + E(T({ work: 'Working', off: 'Day off', leave: 'Leave', sick: 'Sick' }[k])) + '</label>'; }).join('') + '</div>' +
      '<div class="grid2"><label class="f">' + E(T('Start')) + '<input type="time" id="st" value="' + (x.start_t || '') + '"></label><label class="f">' + E(T('End')) + '<input type="time" id="en" value="' + (x.end_t || '') + '"></label></div>' +
      (presets.length ? '<div class="row">' + presets.map(function (p) { return '<button class="btn ghost sm" data-pre="' + p + '">' + p + '</button>'; }).join('') + '</div>' : '') +
      '<label class="f">' + E(T('Note')) + '<input type="text" id="nt" value="' + E(x.note || '') + '"></label>' +
      '<div class="row"><button class="btn" id="sv">' + E(T('Save')) + '</button>' + (rota[sid + '|' + key] ? '<button class="btn warn" id="cl">' + E(T('Clear the day')) + '</button>' : '') + '<button class="btn ghost" data-close>' + E(T('Cancel')) + '</button></div>');
    App.on(o, '[data-pre]', function (b) { var p = b.getAttribute('data-pre').split('–'); o.querySelector('#st').value = p[0]; o.querySelector('#en').value = p[1]; o.querySelector('input[value=work]').checked = true; });
    o.querySelector('#sv').onclick = function () {
      var kind = o.querySelector('input[name=kd]:checked').value, st = o.querySelector('#st').value, en = o.querySelector('#en').value;
      if (kind === 'work' && (!st || !en)) { App.say(T('Type the start and end.')); return; }
      this.disabled = true;
      App.save('mare_shifts', { staff_id: sid, date: key, kind: kind, start_t: kind === 'work' ? st : null, end_t: kind === 'work' ? en : null, note: o.querySelector('#nt').value.trim() || null })
        .then(function (r) { if (r) { o.close(); App.reload(); } });
    };
    var cl = o.querySelector('#cl'); if (cl) cl.onclick = function () { App.call('mare_m_shift_clear', { p_staff: sid, p_date: key }).then(function (r) { if (r) { o.close(); App.reload(); } }); };
  }

  // ════════════════ DAILY BRIEFING ════════════════
  var B = { d: null };
  var BF = [['covers_lunch', 'Covers booked · lunch', 'n'], ['covers_dinner', 'Covers booked · dinner', 'n'], ['message', 'Message of the day', 't'],
            ['specials', 'Specials', 't'], ['eighty_six', 'Not available today (86)', 't'], ['allergies', 'Allergies and dietary notes', 't'],
            ['vip', 'VIPs, groups and special bookings', 't'], ['kitchen_note', 'For the kitchen', 't'], ['foh_note', 'For the floor and bar', 't']];
  App.register('briefing', {
    title: 'Daily briefing', icon: 'brief', group: 'today', live: true, desc: 'One briefing for kitchen and floor together. Everyone taps "read".',
    stat: function (H) { var b = H.f.briefings.filter(function (x) { return x.date === H.t; })[0]; return b ? [T('{n} have read today\'s', { n: H.f.reads.filter(function (r) { return r.date === H.t; }).length }), false] : [T('Not written yet today'), true]; },
    render: function (main) {
      if (!B.d) B.d = M.today();
      var d = B.d;
      return Promise.all([App.fetch(['briefings', 'reads', 'shifts'], M.addDays(d, -1), d), App.refreshStaff(), M.rpc('mare_mgr_overview', { p_from: d, p_to: d }, App.S.token)]).then(function (r) {
        var f = r[0]; if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var b = f.briefings.filter(function (x) { return x.date === d; })[0] || {}, prev = f.briefings.filter(function (x) { return x.date === M.addDays(d, -1); })[0];
        var reads = f.reads.filter(function (x) { return x.date === d; });
        var ov = r[2].data || { punches: [] };
        var on = active().filter(function (s) {
          var x = f.shifts.filter(function (h) { return h.staff_id === s.id && h.date === d; })[0];
          return (x && x.kind === 'work') || ov.punches.some(function (p) { return p.staff_id === s.id && !p.voided && M.dateKey(p.at) === d; });
        });
        var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(M.niceDate(d)) + '</h2>' + datePicker('bd', d) + '</div>' +
          '<div class="card stack"><div class="grid2">' + BF.map(function (q) {
            return q[2] === 'n' ? '<label class="f">' + E(T(q[1])) + '<input type="text" inputmode="decimal" data-num="1" min="0" data-f="' + q[0] + '" value="' + (b[q[0]] != null ? b[q[0]] : '') + '"></label>'
              : '<label class="f" style="grid-column:1/-1">' + E(T(q[1])) + '<textarea data-f="' + q[0] + '">' + E(b[q[0]] || '') + '</textarea></label>';
          }).join('') + '</div><div class="row"><button class="btn" id="bs">' + E(T('Save the briefing')) + '</button>' +
          (prev && !b.date ? '<button class="btn ghost" id="bc">' + E(T('Start from yesterday\'s')) + '</button>' : '') +
          (b.updated_by ? '<span class="small muted">' + E(T('Last saved by {w} at {t}', { w: b.updated_by, t: M.hhmm(b.updated_at) })) + '</span>' : '') + '</div></div></section>';
        h += '<section class="stack"><h2 class="serif">' + E(T('Who has read it')) + '</h2><div class="card row">';
        var readIds = reads.map(function (x) { return x.staff_id; });
        h += on.length ? on.map(function (s) { var rd = reads.filter(function (x) { return x.staff_id === s.id; })[0];
          return '<span class="tag ' + (rd ? 'green' : 'amber') + '">' + E(s.name) + (rd ? ' ✓ ' + M.hhmm(rd.at) : ' · ' + E(T('not yet'))) + '</span>'; }).join(' ') : '<span class="muted">' + E(T('Nobody is on the rota or clocked in for this day yet.')) + '</span>';
        reads.filter(function (x) { return !on.some(function (s) { return s.id === x.staff_id; }); }).forEach(function (x) { h += ' <span class="tag green">' + E(App.staffName(x.staff_id)) + ' ✓ ' + M.hhmm(x.at) + '</span>'; });
        h += '</div><p class="small muted" style="margin:0">' + E(T('Staff read it on the tablet or their phone and tap "I have read it".')) + '</p></section>';
        void readIds;
        main.innerHTML = h;
        bindDate(main, 'bd', function (v) { B.d = v; });
        var bc = main.querySelector('#bc'); if (bc) bc.onclick = function () { BF.forEach(function (q) { var el = main.querySelector('[data-f=' + q[0] + ']'); if (q[2] !== 'n' && prev[q[0]]) el.value = prev[q[0]]; }); };
        main.querySelector('#bs').onclick = function () {
          var row = { date: d }; BF.forEach(function (q) { var v = main.querySelector('[data-f=' + q[0] + ']').value.trim(); row[q[0]] = q[2] === 'n' ? (v === '' ? null : Math.round(M.num(v))) : (v || null); });
          this.disabled = true; var btn = this;
          App.save('mare_briefings', row).then(function (r) { btn.disabled = false; if (r) { App.say(T('Briefing saved. The tablet and phones show it now.')); App.reload(); } });
        };
      });
    }
  });

  // ════════════════ CLOSING REPORT ════════════════
  var C = { d: null, tab: null };
  var CF = [['covers_lunch', 'Covers · lunch', 'n'], ['covers_dinner', 'Covers · dinner', 'n'], ['food', 'Food sales (€)', 'm'], ['beverage', 'Beverage sales (€)', 'm'],
            ['other', 'Other sales (€)', 'm'], ['card', 'Paid by card (€)', 'm'], ['cash', 'Paid in cash (€)', 'm'], ['tips', 'Tips (€)', 'm'],
            ['comps', 'Complimentary (€)', 'm'], ['discounts', 'Discounts (€)', 'm']];
  function salesOf(c) { return c ? (+c.food || 0) + (+c.beverage || 0) + (+c.other || 0) : 0; }
  App.register('closing', {
    title: 'Closing report', icon: 'closing', group: 'today', desc: 'Sales, covers, payments and notes for each day, and the month so far.',
    tabs: [['day', 'The day'], ['month', 'The month']],
    stat: function (H) { var y = M.addDays(H.t, -1), c = H.f.closing.filter(function (x) { return x.date === y; })[0]; return c ? [T('Yesterday {m}', { m: M.money(salesOf(c)) }), false] : [T('Yesterday not done'), true]; },
    render: function (main, sub) {
      if (!C.d) C.d = M.addDays(M.today(), M.parts(new Date()).hh < 17 ? -1 : 0);   // the report is usually done that night or the next morning
      if (sub === 'month') return closingMonth(main);
      var d = C.d;
      return App.fetch(['closing'], d, d).then(function (f) {
        if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var c = f.closing[0] || {};
        var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(M.niceDate(d)) + '</h2>' + datePicker('cd', d) + '</div>' +
          '<div class="card stack"><div class="grid4">' + CF.map(function (q) { return '<label class="f">' + E(T(q[1])) + '<input type="text" inputmode="decimal" data-num="1" step="' + (q[2] === 'n' ? '1' : '0.01') + '" min="0" data-f="' + q[0] + '" value="' + (c[q[0]] != null ? c[q[0]] : '') + '"></label>'; }).join('') + '</div>' +
          '<div class="kpis" id="ck"></div>' +
          '<div class="grid2"><label class="f">' + E(T('Weather')) + '<input type="text" data-f="weather" value="' + E(c.weather || '') + '"></label></div>' +
          '<label class="f">' + E(T('Incidents and complaints')) + '<textarea data-f="incidents">' + E(c.incidents || '') + '</textarea></label>' +
          '<label class="f">' + E(T('Notes')) + '<textarea data-f="notes">' + E(c.notes || '') + '</textarea></label>' +
          '<div class="row"><button class="btn" id="cs">' + E(T('Save the closing report')) + '</button>' +
          (c.updated_by ? '<span class="small muted">' + E(T('Last saved by {w} at {t}', { w: c.updated_by, t: M.hhmm(c.updated_at) })) + '</span>' : '') + '</div></div></section>';
        main.innerHTML = h;
        bindDate(main, 'cd', function (v) { C.d = v; });
        function v(k) { var el = main.querySelector('[data-f=' + k + ']'); return M.numSafe(el.value); }   // live totals while typing
        function vStrict(k) { return M.num(main.querySelector('[data-f=' + k + ']').value); }
        function kpis() {
          var sales = (v('food') || 0) + (v('beverage') || 0) + (v('other') || 0), cov = (v('covers_lunch') || 0) + (v('covers_dinner') || 0), paid = (v('card') || 0) + (v('cash') || 0);
          var diff = Math.round((paid - sales) * 100) / 100;
          main.querySelector('#ck').innerHTML =
            '<div class="kpi"><span>' + E(T('Total sales')) + '</span><b>' + M.money(sales) + '</b></div>' +
            '<div class="kpi"><span>' + E(T('Covers')) + '</span><b>' + cov + '</b></div>' +
            '<div class="kpi"><span>' + E(T('Average per cover')) + '</span><b>' + (cov ? M.money(sales / cov) : '—') + '</b></div>' +
            '<div class="kpi ' + (paid && Math.abs(diff) > 0.01 ? 'red' : '') + '"><span>' + E(T('Card + cash vs sales')) + '</span><b>' + (paid ? (diff === 0 ? T('Matches') : M.money(diff)) : '—') + '</b>' +
            (paid && diff !== 0 ? '<i>' + E(T('Card and cash do not add up to the sales.')) + '</i>' : '') + '</div>';
        }
        kpis(); App.on(main, 'input[type=number]', kpis, 'input');
        main.querySelector('#cs').onclick = function () {
          var row = { date: d }, btn = this;
          try { CF.forEach(function (q) { var x = vStrict(q[0]); row[q[0]] = x == null ? null : (q[2] === 'n' ? Math.round(x) : Math.round(x * 100) / 100); }); }
          catch (err) { M.toast(err.message); return; }
          ['weather', 'incidents', 'notes'].forEach(function (k) { row[k] = main.querySelector('[data-f=' + k + ']').value.trim() || null; });
          btn.disabled = true;
          App.save('mare_closing', row).then(function (r) { btn.disabled = false; if (r) { App.say(T('Closing report saved.')); App.reload(); } });
        };
      });
    }
  });
  function closingMonth(main) {
    var ms = M.monthStart(C.d), me = M.addDays(M.addMonths(ms, 1), -1);
    return App.fetch(['closing'], ms, me).then(function (f) {
      if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
      var rows = f.closing.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var tot = { s: 0, f: 0, b: 0, c: 0, tips: 0 }; rows.forEach(function (c) { tot.s += salesOf(c); tot.f += +c.food || 0; tot.b += +c.beverage || 0; tot.c += (+c.covers_lunch || 0) + (+c.covers_dinner || 0); tot.tips += +c.tips || 0; });
      var max = Math.max.apply(null, rows.map(salesOf).concat([1]));
      var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(M.monthName(ms)) + '</h2><div class="row">' +
        '<button class="btn ghost" id="mp">‹ ' + E(T('Earlier')) + '</button>' + (ms < M.monthStart(M.today()) ? '<button class="btn ghost" id="mn">' + E(T('Later')) + ' ›</button>' : '') +
        '<button class="btn" id="mx">' + E(T('Excel')) + '</button></div></div>' +
        '<div class="kpis"><div class="kpi"><span>' + E(T('Sales')) + '</span><b>' + M.money(tot.s) + '</b><i>' + E(T('{n} days reported', { n: rows.length })) + '</i></div>' +
        '<div class="kpi"><span>' + E(T('Food')) + '</span><b>' + M.money(tot.f) + '</b></div><div class="kpi"><span>' + E(T('Beverage')) + '</span><b>' + M.money(tot.b) + '</b></div>' +
        '<div class="kpi"><span>' + E(T('Covers')) + '</span><b>' + tot.c + '</b><i>' + E(T('Average {m}', { m: tot.c ? M.money(tot.s / tot.c) : '—' })) + '</i></div>' +
        '<div class="kpi"><span>' + E(T('Tips')) + '</span><b>' + M.money(tot.tips) + '</b></div></div>';
      if (!rows.length) h += App.empty(T('No closing reports this month yet.'));
      else {
        h += '<div class="card"><div class="bars" aria-hidden="true">' + rows.map(function (c) { return '<div title="' + E(c.date + ' ' + M.money(salesOf(c))) + '" style="height:' + Math.max(2, Math.round(salesOf(c) / max * 100)) + '%"></div>'; }).join('') + '</div></div>';
        h += '<div class="box"><table><thead><tr><th>' + E(T('Date')) + '</th><th class="num">' + E(T('Food')) + '</th><th class="num">' + E(T('Beverage')) + '</th><th class="num">' + E(T('Total')) + '</th><th class="num">' + E(T('Covers')) + '</th><th class="num">' + E(T('Average')) + '</th><th>' + E(T('Notes')) + '</th></tr></thead><tbody>' +
          rows.map(function (c) { var cv = (+c.covers_lunch || 0) + (+c.covers_dinner || 0), s = salesOf(c);
            return '<tr><td class="nw"><a href="#closing/day" data-d="' + c.date + '">' + E(M.shortDate(c.date)) + '</a></td><td class="num">' + M.money(+c.food || 0) + '</td><td class="num">' + M.money(+c.beverage || 0) + '</td><td class="num"><b>' + M.money(s) + '</b></td><td class="num">' + cv + '</td><td class="num">' + (cv ? M.money(s / cv) : '—') + '</td><td class="small">' + E([c.incidents, c.notes].filter(Boolean).join(' · ').slice(0, 120)) + '</td></tr>'; }).join('') +
          '</tbody></table></div>';
      }
      main.innerHTML = h + '</section>';
      main.querySelector('#mp').onclick = function () { C.d = M.addMonths(ms, -1); App.reload(); };
      var mn = main.querySelector('#mn'); if (mn) mn.onclick = function () { C.d = M.addMonths(ms, 1); App.reload(); };
      App.on(main, '[data-d]', function (a, e) { e.preventDefault(); C.d = a.getAttribute('data-d'); App.go('closing', 'day'); });
      main.querySelector('#mx').onclick = function () {
        var btn = this; btn.disabled = true;
        App.xlsx(function () {
          var aoa = [[T('Date')].concat(CF.map(function (q) { return T(q[1]); })).concat([T('Total sales'), T('Weather'), T('Incidents and complaints'), T('Notes')])];
          rows.forEach(function (c) { aoa.push([c.date].concat(CF.map(function (q) { return c[q[0]] != null ? +c[q[0]] : ''; })).concat([salesOf(c), c.weather || '', c.incidents || '', c.notes || ''])); });
          var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), T('Closing')); XLSX.writeFile(wb, 'Robertos-Mare-closing-' + ms.slice(0, 7) + '.xlsx'); btn.disabled = false;
        }, btn);
      };
    });
  }

  // ════════════════ CHECKLISTS ════════════════
  var K = { d: null };
  var LISTS = [['open_foh', 'Opening · floor & bar'], ['open_kitchen', 'Opening · kitchen'], ['close_foh', 'Closing · floor & bar'], ['close_kitchen', 'Closing · kitchen']];
  App.register('checklists', {
    title: 'Checklists', icon: 'check', group: 'today', live: true, desc: 'Opening and closing, ticked on the tablet by name, with photos.',
    tabs: [['today', 'The day'], ['edit', 'Edit the lists']],
    stat: function (H) {
      var items = H.f.check_items.filter(function (i) { return i.active && /^open/.test(i.list); }), done = H.f.ticks.filter(function (t) { return t.date === H.t && items.some(function (i) { return i.id === t.item_id; }); }).length;
      return [T('Opening {a} of {b} done', { a: done, b: items.length }), items.length > 0 && done < items.length && M.parts(new Date()).hh >= 12];
    },
    render: function (main, sub) {
      if (!K.d) K.d = M.today();
      var d = K.d;
      return App.fetch(['check_items', 'ticks', 'settings'], d, d).then(function (f) {
        if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var dl = (f.settings.filter(function (s) { return s.key === 'check_deadlines'; })[0] || {}).value || {};
        if (sub === 'edit') return checkEdit(main, f, dl);
        var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(M.niceDate(d)) + '</h2>' + datePicker('kd', d) + '</div><div class="cards">';
        LISTS.forEach(function (L) {
          var items = f.check_items.filter(function (i) { return i.active && i.list === L[0]; });
          var ticks = f.ticks.filter(function (t) { return items.some(function (i) { return i.id === t.item_id; }); });
          var last = ticks.map(function (t) { return t.at; }).sort().pop(), due = dl[L[0]];
          var allDone = items.length && ticks.length === items.length;
          var lateDone = allDone && due && M.hhmm(last) > due;
          h += '<div class="card stack"><div class="row between"><h3>' + E(T(L[1])) + '</h3><span class="tag ' + (allDone ? (lateDone ? 'amber' : 'green') : 'grey') + '">' + ticks.length + '/' + items.length +
            (allDone ? ' · ' + M.hhmm(last) : '') + '</span></div>' + (due ? '<div class="small muted">' + E(T('Done by {t}', { t: due })) + (lateDone ? ' · <b style="color:var(--amber)">' + E(T('finished late')) + '</b>' : '') + '</div>' : '') +
            '<div>' + (items.length ? items.map(function (i) {
              var t = ticks.filter(function (x) { return x.item_id === i.id; })[0];
              return '<div class="chk"><span class="dot ' + (t ? 'on' : '') + '">' + (t ? '✓' : '') + '</span><div style="flex:1"><div>' + E(M.lang() === 'me' && i.text_me ? i.text_me : i.text) + (i.needs_photo ? ' <span class="tag grey">' + E(T('PHOTO')) + '</span>' : '') + '</div>' +
                (t ? '<div class="small muted">' + E(App.staffName(t.staff_id)) + ' · ' + M.hhmm(t.at) + (t.has_photo ? ' · <a href="#" data-ph="' + t.id + '">' + E(T('see photo')) + '</a>' : '') + '</div>' : '') + '</div></div>';
            }).join('') : '<div class="muted">' + E(T('No items. Add them in Edit the lists.')) + '</div>') + '</div></div>';
        });
        main.innerHTML = h + '</div><p class="small muted" style="margin:0">' + E(T('Staff tick each line on the tablet with their name and code. Lines marked PHOTO take a picture.')) + '</p></section>';
        bindDate(main, 'kd', function (v) { K.d = v; });
        App.on(main, '[data-ph]', function (a, e) { e.preventDefault(); App.photo('mare_check_ticks', a.getAttribute('data-ph')).then(function (u) { App.overlay(u ? '<img src="' + u + '" alt="">' + '<button class="btn ghost" data-close>' + E(T('Close')) + '</button>' : '<div>' + E(T('No photo.')) + '</div><button class="btn ghost" data-close>' + E(T('Close')) + '</button>'); }); });
      });
    }
  });
  function checkEdit(main, f, dl) {
    var h = '<section class="stack">';
    LISTS.forEach(function (L) {
      var items = f.check_items.filter(function (i) { return i.list === L[0]; }).sort(function (a, b) { return a.sort - b.sort; });
      h += '<div class="card stack"><div class="row between"><h3>' + E(T(L[1])) + '</h3><label class="row small" style="gap:6px">' + E(T('Done by')) + ' <input type="time" data-dl="' + L[0] + '" value="' + (dl[L[0]] || '') + '"></label></div>' +
        '<div class="stack" data-list="' + L[0] + '" style="gap:8px">' + items.map(function (i) {
          return '<div class="row" data-id="' + i.id + '" style="border:1px solid var(--line-2);border-radius:12px;padding:8px;background:#fff;' + (i.active ? '' : 'opacity:.55') + '">' + App.grip +
            '<input type="text" class="i-en" value="' + E(i.text) + '" aria-label="English" style="flex:2 1 220px"><input type="text" class="i-me" value="' + E(i.text_me || '') + '" placeholder="Crnogorski" aria-label="Montenegrin" style="flex:2 1 220px">' +
            '<label class="row small" style="gap:4px"><input type="checkbox" class="i-ph"' + (i.needs_photo ? ' checked' : '') + '> ' + E(T('Photo')) + '</label>' +
            '<label class="row small" style="gap:4px"><input type="checkbox" class="i-on"' + (i.active ? ' checked' : '') + '> ' + E(T('In use')) + '</label>' +
            '<button class="btn ghost sm" data-isave="' + i.id + '">' + E(T('Save')) + '</button></div>';
        }).join('') + '</div><div class="row"><input type="text" data-new="' + L[0] + '" placeholder="' + E(T('New line')) + '" aria-label="' + E(T('New line')) + '" style="flex:1 1 240px"><button class="btn sm" data-add="' + L[0] + '">' + E(T('Add')) + '</button></div></div>';
    });
    main.innerHTML = h + '<p class="small muted" style="margin:0">' + E(T('Drag a line to change the order. Untick "In use" to take a line out without losing its history.')) + '</p></section>';
    App.on(main, '[data-isave]', function (b) {
      var r = b.closest('[data-id]'); b.disabled = true;
      App.save('mare_check_items', { id: b.getAttribute('data-isave'), text: r.querySelector('.i-en').value.trim(), text_me: r.querySelector('.i-me').value.trim() || null, needs_photo: r.querySelector('.i-ph').checked, active: r.querySelector('.i-on').checked })
        .then(function (x) { b.disabled = false; if (x) App.say(T('Saved.')); });
    });
    App.on(main, '[data-add]', function (b) {
      var L = b.getAttribute('data-add'), inp = main.querySelector('[data-new=' + L + ']'), t = inp.value.trim(); if (!t) return;
      var n = f.check_items.filter(function (i) { return i.list === L; }).length;
      b.disabled = true; App.save('mare_check_items', { list: L, text: t, sort: n + 1 }).then(function (x) { if (x) App.reload(); else b.disabled = false; });
    });
    App.on(main, '[data-dl]', function (inp) {
      var v = {}; Array.prototype.forEach.call(main.querySelectorAll('[data-dl]'), function (i) { v[i.getAttribute('data-dl')] = i.value || null; });
      App.save('mare_settings', { key: 'check_deadlines', value: v }).then(function (x) { if (x) App.say(T('Saved.')); });
    }, 'change');
    Array.prototype.forEach.call(main.querySelectorAll('[data-list]'), function (list) {
      App.sortable(list, function (ids) { Promise.all(ids.map(function (id, i) { return App.save('mare_check_items', { id: id, sort: i + 1 }); })).then(function () { App.say(T('Order saved.')); }); });
    });
  }

  // ════════════════ WEEKLY MEETINGS ════════════════
  var W = { open: null };
  App.register('meetings', {
    title: 'Weekly meetings', icon: 'meeting', group: 'team', desc: 'Notes from each meeting and who does what by when.',
    stat: function (H) { var open = H.f.actions.filter(function (a) { return !a.done; }), late = open.filter(function (a) { return a.due && a.due < H.t; }).length; return [T('{n} open actions', { n: open.length }) + (late ? ' · ' + T('{n} overdue', { n: late }) : ''), late > 0]; },
    render: function (main) {
      return App.fetch(['meetings', 'actions']).then(function (f) {
        if (!f) { main.innerHTML = App.empty(T('Could not load.')); return; }
        var t = M.today(), open = f.actions.filter(function (a) { return !a.done; });
        var h = '<section class="stack"><div class="row between"><h2 class="serif">' + E(T('Open actions')) + '</h2><button class="btn" id="nm">' + E(T('New meeting')) + '</button></div>';
        h += open.length ? '<div class="box"><table><tbody>' + open.map(function (a) { return actionRow(a, t, f); }).join('') + '</tbody></table></div>' : App.empty(T('No open actions.'));
        h += '</section><section class="stack"><h2 class="serif">' + E(T('Meetings')) + '</h2>';
        h += f.meetings.length ? '<div class="stack">' + f.meetings.map(function (m) {
          var acts = f.actions.filter(function (a) { return a.meeting_id === m.id; });
          return '<div class="card stack"><div class="row between"><div><b>' + E(m.title) + '</b> · <span class="muted">' + E(M.niceDate(m.date)) + '</span></div><button class="btn ghost sm" data-edit="' + m.id + '">' + E(W.open === m.id ? T('Close') : T('Open')) + '</button></div>' +
            (W.open === m.id ? meetingForm(m, acts, t, f) : '<div class="small muted">' + E((m.notes || '').slice(0, 160)) + (acts.length ? ' · ' + E(T('{n} actions', { n: acts.length })) : '') + '</div>') + '</div>';
        }).join('') + '</div>' : App.empty(T('No meetings written up yet.'));
        main.innerHTML = h + '</section>';
        main.querySelector('#nm').onclick = function () {
          this.disabled = true;
          App.save('mare_meetings', { date: t, title: T('Weekly meeting') }).then(function (r) { if (r) { W.open = r.id; App.reload(); } });
        };
        App.on(main, '[data-edit]', function (b) { var id = b.getAttribute('data-edit'); W.open = W.open === id ? null : id; App.reload(); });
        App.on(main, '[data-msave]', function (b) {
          var c = b.closest('.card'); b.disabled = true;
          App.save('mare_meetings', { id: b.getAttribute('data-msave'), date: c.querySelector('.m-date').value, title: c.querySelector('.m-title').value.trim() || T('Weekly meeting'), attendees: c.querySelector('.m-att').value.trim() || null, notes: c.querySelector('.m-notes').value.trim() || null })
            .then(function (r) { b.disabled = false; if (r) App.say(T('Saved.')); });
        });
        App.on(main, '[data-aadd]', function (b) {
          var c = b.closest('.card'), txt = c.querySelector('.a-text').value.trim(); if (!txt) { App.say(T('Write the action.')); return; }
          b.disabled = true;
          App.save('mare_actions', { meeting_id: b.getAttribute('data-aadd'), text: txt, owner: c.querySelector('.a-owner').value.trim() || null, due: c.querySelector('.a-due').value || null }).then(function (r) { if (r) App.reload(); else b.disabled = false; });
        });
        App.on(main, '[data-done]', function (b) {
          var done = b.getAttribute('data-v') !== '1'; b.disabled = true;
          App.save('mare_actions', { id: b.getAttribute('data-done'), done: done, done_at: done ? new Date().toISOString() : null }).then(function (r) { if (r) App.reload(); });
        });
      });
    }
  });
  function actionRow(a, t, f) {
    var m = f.meetings.filter(function (x) { return x.id === a.meeting_id; })[0];
    return '<tr><td><button class="dot ' + (a.done ? 'on' : '') + '" data-done="' + a.id + '" data-v="' + (a.done ? 1 : 0) + '" aria-label="' + E(a.done ? T('Mark not done') : T('Mark done')) + '" style="background:' + (a.done ? 'var(--teal)' : '#fff') + '">' + (a.done ? '✓' : '') + '</button></td>' +
      '<td style="' + (a.done ? 'text-decoration:line-through;color:var(--muted)' : '') + '">' + E(a.text) + (m ? '<div class="tiny muted">' + E(m.title) + ' · ' + E(M.shortDate(m.date)) + '</div>' : '') + '</td>' +
      '<td class="nw">' + E(a.owner || '—') + '</td><td class="nw">' + (a.due ? '<span class="tag ' + (!a.done && a.due < t ? 'red' : 'grey') + '">' + E(M.shortDate(a.due)) + '</span>' : '') + '</td></tr>';
  }
  function meetingForm(m, acts, t, f) {
    var names = App.S.staff.filter(function (s) { return s.active; }).map(function (s) { return s.name; });
    return '<div class="grid2"><label class="f">' + E(T('Date')) + '<input type="date" class="m-date" value="' + m.date + '"></label><label class="f">' + E(T('Title')) + '<input type="text" class="m-title" value="' + E(m.title) + '"></label></div>' +
      '<label class="f">' + E(T('Who was there')) + '<input type="text" class="m-att" value="' + E(m.attendees || '') + '"></label>' +
      '<label class="f">' + E(T('Notes')) + '<textarea class="m-notes" style="min-height:160px">' + E(m.notes || '') + '</textarea></label>' +
      '<button class="btn" data-msave="' + m.id + '" style="align-self:flex-start">' + E(T('Save the notes')) + '</button>' +
      '<h3>' + E(T('Actions')) + '</h3>' + (acts.length ? '<div class="box"><table><tbody>' + acts.map(function (a) { return actionRow(a, t, f); }).join('') + '</tbody></table></div>' : '') +
      '<div class="row"><input type="text" class="a-text" placeholder="' + E(T('What needs doing')) + '" aria-label="' + E(T('Action')) + '" style="flex:2 1 220px">' +
      '<input type="text" class="a-owner" list="ppl" placeholder="' + E(T('Who')) + '" aria-label="' + E(T('Who')) + '" style="flex:1 1 140px"><datalist id="ppl">' + names.map(function (n) { return '<option value="' + E(n) + '">'; }).join('') + '</datalist>' +
      '<input type="date" class="a-due" aria-label="' + E(T('By when')) + '"><button class="btn sm" data-aadd="' + m.id + '">' + E(T('Add')) + '</button></div>';
  }
})(window);
