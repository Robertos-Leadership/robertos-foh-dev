-- Roberto's Mare: "Ask the chef" under every recipe card (8 Oct 2026).
-- Andrea Falcone, Tell us 2bf15403: a button at the end of the recipe so a team member can ask
-- about anything not clear; it reaches afalcone@robertos.ae, and he answers below it like a chat.
--
-- One thread per question (mare_rq), its messages (mare_rq_msgs), and a mail queue (mare_rq_mail)
-- sent by the edge function mare-rq-notify through pg_net, the same shape as FOH Maintenance.
-- The DATABASE decides who is mailed: mare_settings 'recipe_question_to'. A test question
-- (text or staff name starting "zz") goes to Francesco only and its subject gets [TEST].
-- The chef answers from the link in the mail: a 32-hex secret per thread, no password.

create table if not exists public.mare_rq (
  id uuid primary key default gen_random_uuid(),
  recipe_kind text not null check (recipe_kind in ('mare','dubai','batch')),
  recipe_id text not null,
  recipe_name text not null,
  staff_id uuid references public.mare_staff(id),
  staff_name text not null,
  answer_token text not null unique default encode(extensions.gen_random_bytes(16),'hex'),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  answered boolean not null default false
);
create index if not exists mare_rq_recipe on public.mare_rq(recipe_kind, recipe_id);

create table if not exists public.mare_rq_msgs (
  id bigserial primary key,
  q_id uuid not null references public.mare_rq(id) on delete cascade,
  from_chef boolean not null default false,
  author text not null,
  text text not null,
  at timestamptz not null default now()
);
create index if not exists mare_rq_msgs_q on public.mare_rq_msgs(q_id, at);

