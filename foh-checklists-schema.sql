-- Roberto's FOH — Restaurant Opening/Closing checklists (public, no login)
-- Project: Leadership Hub Supabase (paoaivwtkzujmrgrfjuq). Run in SQL Editor. Safe to re-run.
-- OPEN operational layer (anon read+write, like foh_roster) — accountability via Employee ID
-- sign-off, not auth (ARCHITECTURE.md §1). Items live in the app; this stores tick state + sign-off.

create table if not exists foh_checklists (
  id              uuid primary key default gen_random_uuid(),
  check_date      date not null,
  shift_type      text not null,                 -- 'opening' | 'closing'
  area            text not null default 'Restaurant',
  checked         jsonb not null default '{}'::jsonb,   -- {"0":true,"3":true,...} item index -> done
  verified_emp_id text,
  verified_name   text,
  verified_role   text,
  verified_at     timestamptz,
  updated_at      timestamptz default now(),
  unique (check_date, shift_type, area)
);

-- Open layer: anon read + write (PIN/Employee-ID accountability, not RLS auth)
alter table foh_checklists enable row level security;
drop policy if exists "Allow all foh_checklists" on foh_checklists;
create policy "Allow all foh_checklists" on foh_checklists for all using (true) with check (true);

-- Realtime so tick progress is shared live across devices through the shift
alter publication supabase_realtime add table foh_checklists;
notify pgrst, 'reload schema';
