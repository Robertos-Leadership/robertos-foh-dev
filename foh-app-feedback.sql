-- ═══════════════════════════════════════════════════════════════════════════
-- foh-app-feedback.sql  —  Team feedback rounds (foh-feedback.html → Admin → Feedback)
-- FOH Supabase project: paoaivwtkzujmrgrfjuq  (shared with the Leadership Hub)
--
-- Run this once in the Supabase SQL editor. It is ADDITIVE ONLY and safe to
-- re-run (IF NOT EXISTS / drop-and-recreate policies). Until it runs, the app
-- degrades gracefully: the feedback page says it can't save yet (it never
-- pretends a send worked), and Admin → Feedback shows a "run this file" note.
--
-- What it records: one row per person per feedback round. The team answer on
-- foh-feedback.html?topic=<topic>; Francesco reads them in Admin → Feedback.
-- Unlike a WhatsApp reply, a row landing here IS the receipt — the page only
-- says "sent" once the insert comes back OK.
--
--   answers shape:  {"7": {"a":"Fix this", "note":"happens every week"}, ...}
--                   keyed by the question number in the set.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create table if not exists app_feedback (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null,                      -- e.g. 'events-20'
  who        text,                               -- who answered (from the link, or typed)
  answers    jsonb not null default '{}'::jsonb, -- {"<q>": {"a": "...", "note": "..."}}
  extra      text,                               -- the free "anything we missed" box
  venue_id   text default 'robertos-difc',
  created_at timestamptz default now()
);

-- Newest-first reads per round (what Admin → Feedback does).
create index if not exists app_feedback_topic_idx on app_feedback (topic, created_at desc);

-- The team answer on a public page (no login on their phone), so anon may INSERT.
-- Reading is for signed-in app users only — the same shape as event_menu_choices,
-- NOT the looser "allow all" used by app_activity: answers are people talking
-- candidly about their own tools, so they should not be world-readable.
alter table app_feedback enable row level security;

drop policy if exists app_feedback_insert on app_feedback;
create policy app_feedback_insert on app_feedback
  for insert to anon, authenticated with check (true);

drop policy if exists app_feedback_read on app_feedback;
create policy app_feedback_read on app_feedback
  for select to authenticated using (true);

-- Refresh PostgREST so the new table is visible to the app immediately.
notify pgrst, 'reload schema';

-- After running: send the team
--   https://robertos-foh-dev.pages.dev/foh-feedback.html?topic=events-20&who=Valentina
-- and read what comes back in the app under Admin → Feedback.
