-- ══════════════════════════════════════════════════════════════════════
-- Roberto's Mare (Porto Montenegro) — staff clock-in / clock-out
-- 6 Oct 2026. Additive only: every object is mare_-prefixed and nothing
-- existing is touched. Mare staff are NOT foh_staff — they never appear on
-- the DIFC roster (Operations/Staff Identity Model in the vault).
--
-- Who can do what:
--   * The tablet (anon key) can ONLY call mare_kiosk_* and only with a valid
--     tablet code that Milica creates on her page. No table is readable.
--   * A staff phone can ONLY call mare_me with its own private link token + PIN.
--   * Milica's page (signed-in FOH account) calls mare_mgr_*; every one checks
--     app_users has 'mare' in modules (or is_admin).
-- Times are stored as timestamptz; Mare's clock is Europe/Podgorica.
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.mare_staff (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 60),
  team           text not null default 'Service' check (team in ('Kitchen','Service','Bar','Other')),
  active         boolean not null default true,
  pin_hash       text,
  pin_set_at     timestamptz,
  contract_hours numeric(5,2) not null default 40 check (contract_hours between 0 and 84),
  start_times    jsonb not null default '{}'::jsonb,   -- {"1":"10:00",...,"7":null}  ISO weekday → usual start
  phone_token    text not null unique default encode(extensions.gen_random_bytes(16),'hex'),
  sort           int not null default 0,
  created_at     timestamptz not null default now(),
  created_by     text
);

create table if not exists public.mare_devices (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code_hash  text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text,
  last_seen  timestamptz
);

create table if not exists public.mare_punches (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.mare_staff(id),
  dir         text not null check (dir in ('in','out')),
  at          timestamptz not null,
  received_at timestamptz not null default now(),
  source      text not null default 'tablet' check (source in ('tablet','manager')),
  device_id   uuid references public.mare_devices(id),
  offline     boolean not null default false,
  entered_by  text,
  reason      text,
  voided      boolean not null default false,
  void_reason text,
  voided_by   text,
  voided_at   timestamptz,
  client_id   text unique
);
create index if not exists mare_punches_staff_at on public.mare_punches(staff_id, at);
create index if not exists mare_punches_at on public.mare_punches(at);

-- Photos live apart from the punches so the lists stay small and fast.
create table if not exists public.mare_punch_photos (
  punch_id uuid primary key references public.mare_punches(id),
  jpeg     text not null          -- data:image/jpeg;base64,… (≈8 KB, 240×180)
);

create table if not exists public.mare_pin_events (
  id       uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.mare_staff(id),
  kind     text not null check (kind in ('set','reset','locked','offline_wrong_pin')),
  at       timestamptz not null default now(),
  by       text
);

create table if not exists public.mare_pin_fails (
  staff_id uuid not null references public.mare_staff(id),
  at       timestamptz not null default now()
);
create index if not exists mare_pin_fails_staff on public.mare_pin_fails(staff_id, at);

create table if not exists public.mare_notes (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.mare_staff(id),
  kind       text not null check (kind in ('late_accepted','warning','photo_flag','general')),
  ref_date   date,
  punch_id   uuid references public.mare_punches(id),
  text       text not null default '',
  by         text,
  at         timestamptz not null default now()
);

-- Lock every table: RLS on, no policies, no grants. Only the functions below get in.
do $$ declare t text; begin
  foreach t in array array['mare_staff','mare_devices','mare_punches','mare_punch_photos','mare_pin_events','mare_pin_fails','mare_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ── helpers ──────────────────────────────────────────────────────────────
create or replace function public.mare_is_mgr() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_users u
    where lower(u.email) = lower(coalesce(auth.jwt()->>'email',''))
      and ('mare' = any(u.modules) or u.is_admin)
  );
$$;

