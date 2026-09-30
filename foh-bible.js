/* Food Bible for the team — read only, opened with an Employee ID.
   The page itself (food-bible.html) reads the Kitchen recipes live and contains no code that
   writes anything. This file is only the door: it asks for an Employee ID, checks it against the
   same two staff lists the rest of the app uses (FOH: foh_staff, Kitchen: staff), and opens the
   page full screen. Loaded after foh-core.js, which defines `sb` and `sbKitchen`. */
(function(){
  var KEY = 'foh-bible-who';
  var overlay = null, frameWrap = null;
  var SERIF = "'Playfair Display',serif";

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function remembered(){ try{ return sessionStorage.getItem(KEY) || ''; }catch(e){ return ''; } }
  function remember(v){ try{ if(v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); }catch(e){} }

  // Same rule Checklists uses: exact text, or the same number.
  function same(a, raw){
    a = String(a==null?'':a).trim(); if(!a) return false;
    if(a === raw) return true;
    var x = parseInt(a,10), y = parseInt(raw,10);
    return !isNaN(x) && !isNaN(y) && x === y;
  }

  async function lookup(raw){
    var found = null, reached = 0;
    var jobs = [
      sb.from('foh_staff').select('name,emp_id').eq('active', true),
      sbKitchen.from('staff').select('name,emp_id').eq('active', true)
    ];
    var res = await Promise.all(jobs.map(function(p){ return p.then(function(r){ return r; }, function(e){ return {error:e}; }); }));
    res.forEach(function(r){
      if(r.error || !r.data) return;
      reached++;
      if(!found) found = r.data.filter(function(s){ return same(s.emp_id, raw); })[0] || null;
    });
    return { person: found, reached: reached };
  }

  function build(){
    if(overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'bible-ask';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(40,5,8,.6);z-index:9400;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML =
      '<div style="background:#F8F4EC;width:100%;max-width:340px;padding:28px 24px 22px;text-align:center;border-top:3px solid #C9A84C;box-shadow:0 30px 80px rgba(0,0,0,.45)">'
      + '<div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#544418;font-weight:700">Read only</div>'
      + '<div style="font-family:' + SERIF + ';font-size:22px;color:#2C1810;margin:4px 0 6px">Food Bible</div>'
      + '<div style="font-size:12px;color:#4F4535;margin-bottom:14px">Enter your Employee ID to open it.</div>'
      + '<input id="bible-id" type="text" inputmode="numeric" autocomplete="off" placeholder="Employee ID" style="width:100%;box-sizing:border-box;height:42px;border:1px solid #b9ab94;background:#fff;padding:0 12px;font-size:16px;text-align:center">'
      + '<div id="bible-err" style="min-height:18px;font-size:12px;color:#8B1A1A;margin:8px 0 4px"></div>'
      + '<button id="bible-go" style="width:100%;height:42px;background:#6B1F2A;color:#F8F4EC;border:0;font-size:14px;letter-spacing:.06em;cursor:pointer">Open</button>'
      + '<button id="bible-cancel" style="margin-top:10px;background:none;border:0;color:#6B1F2A;font-size:12px;text-decoration:underline;cursor:pointer">Cancel</button>'
      + '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    document.getElementById('bible-cancel').onclick = close;
    document.getElementById('bible-go').onclick = go;
    document.getElementById('bible-id').addEventListener('keydown', function(e){ if(e.key === 'Enter') go(); });
  }

  function close(){ if(overlay) overlay.style.display = 'none'; }

  async function go(){
    var inp = document.getElementById('bible-id'), err = document.getElementById('bible-err'), btn = document.getElementById('bible-go');
    var raw = inp.value.trim();
    err.textContent = '';
    if(!raw){ err.textContent = 'Enter your Employee ID.'; return; }
    btn.disabled = true; btn.textContent = 'Checking…';
    var r;
    try{ r = await lookup(raw); }catch(e){ r = { person:null, reached:0 }; }
    btn.disabled = false; btn.textContent = 'Open';
    if(r.person){ remember(raw); close(); show(r.person.name); return; }
    remember('');
    err.textContent = r.reached === 0 ? 'Could not check your ID. Check the connection and try again.' : 'ID not recognised.';
    setTimeout(function(){ try{ inp.focus(); inp.select(); }catch(e){} }, 30);
  }

  function show(name){
    if(frameWrap){ frameWrap.remove(); frameWrap = null; }
    frameWrap = document.createElement('div');
    frameWrap.id = 'bible-view';
    frameWrap.style.cssText = 'position:fixed;inset:0;z-index:9500;background:#2b0104;display:flex;flex-direction:column';
    frameWrap.innerHTML =
      '<div style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 14px;background:#6B1F2A;border-bottom:2px solid #C9A84C;color:#F8F4EC">'
      + '<div style="font-family:' + SERIF + ';font-size:15px">Food Bible <span style="font-size:11px;opacity:.7;letter-spacing:.08em">&nbsp;· ' + esc(name || '') + '</span></div>'
      + '<button id="bible-close" style="background:none;border:1px solid #C9A84C;color:#C9A84C;font-size:12px;letter-spacing:.06em;padding:6px 12px;cursor:pointer">Close</button>'
      + '</div>'
      + '<iframe title="Food Bible" src="food-bible.html?embed=1" style="flex:1 1 auto;width:100%;border:0;background:#cdbba6"></iframe>';
    document.body.appendChild(frameWrap);
    document.getElementById('bible-close').onclick = function(){ frameWrap.remove(); frameWrap = null; };
  }

  window.fohBibleOpen = function(){
    build();
    var inp = document.getElementById('bible-id');
    document.getElementById('bible-err').textContent = '';
    inp.value = remembered();
    overlay.style.display = 'flex';
    // A remembered ID is still checked against the live lists, so a person taken off the
    // list stops getting in on their next open, not only at the next sign-in.
    if(inp.value){ go(); } else { setTimeout(function(){ inp.focus(); }, 50); }
  };
})();
