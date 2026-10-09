-- Roberto's Mare: Team activity (9 Oct 2026).
-- Francesco: "where the admin will be, how I can check who's using what, what network they are connected
-- to ... I need an admin for Montenegro specifically" → "yes build team activity".
-- · The team app records who opened what (one line per person per module per 5 minutes): module,
--   a short device description and the internet address the request came from.
-- · A web page cannot read the wifi name; instead the admin marks the restaurant's own internet
--   ("This is the restaurant's internet") and every line shows on the restaurant's internet: yes / no.
-- · mare_m_activity gives the admin one screen: per person, set up or not, last seen, modules,
--   device, on site, Learning results; plus the kitchen closing reports.
-- · master_codes.email lets a master code (1212, Andrea Sacchi's) sign in to the Mare admin as that
--   person (edge fn mare-try, {master}).

create table if not exists public.mare_activity (
  id bigserial primary key,
  staff_id uuid not null references public.mare_staff(id) on delete cascade,
  at timestamptz not null default now(),
  module text not null,
  device text,
  ip text
);
create index if not exists mare_activity_staff_at on public.mare_activity(staff_id, at desc);
alter table public.mare_activity enable row level security;
revoke all on public.mare_activity from anon, authenticated;
revoke all on sequence public.mare_activity_id_seq from anon, authenticated;

insert into public.mare_settings(key, value) values ('site_ips', '[]'::jsonb) on conflict (key) do nothing;

-- the address a request came from (Supabase passes it in the request headers)
create or replace function public.mare_req_ip() returns text
language sql stable as $$
  select nullif(btrim(split_part(coalesce(
    (current_setting('request.headers', true)::json ->> 'cf-connecting-ip'),
    (current_setting('request.headers', true)::json ->> 'x-forwarded-for'),
    (current_setting('request.headers', true)::json ->> 'x-real-ip'), ''), ',', 1)), '')
$$;

-- TEAM: "I opened <module>"
create or replace function public.mare_s_ping(p_device text, p_token text, p_pin text, p_module text, p_ua text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; m text := left(coalesce(nullif(btrim(p_module),''), 'home'), 30);
begin
  a := public.mare_s_auth(p_device, p_token, null, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid; if me is null then return jsonb_build_object('ok', true); end if;   -- the tablet itself: nothing to record
  if not exists (select 1 from public.mare_activity where staff_id = me and module = m and at > now() - interval '5 minutes') then
    insert into public.mare_activity(staff_id, module, device, ip) values (me, m, left(p_ua, 60), public.mare_req_ip());
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- MANAGER: the address I am on now, and marking it as the restaurant's
create or replace function public.mare_m_my_ip() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ip text := public.mare_req_ip();
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'ip', ip,
    'is_site', ip is not null and coalesce((select value from public.mare_settings where key = 'site_ips'), '[]'::jsonb) ? ip,
    'site_ips', coalesce((select value from public.mare_settings where key = 'site_ips'), '[]'::jsonb));
end $$;

create or replace function public.mare_m_site_ip(p_ip text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; ip text := btrim(coalesce(p_ip,''));
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if ip !~ '^[0-9a-fA-F:.]{3,45}$' then return jsonb_build_object('ok', false, 'error', 'ip'); end if;
  select coalesce(value, '[]'::jsonb) into cur from public.mare_settings where key = 'site_ips';
  cur := coalesce((select jsonb_agg(x) from jsonb_array_elements_text(cur) x where x <> ip), '[]'::jsonb);
  if p_on then cur := cur || to_jsonb(ip); end if;
  update public.mare_settings set value = cur where key = 'site_ips';
  return jsonb_build_object('ok', true, 'site_ips', cur);
end $$;

-- MANAGER: the Team activity screen
create or replace function public.mare_m_activity(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f timestamptz := (p_from::timestamp at time zone 'Europe/Podgorica'); t timestamptz := ((p_to + 1)::timestamp at time zone 'Europe/Podgorica');
        site jsonb := coalesce((select value from public.mare_settings where key = 'site_ips'), '[]'::jsonb);
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_to < p_from or p_to - p_from > 62 then return jsonb_build_object('ok', false, 'error', 'range'); end if;
  return jsonb_build_object('ok', true, 'site_ips', site,
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'team', s.team, 'set_up', s.pin_hash is not null, 'set_up_at', s.pin_set_at,
        'last_seen', (select max(a.at) from public.mare_activity a where a.staff_id = s.id),
        'last_device', (select a.device from public.mare_activity a where a.staff_id = s.id order by a.at desc limit 1),
        'last_on_site', (select case when a.ip is null then null else site ? a.ip end from public.mare_activity a where a.staff_id = s.id order by a.at desc limit 1),
        'opens', (select count(*) from public.mare_activity a where a.staff_id = s.id and a.at >= f and a.at < t),
        'on_site_opens', (select count(*) from public.mare_activity a where a.staff_id = s.id and a.at >= f and a.at < t and a.ip is not null and site ? a.ip),
        'modules', coalesce((select jsonb_object_agg(module, n) from (select module, count(*) n from public.mare_activity a where a.staff_id = s.id and a.at >= f and a.at < t group by module) z), '{}'::jsonb),
        'learn', (select jsonb_build_object('tests', count(*), 'best', max(score), 'total', max(total), 'passed', bool_or(passed), 'last_at', max(finished_at))
                    from public.mare_learn_attempts l where l.staff_id = s.id and l.finished_at is not null))
        order by s.team, s.sort, s.name)
      from public.mare_staff s where s.active and s.name !~* '^zz'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'at', a.at, 'module', a.module, 'device', a.device,
                         'on_site', case when a.ip is null then null else site ? a.ip end, 'ip', a.ip) order by a.at desc)
      from (select * from public.mare_activity where at >= f and at < t order by at desc limit 200) a join public.mare_staff s on s.id = a.staff_id), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(k) - 'staff_id' order by k.date desc)
      from public.mare_kreport k where k.date between p_from and p_to and not k.is_test), '[]'::jsonb));
end $$;

-- a master code signs in to the Mare admin as its holder
alter table public.master_codes add column if not exists email text;
update public.master_codes set email = 'fguarracino@robertos.ae' where name = 'Chef Francesco' and email is null;
update public.master_codes set email = 'asacchi@skelmore.com' where name = 'Andrea Sacchi' and email is null;

revoke all on function public.mare_req_ip(), public.mare_s_ping(text,text,text,text,text), public.mare_m_my_ip(), public.mare_m_site_ip(text,boolean), public.mare_m_activity(date,date) from public;
grant execute on function public.mare_s_ping(text,text,text,text,text) to anon, authenticated;
grant execute on function public.mare_m_my_ip(), public.mare_m_site_ip(text,boolean), public.mare_m_activity(date,date) to authenticated;
