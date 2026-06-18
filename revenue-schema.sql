-- Roberto's FOH — Revenue module schema
-- Project: Leadership Hub Supabase (paoaivwtkzujmrgrfjuq). Run in SQL Editor. Safe to re-run.
-- FINANCE DATA → authenticated-only RLS (NOT the open anon layer). ARCHITECTURE.md §1.
-- Run order: 1) this file  2) revenue-seed-history.sql

-- ── Rates engine (config, one row per weekday) ──
create table if not exists rev_rates (
  weekday      text primary key,           -- Monday..Sunday
  no_show_rate numeric default 0,
  avg_spend    numeric default 0,          -- AED/head (restaurant)
  walkin_rate  numeric default 0,
  cover_target integer default 0,
  sort_order   integer default 0
);

-- ── Daily actuals (one row per date — months & years live here, no per-month tables) ──
create table if not exists rev_daily (
  service_date         date primary key,
  net_actual           numeric,            -- AED total (rolled up from areas)
  rest_covers_actual   integer,            -- restaurant covers (lunch+dinner)
  lounge_covers_actual integer,            -- lounge covers (lunch+dinner)
  rest_net             numeric,            -- restaurant net (lunch+dinner)
  lounge_net           numeric,            -- lounge net (lunch+dinner)
  -- daypart x area detail (entered in the closing report)
  rest_lunch_net       numeric, rest_lunch_covers   integer,
  rest_dinner_net      numeric, rest_dinner_covers  integer,
  lounge_lunch_net     numeric, lounge_lunch_covers integer,
  lounge_dinner_net    numeric, lounge_dinner_covers integer,
  forecast             numeric,
  notes                text,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- ── Monthly targets (one row per period) ──
create table if not exists rev_targets (
  period         text primary key,         -- 'YYYY-MM'
  monthly_target numeric default 0,
  created_at     timestamptz default now()
);

-- ── RLS: authenticated-only (finance) ──
alter table rev_rates   enable row level security;
alter table rev_daily   enable row level security;
alter table rev_targets enable row level security;

drop policy if exists "rev_rates auth"   on rev_rates;
drop policy if exists "rev_daily auth"   on rev_daily;
drop policy if exists "rev_targets auth" on rev_targets;
create policy "rev_rates auth"   on rev_rates   for all to authenticated using (true) with check (true);
create policy "rev_daily auth"   on rev_daily   for all to authenticated using (true) with check (true);
create policy "rev_targets auth" on rev_targets for all to authenticated using (true) with check (true);

-- Realtime (live updates across manager screens)
alter publication supabase_realtime add table rev_daily;

-- ── Seed the rates engine (June 2026 values from the Rates tab) ──
insert into rev_rates (weekday, no_show_rate, avg_spend, walkin_rate, cover_target, sort_order) values
  ('Monday',   0.08, 360, 0.20,  65, 1),
  ('Tuesday',  0.07, 400, 0.18, 120, 2),
  ('Wednesday',0.06, 375, 0.17, 165, 3),
  ('Thursday', 0.05, 415, 0.22, 245, 4),
  ('Friday',   0.08, 485, 0.16, 255, 5),
  ('Saturday', 0.07, 460, 0.12, 260, 6),
  ('Sunday',   0,    0,   0,      0, 7)
on conflict (weekday) do update set
  no_show_rate=excluded.no_show_rate, avg_spend=excluded.avg_spend,
  walkin_rate=excluded.walkin_rate, cover_target=excluded.cover_target, sort_order=excluded.sort_order;

-- ── Seed targets (June = 2,000,000; add more per month via the app) ──
insert into rev_targets (period, monthly_target) values
  ('2026-06', 2000000)
on conflict (period) do update set monthly_target=excluded.monthly_target;
