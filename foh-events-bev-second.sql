-- A booking can carry a SECOND beverage package: one alcoholic + one alcohol-free,
-- on the same hours (Eva, 26 Oct 2026, via "Send feedback").
-- Additive and nullable: every existing booking keeps exactly the one package it has.
-- The app only reads this column beside a first package (bev_package_id).
alter table public.events_desk
  add column if not exists bev_package_id_2 uuid references public.event_bev_packages(id) on delete set null;
