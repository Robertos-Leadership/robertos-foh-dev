-- Roberto's Mare: Learning, to the Montenegrin standard (9 Oct 2026).
-- Francesco: "add the learning module but related to Montenegro standard when it comes to health
-- and safety". Six topics agreed; Andrea Falcone checks them; ONE test covers all six topics at once
-- ("each test should have all 6 topics in once, not 1 topic at a time").
--
-- Facts come from the official texts (read 9 Oct 2026):
--   ZBH  = Zakon o bezbjednosti hrane, Sl. list CG 57/15
--   UHH  = Uredba o higijeni hrane, Sl. list CG 13/16 (transposes EU Reg. 852/2004)
--   UIP  = Uredba o informisanju potrošača o hrani, Sl. list CG 2016 (Annex 1 = the 14 allergens)
--   ZZB  = Zakon o zaštiti stanovništva od zaraznih bolesti, Sl. list CG 12/18 (art. 31)
--   ZZR  = Zakon o zaštiti i zdravlju na radu, Sl. list CG 34/14, 44/18, 84/24
-- Temperature figures are NOT in Montenegrin law for restaurants: they are Roberto's house standard,
-- the same as the approved Dubai Learning questions.
--
-- Mare staff use their phone link + code (mare_s_auth). Andrea reviews from a no-password link
-- (mare_settings 'learn_review_token'). A topic reaches the team only once he approves it.
-- The test: 3 random questions from each approved topic, choices shuffled, the answers never leave
-- the database before hand-in. Pass = 80% (Dubai's 4 out of 5). Time = Dubai's per-question
-- formula (25–90 s by length), one clock for the whole test, 30 s of grace.

create table if not exists public.mare_learn_topics (
  id text primary key,
  pos int not null,
  title text not null,
  summary text not null,
  body text not null,
  sources text not null,
  reviewer_note text,
  questions jsonb not null default '[]'::jsonb,   -- [{id, q, answer, wrong:[3]}]
  status text not null default 'draft' check (status in ('draft','approved','change')),
  checked_by text, checked_at timestamptz, note text,
  updated_at timestamptz not null default now()
);
create table if not exists public.mare_learn_attempts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.mare_staff(id) on delete cascade,
  served jsonb not null,           -- [{topic, qid, answer}] in the order shown (answers stay here)
  time_limit int not null,
  started_at timestamptz not null default now(),
  answers jsonb, score int, total int, passed boolean, late boolean, per_topic jsonb,
  finished_at timestamptz
);
create index if not exists mare_learn_attempts_staff on public.mare_learn_attempts(staff_id, started_at desc);
alter table public.mare_learn_topics enable row level security;
alter table public.mare_learn_attempts enable row level security;
revoke all on public.mare_learn_topics, public.mare_learn_attempts from anon, authenticated;

insert into public.mare_settings(key, value) values ('learn_review_token', to_jsonb(encode(extensions.gen_random_bytes(16),'hex')))
  on conflict (key) do nothing;

-- seconds for one question: Dubai's learn_q_secs formula (15 s + 0.7 s a word, between 25 and 90)
create or replace function public.mare_learn_q_secs(p_q jsonb) returns int
language sql immutable as $$
  select least(90, greatest(25, round(15 + 0.7 * coalesce(array_length(regexp_split_to_array(trim(
    coalesce(p_q->>'q','') || ' ' || coalesce(p_q->>'answer','') || ' ' ||
    coalesce((select string_agg(x, ' ') from jsonb_array_elements_text(p_q->'wrong') x), '')), '\s+'), 1), 0))))::int
$$;