create or replace function public.mare_device_id(p_code text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  select id into v from public.mare_devices
   where active and code_hash = encode(extensions.digest(upper(btrim(coalesce(p_code,''))),'sha256'),'hex');
  if v is not null then update public.mare_devices set last_seen = now() where id = v; end if;
  return v;
end $$;

-- Is this person clocked in right now? (last valid punch is an IN from the last 20 h)
create or replace function public.mare_open_in(p_staff uuid, p_at timestamptz) returns public.mare_punches
language sql stable security definer set search_path = public as $$
  select p.* from public.mare_punches p
   where p.staff_id = p_staff and not p.voided and p.at <= p_at
   order by p.at desc limit 1;
$$;

-- PIN check with a lock: 5 wrong codes in 15 minutes locks that name for 15 minutes.
create or replace function public.mare_pin_ok(p_staff uuid, p_pin text, p_offline boolean default false) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare h text; n int;
begin
  select pin_hash into h from public.mare_staff where id = p_staff;
  if h is null then return 'no_pin'; end if;
  select count(*) into n from public.mare_pin_fails where staff_id = p_staff and at > now() - interval '15 minutes';
  if n >= 5 then return 'locked'; end if;
  if p_pin is null or p_pin !~ '^\d{4}$' or extensions.crypt(p_pin, h) <> h then
    insert into public.mare_pin_fails(staff_id) values (p_staff);
    if p_offline then insert into public.mare_pin_events(staff_id, kind, by) values (p_staff, 'offline_wrong_pin', 'tablet'); end if;
    if n + 1 >= 5 then insert into public.mare_pin_events(staff_id, kind, by) values (p_staff, 'locked', 'tablet'); return 'locked'; end if;
    return 'wrong_pin';
  end if;
  delete from public.mare_pin_fails where staff_id = p_staff;
  return 'ok';
end $$;

-- ── tablet ───────────────────────────────────────────────────────────────
create or replace function public.mare_kiosk_board(p_device text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare dev uuid;
begin
  dev := public.mare_device_id(p_device);
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;
  return jsonb_build_object('ok', true, 'now', now(), 'staff', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'team', s.team, 'has_pin', s.pin_hash is not null,
             'in', coalesce(l.dir = 'in' and now() - l.at < interval '20 hours', false),
             'since', case when l.dir = 'in' and now() - l.at < interval '20 hours' then l.at end)
           order by s.team, s.sort, s.name)
      from public.mare_staff s
      left join lateral (select dir, at from public.mare_punches p
                          where p.staff_id = s.id and not p.voided and p.at <= now()
                          order by p.at desc limit 1) l on true
     where s.active), '[]'::jsonb));
end $$;

create or replace function public.mare_kiosk_set_pin(p_device text, p_staff uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare dev uuid; n int;
begin
  dev := public.mare_device_id(p_device);
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;
  if p_pin is null or p_pin !~ '^\d{4}$' then return jsonb_build_object('ok', false, 'error', 'format'); end if;
  update public.mare_staff set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), pin_set_at = now()
   where id = p_staff and active and pin_hash is null;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'already_set'); end if;
  insert into public.mare_pin_events(staff_id, kind, by) values (p_staff, 'set', 'tablet');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mare_kiosk_punch(p_device text, p_staff uuid, p_pin text, p_photo text,
                                                   p_client_id text, p_client_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare dev uuid; st public.mare_staff; prev public.mare_punches; ex public.mare_punches;
        v_at timestamptz := now(); v_off boolean := false; v_dir text; v_id uuid; chk text;
begin
  dev := public.mare_device_id(p_device);
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;

  -- The same punch sent twice (offline retry) is answered, never doubled.
  if p_client_id is not null then
    select * into ex from public.mare_punches where client_id = p_client_id;
    if found then
      return jsonb_build_object('ok', true, 'dir', ex.dir, 'at', ex.at, 'repeat', true,
                                'name', (select name from public.mare_staff where id = ex.staff_id));
    end if;
  end if;

  select * into st from public.mare_staff where id = p_staff and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'staff'); end if;

  if p_client_at is not null and p_client_at < now() - interval '2 minutes' and p_client_at > now() - interval '48 hours' then
    v_at := p_client_at; v_off := true;     -- sent late because the tablet was offline
  end if;

  chk := public.mare_pin_ok(p_staff, p_pin, v_off);
  if chk <> 'ok' then return jsonb_build_object('ok', false, 'error', chk); end if;

  prev := public.mare_open_in(p_staff, v_at);
  -- A second tap straight after a punch is a mistake, not a clock-out.
  if prev.at is not null and v_at - prev.at < interval '2 minutes' and not v_off then
    return jsonb_build_object('ok', false, 'error', 'just_punched', 'dir', prev.dir, 'at', prev.at, 'name', st.name);
  end if;
  v_dir := case when prev.dir = 'in' and v_at - prev.at < interval '20 hours' then 'out' else 'in' end;

  insert into public.mare_punches(staff_id, dir, at, source, device_id, offline, client_id)
  values (p_staff, v_dir, v_at, 'tablet', dev, v_off, p_client_id) returning id into v_id;

  if p_photo is not null and p_photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(p_photo) < 300000 then
    insert into public.mare_punch_photos(punch_id, jpeg) values (v_id, p_photo);
  end if;

  return jsonb_build_object('ok', true, 'dir', v_dir, 'at', v_at, 'name', st.name, 'offline', v_off,
           'worked_min', case when v_dir = 'out' then floor(extract(epoch from (v_at - prev.at)) / 60) end);
