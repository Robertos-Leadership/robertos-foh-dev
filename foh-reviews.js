// ──────────────────────────────────────────────────────────────────────────
// GUEST REVIEWS module (gr*) — our Google rating, what guests write, and how
// the DIFC room compares. Asked for by Ouafaa (GM) on her first day, 15 Jul 2026.
//
// WHY IT EXISTS — read before "improving" it:
//   Google only ever returns FIVE reviews per venue, and they are the five it
//   considers most relevant, NOT the newest. The set changes between calls.
//   So this is NOT our review inbox — SevenRooms already holds every one of our
//   reviews in full, by server and by table, and that is where reading and
//   replying belongs. What Google alone can give us is the COMPETITORS' numbers,
//   and that is the real point of this page. Never build 1-star alerting on it:
//   a bad review may simply never appear in the five.
//
//   SINCE 16 Jul the nightly pull's primary source is SerpApi (newest-first,
//   Francesco's informed call — see the edge function), with the rotating-five
//   net as automatic fallback. Whatever the source, only reviews under 7 days
//   old are kept (google_reviews_seen, self-purging at 30 days — Google's
//   licence) and only that collection is displayed, newest first. Still not an
//   alarm: the pull runs once a night, so the no-1-star-alerting rule above
//   stands unchanged.
//
//   DISPLAY POLICY (Francesco, 15 Jul evening — do not undo): review TEXT on
//   screen comes ONLY from that under-7-day collection. The raw "most relevant"
//   five are never shown — they mix in months-old reviews, and his words were
//   "better nothing for now than old reviews". An empty week shows an honest
//   sentence, never padding. (The edge function's on-demand `reviews` mode
//   still exists server-side; the UI deliberately no longer calls it.)
//
// Loaded as a classic <script> after the main inline script, so its functions
// stay global for the inline onclick handlers. Uses the shared globals:
//   sb, state, renderMain.
//
// Data: google_reviews_daily + google_reviews_seen (read-only here — only the
//       edge function writes). The edge function is invoked only to trigger the
//       daily pull when today's rows are missing — never for on-screen text.
// ──────────────────────────────────────────────────────────────────────────

// Display names + order live here; the Place IDs live in the edge function so
// there is exactly one pinned copy of them.
var GR_VENUES = [
  { key:'robertos',   name:"Roberto's",        us:true },
  { key:'zuma',       name:'Zuma' },
  { key:'lpm',        name:'La Petite Maison' },
  { key:'cipriani',   name:'Cipriani' },
  { key:'clap',       name:'Clap' },
  { key:'gattopardo', name:'Il Gattopardo' },
  { key:'chicnonna',  name:'Chic Nonna' }
];
var GR = { loading:false, loaded:false, rows:null, err:null, open:null, week:null, weekErr:null, pace:null, paceErr:null, raceView:'30' };

function grName(k){ var v=GR_VENUES.find(function(x){ return x.key===k; }); return v?v.name:k; }
// The one Google deep link that needs no fetch and never expires: built from
// the Place ID, which reaches the UI via google_reviews_daily (the edge
// function's pinned list stays the single source of the IDs themselves).
function grMapsUrl(placeId){
  return placeId ? 'https://www.google.com/maps/place/?q=place_id:'+encodeURIComponent(placeId) : null;
}
function grEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function grDate(d){ try{ return new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}); }catch(e){ return String(d||''); } }
function grNum(n){ return Number(n||0).toLocaleString('en-US'); }

// ── Stars: whole stars plus a half. Purely decorative — the number beside it
//    is the fact, so screen readers get the number, not seven glyphs. ──
function grStars(r){
  var v = Number(r)||0, full = Math.floor(v), half = (v-full) >= 0.25 && (v-full) < 0.75, up = (v-full) >= 0.75;
  var s = '★'.repeat(full + (up?1:0)) + (half ? '½' : '');
  return '<span class="gr-stars" aria-hidden="true">'+s+'</span>';
}

