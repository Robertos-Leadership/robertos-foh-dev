/* ═══════════════════════════════════════════════════════════════════════════
   foh-rounds.js — ONE round, ONE place.

   A feedback round used to live in three lists across two files: the questions
   in foh-feedback.html (SETS), the round's name in index.html (FB_TOPIC_NAMES),
   and the email/WhatsApp words in index.html (FB_EMAIL). Nothing linked them,
   so each one you forgot failed differently and silently:
     · no FB_TOPIC_NAMES entry → the round was not in the Send dropdown AT ALL,
       so a round you had fully written could not be sent;
     · no FB_EMAIL entry      → admFbEmailFor fell back to events-20's words, so
       the COO would receive "we tested the app against 20 real enquiries" with
       a button to a completely different questionnaire;
     · and Admin could never print a question, only its number ("3. flagged by
       1"), because it had no way to see the label: sitting right here.

   Now a round is one object, read by BOTH the Admin screen (index.html) and the
   questionnaire the team answer on their phone (foh-feedback.html). To add a
   round, add ONE entry below. There is nothing else to remember.

   ORDER MATTERS: newest round FIRST. The "Which round" dropdown and the round
   it defaults to both follow the order of this object.

   ── fixes: ──────────────────────────────────────────────────────────────────
   A follow-up round's item may declare which earlier item it CLOSED:
   fixes:'coo-events/3'. Without it, Admin showed nine things as "not started"
   that we had already fixed, shipped, and TOLD Andrea about in round 2 — he
   answered "Agree, this is fine" on every one. The screen was handing Francesco
   a to-do list he had already done, because the two rounds could not see each
   other. The claim is not ours either: it is only counted as confirmed when the
   person who asked says so, and if they answer "NO — there's a problem" it goes
   straight back to open. See admFbStateOf in index.html.

   ── Answer keys, and why old rounds have no ids ──────────────────────────────
   Answers are stored as {"<key>": {a:'…', note:'…'}}. The key is item.id when
   an item has one, else its 1-based position. The three rounds below have real
   answers in app_feedback keyed by POSITION, so they deliberately have no ids —
   adding them would silently re-point every answer Andrea and Valentina already
   sent. New rounds SHOULD give every item a short stable id, so that inserting
   a question later can never re-point old answers.

   This file must stay plain, standalone and dependency-free: foh-feedback.html
   loads it with no login, no app shell and no Supabase client.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── The answer vocabulary. Shared, so a round can no longer invent an answer
// that Admin does not understand. This used to be two lists in two files kept in
// step by a comment ("Any value used here MUST also be listed in FB_ANSWER_ORDER
// in index.html, or Admin counts it as a request to fix").
var FB_A = {
  FIX:  'Fix this',
  PROB: "NO — there's a problem",
  GO:   'Go ahead',
  NICE: 'Nice to have',
  WAIT: 'Not yet',
  FINE: 'Agree, this is fine',
  NEVER:"Doesn't happen",
  LEAVE:'Leave as is'
};

// The three answers a round offers. A round picks one set via `ask:`.
//   STANDARD — "does this happen to you?"  (someone describing their own day)
//   COO      — "is this worth fixing?"     (someone judging a report)
//   GO       — "this costs someone real work — do we do it?"
// OK is not chosen by a round: it is what an item marked works:true always uses.
var FB_ASK = {
  STANDARD: [FB_A.FIX, FB_A.NICE, FB_A.NEVER],
  COO:      [FB_A.FIX, FB_A.NICE, FB_A.LEAVE],
  GO:       [FB_A.GO,  FB_A.WAIT, FB_A.LEAVE],
  OK:       [FB_A.FINE, FB_A.PROB]
};

// How the phone page words each answer on its button.
var FB_ASK_LABEL = {};
FB_ASK_LABEL[FB_A.PROB]  = 'Actually, there’s a problem';
FB_ASK_LABEL[FB_A.NEVER] = 'Doesn’t happen to me';
FB_ASK_LABEL[FB_A.LEAVE] = 'Leave it as it is';
FB_ASK_LABEL[FB_A.GO]    = 'Yes — go ahead';
FB_ASK_LABEL[FB_A.WAIT]  = 'Not yet';
FB_ASK_LABEL[FB_A.FIX]   = 'Yes — fix this';

// Display order in Admin: loudest first. Every answer any round can produce must
// be here or it renders no pill at all (the pills filter THIS list).
var FB_ANSWER_ORDER = [FB_A.FIX, FB_A.PROB, FB_A.GO, FB_A.NICE, FB_A.WAIT, FB_A.FINE, FB_A.NEVER, FB_A.LEAVE];

// Which answers mean "he is asking us to DO something". An EXPLICIT set: this was
// once inferred from position (indexOf(v) > 1), which quietly made any answer
// missing from the order list count AS work (indexOf → -1, and -1 is not > 1).
// Listing them means a new answer is opt-in, never work by accident.
var FB_WORK_ANSWERS = {};
FB_WORK_ANSWERS[FB_A.FIX] = 1;
FB_WORK_ANSWERS[FB_A.PROB] = 1;
FB_WORK_ANSWERS[FB_A.GO] = 1;

// ── The rounds. Newest first. ───────────────────────────────────────────────
var FB_ROUNDS = {
  'events-20-2': {
    name: 'Events — what we fixed for you (round 2)',
    follows: 'events-20',
    email: {
      subject:'Nine of the things you flagged are fixed — can you check them?',
      body:['You went through 20 real enquiries with us and told us what the app got wrong. <b>Nine of those are fixed and live now.</b>',
            'Each one below says what changed and <b>how to check it yourself</b> in the app. If we got any of them wrong, say so — that is exactly what this is for.',
            'A few minutes on your phone. The ones we have not built yet are not in here; we will come back to you on those separately.'],
      cta:'See what changed',
      wa:'Nine of the things you flagged in the events app are fixed and live. Each one tells you how to check it yourself — and if we got any of them wrong, just say so.'
    },
    title: 'What we fixed for you',
    okLabel: 'Fixed — live now',
    intro: [
      'You went through 20 real enquiries and told us which ones the app got wrong. <b>Nine of them are fixed and live now.</b>',
      'Each one says what changed and how to check it yourself. If we got one wrong, tell us — that is the whole point of asking you.'
    ],
    howto: 'Read each one and check it in the app if you want to. Tap <b>Agree, this is fine</b> if it looks right, or <b>Actually, there is a problem</b> if we got it wrong.<br><br>Answers save on this phone as you go. Tap <b>Send my answers</b> when you are done.',
    lastQ: 'Anything else you have run into since we last spoke?',
    items: [
      { id:'lead-source', fixes:'events-20/3',
        said: 'You said there was nowhere to record who sent you a booking — so a promoter and what they were owed lived in your phone, and nobody upstairs knew that channel existed.',
        today: 'Done. Every booking now records <b>where it came from</b> and <b>who is handling it</b> — walk-in, referral, promoter or the call centre — with a note for what the promoter is owed.<br><br><i>Check it:</i> open any enquiry — Lead source and Handler sit with the client details.',
        works: true,
        label: 'Lead source + handler on every booking — DONE' },
      { id:'hold-date', fixes:'events-20/4',
        said: 'You wanted to hold a date until Friday. You also said it should be <b>“as a option, not automatic”</b>.',
        today: 'Done, and optional exactly as you asked — nothing runs itself. You can <b>hold a date until a day you choose</b>; it shows as HELD, and turns to HOLD EXPIRED once that day passes.<br><br><i>Check it:</i> open a booking and set Hold until a date.',
        works: true,
        label: 'Hold a date, optional, with an expiry — DONE' },
      { id:'false-clash', fixes:'events-20/6',
        said: 'A lunch and a dinner in the same room on the same day — the app warned you about a clash that was not real.',
        today: 'Done. The clash check now reads the <b>time</b>, not just the date and the room, so a lunch and a dinner in one room no longer warn.<br><br><i>Check it:</i> put a lunch and a dinner in the same room on one day — no warning.',
        works: true,
        label: 'No more warnings about clashes that are not real — DONE' },
      { id:'buyout-clash', fixes:'events-20/7',
        said: 'A full venue buyout on a night something else was already booked — the app said nothing at all. This was the one that could actually double-book us.',
        today: 'Done. A buyout now <b>clashes with anything else booked that day</b>, because it takes the whole venue.<br><br><i>Check it:</i> put a full buyout over an existing booking — it warns you now.',
        works: true,
        label: 'A buyout now warns about a double-booking — DONE' },
      { id:'one-minimum', fixes:'events-20/9',
        said: 'Minimum 25 but expecting 30 — the agreement showed the client <b>two different numbers on one page</b>.',
        today: 'Done. There is one clear figure now: <b>Guests the client pays for (minimum)</b>. One number, one deal, in front of the client.<br><br><i>Check it:</i> open a minimum-spend booking.',
        works: true,
        label: 'One clear minimum on the agreement — DONE' },
      { id:'gluten-tag', fixes:'events-20/10',
        said: 'Coeliac had nowhere to go — gluten was not a tag, so it only ever lived in a note and the allergy check could not see it.',
        today: 'Done. <b>Gluten is a proper allergen code now (G)</b>, next to nuts and dairy, so the allergy check sees it.<br><br><i>Check it:</i> tag a dish — G for gluten is in the list with the others.',
        works: true,
        label: 'Gluten is a real allergen tag — DONE' },
      { id:'keep-deposit', fixes:'events-20/16',
        said: 'Signed, deposit paid, then “make it 32” — the booking dropped back to <b>proposal sent</b> and the deposit disappeared out of the confirmed figures.',
        today: 'Done. Changing the guest count now <b>keeps the booking confirmed and keeps the deposit</b>. Only the agreement needs signing again, and the app tells you so before you change anything.<br><br><i>Check it:</i> change the guest count on a signed, paid booking.',
        works: true,
        label: 'A guest change keeps the booking and the deposit — DONE' },
      { id:'offmenu-kitchen', fixes:'events-20/17',
        said: 'An a la carte dish on an event was priced right but <b>never reached the kitchen</b>.',
        today: 'Done. A dish added that way is now an <b>off-menu line that reaches the kitchen list</b>, so the money and the prep agree.<br><br><i>Check it:</i> add an a la carte dish to an event, then look at the kitchen list.',
        works: true,
        label: 'A la carte reaches the kitchen — DONE' },
      { id:'deposit-outcome', fixes:'events-20/19',
        said: 'They cancel three weeks out with the deposit already paid — there was nowhere to say what happened to that money.',
        today: 'Done. When a booking is lost you now record whether the deposit was <b>kept, refunded, or moved</b> to another date, instead of it ending in a free-text note.<br><br><i>Check it:</i> mark a booking lost.',
        works: true,
        label: 'What happened to the deposit is recorded — DONE' }
    ]
  },

  'coo-events-2': {
    name: 'Events — what we fixed, what needs Valentina (COO round 2)',
    follows: 'coo-events',
    email: {subject:'Your events feedback — 9 fixed and live, 3 need your decision',
    body:['You flagged 11 things on the events Calendar and Monthly report. <b>Nine are fixed and live now</b> — the link below lists each one so you can check them against the app.',
          'The other three can’t be done quietly. They change how <b>Valentina</b> works day to day: new fields on every enquiry, and a new step after each event. She’d need training, and it’s a real cost to her.',
          '<b>That’s your call, not ours.</b> Say go ahead or not on each one.'],
    cta:'See what changed',
    wa:'Nine of the 11 things you flagged on the events reports are fixed and live — you can check them. The other three change how Valentina works day to day and she’d need training, so we’re not doing them without your say-so.'
    },
    title: 'What we fixed — and what needs Valentina',
    ask: FB_ASK.GO,
    okLabel: 'Fixed — live now',
    intro: [
      'You flagged 11 things on the events Calendar and Monthly report. <b>Nine are fixed and live.</b> They are listed first so you can check each one against the app — if we got any of them wrong, say so.',
      'The last three can’t be done quietly. They change <b>how Valentina works every day</b>: new fields on every enquiry, and a new step after each event. She would need training, and it is real time out of her week.',
      '<b>That is your call, not ours.</b> Go ahead or not on each.'
    ],
    howto: 'The first nine are done — tap <b>Agree, this is fine</b> or tell us we got it wrong. The last three are decisions: each one says plainly what it costs Valentina before you answer.<br><br>Answers save on this phone as you go. Tap <b>Send my answers</b> when you’re done.',
    lastQ: 'Anything you expected to see fixed that isn’t here?',
    items: [
      { said: 'You said: “unconfirmed prospect without a date should be recorded under leads … not included in the pipeline yet”.',
        today: 'Done. An undated, unconfirmed enquiry is now a <b>Lead</b> — its own list under the calendar, flagged to be chased, and <b>out of the pipeline</b>. Before, an undated maybe inflated the pipeline while an undated <i>confirmed</i> booking counted in nothing at all and showed on no screen. That one is now named too, so it can’t go missing.',
        works: true,
        fixes: 'coo-events/1',
        label: 'Leads bucket, out of pipeline — DONE' },
      { said: 'You said: “year to date should reflect year to date only, future confirmed event on the book are converted pipeline”.',
        today: 'Done, exactly as you put it. <b>Year to date</b> now stops at today. Future confirmed bookings have their own figure called <b>Converted pipeline</b>. Before, a December buyout was sitting inside “2026 to date”.',
        works: true,
        fixes: 'coo-events/3',
        label: 'YTD is to-date only; future confirmed = converted pipeline — DONE' },
      { said: 'You said: “we need to know whats a prospect, tentative and converted”.',
        today: 'Done. The report now splits and names them: <b>Prospect</b> (dated, not yet quoted), <b>Tentative</b> (quoted, waiting on the client), <b>Converted</b> (confirmed, deposit or delivered). Leads sit outside. <i>One thing to check:</i> we read “prospect” as an enquiry with a date that we haven’t quoted yet. If you meant something else, tell us — we guessed.',
        works: true,
        fixes: 'coo-events/8',
        label: 'Prospect / tentative / converted named and split — DONE (check our reading)' },
      { said: 'You said the minimum-spend balance “is to be billed as venue rental”.',
        today: 'Half done. A minimum-spend booking is now valued at <b>its minimum</b> everywhere — the report used to say 60k while the contract said 150k. So the money is right. <b>Splitting</b> that balance into F&B, extras and rental is the third decision at the bottom of this list.',
        works: true,
        fixes: 'coo-events/2',
        label: 'Min-spend valued at the contract — DONE (the split is below)' },
      { said: 'You said: “should have both numbers”.',
        today: 'Done. Every total now shows <b>gross and net</b> together, and says which is which. Gross is what the client is quoted; net is what finance books.',
        works: true,
        fixes: 'coo-events/4',
        label: 'Gross and net side by side — DONE' },
      { said: 'You said: “Buy out … should be better monitored by highlighting them”.',
        today: 'Done. A full buyout is now marked on the calendar with a heavy border and a dot, and flagged in the report table, so it never reads like a normal booking in one room.',
        works: true,
        label: 'Buyouts highlighted — DONE' },
      { said: 'The report showed August’s bookings under July’s headline numbers.',
        today: 'Done. Every figure now follows the month you are actually looking at.',
        works: true,
        fixes: 'coo-events/6',
        label: 'Headline numbers follow the month you are viewing — DONE' },
      { said: 'You asked what we convert and what we walked away from.',
        today: 'Done. The report now shows a <b>conversion rate</b> (won against everything decided) and what we <b>lost as a value</b>, not just a count.',
        works: true,
        fixes: 'coo-events/7',
        label: 'Conversion rate + value of what we lost — DONE' },
      { said: 'You asked whether a month’s number was any good.',
        today: 'Done. Each month is now shown <b>against the month before</b>, with the change as a percentage. The group tables also add up to their own totals now — before, the column shown and the total underneath were two different numbers.',
        works: true,
        fixes: 'coo-events/9',
        label: 'Month vs previous month + tables that add up — DONE' },

      { said: 'You said: “lead from and handler need to be there”.',
        today: '<b>Not done — this needs Valentina.</b> There is nowhere to record where a booking came from or who is handling it, so it means <b>two new fields she must fill on every enquiry</b>. We would make them dropdowns and default the handler to whoever created it, but it is still two more things to complete on every single booking, and she would need training on it. <b>Cost to her:</b> small but permanent — every enquiry, forever.',
        shipped: { build:'2026-07-17.1', in:'ed3682b', what:'Done — and it is the same work that answered Valentina, so it cost her once, not twice. Every booking records where it came from and who is handling it, and the handler <b>defaults to whoever created it</b>, so it is one dropdown rather than two chores on every enquiry.', check:'Open any enquiry — Lead source and Handler sit with the client details.' },
        label: 'Lead source + handler — 2 new fields on every enquiry (Valentina)' },
      { said: 'You said: “minimum target sale expressed in number of events and revenue”.',
        today: '<b>Not done — but this one is free.</b> There is no events target at all today, so nothing can say whether a month is on plan. Setting it is an admin screen: <b>Valentina is not affected</b> and does not touch it. We only need the numbers from you — how many events and what revenue, per month.',
        label: 'Events target: number of events + revenue (no Valentina impact)' },
      { said: 'You said the minimum-spend balance is “to be billed as venue rental”.',
        today: '<b>Not done — this is the big one for Valentina.</b> To split a booking into F&B consumed, extras (decoration, AV, staffing) and the rental balance, someone has to <b>enter what the guest actually consumed after the event</b>, plus each extra. That is a new step she does not do today, on every buyout, after the night. <b>Cost to her:</b> real — a new post-event routine and training. <b>Worth knowing:</b> the money is already correct without this; it only splits the total into its parts for finance.',
        label: 'Venue rental split — new post-event step for Valentina' }
    ]
  },

  'coo-events': {
    name: 'Events — Calendar & Monthly report (COO review)',
    email: {subject:'Events reporting — 11 things need your call',
    body:['We put the events Calendar and Monthly report through the questions you would ask: what is the book worth, are we converting, can I send this to the board. It ran the app’s real calculations, not screenshots.',
          '<b>11 things need your call.</b> Some are plainly wrong and we fix them either way. Others the app simply doesn’t do — they may not matter to you. Nothing gets built until you’ve been through it.',
          'A few minutes on your phone. Revenue is a separate round, coming next.'],
    cta:'Take a look',
    wa:'We put the events Calendar and Monthly report through the questions you’d ask — what’s the book worth, are we converting, can I send this to the board. 11 things need your call.'
    },
    title: 'Events — Calendar & Monthly report',
    ask: FB_ASK.COO,
    intro: [
      'An AI took your seat — a hospitality COO — and put your questions through the events <b>Calendar</b> and <b>Monthly report</b>: what is the book worth, are we converting, can I send this to the board? Not screenshots: it ran the app’s real calculations and checked what came back.',
      '<b>11 things need your call.</b> Some are plainly wrong and we fix them either way. Others the app simply doesn’t do — they may not matter to you. <b>Revenue is a separate round, coming next.</b> Nothing gets built until you’ve been through it.'
    ],
    howto: 'Tap an answer on each one. <b>Leave it as it is</b> is a real answer — several here probably deserve it. The two marked <b>Works today</b> already work; they’re here so you get the whole picture, not just complaints.<br><br>Answers save on this phone as you go. Tap <b>Send my answers</b> when you’re done.',
    lastQ: 'What do you need to see that isn’t on this list?',
    items: [
      { said: '“Where is the Mubadala booking? 90 covers, confirmed, 180k.”',
        today: 'It has no date yet, so it is <b>invisible everywhere</b> — off the calendar, out of the monthly report, and out of every headline number. It counts in nothing. Meanwhile a dateless <i>enquiry</i> still counts in the pipeline. So a maybe inflates the pipeline while a confirmed booking disappears.',
        label: 'Confirmed event with no date is invisible and counts in nothing' },
      { said: '“Their minimum is 150k but they only ordered 60k of food. What do we book?”',
        today: 'Two different answers from the same app. The <b>agreement</b> says AED 150,000 — the minimum they are contractually bound to pay, and the deposit is worked out from it. The <b>report</b> says AED 60,000. Every headline number under-reports that booking by 90k, and the report contradicts the contract we signed.',
        label: 'Report values a min-spend event at 60k when the contract says 150k' },
      { said: '“What have events done year to date?”',
        today: 'The card says “2026 to date” but it counts the <b>whole year</b>, including bookings that have not happened yet. Ours read AED 670,000 — it included a confirmed December buyout. The true year-to-date was AED 110,000. Reconcile that against finance and you are over by every forward booking.',
        label: '"2026 to date" includes future bookings that have not happened' },
      { said: '“Is that 350,000 net or gross?”',
        today: 'Gross — and <b>nothing on the report says so</b>. Every value here is the price the client is quoted, carrying 23.585% of service charge, DIFC fee and VAT. So it is not the number finance books, and it cannot be compared against a net figure without stripping that out first. AED 350,000 here is about AED 283,000 net.',
        label: 'Every value on the report is gross — nothing says so' },
      { said: '“How much money is on the calendar in July?”',
        today: 'The calendar shows the client’s name and the number of covers — <b>never the value</b>. The header counts events but never adds them up. A 400k full buyout looks exactly like a 45k gathering.',
        label: 'Calendar shows names and covers — never money' },
      { said: '“I clicked through to August — did the whole page move?”',
        today: 'Only half of it. The <b>headline cards stay on today’s month</b> while the tables below move to August. One screen showing two different months, with nothing saying so.',
        label: 'Monthly report shows August tables under July headline numbers' },
      { said: '“What percentage of enquiries do we convert, and what did we walk away from?”',
        today: 'Unanswerable. The report counts how many were lost but <b>never what they were worth</b>, and nothing works out a win rate. All the information is already there — including the reason each one was lost.',
        label: 'No conversion rate, no win/loss, no value of what we lost' },
      { said: '“Is that 585k pipeline real?”',
        today: 'It counts a <b>rough draft and a sent proposal at the same full value</b>, with no weighting and no split. A 55k draft that might be nothing and a 400k proposal sitting on the client’s desk are the same money in that number.',
        label: 'Pipeline counts a rough draft the same as a sent proposal' },
      { said: '“Is 350,000 a good July?”',
        today: 'Nothing on the page can tell you. It is a snapshot — <b>no last month, no last year, no trend</b>. It states a number and never a verdict.',
        label: 'Monthly report compares to nothing — no last month, no last year' },
      { said: '“What were events supposed to deliver this month?”',
        today: 'There is <b>no events target or budget at all</b> — no field, nowhere to put one. So every figure in this report is an absolute with nothing to measure it against. It can state a number, never a verdict.',
        label: 'No events budget or target exists at all' },
      { said: '“Who sold these, and where did they come from?”',
        today: 'Not recorded. There is <b>no owner and no source</b> on a booking — walk-in, referral, the call centre, a promoter, all the same. So you cannot see where the business comes from or who is performing, and the CRM has nothing to match against.',
        label: 'No record of who sold a booking or where it came from' },

      { said: '“What is confirmed between October and December, and what is still only hopeful?”',
        today: 'Pick any two dates and it splits confirmed from pipeline, lists every booking behind the number, and will <b>print it or email it</b> from the same screen. Nothing to fix — this is the strongest thing in the module.',
        works: true,
        label: 'Forecast any period — confirmed vs pipeline, prints and emails' },
      { said: 'You open the calendar on your phone between meetings.',
        today: 'Every booking is <b>colour-coded by status</b> with the legend always on screen, and on a phone it becomes a clean day-by-day list instead of an unreadable grid. Nothing to fix.',
        works: true,
        label: 'Calendar reads at a glance, and works on a phone' }
    ]
  },

  'events-20': {
    name: 'Events — the 20 enquiries we tested',
    email: {subject:'Two minutes on the Events app — what should we fix?',
    body:['We tested the app against 20 real enquiries — the kind that land in your WhatsApp on a normal week. Some it handled well, some it made you do the work yourself, and a few it got wrong.',
          'Before we change anything we want your read: which of these actually happen to you, and which are worth fixing? It takes a few minutes on your phone, and there are no wrong answers.'],
    cta:'Tell us what to fix',
    wa:'We tested the app against 20 real enquiries — the kind you get on a normal week. Before we change anything we’d like your read: which of these actually happen to you, and which are worth fixing?'
    },
    title: 'The 20 enquiries we tested',
    intro: [
      'We put 20 real-life enquiries through the Events app — the kind that land in your WhatsApp and your inbox on a normal week. Some it handled perfectly. Some it made you do the work yourself. A few it got quietly wrong.',
      'Before we change anything, we want to hear from you: which of these actually happen to you, and which are worth our time to fix?'
    ],
    items: [
      { said: 'WhatsApp: “Cortile, 40 people, 12 August, 250 a head, no beef.”',
        today: 'The quote tool asks you for the <b>total</b> budget, not the price per head — so you do 250 × 40 in your head first. Then the quote it builds has <b>no email or phone on it</b>, so you can\'t send it to the guest until you open it up and type their details again.',
        label: 'WhatsApp budget quote — total not per head, no contact on it' },
      { said: '“Anniversary dinner, 12 of us, something plated.”',
        today: 'The quote-from-a-budget tool only works from <b>15 people up</b>. Below that you price it by hand.',
        label: 'Small plated dinner (12 pax) — quote tool won\'t go under 15' },
      { said: 'A promoter: “I\'m bringing a table of 30 — my usual 10%.”',
        today: 'There is <b>nowhere in the app</b> to record who sent you the booking, or what they\'re owed. So the promoter\'s side of it lives in your phone, and nobody upstairs can see that channel exists at all.',
        shipped: { build:'2026-07-17.1', in:'ed3682b', what:'Every booking now records where it came from and who is handling it — walk-in, referral, promoter or call centre.', check:'Open any enquiry — there is a Lead source dropdown, a Handler, and a note for what the promoter is owed.' },
        label: 'Promoter commission — nowhere to record who sent the booking' },
      { said: '“Can you hold the 19th for me until Friday?”',
        today: 'There\'s no way to <b>hold</b> a date. You can only leave it as a draft, and a draft sits there forever — nothing tells you Friday came and went, and nothing warns anyone else that the date is spoken for.',
        shipped: { build:'2026-07-17.1', in:'ed3682b', what:'You can hold a date until a chosen day — it shows a HELD chip, and flips to HOLD EXPIRED once that day passes.', check:'Open a booking and set Hold until a date — the calendar marks it HELD.' },
        label: 'Holding a date until Friday — no hold, no expiry' },
      { said: '“Canapés in the Cortile first, then dinner in Piemonte.”',
        today: 'A booking can only be in <b>one place</b>. To describe this you build two separate bookings — and the guest gets two prices for one evening.',
        label: 'Two spaces in one evening (Cortile then Piemonte)' },
      { said: 'A lunch and a dinner, same room, same day, two different clients.',
        today: 'The app <b>warns you they clash</b> — even though they don\'t. It only looks at the date and the room, never the time. Get warned enough times about nothing and you stop reading the warnings.',
        shipped: { build:'2026-07-17.1', in:'1827a80', what:'The clash check now reads the time, not just the date and room — a lunch and a dinner in the same room no longer warn about nothing.', check:'Put a lunch and a dinner in the same room on one day — no false clash warning.' },
        label: 'Lunch + dinner same room same day — warns about a clash that isn\'t real' },
      { said: 'A full venue buyout — on a night Piemonte is already booked.',
        today: 'The app says <b>nothing at all</b>. No warning, no flag. It only spots a clash when the two bookings name the exact same room, so a buyout never clashes with anything. This is the one that could actually double-book us.',
        shipped: { build:'2026-07-17.1', in:'1827a80', what:'A full buyout now collides with anything else booked that day, because it takes the whole venue — so it can no longer double-book silently.', check:'Add a full buyout over an existing booking — it now warns you.' },
        label: 'Full venue buyout over an existing booking — NO warning at all' },
      { said: '“Give them 10% off.”',
        today: 'You can only type a discount <b>in dirhams</b>, so you work the percentage out yourself. And if the guest count changes later, that dirham figure stays put — so the 10% you promised quietly becomes 8%, and the agreement they signed still says the old number.',
        label: '10% off — discount is dirhams only and drifts when pax change' },
      { said: '“Let\'s say a minimum of 25, but we\'re expecting 30.”',
        today: 'The agreement the guest signs shows them the <b>price for 30</b> and, in the same breath, says <b>minimum guaranteed 25</b>. Two different numbers describing one deal, on one page, in front of the client.',
        shipped: { build:'2026-07-17.1', in:'1827a80', what:'The agreement now shows one figure — Guests the client pays for (minimum) — instead of two different numbers on the same page.', check:'Open a minimum-spend booking — the minimum is a single clear field.' },
        label: 'Minimum 25 / expecting 30 — agreement shows two different numbers' },
      { said: '“Two vegans, one coeliac, and one severe nut allergy.”',
        today: 'Nuts and vegetarian are proper tags on every dish — those work. <b>Gluten isn\'t there at all.</b> So coeliac only ever lives in a note, and the app\'s allergy check can\'t see it. It will let that proposal go out saying everything\'s clear.',
        shipped: { build:'2026-07-17.1', in:'1827a80', what:'Gluten is now a proper allergen code (G), so coeliac is tagged like nuts and dairy and the allergy check can see it.', check:'Tag a dish — G for gluten sits in the allergen list with the others.' },
        label: 'Coeliac / gluten — no gluten tag exists, allergy check can\'t see it' },
      { said: 'Corporate: “Send an invoice against our PO, 30 days, and quote us without VAT.”',
        today: 'None of that exists — no PO, no invoice, no TRN, and every price is fixed as VAT-included. Payment is the card link only. This one goes back to email and a spreadsheet.',
        label: 'Corporate PO / invoice / 30 days / ex-VAT — none of it exists' },
      { said: '“Send me three options and I\'ll pick one.”',
        today: 'You build <b>three separate bookings</b>. The guest gets three emails, and your pipeline now shows three enquiries where there\'s really one. When they choose, you tidy up the other two by hand.',
        label: 'Send me 3 options — three separate bookings and three emails' },
      { said: '“Either the 12th or the 19th — whichever you have.”',
        today: 'One booking holds <b>one date</b>. So it\'s two drafts, and one of them is going to be forgotten.',
        label: 'Two possible dates — one booking holds one date only' },
      { said: '“Same dinner, first Thursday of every month.”',
        today: 'No repeat. That\'s twelve bookings built by hand, one at a time.',
        label: 'Monthly recurring dinner — no repeat, 12 by hand' },
      { said: '“We\'d rather pay 20% now, not 50%.”',
        today: 'You change the deposit to 20% and everything follows it — the agreement, the amount, the payment link. Nothing to fix.',
        works: true,
        label: '20% deposit instead of 50%' },
      { said: 'Signed, deposit paid — then: “Make it 32, we\'ve got two more coming.”',
        today: 'You change the number, and the booking <b>drops back to “Proposal sent”</b> as if nothing had ever been agreed. The deposit they paid disappears out of our confirmed figures and back into “still just an enquiry”. Nothing anywhere remembers that the money arrived. And two extra guests is the most normal change in the world.',
        shipped: { build:'2026-07-17.1', in:'1827a80', what:'Adding guests to a signed, paid booking now keeps it confirmed and keeps the deposit — only the agreement needs re-signing.', check:'On a signed, paid booking change the guest count — it says it stays confirmed and the deposit is kept.' },
        label: 'Signed + paid then +2 guests — booking falls back to \'proposal sent\', deposit vanishes' },
      { said: '“Can we have the burrata from the à la carte menu?”',
        today: 'You can get the <b>price</b> right — but a dish added that way never reaches the <b>kitchen\'s prep list</b>. So the money is correct and the kitchen doesn\'t know about it.',
        shipped: { build:'2026-07-17.1', in:'ed3682b', what:'An a la carte dish added to an event is now an off-menu line that reaches the kitchen list.', check:'Add an a la carte dish to an event — it shows as an off-menu item for the kitchen.' },
        label: 'À la carte dish on an event — priced right but never reaches the kitchen list' },
      { said: '“Show me the price per person, not the total.”',
        today: 'One switch, and the guest\'s proposal reads per person instead. Nothing to fix.',
        works: true,
        label: 'Price per person instead of the total' },
      { said: 'They cancel three weeks out — deposit already paid.',
        today: 'You can mark it lost and give a reason, and that part works. But there\'s <b>nowhere to say what happened to the deposit</b> — kept, refunded, or moved to another date. That story ends in a free-text note.',
        shipped: { build:'2026-07-17.1', in:'1827a80', what:'When a booking is lost you now record what happened to the deposit — kept, refunded, or moved to another date.', check:'Mark a booking lost — you are asked what happened to the deposit.' },
        label: 'Cancels after paying — nowhere to say what happened to the deposit' },
      { said: '“Six in the evening until one in the morning.”',
        today: 'Late finishes are normal picks in the time list. Nothing to fix.',
        works: true,
        label: 'Late finish, 6pm till 1am' }
    ]
  }
};

// The answer key for an item: its stable id if it has one, else its position.
// Existing rounds have no ids by design — see the header.
function fbKey(round, i){
  var it = round.items[i];
  return (it && it.id) ? String(it.id) : String(i + 1);
}
// Position of an answer key within a round, for ordering the work list. Returns
// a big number for a key the round no longer has, so orphans sort last instead
// of NaN-ing the sort (String ids would break a Number(x)-Number(y) compare).
function fbKeyPos(round, key){
  if(!round || !round.items) return 9999;
  for(var i = 0; i < round.items.length; i++){ if(fbKey(round, i) === String(key)) return i; }
  return 9999;
}
// The label written for an item, found by answer key. Null when the round is
// unknown or the key is one the round no longer has — callers show the bare key
// rather than pretending to know what it was.
function fbLabel(topic, key){
  var r = FB_ROUNDS[topic]; if(!r) return null;
  var i = fbKeyPos(r, key);
  return (i < 9999 && r.items[i]) ? (r.items[i].label || null) : null;
}

// Did a later round declare that one of its items closed this one? Returns the
// closing round + item, or null. Cheap: three rounds, a few dozen items.
function fbClosedBy(topic, qkey){
  var want = topic + '/' + qkey;
  for(var k in FB_ROUNDS){
    var r = FB_ROUNDS[k];
    for(var i = 0; i < r.items.length; i++){
      if(r.items[i].fixes === want) return { topic:k, qkey:fbKey(r,i), item:r.items[i] };
    }
  }
  return null;
}

// A round's item may declare it was fixed by SHIPPED CODE rather than by a
// follow-up round — used when the person who asked has no second round to
// confirm in (Valentina's events-20). It carries the same evidence a recorded
// fix does: what changed, the build it shipped in, and how to check it. Returns
// that object or null. See admFbStateOf (Admin) and statusState (the team page).
function fbShipped(topic, qkey){
  var r = FB_ROUNDS[topic]; if(!r) return null;
  var it = r.items[fbKeyPos(r, qkey)];
  return (it && it.shipped) ? it.shipped : null;
}
