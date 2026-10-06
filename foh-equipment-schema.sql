-- FOH EQUIPMENT COUNT — the monthly count of what the floor, the bar and the
-- sommelier work with: cutlery, glassware, crockery, serviceware, bar tools,
-- decanters. Ported from the Kitchen crockery count (crockery / crockery_takes /
-- crockery_counts) — same shape, same rules. 6 Oct 2026.
--
-- Why not stock_take_*: that is ONE number per item, keyed on FMC article codes.
-- Every equipment workbook counts TWO places (store and in use) and none has a code.
--
-- No DELETE policy on any of the three: a piece is retired (archived), a month is
-- closed. Nothing counted can be wiped from the app.

create table if not exists foh_equipment (
  id          uuid primary key default gen_random_uuid(),
  venue_id    text not null default 'robertos-difc',
  section     text not null,               -- restaurant | bar | sommelier
  grp         text not null default '',    -- heading it is counted under
  kind        text not null default '',    -- TYPE/GROUP as the workbook wrote it
  name        text not null,
  supplier    text not null default '',
  par_level   integer,
  price       numeric,                     -- AED each; NULL = no price yet (never 0)
  thumb       text not null default '',    -- data url, ~220px
  photo       text not null default '',    -- data url, ~900px, fetched on demand
  sort_order  integer not null default 0,
  archived    boolean not null default false,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists foh_equipment_sec on foh_equipment (venue_id, section, sort_order);

create table if not exists foh_equipment_takes (
  id          uuid primary key default gen_random_uuid(),
  venue_id    text not null default 'robertos-difc',
  section     text not null,
  month       date not null,               -- the last day of the month counted
  status      text not null default 'counting',   -- counting | closed
  note        text not null default '',
  opened_by   text not null default '',
  closed_by   text not null default '',
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (venue_id, section, month)
);

create table if not exists foh_equipment_counts (
  id            uuid primary key default gen_random_uuid(),
  venue_id      text not null default 'robertos-difc',
  section       text not null,
  month         date not null,
  equipment_id  uuid not null references foh_equipment(id),
  store         integer,                   -- in the store / B3
  in_use        integer,                   -- out in operation
  unsplit       integer,                   -- workbook only: a total with no store/in-use split
  received      integer,                   -- bought / delivered during the month
  total         integer generated always as
                  (coalesce(store,0) + coalesce(in_use,0) + coalesce(unsplit,0)) stored,
  counted_by       text not null default '',
  counted_by_name  text not null default '',
  source           text not null default '',
  updated_at       timestamptz not null default now(),
  unique (venue_id, month, equipment_id)
);

alter table foh_equipment        enable row level security;
alter table foh_equipment_takes  enable row level security;
alter table foh_equipment_counts enable row level security;

do $$ begin
  create policy eq_read  on foh_equipment for select using (true);
  create policy eq_ins   on foh_equipment for insert with check (true);
  create policy eq_upd   on foh_equipment for update using (true) with check (true);
  create policy eqt_read on foh_equipment_takes for select using (true);
  create policy eqt_ins  on foh_equipment_takes for insert with check (true);
  create policy eqt_upd  on foh_equipment_takes for update using (true) with check (true);
  create policy eqc_read on foh_equipment_counts for select using (true);
  create policy eqc_ins  on foh_equipment_counts for insert with check (true);
  create policy eqc_upd  on foh_equipment_counts for update using (true) with check (true);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
