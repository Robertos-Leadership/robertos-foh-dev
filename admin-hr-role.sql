-- HR role for the FOH app (14 Sep 2026). HR manages people and logins; only an admin grants Admin or HR.
alter table public.app_users add column if not exists is_hr boolean not null default false;

create or replace function public.fn_is_app_hr()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from app_users where lower(email) = lower(auth.jwt()->>'email') and is_hr = true);
$$;
revoke execute on function public.fn_is_app_hr() from public;
revoke execute on function public.fn_is_app_hr() from anon;
grant execute on function public.fn_is_app_hr() to authenticated, service_role;

drop policy if exists "app_users read own or admin" on public.app_users;
drop policy if exists "app_users write admin only"  on public.app_users;
drop policy if exists "app_users update admin only" on public.app_users;

create policy "app_users read own or admin or hr" on public.app_users for select
  using (lower(email) = lower(auth.jwt()->>'email') or fn_is_app_admin() or fn_is_app_hr());

-- HR can add and change ordinary people only: never an Admin or HR row, and never create one.
create policy "app_users insert admin or hr" on public.app_users for insert
  with check (fn_is_app_admin() or (fn_is_app_hr() and is_admin = false and is_hr = false));

create policy "app_users update admin or hr" on public.app_users for update
  using (fn_is_app_admin() or (fn_is_app_hr() and is_admin = false and is_hr = false))
  with check (fn_is_app_admin() or (fn_is_app_hr() and is_admin = false and is_hr = false));

-- Signs a removed login out everywhere. Called only by the manage-login edge function (service role).
create or replace function public.fn_revoke_login_sessions(p_uid uuid)
returns void language plpgsql security definer set search_path to 'auth', 'public' as $$
begin
  delete from auth.sessions where user_id = p_uid;
  delete from auth.refresh_tokens where user_id = p_uid::text;
end;
$$;
revoke execute on function public.fn_revoke_login_sessions(uuid) from public;
revoke execute on function public.fn_revoke_login_sessions(uuid) from anon;
revoke execute on function public.fn_revoke_login_sessions(uuid) from authenticated;
grant execute on function public.fn_revoke_login_sessions(uuid) to service_role;

update public.app_users
   set is_hr = true, is_admin = false,
       modules = array['events','privateevents','operations','revenue','stocktake','reviews','reservations'],
       title = coalesce(nullif(title,''), 'HR Coordinator'),
       updated_at = now()
 where lower(email) = 'lmadlag@robertos.ae';

notify pgrst, 'reload schema';
