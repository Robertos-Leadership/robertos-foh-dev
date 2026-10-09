-- Roberto's Mare: first access for the kitchen team (9 Oct 2026).
-- Francesco: the Mare chefs start with three modules only: Recipes from Dubai, a Schedule, and a
-- Closing report sent to him. "Only Vinay edit the schedule, use same format as Dubai."
--
-- 1. mare_staff.can_rota: who may edit the team rota from their own phone link (Vinay only).
-- 2. mare_shifts gets a split shift (start2_t / end2_t), as the Dubai schedule has.
-- 3. mare_s_rota / mare_s_shift_save / mare_s_shift_clear: the team rota, read by anyone with a
--    phone link or the tablet, written only by a can_rota person, for their own team.
-- 4. mare_kreport: the kitchen closing report, in the Dubai sections (Complaints, 86, Operation,
--    Team, General feedback). "Send" queues a mail in mare_kreport_mail that the edge function
--    mare-kreport-notify sends to mare_settings 'kitchen_report_to'.
-- 5. The Kitchen team sees only rota, recipes and kclose.

alter table public.mare_staff add column if not exists can_rota boolean not null default false;
alter table public.mare_shifts add column if not exists start2_t text check (start2_t is null or start2_t ~ '^\d{2}:\d{2}$');
alter table public.mare_shifts add column if not exists end2_t text check (end2_t is null or end2_t ~ '^\d{2}:\d{2}$');

-- ── the rota, for one week ──
create or replace function public.mare_s_rota(p_device text, p_token text, p_staff uuid, p_pin text, p_ws date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; ws date := coalesce(p_ws, date_trunc('week', public.mare_today())::date);
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid;
  ws := date_trunc('week', ws)::date;
  if ws < public.mare_today() - 120 or ws > public.mare_today() + 120 then return jsonb_build_object('ok', false, 'error', 'range'); end if;
  return jsonb_build_object('ok', true, 'week_start', ws, 'today', public.mare_today(), 'now', now(),
    'can_rota', coalesce((select can_rota from public.mare_staff where id = me), false),
    'my_team', (select team from public.mare_staff where id = me),
    'editors', coalesce((select jsonb_agg(name order by sort, name) from public.mare_staff where active and can_rota), '[]'::jsonb),
    'kitchen_min', coalesce((select (value #>> '{}')::int from public.mare_settings where key = 'kitchen_min'), 3),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'team', s.team, 'role', s.role) order by s.team, s.sort, s.name)
                       from public.mare_staff s where s.active), '[]'::jsonb),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('staff_id', h.staff_id, 'date', h.date, 'kind', h.kind, 'start_t', h.start_t, 'end_t', h.end_t,
                                                            'start2_t', h.start2_t, 'end2_t', h.end2_t, 'note', h.note))
                        from public.mare_shifts h join public.mare_staff s on s.id = h.staff_id and s.active
                        where h.date between ws and ws + 6), '[]'::jsonb),
    'punches', coalesce((select jsonb_agg(jsonb_build_object('staff_id', p.staff_id, 'dir', p.dir, 'at', p.at) order by p.at)
                         from public.mare_punches p join public.mare_staff s on s.id = p.staff_id and s.active
                         where not p.voided and p.at >= (ws::timestamp at time zone 'Europe/Podgorica') - interval '1 day'
                           and p.at < ((ws + 8)::timestamp at time zone 'Europe/Podgorica')), '[]'::jsonb));
end $$;

