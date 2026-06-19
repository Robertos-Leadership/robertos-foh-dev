-- Roberto's FOH — Closing Report (Daily Snapshot) schema
-- Project: Leadership Hub Supabase (paoaivwtkzujmrgrfjuq). Run in SQL Editor. Safe to re-run.
-- FINANCE/OPS DATA → authenticated-only RLS (managers log in). ARCHITECTURE.md §1.
-- Run AFTER revenue-schema.sql + revenue-fnb-columns.sql (it rolls up into rev_daily on save).
--
-- The closing report is the PRIMARY daily entry: the duty manager fills it at close.
-- On save the app copies the revenue fields into rev_daily (net / covers / dayparts /
-- F&B) so the whole revenue model + Analyst update with no double entry. The
-- operational fields (tips, comps, shift logs, comments) live here and feed the
-- Analyst's pattern-reading over time. Column names mirror rev_daily for a clean rollup.

create table if not exists closing_reports (
  service_date         date primary key,

  -- ── Revenue grid (area × daypart) — same names as rev_daily ──
  rest_lunch_net       numeric, rest_lunch_covers    integer,
  rest_dinner_net      numeric, rest_dinner_covers   integer,
  lounge_lunch_net     numeric, lounge_lunch_covers  integer,
  lounge_dinner_net    numeric, lounge_dinner_covers integer,

  -- ── F&B split (rolls to rev_daily) ──
  food_net             numeric,
  bev_net              numeric,
  tobacco_net          numeric,

  -- ── Tips (daily totals; total = cc + cash, computed in app) ──
  cc_tips              numeric,
  cash_tips            numeric,

  -- ── Operational log (stays here; feeds the Analyst for patterns) ──
  manager_am           text,
  manager_pm           text,
  comps                jsonb default '[]'::jsonb,   -- [{table,guest,amount,reason,manager}]
  shifts               jsonb default '{}'::jsonb,   -- {day:{feedback,challenges},night:{...},late:{...}}
  private_events       text,                        -- private events / group bookings
  comments_good        jsonb default '[]'::jsonb,   -- ["bullet", ...]
  comments_bad         jsonb default '[]'::jsonb,   -- ["bullet", ...]
  support              text,                        -- support needed

  emailed_at           timestamptz,                 -- last time it was emailed (Phase 2)
  created_by           text,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- Additive migration (safe if the table already existed without these columns).
alter table closing_reports add column if not exists rest_lunch_net      numeric;
alter table closing_reports add column if not exists rest_lunch_covers   integer;
alter table closing_reports add column if not exists rest_dinner_net     numeric;
alter table closing_reports add column if not exists rest_dinner_covers  integer;
alter table closing_reports add column if not exists lounge_lunch_net    numeric;
alter table closing_reports add column if not exists lounge_lunch_covers integer;
alter table closing_reports add column if not exists lounge_dinner_net   numeric;
alter table closing_reports add column if not exists lounge_dinner_covers integer;
alter table closing_reports add column if not exists food_net            numeric;
alter table closing_reports add column if not exists bev_net             numeric;
alter table closing_reports add column if not exists tobacco_net         numeric;
alter table closing_reports add column if not exists cc_tips             numeric;
alter table closing_reports add column if not exists cash_tips           numeric;
alter table closing_reports add column if not exists manager_am          text;
alter table closing_reports add column if not exists manager_pm          text;
alter table closing_reports add column if not exists comps               jsonb default '[]'::jsonb;
alter table closing_reports add column if not exists shifts              jsonb default '{}'::jsonb;
alter table closing_reports add column if not exists private_events      text;
alter table closing_reports add column if not exists comments_good       jsonb default '[]'::jsonb;
alter table closing_reports add column if not exists comments_bad        jsonb default '[]'::jsonb;
alter table closing_reports add column if not exists support             text;
alter table closing_reports add column if not exists emailed_at          timestamptz;
alter table closing_reports add column if not exists created_by          text;
alter table closing_reports add column if not exists created_at          timestamptz default now();
alter table closing_reports add column if not exists updated_at          timestamptz default now();

-- ── RLS: authenticated-only (managers log in) — mirrors rev_daily ──
alter table closing_reports enable row level security;
drop policy if exists "closing_reports auth" on closing_reports;
create policy "closing_reports auth" on closing_reports for all to authenticated using (true) with check (true);

-- Realtime + reload PostgREST schema cache
alter publication supabase_realtime add table closing_reports;
notify pgrst, 'reload schema';
