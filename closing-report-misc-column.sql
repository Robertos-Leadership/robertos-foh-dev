-- Roberto's FOH — Closing Report: Miscellaneous sales column
-- Project: Leadership Hub Supabase (paoaivwtkzujmrgrfjuq). Safe to re-run.
--
-- ALREADY APPLIED to the live database on 14 Aug 2026. Kept here as the record.
--
-- Asked for by Jins Thomas (Operations, 13 Aug 2026): "We need to create an extra
-- Colum for miscellaneous. for example, today we charge 300 dhs miscellaneous for
-- the flower decoration."
--
-- Flowers, cake, corkage and the like are charged to the guest, so the money is
-- already inside the night's net revenue — but it is neither Food, Beverage nor
-- Tobacco. Before this column, every such night left the Food+Bev+Tobacco split
-- short by exactly that amount and the reconciliation tick never appeared.
--
-- rev_daily.other_net ALREADY EXISTED (the Revenue AI briefing has always described
-- "Food + Beverage + Tobacco + Other income") — nothing had ever written to it.
-- Only closing_reports needed the column.

alter table public.closing_reports add column if not exists other_net numeric;
alter table public.rev_daily       add column if not exists other_net numeric;   -- no-op, already present

-- Make the column visible to PostgREST immediately (otherwise saves fail PGRST204)
notify pgrst, 'reload schema';