create table if not exists public.mare_rq_mail (
  id bigserial primary key,
  q_id uuid not null references public.mare_rq(id) on delete cascade,
  msg_id bigint references public.mare_rq_msgs(id) on delete cascade,
  to_list text[] not null,
  is_test boolean not null default false,
  status text not null default 'queued',
  tries int not null default 0,
  resend_id text, error text, sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mare_rq enable row level security;
alter table public.mare_rq_msgs enable row level security;
alter table public.mare_rq_mail enable row level security;
revoke all on public.mare_rq, public.mare_rq_msgs, public.mare_rq_mail from anon, authenticated;

insert into public.mare_settings(key, value) values ('recipe_question_to', '["afalcone@robertos.ae"]'::jsonb)
on conflict (key) do nothing;

create or replace function public.mare_rq_kick(p_mail bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://paoaivwtkzujmrgrfjuq.supabase.co/functions/v1/mare-rq-notify',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhb2Fpdnd0a3p1am1yZ3JmanVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzAxMzAsImV4cCI6MjA5NjY0NjEzMH0.VynG9PBeIaqRG2lkMEuzskkcB11EhR-UfO9eGYsaUxk'),
    body := jsonb_build_object('mail', p_mail));
end $$;

-- the thread as either side sees it
create or replace function public.mare_rq_json(p_q uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', q.id, 'recipe_kind', q.recipe_kind, 'recipe_id', q.recipe_id, 'recipe_name', q.recipe_name,
    'staff_name', q.staff_name, 'created_at', q.created_at, 'answered', q.answered,
    'msgs', coalesce((select jsonb_agg(jsonb_build_object('from_chef', m.from_chef, 'author', m.author, 'text', m.text, 'at', m.at) order by m.at, m.id)
                      from public.mare_rq_msgs m where m.q_id = q.id), '[]'::jsonb))
  from public.mare_rq q where q.id = p_q;
$$;

-- TEAM: every question asked about this card, with the answers (the whole team learns from each one)
create or replace function public.mare_s_rq_list(p_device text, p_token text, p_pin text, p_kind text, p_recipe text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  a := public.mare_s_auth(p_device, p_token, null, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  return jsonb_build_object('ok', true, 'threads', coalesce((select jsonb_agg(public.mare_rq_json(q.id) order by q.created_at desc)
    from public.mare_rq q where q.recipe_kind = p_kind and q.recipe_id = p_recipe
      and (not q.is_test or a->>'via' = 'tablet' or q.staff_id = (a->>'id')::uuid)), '[]'::jsonb));   -- a zz test: on the tablet and its asker's phone only
end $$;

-- TEAM: a new question (p_q null) or a reply under an existing one. Mails the chef either way.
create or replace function public.mare_s_rq_ask(p_device text, p_token text, p_staff uuid, p_pin text,
   p_kind text, p_recipe text, p_name text, p_q uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; v uuid; nm text; q public.mare_rq; mid bigint; v_to text[]; mail bigint; t text := btrim(coalesce(p_text,''));
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  v := (a->>'id')::uuid; if v is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  if length(t) < 3 then return jsonb_build_object('ok', false, 'error', 'text'); end if;
  if (select count(*) from public.mare_rq_msgs where at > now() - interval '1 day' and not from_chef) >= 60 then
    return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  select name into nm from public.mare_staff where id = v;
  if p_q is null then
    if p_kind not in ('mare','dubai','batch') or length(btrim(coalesce(p_recipe,''))) = 0 or length(btrim(coalesce(p_name,''))) = 0 then
      return jsonb_build_object('ok', false, 'error', 'recipe'); end if;
    insert into public.mare_rq(recipe_kind, recipe_id, recipe_name, staff_id, staff_name, is_test)
    values (p_kind, left(btrim(p_recipe),80), left(btrim(p_name),200), v, nm, t ~* '^zz' or nm ~* '^zz') returning * into q;
  else
    select * into q from public.mare_rq where id = p_q;
    if q.id is null then return jsonb_build_object('ok', false, 'error', 'thread'); end if;
    update public.mare_rq set last_at = now(), answered = false where id = q.id;
  end if;
  insert into public.mare_rq_msgs(q_id, from_chef, author, text) values (q.id, false, nm, left(t, 2000)) returning id into mid;
  if q.is_test then v_to := array['fguarracino@robertos.ae'];
  else select array_agg(lower(x)) into v_to from jsonb_array_elements_text(coalesce((select value from public.mare_settings where key = 'recipe_question_to'), '[]'::jsonb)) x;
  end if;
  if v_to is not null and cardinality(v_to) > 0 then
    insert into public.mare_rq_mail(q_id, msg_id, to_list, is_test) values (q.id, mid, v_to, q.is_test) returning id into mail;
    perform public.mare_rq_kick(mail);
  end if;
  return jsonb_build_object('ok', true, 'thread', public.mare_rq_json(q.id), 'mailed', coalesce(cardinality(v_to), 0) > 0);
end $$;

-- CHEF (the link in the mail): read the thread, and answer it
create or replace function public.mare_rq_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q uuid;
begin
  select id into q from public.mare_rq where answer_token = coalesce(p_token,'-') and length(p_token) = 32;
  if q is null then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  return jsonb_build_object('ok', true, 'thread', public.mare_rq_json(q));
end $$;

create or replace function public.mare_rq_answer(p_token text, p_text text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q uuid; t text := btrim(coalesce(p_text,''));
begin
  select id into q from public.mare_rq where answer_token = coalesce(p_token,'-') and length(p_token) = 32;
  if q is null then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  if length(t) < 2 then return jsonb_build_object('ok', false, 'error', 'text'); end if;
  insert into public.mare_rq_msgs(q_id, from_chef, author, text) values (q, true, coalesce(nullif(left(btrim(coalesce(p_name,'')),60),''), 'Chef'), left(t, 4000));
  update public.mare_rq set answered = true, last_at = now() where id = q;
  return jsonb_build_object('ok', true, 'thread', public.mare_rq_json(q));
end $$;

revoke all on function public.mare_rq_kick(bigint), public.mare_rq_json(uuid),
  public.mare_s_rq_list(text,text,text,text,text), public.mare_s_rq_ask(text,text,uuid,text,text,text,text,uuid,text),
  public.mare_rq_get(text), public.mare_rq_answer(text,text,text) from public, anon, authenticated;
grant execute on function public.mare_s_rq_list(text,text,text,text,text) to anon, authenticated;
grant execute on function public.mare_s_rq_ask(text,text,uuid,text,text,text,text,uuid,text) to anon, authenticated;
grant execute on function public.mare_rq_get(text) to anon, authenticated;
grant execute on function public.mare_rq_answer(text,text,text) to anon, authenticated;