// ── LOAD ──────────────────────────────────────────────────────────────────
// One read of the snapshot trail. If nobody has pulled today yet, we ask the
// edge function to pull now and read again — so the board is never blank and
// never depends on the morning job having fired.
async function grLoad(){
  if(GR.loading) return;
  GR.loading = true; GR.err = null;
  try{
    var since = new Date(Date.now() - 31*24*3600*1000).toISOString().slice(0,10);
    var r = await sb.from('google_reviews_daily').select('venue_key,snapshot_date,rating,user_rating_count,place_id')
                    .gte('snapshot_date', since).order('snapshot_date',{ascending:true});
    if(r.error) throw r.error;
    var rows = r.data || [];
    var today = grToday();
    if(!rows.some(function(x){ return String(x.snapshot_date).slice(0,10) === today; })){
      var f = await sb.functions.invoke('google-reviews', { body:{ mode:'daily' } });
      if(f.error) throw new Error(grFnErr(f));
      var r2 = await sb.from('google_reviews_daily').select('venue_key,snapshot_date,rating,user_rating_count,place_id')
                       .gte('snapshot_date', since).order('snapshot_date',{ascending:true});
      if(!r2.error) rows = r2.data || [];
    }
    GR.rows = rows;
    GR.loaded = true;
  }catch(e){
    GR.err = String((e && e.message) || e);
  }
  // The collected-this-week store is loaded separately and is allowed to fail
  // alone: if its SQL has not been run yet the board above must still work.
  try{
    var wk = new Date(Date.now() - 7*24*3600*1000).toISOString();
    var w = await sb.from('google_reviews_seen')
                    .select('venue_key,review_key,rating,review_text,author,author_uri,maps_uri,publish_time,lang,first_seen')
                    .gte('publish_time', wk).order('publish_time',{ascending:false});
    if(w.error) throw w.error;
    GR.week = w.data || [];
  }catch(e2){
    GR.week = [];
    GR.weekErr = String((e2 && e2.message) || e2);
  }
  // Pace: our own long-term measurement (see foh-google-reviews-pace.sql for
  // why it may keep history). Loaded up to a year back; same fail-alone rule.
  try{
    var yr = new Date(Date.now() - 365*24*3600*1000).toISOString().slice(0,10);
    var p = await sb.from('google_reviews_pace')
                    .select('venue_key,day,gained,over_days')
                    .gte('day', yr).order('day',{ascending:true});
    if(p.error) throw p.error;
    GR.pace = p.data || [];
  }catch(e3){
    GR.pace = [];
    GR.paceErr = String((e3 && e3.message) || e3);
  }
  GR.loading = false;
  if(state.currentTab==='reviews') renderMain();
}
// Dubai is UTC+4 with no daylight saving, so the shift is a constant.
function grToday(){ return new Date(Date.now() + 4*3600*1000).toISOString().slice(0,10); }

// The edge function puts its reason in the response body, which supabase-js
// hides behind a generic "non-2xx" error — dig the real sentence out so the
// screen can say what actually went wrong instead of "something failed".
function grFnErr(f){
  try{ if(f.data && f.data.error) return f.data.error; }catch(e){}
  return (f.error && f.error.message) || 'Could not reach Google';
}

// ── The board ─────────────────────────────────────────────────────────────
// One entry per venue: today's figures, plus how many ratings it has collected
// since our FIRST snapshot. That "since" date is the honest one — we can only
// count what we have watched. It grows to a rolling 30 days and stops there,
// because the trail purges itself at 30 days (Google's terms, not our choice).
function grBoard(){
  var by = {};
  (GR.rows||[]).forEach(function(x){
    var k = x.venue_key;
    (by[k] = by[k] || []).push(x);
  });
  var out = GR_VENUES.map(function(v){
    var rows = (by[v.key]||[]).slice().sort(function(a,b){ return String(a.snapshot_date).localeCompare(String(b.snapshot_date)); });
    if(!rows.length) return { key:v.key, name:v.name, us:!!v.us, missing:true };
    var last = rows[rows.length-1], first = rows[0];
    var days = rows.length;
    return {
      key:v.key, name:v.name, us:!!v.us, place_id: last.place_id || null,
      rating: last.rating, count: last.user_rating_count,
      since: first.snapshot_date,
      delta: (days>1) ? (Number(last.user_rating_count||0) - Number(first.user_rating_count||0)) : null,
      newToday: days<=1,
      // Star movement inside our 30-day window — ratings move rarely, so a
      // change is genuinely worth a word on the row.
      firstRating: first.rating,
      ratingMoved: (days>1 && first.rating!=null && last.rating!=null && Number(first.rating)!==Number(last.rating))
    };
  }).filter(function(x){ return !x.missing; });
  out.sort(function(a,b){ return (Number(b.rating)||0)-(Number(a.rating)||0) || (Number(b.count)||0)-(Number(a.count)||0); });
  return out;
}
// Joint rank by star rating — venues on the same rating share a place.
function grRank(board){
  var us = board.find(function(x){ return x.us; });
  if(!us) return null;
  var better = board.filter(function(x){ return (Number(x.rating)||0) > (Number(us.rating)||0); }).length;
  var same = board.filter(function(x){ return Number(x.rating) === Number(us.rating); }).length;
  var pos = better + 1;
  var ord = pos===1 ? '1st' : pos===2 ? '2nd' : pos===3 ? '3rd' : (pos+'th');
  return { pos:pos, label:(same>1 ? 'Joint '+ord : ord), of:board.length, us:us };
}

