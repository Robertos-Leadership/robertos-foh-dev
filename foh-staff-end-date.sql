-- Item 1 — "Finishing" / last working day for FOH staff.
-- A leaver who still works a few shifts this week keeps those shifts on the
-- roster, then drops off automatically from any week that starts AFTER this date.
-- Additive only (safe to run more than once).
alter table foh_staff add column if not exists end_date date;
notify pgrst,'reload schema';
