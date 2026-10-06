-- ══════════════════════════════════════════════════════════════════════
-- Roberto's Mare — minutes of the weekly meeting (6 Oct 2026).
-- A voice note keeps the words the browser heard while it recorded
-- (mare_media.transcript). "Write the minutes" sends the notes, the
-- transcripts and the actions to the mare-minutes function, which writes
-- the minutes in English and Montenegrin and saves them on the meeting.
-- ══════════════════════════════════════════════════════════════════════
alter table public.mare_media add column if not exists transcript text;
alter table public.mare_meetings add column if not exists minutes jsonb;
alter table public.mare_meetings add column if not exists minutes_at timestamptz;
alter table public.mare_meetings add column if not exists minutes_by text;

drop function if exists public.mare_m_media_add(text,text,text,text,text,text,int);
create or replace function public.mare_m_media_add(p_owner_kind text, p_owner_key text, p_kind text, p_name text, p_mime text, p_data text, p_seconds int, p_transcript text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_owner_kind not in ('briefing','meeting') or p_kind not in ('voice','file') then return jsonb_build_object('ok', false, 'error', 'kind'); end if;
  if p_data !~ '^data:(audio|video|image)/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,[A-Za-z0-9+/=]+$' and p_data !~ '^data:application/pdf;base64,[A-Za-z0-9+/=]+$' then
    return jsonb_build_object('ok', false, 'error', 'type'); end if;
  if length(p_data) > 9000000 then return jsonb_build_object('ok', false, 'error', 'too_big'); end if;
  insert into public.mare_media(owner_kind, owner_key, kind, name, mime, size, seconds, data, transcript, created_by)
  values (p_owner_kind, p_owner_key, p_kind, left(coalesce(p_name,''), 120), left(p_mime, 80), (length(p_data) * 3 / 4), p_seconds, p_data,
          nullif(left(trim(coalesce(p_transcript, '')), 200000), ''), auth.jwt()->>'email')
  returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;

create or replace function public.mare_m_media_list(p_owner_kind text, p_owner_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'name', m.name, 'mime', m.mime, 'size', m.size,
    'seconds', m.seconds, 'transcript', m.transcript, 'created_by', m.created_by, 'created_at', m.created_at) order by m.created_at)
    from public.mare_media m where m.owner_kind = p_owner_kind and m.owner_key = p_owner_key and not m.removed), '[]'::jsonb));
end $$;

-- Correct what the browser heard, or type it in for an uploaded recording.
create or replace function public.mare_m_media_transcript(p_id uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  update public.mare_media set transcript = nullif(left(trim(coalesce(p_text, '')), 200000), '') where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- What the minutes are written from.
create or replace function public.mare_m_minutes_source(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if not exists (select 1 from public.mare_meetings where id = p_id) then return jsonb_build_object('ok', false, 'error', 'meeting'); end if;
  return jsonb_build_object('ok', true,
    'meeting', (select jsonb_build_object('date', date, 'title', title, 'attendees', attendees, 'notes', notes) from public.mare_meetings where id = p_id),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('text', text, 'owner', owner, 'due', due, 'done', done) order by updated_at)
                 from public.mare_actions where meeting_id = p_id), '[]'::jsonb),
    'transcripts', coalesce((select jsonb_agg(jsonb_build_object('seconds', seconds, 'text', transcript) order by created_at)
                 from public.mare_media where owner_kind = 'meeting' and owner_key = p_id::text and not removed and transcript is not null), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(name order by name) from public.mare_staff where active), '[]'::jsonb));
end $$;

create or replace function public.mare_m_minutes_save(p_id uuid, p_minutes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_minutes is not null and (jsonb_typeof(p_minutes) <> 'object' or not (p_minutes ? 'en') or not (p_minutes ? 'me')) then
    return jsonb_build_object('ok', false, 'error', 'shape'); end if;
  update public.mare_meetings set minutes = p_minutes, minutes_at = now(), minutes_by = auth.jwt()->>'email' where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

do $$ declare f text; begin
  foreach f in array array['mare_m_media_add(text,text,text,text,text,text,int,text)','mare_m_media_list(text,text)','mare_m_media_transcript(uuid,text)',
                           'mare_m_minutes_source(uuid)','mare_m_minutes_save(uuid,jsonb)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
