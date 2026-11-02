-- FOH Learning section (2 Nov 2026). Additive only: two NEW tables, nothing existing is touched.
-- RLS on, no policies, no grants: the browser (anon key) reads and writes none of it. Everything goes through
-- the edge function `learn` (service role), so the answer key never reaches a phone and the clock is the server's.

-- One row per topic. A topic reaches the team only when status = 'approved'.
-- draft -> checked (by the person whose job title matches checker_re) -> approved (an Admin).
create table if not exists learn_topics (
  key         text primary key,
  name        text not null,
  blurb       text,
  position    int  not null default 0,
  built       boolean not null default false,      -- false = no questions exist yet, shown as "Coming soon"
  checker_re  text not null,                        -- job title (foh_staff.role) allowed to check this topic
  checker_for text,                                 -- plain words for the screen
  status      text not null default 'draft' check (status in ('draft','checked','approved')),
  checked_by  text, checked_at timestamptz,
  approved_by text, approved_at timestamptz,
  expires_months int                                -- null = a pass never expires
);

create table if not exists learn_attempts (
  id          uuid primary key default gen_random_uuid(),
  emp_id      text not null,
  name        text,
  role        text,
  topic       text not null references learn_topics(key),
  qs          jsonb not null,                       -- the questions WITH answers; never sent to a phone
  cur         int  not null default 0,
  sent_at     timestamptz not null default now(),
  answers     jsonb not null default '[]'::jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  score       int,
  passed      boolean,
  total_ms    int,
  away        int not null default 0
);
create index if not exists learn_attempts_emp_idx on learn_attempts (emp_id, topic, started_at desc);

alter table learn_topics enable row level security;
alter table learn_attempts enable row level security;
revoke all on learn_topics, learn_attempts from anon, authenticated;

insert into learn_topics (key,name,blurb,position,built,checker_re,checker_for,expires_months) values
 ('alacarte','A la carte 2026','The dishes on the menu: ingredients, stories, garnish, service notes.',1,true,'restaurant manager','the Restaurant Manager',null),
 ('allergens','Allergens at the table','Which dish carries which allergen, and what a guest with an allergy can eat.',2,true,'restaurant manager','the Restaurant Manager',12),
 ('wine','Wine by the glass','The wines we pour: region, style, what to serve them with.',3,true,'sommelier','the Head Sommelier',null),
 ('spirits','Spirits and cocktails','Spirits and cocktails at the bar.',4,false,'lounge','the Lounge Manager',null),
 ('sops','Service SOPs','Taking the order, serving wine by the glass and the other floor SOPs.',5,false,'restaurant manager','the Restaurant Manager',null)
on conflict (key) do nothing;

notify pgrst, 'reload schema';

-- Wine test setup (2 Nov 2026): which Kitchen wine edition the Wine test is built from, and which wines are
-- left out of it. Written only by the `learn` function (sommelier or Admin). Absent = the Kitchen's active wines.
create table if not exists learn_settings (
  key text primary key,
  val jsonb not null,
  by  text,
  at  timestamptz not null default now()
);
alter table learn_settings enable row level security;
revoke all on learn_settings from anon, authenticated;
