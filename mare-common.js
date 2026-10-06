/* Roberto's Mare — clock-in shared helpers (mare-clock.html + mare.html).
   Pure maths: Montenegro time, pairing IN/OUT into shifts, weeks, hours.
   Every time on screen is Europe/Podgorica, whatever the device is set to. */
(function (w) {
  var TZ = 'Europe/Podgorica';
  var SB_URL = 'https://paoaivwtkzujmrgrfjuq.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhb2Fpdnd0a3p1am1yZ3JmanVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzAxMzAsImV4cCI6MjA5NjY0NjEzMH0.VynG9PBeIaqRG2lkMEuzskkcB11EhR-UfO9eGYsaUxk';
  var MAX_SHIFT_MS = 20 * 3600 * 1000;     // an IN with no OUT inside 20 h is a missing clock-out
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var fmtParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  // {y,m,d,hh,mm,ss} of an instant, in Montenegro
  function parts(t) {
    var o = {};
    fmtParts.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, ss: +o.second };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(t) { var p = parts(t); return pad(p.hh) + ':' + pad(p.mm); }
  function dateKey(t) { var p = parts(t); return p.y + '-' + pad(p.m) + '-' + pad(p.d); }
  // ISO weekday 1..7 of a YYYY-MM-DD
  function dow(key) { var d = new Date(key + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }
  function addDays(key, n) {
    var d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekStart(key) { return addDays(key, 1 - dow(key)); }
  function niceDate(key) {
    var d = new Date(key + 'T12:00:00Z');
    return DAYS_LONG[dow(key) - 1] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }
  function shortDate(key) {
    var d = new Date(key + 'T12:00:00Z');
    return DAYS[dow(key) - 1] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3);
  }
  // Montenegro wall-clock "YYYY-MM-DD" + "HH:MM" → the real instant (Date)
  function toInstant(key, time) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7), d = +key.slice(8, 10);
    var h = +time.slice(0, 2), mi = +time.slice(3, 5);
    var guess = Date.UTC(y, m - 1, d, h, mi);
    for (var i = 0; i < 2; i++) {
      var p = parts(guess);
      var shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
      guess = guess - (shown - Date.UTC(y, m - 1, d, h, mi));
    }
    return new Date(guess);
  }
  function mins(a, b) { return Math.floor((new Date(b) - new Date(a)) / 60000); }   // whole minutes worked, same as the database
  function dur(min) {
    if (min == null) return '—';
    var neg = min < 0; min = Math.abs(min);
    return (neg ? '−' : '') + Math.floor(min / 60) + ' h ' + pad(min % 60) + ' m';
  }
  function durShort(min) {
    if (min == null) return '—';
    var neg = min < 0; min = Math.abs(min);
    return (neg ? '−' : '') + Math.floor(min / 60) + ':' + pad(min % 60);
  }
  function timeToMin(t) { return t ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : null; }

  // Punches (one person, any order) → shifts. Each shift belongs to the
  // Montenegro date of its IN. A shift with no OUT is "open" (still in, if
  // recent) or "missing" (older than 20 h). An OUT with no IN is an orphan.
  function shifts(punches, now) {
    var ps = punches.filter(function (p) { return !p.voided; })
      .slice().sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    var out = [], open = null, nowT = now ? new Date(now).getTime() : Date.now();
    ps.forEach(function (p) {
      var t = new Date(p.at).getTime();
      if (p.dir === 'in') {
        if (open) { open.missing = true; out.push(open); }
        open = { date: dateKey(p.at), inP: p, outP: null, min: null };
      } else {
        if (open && t - new Date(open.inP.at).getTime() < MAX_SHIFT_MS) {
          open.outP = p; open.min = mins(open.inP.at, p.at); out.push(open); open = null;
        } else {
          if (open) { open.missing = true; out.push(open); open = null; }
          out.push({ date: dateKey(p.at), inP: null, outP: p, min: null, orphan: true });
        }
      }
    });
    if (open) {
      if (nowT - new Date(open.inP.at).getTime() >= MAX_SHIFT_MS) open.missing = true;
      else { open.live = true; open.min = mins(open.inP.at, nowT); }
      out.push(open);
    }
    return out;
  }

  // Lateness of one day: the first IN of that date against the usual start.
  var GRACE_MIN = 5;
  function lateness(dayShifts, startTimes, key) {
    var start = startTimes && startTimes[String(dow(key))];
    if (!start) return { due: null, late: 0 };
    var firstIn = dayShifts.filter(function (s) { return s.inP; })
      .sort(function (a, b) { return new Date(a.inP.at) - new Date(b.inP.at); })[0];
    if (!firstIn) return { due: start, late: 0, absent: true };
    var arrived = parts(firstIn.inP.at), arrMin = arrived.hh * 60 + arrived.mm;
    var diff = arrMin - timeToMin(start);
    return { due: start, late: diff > GRACE_MIN ? diff : 0, inAt: firstIn.inP.at };
  }

  // Thin PostgREST RPC call. Resolves {data} or {error:{network:true}|{status,message}}.
  function rpc(name, args, token) {
    return fetch(SB_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + (token || SB_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      return r.json().then(function (j) {
        return r.ok ? { data: j } : { error: { status: r.status, message: (j && j.message) || ('HTTP ' + r.status) } };
      }, function () { return { error: { status: r.status, message: 'HTTP ' + r.status } }; });
    }, function () { return { error: { network: true, message: 'No internet' } }; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  w.Mare = {
    TZ: TZ, SB_URL: SB_URL, SB_KEY: SB_KEY, DAYS: DAYS, DAYS_LONG: DAYS_LONG, MONTHS: MONTHS,
    parts: parts, pad: pad, hhmm: hhmm, dateKey: dateKey, dow: dow, addDays: addDays, weekStart: weekStart,
    niceDate: niceDate, shortDate: shortDate, toInstant: toInstant, mins: mins, dur: dur, durShort: durShort,
    timeToMin: timeToMin, shifts: shifts, lateness: lateness, GRACE_MIN: GRACE_MIN, rpc: rpc, esc: esc
  };
})(window);