// ── RENDER ────────────────────────────────────────────────────────────────
function renderReviews(){
  if(!GR.loaded && !GR.loading && !GR.err){ setTimeout(grLoad, 0); }
  var h = ['<div class="gr-wrap">'];

  if(GR.err){
    h.push(grProblem(GR.err));
    h.push('</div>'); return h.join('');
  }
  if(!GR.loaded){
    h.push('<div class="gr-loading">Reading today’s ratings from Google…</div>');
    h.push('</div>'); return h.join('');
  }

  var board = grBoard();
  var rank = grRank(board);

  // ── Hero: the room itself, then the four numbers that matter ──
  // The photo is the login screen's robertos-interior.jpg — already cached on
  // every device, so this banner costs no extra download.
  if(rank){
    var us = rank.us;
    var usMaps = grMapsUrl(us.place_id);
    h.push('<div class="gr-hero-photo">'
      + '<div class="gr-hero-veil"></div>'
      + (usMaps ? '<a class="gr-hero-btn" href="'+grEsc(usMaps)+'" target="_blank" rel="noopener">View on Google ›</a>' : '')
      + '<div class="gr-hero-body">'
      + '<div class="gr-hero-kicker">Guest experience</div>'
      + '<div class="gr-hero-title">Guest Reviews</div>'
      + '<div class="gr-hero-sub">What guests say about us on Google — collected every night.</div>'
      + '</div></div>');
    var week = grWeekFor('robertos');
    h.push('<div class="gr-kpis">');
    h.push(grKpi('Average rating', (us.rating!=null?us.rating:'—'), grStars(us.rating)));
    h.push(grKpi('Total ratings', grNum(us.count),
      (us.delta!=null ? '+'+grNum(us.delta)+' in 30 days' : 'counting from today')));
    // Counts every review published in the last 7 days, text or not — a star
    // with no words is still a guest's verdict. The sub-line says so, because
    // "8" must never quietly mean something other than what a reader assumes.
    var withText = (week||[]).filter(function(x){ return String(x.review_text||'').trim(); }).length;
    h.push(grKpi('New this week', String((week||[]).length),
      withText ? (withText+' with a comment') : 'ratings only, no comments'));
    h.push(grKpi('DIFC rank', rank.label, 'of '+rank.of+' by star rating' + grRankMove(board, rank)));
    h.push('</div>');
    h.push(grTrendHTML());
  }

  // ── The race ──
  h.push('<div class="gr-sec">The race · new ratings</div>');
  h.push(grRaceHTML(board));

  // ── Board ──
  h.push('<div class="gr-sec">How DIFC compares · tap any venue</div>');
  h.push('<div class="gr-card">');
  h.push('<table class="gr-table"><tr><th>Restaurant</th><th class="n">Stars</th><th class="n">Ratings</th><th class="n">'+grDeltaHead(board)+'</th><th></th></tr>');
  board.forEach(function(v){
    var open = GR.open===v.key;
    var moveNote = v.ratingMoved
      ? '<span class="gr-move '+(Number(v.rating)>Number(v.firstRating)?'gr-move-up':'gr-move-dn')+'">'
        + (Number(v.rating)>Number(v.firstRating)?'↑':'↓')+' was '+v.firstRating+' on '+grDate(v.since)+'</span>'
      : '';
    h.push('<tr class="'+(v.us?'gr-me':'')+'" onclick="grToggle(\''+v.key+'\')">'
      + '<td class="gr-name">'+grEsc(v.name)+'</td>'
      + '<td class="n gr-rt">'+(v.rating!=null?v.rating:'—')+moveNote+'</td>'
      + '<td class="n gr-ct">'+grNum(v.count)+'</td>'
      + '<td class="n">'+grDeltaPill(v, false)+'</td>'
      + '<td class="n gr-chev">'+(open?'›':'›')+'</td></tr>');
    if(open){
      h.push('<tr class="gr-exp"><td colspan="5">'+grVenuePanel(v)+'</td></tr>');
    }
  });
  h.push('</table>');
  h.push(grBoardNote(board, rank));
  h.push('</div>');

  // ── New this week (our stored collection, newest first — the ONLY review
  //    text on this page; the raw "most relevant" five are never shown) ──
  h.push('<div class="gr-sec">New this week at Roberto’s</div>');
  h.push(grWeekHTML('robertos'));

  h.push('<div class="gr-attrib">Ratings and reviews from Google, refreshed each morning.<br>'
    + 'Every night we collect each venue’s newest Google reviews and keep the ones written in the last 7 days — '
    + 'only those are shown here, newest first. Older reviews are deliberately not displayed, and stored ones are '
    + 'deleted after 30 days (Google’s rule). The collection runs once a night, so a review written today appears '
    + 'tomorrow morning — <b>never treat this page as an alarm</b>. '
    + 'Every review we have, in full, is on the SevenRooms Guest Satisfaction page.</div>');

  h.push('</div>');
  return h.join('');
}