end $$;

-- ── staff phone: own hours only, private link + PIN ──────────────────────
create or replace function public.mare_me(p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st public.mare_staff; chk text;
begin
  select * into st from public.mare_staff where phone_token = p_token and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  if p_pin is null then
    return jsonb_build_object('ok', true, 'name', st.name, 'need_pin', true, 'has_pin', st.pin_hash is not null);
  end if;
  chk := public.mare_pin_ok(st.id, p_pin, false);
  if chk <> 'ok' then return jsonb_build_object('ok', false, 'error', chk, 'name', st.name); end if;
  return jsonb_build_object('ok', true, 'name', st.name, 'now', now(), 'punches', coalesce((
    select jsonb_agg(jsonb_build_object('dir', p.dir, 'at', p.at, 'source', p.source) order by p.at)
      from public.mare_punches p
     where p.staff_id = st.id and not p.voided and p.at > now() - interval '16 days'), '[]'::jsonb));
end $$;

-- ── Milica's page ────────────────────────────────────────────────────────
create or replace function public.mare_mgr_overview(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a timestamptz; b timestamptz;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  a := (p_from::timestamp - interval '1 day') at time zone 'Europe/Podgorica';
  b := (p_to::timestamp + interval '2 days') at time zone 'Europe/Podgorica';
  return jsonb_build_object('ok', true, 'now', now(),
    'me', (select coalesce(name, email) from public.app_users where lower(email) = lower(auth.jwt()->>'email') limit 1),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'team', s.team, 'active', s.active, 'has_pin', s.pin_hash is not null,
        'pin_set_at', s.pin_set_at, 'contract_hours', s.contract_hours, 'start_times', s.start_times,
        'phone_token', s.phone_token, 'sort', s.sort) order by s.team, s.sort, s.name)
      from public.mare_staff s), '[]'::jsonb),
    'punches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'staff_id', p.staff_id, 'dir', p.dir, 'at', p.at, 'source', p.source, 'offline', p.offline,
        'entered_by', p.entered_by, 'reason', p.reason, 'voided', p.voided, 'void_reason', p.void_reason,
        'has_photo', exists (select 1 from public.mare_punch_photos f where f.punch_id = p.id)) order by p.at)
      from public.mare_punches p where p.at >= a and p.at < b), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.at desc)
      from public.mare_notes n where n.at > now() - interval '120 days'), '[]'::jsonb),
    'pin_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc)
      from public.mare_pin_events e where e.at > now() - interval '60 days'), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'active', d.active,
        'created_at', d.created_at, 'last_seen', d.last_seen) order by d.created_at)
      from public.mare_devices d), '[]'::jsonb));
end $$;

create or replace function public.mare_mgr_photos(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'photos', coalesce((
    select jsonb_object_agg(f.punch_id, f.jpeg) from public.mare_punch_photos f
     where f.punch_id = any(p_ids[1:400])), '{}'::jsonb));
end $$;

