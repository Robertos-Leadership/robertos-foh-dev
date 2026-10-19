-- Roberto's 3.0 action plan — make the app match the deck sent to Amin (19 Oct 2026).
-- Decided with Francesco and Andrea on 19 Oct (vault: Decisions/Decision Log.md).
-- Additive only: one new column, new measures, old measures HIDDEN (not deleted).
-- Undo: set hidden=false on the old keys, hidden=true on the new ones.

-- 1. A lead for each point
alter table ap_points add column if not exists lead text;
update ap_points set lead = v.lead from (values
  (1, 'Andrea'),
  (2, 'Andrea and Francesco set up the platform. Ouafaa makes sure it happens'),
  (3, 'Justin appoints the agency, once the audit document is ready'),
  (4, 'Justin: Director of Marketing. Andrea: CRM Manager, Sales and Events Manager'),
  (5, 'Andrea sets up the platform. Ouafaa makes sure the system is in place'),
  (6, 'Andrea and Francesco set up the platform. Ouafaa executes'),
  (7, 'Andrea, Francesco and Ouafaa: the ideas and the KPIs'),
  (8, 'Andrea leads the relaunch. Nicole counts press and Instagram'),
  (9, 'Mustafa: invitations. Francesco and Ouafaa: the dinner itself'),
  (10, 'Ouafaa and Justin: content and agreements')
) as v(num, lead) where ap_points.num = v.num;

-- 2. Point 5 — share of GUESTS booked ahead, 70% -> 80% (Amin's mark: 70–80%)
update ap_points set goal = 'Stop waiting for guests. 70% of our guests book ahead today; a strong business books 70–80% ahead.' where num = 5;
update ap_measures set hidden = true where key in ('walkin_share', 'walkin_covers');
insert into ap_measures (point_id, key, label, short_label, source, frequency, baseline, target, unit, input, hidden, sort, current_label)
select p.id, 'booked_share', 'Guests who booked ahead', 'Booked ahead', 'SevenRooms', 'Weekly', '70% (1 Aug–15 Oct)', '80%', '%', 'auto', false, 0, 'Read at the next refresh'
from ap_points p where p.num = 5 and not exists (select 1 from ap_measures where key = 'booked_share');

-- 3. Point 7 — net revenue a night: AED 30k by end of November, 50k by December
insert into ap_measures (point_id, key, label, short_label, source, frequency, baseline, target, unit, input, hidden, sort, current_label)
select p.id, v.key, v.label, v.short, 'Closing report', 'Weekly', v.base, 'AED 30k by end Nov · 50k by Dec', 'AED', 'auto', false, v.sort, 'Read at the next refresh'
from ap_points p, (values
  ('monday_net', 'Monday net revenue', 'Monday net (last 4 avg)', 'AED 25.0k (11 Mondays, 1 Aug – 12 Oct)', 1),
  ('sunday_net', 'Sunday net revenue', 'Sunday', 'AED 18.6k (4, 11, 18 Oct — open on Sundays since October)', 2)
) as v(key, label, short, base, sort)
where p.num = 7 and not exists (select 1 from ap_measures m where m.key = v.key);
update ap_measures set sort = 3, target = 'Beside the revenue', short_label = 'Monday guests' where key = 'monday_guests';
update ap_measures set sort = 4, target = 'Beside the revenue', short_label = 'Sunday guests' where key = 'sunday_guests';

-- 4. Point 8 — awareness, typed in weekly by Nicole (Marketing)
update ap_measures set hidden = true where key = 'relaunch_bookings';
insert into ap_measures (point_id, key, label, short_label, source, frequency, baseline, target, unit, input, hidden, sort, current_label)
select p.id, null, v.label, v.short, 'Typed in by Nicole (Marketing)', 'Weekly', 'Counted 19 Oct – 1 Nov', 'Above the 2 weeks before', 'count', 'manual', false, v.sort, '2–15 Nov against 19 Oct – 1 Nov'
from ap_points p, (values
  ('Press articles', 'Press articles', 1),
  ('Instagram posts and stories tagging us', 'Instagram tags', 2),
  ('Instagram reach', 'Instagram reach', 3),
  ('New Instagram followers', 'New followers', 4)
) as v(label, short, sort)
where p.num = 8 and not exists (select 1 from ap_measures m where m.point_id = p.id and m.label = v.label);

-- 5. Points 2 and 3 — 85% is a first goal, checked against the first results
update ap_measures set target = 'All trained, 85% average (first goal)' where key = 'trained';
update ap_measures set target = '85% (first goal)' where key = 'mystery';

-- 6. Point 1 — say which approval
update ap_steps set title = 'Amin approves the SOPs'
where title = 'Amin approves' and point_id = (select id from ap_points where num = 1);

-- 7. Nicole types point 8: she joins the plan's private list
update ap_settings set members = array_append(members, 'ndragan@robertos.ae') where not ('ndragan@robertos.ae' = any(members));
update app_users set modules = array_append(modules, 'actionplan') where email = 'ndragan@robertos.ae' and not ('actionplan' = any(modules));

-- UNDO (values read just before this ran, 19 Oct 2026):
-- update ap_measures set hidden=false where key in ('walkin_share','walkin_covers','relaunch_bookings');
-- update ap_measures set hidden=true where key in ('booked_share','monday_net','sunday_net')
--   or (label in ('Press articles','Instagram posts and stories tagging us','Instagram reach','New Instagram followers'));
-- update ap_measures set sort=1, target='100', short_label='Monday guests (last 4 avg)' where key='monday_guests';
-- update ap_measures set sort=2, target='Up every week', short_label='Sunday' where key='sunday_guests';
-- update ap_measures set target='All trained, 85% average' where key='trained';
-- update ap_measures set target='85%' where key='mystery';
-- update ap_points set goal='Stop waiting for guests; walk-ins are almost 35% of our business.' where num=5;
-- update ap_steps set title='Amin approves' where id='2cf27cc0-f167-4302-836f-466563c0f74b';
-- update ap_settings set members=array_remove(members,'ndragan@robertos.ae');
-- update app_users set modules=array_remove(modules,'actionplan') where email='ndragan@robertos.ae';