// Velocity. Per the 15 Jul decision it counts up from our first snapshot rather
// than waiting 30 days — an honest small number beats an invented big one.
function grDeltaHead(board){
  var b = board.find(function(x){ return x.since; });
  return b ? ('New since '+grDate(b.since)) : 'New ratings';
}
function grDeltaPill(v, hero){
  if(v.newToday || v.delta==null){
    return hero ? '<div class="gr-delta gr-delta-mut">Counting new ratings from today</div>'
                : '<span class="gr-mut-sm">from today</span>';
  }
  var big = (v.delta||0) >= 60;
  // Pick the sign first, then print the absolute number — otherwise a negative
  // delta renders as "+-1" (the "+" glued in front of grNum's own "-"). The race
  // chart already does it this way; the board must match, sign for sign.
  var neg = (v.delta||0) < 0;
  var txt = (neg?'−':'+')+grNum(Math.abs(v.delta||0))+(hero?(' ratings since '+grDate(v.since)):'');
  return hero ? '<div class="gr-delta">'+txt+'</div>'
              : '<span class="gr-vel'+(big?' gr-vel-hot':'')+'">'+txt+'</span>';
}

// One stat tile: uppercase label, serif figure, quiet sub-line.
function grKpi(label, value, sub){
  return '<div class="gr-kpi"><div class="gr-kpi-l">'+label+'</div>'
    + '<div class="gr-kpi-v num">'+value+'</div>'
    + '<div class="gr-kpi-s">'+(sub||'')+'</div></div>';
}

