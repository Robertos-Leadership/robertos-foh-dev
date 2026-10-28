-- How many guests each beverage package is for (a client with 31 guests: 19 on the
-- Standard Bar, 12 à la carte). Blank = every guest, which is how every existing
-- booking works, so nothing changes until someone types a number.
alter table public.events_desk
  add column if not exists bev_guests integer check (bev_guests is null or bev_guests >= 1),
  add column if not exists bev_guests_2 integer check (bev_guests_2 is null or bev_guests_2 >= 1);
