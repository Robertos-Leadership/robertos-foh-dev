-- Roberto's Mare Learning, v2 (9 Oct 2026).
-- Francesco: each test = 20 questions from 5 topics picked at random, mixed; more interesting formats
-- (pick all that apply, put in order, match the pairs, photo); and the 10 Dubai topics that also fit
-- Mare are shared ("yes add 10 shared topic").
-- The test is built on the server by edge fn mare-learn: it fetches the shared Dubai pool from the
-- Kitchen project (learn_mare_pool, with a key) and passes it to mare_learn_start_srv, which only the
-- service role may call. The answers stay in mare_learn_attempts.served until hand-in.
-- Question types (jsonb): one {answer, wrong[3], shots?} · multi {answers[], wrong[]} ·
-- order {items[] in the right order} · match {pairs[[left,right],...]}.

alter table public.mare_learn_attempts add column if not exists topics text[];

-- seconds for one question: Dubai's formula on all its words; order and match get 15 s more
create or replace function public.mare_learn_q_secs(p_q jsonb) returns int
language sql immutable as $$
  select least(120, greatest(25, round(15 + 0.7 * coalesce(array_length(regexp_split_to_array(trim(
    coalesce(p_q->>'q','') || ' ' || coalesce(p_q->>'answer','') || ' ' ||
    coalesce((select string_agg(x, ' ') from jsonb_array_elements_text(coalesce(p_q->'wrong','[]') || coalesce(p_q->'answers','[]') || coalesce(p_q->'items','[]')) x), '') || ' ' ||
    coalesce((select string_agg(p->>0 || ' ' || (p->>1), ' ') from jsonb_array_elements(coalesce(p_q->'pairs','[]')) p), '')), '\s+'), 1), 0))))::int
    + case when coalesce(p_q->>'type','one') in ('order','match') then 15 else 0 end
$$;

create or replace function public.mare_learn_shuffle(p jsonb) returns jsonb
language sql volatile as $$ select coalesce(jsonb_agg(x order by random()), '[]'::jsonb) from jsonb_array_elements(coalesce(p,'[]')) x $$;