// ── Growth line: our official Google total, morning by morning ────────────
// Drawn straight from google_reviews_daily (already loaded in GR.rows), so it
// can never exceed the 30-day window — the table purges itself. The race keeps
// the longer story via our own pace measurements.
function grTrendHTML(){
  var rows = (GR.rows||[]).filter(function(x){ return x.venue_key==='robertos' && x.user_rating_count!=null; })
    .sort(function(a,b){ return String(a.snapshot_date).localeCompare(String(b.snapshot_date)); });
  var h = ['<div class="gr-card gr-trend">'];
  h.push('<div class="gr-trend-head"><div class="gr-trend-t">How our total is growing</div>');
  if(rows.length>1){
    var d = Number(rows[rows.length-1].user_rating_count) - Number(rows[0].user_rating_count);
    h.push('<div class="gr-trend-plus">'+(d<0?'−':'+')+grNum(Math.abs(d))+' since '+grDate(rows[0].snapshot_date)+'</div>');
  }
  h.push('</div>');
  if(rows.length<2){
    h.push('<div class="gr-note">The growth line draws itself from tomorrow — it needs at least two mornings of totals. '
      + 'It can only ever show the last 30 days (Google’s rule); the race below keeps the longer story.</div>');
    h.push('</div>');
    return h.join('');
  }
  var W=600, H=150, P=14, PB=24;
  var vals = rows.map(function(r){ return Number(r.user_rating_count); });
  var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  if(max===min){ min-=1; max+=1; }
  var pts = rows.map(function(r,i){
    var x = P + (W-2*P) * (i/(rows.length-1));
    var y = 10 + (H-10-PB) * (1 - (Number(r.user_rating_count)-min)/(max-min));
    return [Math.round(x*10)/10, Math.round(y*10)/10];
  });
  var path = pts.map(function(p,i){ return (i?'L':'M')+p[0]+' '+p[1]; }).join(' ');
  var area = path + ' L'+pts[pts.length-1][0]+' '+(H-PB)+' L'+pts[0][0]+' '+(H-PB)+' Z';
  var last = pts[pts.length-1];
  h.push('<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;margin-top:8px" role="img" '
    + 'aria-label="Our Google ratings total each morning, last 30 days">'
    + '<path d="'+area+'" fill="rgba(150,52,61,.10)"></path>'
    + '<path d="'+path+'" fill="none" stroke="#96343D" stroke-width="2" stroke-linejoin="round"></path>'
    + '<circle cx="'+last[0]+'" cy="'+last[1]+'" r="3.5" fill="#96343D"></circle>'
    + '<text x="'+P+'" y="'+(H-7)+'" font-size="10" fill="#8B7355">'+grEsc(grDate(rows[0].snapshot_date))+'</text>'
    + '<text x="'+(W-P)+'" y="'+(H-7)+'" font-size="10" fill="#8B7355" text-anchor="end">'
    + grEsc(grDate(rows[rows.length-1].snapshot_date))+' · '+grNum(vals[vals.length-1])+'</text>'
    + '</svg>');
  h.push('<div class="gr-note">Our official Google total each morning. It can only ever look back 30 days (Google’s rule) — the race below keeps the longer story.</div>');
  h.push('</div>');
  return h.join('');
}

// Rank movement inside the 30-day window: rebuild the board as it stood on
// each venue's first snapshot and compare our position. Ratings move rarely,
// so most days this renders nothing — that silence is correct.
function grRankMove(board, rank){
  var withHistory = board.filter(function(x){ return x.firstRating!=null && x.delta!=null; });
  if(withHistory.length < 2 || !rank) return '';
  var thenBoard = withHistory.map(function(x){ return { us:x.us, rating:x.firstRating, count:x.count }; });
  var thenRank = grRank(thenBoard);
  if(!thenRank || thenRank.pos === rank.pos) return '';
  var us = rank.us;
  var up = rank.pos < thenRank.pos;
  var ord = function(p){ return p===1?'1st':p===2?'2nd':p===3?'3rd':(p+'th'); };
  return '<div class="gr-rank-move '+(up?'gr-move-up':'gr-move-dn')+'">'
    + (up?'↑ up from ':'↓ down from ')+ord(thenRank.pos)+' since '+grDate(us.since)+'</div>';
}

