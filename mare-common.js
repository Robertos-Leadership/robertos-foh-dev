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
    home: '<path d="M3 11l9-8 9 8M5 9v12h14V9"/>'
  };
  function icon(name, size) {
    return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  w.Mare = {
    TZ: TZ, SB_URL: SB_URL, SB_KEY: SB_KEY, T: T, setLang: setLang, lang: lang, langSwitch: langSwitch,
    parts: parts, pad: pad, hhmm: hhmm, dateKey: dateKey, today: today, dow: dow, addDays: addDays, daysBetween: daysBetween,
    weekStart: weekStart, monthStart: monthStart, addMonths: addMonths, day: day, niceDate: niceDate, shortDate: shortDate, monthName: monthName,
    toInstant: toInstant, mins: mins, dur: dur, durShort: durShort, timeToMin: timeToMin, shifts: shifts, lateness: lateness, GRACE_MIN: GRACE_MIN,
    rpc: rpc, kitchen: kitchen, esc: esc, safeJpeg: safeJpeg, safeImg: safeImg, money: money, num: num, numSafe: numSafe, parseNum: parseNum, toast: toast, pct: pct,
    photoFromFile: photoFromFile, icon: icon,
    // kept for old callers
    DAYS: DAYS.en
  };
})(window);
