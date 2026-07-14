-- ════════════════════════════════════════════════════════════════════════
-- SECURITY BATCH D (#6) — events_desk RLS, now tracked in the repo.
-- Project: paoaivwtkzujmrgrfjuq.
--
-- This policy ALREADY EXISTS and was verified working (anon reads 0 rows,
-- 14 Jul 2026) — it previously lived only in the dashboard. This file is the
-- tracked source of truth; safe to re-run (idempotent).
--
-- Model: logged-in app users see and manage every event; the guest-facing
-- pages (client-event / client-agreement / client-setmenu) NEVER touch this
-- table directly — they go through the token-gated edge functions
-- (event-agreement, event-client-menu), which use the service role.
-- ════════════════════════════════════════════════════════════════════════
alter table events_desk enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='events_desk') then
    create policy events_desk_auth on events_desk
      for all to authenticated using (true) with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
