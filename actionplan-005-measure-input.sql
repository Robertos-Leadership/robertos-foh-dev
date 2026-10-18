-- Roberto's 3.0 Action Plan — automatic vs typed-in numbers (18 Oct 2026). Additive.
-- Every measure says how it gets its number: 'auto' (read by the ap-weekly
-- function from SevenRooms / the closing report / Google / the FOH App) or
-- 'manual' (typed in the app by a plan member). A typed number records who
-- typed it and when, so nobody mistakes it for a system figure.
alter table ap_measures add column if not exists input text;
alter table ap_measures add column if not exists updated_by text;
update ap_measures set input = case when key is null then 'manual' else 'auto' end where input is null;
alter table ap_measures alter column input set default 'manual';

create or replace function ap_measures_stamp() returns trigger language plpgsql as $$
begin
  -- Typed-in numbers only: stamp who typed it. The function's own writes
  -- (service role, no signed-in email) keep updated_by empty.
  if new.key is null and nullif(ap_me(), '') is not null and new.current is distinct from old.current then
    new.updated_by := ap_me();
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists ap_measures_stamp on ap_measures;
create trigger ap_measures_stamp before update on ap_measures for each row execute function ap_measures_stamp();
notify pgrst, 'reload schema';

-- 18 Oct 2026, Francesco: point 5 renamed to Amin's own words ("take a more proactive sales approach").
update ap_points set title = 'Proactive sales' where num = 5 and title = 'Go out and sell';

-- 18 Oct 2026: sources in plain words on screen (the Data page).
update ap_measures set source = 'Google reviews' where source = 'google_reviews_daily';
update ap_measures set source = 'Closing report' where source = 'rev_daily (closing report)';
