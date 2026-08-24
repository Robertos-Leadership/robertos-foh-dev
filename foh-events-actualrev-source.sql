-- FOH Private Events — remember when a "real total" came from SevenRooms.
-- Optional. The feature works WITHOUT this (the number still saves as revenue);
-- this column only lets the screen keep showing "from SevenRooms — verify vs
-- Simphony" across reloads, and lets a hand-typed Simphony figure clear that note.
-- Run once in the FOH project (paoaivwtkzujmrgrfjuq).

ALTER TABLE events_desk
  ADD COLUMN IF NOT EXISTS actual_revenue_source text;

NOTIFY pgrst, 'reload schema';
