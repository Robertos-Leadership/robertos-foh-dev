-- Food & Beverage Test (31 Oct 2026). Additive only: two NEW tables, nothing existing is touched.
-- RLS is on and there are NO policies, so the browser (anon key) can read and write none of it.
-- Everything goes through the edge function `fbtest` (service role): the answer key never reaches a phone,
-- and the clock for each question is the server's, not the phone's.

-- One supervised test session: a manager opens it, gives the code to the team, closes it afterwards.
create table if not exists fbt_sittings (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  label      text,
  created_by text,
  created_at timestamptz not null default now(),
  closes_at  timestamptz not null,
  menu_id    text,                              -- the Bible menu the team was trained on; the test draws only from its dishes
  menu_name  text,
  active     boolean not null default true
);
create index if not exists fbt_sittings_code_idx on fbt_sittings (code) where active;

create table if not exists fbt_attempts (
  id          uuid primary key default gen_random_uuid(),
  emp_id      text not null,
  name        text,
  mode        text not null check (mode in ('practice','official')),
  sitting_id  uuid references fbt_sittings(id),
  menu_id     text,
  menu_name   text,
  qs          jsonb not null,                  -- the 20 questions WITH answers; never sent to a phone
  cur         int  not null default 0,         -- index of the question on screen
  sent_at     timestamptz not null default now(),
  answers     jsonb not null default '[]'::jsonb,   -- [{pick, ms, out, away}] one per answered question
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  score       int,
  by_level    jsonb,
  rating      text,
  total_ms    int,
  away        int not null default 0,
  flags       jsonb not null default '[]'::jsonb
);
create index if not exists fbt_attempts_emp_idx on fbt_attempts (emp_id, started_at desc);
create index if not exists fbt_attempts_sitting_idx on fbt_attempts (sitting_id);

alter table fbt_sittings enable row level security;
alter table fbt_attempts enable row level security;
revoke all on fbt_sittings, fbt_attempts from anon, authenticated;

notify pgrst, 'reload schema';
