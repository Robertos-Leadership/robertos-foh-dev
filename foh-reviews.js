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
var GR = { loading:false, loaded:false, rows:null, err:null, open:null, seen:null, week:null, weekErr:null, pace:null, paceErr:null, raceView:'all', comp:null };

// Competitors are collected on a timer (see the cost note in the edge
// function). One sentence, reused by both the list and the empty state, so the
// two can never drift apart and tell a manager different things.
function grCompCadence(){
  var d = GR.comp && Number(GR.comp.days);
  if(!d || d < 1) return 'every few days';
  return d === 1 ? 'every night' : d === 7 ? 'once a week' : 'every '+d+' days';
}
function grCompLastSeen(){
  var l = GR.comp && GR.comp.last;
  return l ? 'last checked '+grDate(l) : '';
}

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
    // Load the WHOLE stored collection (it purges itself at 30 days), not
    // just the last 7. The race below counts reviews by the date the guest
    // wrote them, so it needs every row we still hold; the week's list and
    // the "New this week" tile are derived from it, so the two can never
    // disagree about what "this week" means.
    var mon = new Date(Date.now() - 31*24*3600*1000).toISOString();
    var w = await sb.from('google_reviews_seen')
                    .select('venue_key,review_key,rating,review_text,author,author_uri,maps_uri,publish_time,lang,first_seen')
                    .gte('publish_time', mon).order('publish_time',{ascending:false});
    if(w.error) throw w.error;
    GR.seen = w.data || [];
    var wkCut = Date.now() - 7*24*3600*1000;
    GR.week = GR.seen.filter(function(x){ return Date.parse(x.publish_time) >= wkCut; });
  }catch(e2){
    GR.seen = []; GR.week = [];
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
  // How often the competitors are actually collected, and when we last looked.
  // The screen MUST say this: from 1 Aug 2026 they are on a timer, not nightly,
  // so a short competitor list can mean "quiet week" OR "we have not looked
  // since Monday" — and those two read identically unless we print the date.
  // Same fail-alone rule: no row (or no table) just means the line is omitted.
  try{
    var cc = await sb.from('app_config').select('value').eq('key','reviews_competitors').limit(1);
    GR.comp = (!cc.error && cc.data && cc.data[0]) ? (cc.data[0].value||null) : null;
  }catch(e4){ GR.comp = null; }
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
  }

  // ── Report grid (Francesco, 12 Aug 2026; retidied same day after "untidy,
  //    unaligned"). Rules that make it read as ONE designed board and not
  //    five cards thrown at a wall:
  //      1. Every cell has the SAME anatomy — gold section label, then card —
  //         so the tops of a row align to the pixel.
  //      2. Cards in a row STRETCH to the row's height (CSS .gr-cell/.gr-card
  //         flex) — no ragged bottoms.
  //      3. Pairs are matched by height AND by story: the race sits beside
  //         its own reconciliation (the two explain each other), the quality
  //         race beside the growth line. The DIFC board takes the full row —
  //         a 5-column table with tap-to-expand panels would cramp in half.
  //    The grid opens UNCONDITIONALLY — if it only opened when rank exists,
  //    the closing tags would orphan on an empty morning.
  h.push('<div class="gr-grid">');

  h.push('<div class="gr-cell">');
  // ── The race ── counts reviews by the guest's own date; see grRaceHTML for
  //    why this is no longer built on Google's published total.
  h.push('<div class="gr-sec">The race · reviews guests wrote</div>');
  h.push(grRaceHTML());
  h.push('</div>');

  // ── The two numbers side by side, with the gaps named ──
  var recon = grReconHTML();
  if(recon){
    h.push('<div class="gr-cell">');
    h.push('<div class="gr-sec">Against Google’s published total</div>');
    h.push(recon);
    h.push('</div>');
  }

  // ── Not how many wrote, but what they gave ──
  var qual = grQualityHTML();
  if(qual){
    h.push('<div class="gr-cell">');
    h.push('<div class="gr-sec">And how they rated us · last 4 weeks</div>');
    h.push(qual);
    h.push('</div>');
  }

  // ── Our own total, morning by morning ──
  h.push('<div class="gr-cell">');
  h.push('<div class="gr-sec">Our Google total · morning by morning</div>');
  h.push(grTrendHTML());
  h.push('</div>');

  // ── Board ── full row, deliberately (see the pairing note above)
  h.push('<div class="gr-cell gr-cell-wide">');
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
  h.push('</div>'); // closes the board's .gr-cell-wide
  h.push('</div>'); // closes .gr-grid

  // ── New this week (our stored collection, newest first — the ONLY review
  //    text on this page; the raw "most relevant" five are never shown).
  //    Deliberately OUTSIDE the grid: prose reads at full width. ──
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
  return b ? ('New ratings since '+grDate(b.since)) : 'New ratings';
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

