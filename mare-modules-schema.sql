-- ══════════════════════════════════════════════════════════════════════
-- Roberto's Mare — the rest of the app (6 Oct 2026), on top of
-- mare-attendance-schema.sql. Additive, mare_-prefixed, all tables locked.
--   Staff (tablet code, or phone link + code) → mare_s_* functions
--   Managers (FOH login with 'mare')          → mare_m_* functions
-- ══════════════════════════════════════════════════════════════════════

alter table public.mare_staff add column if not exists annual_days int not null default 21;
alter table public.mare_staff add column if not exists role text;

create table if not exists public.mare_shifts (
  staff_id uuid not null references public.mare_staff(id),
  date date not null,
  kind text not null default 'work' check (kind in ('work','off','leave','sick')),
  start_t text check (start_t is null or start_t ~ '^\d{2}:\d{2}$'),
  end_t   text check (end_t is null or end_t ~ '^\d{2}:\d{2}$'),
  note text,
  updated_by text, updated_at timestamptz default now(),
  primary key (staff_id, date)
);

create table if not exists public.mare_briefings (
  date date primary key,
  covers_lunch int, covers_dinner int,
  specials text, eighty_six text, allergies text, vip text,
  kitchen_note text, foh_note text, message text,
  updated_by text, updated_at timestamptz default now()
);
create table if not exists public.mare_briefing_reads (
  date date not null, staff_id uuid not null references public.mare_staff(id),
  at timestamptz not null default now(), primary key (date, staff_id)
);

create table if not exists public.mare_closing (
  date date primary key,
  covers_lunch int, covers_dinner int,
  food numeric(12,2), beverage numeric(12,2), other numeric(12,2),
  card numeric(12,2), cash numeric(12,2), tips numeric(12,2),
  comps numeric(12,2), discounts numeric(12,2),
  weather text, notes text, incidents text,
  updated_by text, updated_at timestamptz default now()
);

create table if not exists public.mare_check_items (
  id uuid primary key default gen_random_uuid(),
  list text not null check (list in ('open_foh','close_foh','open_kitchen','close_kitchen')),
  text text not null, text_me text,
  sort int not null default 0, needs_photo boolean not null default false, active boolean not null default true,
  updated_by text, updated_at timestamptz default now()
);
create table if not exists public.mare_check_ticks (
  id uuid primary key default gen_random_uuid(),
  date date not null, item_id uuid not null references public.mare_check_items(id),
  staff_id uuid references public.mare_staff(id),
  at timestamptz not null default now(), photo text,
  unique (date, item_id)
);

create table if not exists public.mare_recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null, category text, portions text,
  ingredients text, method text, plating text, allergens text, photo text,
  active boolean not null default true,
  updated_by text, updated_at timestamptz default now()
);

create table if not exists public.mare_purchases (
  id uuid primary key default gen_random_uuid(),
  date date not null, supplier text not null,
  category text not null default 'food' check (category in ('food','beverage','other')),
  amount numeric(12,2) not null, invoice_no text, note text,
  voided boolean not null default false, void_reason text,
  updated_by text, updated_at timestamptz default now()
);

create table if not exists public.mare_inv_items (
  id uuid primary key default gen_random_uuid(),
  name text not null, category text not null default 'food' check (category in ('food','beverage','other')),
  unit text, unit_cost numeric(12,4), sort int not null default 0, active boolean not null default true,
  updated_by text, updated_at timestamptz default now()
);
create table if not exists public.mare_inv_counts (
  month date not null, item_id uuid not null references public.mare_inv_items(id),
  qty numeric(12,3), unit_cost numeric(12,4),
  updated_by text, updated_at timestamptz default now(),
  primary key (month, item_id)
);

create table if not exists public.mare_breakage (
  id uuid primary key default gen_random_uuid(),
  date date not null, at timestamptz not null default now(),
  kind text not null default 'breakage' check (kind in ('breakage','wastage')),
  item text not null, qty numeric(10,2) not null default 1, reason text, cost numeric(12,2), photo text,
  staff_id uuid references public.mare_staff(id), reported_by text,
  reviewed boolean not null default false, review_note text,
  updated_by text, updated_at timestamptz default now()
);