-- SERVER ONLY: build one test of up to 20 questions = 5 random topics x 4 random questions
create or replace function public.mare_learn_start_srv(p_staff uuid, p_shared jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pool jsonb; tp jsonb; q jsonb; ty text; served jsonb := '[]'::jsonb; shown jsonb := '[]'::jsonb; lim int := 0; aid uuid; picked text[] := '{}'; s jsonb; sh jsonb;
begin
  if not exists (select 1 from public.mare_staff where id = p_staff and active) then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  -- every topic that can give 4 questions: Mare's own approved ones, and the shared Dubai ones
  select coalesce(jsonb_agg(x), '[]'::jsonb) into pool from (
    select jsonb_build_object('id', id, 'title', title, 'questions', questions) x from public.mare_learn_topics where status = 'approved' and jsonb_array_length(questions) >= 4
    union all
    select t from jsonb_array_elements(coalesce(p_shared, '[]'::jsonb)) t where jsonb_array_length(coalesce(t->'questions','[]')) >= 4) z;
  if jsonb_array_length(pool) = 0 then return jsonb_build_object('ok', false, 'error', 'not_ready'); end if;
  for tp in select x from jsonb_array_elements(pool) x order by random() limit 5 loop
    picked := picked || (tp->>'title');
    for q in select y from jsonb_array_elements(tp->'questions') y order by random() limit 4 loop
      ty := coalesce(q->>'type', 'one');
      s := jsonb_build_object('topic', tp->>'title', 'type', ty, 'q', q->>'q', 'why', q->>'why');
      if ty = 'multi' then
        served := served || jsonb_build_array(s || jsonb_build_object('key', q->'answers'));
        shown := shown || jsonb_build_array(jsonb_build_object('topic', tp->>'title', 'type', ty, 'q', q->>'q', 'choices', mare_learn_shuffle(q->'answers' || q->'wrong')));
      elsif ty = 'order' then
        served := served || jsonb_build_array(s || jsonb_build_object('key', q->'items'));
        shown := shown || jsonb_build_array(jsonb_build_object('topic', tp->>'title', 'type', ty, 'q', q->>'q', 'items', mare_learn_shuffle(q->'items')));
      elsif ty = 'match' then
        served := served || jsonb_build_array(s || jsonb_build_object('key', (select jsonb_agg(p->1 order by n) from jsonb_array_elements(q->'pairs') with ordinality u(p, n)),
                                                                     'lefts', (select jsonb_agg(p->0 order by n) from jsonb_array_elements(q->'pairs') with ordinality u(p, n))));
        shown := shown || jsonb_build_array(jsonb_build_object('topic', tp->>'title', 'type', ty, 'q', q->>'q',
                   'lefts', (select jsonb_agg(p->0 order by n) from jsonb_array_elements(q->'pairs') with ordinality u(p, n)),
                   'rights', mare_learn_shuffle((select jsonb_agg(p->1) from jsonb_array_elements(q->'pairs') p))));
      else
        sh := case when jsonb_typeof(q->'shots') = 'object' then q->'shots' end;
        served := served || jsonb_build_array(s || jsonb_build_object('type', 'one', 'key', q->'answer', 'shots', sh));
        shown := shown || jsonb_build_array(jsonb_build_object('topic', tp->>'title', 'type', 'one', 'q', q->>'q', 'choices', mare_learn_shuffle(jsonb_build_array(q->'answer') || q->'wrong'), 'shots', sh));
      end if;
      lim := lim + public.mare_learn_q_secs(q);
    end loop;
  end loop;
  -- mix the topics together, keeping each question with its answer
  select jsonb_agg(a order by r), jsonb_agg(b order by r) into served, shown
    from (select a, b, random() r from jsonb_array_elements(served) with ordinality sa(a, n) join jsonb_array_elements(shown) with ordinality sb(b, m) on n = m) z;
  insert into public.mare_learn_attempts(staff_id, served, time_limit, topics) values (p_staff, served, lim, picked) returning id into aid;
  return jsonb_build_object('ok', true, 'attempt', aid, 'questions', shown, 'limit', lim, 'pass', ceil(jsonb_array_length(served) * 0.8)::int, 'topics', to_jsonb(picked));
end $$;

-- TEAM: hand it in (all four types)
create or replace function public.mare_s_learn_finish(p_device text, p_token text, p_staff uuid, p_pin text, p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; t public.mare_learn_attempts; ok int := 0; n int; lt boolean; i int; s jsonb; pick jsonb; good boolean; res jsonb := '[]'::jsonb; per jsonb := '{}'::jsonb; tt text; pass_at int; shown_key text; shown_pick text;
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
    pick := case when jsonb_typeof(p_answers) = 'array' then p_answers->i end;
    if s->>'type' = 'multi' then
      good := jsonb_typeof(pick) = 'array' and (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(pick) x) = (select array_agg(x order by x) from jsonb_array_elements_text(s->'key') x);
      shown_key := (select string_agg(x, ' · ') from jsonb_array_elements_text(s->'key') x);
      shown_pick := case when jsonb_typeof(pick) = 'array' then (select string_agg(x, ' · ') from jsonb_array_elements_text(pick) x) end;
    elsif s->>'type' = 'order' then
      good := pick = s->'key';
      shown_key := (select string_agg(x, ' → ') from jsonb_array_elements_text(s->'key') x);
      shown_pick := case when jsonb_typeof(pick) = 'array' then (select string_agg(x, ' → ') from jsonb_array_elements_text(pick) x) end;
    elsif s->>'type' = 'match' then
      good := pick = s->'key';
      shown_key := (select string_agg((s->'lefts'->>(k-1)::int) || ' → ' || x, ' · ' order by k) from jsonb_array_elements_text(s->'key') with ordinality u(x, k));
      shown_pick := case when jsonb_typeof(pick) = 'array' then (select string_agg((s->'lefts'->>(k-1)::int) || ' → ' || coalesce(x, '?'), ' · ' order by k) from jsonb_array_elements_text(pick) with ordinality u(x, k)) end;
    else
      good := pick #>> '{}' = s->>'key';
      shown_key := s->>'key'; shown_pick := pick #>> '{}';
    end if;
    good := coalesce(good, false);
    tt := coalesce(s->>'topic', '?');
    per := jsonb_set(per, array[tt], jsonb_build_object('right', coalesce((per->tt->>'right')::int, 0) + case when good then 1 else 0 end, 'of', coalesce((per->tt->>'of')::int, 0) + 1));
    if good then ok := ok + 1; end if;
    res := res || jsonb_build_array(jsonb_build_object('right', good, 'answer', shown_key, 'picked', shown_pick, 'why', s->>'why',
             'shot', case when s->'shots' is not null and s->>'type' = 'one' then s->'shots'->(s->>'key') end));
  end loop;
  pass_at := ceil(n * 0.8)::int;
  update public.mare_learn_attempts set answers = p_answers, score = ok, total = n, passed = ok >= pass_at and not lt, late = lt, per_topic = per, finished_at = now() where id = t.id;
  return jsonb_build_object('ok', true, 'score', ok, 'total', n, 'pass', pass_at, 'passed', ok >= pass_at and not lt, 'late', lt, 'per_topic', per, 'results', res);
end $$;

-- the old one-topic-pool starter is replaced by the server path
revoke execute on function public.mare_s_learn_start(text,text,uuid,text) from anon, authenticated;
revoke all on function public.mare_learn_start_srv(uuid,jsonb), public.mare_learn_shuffle(jsonb) from public, anon, authenticated;
grant execute on function public.mare_learn_start_srv(uuid,jsonb) to service_role;

-- 5 more questions per topic in the new formats (9 Oct 2026); only appended where not there yet
update public.mare_learn_topics set questions = questions || $c$[{"id": "law6", "type": "multi", "q": "Which of these are part of HACCP under the Montenegrin law? Tick all that apply.", "answers": ["Find what can make food unsafe", "Set limits at the critical control points", "Keep written records"], "wrong": ["Always buy from the cheapest supplier", "Clean only when an inspection is announced"]}, {"id": "law7", "type": "order", "q": "Put the first five HACCP principles in the order the law lists them.", "items": ["Identify the hazards", "Identify the critical control points", "Set the limits", "Monitor the critical control points", "Correct it when a limit is missed"]}, {"id": "law8", "type": "multi", "q": "What can a food inspector do in our kitchen? Tick all that apply.", "answers": ["Check our records", "Read our thermometers", "Take food samples"], "wrong": ["Cook the dishes for the guests", "Hire and fire our staff"]}, {"id": "law9", "type": "match", "q": "Match each law to what it covers.", "pairs": [["Food Safety Law", "Food hygiene and HACCP"], ["Law on Safety and Health at Work", "Training and safety of workers"], ["Law on Infectious Diseases", "Compulsory health checks"], ["Consumer information decree", "The 14 allergens"]]}, {"id": "law10", "q": "What fine can a company get for breaking the food hygiene rules?", "answer": "From €500 to €20,000", "wrong": ["At most €50", "At least €100,000", "There are no fines, only warnings"]}]$c$::jsonb, updated_at = now() where id = 'law' and not questions @> '[{"id":"law6"}]'::jsonb;
update public.mare_learn_topics set questions = questions || $c$[{"id": "hea6", "type": "multi", "q": "When must you stay away from food and tell the head chef? Tick all that apply.", "answers": ["You have diarrhoea", "You have an infected cut", "You have an illness that can pass through food"], "wrong": ["You had a haircut", "You are a few minutes late"]}, {"id": "hea7", "type": "order", "q": "Put hand washing in the right order.", "items": ["Wet your hands with warm water", "Put on soap", "Rub all of your hands", "Rinse the soap off", "Dry your hands hygienically"]}, {"id": "hea8", "type": "match", "q": "Match each one to its role in your health check.", "pairs": [["Sanitarna knjižica", "The record of your health checks"], ["The employer", "Pays for the check"], ["Epidemiology doctor", "Does the check"], ["Sanitary inspector", "Can ask to see the booklet"]]}, {"id": "hea9", "type": "multi", "q": "When must you wash your hands? Tick all that apply.", "answers": ["After the toilet", "After touching raw meat or fish", "After touching your phone"], "wrong": ["Only when they look dirty", "Never, if you wear gloves"]}, {"id": "hea10", "q": "You have a cut on your finger that looks infected. What do you do?", "answer": "Tell the head chef and do not handle food", "wrong": ["Put on a glove and carry on", "Work only on the grill", "Say nothing until it hurts"]}]$c$::jsonb, updated_at = now() where id = 'health' and not questions @> '[{"id":"hea6"}]'::jsonb;
update public.mare_learn_topics set questions = questions || $c$[{"id": "tem6", "type": "match", "q": "Match each one to the Roberto's temperature.", "pairs": [["Chilled food", "5 °C or below"], ["Frozen food", "−18 °C or below"], ["Cooked chicken, in the core", "At least 75 °C"], ["Hot food waiting to be served", "60 °C or above"]]}, {"id": "tem7", "type": "order", "q": "Put the steps for cooked food you will keep cold in order.", "items": ["Cook it to at least 75 °C in the core", "Cool it to 5 °C within 6 hours", "Label and date it", "Keep it in the chiller", "Use it within 72 hours"]}, {"id": "tem8", "type": "multi", "q": "Which deliveries do you refuse? Tick all that apply.", "answers": ["Chilled fish at 9 °C", "Frozen prawns that have started to thaw"], "wrong": ["Chilled chicken at 3 °C", "Frozen peas at −20 °C"]}, {"id": "tem9", "q": "Where do you thaw frozen fish?", "answer": "In the chiller", "wrong": ["On the bench", "In warm water in the sink", "Next to the oven"]}, {"id": "tem10", "type": "multi", "q": "Which of these do we check with a thermometer and write down? Tick all that apply.", "answers": ["The core temperature of cooked meat", "Fridge and freezer temperatures"], "wrong": ["The colour of the plates", "Staff break times"]}]$c$::jsonb, updated_at = now() where id = 'temp' and not questions @> '[{"id":"tem6"}]'::jsonb;
update public.mare_learn_topics set questions = questions || $c$[{"id": "all6", "type": "multi", "q": "Which of these are among the 14 allergens? Tick all that apply.", "answers": ["Celery", "Mustard", "Sesame"], "wrong": ["Tomato", "Rice"]}, {"id": "all7", "type": "match", "q": "Match each food to its allergen group.", "pairs": [["Squid", "Molluscs"], ["Prawns", "Crustaceans"], ["Parmesan", "Milk"], ["Pasta", "Cereals with gluten"]]}, {"id": "all8", "type": "order", "q": "A guest tells you about an allergy. Put the steps in order.", "items": ["Write down the allergy", "Check the recipe card", "If you are not sure, ask the head chef", "Cook with a clean board, knife and pan"]}, {"id": "all9", "type": "multi", "q": "Which of these are tree nuts on the list? Tick all that apply.", "answers": ["Hazelnuts", "Pistachios", "Walnuts"], "wrong": ["Peanuts", "Coconut"]}, {"id": "all10", "q": "Wine can contain which allergen?", "answer": "Sulphites", "wrong": ["Lupin", "Celery", "Soya"]}]$c$::jsonb, updated_at = now() where id = 'allergens' and not questions @> '[{"id":"all6"}]'::jsonb;
update public.mare_learn_topics set questions = questions || $c$[{"id": "cle6", "type": "multi", "q": "What must a hand-wash basin have? Tick all that apply.", "answers": ["Hot and cold running water", "Soap", "A hygienic way to dry your hands"], "wrong": ["Space to rinse vegetables", "One cloth towel shared by everyone"]}, {"id": "cle7", "type": "match", "q": "Match each problem to the rule.", "pairs": [["Mouse droppings", "Tell the head chef, use no exposed food"], ["Cleaning chemicals", "Labelled, away from food"], ["Food waste", "Closable bins, never left to build up"], ["Ice for drinks", "Made from drinking water"]]}, {"id": "cle8", "type": "order", "q": "Clean a board after raw fish, before using it for salad. Put the steps in order.", "items": ["Scrape off the food", "Wash with hot water and detergent", "Rinse", "Disinfect", "Let it dry"]}, {"id": "cle9", "type": "multi", "q": "Which of these are signs of pests? Tick all that apply.", "answers": ["Droppings", "Gnawed packets", "Insects in the dry store"], "wrong": ["Condensation on the walk-in door", "A clean, empty bin"]}, {"id": "cle10", "q": "May a cat come into the kitchen if it is clean?", "answer": "No, never", "wrong": ["Yes, if it stays on the floor", "Yes, after service", "Yes, in the dry store"]}]$c$::jsonb, updated_at = now() where id = 'clean' and not questions @> '[{"id":"cle6"}]'::jsonb;
update public.mare_learn_topics set questions = questions || $c$[{"id": "wor6", "type": "multi", "q": "When must the employer train you in safe work? Tick all that apply.", "answers": ["When you start", "When you change job", "When new equipment arrives"], "wrong": ["Only if you ask for it", "Only on your day off"]}, {"id": "wor7", "type": "match", "q": "Match each subject to what the law says.", "pairs": [["Safety training", "During working hours, paid by the employer"], ["A danger you reported", "Not fixed in 3 days: you may call the labour inspection"], ["Alcohol and drugs", "Never at work"], ["First aid and fire", "People named by the employer"]]}, {"id": "wor8", "type": "order", "q": "Oil in a pan catches fire. Put the steps in order.", "items": ["Turn off the heat, if it is safe", "Cover it with a lid or the fire blanket", "Leave it covered", "Tell the head chef"]}, {"id": "wor9", "type": "multi", "q": "What are your duties under the law? Tick all that apply.", "answers": ["Follow the safety rules", "Use protective equipment as intended", "Report dangers straight away"], "wrong": ["Pay for your own training", "Repair electrical faults yourself"]}, {"id": "wor10", "q": "A broken socket you reported 4 days ago is still not fixed. What may you do?", "answer": "Ask the labour inspection to step in", "wrong": ["Repair it yourself", "Nothing, you must wait", "Stop coming to work"]}]$c$::jsonb, updated_at = now() where id = 'work' and not questions @> '[{"id":"wor6"}]'::jsonb;
