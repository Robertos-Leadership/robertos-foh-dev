-- ════════════════════════════════════════════════════════════════════════════
-- foh-events-batch7.sql  —  Events module Batch 7 (Discount · Comp dishes · Payment link)
-- FOH Supabase project: paoaivwtkzujmrgrfjuq  (shared with the Leadership Hub)
--
-- Run this once in the Supabase SQL editor. It is ADDITIVE ONLY and safe to re-run
-- (every statement is IF NOT EXISTS). Until it runs, the app degrades gracefully:
-- the Discount / on-the-house / Payment-link controls keep working IN-SESSION and
-- show a "needs the Batch 7 database update to save" note instead of erroring.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) DISCOUNT — a courtesy amount (AED) taken off the quoted price on the Agreement card.
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS discount numeric;

-- 2) COMP / FREE DISHES — mark an individual dish "on the house": excluded from the
--    charged food total, but the kitchen still prepares it (cost + pieces still count).
ALTER TABLE event_items ADD COLUMN IF NOT EXISTS comp boolean NOT NULL DEFAULT false;

-- 3) PAYMENT LINK — the Telr portal link Valentina pastes in after the event is signed,
--    so the "Send payment link" button can email the guest the deposit link.
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS payment_link text;

-- Refresh PostgREST so the new columns are visible to the app immediately.
NOTIFY pgrst, 'reload schema';
