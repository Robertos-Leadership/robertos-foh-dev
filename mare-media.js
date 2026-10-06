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
  // opts.transcript: also write down what the microphone hears (meetings).
  var HEAR = [['en-GB', 'English'], ['hr-HR', 'Crnogorski'], ['it-IT', 'Italiano']];
  function recorder(box, onSave, opts) {
    opts = opts || {};
    var rec = null, chunks = [], t0 = 0, tick = null, stream = null, mime = pickMime();
    var sr = null, heard = [], hearOn = false, hearLang = M.lang() === 'me' ? 'hr-HR' : 'en-GB';
    function idle() {
      box.innerHTML = mime === null ? '<span class="small muted">' + E(T('This browser cannot record. Upload an audio file instead.')) + '</span>'
        : '<button type="button" class="btn rec-go">● ' + E(T(opts.transcript ? 'Record the meeting' : 'Record a voice note')) + '</button>' +
          (opts.transcript && SR ? '<label class="small muted rec-lang">' + E(T('Spoken in')) + ' <select>' + HEAR.map(function (l) {
            return '<option value="' + l[0] + '"' + (l[0] === hearLang ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select></label>' : '');
      var b = box.querySelector('.rec-go'); if (b) b.onclick = start;
      var sel = box.querySelector('.rec-lang select'); if (sel) sel.onchange = function () { hearLang = sel.value; };
    }
    // Speech recognition stops on its own after a pause; while the recording runs, start it again.
    function hear() {
      if (!opts.transcript || !SR) return;
      heard = []; hearOn = true;
      function go() {
        if (!hearOn) return;
        sr = new SR(); sr.lang = hearLang; sr.continuous = true; sr.interimResults = true;
        sr.onresult = function (e) {
          var live = '';
          for (var i = e.resultIndex; i < e.results.length; i++) {
            var t = e.results[i][0].transcript.trim(); if (!t) continue;
            if (e.results[i].isFinal) heard.push(t); else live += ' ' + t;
          }
          var el = box.querySelector('.rec-heard'); if (el) { var all = (heard.join(' ') + live).trim(); el.textContent = all.length > 140 ? '…' + all.slice(-140) : all; }
        };
        sr.onerror = function (e) {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
            hearOn = false; var el = box.querySelector('.rec-heard'); if (el) el.textContent = T('This device records the sound only. Write or dictate the notes instead.');
          }
        };
        sr.onend = function () { if (hearOn) setTimeout(go, 250); };
        try { sr.start(); } catch (x) { hearOn = false; }
      }
      go();
    }
    function unhear() { hearOn = false; try { if (sr) sr.stop(); } catch (x) {} }
    function start() {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s; chunks = []; rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = stopped; rec.start(1000); t0 = Date.now();
        box.innerHTML = '<span class="rec-dot"></span><b class="rec-t">0:00</b><button type="button" class="btn rec-stop">■ ' + E(T('Stop')) + '</button>' +
          (opts.transcript && SR ? '<span class="rec-heard small muted">' + E(T('Listening…')) + '</span>' : '');
        box.querySelector('.rec-stop').onclick = function () { rec.stop(); };
        hear();
        tick = setInterval(function () { var el = box.querySelector('.rec-t'); if (el) el.textContent = fmt((Date.now() - t0) / 1000); if (Date.now() - t0 > 20 * 60000) rec.stop(); }, 500);
      }, function () { M.toast(T('The microphone is blocked. Allow it in the browser and try again.')); });
    }
    // The recording saves itself on Stop: nobody has to remember a second button.
    function stopped() {
      clearInterval(tick); unhear(); if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      var secs = Math.round((Date.now() - t0) / 1000), blob = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm') });
      var said = heard.join(' ').trim(), words = said ? said.split(/\s+/).length : 0;
      var info = fmt(secs) + ' · ' + size(blob.size) + (opts.transcript && words ? ' · ' + T('{n} words written down', { n: words }) : '');
      if (blob.size > MAX) { box.innerHTML = '<span class="small muted">' + E(T('Too long: keep a voice note under 20 minutes.')) + '</span>'; setTimeout(idle, 4000); return; }
      function trySave() {
        box.innerHTML = '<span class="small muted">' + E(T('Saving…')) + ' ' + E(info) + '</span>';
        readData(blob).then(function (d) { return onSave({ kind: 'voice', name: T('Voice note'), mime: blob.type.split(';')[0] || 'audio/webm', data: d, seconds: secs, transcript: said || null }); })
          .then(function (ok) {
            if (!ok) {
              box.innerHTML = '<span class="small muted">' + E(T('Not saved yet.')) + ' ' + E(info) + '</span><button type="button" class="btn rec-retry">' + E(T('Try saving again')) + '</button>' +
                '<button type="button" class="btn ghost rec-del">' + E(T('Discard')) + '</button>';
              box.querySelector('.rec-retry').onclick = trySave; box.querySelector('.rec-del').onclick = idle; return;
            }
            box.innerHTML = '<span class="tag green">✓ ' + E(T('Saved')) + '</span><span class="small muted">' + E(info) + '</span>' +
              (opts.fill && said ? '<button type="button" class="btn rec-fill">' + E(T(opts.fillLabel)) + '</button>' : '') +
              '<button type="button" class="btn ghost rec-again">● ' + E(T('Record another')) + '</button>';
            var fb = box.querySelector('.rec-fill'); if (fb) fb.onclick = function () { opts.fill(said, fb); };
            box.querySelector('.rec-again').onclick = idle;
          }, function () { box.innerHTML = '<span class="small muted">' + E(T('Not saved yet.')) + '</span>'; setTimeout(trySave, 3000); });
      }
      trySave();
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
  function list(box, items, getData, onRemove, onTranscript, fill) {
    if (!items.length) { box.innerHTML = ''; return; }
    box.innerHTML = items.map(function (m) {
      var icon = m.kind === 'voice' || /^audio\//.test(m.mime) ? '▶' : /^image\//.test(m.mime) ? '▣' : /^video\//.test(m.mime) ? '▶' : '▤';
      var lbl = m.kind === 'voice' ? T('Voice note') + (m.seconds ? ' · ' + fmt(m.seconds) : '') : m.name;
      return '<div class="media" data-m="' + m.id + '"><button type="button" class="media-open"><span class="media-ic">' + icon + '</span><span><b>' + E(lbl) + '</b>' +
        '<span class="small muted">' + E((m.created_by ? m.created_by.split('@')[0] + ' · ' : '') + size(m.size)) + '</span></span></button>' +
        (onRemove ? '<button type="button" class="media-x" aria-label="' + E(T('Remove')) + '">✕</button>' : '') + '<div class="media-body"></div>' +
        (onTranscript && (m.kind === 'voice' || /^(audio|video)\//.test(m.mime)) ? '<details class="media-tr"><summary>' + E(m.transcript ? T('What the recording heard') : T('No transcript: type what was said')) + '</summary>' +
          '<textarea>' + E(m.transcript || '') + '</textarea><div class="row"><button type="button" class="btn ghost sm tr-save">' + E(T('Save the transcript')) + '</button>' +
          (fill ? '<button type="button" class="btn sm tr-fill">' + E(T(fill.label)) + '</button>' : '') + '</div></details>' : '') + '</div>';
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
      var ts = el.querySelector('.tr-save'); if (ts) ts.onclick = function () { onTranscript(m.id, el.querySelector('.media-tr textarea').value); };
      var tf = el.querySelector('.tr-fill'); if (tf) tf.onclick = function () { fill.run(el.querySelector('.media-tr textarea').value, tf); };
    });
  }

  w.MareMedia = { recorder: recorder, picker: picker, dictate: dictate, dictateAll: dictateAll, list: list, canDictate: !!SR };
})(window);