create or replace function public.mare_mgr_staff_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if nullif(p->>'id','') is null then
    insert into public.mare_staff(name, team, contract_hours, start_times, created_by)
    values (btrim(p->>'name'), coalesce(p->>'team','Service'), coalesce((p->>'contract_hours')::numeric, 40),
            coalesce(p->'start_times','{}'::jsonb), auth.jwt()->>'email')
    returning id into v_id;
  else
    v_id := (p->>'id')::uuid;
    update public.mare_staff set
      name           = coalesce(nullif(btrim(p->>'name'),''), name),
      team           = coalesce(p->>'team', team),
      active         = coalesce((p->>'active')::boolean, active),
      contract_hours = coalesce((p->>'contract_hours')::numeric, contract_hours),
      start_times    = coalesce(p->'start_times', start_times)
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.mare_mgr_reset_pin(p_staff uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  update public.mare_staff set pin_hash = null, pin_set_at = null where id = p_staff;
  delete from public.mare_pin_fails where staff_id = p_staff;
  insert into public.mare_pin_events(staff_id, kind, by) values (p_staff, 'reset', auth.jwt()->>'email');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mare_mgr_punch_add(p_staff uuid, p_dir text, p_at timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_dir not in ('in','out') then return jsonb_build_object('ok', false, 'error', 'dir'); end if;
  if length(btrim(coalesce(p_reason,''))) < 2 then return jsonb_build_object('ok', false, 'error', 'reason'); end if;
  if p_at > now() + interval '5 minutes' then return jsonb_build_object('ok', false, 'error', 'future'); end if;
  insert into public.mare_punches(staff_id, dir, at, source, entered_by, reason)
  values (p_staff, p_dir, p_at, 'manager', auth.jwt()->>'email', btrim(p_reason)) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.mare_mgr_punch_void(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if length(btrim(coalesce(p_reason,''))) < 2 then return jsonb_build_object('ok', false, 'error', 'reason'); end if;
  update public.mare_punches set voided = true, void_reason = btrim(p_reason), voided_by = auth.jwt()->>'email', voided_at = now()
   where id = p_id and not voided;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mare_mgr_note_add(p_staff uuid, p_kind text, p_date date, p_text text, p_punch uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  insert into public.mare_notes(staff_id, kind, ref_date, text, punch_id, by)
  values (p_staff, p_kind, p_date, coalesce(btrim(p_text),''), p_punch, auth.jwt()->>'email') returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.mare_mgr_device_new(p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; code text := ''; i int; b bytea;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  b := extensions.gen_random_bytes(8);
  for i in 0..7 loop code := code || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1); end loop;
  insert into public.mare_devices(name, code_hash, created_by)
  values (coalesce(nullif(btrim(p_name),''), 'Tablet'), encode(extensions.digest(code,'sha256'),'hex'), auth.jwt()->>'email');
  return jsonb_build_object('ok', true, 'code', code);   -- shown once; only its hash is kept
end $$;

create or replace function public.mare_mgr_device_off(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  update public.mare_devices set active = false where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mare_mgr_phone_link_new(p_staff uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(16),'hex');
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  update public.mare_staff set phone_token = t where id = p_staff;
  return jsonb_build_object('ok', true, 'token', t);
end $$;

-- ── grants: nothing by default; only what each caller needs ─────────────
do $$ declare f text; begin
  foreach f in array array[
    'mare_is_mgr()','mare_device_id(text)','mare_open_in(uuid,timestamptz)','mare_pin_ok(uuid,text,boolean)',
    'mare_kiosk_board(text)','mare_kiosk_set_pin(text,uuid,text)',
    'mare_kiosk_punch(text,uuid,text,text,text,timestamptz)','mare_me(text,text)',
    'mare_mgr_overview(date,date)','mare_mgr_photos(uuid[])','mare_mgr_staff_save(jsonb)','mare_mgr_reset_pin(uuid)',
    'mare_mgr_punch_add(uuid,text,timestamptz,text)','mare_mgr_punch_void(uuid,text)',
    'mare_mgr_note_add(uuid,text,date,text,uuid)','mare_mgr_device_new(text)','mare_mgr_device_off(uuid)',
    'mare_mgr_phone_link_new(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;
grant execute on function public.mare_kiosk_board(text) to anon, authenticated;
grant execute on function public.mare_kiosk_set_pin(text,uuid,text) to anon, authenticated;
grant execute on function public.mare_kiosk_punch(text,uuid,text,text,text,timestamptz) to anon, authenticated;
grant execute on function public.mare_me(text,text) to anon, authenticated;
grant execute on function public.mare_mgr_overview(date,date) to authenticated;
grant execute on function public.mare_mgr_photos(uuid[]) to authenticated;
grant execute on function public.mare_mgr_staff_save(jsonb) to authenticated;
grant execute on function public.mare_mgr_reset_pin(uuid) to authenticated;
grant execute on function public.mare_mgr_punch_add(uuid,text,timestamptz,text) to authenticated;
grant execute on function public.mare_mgr_punch_void(uuid,text) to authenticated;
grant execute on function public.mare_mgr_note_add(uuid,text,date,text,uuid) to authenticated;
grant execute on function public.mare_mgr_device_new(text) to authenticated;
grant execute on function public.mare_mgr_device_off(uuid) to authenticated;
grant execute on function public.mare_mgr_phone_link_new(uuid) to authenticated;
