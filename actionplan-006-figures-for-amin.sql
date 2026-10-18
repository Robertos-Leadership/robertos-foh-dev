-- Roberto's 3.0 Action Plan — figures made fit for Amin (18 Oct 2026). Additive only:
-- nothing is deleted. A measure taken off the plan is HIDDEN (hidden = true) and
-- can be brought back by setting it false.
--   * Google rating: off the plan (Francesco: it read as the mystery shopper).
--   * Point 6: "back within 90 days" replaced by the 3-visit ladder, rule A —
--     2nd visit within 30 days of the 1st, 3rd within 30 days of the 2nd (the
--     same rule as the "3 visits" report). The old measure is hidden, kept.
--   * Point 5: walk-in share shown on BOTH bookings and covers, each vs 20%.
--   * Bookings by channel: comes from the call-centre CRM, which is not linked —
--     shown as coming, no SevenRooms figure in its place.
alter table ap_measures add column if not exists hidden boolean not null default false;
-- Per-night counts for the weekly walk-in history (null = not read yet).
alter table ap_sr_nights add column if not exists walkin_bookings int;
alter table ap_sr_nights add column if not exists covers int;
alter table ap_sr_nights add column if not exists walkin_covers int;

update ap_measures set hidden = true where key in ('google_rating', 'return90');

update ap_measures set label = 'Walk-in share — bookings', baseline = '38.4% (1 Aug–15 Oct)'
 where key = 'walkin_share';
insert into ap_measures (point_id, key, label, target, source, frequency, baseline, unit, input, sort)
select p.id, 'walkin_covers', 'Walk-in share — covers', '20%', 'SevenRooms', 'Weekly', '29.8% (1 Aug–15 Oct)', '%', 'auto', 2
from ap_points p where p.num = 5
  and not exists (select 1 from ap_measures where key = 'walkin_covers');
update ap_measures set sort = 3, source = 'Call-centre CRM', current = null, current_label = 'From the CRM — not linked yet',
       updated_at = null, detail = null, baseline = 'Set when the CRM is linked'
 where key = 'channels';

insert into ap_measures (point_id, key, label, target, source, frequency, baseline, unit, input, sort)
select p.id, 'visits3', 'First-time guests who came a 2nd and a 3rd time', '+10 points vs baseline (2nd visit 14.4%)', 'SevenRooms', 'Monthly',
       'June: 4.4% came a 2nd time (54 of 1,236) · 0.8% a 3rd (10)', '%', 'auto', 0
from ap_points p where p.num = 6
  and not exists (select 1 from ap_measures where key = 'visits3');
notify pgrst, 'reload schema';