// ── The race ──────────────────────────────────────────────────────────────
// Who is collecting ratings fastest. Built ONLY from google_reviews_pace —
// our own daily measurements, which we may keep long-term (the raw Google
// totals never live past 30 days; see foh-google-reviews-pace.sql).
// Two views: last 30 days, and everything since we started watching.
function grRaceHTML(board){
  if(GR.pace===null) return '<div class="gr-card"><div class="gr-loading gr-loading-sm">Reading the pace history…</div></div>';
  if(GR.paceErr && !(GR.pace||[]).length){
    return '<div class="gr-card"><div class="gr-note">The pace history isn’t switched on yet — its table is missing from the database. The rest of this page is unaffected.</div></div>';
  }
  var cut30 = new Date(Date.now() - 30*24*3600*1000).toISOString().slice(0,10);
  var all = GR.pace||[];
  var use = GR.raceView==='30' ? all.filter(function(x){ return String(x.day) >= cut30; }) : all;
  if(!use.length){
    return '<div class="gr-card"><div class="gr-note">The race starts tomorrow. It needs at least two mornings of watching before the first bars can appear — from then on it builds every day, and this history is ours to keep.</div></div>';
  }
  var sums = {};
  use.forEach(function(x){ sums[x.venue_key] = (sums[x.venue_key]||0) + Number(x.gained||0); });
  var entries = GR_VENUES.map(function(v){
    return { key:v.key, name:v.name, us:!!v.us, sum:(sums[v.key]!=null?sums[v.key]:null) };
  }).filter(function(x){ return x.sum!=null; });
  entries.sort(function(a,b){ return b.sum-a.sum; });
  // Bars scale against the biggest GAIN only. A negative total (Google pruned
  // more than the venue gained) draws as a small muted stub — the minus sign
  // carries the story; a long bar would falsely read as leading the race.
  var max = 1;
  entries.forEach(function(x){ if(x.sum > max) max = x.sum; });

  var sinceAll = String(all[0].day).slice(0,10);
  var since = String(use[0].day).slice(0,10);
  var days = Math.round((Date.now() - new Date(since+'T12:00:00').getTime())/86400000);
  var h = ['<div class="gr-card">'];
  h.push('<div class="gr-race-tabs">'
    + '<button class="gr-race-tab'+(GR.raceView==='30'?' on':'')+'" onclick="grRaceSwitch(\'30\')">Last 30 days</button>'
    + '<button class="gr-race-tab'+(GR.raceView!=='30'?' on':'')+'" onclick="grRaceSwitch(\'all\')">Since '+grDate(sinceAll)+'</button>'
    + '</div>');
  h.push('<div class="gr-race">');
  entries.forEach(function(x){
    var neg = x.sum < 0;
    var pct = x.sum > 0 ? Math.max(4, Math.round(x.sum/max*100)) : 2;
    h.push('<div class="gr-race-row'+(x.us?' gr-race-us':'')+(neg?' gr-race-neg':'')+'">'
      + '<div class="gr-race-name">'+grEsc(x.name)+'</div>'
      + '<div class="gr-race-track"><div class="gr-race-bar" style="width:'+pct+'%"></div></div>'
      + '<div class="gr-race-val">'+(neg?'−':'+')+grNum(Math.abs(x.sum))+'</div>'
      + '</div>');
  });
  h.push('</div>');
  // The reading, derived from the numbers only.
  var us = entries.find(function(x){ return x.us; });
  var top = entries[0];
  if(us && top){
    var line;
    if(top.us){ line = 'Nobody in DIFC is collecting ratings faster than us right now.'; }
    else if(us.sum > 0){
      var ratio = us.sum>0 ? (top.sum/us.sum) : null;
      line = grEsc(top.name)+' is being rated '+(ratio && ratio>=1.15 ? (Math.round(ratio*10)/10)+' times as often as we are' : 'about as often as we are')+' over this period.';
    }else{
      line = grEsc(top.name)+' leads the period; our own count has not grown over it.';
    }
    h.push('<div class="gr-note">'+line+' Counted by us each morning'+(days>1?(' for '+days+' days'):'')+' — this history is our own measurement and is never deleted. '
      + 'A minus means Google showed fewer ratings than the day before: it deletes reviews it decides are spam, and its public total can wobble slightly day to day. Over the weeks the noise cancels out and the real pace shows.</div>');
  }
  h.push('</div>');
  return h.join('');
}
function grRaceSwitch(v){
  GR.raceView = (v==='all') ? 'all' : '30';
  renderMain();
}

// The reading of the board, in plain words. Every sentence is derived from the
// numbers on screen — nothing here is written by hand or by an AI.
function grBoardNote(board, rank){
  if(!rank) return '';
  var us = rank.us;
  var above = board.filter(function(x){ return (Number(x.rating)||0) > (Number(us.rating)||0); });
  var bits = [];
  if(!above.length){
    bits.push('Nobody in DIFC is rated higher than Roberto’s.');
  }else{
    var names = above.map(function(x){ return grEsc(x.name)+' ('+grNum(x.count)+' ratings)'; });
    var bigger = above.filter(function(x){ return (Number(x.count)||0) >= (Number(us.count)||0); });
    bits.push((above.length===1?'Only ':'')+names.join(' and ')+(above.length===1?' sits':' sit')+' above us, on '
      + (bigger.length ? 'more ratings than our ' : 'fewer ratings than our ') + grNum(us.count)+'.');
    if(!bigger.length) bits.push('Among the venues at comparable volume, nobody is rated higher than us.');
  }
  // Only compare pace once there is real pace to compare.
  var withDelta = board.filter(function(x){ return x.delta!=null; });
  if(withDelta.length && us.delta!=null){
    var fastest = withDelta.slice().sort(function(a,b){ return (b.delta||0)-(a.delta||0); })[0];
    if(fastest && !fastest.us && fastest.delta > us.delta){
      bits.push('<b>'+grEsc(fastest.name)+' has collected '+grNum(fastest.delta)+' new ratings since '+grDate(fastest.since)
        +' to our '+grNum(us.delta)+'</b> — they are being reviewed more often than we are.');
    }
  }else{
    bits.push('New-rating pace is our own daily count and it builds from today onward — that history is ours and is never deleted. '
      + 'Only Google’s raw totals are removed after 30 days, so the “New since” column can never look back further than that; '
      + 'the race above keeps the longer story.');
  }
  return '<div class="gr-note">'+bits.join(' ')+'</div>';
}

