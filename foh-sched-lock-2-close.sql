-- FOH schedule lock — STEP 2 of 2: CLOSE the open write door (30 Sep 2026)
-- Run ONLY after the new app (manager-ID unlock) is live on BOTH dev and live, otherwise the
-- old app's Save/Delete fail with 42501. Reads stay open — the whole team can still SEE the schedule.
-- Rollback: foh-sched-lock-2-rollback.sql
drop policy if exists "Allow all foh_roster" on public.foh_roster;
drop policy if exists "Auth write foh_roster" on public.foh_roster;
-- kept: "Public read foh_roster" (anon SELECT), "Auth read foh_roster" (authenticated SELECT)