create table if not exists public.mare_leave (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.mare_staff(id),
  date_from date not null, date_to date not null check (date_to >= date_from),
  kind text not null default 'annual' check (kind in ('annual','unpaid','sick','other')),
  note text, status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  decided_by text, decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now(), created_via text,
  updated_by text, updated_at timestamptz default now()
);

create table if not exists public.mare_speakup (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null default 'other' check (kind in ('idea','problem','respect','other')),
  text text not null, name text,
  status text not null default 'new' check (status in ('new','seen','done')),
  note text, updated_by text, updated_at timestamptz default now()
);

create table if not exists public.mare_meetings (
  id uuid primary key default gen_random_uuid(),
  date date not null, title text not null default 'Weekly meeting',
  attendees text, notes text,
  updated_by text, updated_at timestamptz default now()
);
create table if not exists public.mare_actions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.mare_meetings(id),
  text text not null, owner text, due date,
  done boolean not null default false, done_at timestamptz,
  updated_by text, updated_at timestamptz default now()
);

create table if not exists public.mare_settings (
  key text primary key, value jsonb,
  updated_by text, updated_at timestamptz default now()
);

do $$ declare t text; begin
  foreach t in array array['mare_shifts','mare_briefings','mare_briefing_reads','mare_closing','mare_check_items','mare_check_ticks',
    'mare_recipes','mare_purchases','mare_inv_items','mare_inv_counts','mare_breakage','mare_leave','mare_speakup',
    'mare_meetings','mare_actions','mare_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Montenegro "today"
create or replace function public.mare_today() returns date language sql stable as $$
  select (now() at time zone 'Europe/Podgorica')::date $$;

-- ── staff identity: tablet code (+ name + PIN), or phone link + PIN ─────
create or replace function public.mare_s_auth(p_device text, p_token text, p_staff uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; chk text; dev uuid;
begin
  if nullif(p_token,'') is not null then
    select id into v from public.mare_staff where phone_token = p_token and active;
    if v is null then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    chk := public.mare_pin_ok(v, p_pin, false);
    if chk <> 'ok' then return jsonb_build_object('ok', false, 'error', chk); end if;
    return jsonb_build_object('ok', true, 'id', v, 'via', 'phone');
  end if;
  dev := public.mare_device_id(p_device);
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;
  if p_staff is null then return jsonb_build_object('ok', true, 'id', null, 'via', 'tablet'); end if;
  if not exists (select 1 from public.mare_staff where id = p_staff and active) then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  chk := public.mare_pin_ok(p_staff, p_pin, false);
  if chk <> 'ok' then return jsonb_build_object('ok', false, 'error', chk); end if;
  return jsonb_build_object('ok', true, 'id', p_staff, 'via', 'tablet');
end $$;

-- Everything a staff screen shows. Tablet: code only. Phone: link + PIN (adds "me").
create or replace function public.mare_s_feed(p_device text, p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; me uuid; d date := public.mare_today(); ws date; r jsonb;
begin
  a := public.mare_s_auth(p_device, p_token, null, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid;
  ws := d - (extract(isodow from d)::int - 1);
  r := jsonb_build_object('ok', true, 'today', d, 'now', now(), 'week_start', ws,
    'briefing', (select to_jsonb(b) from public.mare_briefings b where b.date = d),
    'reads', coalesce((select jsonb_agg(staff_id) from public.mare_briefing_reads where date = d), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'team', s.team) order by s.team, s.sort, s.name)
                        from public.mare_staff s where s.active), '[]'::jsonb),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('staff_id', h.staff_id, 'date', h.date, 'kind', h.kind, 'start_t', h.start_t, 'end_t', h.end_t, 'note', h.note))
                        from public.mare_shifts h join public.mare_staff s on s.id = h.staff_id and s.active
                        where h.date between ws and ws + 13), '[]'::jsonb),
    'check_items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'list', i.list, 'text', i.text, 'text_me', i.text_me, 'needs_photo', i.needs_photo) order by i.list, i.sort, i.text)
                        from public.mare_check_items i where i.active), '[]'::jsonb),
    'deadlines', (select value from public.mare_settings where key = 'check_deadlines'),
    'ticks', coalesce((select jsonb_agg(jsonb_build_object('item_id', t.item_id, 'at', t.at, 'name', s.name, 'has_photo', t.photo is not null))
                        from public.mare_check_ticks t left join public.mare_staff s on s.id = t.staff_id where t.date = d), '[]'::jsonb),
    'recipes', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'category', x.category) order by x.category, x.name)
                        from public.mare_recipes x where x.active), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('text', c.text, 'owner', c.owner, 'due', c.due) order by c.due nulls last)
                        from public.mare_actions c where not c.done), '[]'::jsonb));
  if me is not null then
    r := r || jsonb_build_object('me', jsonb_build_object(
      'id', me, 'name', (select name from public.mare_staff where id = me),
      'annual_days', (select annual_days from public.mare_staff where id = me),
      'punches', coalesce((select jsonb_agg(jsonb_build_object('dir', p.dir, 'at', p.at, 'source', p.source) order by p.at)
                  from public.mare_punches p where p.staff_id = me and not p.voided and p.at > now() - interval '16 days'), '[]'::jsonb),
      'leave', coalesce((select jsonb_agg(to_jsonb(l) order by l.date_from desc) from public.mare_leave l
                  where l.staff_id = me and l.date_to >= date_trunc('year', d)::date), '[]'::jsonb)));
  end if;
  return r;
