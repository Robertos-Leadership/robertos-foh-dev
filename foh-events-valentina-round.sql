-- ═══════════════════════════════════════════════════════════════════════════
-- foh-events-valentina-round.sql — 17 Jul 2026
--
-- Columns for Valentina's feedback round (and Andrea's "lead from and handler").
-- Run ONCE in the Supabase SQL editor (project paoaivwtkzujmrgrfjuq).
-- Safe to re-run: every statement is IF NOT EXISTS. Purely additive — nothing
-- existing is altered, and the app degrades gracefully until this is run
-- (fields keep working in-session via the peColMissing pattern; the one insert
-- default, handled_by, retries without the column).
--
--   off_menu         (#17) à la carte / off-menu items — the line that reaches
--                    every kitchen document, so a hand-priced dish is COOKED,
--                    not just charged.
--   hold_until       (#4)  "hold the 19th until Friday" — optional, nothing
--                    automatic; the list chip turns red once the date passes.
--   lead_source      (#3 / Andrea #11) where the booking came in from
--                    (Walk-in / WhatsApp / Promoter / …).
--   lead_source_note        the promoter's name, agreed commission, etc.
--   handled_by              whose booking it is; defaults to the creator.
--
-- The deposit outcome on a lost booking (#19) needs NO column — it rides in the
-- lost reason (event_log detail + the reason line), same as lost reasons today.
-- ═══════════════════════════════════════════════════════════════════════════

alter table events_desk add column if not exists off_menu         text;
alter table events_desk add column if not exists hold_until       date;
alter table events_desk add column if not exists lead_source      text;
alter table events_desk add column if not exists lead_source_note text;
alter table events_desk add column if not exists handled_by       text;
