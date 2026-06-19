-- Roberto's FOH — Revenue: monthly budget per period
-- Project: Leadership Hub Supabase (paoaivwtkzujmrgrfjuq). Run in SQL Editor. Safe to re-run.
--
-- Lets the manager enter ONE monthly budget figure per month; the app distributes
-- it across the days by the weekday/weekend pattern (rev_rates), each day still
-- hand-editable via budget_override. Stored per period; daily budgets stay derived.
-- create table if not exists does NOT add columns to an existing table → use ALTER.

alter table rev_targets add column if not exists monthly_budget numeric;

-- Make the new column visible to PostgREST immediately
notify pgrst, 'reload schema';
