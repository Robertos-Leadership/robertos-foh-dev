-- Undo foh-sched-lock-2-close.sql: put the two write policies back exactly as they were.
create policy "Allow all foh_roster" on public.foh_roster for all to public using (true) with check (true);
create policy "Auth write foh_roster" on public.foh_roster for all to authenticated using (true);
