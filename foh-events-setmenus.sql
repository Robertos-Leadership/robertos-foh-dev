-- ════════════════════════════════════════════════════════════
-- event_set_menus — data-driven plated set menus for the Events desk.
-- Chef Corner (Set menus tab) writes here; Valentina's booking dropdown,
-- the guest proposal and the kitchen brief all read from it. Replaces the
-- hardcoded Terra/Mare/Fuoco array (which is seeded below, keys preserved so
-- existing bookings that reference set_menu.key keep resolving).
--
--   price_pp NULL  = "price pending" — the chef built the menu, only Valentina/
--                    Andrea/Francesco can price it; it can't be quoted until then.
--   courses jsonb  = same shape the app already renders:
--                    [{"name","items":[...]}  |  {"name","choose":1,"options":[...]}]
--   active false   = retired — hidden from new quotes, existing bookings intact.
-- Run once in the FOH Supabase project (paoaivwtkzujmrgrfjuq).
-- ════════════════════════════════════════════════════════════
create extension if not exists pgcrypto;

create table if not exists event_set_menus (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  name       text not null,
  price_pp   numeric,
  line       text,
  courses    jsonb not null default '[]'::jsonb,
  pdf        text,
  active     boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table event_set_menus enable row level security;
drop policy if exists event_set_menus_all on event_set_menus;
create policy event_set_menus_all on event_set_menus for all using (true) with check (true);

-- Seed the three designed menus. on conflict do nothing so a re-run never
-- clobbers a price or edit made later in the app.
insert into event_set_menus (key, name, price_pp, line, pdf, courses) values
('terra', 'Terra set menu', 370,
 'Burrata · homemade tortelli, ricotta and spinach with truffle cream · choice of branzino, polletto or insalata 4 semi · tiramisù',
 'menus/set-menu-terra.pdf',
 '[{"name":"Primi","items":["Burrata"]},{"name":"Pasta","items":["Tortelli ricotta &amp; spinach"]},{"name":"Secondi","choose":1,"options":["Branzino","Polletto","Insalata 4 semi"]},{"name":"Dolci","items":["Tiramisù"]}]'::jsonb),
('mare', 'Mare set menu', 440,
 'Burrata, bresaola and tonno battuto · Il Bosco truffle risotto · choice of angus ribeye, branzino or melanzane · torta al limone',
 'menus/set-menu-mare.pdf',
 '[{"name":"Primi","items":["Burrata","Bresaola","Tonno Battuto"]},{"name":"Pasta","items":["Il Bosco truffle risotto"]},{"name":"Secondi","choose":1,"options":["Ribeye di Angus","Branzino","Melanzane"]},{"name":"Dolci","items":["Torta al Limone"]}]'::jsonb),
('fuoco', 'Fuoco set menu', 525,
 'Burrata, bresaola and tonno battuto · raviolo alla Genovese · choice of wagyu ribeye, moro toothfish or melanzane · Choc-Choc',
 'menus/set-menu-fuoco.pdf',
 '[{"name":"Primi","items":["Burrata","Bresaola","Tonno Battuto"]},{"name":"Pasta","items":["Raviolo alla Genovese"]},{"name":"Secondi","choose":1,"options":["Ribeye di Wagyu","Moro","Melanzane"]},{"name":"Dolci","items":["Choc-Choc"]}]'::jsonb)
on conflict (key) do nothing;