-- TEAM: the approved topics to read, and my results
create or replace function public.mare_s_learn_home(p_device text, p_token text, p_staff uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; n int; ok int;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid;
  select count(*), count(*) filter (where status = 'approved') into n, ok from public.mare_learn_topics;
  return jsonb_build_object('ok', true, 'total_topics', n, 'approved_topics', ok,
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'summary', summary, 'body', body) order by pos)
                        from public.mare_learn_topics where status = 'approved'), '[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('at', finished_at, 'score', score, 'total', total, 'passed', passed, 'late', late, 'per_topic', per_topic) order by finished_at desc)
                          from (select * from public.mare_learn_attempts where staff_id = me and finished_at is not null order by finished_at desc limit 10) x), '[]'::jsonb));
end $$;

-- TEAM: start the one test (3 questions from every approved topic)
create or replace function public.mare_s_learn_start(p_device text, p_token text, p_staff uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; served jsonb := '[]'::jsonb; shown jsonb := '[]'::jsonb; lim int := 0; r record; aid uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid; if me is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  if not exists (select 1 from public.mare_learn_topics where status = 'approved') then return jsonb_build_object('ok', false, 'error', 'not_ready'); end if;
  for r in
    select t.id topic, t.title, q
      from public.mare_learn_topics t,
           lateral (select q from jsonb_array_elements(t.questions) q order by random() limit 3) z
     where t.status = 'approved'
     order by random()
  loop
    served := served || jsonb_build_array(jsonb_build_object('topic', r.topic, 'qid', r.q->>'id', 'answer', r.q->>'answer'));
    shown := shown || jsonb_build_array(jsonb_build_object('topic', r.title, 'q', r.q->>'q',
               'choices', (select jsonb_agg(c order by random()) from jsonb_array_elements_text(jsonb_build_array(r.q->>'answer') || (r.q->'wrong')) c)));
    lim := lim + public.mare_learn_q_secs(r.q);
  end loop;
  insert into public.mare_learn_attempts(staff_id, served, time_limit) values (me, served, lim) returning id into aid;
  return jsonb_build_object('ok', true, 'attempt', aid, 'questions', shown, 'limit', lim, 'pass', ceil(jsonb_array_length(served) * 0.8)::int);
end $$;

-- TEAM: hand it in
create or replace function public.mare_s_learn_finish(p_device text, p_token text, p_staff uuid, p_pin text, p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; t public.mare_learn_attempts; ok int := 0; n int; lt boolean; i int; s jsonb; pick text; res jsonb := '[]'::jsonb; per jsonb := '{}'::jsonb; topic_title text; pass_at int;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid;
  select * into t from public.mare_learn_attempts where id = p_attempt and staff_id = me;
  if not found then return jsonb_build_object('ok', false, 'error', 'attempt'); end if;
  if t.finished_at is not null then return jsonb_build_object('ok', false, 'error', 'done'); end if;
  n := jsonb_array_length(t.served);
  lt := now() > t.started_at + make_interval(secs => t.time_limit + 30);
  for i in 0 .. n - 1 loop
    s := t.served->i;
    pick := case when jsonb_typeof(p_answers) = 'array' then p_answers->>i end;
    select title into topic_title from public.mare_learn_topics where id = s->>'topic';
    per := jsonb_set(per, array[coalesce(topic_title, s->>'topic')],
             jsonb_build_object('right', coalesce((per->coalesce(topic_title, s->>'topic')->>'right')::int, 0) + case when pick = s->>'answer' then 1 else 0 end,
                                'of', coalesce((per->coalesce(topic_title, s->>'topic')->>'of')::int, 0) + 1));
    if pick = s->>'answer' then ok := ok + 1; end if;
    res := res || jsonb_build_array(jsonb_build_object('picked', pick, 'answer', s->>'answer', 'right', pick = s->>'answer'));
  end loop;
  pass_at := ceil(n * 0.8)::int;
  update public.mare_learn_attempts set answers = p_answers, score = ok, total = n, passed = ok >= pass_at and not lt, late = lt, per_topic = per, finished_at = now() where id = t.id;
  return jsonb_build_object('ok', true, 'score', ok, 'total', n, 'pass', pass_at, 'passed', ok >= pass_at and not lt, 'late', lt, 'per_topic', per, 'results', res);
end $$;

-- REVIEW (Andrea, no password): everything, drafts included
create or replace function public.mare_learn_review_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_token,'')) <> 32 or p_token is distinct from (select value #>> '{}' from public.mare_settings where key = 'learn_review_token') then
    return jsonb_build_object('ok', false, 'error', 'link'); end if;
  return jsonb_build_object('ok', true, 'topics', coalesce((select jsonb_agg(to_jsonb(t) order by t.pos) from public.mare_learn_topics t), '[]'::jsonb));
end $$;

create or replace function public.mare_learn_review_save(p_token text, p_topic text, p_action text, p_note text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_token,'')) <> 32 or p_token is distinct from (select value #>> '{}' from public.mare_settings where key = 'learn_review_token') then
    return jsonb_build_object('ok', false, 'error', 'link'); end if;
  if p_action not in ('approve','change') then return jsonb_build_object('ok', false, 'error', 'action'); end if;
  if p_action = 'change' and length(btrim(coalesce(p_note,''))) < 3 then return jsonb_build_object('ok', false, 'error', 'note'); end if;
  update public.mare_learn_topics set status = case when p_action = 'approve' then 'approved' else 'change' end,
    note = nullif(left(btrim(coalesce(p_note,'')), 2000), ''), checked_by = coalesce(nullif(left(btrim(coalesce(p_name,'')),60),''), 'Chef Andrea'),
    checked_at = now(), updated_at = now() where id = p_topic;
  if not found then return jsonb_build_object('ok', false, 'error', 'topic'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.mare_learn_q_secs(jsonb), public.mare_s_learn_home(text,text,uuid,text), public.mare_s_learn_start(text,text,uuid,text),
  public.mare_s_learn_finish(text,text,uuid,text,uuid,jsonb), public.mare_learn_review_get(text), public.mare_learn_review_save(text,text,text,text,text) from public;
grant execute on function public.mare_s_learn_home(text,text,uuid,text), public.mare_s_learn_start(text,text,uuid,text),
  public.mare_s_learn_finish(text,text,uuid,text,uuid,jsonb), public.mare_learn_review_get(text), public.mare_learn_review_save(text,text,text,text,text) to anon, authenticated;

-- The six topics, as written 9 Oct 2026 (drafts until Chef Andrea approves each one).
insert into public.mare_learn_topics(id,pos,title,summary,body,sources,reviewer_note,questions) values
($c$law$c$,1,$c$Food safety law in Montenegro and HACCP$c$,$c$What the law asks of every restaurant kitchen, and what an inspector checks.$c$,$c$In Montenegro every food business, including a restaurant, must keep food safe and be able to prove it. The law is the Food Safety Law (Zakon o bezbjednosti hrane).

HACCP
The law says we must run food-safety procedures based on HACCP. In plain words:
• find what can make food unsafe (germs, allergens, glass, chemicals);
• find the steps where control is essential, called critical control points (for example cooking and chilling);
• set a limit for each one (for example 75 °C in the core);
• check it every time, and correct it straight away when it is wrong;
• write it down. Records must be up to date and kept, and we must show them when the inspector asks.

Knowing where food comes from
We must know who supplied every product. That is why every delivery note is kept.

If food may be unsafe
Do not use it. Keep it apart and tell the head chef at once. The company must stop it and inform the Food Safety Administration.

The inspector
Food inspectors (Uprava za bezbjednost hrane, veterinu i fitosanitarne poslove) can check the kitchen, the equipment, our records and our thermometer readings, and take samples. A company that breaks the hygiene rules can be fined from €500 to €20,000, and the person responsible from €30 to €2,000.$c$,$c$ZBH (Sl. list CG 57/15) art. 27 (traceability), 28 (unsafe food), 41 (HACCP principles, records, proof on request), 117 (inspectors' powers). Uredba o higijeni hrane (Sl. list CG 13/16) art. 5 (fines).$c$,null,$c$[{"id": "law1", "q": "Under Montenegrin law, what must every restaurant kitchen have?", "answer": "Food-safety procedures based on HACCP, with checks and written records", "wrong": ["Only a cleaning rota on the wall", "Nothing: HACCP is only for factories", "A consultant's visit once a year, nothing else"]}, {"id": "law2", "q": "A food inspector asks to see our temperature records. What do we do?", "answer": "Show them: the law says we keep up-to-date records and show them when asked", "wrong": ["Say the records are private", "Fill them in now from memory", "Ask the inspector to come back next week"]}, {"id": "law3", "q": "Why do we keep every delivery note?", "answer": "The law requires us to know who supplied each product", "wrong": ["Only for the accountant", "It is not needed if the food looks fine", "To return the boxes"]}, {"id": "law4", "q": "You think a product that was delivered may be unsafe. What do you do?", "answer": "Don't use it, keep it apart and tell the head chef at once", "wrong": ["Use it quickly before it gets worse", "Throw it away and tell nobody", "Cook it for longer and serve it"]}, {"id": "law5", "q": "What is a critical control point?", "answer": "A step where control is essential to keep food safe, for example cooking to 75 °C", "wrong": ["The pass, where plates leave the kitchen", "The place where the inspector stands", "The head chef's office"]}]$c$::jsonb),
($c$health$c$,2,$c$Your health certificate and personal hygiene$c$,$c$The compulsory health check, the sanitarna knjižica, illness and hand washing.$c$,$c$Health check
Everyone in Montenegro who handles food must pass a compulsory health check (obavezni zdravstveni pregled). It is done by an epidemiology doctor at the Institute of Public Health or the competent health centre, with laboratory tests. Nobody may work with food without it.

The employer pays for it. The result is written in your sanitarna knjižica (health booklet). The employer keeps the booklet at the restaurant, because the sanitary inspector can ask to see it. Ask the manager when your next check is due and never let it run out.

When you are ill
If you have diarrhoea or vomiting, an infected cut or sore, or an illness that can pass through food, you must not handle food or enter the kitchen. You must tell the head chef or the manager. This is the law, not a choice.

Clean body, clean clothes
Wear clean work clothes and shoes, and protective clothing where needed.

Wash your hands with soap and warm water, and dry them hygienically:
• before you start work and when you come back into the kitchen;
• after the toilet;
• after touching raw meat, fish or eggs;
• after bins, cleaning, or touching your face, hair or phone.
Use the hand-wash basin only for hands, never for food.$c$,$c$Zakon o zaštiti stanovništva od zaraznih bolesti (Sl. list CG 12/18) art. 31 (compulsory checks for food handlers, employer pays, sanitarna knjižica kept on site for the sanitary inspector). ZBH art. 39 (personal hygiene, clean clothes, illness and the duty to report it). UHH Annex 2 part 1 point 3 (hand-wash basins separate from food washing).$c$,$c$Please check: Parliament adopted a NEW law on infectious diseases on 31 Dec 2025. The text read here is the 2018 one. How often the check is repeated is set in an implementing rule that was not found, so the page does not give a number. Milica can confirm the current rule.$c$,$c$[{"id": "hea1", "q": "Who must pass a compulsory health check in Montenegro?", "answer": "Everyone who handles food", "wrong": ["Only the head chef", "Only the kitchen porters", "Nobody, as long as they feel well"]}, {"id": "hea2", "q": "Where is the record of your health check kept?", "answer": "In your sanitarna knjižica, kept by the employer at the restaurant", "wrong": ["At your home", "Only on your phone", "It is not written anywhere"]}, {"id": "hea3", "q": "Who pays for the compulsory health check?", "answer": "The employer", "wrong": ["You", "The guests, through the service charge", "The inspector"]}, {"id": "hea4", "q": "You had diarrhoea last night. What do you do before your shift?", "answer": "Tell the head chef or manager and do not handle food", "wrong": ["Come in and work carefully", "Take a tablet and work as normal", "Say nothing if you feel better"]}, {"id": "hea5", "q": "When must you wash your hands?", "answer": "Before starting, after the toilet, after raw meat or fish, after bins, cleaning or touching your phone", "wrong": ["Only when they look dirty", "Only at the start of the shift", "Never if you wear gloves"]}]$c$::jsonb),
($c$temp$c$,3,$c$Temperatures and the cold chain$c$,$c$Chilled, frozen, cooking, hot holding and cooling, the Roberto's way.$c$,$c$What the law says
Food that germs can grow in must be kept at a safe temperature, and the cold chain must never be broken. Cooked food that will be kept cold must be cooled as quickly as possible. Food must be thawed safely. Temperatures must be checked and, where needed, written down.

The law does not give one number for restaurants, so we use the Roberto's standard, the same as in Dubai:
• Chilled food: 5 °C or below.
• Frozen food: −18 °C or below.
• Cooking meat, chicken or fish: at least 75 °C in the core. Use a calibrated probe in the thickest part and write the reading down.
• Hot food waiting to be served: 60 °C or above.
• Cooling: from 60 °C down to 5 °C within 6 hours in total.
• Cooked food, cooled correctly and kept chilled: use within 72 hours.
• Thaw in the chiller, never on the bench, and cook within 72 hours of starting to thaw.

Deliveries
Check the temperature when a delivery arrives. Chilled food above 5 °C, or frozen food that has started to thaw: refuse it and tell the head chef.

In the fridge
Raw meat and fish go on the bottom shelf, below cooked and ready-to-eat food.$c$,$c$ZBH art. 37(3) (temperature control, cold chain). UHH Annex 2 part 1 point 2(d) (controlled temperature, monitored and recorded), part 8 points 5, 6, 8, 9 (no break in the cold chain, quick cooling, safe thawing). Figures: Roberto's house standard, as in the approved Dubai Learning questions.$c$,$c$The figures are the Dubai house standard. Montenegrin law has no restaurant figures (the Ministry guide gives 4 °C only for meat-cutting rooms). Change them here if Mare should differ.$c$,$c$[{"id": "tem1", "q": "At what temperature must chilled food be kept?", "answer": "5 °C or below", "wrong": ["8 °C or below", "10 °C or below", "Room temperature, if it is covered"]}, {"id": "tem2", "q": "What core temperature must raw chicken reach when cooked?", "answer": "At least 75 °C", "wrong": ["55 °C", "63 °C on the surface", "It is cooked when it looks white"]}, {"id": "tem3", "q": "Hot food waiting to be served must be held at…", "answer": "60 °C or above", "wrong": ["40 °C or above", "50 °C or above", "Any temperature, if it is covered"]}, {"id": "tem4", "q": "What is the total time allowed to cool cooked food from 60 °C to 5 °C?", "answer": "6 hours", "wrong": ["12 hours", "Overnight on the bench", "24 hours"]}, {"id": "tem5", "q": "A delivery of chilled fish arrives at 9 °C. What do you do?", "answer": "Refuse it and tell the head chef", "wrong": ["Put it straight in the chiller", "Use it first today", "Accept it if it smells fine"]}]$c$::jsonb),
($c$allergens$c$,4,$c$Allergens$c$,$c$The 14 allergens in Montenegrin law, and how we answer a guest.$c$,$c$The law
Restaurants must give guests correct information about the food, including ingredients that can harm some people. Montenegrin law lists 14 allergens:
1. Cereals with gluten (wheat, rye, barley, oats, spelt, kamut)
2. Crustaceans (prawns, lobster, crab)
3. Eggs
4. Fish
5. Peanuts
6. Soya
7. Milk (including lactose)
8. Tree nuts (almonds, hazelnuts, walnuts, cashews, pecans, Brazil nuts, pistachios, macadamia)
9. Celery
10. Mustard
11. Sesame
12. Sulphites above 10 mg per kilo or litre (wine, some dried fruit)
13. Lupin
14. Molluscs (mussels, clams, oysters, squid, octopus)

What we do
• Every recipe card in the app lists its allergens. When a guest asks, check the card. Never guess.
• If you are not sure, say so and ask the head chef.
• Cooking does not remove an allergen.
• For an allergy order: clean board, knife, pan and hands before you start, and keep the dish apart.
• If an ingredient changes (a new supplier, a new sauce), tell the head chef so the recipe card is changed.$c$,$c$ZBH art. 54(3)–(4) (information for consumers, including restaurants). Uredba o informisanju potrošača o hrani, art. 3 (applies to public catering), art. 14 and Annex 1 (the 14 substances causing allergies or intolerances).$c$,null,$c$[{"id": "all1", "q": "How many allergens does Montenegrin law list?", "answer": "14", "wrong": ["8", "10", "21"]}, {"id": "all2", "q": "Which of these is one of the 14 allergens?", "answer": "Celery", "wrong": ["Tomato", "Rice", "Chicken"]}, {"id": "all3", "q": "A guest with a nut allergy asks if a dish is safe and you are not sure. What do you do?", "answer": "Check the recipe card; if still unsure, tell the guest and ask the head chef", "wrong": ["Say it is fine", "Pick out the nuts you can see", "Say it is probably safe"]}, {"id": "all4", "q": "Does cooking remove an allergen?", "answer": "No", "wrong": ["Yes, above 75 °C", "Yes, if it is fried", "Only for nuts"]}, {"id": "all5", "q": "Squid, mussels and octopus belong to which allergen?", "answer": "Molluscs", "wrong": ["Fish", "Crustaceans", "They are not allergens"]}]$c$::jsonb),
($c$clean$c$,5,$c$Cleaning, pests and waste$c$,$c$Clean as you go, chemicals, bins, pests, water and ice.$c$,$c$What the law asks of the kitchen
• The kitchen must be kept clean and in good repair.
• Surfaces and equipment that touch food must be cleaned, and disinfected where needed.
• There must be hand-wash basins with hot and cold water, soap and hygienic drying, separate from the sinks for washing food.
• Cleaning chemicals are kept away from areas where food is handled. Anything dangerous or not for eating is labelled and kept apart.
• Food waste must not build up. It goes in bins that close, which are kept clean. The waste area is kept clean and closed to animals and pests.
• The kitchen must stop pests getting in, and pets are never allowed where food is prepared or stored.
• Ice that touches food or drinks is made from drinking water.

What we do
• Clean as you go: wipe, clear and wash while you work.
• Label and date every container.
• Droppings, insects or gnawed packets: tell the head chef at once, do not use any food that may have been touched, then clean and disinfect.$c$,$c$UHH Annex 2: part 1 points 1–4 (clean premises, hand basins, chemicals stored away from food), part 2 (food-contact surfaces), part 5 (equipment cleaned and disinfected), part 6 (food waste, closable containers, protected from pests), part 7 point 5 (ice from drinking water), part 8 points 4 and 10 (pest control, no domestic animals, dangerous substances labelled and kept apart).$c$,null,$c$[{"id": "cle1", "q": "Where are cleaning chemicals stored?", "answer": "Away from food areas, labelled", "wrong": ["On the shelf above the prep table", "In empty water bottles", "In the dry store next to the flour"]}, {"id": "cle2", "q": "May you rinse vegetables in the hand-wash basin?", "answer": "No, food is washed only in the food sink", "wrong": ["Yes, if it is quick", "Yes, if the basin is clean", "Yes, at the end of the night"]}, {"id": "cle3", "q": "Kitchen waste bins must be…", "answer": "Closable, emptied so waste does not build up, and kept clean", "wrong": ["Open, so they are quick to use", "Emptied once a week", "Kept under the prep table"]}, {"id": "cle4", "q": "You find mouse droppings in the dry store. What do you do?", "answer": "Tell the head chef at once, don't use food that may be touched, then clean and disinfect", "wrong": ["Sweep them up and say nothing", "Move the food to a higher shelf", "Wait for the next pest-control visit"]}, {"id": "cle5", "q": "Ice that goes into drinks must be made from…", "answer": "Drinking water", "wrong": ["Any water from any tap", "Sea water", "Rain water"]}]$c$::jsonb),
($c$work$c$,6,$c$Safety at work and fire$c$,$c$Your training, your duties, first aid, fire and alcohol.$c$,$c$The law is the Law on Safety and Health at Work (Zakon o zaštiti i zdravlju na radu).

Your training
The employer must train you in safe work when you start, when you change job, when new equipment or a new way of working arrives, and when you come back after more than a year away. Training happens during working hours and the employer pays. Safety measures must never cost you anything. The employer must also explain the risk assessment for your job.

Your duties
• Follow the safety rules and use equipment and protective clothing as intended.
• Look after your own safety and your colleagues'.
• Report straight away (by voice or in writing) anything broken or dangerous.
If a danger you reported is not fixed within three days, you may ask the labour inspection to step in.

Alcohol and drugs
You may not start or do work under the influence of alcohol or drugs, and you must accept a check if the employer asks.

First aid, fire and evacuation
The employer names people for first aid, fire and evacuation. Know who they are, and where the first-aid kit, the fire blanket, the extinguishers and the exits are. In a serious and immediate danger, stop work and go to a safe place.

In the kitchen
If oil catches fire: turn off the heat if it is safe, and cover the pan with a lid or the fire blanket. Never use water on burning oil.$c$,$c$ZZR (Sl. list CG 34/14, 44/18, 84/24) art. 6 (safety measures cost the employee nothing), 17 (risk assessment shown to staff), 20 (training on hiring, job change, new equipment or process, return after more than a year; during working hours; employer pays), 28 (first aid, fire, evacuation), 29 (serious and immediate danger), 35 (employee duties, reporting, 3 days then labour inspection), 36 (no alcohol or drugs). Oil fire: general kitchen fire safety, not from the law.$c$,null,$c$[{"id": "wor1", "q": "When must the employer train you in safe work?", "answer": "When you start, change job, get new equipment, or come back after more than a year", "wrong": ["Never: you learn by watching", "Once a year, in your own time", "Only if you ask and pay for it"]}, {"id": "wor2", "q": "You see a broken socket next to the sink. What do you do?", "answer": "Keep away and report it at once to the head chef or manager", "wrong": ["Fix it yourself", "Ignore it until the end of the season", "Cover it with tape and carry on"]}, {"id": "wor3", "q": "May you start a shift after drinking alcohol?", "answer": "No, never", "wrong": ["Yes, one beer is fine", "Yes, if it was before you arrived", "Yes, on a quiet day"]}, {"id": "wor4", "q": "A pan of oil catches fire. What do you do?", "answer": "Turn off the heat if safe and cover it with a lid or fire blanket; never water", "wrong": ["Throw water on it", "Carry the pan outside", "Blow on it"]}, {"id": "wor5", "q": "Who pays for your safety training?", "answer": "The employer, during working hours", "wrong": ["You", "Half you, half the employer", "The government"]}]$c$::jsonb)
on conflict (id) do nothing;

-- Kitchen team also sees Learning (9 Oct 2026)
update public.mare_settings set value = jsonb_set(value, '{Kitchen}', '["rota","recipes","kclose","learn"]'::jsonb) where key = 'team_modules';
