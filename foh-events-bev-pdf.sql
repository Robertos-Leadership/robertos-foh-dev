-- Beverage-package PDF — run in Supabase project paoaivwtkzujmrgrfjuq (FOH).
-- Additive only, safe to run at any time. The app degrades gracefully without it
-- (a package still saves — it just gets no "View the beverage package" button
-- until this is run), so there is no rush and no downtime.

-- 1) The designed PDF the guest can open, mirroring event_set_menus.pdf.
ALTER TABLE event_bev_packages
  ADD COLUMN IF NOT EXISTS pdf text;

-- 2) Expose it on the guest-safe view so the WhatsApp menu page (client-menus.html)
--    can show the button. Cost per guest stays on the base table and never leaks.
CREATE OR REPLACE VIEW event_bev_public AS
  SELECT id, name, duration_hours, price_pp, includes, non_alcoholic, pdf
  FROM event_bev_packages
  WHERE active IS NOT FALSE;

NOTIFY pgrst, 'reload schema';

-- After running: open Events → Beverage corner, edit a package, upload the
-- package PDF, Save. Guests then get a "View the beverage package" button in the
-- menu email and on the WhatsApp menu page.
