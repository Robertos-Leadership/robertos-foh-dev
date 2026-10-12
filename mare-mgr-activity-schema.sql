-- Roberto's Mare: which screens a MANAGER opens (12 Oct 2026, Francesco: "keep monitoring if she
-- will enter and what module she will use"). The team app already records this for the team
-- (mare_activity); this is the same for the management app: one line per login per screen per
-- 5 minutes, with a short device description. No internet address is kept.
create table if not exists public.mare_mgr_activity (
  id bigserial primary key,
  email text not null,
  at timestamptz not null default now(),
  module text not null,
  device text
);
create index if not exists mare_mgr_activity_email_at on public.mare_mgr_activity(email, at desc);
alter table public.mare_mgr_activity enable row level security;
revoke all on public.mare_mgr_activity from anon, authenticated;
revoke all on sequence public.mare_mgr_activity_id_seq from anon, authenticated;

create or replace function public.mare_m_ping(p_module text, p_ua text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt()->>'email', '')); m text := left(coalesce(nullif(btrim(p_module), ''), 'today'), 40);
begin
  if not public.mare_is_mgr() or me = '' then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if not exists (select 1 from public.mare_mgr_activity where email = me and module = m and at > now() - interval '5 minutes') then
    insert into public.mare_mgr_activity(email, module, device) values (me, m, left(p_ua, 60));
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.mare_m_ping(text, text) from public, anon;
grant execute on function public.mare_m_ping(text, text) to authenticated;
