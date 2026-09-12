-- ════════════════════════════════════════════════════════════════════════
--  ADMIN MODULE — app_users: who can log in, which modules they see, who's admin
--  Project: Leadership Hub Supabase (paoaivwtkzujmrgrfjuq). Run in SQL Editor.
--  This is the list the Admin screen manages. The login itself is still the
--  Supabase Auth account (created from the dashboard); this table controls
--  what each person can SEE and DO once they log in.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists app_users (
  email      text primary key,
  name       text,
  modules    text[] default array['events','operations','revenue','stocktake'], -- which tiles they see
  is_admin   boolean default false,        -- sees the Admin tile
  notify     text[] default '{}',          -- which notification emails they get (phase 2)
  updated_at timestamptz default now()
);

alter table app_users enable row level security;
drop policy if exists "app_users auth" on app_users;
create policy "app_users auth" on app_users for all to authenticated using (true) with check (true);

-- Seed the three current people (safe to re-run — won't overwrite existing rows)
insert into app_users (email, name, modules, is_admin) values
  ('fguarracino@robertos.ae','Francesco Guarracino', array['events','operations','revenue','stocktake'], true),
  -- Jad Ballout removed 12 Sep 2026 (left the company); his login is banned.
  ('ahtwe@robertos.ae',     'Aung Htwe',             array['events','operations','revenue','stocktake'], false)
on conflict (email) do nothing;

notify pgrst, 'reload schema';