end $$;

create or replace function public.mare_s_recipe(p_device text, p_token text, p_pin text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  a := public.mare_s_auth(p_device, p_token, null, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  return jsonb_build_object('ok', true, 'recipe', (select to_jsonb(x) from public.mare_recipes x where x.id = p_id and x.active));
end $$;

create or replace function public.mare_s_brief_read(p_device text, p_token text, p_staff uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; v uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  v := (a->>'id')::uuid; if v is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  insert into public.mare_briefing_reads(date, staff_id) values (public.mare_today(), v) on conflict do nothing;
  return jsonb_build_object('ok', true, 'name', (select name from public.mare_staff where id = v));
end $$;

create or replace function public.mare_s_tick(p_device text, p_token text, p_staff uuid, p_pin text, p_item uuid, p_photo text, p_undo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; v uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  v := (a->>'id')::uuid; if v is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  if p_undo then
    delete from public.mare_check_ticks where date = public.mare_today() and item_id = p_item;
  else
    insert into public.mare_check_ticks(date, item_id, staff_id, photo)
    values (public.mare_today(), p_item, v,
            case when p_photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(p_photo) < 400000 then p_photo end)
    on conflict (date, item_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'name', (select name from public.mare_staff where id = v));
end $$;

create or replace function public.mare_s_breakage(p_device text, p_token text, p_staff uuid, p_pin text,
   p_kind text, p_item text, p_qty numeric, p_reason text, p_photo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; v uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  v := (a->>'id')::uuid; if v is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  if length(btrim(coalesce(p_item,''))) < 2 then return jsonb_build_object('ok', false, 'error', 'item'); end if;
  insert into public.mare_breakage(date, kind, item, qty, reason, photo, staff_id, reported_by)
  values (public.mare_today(), case when p_kind = 'wastage' then 'wastage' else 'breakage' end, btrim(p_item),
          greatest(coalesce(p_qty,1),0.01), nullif(btrim(coalesce(p_reason,'')),''),
          case when p_photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(p_photo) < 400000 then p_photo end,
          v, (select name from public.mare_staff where id = v));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mare_s_leave(p_device text, p_token text, p_staff uuid, p_pin text,
   p_from date, p_to date, p_kind text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; v uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  v := (a->>'id')::uuid; if v is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  if p_from is null or p_to is null or p_to < p_from then return jsonb_build_object('ok', false, 'error', 'dates'); end if;
  if p_to - p_from > 120 then return jsonb_build_object('ok', false, 'error', 'dates'); end if;
  insert into public.mare_leave(staff_id, date_from, date_to, kind, note, created_via)
  values (v, p_from, p_to, case when p_kind in ('annual','unpaid','sick','other') then p_kind else 'other' end,
          nullif(btrim(coalesce(p_note,'')),''), a->>'via');
  return jsonb_build_object('ok', true);
end $$;

-- Anonymous: no name, no PIN. Needs the tablet code or a valid phone link only, so
-- it can't be spammed from the internet. The phone link is NOT stored.
create or replace function public.mare_s_speak(p_device text, p_token text, p_kind text, p_text text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.mare_device_id(p_device) is null and not exists (select 1 from public.mare_staff where phone_token = coalesce(p_token,'-') and active) then
    return jsonb_build_object('ok', false, 'error', 'device');
  end if;
  if length(btrim(coalesce(p_text,''))) < 3 then return jsonb_build_object('ok', false, 'error', 'text'); end if;
  if (select count(*) from public.mare_speakup where at > now() - interval '1 day') >= 40 then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  insert into public.mare_speakup(kind, text, name)
  values (case when p_kind in ('idea','problem','respect','other') then p_kind else 'other' end, left(btrim(p_text), 4000), nullif(btrim(coalesce(p_name,'')),''));
  return jsonb_build_object('ok', true);
end $$;

-- ── managers ────────────────────────────────────────────────────────────
create or replace function public.mare_m_fetch(p_tables text[], p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; q text; v jsonb; r jsonb := '{}'::jsonb;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  foreach t in array p_tables loop
    q := case t
      when 'shifts'      then 'select * from mare_shifts where date between $1 and $2'
      when 'briefings'   then 'select * from mare_briefings where date between $1 and $2'
      when 'reads'       then 'select * from mare_briefing_reads where date between $1 and $2'
      when 'closing'     then 'select * from mare_closing where date between $1 and $2'
      when 'check_items' then 'select * from mare_check_items order by list, sort, text'
      when 'ticks'       then 'select id, date, item_id, staff_id, at, photo is not null as has_photo from mare_check_ticks where date between $1 and $2'
      when 'recipes'     then 'select id, name, category, portions, ingredients, method, plating, allergens, active, updated_by, updated_at, photo is not null as has_photo from mare_recipes order by category, name'
      when 'purchases'   then 'select * from mare_purchases where date between $1 and $2 order by date, updated_at'
      when 'inv_items'   then 'select * from mare_inv_items order by category, sort, name'
      when 'inv_counts'  then 'select * from mare_inv_counts where month between date_trunc(''month'',$1)::date - interval ''1 month'' and $2'
      when 'breakage'    then 'select id, date, at, kind, item, qty, reason, cost, staff_id, reported_by, reviewed, review_note, photo is not null as has_photo from mare_breakage where date between $1 and $2 order by at desc'
      when 'leave'       then 'select * from mare_leave where (date_to >= $1 and date_from <= $2) or status = ''pending'' or date_to >= date_trunc(''year'', $2)::date order by date_from'
      when 'speakup'     then 'select * from mare_speakup where at > now() - interval ''400 days'' order by at desc'
      when 'meetings'    then 'select * from mare_meetings order by date desc limit 60'
      when 'actions'     then 'select * from mare_actions where not done or done_at > now() - interval ''90 days'' order by done, due nulls last'
      when 'settings'    then 'select * from mare_settings'
      when 'staff'       then 'select id, name, team, active, role, annual_days, contract_hours, start_times, sort from mare_staff order by team, sort, name'
      else null end;
    if q is null then continue; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (%s) x', q) into v using p_from, p_to;
    r := r || jsonb_build_object(t, v);
  end loop;
  return jsonb_build_object('ok', true, 'now', now(), 'today', public.mare_today()) || r;
end $$;

-- One save for every manager form: upsert by primary key, only the columns sent.
create or replace function public.mare_m_save(p_table text, p_row jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pk text[]; cols text[]; who text := auth.jwt()->>'email'; row jsonb := p_row; sets text; ret jsonb; match text; have_pk boolean; found_row boolean;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  pk := case p_table
    when 'mare_shifts' then array['staff_id','date'] when 'mare_briefings' then array['date'] when 'mare_closing' then array['date']
    when 'mare_check_items' then array['id'] when 'mare_recipes' then array['id'] when 'mare_purchases' then array['id']
    when 'mare_inv_items' then array['id'] when 'mare_inv_counts' then array['month','item_id'] when 'mare_breakage' then array['id']
    when 'mare_leave' then array['id'] when 'mare_speakup' then array['id'] when 'mare_meetings' then array['id']
    when 'mare_actions' then array['id'] when 'mare_settings' then array['key'] else null end;
  if pk is null then return jsonb_build_object('ok', false, 'error', 'table'); end if;
  if pk = array['id'] and nullif(row->>'id','') is null then row := row || jsonb_build_object('id', gen_random_uuid()); end if;
  if p_table in ('mare_recipes','mare_breakage') and row ? 'photo' and row->>'photo' is not null
     and not (row->>'photo' ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(row->>'photo') < 600000) then
    return jsonb_build_object('ok', false, 'error', 'photo');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name='updated_by') then
    row := row || jsonb_build_object('updated_by', who, 'updated_at', now());
  end if;
  select array_agg(c.column_name::text) into cols from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table and row ? c.column_name;
  -- Existing row → UPDATE only the columns sent (an upsert would check NOT NULL
  -- columns of the would-be insert first, so a one-field edit failed). New → INSERT.
  match := (select string_agg(format('t.%I = r.%I', c, c), ' and ') from unnest(pk) c);
  have_pk := (select bool_and(row ? c and row->>c is not null) from unnest(pk) c);
  found_row := false;
  if have_pk then
    execute format('select exists (select 1 from public.%I t, jsonb_populate_record(null::public.%I, $1) r where %s)', p_table, p_table, match) into found_row using row;
  end if;
  if found_row then
    select string_agg(format('%I = r.%I', c, c), ', ') into sets from unnest(cols) c where not (c = any(pk));
    if sets is null then
      execute format('select to_jsonb(t.*) from public.%I t, jsonb_populate_record(null::public.%I, $1) r where %s', p_table, p_table, match) into ret using row;
    else
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where %s returning to_jsonb(t.*)', p_table, sets, p_table, match) into ret using row;
    end if;
  else
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(%I.*)',
       p_table, (select string_agg(format('%I', c), ',') from unnest(cols) c), (select string_agg(format('%I', c), ',') from unnest(cols) c), p_table, p_table)
    into ret using row;
  end if;
  if ret ? 'photo' then ret := ret - 'photo'; end if;
  return jsonb_build_object('ok', true, 'row', ret);
end $$;

create or replace function public.mare_m_shift_clear(p_staff uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  delete from public.mare_shifts where staff_id = p_staff and date = p_date;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mare_m_rota_copy(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  insert into public.mare_shifts(staff_id, date, kind, start_t, end_t, note, updated_by)
  select h.staff_id, h.date + (p_to - p_from), h.kind, h.start_t, h.end_t, h.note, auth.jwt()->>'email'
    from public.mare_shifts h join public.mare_staff s on s.id = h.staff_id and s.active
   where h.date between p_from and p_from + 6 and h.kind in ('work','off')
  on conflict (staff_id, date) do nothing;      -- never overwrite what is already planned (or leave)
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'copied', n);
end $$;

-- Approve or decline a leave request. Approving writes the days into the rota as LEAVE.
create or replace function public.mare_m_leave_decide(p_id uuid, p_status text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.mare_leave; d date;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_status not in ('approved','declined','cancelled') then return jsonb_build_object('ok', false, 'error', 'status'); end if;
  update public.mare_leave set status = p_status, decided_by = auth.jwt()->>'email', decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note,'')),''), updated_by = auth.jwt()->>'email', updated_at = now()
   where id = p_id returning * into l;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
  if p_status = 'approved' then
    for d in select generate_series(l.date_from, l.date_to, interval '1 day')::date loop
      insert into public.mare_shifts(staff_id, date, kind, note, updated_by)
      values (l.staff_id, d, case when l.kind = 'sick' then 'sick' else 'leave' end, l.kind, auth.jwt()->>'email')
      on conflict (staff_id, date) do update set kind = excluded.kind, start_t = null, end_t = null, note = excluded.note,
             updated_by = excluded.updated_by, updated_at = now();
    end loop;
  elsif p_status = 'cancelled' then
    delete from public.mare_shifts where staff_id = l.staff_id and date between l.date_from and l.date_to and kind in ('leave','sick');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mare_m_photo(p_table text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_table = 'mare_breakage' then select photo into v from public.mare_breakage where id = p_id;
  elsif p_table = 'mare_check_ticks' then select photo into v from public.mare_check_ticks where id = p_id;
  elsif p_table = 'mare_recipes' then select photo into v from public.mare_recipes where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'photo', v);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array['mare_today()','mare_s_auth(text,text,uuid,text)','mare_s_feed(text,text,text)','mare_s_recipe(text,text,text,uuid)',
    'mare_s_brief_read(text,text,uuid,text)','mare_s_tick(text,text,uuid,text,uuid,text,boolean)',
    'mare_s_breakage(text,text,uuid,text,text,text,numeric,text,text)','mare_s_leave(text,text,uuid,text,date,date,text,text)',
    'mare_s_speak(text,text,text,text,text)','mare_m_fetch(text[],date,date)','mare_m_save(text,jsonb)',
    'mare_m_shift_clear(uuid,date)','mare_m_rota_copy(date,date)','mare_m_leave_decide(uuid,text,text)','mare_m_photo(text,uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;
grant execute on function public.mare_s_feed(text,text,text) to anon, authenticated;
grant execute on function public.mare_s_recipe(text,text,text,uuid) to anon, authenticated;
grant execute on function public.mare_s_brief_read(text,text,uuid,text) to anon, authenticated;
grant execute on function public.mare_s_tick(text,text,uuid,text,uuid,text,boolean) to anon, authenticated;
grant execute on function public.mare_s_breakage(text,text,uuid,text,text,text,numeric,text,text) to anon, authenticated;
grant execute on function public.mare_s_leave(text,text,uuid,text,date,date,text,text) to anon, authenticated;
grant execute on function public.mare_s_speak(text,text,text,text,text) to anon, authenticated;
grant execute on function public.mare_m_fetch(text[],date,date) to authenticated;
grant execute on function public.mare_m_save(text,jsonb) to authenticated;
grant execute on function public.mare_m_shift_clear(uuid,date) to authenticated;
grant execute on function public.mare_m_rota_copy(date,date) to authenticated;
grant execute on function public.mare_m_leave_decide(uuid,text,text) to authenticated;
grant execute on function public.mare_m_photo(text,uuid) to authenticated;

-- Starter checklists (English + Montenegrin). Milica edits them on her page.
insert into public.mare_check_items(list, text, text_me, sort, needs_photo)
select * from (values
  ('open_foh','Terrace and room set: tables, chairs, cushions, umbrellas','Terasa i sala postavljene: stolovi, stolice, jastuci, suncobrani',1,true),
  ('open_foh','Tables clean and laid, cutlery and glasses polished','Stolovi čisti i postavljeni, pribor i čaše uglačani',2,false),
  ('open_foh','Toilets clean and stocked','Toaleti čisti i snabdjeveni',3,false),
  ('open_foh','Music and lights on, POS and card machine working','Muzika i svjetla uključeni, kasa i POS terminal rade',4,false),
  ('open_foh','Briefing read by everyone on shift','Brifing pročitali svi u smjeni',5,false),
  ('close_foh','Terrace cleared, cushions stored, umbrellas closed','Terasa raščišćena, jastuci spremljeni, suncobrani zatvoreni',1,true),
  ('close_foh','Bar clean, fridges closed, stock for tomorrow noted','Šank čist, frižideri zatvoreni, zalihe za sjutra zapisane',2,false),
  ('close_foh','Cash counted and closing report done','Kasa prebrojana i završni izvještaj urađen',3,false),
  ('open_kitchen','Fridge and freezer temperatures checked','Temperature frižidera i zamrzivača provjerene',1,false),
  ('open_kitchen','Mise en place ready for service','Mise en place spreman za servis',2,true),
  ('open_kitchen','Deliveries checked against the invoice','Isporuke provjerene prema fakturi',3,false),
  ('close_kitchen','Everything labelled, dated and covered','Sve označeno, datirano i pokriveno',1,false),
  ('close_kitchen','Kitchen, floors and drains clean','Kuhinja, podovi i odvodi čisti',2,true),
  ('close_kitchen','Gas and equipment off','Gas i oprema isključeni',3,false)
) v(list, text, text_me, sort, needs_photo)
where not exists (select 1 from public.mare_check_items);

insert into public.mare_settings(key, value) values
  ('check_deadlines', '{"open_foh":"11:45","open_kitchen":"11:30","close_foh":null,"close_kitchen":null}'::jsonb),
  ('cost_targets', '{"food":null,"beverage":null}'::jsonb),
  ('kitchen_min', '3'::jsonb)
on conflict (key) do nothing;

-- People screen: role and annual-leave days (kept apart from mare_mgr_staff_save, which the clock-in build shipped).
create or replace function public.mare_m_staff_extra(p_staff uuid, p_role text, p_annual int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  update public.mare_staff set role = nullif(btrim(coalesce(p_role,'')),''), annual_days = greatest(0, least(coalesce(p_annual, 21), 60)) where id = p_staff;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.mare_m_staff_extra(uuid,text,int) from public, anon, authenticated;
grant execute on function public.mare_m_staff_extra(uuid,text,int) to authenticated;
