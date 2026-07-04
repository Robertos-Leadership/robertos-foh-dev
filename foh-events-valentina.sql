-- Valentina UX audit fixes — schema addition (run in Supabase project paoaivwtkzujmrgrfjuq)
-- Additive only. The app degrades gracefully without this (dry events simply
-- can't offer a beverage package until a soft-drinks package is flagged below),
-- so it is safe to run at any time.

-- P0 #1 — mark which beverage packages are alcohol-free, so a "Dry event" can
-- still offer soft-drinks / mocktail packages while alcoholic ones are hidden
-- and never charged. Existing packages default to alcoholic (false).
ALTER TABLE event_bev_packages
  ADD COLUMN IF NOT EXISTS non_alcoholic boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- After running: open Events → Beverage corner, edit each soft-drinks / mocktail
-- package and tick "Alcohol-free package" so it appears on dry events.
