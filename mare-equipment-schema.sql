-- Roberto's Mare — Crockery & equipment (6 Nov 2026). Additive only.
-- Zeljko's inventory list (NEW LISTA INVENTORY ZELJKO 2026, Big kitchen + Small kitchen) as data,
-- photographs included, so the team knows what Mare has. The count is done in the app against it.
-- Same rules as every mare_* table: RLS on, no grants; managers go through mare_m_* (mare_is_mgr).
-- Nothing is deleted: a piece is retired (active = false).

create table if not exists public.mare_equip_items (
  id uuid primary key default gen_random_uuid(),
  sheet text not null check (sheet in ('big','small')),   -- Velika kuhinja / Mala kuhinja
  grp text,                                               -- Big equipment, Plates & bowls, ...
  name text not null,                                     -- as written in the list
  unit text default 'KOM',
  sort int not null default 0,
  q2019 numeric, q2024 numeric, q2025 numeric, q2026 numeric,   -- the yearly lists; empty is not zero
  broken2026 numeric,
  rec2027 numeric,                                        -- Zeljko's recommendation for 2027
  note text,
  src_key text unique,                                    -- seed key, e.g. big-023; the photo files are mare-equip/t/<key>.jpg and mare-equip/p/<key>.jpg
  has_photo boolean not null default false,
  active boolean not null default true,
  updated_by text, updated_at timestamptz default now()
);
create table if not exists public.mare_equip_counts (
  item_id uuid not null references public.mare_equip_items(id),
  month date not null,                                    -- first day of the month counted
  counted numeric,
  broken numeric,
  counted_by text, counted_at timestamptz default now(),
  primary key (item_id, month)
);
alter table public.mare_equip_items enable row level security;
alter table public.mare_equip_counts enable row level security;
revoke all on public.mare_equip_items, public.mare_equip_counts from anon, authenticated;

-- List, the counts of one month, and the months that have a count.
create or replace function public.mare_m_equip_data(p_month date) returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true,
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sheet, i.sort) from public.mare_equip_items i), '[]'::jsonb),
    'counts', coalesce((select jsonb_agg(jsonb_build_object('item_id', c.item_id, 'counted', c.counted, 'broken', c.broken, 'by', c.counted_by, 'at', c.counted_at))
                        from public.mare_equip_counts c where c.month = p_month), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(m order by m desc) from (select distinct month as m from public.mare_equip_counts) x), '[]'::jsonb));
end $$;

-- Count ONE field at a time (counted or broken), so two people on the same line never overwrite each other.
create or replace function public.mare_m_equip_count(p_item uuid, p_month date, p_field text, p_val numeric, p_by text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_field not in ('counted','broken') then return jsonb_build_object('ok', false, 'error', 'field'); end if;
  if p_val is not null and p_val < 0 then return jsonb_build_object('ok', false, 'error', 'negative'); end if;
  insert into public.mare_equip_counts as c (item_id, month, counted, broken, counted_by, counted_at)
  values (p_item, date_trunc('month', p_month)::date,
          case when p_field = 'counted' then p_val end, case when p_field = 'broken' then p_val end, p_by, now())
  on conflict (item_id, month) do update set
    counted = case when p_field = 'counted' then p_val else c.counted end,
    broken  = case when p_field = 'broken'  then p_val else c.broken end,
    counted_by = p_by, counted_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Edit or add a piece (never delete: active=false retires it).
create or replace function public.mare_m_equip_save(p_row jsonb, p_by text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r public.mare_equip_items; v_id uuid;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  v_id := nullif(p_row->>'id', '')::uuid;
  if v_id is null then
    if coalesce(trim(p_row->>'name'), '') = '' then return jsonb_build_object('ok', false, 'error', 'name'); end if;
    insert into public.mare_equip_items (sheet, grp, name, unit, sort, rec2027, note, updated_by)
    values (coalesce(p_row->>'sheet', 'big'), nullif(p_row->>'grp', ''), trim(p_row->>'name'), coalesce(nullif(p_row->>'unit', ''), 'KOM'),
            coalesce((select max(sort) + 1 from public.mare_equip_items), 1), nullif(p_row->>'rec2027', '')::numeric, nullif(p_row->>'note', ''), p_by)
    returning * into r;
  else
    update public.mare_equip_items set
      name = case when p_row ? 'name' and coalesce(trim(p_row->>'name'), '') <> '' then trim(p_row->>'name') else name end,
      grp = case when p_row ? 'grp' then nullif(p_row->>'grp', '') else grp end,
      rec2027 = case when p_row ? 'rec2027' then nullif(p_row->>'rec2027', '')::numeric else rec2027 end,
      note = case when p_row ? 'note' then nullif(p_row->>'note', '') else note end,
      active = case when p_row ? 'active' then (p_row->>'active')::boolean else active end,
      updated_by = p_by, updated_at = now()
    where id = v_id returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'row', to_jsonb(r));
end $$;

revoke all on function public.mare_m_equip_data(date), public.mare_m_equip_count(uuid, date, text, numeric, text), public.mare_m_equip_save(jsonb, text) from public;
grant execute on function public.mare_m_equip_data(date), public.mare_m_equip_count(uuid, date, text, numeric, text), public.mare_m_equip_save(jsonb, text) to anon, authenticated;
