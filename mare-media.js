/* Roberto's Mare — voice notes, dictation and file uploads (briefing and weekly
   meeting), and the player the team uses. Shared by mare.html and mare-clock.html.
   Files travel as data URLs and are kept in mare_media behind locked functions. */
(function (w) {
  var M = w.Mare, T = M.T, E = M.esc;
  var MAX = 6 * 1024 * 1024;   // 6 MB per file (about 25 minutes of voice)

  function fmt(sec) { sec = Math.max(0, Math.round(sec || 0)); return Math.floor(sec / 60) + ':' + M.pad(sec % 60); }
  function size(b) { return b > 1048576 ? (Math.round(b / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function readData(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); }); }

  // ── voice note recorder ──
  function pickMime() {
    if (!w.MediaRecorder) return null;
    var c = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < c.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i];
    return '';
  }
  function recorder(box, onSave) {
    var rec = null, chunks = [], t0 = 0, tick = null, stream = null, mime = pickMime();
    function idle() {
      box.innerHTML = mime === null ? '<span class="small muted">' + E(T('This browser cannot record. Upload an audio file instead.')) + '</span>'
        : '<button type="button" class="btn rec-go">● ' + E(T('Record a voice note')) + '</button>';
      var b = box.querySelector('.rec-go'); if (b) b.onclick = start;
    }
    function start() {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s; chunks = []; rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = stopped; rec.start(1000); t0 = Date.now();
        box.innerHTML = '<span class="rec-dot"></span><b class="rec-t">0:00</b><button type="button" class="btn rec-stop">■ ' + E(T('Stop')) + '</button>';
        box.querySelector('.rec-stop').onclick = function () { rec.stop(); };
        tick = setInterval(function () { var el = box.querySelector('.rec-t'); if (el) el.textContent = fmt((Date.now() - t0) / 1000); if (Date.now() - t0 > 20 * 60000) rec.stop(); }, 500);
      }, function () { M.toast(T('The microphone is blocked. Allow it in the browser and try again.')); });
    }
    function stopped() {
      clearInterval(tick); if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      var secs = Math.round((Date.now() - t0) / 1000), blob = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm') });
      var url = URL.createObjectURL(blob);
      box.innerHTML = '<audio controls src="' + url + '" style="max-width:100%"></audio><span class="small muted">' + fmt(secs) + ' · ' + size(blob.size) + '</span>' +
        '<button type="button" class="btn rec-save">' + E(T('Save the voice note')) + '</button><button type="button" class="btn ghost rec-del">' + E(T('Discard')) + '</button>';
      box.querySelector('.rec-del').onclick = idle;
      box.querySelector('.rec-save').onclick = function () {
        if (blob.size > MAX) { M.toast(T('Too long: keep a voice note under 20 minutes.')); return; }
        this.disabled = true;
        readData(blob).then(function (d) { return onSave({ kind: 'voice', name: T('Voice note'), mime: blob.type.split(';')[0] || 'audio/webm', data: d, seconds: secs }); })
          .then(function (ok) { if (ok) idle(); });
      };
    }
    idle();
  }

  // ── a file from the phone or laptop ──
  function picker(input, onSave) {
    input.onchange = function () {
      var f = input.files[0]; input.value = ''; if (!f) return;
      if (f.size > MAX) { M.toast(T('That file is too big ({s}). The limit is 6 MB.', { s: size(f.size) })); return; }
      if (!/^(image|audio|video)\//.test(f.type) && f.type !== 'application/pdf') { M.toast(T('Only photos, PDF, audio or video.')); return; }
      var go = /^image\//.test(f.type) && f.size > 900000 ? M.photoFromFile(f, 1800).then(function (d) { return { data: d, mime: 'image/jpeg' }; })
                                                       : readData(f).then(function (d) { return { data: d, mime: f.type }; });
      go.then(function (x) { onSave({ kind: 'file', name: f.name, mime: x.mime, data: x.data, seconds: null }); });
    };
  }

  // ── voice to text into a box ──
  var SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  function dictate(btn, field) {
    if (!SR) { btn.style.display = 'none'; return; }
    var r = null, on = false;
    btn.onclick = function () {
      if (on) { r.stop(); return; }
      r = new SR(); r.lang = M.lang() === 'me' ? 'hr-HR' : 'en-GB'; r.continuous = true; r.interimResults = false;
      r.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) {
          var t = e.results[i][0].transcript.trim(); if (!t) continue;
          field.value = (field.value ? field.value.replace(/\s*$/, '') + ' ' : '') + t.charAt(0).toUpperCase() + t.slice(1);
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };
      r.onend = function () { on = false; btn.classList.remove('on'); btn.innerHTML = M.icon('mic', 15) + ' ' + E(T('Dictate')); };
      r.onerror = function (e) { if (e.error === 'not-allowed') M.toast(T('The microphone is blocked. Allow it in the browser and try again.')); };
      r.start(); on = true; btn.classList.add('on'); btn.innerHTML = '■ ' + E(T('Stop dictating'));
    };
  }
  // Puts a "Dictate" button on every textarea inside root.
  function dictateAll(root) {
    if (!SR) return;
    Array.prototype.forEach.call(root.querySelectorAll('textarea'), function (ta) {
      if (ta.dataset.dict) return; ta.dataset.dict = 1;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'dict'; b.innerHTML = M.icon('mic', 15) + ' ' + E(T('Dictate'));
      ta.parentNode.insertBefore(b, ta.nextSibling); dictate(b, ta);
    });
  }

  // ── list + player ──
  function list(box, items, getData, onRemove) {
    if (!items.length) { box.innerHTML = ''; return; }
    box.innerHTML = items.map(function (m) {
      var icon = m.kind === 'voice' || /^audio\//.test(m.mime) ? '▶' : /^image\//.test(m.mime) ? '▣' : /^video\//.test(m.mime) ? '▶' : '▤';
      var lbl = m.kind === 'voice' ? T('Voice note') + (m.seconds ? ' · ' + fmt(m.seconds) : '') : m.name;
      return '<div class="media" data-m="' + m.id + '"><button type="button" class="media-open"><span class="media-ic">' + icon + '</span><span><b>' + E(lbl) + '</b>' +
        '<span class="small muted">' + E((m.created_by ? m.created_by.split('@')[0] + ' · ' : '') + size(m.size)) + '</span></span></button>' +
        (onRemove ? '<button type="button" class="media-x" aria-label="' + E(T('Remove')) + '">✕</button>' : '') + '<div class="media-body"></div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.media'), function (el) {
      var m = items.filter(function (x) { return x.id === el.getAttribute('data-m'); })[0], body = el.querySelector('.media-body'), loaded = false;
      el.querySelector('.media-open').onclick = function () {
        if (loaded) { body.innerHTML = ''; loaded = false; return; }
        body.innerHTML = '<span class="small muted">' + E(T('Loading…')) + '</span>';
        getData(m.id).then(function (d) {
          if (!d) { body.innerHTML = '<span class="small muted">' + E(T('Could not load.')) + '</span>'; return; }
          loaded = true;
          if (/^audio\//.test(m.mime) || m.kind === 'voice') body.innerHTML = '<audio controls autoplay src="' + d + '" style="width:100%"></audio>';
          else if (/^video\//.test(m.mime)) body.innerHTML = '<video controls playsinline src="' + d + '" style="width:100%;border-radius:10px"></video>';
          else if (/^image\//.test(m.mime)) body.innerHTML = '<img src="' + d + '" alt="" style="width:100%;border-radius:10px">';
          else { // PDF: open as a file
            var bin = atob(d.split(',')[1]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            var url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
            body.innerHTML = '<a class="btn ghost" href="' + url + '" target="_blank" rel="noopener" style="display:inline-flex;text-decoration:none">' + E(T('Open the PDF')) + '</a>';
          }
        });
      };
      var x = el.querySelector('.media-x'); if (x) x.onclick = function () { onRemove(m.id); };
    });
  }

  w.MareMedia = { recorder: recorder, picker: picker, dictate: dictate, dictateAll: dictateAll, list: list, canDictate: !!SR };
})(window);