// Reported from the app on 2 Sep 2026, on this page, verbatim:
// "I dont undrastand 26% or 26 reviews +". A bar that fills a track with a
// bare number beside it reads as a percentage — and this page carries TWO
// charts drawn with identical bars whose numbers are not the same kind of
// thing at all: the race counts REVIEWS, the one below it averages STARS out
// of 5. Neither said so. So every bar chart now carries a column heading that
// names its own unit, in the same type as the table headings elsewhere on the
// page, and the delta columns say what they are a delta OF.
function grRaceHead(unit){
  return '<div class="gr-race-hd"><div>Venue</div><div></div><div>'+grEsc(unit)+'</div></div>';
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
  // No serif title inside the card any more — the cell's gold section label
  // ("Our Google total · morning by morning") is the title, same anatomy as
  // every other report, so the row tops align. The card opens with the
  // headline figure alone, sized like the race's headline numbers.
  if(rows.length>1){
    var d = Number(rows[rows.length-1].user_rating_count) - Number(rows[0].user_rating_count);
    h.push('<div class="gr-trend-head"><div class="gr-trend-plus">'
      + (d<0?'−':'+')+grNum(Math.abs(d))+' since '+grDate(rows[0].snapshot_date)+'</div></div>');
  }
  if(rows.length<2){
    h.push('<div class="gr-note">The growth line draws itself from tomorrow — it needs at least two mornings of totals. '
      + 'It can only ever show the last 30 days (Google’s rule) — the race counts the reviews themselves, by the date each guest wrote.</div>');
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
  h.push('<div class="gr-note">Our official Google total each morning. It can only ever look back 30 days (Google’s rule) — the race counts the reviews themselves, by the date each guest wrote.</div>');
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
// WHAT CHANGED, 12 Aug 2026 — read this before "restoring" the old version.
//
// This used to sum the nightly CHANGE in Google's published rating count
// (google_reviews_pace). That number is an aggregate Google recomputes on its
// own schedule, NOT a feed of reviews as they are written — the proof is that
// it falls as well as rises. On 11 Aug it added 43 to Zuma in a single night
// after three weeks of standing still: a catch-up on a stale listing, not a
// busy Tuesday. Summed, that one night was 43 of Zuma's 63 and it alone
// produced the headline "Zuma is being rated 2 times as often as we are",
// putting us 4th. The same flaw cut the other way on our own page: our count
// fell 12 in three days while 8 guests were writing about us, so a good
// weekend could show the team a bar going BACKWARDS.
//
// So the race now counts REVIEWS, each filed under the date its own guest
// wrote it (google_reviews_seen). One row per review: it cannot run backwards
// and it carries no catch-up lumps. Google's published totals are NOT thrown
// away — they are shown beside this in the reconciliation below, where the
// two are compared in the open instead of being blended into one figure.
//
// Views: last 7 days, last 4 weeks, and everything we still hold (the table
// purges at 30 days, so that is the honest limit of the long view).
function grRaceRows(days){
  var cut = days ? (Date.now() - days*24*3600*1000) : 0;
  var sums = {};
  (GR.seen||[]).forEach(function(r){
    var t = Date.parse(r.publish_time); if(!t) return;
    if(cut && t < cut) return;
    sums[r.venue_key] = (sums[r.venue_key]||0) + 1;
  });
  return GR_VENUES.map(function(v){
    return { key:v.key, name:v.name, us:!!v.us, n:(sums[v.key]||0) };
  }).sort(function(a,b){ return b.n - a.n; });
}
// A day where Google's published total jumped or fell far beyond that venue's
// normal movement — i.e. its page was recalculated, not that many guests wrote
// at once. Flagged on screen and explained in words; never silently smoothed.
// Threshold is per venue (4x its own median day, floor 8) so a busy listing is
// not judged by a quiet one's standard.
function grSpikes(){
  var by = {}, out = {};
  (GR.pace||[]).forEach(function(p){ (by[p.venue_key] = by[p.venue_key] || []).push(p); });
  Object.keys(by).forEach(function(k){
    var abs = by[k].map(function(p){ return Math.abs(Number(p.gained||0)); }).sort(function(a,b){ return a-b; });
    var med = abs.length ? abs[Math.floor(abs.length/2)] : 0;
    var thr = Math.max(8, med*4);
    by[k].forEach(function(p){
      if(Math.abs(Number(p.gained||0)) >= thr) (out[k] = out[k] || []).push(p);
    });
  });
  return out;
}
function grRaceHTML(){
  if(GR.seen===null) return '<div class="gr-card"><div class="gr-loading gr-loading-sm">Reading the collection…</div></div>';
  var v = GR.raceView, days = v==='7' ? 7 : v==='28' ? 28 : 0;
  var rows = grRaceRows(days);
  if(!rows.some(function(x){ return x.n; })){
    return '<div class="gr-card"><div class="gr-note">Nothing collected in this period yet. Reviews are gathered every night and filed under the day the guest wrote them, so the first bars appear as soon as one arrives.</div></div>';
  }
  var max = 1;
  rows.forEach(function(x){ if(x.n > max) max = x.n; });
  var spikes = grSpikes();

  var h = ['<div class="gr-card">'];
  // The long view is labelled "Last 30 days", NOT "Since <date>": the store
  // purges at 30 days (Google's licence), so its oldest review slides forward
  // every morning. Francesco read "Since 12 Jul" as a fixed start and rightly
  // asked why it disagreed with the other dates on the page — a sliding date
  // must never be dressed as an anchor.
  h.push('<div class="gr-race-tabs">'
    + '<button class="gr-race-tab'+(v==='7'?' on':'')+'" onclick="grRaceSwitch(\'7\')">Last 7 days</button>'
    + '<button class="gr-race-tab'+(v==='28'?' on':'')+'" onclick="grRaceSwitch(\'28\')">Last 4 weeks</button>'
    + '<button class="gr-race-tab'+(v==='all'?' on':'')+'" onclick="grRaceSwitch(\'all\')">Last 30 days</button>'
    + '</div>');
  h.push('<div class="gr-race-basis">Every review counted once, on the day the guest wrote it</div>');
  h.push('<div class="gr-race">');
  h.push(grRaceHead('Reviews'));
  rows.forEach(function(x){
    var pct = x.n > 0 ? Math.max(4, Math.round(x.n/max*100)) : 2;
    // No spike flag on these bars, deliberately: a spike is a fault in
    // GOOGLE'S published total, and these bars do not use it. Marking them
    // here would imply the bar is affected when it is not. The spike is named
    // in the note below and in the reconciliation, where it actually applies.
    h.push('<div class="gr-race-row'+(x.us?' gr-race-us':'')+'">'
      + '<div class="gr-race-name">'+grEsc(x.name)+'</div>'
      + '<div class="gr-race-track"><div class="gr-race-bar" style="width:'+pct+'%"></div></div>'
      + '<div class="gr-race-val">'+grNum(x.n)+'</div>'
      + '</div>');
  });
  h.push('</div>');

  // The reading, derived from the numbers on screen and nothing else.
  var us = rows.find(function(x){ return x.us; }), top = rows[0];
  if(us && top){
    var line;
    if(top.us){
      var second = rows.find(function(x){ return !x.us && x.n > 0; });
      var ratio = (second && second.n) ? (us.n/second.n) : null;
      line = '<b>We are first in DIFC'
        + (ratio && ratio >= 1.8 ? ' — twice as many guests wrote about us as about '+grEsc(second.name)
          : ratio && ratio >= 1.25 ? ' — more guests wrote about us than about '+grEsc(second.name) : '')
        + '.</b>';
    }else{
      line = '<b>'+grEsc(top.name)+' is ahead over this period</b> with '+grNum(top.n)+' to our '+grNum(us.n)+'.';
    }
    h.push('<div class="gr-note">'+line+'</div>');
  }

  // The spike, named. Only on the long view, where it is actually visible.
  if(v==='all'){
    var worst = null, worstKey = null;
    Object.keys(spikes).forEach(function(k){
      spikes[k].forEach(function(p){
        if(!worst || Math.abs(Number(p.gained)) > Math.abs(Number(worst.gained))){ worst = p; worstKey = k; }
      });
    });
    if(worst){
      var n = Math.abs(Number(worst.gained)), up = Number(worst.gained) > 0;
      h.push('<div class="gr-race-spike"><b>⚡ One night to explain — '+grEsc(grName(worstKey))+', '+grDate(worst.day)+'.</b> '
        + 'Google '+(up?'added <b>':'took <b>')+grNum(n)+'</b>'+(up?' to':' off')+' its published total in a single night. '
        + 'Reviews do not arrive in one lump like that — Google had simply not updated that page for a while and then caught up. '
        + 'The bars above are unaffected: they count each review on the day its guest wrote it.</div>');
    }
  }

  h.push('<details class="gr-fold"><summary>How this is counted</summary>'
    + '<div class="gr-note">One row per review, filed under the date the guest wrote it — not the date Google got round to counting it. '
    + 'A review already written can never be taken off the week it belongs to, so this number only ever goes up. '
    + 'Collected every night from every DIFC venue, and kept for 30 days (Google’s rule).</div></details>');
  h.push('</div>');
  return h.join('');
}
function grRaceSwitch(v){
  GR.raceView = (v==='7'||v==='28') ? v : 'all';
  renderMain();
}

// ── Against Google's published total ──────────────────────────────────────
// The two numbers side by side, over the same window. This is the honest
// answer to "then the consolidated figure won't match reality": it always
// matches — it is printed right here, and where the columns disagree the
// reason is named. Clap and Il Gattopardo landing within one of each other
// is the check that the counting method is sound.
function grReconHTML(){
  var pace = GR.pace||[];
  if(!pace.length || !(GR.seen||[]).length) return '';
  // The window must be one BOTH witnesses fully cover, or the comparison
  // quietly rots: pace history is kept forever, but the stored reviews purge
  // at 30 days (Google's licence). Anchoring on pace's first day alone meant
  // that from ~16 Aug the "guests wrote" column would silently shrink as
  // mid-July reviews aged out while the published column kept growing. So the
  // start is whichever is LATER: pace's first day, or the oldest review we
  // still hold — and the pace sums are cut to the same start, like for like.
  var oldestSeen = null;
  (GR.seen||[]).forEach(function(r){ var t=String(r.publish_time).slice(0,10); if(!oldestSeen || t<oldestSeen) oldestSeen=t; });
  var paceStart = String(pace[0].day).slice(0,10);
  var start = (oldestSeen && oldestSeen > paceStart) ? oldestSeen : paceStart;
  var startMs = Date.parse(start+'T00:00:00');
  var wrote = {}, pub = {};
  (GR.seen||[]).forEach(function(r){
    var t = Date.parse(r.publish_time);
    if(t && t >= startMs) wrote[r.venue_key] = (wrote[r.venue_key]||0)+1;
  });
  pace.forEach(function(p){
    if(String(p.day).slice(0,10) >= start) pub[p.venue_key] = (pub[p.venue_key]||0) + Number(p.gained||0);
  });
  var spikes = grSpikes();
  var rows = GR_VENUES.map(function(v){
    return { key:v.key, name:v.name, us:!!v.us, wrote:(wrote[v.key]||0), pub:(pub[v.key]!=null?pub[v.key]:null) };
  }).filter(function(x){ return x.pub!=null; }).sort(function(a,b){ return b.wrote-a.wrote; });
  if(!rows.length) return '';

  var h = ['<div class="gr-card">'];
  // The headings must stay SHORT. Spelling them out in full ("Reviews guests
  // wrote" / "Google's total moved") widened the table past its column on a
  // laptop and pushed the explanation column off the right edge behind a
  // scrollbar — seen on screen before shipping. So the unit is named in a
  // basis line above the table instead, the same as the race card does it,
  // and only "published" → "move" changes in the heading, which is what makes
  // the "+25" in that column mean something.
  h.push('<div class="gr-race-basis gr-race-basis-top">Reviews guests wrote, beside how far Google’s own published total moved over the same days</div>');
  h.push('<div class="gr-scrollx"><table class="gr-rec">'
    + '<tr><th>Venue</th><th class="n">Guests wrote</th><th class="n">Google’s move</th><th></th></tr>');
  rows.forEach(function(x){
    // The GAP is the headline where it is big — that is the thing worth
    // acting on. A one-night spike only gets the column when the two totals
    // otherwise agree, because on our own row "-8 in one night" would hide
    // the far bigger fact that Google is 30 reviews behind.
    var gap = x.wrote - x.pub, note = '', cls = 'gr-rec-ok';
    var sp = spikes[x.key] && spikes[x.key].length ? spikes[x.key][0] : null;
    // A spike is only the right caption when it is big enough to BE the
    // explanation for the gap (Zuma: +43 is why it reads 27 ahead). Our own
    // row has a small -8 spike against a 30-review gap, and captioning that
    // would hide the thing that actually matters.
    var spBig = sp && Math.abs(Number(sp.gained)) >= 15;
    if(spBig){
      note = (Number(sp.gained)>0?'+':'−')+grNum(Math.abs(Number(sp.gained)))+' in one night';
      cls = 'gr-rec-warn';
    }else if(Math.abs(gap) >= 15){
      note = 'Google '+grNum(Math.abs(gap))+(gap>0?' behind':' ahead'); cls = 'gr-rec-warn';
    }else if(sp){
      note = (Number(sp.gained)>0?'+':'−')+grNum(Math.abs(Number(sp.gained)))+' in one night';
      cls = 'gr-rec-warn';
    }else if(Math.abs(gap) <= 1){ note = '✓ within 1'; }
    else if(gap > 1){ note = 'Google '+grNum(gap)+' behind'; cls = 'gr-rec-mut'; }
    else { note = grNum(Math.abs(gap))+' ahead'; cls = 'gr-rec-mut'; }
    h.push('<tr class="'+(x.us?'gr-me':'')+'"><td class="gr-name">'+grEsc(x.name)+'</td>'
      + '<td class="n">'+grNum(x.wrote)+'</td>'
      + '<td class="n">'+(x.pub<0?'−':'+')+grNum(Math.abs(x.pub))+'</td>'
      + '<td class="n '+cls+'">'+note+'</td></tr>');
  });
  h.push('</table></div>');
  // Only venues with real volume can serve as the proof — a venue with one
  // review matching to within one proves nothing at all.
  var exact = rows.filter(function(x){ return Math.abs(x.wrote-x.pub) <= 1 && x.wrote >= 10; });
  if(exact.length){
    var nm = exact.map(function(x){ return grEsc(x.name); });
    var joined = nm.length>1 ? nm.slice(0,-1).join(', ')+' and '+nm[nm.length-1] : nm[0];
    h.push('<div class="gr-note"><b>'+joined
      + (exact.length>1?' match':' matches')+' almost exactly — that is the check that the count is sound.</b> '
      + 'Where the two columns disagree, something happened to Google’s page, and it is named above rather than hidden.</div>');
  }
  var usRow = rows.find(function(x){ return x.us; });
  if(usRow && (usRow.wrote - usRow.pub) >= 15){
    h.push('<div class="gr-race-spike"><b>Worth watching on our own page.</b> '
      + grNum(usRow.wrote)+' guests wrote about us since '+grDate(start)+'; Google’s published total moved '+grNum(usRow.pub)+'. '
      + 'Google prunes reviews it judges to be spam — nothing the team did, but it means roughly half of what they earn is not showing on our public number.</div>');
  }
  h.push('</div>');
  return h.join('');
}

// ── How they rated us ─────────────────────────────────────────────────────
// The other half of the race: not how many wrote, but what they gave. A venue
// with too few reviews to judge is shown greyed with its count, never ranked
// away — one 5-star review must never top this chart.
function grQualityHTML(){
  var cut = Date.now() - 28*24*3600*1000, agg = {};
  (GR.seen||[]).forEach(function(r){
    var t = Date.parse(r.publish_time); if(!t || t < cut) return;
    if(r.rating==null) return;
    var a = agg[r.venue_key] = agg[r.venue_key] || { s:0, n:0 };
    a.s += Number(r.rating); a.n++;
  });
  var MIN = 15;
  var rows = GR_VENUES.map(function(v){
    var a = agg[v.key];
    return { key:v.key, name:v.name, us:!!v.us, avg:(a&&a.n?a.s/a.n:null), n:(a?a.n:0) };
  }).filter(function(x){ return x.avg!=null; });
  if(!rows.length) return '';
  // Rankable venues first, best score down. The too-few ones sit BELOW them,
  // greyed — never above. One 5-star review must not appear to be winning,
  // which is exactly what sorting on the average alone would show.
  rows.sort(function(a,b){
    var ra = a.n >= MIN ? 1 : 0, rb = b.n >= MIN ? 1 : 0;
    return (rb - ra) || (b.avg - a.avg);
  });
  var ranked = rows.filter(function(x){ return x.n >= MIN; });
  // Scale from 3.0 so the gap between a 4.7 and a 3.9 is visible, not a
  // near-identical pair of full bars.
  var lo = 3.0;
  var h = ['<div class="gr-card">',
    '<div class="gr-race-basis gr-race-basis-top">The average number of stars guests gave, out of 5</div>',
    '<div class="gr-race">', grRaceHead('Stars')];
  rows.forEach(function(x){
    var thin = x.n < MIN;
    var pct = Math.max(4, Math.round(((x.avg-lo)/(5-lo))*100));
    h.push('<div class="gr-race-row'+(x.us?' gr-race-us':'')+(thin?' gr-race-thin':'')+'">'
      + '<div class="gr-race-name">'+grEsc(x.name)+'</div>'
      + '<div class="gr-race-track"><div class="gr-race-bar" style="width:'+pct+'%"></div></div>'
      + '<div class="gr-race-val">'+x.avg.toFixed(2)+'</div>'
      + '</div>');
  });
  h.push('</div>');
  var usRow = ranked.find(function(x){ return x.us; });
  if(usRow && ranked[0] && ranked[0].us){
    h.push('<div class="gr-note"><b>Of the venues with enough reviews to compare, nobody in DIFC is scoring higher than us on what guests wrote this month.</b> Averaged over '+grNum(usRow.n)+' reviews.</div>');
  }else if(usRow){
    h.push('<div class="gr-note">Averaged over '+grNum(usRow.n)+' reviews written in the last four weeks.</div>');
  }
  var few = rows.filter(function(x){ return x.n < MIN; });
  if(few.length){
    h.push('<div class="gr-note gr-mut-sm">'
      + few.map(function(x){ return grEsc(x.name)+' ('+x.n+' review'+(x.n===1?'':'s')+')'; }).join(', ')
      + ' '+(few.length>1?'are':'is')+' in grey — too few to rank fairly.</div>');
  }
  h.push('</div>');
  return h.join('');
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
  // The "New since" column is the movement in GOOGLE'S PUBLISHED TOTAL, and
  // 12 Aug 2026 taught us what that is worth on its own: this note used to
  // read "<venue> has collected N new ratings to our M — they are being
  // reviewed more often than we are", and on 11 Aug Google added 43 to Zuma
  // in one night after three weeks of not updating that page. The sentence
  // was true of the column and false about the world.
  // So the column stays (it reconciles with Google, always) and the CONCLUSION
  // is gone. Who is actually being reviewed more often is answered by the
  // race above, which counts each review on the day its guest wrote it.
  var withDelta = board.filter(function(x){ return x.delta!=null; });
  if(withDelta.length && us.delta!=null){
    var fastest = withDelta.slice().sort(function(a,b){ return (b.delta||0)-(a.delta||0); })[0];
    if(fastest && !fastest.us && fastest.delta > us.delta){
      bits.push('<b>'+grEsc(fastest.name)+'’s published total has moved '+grNum(fastest.delta)+' since '+grDate(fastest.since)
        +', against our '+grNum(us.delta)+'.</b> That is Google’s own counter, which it recalculates in its own time — '
        + 'for who is genuinely being reviewed more often, read the race above.');
    }
  }else{
    bits.push('This column is Google’s published total, which it removes after 30 days — so it can never look back further than that. '
      + 'The race above counts each review on the day its guest wrote it, and the two are compared side by side further up.');
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
    // An empty competitor list has TWO possible causes — a genuinely quiet
    // week, or simply that we have not looked since the last round. Saying
    // "quiet weeks happen" alone would let a manager read the second as the
    // first, so the date we last looked is part of the sentence, not a detail.
    var why = mine
      ? 'No review under a week old has been written for us — quiet weeks happen. '
        + 'The nightly collection brings anything new in by the next morning.'
      : 'Nothing collected for '+grEsc(grName(key))+' in the last 7 days. '
        + 'We check them '+grCompCadence()+(grCompLastSeen() ? ' — '+grCompLastSeen() : '')
        + ', so this can mean a quiet week or simply that nothing has been collected since then.';
    return '<div class="gr-card"><div class="gr-note">'+why+'</div></div>';
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
  // Honesty about scope. Both lists now reach the full 7 days (competitors are
  // paginated too), so the caveat is no longer "this is only a sample" — it is
  // "this is current as of the last time we looked". Say when that was.
  h.push('<div class="gr-attrib gr-attrib-sm">'
    + (mine ? 'Every review written in the last 7 days, collected nightly — newest first, kept 30 days, then deleted.'
            : 'Their reviews from the last 7 days. We check them '+grCompCadence()
              + (grCompLastSeen() ? ' — '+grCompLastSeen() : '')
              + ', so anything posted since then is not here yet. Their rating and count above are updated nightly.')
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
