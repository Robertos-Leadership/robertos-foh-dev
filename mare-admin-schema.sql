-- ══════════════════════════════════════════════════════════════════════
-- Roberto's Mare — a Mare admin (12 Oct 2026, Francesco: Milica is the admin
-- of the Mare app; she adds and removes logins herself).
--
-- A Mare admin is an app_users row with BOTH 'mare' and 'mare_admin' in
-- modules (or the FOH Admin). 'mare_admin' is not an FOH module: it opens
-- nothing in the Dubai app. The edge function mare-logins does the writes
-- (it needs the service role to create a sign-in); these functions only read.
--
-- "Mare-only" = a login whose modules are nothing but mare / mare_admin.
-- A Mare admin may make a no-password link ONLY for a Mare-only login: a
-- link signs its holder in to the whole Roberto's account, so a link for a
-- Dubai login would hand over Dubai's modules.
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.mare_is_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.app_users u
    where lower(u.email) = lower(coalesce(auth.jwt()->>'email',''))
      and (u.is_admin or ('mare' = any(u.modules) and 'mare_admin' = any(u.modules)))
  );
$$;
revoke all on function public.mare_is_admin() from public, anon;
grant execute on function public.mare_is_admin() to authenticated;

create or replace function public.mare_m_whoami()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare u public.app_users;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  select * into u from public.app_users where lower(email) = lower(auth.jwt()->>'email');
  return jsonb_build_object('ok', true, 'email', lower(u.email), 'name', coalesce(u.name, u.email),
    'admin', public.mare_is_admin(), 'foh_admin', coalesce(u.is_admin, false),
    'foh', coalesce(u.is_admin, false) or exists (select 1 from unnest(coalesce(u.modules, '{}')) m where m not in ('mare', 'mare_admin')));
end $$;
revoke all on function public.mare_m_whoami() from public, anon;
grant execute on function public.mare_m_whoami() to authenticated;

create or replace function public.mare_m_managers()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'me', lower(auth.jwt()->>'email'), 'admin', public.mare_is_admin(), 'managers', coalesce((
    select jsonb_agg(jsonb_build_object('email', lower(u.email), 'name', coalesce(u.name, u.email), 'title', u.title, 'is_admin', u.is_admin,
        'mare_admin', coalesce(u.is_admin, false) or 'mare_admin' = any(u.modules),
        'mare_only', not coalesce(u.is_admin, false) and not exists (select 1 from unnest(coalesce(u.modules, '{}')) m where m not in ('mare', 'mare_admin')),
        'pw_set', exists (select 1 from auth.users au where lower(au.email) = lower(u.email) and (au.raw_user_meta_data ->> 'mare_pw') = 'true'),
        'has_link', exists (select 1 from public.mare_try_links l where lower(l.email) = lower(u.email) and not l.revoked and l.expires_at > now()),
        'last_used', (select max(l.last_used_at) from public.mare_try_links l where lower(l.email) = lower(u.email)))
      order by u.is_admin, u.name)
      from public.app_users u where 'mare' = any(u.modules) or u.is_admin), '[]'::jsonb));
end $$;