-- ── a can_rota person sets one day for someone in their own team ──
create or replace function public.mare_s_shift_save(p_device text, p_token text, p_staff uuid, p_pin text, p_for uuid, p_date date,
  p_kind text, p_start text, p_end text, p_start2 text, p_end2 text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; meteam text; ok boolean;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid; if me is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  select can_rota, team into ok, meteam from public.mare_staff where id = me;
  if not coalesce(ok, false) then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if not exists (select 1 from public.mare_staff where id = p_for and active and team = meteam) then return jsonb_build_object('ok', false, 'error', 'team'); end if;
  if p_date is null or p_date < public.mare_today() - 14 or p_date > public.mare_today() + 120 then return jsonb_build_object('ok', false, 'error', 'range'); end if;
  if p_kind not in ('work','off','leave','sick') then return jsonb_build_object('ok', false, 'error', 'kind'); end if;
  if p_kind = 'work' and (coalesce(p_start,'') !~ '^\d{2}:\d{2}$' or coalesce(p_end,'') !~ '^\d{2}:\d{2}$') then return jsonb_build_object('ok', false, 'error', 'times'); end if;
  if p_kind = 'work' and ((p_start2 is null) <> (p_end2 is null)) then return jsonb_build_object('ok', false, 'error', 'times'); end if;
  insert into public.mare_shifts(staff_id, date, kind, start_t, end_t, start2_t, end2_t, note, updated_by, updated_at)
  values (p_for, p_date, p_kind,
          case when p_kind = 'work' then p_start end, case when p_kind = 'work' then p_end end,
          case when p_kind = 'work' then p_start2 end, case when p_kind = 'work' then p_end2 end,
          nullif(left(btrim(coalesce(p_note,'')),200),''), (select name from public.mare_staff where id = me), now())
  on conflict (staff_id, date) do update set kind = excluded.kind, start_t = excluded.start_t, end_t = excluded.end_t,
    start2_t = excluded.start2_t, end2_t = excluded.end2_t, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mare_s_shift_clear(p_device text, p_token text, p_staff uuid, p_pin text, p_for uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; meteam text; ok boolean;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid; if me is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  select can_rota, team into ok, meteam from public.mare_staff where id = me;
  if not coalesce(ok, false) then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if not exists (select 1 from public.mare_staff where id = p_for and team = meteam) then return jsonb_build_object('ok', false, 'error', 'team'); end if;
  delete from public.mare_shifts where staff_id = p_for and date = p_date;
  return jsonb_build_object('ok', true);
end $$;

-- ── kitchen closing report ──
create table if not exists public.mare_kreport (
  date date primary key,
  entries jsonb not null default '[]'::jsonb,   -- [{type: complaint|unavailable|operation|team, category, item, detail, action}]
  chefs_on text[] not null default '{}',
  feedback text,
  written_by text,
  staff_id uuid references public.mare_staff(id),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by text,
  sent_count int not null default 0,
  is_test boolean not null default false
);
alter table public.mare_kreport add column if not exists rating int check (rating between 1 and 5);   -- service, as in Dubai (1–5)
-- 9 Oct 2026, Francesco: "need also to know the number of guest served and the total revenue"
alter table public.mare_kreport add column if not exists guests int check (guests between 0 and 5000);
alter table public.mare_kreport add column if not exists revenue numeric(12,2) check (revenue >= 0);
create table if not exists public.mare_kreport_mail (
  id bigserial primary key,
  date date not null references public.mare_kreport(date) on delete cascade,
  to_list text[] not null,
  is_test boolean not null default false,
  resend boolean not null default false,
  status text not null default 'queued',
  tries int not null default 0,
  resend_id text, error text,
  created_at timestamptz not null default now(), sent_at timestamptz
);
alter table public.mare_kreport enable row level security;
alter table public.mare_kreport_mail enable row level security;
revoke all on public.mare_kreport, public.mare_kreport_mail from anon, authenticated;
revoke all on sequence public.mare_kreport_mail_id_seq from anon, authenticated;

insert into public.mare_settings(key, value) values ('kitchen_report_to', '["fguarracino@robertos.ae"]'::jsonb)
  on conflict (key) do nothing;

create or replace function public.mare_kreport_kick(p_mail bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://paoaivwtkzujmrgrfjuq.supabase.co/functions/v1/mare-kreport-notify',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhb2Fpdnd0a3p1am1yZ3JmanVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzAxMzAsImV4cCI6MjA5NjY0NjEzMH0.VynG9PBeIaqRG2lkMEuzskkcB11EhR-UfO9eGYsaUxk'),
    body := jsonb_build_object('mail', p_mail));
end $$;

-- read one day's report (and who is on the rota that day, to pre-tick "chefs on duty")
create or replace function public.mare_s_kreport_get(p_device text, p_token text, p_staff uuid, p_pin text, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; d date := coalesce(p_date, public.mare_today()); me uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid;
  if d < public.mare_today() - 60 or d > public.mare_today() then return jsonb_build_object('ok', false, 'error', 'range'); end if;
  return jsonb_build_object('ok', true, 'date', d, 'today', public.mare_today(),
    'send_to', coalesce((select value #>> '{}' from public.mare_settings where key = 'kitchen_report_label'), 'the chefs'),
    'report', (select to_jsonb(k) - 'staff_id' - 'is_test' from public.mare_kreport k where k.date = d),
    'kitchen', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'on', exists (select 1 from public.mare_shifts h where h.staff_id = s.id and h.date = d and h.kind = 'work')) order by s.sort, s.name)
                         from public.mare_staff s where s.active and s.team = 'Kitchen' and s.name !~* '^zz\M'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('date', k.date, 'sent_at', k.sent_at, 'by', coalesce(k.sent_by, k.written_by), 'n', jsonb_array_length(k.entries)) order by k.date desc)
                        from (select * from public.mare_kreport where date >= public.mare_today() - 14 and (not is_test or me = staff_id) order by date desc limit 14) k), '[]'::jsonb));
end $$;

