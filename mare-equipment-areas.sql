-- Roberto's Mare — Crockery & equipment: four more areas (9 Nov 2026).
-- Milica's list (Lista Inventara-2026 nova.xlsx): Cutlery & small items, Bar, Storeroom, Restaurant.
-- The only schema change: the `sheet` check allows the four new area keys. No rows touched, nothing deleted.
alter table public.mare_equip_items drop constraint if exists mare_equip_items_sheet_check;
alter table public.mare_equip_items add constraint mare_equip_items_sheet_check
  check (sheet in ('big','small','cutlery','bar','store','rest'));
