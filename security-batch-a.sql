-- ════════════════════════════════════════════════════════════════════════
-- SECURITY BATCH A — FOH database locks (items #2, #4 of the ranked list)
-- Project: paoaivwtkzujmrgrfjuq. DB is shared dev+live → changes are LIVE
-- IMMEDIATELY. Rollback file: security-batch-a-rollback.sql (keep it open).
--
-- What this does (verified against the code 14 Jul 2026):
--   rev_daily        read = revenue-module users or admin; write stays open to
--                    any logged-in user (the nightly closing report save by a
--                    duty manager without the revenue module upserts + the
--                    super-gated delete removes its rollup here).
--   rev_rates        revenue-module users or admin only (used only in Revenue).
--   rev_targets      same.
--   closing_reports  any logged-in user (floor managers file it) — closes anon.
--   finance          Activations-module users or admin — was NO LOGIN AT ALL.
--
-- Deliberately NOT here: foh_staff / foh_roster — the floor schedule still
-- runs on the PUBLIC (no-login) layer and both reads AND writes those tables
-- from it (fohSchedSaveShift, fohSchedSaveNewStaff, …). Locking them breaks
-- the schedule; needs Francesco's call (put schedule behind login vs document
-- as the open-by-design operational surface). See runbook.
--
-- Depends on fn_is_app_admin() from the #1 fix (already applied 14 Jul).
-- ════════════════════════════════════════════════════════════════════════

-- Helper: does the logged-in user have this module? (admins always yes)
-- security definer so reading app_users here never recurses through its RLS.
create or replace function public.fn_has_module(m text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select (u.is_admin or m = any(u.modules))
    from app_users u
    where lower(u.email) = lower(coalesce(auth.jwt()->>'email',''))
    limit 1
  ), false);
$$;
grant execute on function public.fn_has_module(text) to authenticated;

-- Drop every existing policy on the five tables (names vary), then recreate.
do $$
declare t text; p record;
begin
  foreach t in array array['rev_daily','rev_rates','rev_targets','closing_reports','finance'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

-- rev_daily: revenue eyes, operational hands
create policy rev_daily_read  on rev_daily for select to authenticated using (public.fn_has_module('revenue'));
create policy rev_daily_ins   on rev_daily for insert to authenticated with check (true);
create policy rev_daily_upd   on rev_daily for update to authenticated using (true) with check (true);
create policy rev_daily_del   on rev_daily for delete to authenticated using (true);

-- rev_rates / rev_targets: Revenue module only, both directions
create policy rev_rates_all   on rev_rates   for all to authenticated using (public.fn_has_module('revenue')) with check (public.fn_has_module('revenue'));
create policy rev_targets_all on rev_targets for all to authenticated using (public.fn_has_module('revenue')) with check (public.fn_has_module('revenue'));

-- closing_reports: every logged-in user (floor files it nightly); anon = nothing
create policy closing_reports_all on closing_reports for all to authenticated using (true) with check (true);

-- finance: Activations module or admin; anon = nothing (was wide open)
create policy finance_all on finance for all to authenticated using (public.fn_has_module('events')) with check (public.fn_has_module('events'));

notify pgrst, 'reload schema';
