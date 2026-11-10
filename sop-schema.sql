-- FOH SOPs & policies ("How we work", 10 Nov 2026). Additive only: NEW tables, nothing existing is touched.
-- RLS on, no policies, no grants: the browser reads and writes none of it. Everything goes through the edge
-- function `sop` (service role), so the answer key never reaches a phone and the reading clock is the server's.
--
-- A sign-off = read to the end (server-timed) + both questions right + Employee ID typed again.
-- A sign-off is for one version of a document: when the text changes, ver changes and the person reads it again.

-- One row per SOP or policy. Text comes from the Managers' SOP review folder (sop-seed.sql).
create table if not exists sop_docs (
  code        text primary key,                    -- ROB-SOP-DIN-024, RBT-RST-POL-007 ...
  title       text not null,
  folder      text not null,                       -- host | bar | dining | gx | rest_pol | lounge_pol
  ver         text not null,                       -- hash of the text; changes = everyone reads it again
  blocks      jsonb not null,                      -- [{h}|{p}|{row:[..]}] in document order
  words       int  not null default 0,
  questions   jsonb not null default '[]'::jsonb,  -- [[question, [right, wrong, wrong, wrong], why-line]]; never sent with the answer
  q_status    text not null default 'draft' check (q_status in ('draft','checked')),
  checked_by  text, checked_at timestamptz,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- Which position reads which document, and in which week of the roll-out.
create table if not exists sop_map (
  grp   text not null,                             -- host | service | service_lead | runner | bar | bar_lead | sommelier | barista | cashier | security | manager
  code  text not null references sop_docs(code),
  week  int  not null default 1,
  primary key (grp, code)
);

-- When a person opened a document (the server's clock decides "read long enough").
create table if not exists sop_reads (
  emp_id    text not null,
  code      text not null,
  opened_at timestamptz not null default now(),
  primary key (emp_id, code)
);

-- One row per sign-off.
create table if not exists sop_signs (
  id        uuid primary key default gen_random_uuid(),
  emp_id    text not null,
  name      text,
  role      text,
  code      text not null references sop_docs(code),
  ver       text not null,
  read_ms   int,
  tries     int not null default 1,                -- how many times the questions were answered before both were right
  signed_at timestamptz not null default now()
);
create index if not exists sop_signs_emp_idx on sop_signs (emp_id, code, signed_at desc);

-- Wrong answers are kept too, so a manager can see which questions trip people up.
create table if not exists sop_tries (
  id      uuid primary key default gen_random_uuid(),
  emp_id  text not null,
  code    text not null,
  ok      boolean not null,
  at      timestamptz not null default now()
);

create table if not exists sop_settings (
  key text primary key,
  val jsonb not null,
  by  text,
  at  timestamptz not null default now()
);

alter table sop_docs enable row level security;
alter table sop_map enable row level security;
alter table sop_reads enable row level security;
alter table sop_signs enable row level security;
alter table sop_tries enable row level security;
alter table sop_settings enable row level security;
revoke all on sop_docs, sop_map, sop_reads, sop_signs, sop_tries, sop_settings from anon, authenticated;

notify pgrst, 'reload schema';
