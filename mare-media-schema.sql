-- ══════════════════════════════════════════════════════════════════════
-- Roberto's Mare — voice notes and files on the daily briefing and the
-- weekly meeting (6 Oct 2026). Kept in the database like the clock-in photos,
-- behind the same locked functions. Staff can open only TODAY's briefing media.
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.mare_media (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('briefing','meeting')),
  owner_key text not null,                 -- briefing: 'YYYY-MM-DD'; meeting: its id
  kind text not null check (kind in ('voice','file')),
  name text not null default '', mime text not null, size int not null default 0, seconds int,
  data text not null,                      -- data:<mime>;base64,…
  removed boolean not null default false,
  created_by text, created_at timestamptz not null default now()
);
create index if not exists mare_media_owner on public.mare_media(owner_kind, owner_key);
alter table public.mare_media enable row level security;
revoke all on public.mare_media from anon, authenticated;

create or replace function public.mare_m_media_add(p_owner_kind text, p_owner_key text, p_kind text, p_name text, p_mime text, p_data text, p_seconds int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_owner_kind not in ('briefing','meeting') or p_kind not in ('voice','file') then return jsonb_build_object('ok', false, 'error', 'kind'); end if;
  if p_data !~ '^data:(audio|video|image)/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,[A-Za-z0-9+/=]+$' and p_data !~ '^data:application/pdf;base64,[A-Za-z0-9+/=]+$' then
    return jsonb_build_object('ok', false, 'error', 'type'); end if;
  if length(p_data) > 9000000 then return jsonb_build_object('ok', false, 'error', 'too_big'); end if;
  insert into public.mare_media(owner_kind, owner_key, kind, name, mime, size, seconds, data, created_by)
  values (p_owner_kind, p_owner_key, p_kind, left(coalesce(p_name,''), 120), left(p_mime, 80), (length(p_data) * 3 / 4), p_seconds, p_data, auth.jwt()->>'email')
  returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;

create or replace function public.mare_m_media_list(p_owner_kind text, p_owner_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'name', m.name, 'mime', m.mime, 'size', m.size,
    'seconds', m.seconds, 'created_by', m.created_by, 'created_at', m.created_at) order by m.created_at)
    from public.mare_media m where m.owner_kind = p_owner_kind and m.owner_key = p_owner_key and not m.removed), '[]'::jsonb));
end $$;

create or replace function public.mare_m_media_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'data', (select data from public.mare_media where id = p_id and not removed));
end $$;

create or replace function public.mare_m_media_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  update public.mare_media set removed = true where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Staff (tablet code, or phone link + code): today's briefing media only.
create or replace function public.mare_s_media_get(p_device text, p_token text, p_pin text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  a := public.mare_s_auth(p_device, p_token, null, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  return jsonb_build_object('ok', true, 'data', (select data from public.mare_media
    where id = p_id and not removed and owner_kind = 'briefing' and owner_key = public.mare_today()::text));
end $$;

do $$ declare f text; begin
  foreach f in array array['mare_m_media_add(text,text,text,text,text,text,int)','mare_m_media_list(text,text)','mare_m_media_get(uuid)',
                           'mare_m_media_remove(uuid)','mare_s_media_get(text,text,text,uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;
grant execute on function public.mare_m_media_add(text,text,text,text,text,text,int) to authenticated;
grant execute on function public.mare_m_media_list(text,text) to authenticated;
grant execute on function public.mare_m_media_get(uuid) to authenticated;
grant execute on function public.mare_m_media_remove(uuid) to authenticated;
grant execute on function public.mare_s_media_get(text,text,text,uuid) to anon, authenticated;
