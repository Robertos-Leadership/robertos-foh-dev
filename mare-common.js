/* Roberto's Mare — shared helpers for every Mare page (mare.html, mare-clock.html).
   Montenegro time, shift maths, language (English / Montenegrin), photos,
   money, icons, and the two databases (FOH project for Mare data, Kitchen
   project read-only for the Dubai recipe cards).
   Every time on screen is Europe/Podgorica, whatever the device is set to. */
(function (w) {
  var TZ = 'Europe/Podgorica';
  var SB_URL = 'https://paoaivwtkzujmrgrfjuq.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhb2Fpdnd0a3p1am1yZ3JmanVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzAxMzAsImV4cCI6MjA5NjY0NjEzMH0.VynG9PBeIaqRG2lkMEuzskkcB11EhR-UfO9eGYsaUxk';
  // Kitchen app (Dubai) — read-only, for the recipe cards.
  var K_URL = 'https://zrpglswalgjbtghudmhu.supabase.co';
  var K_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpycGdsc3dhbGdqYnRnaHVkbWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTIyMjQsImV4cCI6MjA5NjQ4ODIyNH0.pfABN-so4xINK7nHxXUlVeTO4g0h0l6ILHVwpoKrbds';
  var MAX_SHIFT_MS = 16 * 3600 * 1000;     // an IN with no OUT inside 16 h is a missing clock-out (same rule as the database)

  // ── language ──
  var LANG = 'en';
  try { LANG = localStorage.getItem('mare_lang') === 'me' ? 'me' : 'en'; } catch (e) {}
  function T(s, vars) {
    var d = (LANG === 'me' && w.MARE_ME && w.MARE_ME[s]) || s;
    if (vars) d = d.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] == null ? '' : vars[k]; });
    return d;
  }
  function setLang(l) { LANG = l === 'me' ? 'me' : 'en'; try { localStorage.setItem('mare_lang', LANG); } catch (e) {} }
  function lang() { return LANG; }
  function langSwitch() {
    return '<div class="lang" role="group" aria-label="Language / Jezik">' +
      '<button type="button" data-lang="en" class="' + (LANG === 'en' ? 'on' : '') + '" aria-pressed="' + (LANG === 'en') + '">EN</button>' +
      '<button type="button" data-lang="me" class="' + (LANG === 'me' ? 'on' : '') + '" aria-pressed="' + (LANG === 'me') + '">ME</button></div>';
  }

  var DAYS = { en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], me: ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'] };
  var DAYS_LONG = { en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
                    me: ['Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota', 'Nedjelja'] };
  var MONTHS = { en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
                 me: ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'] };

  var fmtParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  function parts(t) {
    var o = {};
    fmtParts.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, ss: +o.second };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(t) { var p = parts(t); return pad(p.hh) + ':' + pad(p.mm); }
  function dateKey(t) { var p = parts(t); return p.y + '-' + pad(p.m) + '-' + pad(p.d); }
  function today() { return dateKey(new Date()); }
  function dow(key) { var d = new Date(key + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }
  function addDays(key, n) { var d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }
  function weekStart(key) { return addDays(key, 1 - dow(key)); }
  function monthStart(key) { return key.slice(0, 8) + '01'; }
  function addMonths(key, n) { var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n; var d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 10); }
  function day(i) { return DAYS[LANG][i]; }
  var DOT = function () { return LANG === 'me' ? '. ' : ' '; };   // "6. oktobar" / "6 October"
  function niceDate(key) { var d = new Date(key + 'T12:00:00Z'); return DAYS_LONG[LANG][dow(key) - 1] + ' ' + d.getUTCDate() + DOT() + MONTHS[LANG][d.getUTCMonth()]; }
  function shortDate(key) { var d = new Date(key + 'T12:00:00Z'); return DAYS[LANG][dow(key) - 1] + ' ' + d.getUTCDate() + DOT() + MONTHS[LANG][d.getUTCMonth()].slice(0, 3); }
  function monthName(key) { var d = new Date(key + 'T12:00:00Z'); var n = MONTHS[LANG][d.getUTCMonth()]; return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + d.getUTCFullYear(); }
  function toInstant(key, time) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7), d = +key.slice(8, 10), h = +time.slice(0, 2), mi = +time.slice(3, 5);
    var guess = Date.UTC(y, m - 1, d, h, mi);
    for (var i = 0; i < 2; i++) { var p = parts(guess); guess -= Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Date.UTC(y, m - 1, d, h, mi); }
    return new Date(guess);
  }
  function mins(a, b) { return Math.floor((new Date(b) - new Date(a)) / 60000); }   // whole minutes worked, same as the database
  function dur(min) { if (min == null) return '—'; var neg = min < 0; min = Math.abs(min); return (neg ? '−' : '') + Math.floor(min / 60) + ' h ' + pad(min % 60) + ' m'; }
  function durShort(min) { if (min == null) return '—'; var neg = min < 0; min = Math.abs(min); return (neg ? '−' : '') + Math.floor(min / 60) + ':' + pad(min % 60); }
  function timeToMin(t) { return t ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : null; }

  // Punches (one person) → shifts, each belonging to the Montenegro date of its IN.
  function shifts(punches, now) {
    var ps = punches.filter(function (p) { return !p.voided; }).slice().sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    var out = [], open = null, nowT = now ? new Date(now).getTime() : Date.now();
    ps.forEach(function (p) {
      var t = new Date(p.at).getTime();
      if (p.dir === 'in') { if (open) { open.missing = true; out.push(open); } open = { date: dateKey(p.at), inP: p, outP: null, min: null }; }
      else if (open && t - new Date(open.inP.at).getTime() < MAX_SHIFT_MS) { open.outP = p; open.min = mins(open.inP.at, p.at); out.push(open); open = null; }
      else { if (open) { open.missing = true; out.push(open); open = null; } out.push({ date: dateKey(p.at), inP: null, outP: p, min: null, orphan: true }); }
    });
    if (open) { if (nowT - new Date(open.inP.at).getTime() >= MAX_SHIFT_MS) open.missing = true; else { open.live = true; open.min = mins(open.inP.at, nowT); } out.push(open); }
    return out;
  }
  // Lateness: the first IN of that date against the rota start (or the usual start).
  var GRACE_MIN = 5;
  function lateness(dayShifts, startTimes, key, rota) {
    var start = null;
    if (rota) { if (rota.kind !== 'work') return { due: null, late: 0, off: rota.kind }; start = rota.start_t; }
    else start = startTimes && startTimes[String(dow(key))];
    if (!start) return { due: null, late: 0 };
    var firstIn = dayShifts.filter(function (s) { return s.inP; }).sort(function (a, b) { return new Date(a.inP.at) - new Date(b.inP.at); })[0];
    if (!firstIn) return { due: start, late: 0, absent: true };
    var arr = parts(firstIn.inP.at), diff = arr.hh * 60 + arr.mm - timeToMin(start);
    return { due: start, late: diff > GRACE_MIN ? diff : 0, inAt: firstIn.inP.at };
  }

  // Clock-ins on the rota, the way the Dubai schedule shows them: per person per day,
  // what the clock actually says next to what was planned. punches = everyone's, each
  // with staff_id. Returns { 'staffId|date': { segs:[{in,out}], live, missing } }.
  function actualByDay(punches, now) {
    var by = {}, grp = {};
    (punches || []).forEach(function (p) { (grp[p.staff_id] = grp[p.staff_id] || []).push(p); });
    Object.keys(grp).forEach(function (sid) {
      shifts(grp[sid], now).forEach(function (x) {
        var k = sid + '|' + x.date, a = by[k] || (by[k] = { segs: [], live: false, missing: false });
        a.segs.push({ in: x.inP ? hhmm(x.inP.at) : null, out: x.outP ? hhmm(x.outP.at) : null });
        if (x.live) a.live = true; if (x.missing || x.orphan) a.missing = true;
      });
    });
    return by;
  }
  // The line under a rota cell: "IN 09:51 · working", "09:51–18:06", "No clock-in".
  // Absent only for planned work on a past day, or today once 15 min past the start.
  function actualHtml(a, rota, key, now) {
    if (a) {
      var t = a.segs.map(function (g) { return (g.in || '?') + (g.out ? '–' + g.out : ''); }).join(' · ');
      var last = a.segs[a.segs.length - 1];
      var tail = a.live ? ' · ' + T('working') : !last.out ? ' · ' + T('no clock-out') : !last.in ? ' · ' + T('no clock-in') : '';
      var cls = a.live ? 'live' : a.missing ? 'warn' : 'done';
      return '<div class="rota-act ' + cls + '">' + (a.live ? T('IN') + ' ' : '') + esc(t + tail) + '</div>';
    }
    if (!rota || rota.kind !== 'work' || !rota.start_t) return '';
    var td = dateKey(now || new Date());
    if (key > td) return '';
    if (key === td) { var p = parts(now || new Date()); if (p.hh * 60 + p.mm < timeToMin(rota.start_t) + 15) return ''; }
    return '<div class="rota-act warn">' + esc(T('No clock-in')) + '</div>';
  }

  // ── network ──
  function post(base, key, name, args, token) {
    return fetch(base + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: { 'apikey': key, 'Authorization': 'Bearer ' + (token || key), 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      return r.json().then(function (j) { return r.ok ? { data: j } : { error: { status: r.status, message: (j && j.message) || ('HTTP ' + r.status) } }; },
                            function () { return { error: { status: r.status, message: 'HTTP ' + r.status } }; });
    }, function () { return { error: { network: true, message: 'No internet' } }; });
  }
  function rpc(name, args, token) { return post(SB_URL, SB_KEY, name, args, token); }
  function kitchen(path) {
    return fetch(K_URL + '/rest/v1/' + path, { headers: { 'apikey': K_KEY, 'Authorization': 'Bearer ' + K_KEY } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); });
  }

  // The Dubai recipe book as Mare sees it: only the dishes the Dubai chef ticked "Mare"
  // on (recipes.show_mare), under Dubai's own sections, in the order of the running
  // A la carte menu (menus.fold_order, keys "s:<section>"). Unknown sections go last.
  function dubaiBook() {
    return Promise.all([
      kitchen('recipes?select=id,name,section&archived=is.false&kind=eq.main&show_mare=is.true&order=name'),
      kitchen('menus?select=name,fold_order&running=is.true&archived=is.false&parent_id=is.null').catch(function () { return []; })
    ]).then(function (r) {
      var order = [];
      r[1].sort(function (a, b) { return (/a la carte/i.test(b.name) ? 1 : 0) - (/a la carte/i.test(a.name) ? 1 : 0); })
        .forEach(function (m) { (m.fold_order || []).forEach(function (k) { var s = /^s:/.test(k) ? k.slice(2).toLowerCase() : null; if (s && order.indexOf(s) < 0) order.push(s); }); });
      var groups = {}, names = [];
      r[0].forEach(function (d) { var s = (d.section || '').trim() || 'Other'; if (!groups[s]) { groups[s] = []; names.push(s); } groups[s].push(d); });
      names.sort(function (a, b) { var i = order.indexOf(a.toLowerCase()), j = order.indexOf(b.toLowerCase()); if (i < 0) i = 999; if (j < 0) j = 999; return i - j || a.localeCompare(b); });
      return names.map(function (s) { return { section: s, dishes: groups[s] }; });
    });
  }
  // The ingredient lines of one Dubai card, in order. A line that links a sub-recipe
  // (child_recipe_id) is named after THAT recipe: typed_text is only what the chef typed
  // to find it, so "capo" showed where Caponata was meant (Mare feedback, 6 Oct 2026).
  // Stock lines use the stock name. Both carry their quantity; a free-typed line already
  // has it in its text.
  function dubaiLines(id) {
    return kitchen('recipe_lines?select=position,typed_text,stock_name,qty,unit,child_recipe_id,note&recipe_id=eq.' + encodeURIComponent(id) + '&order=position').then(function (ls) {
      var ids = ls.map(function (l) { return l.child_recipe_id; }).filter(Boolean);
      return (ids.length ? kitchen('recipes?select=id,name&id=in.(' + ids.map(encodeURIComponent).join(',') + ')').catch(function () { return []; }) : Promise.resolve([])).then(function (rs) {
        var by = {}; rs.forEach(function (r) { by[r.id] = r.name; });
        return ls.map(function (l) {
          var sub = l.child_recipe_id ? by[l.child_recipe_id] : null, named = sub || l.stock_name;
          return { qty: named && l.qty != null ? (l.qty + ' ' + (l.unit || '')).trim() : '', name: named || l.typed_text || '', note: l.note || '', sub: !!sub, subId: sub ? l.child_recipe_id : null };
        });
      });
    });
  }
  // One Dubai card. A dish must be ticked "Mare" (show_mare); a batch recipe is opened
  // from a line of a dish that is, so the chef ticks the dish once and its batches come
  // with it (Francesco, 8 Oct 2026: "no batch recipes, how can they read and cook").
  function dubaiRecipe(id, isBatch) {
    return kitchen('recipes?select=id,name,kind,section,makes_qty,makes_unit,allergens,method,photos,notes' + (isBatch ? '' : '&show_mare=is.true') + '&id=eq.' + encodeURIComponent(id))
      .then(function (r) { if (!r[0]) throw new Error('hidden'); return r[0]; });
  }
  // The ingredient list. A batch line is a button (data-b = its recipe id) that opens it.
  function dubaiLinesHtml(lines) {
    return '<ul class="dlines">' + lines.map(function (l) {
      var t = (l.qty ? '<b>' + esc(l.qty) + '</b> ' : '') + esc(l.name) + (l.note ? ' <span class="muted">(' + esc(l.note) + ')</span>' : '');
      return '<li>' + (l.subId ? '<button class="sublink" data-b="' + esc(l.subId) + '"><span>' + t + '</span><em>' + esc(T('Batch recipe')) + ' ›</em></button>' : t) + '</li>';
    }).join('') + '</ul>';
  }
  function dubaiBookHtml(book, q) {
    q = (q || '').toLowerCase().trim(); var n = 0;
    var h = book.map(function (g) {
      var ds = g.dishes.filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) >= 0 || g.section.toLowerCase().indexOf(q) >= 0; });
      n += ds.length; if (!ds.length) return '';
      return '<div class="dsec"><div class="sec"><span>' + esc(g.section) + '</span><i></i><em>' + ds.length + '</em></div><div class="rlist">' +
        ds.map(function (d) { return '<button class="rcard" data-k="' + d.id + '"><div class="tx"><b>' + esc(d.name) + '</b></div></button>'; }).join('') + '</div></div>';
    }).join('');
    return { html: h, n: n };
  }

  // ── bits ──
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeJpeg(u) { return (typeof u === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(u)) ? u : null; }
  function safeImg(u) { return (typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(u)) ? u : null; }
  function money(n) {
    if (n == null || isNaN(n)) return '—';
    return new Intl.NumberFormat(LANG === 'me' ? 'de-DE' : 'en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);
  }
  // Numbers typed by people: "120,40" and "120.40" both mean 120.4. A separator
  // followed by exactly three digits ("1.800", "1,800") could be a thousands sign,
  // so it is REFUSED with a question rather than guessed (1.8 or 1800 would both be
  // wrong half the time). The app may say "not saved", never store a wrong number.
  function parseNum(v) {
    var s = String(v == null ? '' : v).trim().replace(/[\s€]/g, '');
    if (!s) return { v: null };
    if (/[.,].*[.,]/.test(s)) return { err: T('Use only one decimal sign, e.g. 1800 or 1800,50.') };
    var m = s.match(/^(-?\d+)(?:[.,](\d+))?$/);
    if (!m) return { err: T('“{s}” is not a number.', { s: s }) };
    if (m[2] && m[2].length === 3 && !/^-?0$/.test(m[1])) return { err: T('Is it {a} or {b}? Type it without a thousands sign.', { a: m[1] + m[2], b: m[1] + (m[2].replace(/0+$/, '') ? ',' + m[2].replace(/0+$/, '') : '') }) };
    return { v: parseFloat(m[1] + (m[2] ? '.' + m[2] : '')) };
  }
  // num(): the value, null when empty, and it THROWS on a doubtful number so the
  // save that called it stops (the field has already been marked and explained).
  // Whole euros, for the big figures (the exact cents are in the reports).
  function money0(n) { if (n == null || isNaN(n)) return '—'; return new Intl.NumberFormat(LANG === 'me' ? 'de-DE' : 'en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n); }
  function num(v) { var r = parseNum(v); if (r.err) throw new Error(r.err); return r.v; }
  function numSafe(v) { var r = parseNum(v); return r.err ? null : r.v; }
  function toast(t) {
    var d = document.getElementById('mare-toast');
    if (!d) { d = document.createElement('div'); d.id = 'mare-toast'; d.setAttribute('role', 'alert'); d.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#9B1C1C;color:#fff;border-radius:14px;padding:12px 18px;font-weight:700;z-index:70;max-width:92vw;text-align:center;font-family:Karla,sans-serif'; document.body.appendChild(d); }
    d.textContent = t; d.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { d.style.display = 'none'; }, 5000);
  }
  // Every [data-num] field is checked the moment it is left.
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el.matches || !el.matches('[data-num]')) return;
    var r = parseNum(el.value);
    el.style.borderColor = r.err ? '#9B1C1C' : ''; el.style.boxShadow = r.err ? '0 0 0 2px #FDECEC' : '';
    if (r.err) toast(r.err);
  }, true);
  w.addEventListener('error', function (e) { if (e && e.message && /thousands sign|decimal sign|is not a number/.test(e.message)) e.preventDefault(); });
  w.addEventListener('unhandledrejection', function (e) { var m = e.reason && e.reason.message; if (m && /thousands sign|decimal sign|is not a number/.test(m)) { e.preventDefault(); toast(m); } });
  function pct(a, b) { return (a == null || !b) ? null : Math.round(a / b * 1000) / 10; }
  // A picked or taken photo → small JPEG data URL.
  function photoFromFile(file, max) {
    max = max || 1024;
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          var s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
          c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.72));
        };
        im.onerror = rej; im.src = fr.result;
      };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }

  // ── photo zoom (Andrea, 8 Oct 2026): tap a dish photo and it opens full screen.
  // Pinch, double-tap, the mouse wheel or + / − zoom in; drag to look at one part
  // of the plate. One viewer for every Mare screen, team and management alike.
  var ZOOM_CSS = 'img.photo,img.recipe-photo{cursor:zoom-in}' +
    '.mz{position:fixed;inset:0;z-index:1000;background:rgba(6,20,22,.94);overscroll-behavior:contain}' +
    '.mz-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;cursor:zoom-in}' +
    '.mz.on .mz-stage{cursor:grab}' +
    '.mz-stage img{max-width:100%;max-height:100%;width:auto;height:auto;border-radius:0;box-shadow:none;object-fit:contain;transform-origin:50% 50%;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;will-change:transform}' +
    '.mz-bar{position:absolute;top:max(12px,env(safe-area-inset-top));right:12px;display:flex;gap:8px}' +
    '.mz-bar button{min-width:48px;height:48px;padding:0 16px;border:0;border-radius:24px;background:#fff;color:#0B2E33;font:600 17px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35)}' +
    '.mz-bar button[data-z="+"],.mz-bar button[data-z="-"]{font-size:26px;padding:0}' +
    '.mz-hint{position:absolute;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%);background:rgba(0,0,0,.6);color:#fff;font:500 15px/1.3 system-ui,sans-serif;padding:10px 16px;border-radius:20px;pointer-events:none;transition:opacity .6s;text-align:center;max-width:calc(100% - 32px)}';
  function zoomCss() {
    if (document.getElementById('mz-css')) return;
    var st = document.createElement('style'); st.id = 'mz-css'; st.textContent = ZOOM_CSS; (document.head || document.documentElement).appendChild(st);
  }
  function zoomPhoto(src) {
    if (!src) return;
    zoomCss();
    var v = document.createElement('div'); v.className = 'mz'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true'); v.setAttribute('aria-label', T('Photo'));
    v.innerHTML = '<div class="mz-stage"><img alt="" draggable="false"></div>' +
      '<div class="mz-bar"><button type="button" data-z="-" aria-label="' + esc(T('Zoom out')) + '">−</button><button type="button" data-z="+" aria-label="' + esc(T('Zoom in')) + '">+</button><button type="button" data-z="x">' + esc(T('Close')) + '</button></div>' +
      '<div class="mz-hint">' + esc(T('Pinch or double-tap to zoom. Drag to look closer.')) + '</div>';
    var stage = v.querySelector('.mz-stage'), im = stage.querySelector('img'), bar = v.querySelector('.mz-bar'), hint = v.querySelector('.mz-hint');
    im.src = src;
    var s = 1, tx = 0, ty = 0, MAX = 6;
    var pts = {}, pinch = null, pan = null, moved = false, lastTap = 0, lastX = 0, lastY = 0;
    var bodyOv = document.body.style.overflow; document.body.style.overflow = 'hidden';
    function clamp() {
      if (s <= 1.001) { s = 1; tx = 0; ty = 0; return; }
      var mx = Math.max(0, (im.offsetWidth * s - stage.clientWidth) / 2), my = Math.max(0, (im.offsetHeight * s - stage.clientHeight) / 2);
      tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
    }
    function draw() { clamp(); im.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')'; v.classList.toggle('on', s > 1); }
    function centre() { var r = stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    // Keep the point under the finger (or cursor) still while the scale changes.
    function zoomAt(px, py, ns) {
      ns = Math.max(1, Math.min(MAX, ns)); var c = centre();
      tx = px - c.x - (px - c.x - tx) * ns / s; ty = py - c.y - (py - c.y - ty) * ns / s; s = ns; draw();
    }
    function close() {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = bodyOv; v.remove();
    }
    function onKey(e) {
      var c = centre();
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === '+' || e.key === '=') zoomAt(c.x, c.y, s * 1.6);
      else if (e.key === '-') zoomAt(c.x, c.y, s / 1.6);
    }
    function list() { return Object.keys(pts).map(function (k) { return pts[k]; }); }
    stage.addEventListener('pointerdown', function (e) {
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }; var p = list();
      if (p.length === 1) { moved = false; pinch = null; pan = { x: e.clientX, y: e.clientY, tx: tx, ty: ty }; }
      else if (p.length === 2) {
        moved = true; pan = null;
        pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2, s: s, tx: tx, ty: ty };
      }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }; var p = list();
      if (pinch && p.length >= 2) {
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2, c = centre();
        var ns = Math.max(1, Math.min(MAX, pinch.s * d / pinch.d));
        s = ns; tx = mx - c.x - (pinch.mx - c.x - pinch.tx) * ns / pinch.s; ty = my - c.y - (pinch.my - c.y - pinch.ty) * ns / pinch.s; draw();
      } else if (pan) {
        var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        if (s > 1) { tx = pan.tx + dx; ty = pan.ty + dy; draw(); }
      }
    });
    function up(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId]; var p = list();
      if (p.length === 1) { pinch = null; pan = { x: p[0].x, y: p[0].y, tx: tx, ty: ty }; return; }
      if (p.length) return;
      pan = null; pinch = null;
      if (moved || e.type === 'pointercancel') return;
      var now = Date.now();
      if (now - lastTap < 320 && Math.abs(e.clientX - lastX) < 30 && Math.abs(e.clientY - lastY) < 30) {
        lastTap = 0; if (s > 1) { s = 1; draw(); } else zoomAt(e.clientX, e.clientY, 2.5); return;
      }
      lastTap = now; lastX = e.clientX; lastY = e.clientY;
      // One tap beside the photo, while not zoomed in, closes it.
      if (e.target !== im && s === 1) { var t0 = now; setTimeout(function () { if (lastTap === t0) close(); }, 330); }
    }
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.clientX, e.clientY, s * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-z]'); if (!b) return; var z = b.getAttribute('data-z'), c = centre();
      if (z === 'x') close(); else zoomAt(c.x, c.y, z === '+' ? s * 1.6 : s / 1.6);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(v);
    setTimeout(function () { hint.style.opacity = '0'; }, 3000);
    bar.querySelector('[data-z="x"]').focus();
    return v;
  }
  zoomCss();
  document.addEventListener('click', function (e) {
    var im = e.target.closest && e.target.closest('img.photo, img.recipe-photo');
    if (!im || !(im.currentSrc || im.src)) return;
    e.preventDefault(); zoomPhoto(im.currentSrc || im.src);
  });

  var ICONS = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    rota: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h3M7 17h3M14 13h3"/>',
    brief: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    closing: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    check: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l2 2 4-4M8 15h8"/>',
    recipe: '<path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2z"/><path d="M6 17a2 2 0 0 1 2-2h11M10 7h6M10 10h4"/>',
    costing: '<path d="M17 6.5A6 6 0 1 0 17 17.5"/><path d="M4 10.5h9M4 13.5h9"/>',
    stock: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
    leave: '<path d="M2 18h20M5 18c0-5 3-9 7-9s7 4 7 9M12 9V4M9 6l3-2 3 2"/>',
    speak: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h.01M12 11h.01M15 11h.01"/>',
    meeting: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5M12 20c0-3 3-5 6-5 1.5 0 3 .5 4 1.5"/>',
    people: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    tablet: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>',
    breakage: '<path d="M8 3h8l-1 7a3 3 0 0 1-6 0z"/><path d="M12 13v8M9 21h6M10 6l2 2-1 2"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    hours: '<path d="M5 3h14M5 21h14M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9"/>',
    home: '<path d="M3 11l9-8 9 8M5 9v12h14V9"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
  };
  function icon(name, size) {
    return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  w.Mare = {
    TZ: TZ, SB_URL: SB_URL, SB_KEY: SB_KEY, T: T, setLang: setLang, lang: lang, langSwitch: langSwitch,
    parts: parts, pad: pad, hhmm: hhmm, dateKey: dateKey, today: today, dow: dow, addDays: addDays, daysBetween: daysBetween,
    weekStart: weekStart, monthStart: monthStart, addMonths: addMonths, day: day, niceDate: niceDate, shortDate: shortDate, monthName: monthName,
    toInstant: toInstant, mins: mins, dur: dur, durShort: durShort, timeToMin: timeToMin, shifts: shifts, lateness: lateness, actualByDay: actualByDay, actualHtml: actualHtml, GRACE_MIN: GRACE_MIN,
    rpc: rpc, kitchen: kitchen, dubaiBook: dubaiBook, dubaiLines: dubaiLines, dubaiRecipe: dubaiRecipe, dubaiLinesHtml: dubaiLinesHtml, dubaiBookHtml: dubaiBookHtml, esc: esc, safeJpeg: safeJpeg, safeImg: safeImg, money: money, money0: money0, num: num, numSafe: numSafe, parseNum: parseNum, toast: toast, pct: pct,
    photoFromFile: photoFromFile, zoomPhoto: zoomPhoto, icon: icon,
    // kept for old callers
    DAYS: DAYS.en
  };
})(window);
