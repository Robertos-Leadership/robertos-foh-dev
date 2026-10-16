-- Roberto's 3.0 Action Plan — SevenRooms night cache (16 Oct 2026). Additive.
-- The 90-day return measure needs ~7 months of nights; reading them all in one
-- edge-function call hits the 150 s limit (the Kitchen proxy throttles bursts).
-- ap-weekly reads at most 40 missing SETTLED nights per run and keeps only the
-- client ids that had a booking. Service role only (no policies).
create table if not exists ap_sr_nights (
  night date primary key,
  clients text[] not null default '{}',
  bookings int not null default 0,
  read_at timestamptz default now()
);
alter table ap_sr_nights enable row level security;
revoke all on ap_sr_nights from anon, authenticated;
