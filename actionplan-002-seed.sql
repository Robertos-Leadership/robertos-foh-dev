-- ════════════════════════════════════════════════════════════════════════
-- Roberto's 3.0 Action Plan — seed (16 Oct 2026). Inserts only, and only once:
-- every insert is guarded, so re-running adds nothing. Owner and due date are
-- deliberately EMPTY — Andrea and Francesco fill them in the app.
-- Baselines were measured 16 Oct 2026 from SevenRooms (nightly book, 229 nights
-- 1 Mar–15 Oct read through Kitchen sevenrooms-sync, same rules as Reservation
-- Reports), rev_daily (venue robertos-difc) and google_reviews_daily.
-- ════════════════════════════════════════════════════════════════════════
insert into ap_points (num, title, goal, "group", sort) values
 (1,'New standards (SOPs)','Our SOPs are the old ones from before the renovation; rewrite them for the new Roberto''s.','Standards',1),
 (2,'Training with targets','Every manager and staff member trained on the new SOPs.','Standards',2),
 (3,'Mystery shopper and guest survey','Bring both back, so we know what guests really see.','Standards',3),
 (4,'Key hires','Director of Marketing, CRM Manager, Sales and Events Manager.','People',4),
 (5,'Go out and sell','Stop waiting for guests; walk-ins are almost 35% of our business.','Business growth',5),
 (6,'1st, 2nd and 3rd visit','From the welcome at the door to what each guest gets on each visit.','Standards',6),
 (7,'Sundays and Mondays','Our two slowest days.','Business growth',7),
 (8,'Relaunch with Chef Enrico','Roberto''s 3.0 relaunch; Enrico is the main story.','Relaunch',8),
 (9,'VIP dinner at the villa','Catering dinner at the Kadrie villa, Jumeirah Islands, with VIPs, partners and press.','Relaunch',9),
 (10,'Promoters, short term','Only when needed, and only if it pays.','Business growth',10)
on conflict (num) do nothing;

insert into ap_steps (point_id, title, is_app, sort, done_at, done_by)
select p.id, s.title, s.is_app, s.sort, case when s.done then now() end, case when s.done then 'seed' end
from (values
 (1,'Walk the guest journey',false,1,false),(1,'Rewrite the SOPs',false,2,false),(1,'SOPs in the app',true,3,false),(1,'Amin approves',false,4,false),(1,'All floor staff signed',false,5,false),
 (2,'Name the trainers',false,1,false),(2,'Write the test questions',false,2,false),(2,'Training and tests',true,3,false),(2,'Training sessions',false,4,false),(2,'Everyone tested',false,5,false),
 (3,'Appoint a company',false,1,false),(3,'Mystery shopper form',true,2,false),(3,'First visit',false,3,false),(3,'Guest survey',true,4,false),
 (4,'Job descriptions',false,1,false),(4,'Find candidates',false,2,false),(4,'Interviews',false,3,false),(4,'Offers',false,4,false),
 (5,'Weekly call list',false,1,false),(5,'Sales calls',false,2,false),(5,'Managers take bookings',false,3,false),(5,'Companies, groups, government, events',false,4,false),(5,'Clubs and concierges',false,5,false),
 (6,'Visit SOPs',false,1,false),(6,'Check visits before service',false,2,false),(6,'Names for walk-ins',false,3,false),
 (7,'Look at who comes today',false,1,false),(7,'Ideas for each night',false,2,false),(7,'Promote it',false,3,false),(7,'First night',false,4,false),
 (8,'Press release',false,1,true),(8,'Aperitivo N°1 prices',false,2,true),(8,'Press and influencer invites',false,3,false),(8,'Running order and team brief',false,4,false),(8,'Aperitivo N°1 at Scala (2 Nov, 4pm–10pm)',false,5,false),(8,'Content plan',false,6,false),
 (9,'Guest list',false,1,false),(9,'Final menu',false,2,false),(9,'Videographer',false,3,false),(9,'The dinner (3 Nov, about 80 guests)',false,4,false),(9,'Follow up',false,5,false),
 (10,'Rules',false,1,false),(10,'Tracking (each promoter as a SevenRooms booking channel)',false,2,false)
) as s(num, title, is_app, sort, done)
join ap_points p on p.num = s.num
where not exists (select 1 from ap_steps x where x.point_id = p.id and x.title = s.title);

insert into ap_measures (point_id, key, label, target, source, frequency, baseline, unit, current, current_label, sort)
select p.id, m.key, m.label, m.target, m.source, m.freq, m.baseline, m.unit, m.cur, m.cur_label, m.sort
from (values
 (1,'sop_signed','Staff who signed every SOP','100%','FOH App','Weekly','0% (library opens 26 Oct)','%',null::numeric,'Arrives with the SOP library (Phase 2)',1),
 (2,'trained','Staff trained and average test score','All trained, 85% average','FOH App','Weekly','0 trained','%',null,'Arrives with training (Phase 3)',1),
 (3,'mystery','Mystery shopper score','85%','FOH App','Twice a month','None','%',null,'Arrives with the mystery shopper form (Phase 4)',1),
 (3,'google_rating','Google rating','4.7','google_reviews_daily','Daily','4.5 (2,780 reviews, 16 Oct)','rating',4.5,null,2),
 (3,'survey','Guest survey score','Set after month 1','FOH App','Weekly','None','%',null,'Arrives with the guest survey (Phase 5)',3),
 (4,null,'Roles filled','3 of 3','Manual (steps)','Weekly','0 of 3','count',0,null,1),
 (5,'walkin_share','Walk-in share of bookings','20%','SevenRooms','Weekly','38.4% of bookings · 29.8% of covers (1 Aug–15 Oct)','%',null,null,1),
 (5,'channels','Bookings by channel','Up week on week','SevenRooms','Weekly','3,433 bookings 1 Aug–15 Oct, 2,115 booked ahead','count',null,null,2),
 (6,'return90','First-time guests back within 90 days','+10 points vs baseline (17.8%)','SevenRooms','Monthly','7.8% (June first-timers: 96 of 1,236)','%',null,null,1),
 (7,'monday_guests','Monday guests','100','rev_daily (closing report)','Weekly','66 (65.7 avg, 11 Mondays 1 Aug–12 Oct)','guests',null,null,1),
 (7,'sunday_guests','Sunday guests','Up every week','rev_daily (closing report)','Weekly','44 (4 Oct) · 55 (11 Oct) — open on Sundays since October','guests',null,null,2),
 (8,'relaunch_bookings','Bookings in the 2 weeks after 2 Nov vs the 2 weeks before','Higher','SevenRooms','Once','Measured after 16 Nov','count',null,'Measured after 16 Nov',1),
 (9,null,'Catering requests within 30 days of 3 Nov','—','Manual','Once','—','count',null,'Counted 3 Nov – 3 Dec',1),
 (10,'promoter','Promoter cost vs guest spend','Spend above cost','SevenRooms + Simphony','Weekly','No promoters','text',null,'No promoter channel in SevenRooms yet',1)
) as m(num, key, label, target, source, freq, baseline, unit, cur, cur_label, sort)
join ap_points p on p.num = m.num
where not exists (select 1 from ap_measures x where x.point_id = p.id and x.label = m.label);