-- save (and, with p_send, email) the report. Anyone in the Kitchen team may write it.
drop function if exists public.mare_s_kreport_save(text,text,uuid,text,date,jsonb,text[],text,boolean);
drop function if exists public.mare_s_kreport_save(text,text,uuid,text,date,jsonb,text[],text,int,boolean);
create or replace function public.mare_s_kreport_save(p_device text, p_token text, p_staff uuid, p_pin text, p_date date,
  p_entries jsonb, p_chefs text[], p_feedback text, p_rating int, p_guests int, p_revenue numeric, p_send boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; nm text; tm text; d date := coalesce(p_date, public.mare_today()); ents jsonb; v_to text[]; mail bigint; test boolean; was timestamptz;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid; if me is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  select name, team into nm, tm from public.mare_staff where id = me;
  if tm <> 'Kitchen' then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if d < public.mare_today() - 7 or d > public.mare_today() then return jsonb_build_object('ok', false, 'error', 'range'); end if;
  -- keep only well-formed entries, trimmed
  select coalesce(jsonb_agg(jsonb_build_object('type', e->>'type', 'category', left(coalesce(e->>'category',''),40),
            'item', nullif(left(btrim(coalesce(e->>'item','')),120),''), 'detail', nullif(left(btrim(coalesce(e->>'detail','')),600),''),
            'action', nullif(left(btrim(coalesce(e->>'action','')),600),''))), '[]'::jsonb)
    into ents from jsonb_array_elements(case when jsonb_typeof(p_entries) = 'array' then p_entries else '[]'::jsonb end) e
   where e->>'type' in ('complaint','unavailable','operation','team');
  if jsonb_array_length(ents) > 60 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  if p_guests is not null and (p_guests < 0 or p_guests > 5000) then return jsonb_build_object('ok', false, 'error', 'guests'); end if;
  if p_revenue is not null and (p_revenue < 0 or p_revenue > 1000000) then return jsonb_build_object('ok', false, 'error', 'revenue'); end if;
  if coalesce(p_send, false) and (p_guests is null or p_revenue is null) then return jsonb_build_object('ok', false, 'error', 'figures'); end if;
  test := nm ~* '^zz\M' or coalesce(p_feedback,'') ~* '^\s*zz';
  select sent_at into was from public.mare_kreport where date = d;
  insert into public.mare_kreport(date, entries, chefs_on, feedback, rating, guests, revenue, written_by, staff_id, updated_at, is_test)
  values (d, ents, coalesce((select array_agg(left(x,60)) from unnest(coalesce(p_chefs,'{}')) x where btrim(x) <> ''), '{}'),
          nullif(left(btrim(coalesce(p_feedback,'')),4000),''), case when p_rating between 1 and 5 then p_rating end, p_guests, round(p_revenue, 2), nm, me, now(), test)
  on conflict (date) do update set entries = excluded.entries, chefs_on = excluded.chefs_on, feedback = excluded.feedback, rating = excluded.rating, guests = excluded.guests, revenue = excluded.revenue,
    written_by = excluded.written_by, staff_id = excluded.staff_id, updated_at = now(), is_test = excluded.is_test;
  if coalesce(p_send, false) then
    if test then v_to := array['fguarracino@robertos.ae'];
    else select coalesce(array_agg(x), '{}') into v_to from jsonb_array_elements_text(coalesce((select value from public.mare_settings where key = 'kitchen_report_to'), '[]'::jsonb)) x;
    end if;
    if coalesce(cardinality(v_to), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'no_recipient', 'saved', true); end if;
    update public.mare_kreport set sent_at = now(), sent_by = nm, sent_count = sent_count + 1 where date = d;
    insert into public.mare_kreport_mail(date, to_list, is_test, resend) values (d, v_to, test, was is not null) returning id into mail;
    perform public.mare_kreport_kick(mail);
    return jsonb_build_object('ok', true, 'sent', true, 'mail', mail);
  end if;
  return jsonb_build_object('ok', true, 'sent', false);
end $$;

revoke all on function public.mare_s_rota(text,text,uuid,text,date), public.mare_s_shift_save(text,text,uuid,text,uuid,date,text,text,text,text,text,text),
  public.mare_s_shift_clear(text,text,uuid,text,uuid,date), public.mare_kreport_kick(bigint),
  public.mare_s_kreport_get(text,text,uuid,text,date), public.mare_s_kreport_save(text,text,uuid,text,date,jsonb,text[],text,int,int,numeric,boolean) from public;
grant execute on function public.mare_s_rota(text,text,uuid,text,date), public.mare_s_shift_save(text,text,uuid,text,uuid,date,text,text,text,text,text,text),
  public.mare_s_shift_clear(text,text,uuid,text,uuid,date),
  public.mare_s_kreport_get(text,text,uuid,text,date), public.mare_s_kreport_save(text,text,uuid,text,date,jsonb,text[],text,int,int,numeric,boolean) to anon, authenticated;

-- Vinay edits the rota; the Kitchen team sees Schedule, Recipes and the Closing report only.
update public.mare_staff set can_rota = true where name = 'Vinay Rawat' and team = 'Kitchen';
update public.mare_settings set value = jsonb_set(value, '{Kitchen}', '["rota","recipes","kclose"]'::jsonb) where key = 'team_modules';

-- 9 Oct 2026, Francesco: the closing report goes to him AND Andrea Falcone. The button names them
-- from kitchen_report_label, so a change of recipients is two settings, no code.
update public.mare_settings set value = '["fguarracino@robertos.ae","afalcone@robertos.ae"]'::jsonb where key = 'kitchen_report_to';
insert into public.mare_settings(key, value) values ('kitchen_report_label', '"Chef Francesco and Chef Andrea"'::jsonb)
  on conflict (key) do update set value = excluded.value;
