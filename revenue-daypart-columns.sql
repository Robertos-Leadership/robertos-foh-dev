-- Roberto's FOH Revenue — daypart granularity (Lunch/Dinner per area)
-- Project paoaivwtkzujmrgrfjuq. Run in SQL Editor. Additive & safe to re-run.
-- Adds Restaurant/Lounge x Lunch/Dinner revenue + covers to rev_daily.
-- The existing rest_net/lounge_net/rest_covers_actual/lounge_covers_actual/net_actual
-- stay as the rolled-up totals (the app recomputes them on save), so the revenue
-- model + Review keep working; seeded history (area totals only) is unaffected.

alter table rev_daily add column if not exists rest_lunch_net      numeric;
alter table rev_daily add column if not exists rest_lunch_covers   integer;
alter table rev_daily add column if not exists rest_dinner_net     numeric;
alter table rev_daily add column if not exists rest_dinner_covers  integer;
alter table rev_daily add column if not exists lounge_lunch_net    numeric;
alter table rev_daily add column if not exists lounge_lunch_covers integer;
alter table rev_daily add column if not exists lounge_dinner_net   numeric;
alter table rev_daily add column if not exists lounge_dinner_covers integer;

notify pgrst, 'reload schema';