// ── A tapped competitor ──
// Only their collected week — never the raw "most relevant" five, which mix in
// months-old reviews (Francesco: "better nothing for now than old reviews").
// The Google link stays even when the week is empty — there must always be a
// door to the full listing.
function grVenuePanel(v){
  var maps = grMapsUrl(v.place_id);
  return grWeekHTML(v.key)
    + (maps ? '<div style="margin-top:8px"><a class="gr-link" href="'+grEsc(maps)+'" target="_blank" rel="noopener">See '
              + grEsc(v.name)+' on Google ›</a></div>' : '');
}
function grToggle(key){
  GR.open = (GR.open===key) ? null : key;
  renderMain();
}

// ── Collected this week ────────────────────────────────────────────────────
// The stored under-7-day reviews for one venue, newest first. Fewer is fine —
// Francesco's rule is "only the newest, even if they are fewer". Empty gets an
// honest sentence, never padding with old reviews.
function grWeekFor(key){
  return (GR.week||[]).filter(function(x){ return x.venue_key===key; });
}
function grAgo(t){
  var days = Math.floor((Date.now() - Date.parse(t)) / 86400000);
  return days<=0 ? 'today' : days===1 ? 'yesterday' : days+' days ago';
}
function grWeekRow(x){
  return { rating:x.rating, text:x.review_text, author:x.author, author_uri:x.author_uri,
           maps_uri:x.maps_uri, publish_time:x.publish_time, relative_time:grAgo(x.publish_time),
           lang:x.lang, first_seen:x.first_seen };
}
// Language of the original review, in plain words. Anything unmapped shows its
// code uppercased — honest, and new languages need no code change to appear.
var GR_LANGS = { ru:'Russian', ar:'Arabic', it:'Italian', fr:'French', de:'German', es:'Spanish',
                 zh:'Chinese', 'zh-Hant':'Chinese', ja:'Japanese', ko:'Korean', tr:'Turkish',
                 fa:'Farsi', hi:'Hindi', pt:'Portuguese', nl:'Dutch', pl:'Polish', uk:'Ukrainian' };
