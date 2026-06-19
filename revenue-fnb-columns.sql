-- Roberto's FOH — Revenue: daily Food / Beverage / Tobacco sales split
-- Project: Leadership Hub Supabase (paoaivwtkzujmrgrfjuq). Run in SQL Editor. Safe to re-run.
--
-- Captures the DSR daily sales split so the AI (and reports) can show real
-- Food/Beverage/Tobacco figures for any day. When a day's split isn't entered,
-- the app/AI falls back to the standard mix (Food 48% / Bev 51% / Tobacco 1%),
-- clearly labelled as an estimate.
-- create table if not exists does NOT add columns to an existing table -> use ALTER.

alter table rev_daily add column if not exists food_net     numeric;
alter table rev_daily add column if not exists bev_net      numeric;
alter table rev_daily add column if not exists tobacco_net  numeric;

-- Make the new columns visible to PostgREST immediately
notify pgrst, 'reload schema';