function grLangTag(code){
  if(!code || String(code).slice(0,2)==='en') return '';
  var base = GR_LANGS[code] || GR_LANGS[String(code).slice(0,2)] || String(code).toUpperCase();
  return '<span class="gr-tag">written in '+grEsc(base)+'</span>';
}
// Which night the collector caught it — makes the nightly machine visible.
function grKeptTag(firstSeen){
  if(!firstSeen) return '';
  try{
    var d = new Date(String(firstSeen).slice(0,10)+'T12:00:00');
    var today = grToday();
    var label = String(firstSeen).slice(0,10)===today ? 'kept this morning'
              : 'kept '+d.toLocaleDateString('en-GB',{weekday:'short'})+' night';
    return '<span class="gr-tag gr-tag-mut">'+label+'</span>';
  }catch(e){ return ''; }
}
// One plain line: how the week's catch splits by stars.
function grSplit(list){
  var by = {};
  list.forEach(function(x){ var s = Math.round(Number(x.rating)||0); by[s]=(by[s]||0)+1; });
  var parts = [5,4,3,2,1].filter(function(s){ return by[s]; })
    .map(function(s){ return by[s]+' × '+s+'★'; });
  return parts.length ? '<div class="gr-split">Collected this week: <b>'+parts.join(' · ')+'</b></div>' : '';
}
function grWeekHTML(key){
  var mine = key==='robertos';
  if(GR.week===null) return '<div class="gr-loading gr-loading-sm">Reading this week’s collection…</div>';
  if(GR.weekErr && !(GR.week||[]).length){
    return '<div class="gr-card"><div class="gr-note">The weekly collection isn’t switched on yet — '
      + 'its table is missing from the database. The rest of this page is unaffected.</div></div>';
  }
  var list = grWeekFor(key);
  if(!list.length){
    return '<div class="gr-card"><div class="gr-note">No review under a week old has been written'+(mine?' for us':' for '+grEsc(grName(key)))+' — quiet weeks happen. '
      + 'The nightly collection brings anything new in by the next morning.</div></div>';
  }
  var h = [];
  h.push(grSplit(list));
  if(mine){
    var low = list.filter(function(r){ return Number(r.rating) <= 2; });
    if(low.length){
      h.push('<div class="gr-flag"><b>'+low.length+' review'+(low.length>1?'s':'')+' at 2★ or below</b> collected this week. '
        + 'Worth a read — but never treat this page as the alarm: it updates once a night, not live.</div>');
    }
  }
  h.push(list.slice(0, mine?20:10).map(function(x){ return grReviewHTML(grWeekRow(x), mine); }).join(''));
  // Honesty about scope: our own week is fetched to completion; for a
  // competitor we deliberately take only the 8 newest a night (cost), so
  // never let their list imply "this is their whole week".
  h.push('<div class="gr-attrib gr-attrib-sm">'
    + (mine ? 'Every review written in the last 7 days, collected nightly — newest first, kept 30 days, then deleted.'
            : 'Their newest reviews, up to 8 a night — a sample of their week, not all of it. Their rating and count above are complete.')
    + '</div>');
  return h.join('');
}

// Attribution is required by Google: the author's name and a way back to the
// review on Google must both be shown. Do not strip either.
function grReviewHTML(rv, mine){
  var bad = mine && Number(rv.rating) <= 2;
  var when = rv.relative_time || (rv.publish_time ? grDate(rv.publish_time) : '');
  var txt = String(rv.text||'').trim();
  var h = ['<div class="gr-rev'+(bad?' gr-rev-bad':'')+'">'];
  h.push('<div class="gr-revhead">'+grStars(rv.rating)
    + '<span class="gr-revwho">'+grEsc(rv.author)+'</span><span class="gr-mut-sm">'+grEsc(when)+'</span>'
    + grLangTag(rv.lang) + grKeptTag(rv.first_seen) + '</div>');
  if(txt) h.push('<p class="gr-revtext">'+grEsc(txt.length>420 ? txt.slice(0,420)+'…' : txt)+'</p>');
  else h.push('<p class="gr-revtext gr-mut-sm">A rating with no words.</p>');
  if(rv.maps_uri) h.push('<a class="gr-link" href="'+grEsc(rv.maps_uri)+'" target="_blank" rel="noopener">Read the full review on Google ›</a>');
  h.push('</div>');
  return h.join('');
}

// Problems in plain English, with the one action that fixes each. The raw
// message is only shown for a problem we don't recognise — for the four known
// ones the sentence already says everything useful, and the technical string
// would just be noise on a manager's screen.
function grProblem(msg){
  var m = String(msg||'');
  var say, fix, raw = false;
  if(/GOOGLE_PLACES_API_KEY/i.test(m)){
    say = 'Guest Reviews is not connected to Google yet.';
    fix = 'The Google key has to be added to the app’s settings before Google will answer.';
  }else if(/do not have the Guest Reviews module/i.test(m)){
    say = 'You do not have Guest Reviews on your login.';
    fix = 'Ask Francesco to switch it on for you in Admin.';
  }else if(/Not signed in/i.test(m)){
    say = 'Your session has expired.';
    fix = 'Sign out and back in.';
  }else{
    say = 'Google did not answer just now.';
    fix = 'Any ratings on this page are from the last time it answered. Try again in a minute.';
    raw = true;
  }
  return '<div class="gr-card gr-problem"><div class="gr-problem-t">'+say+'</div><div class="gr-problem-s">'+fix+'</div>'
    + (raw ? '<div class="gr-problem-x">'+grEsc(m)+'</div>' : '') + '</div>';
}
