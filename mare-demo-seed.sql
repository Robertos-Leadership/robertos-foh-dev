-- ══════════════════════════════════════════════════════════════════════
-- Roberto's Mare — DEMO data for Andrea's review (6 Oct 2026).
-- Every person is named "(demo)" and every code is 1234. All money and
-- covers are invented demo figures, marked DEMO where there is a note field.
-- Run mare-demo-clear.sql before the real team starts: it empties all of it.
-- ══════════════════════════════════════════════════════════════════════
begin;

-- 1. Empty everything built up during testing (checklist lines and settings stay).
delete from mare_punch_photos; delete from mare_notes; delete from mare_punches; delete from mare_pin_events; delete from mare_pin_fails;
delete from mare_briefing_reads; delete from mare_briefings; delete from mare_closing; delete from mare_check_ticks;
delete from mare_shifts; delete from mare_recipes; delete from mare_purchases; delete from mare_inv_counts; delete from mare_inv_items;
delete from mare_breakage; delete from mare_leave; delete from mare_speakup; delete from mare_actions; delete from mare_meetings;
delete from mare_devices; delete from mare_staff;
delete from mare_check_items where text like 'TEST%';

-- 2. The demo team.
insert into mare_staff(name, team, role, contract_hours, start_times, pin_hash, pin_set_at, sort, created_by) values
 ('Rahul (demo)',  'Kitchen', 'Head chef (demo)', 40, '{"1":"10:00","2":"10:00","3":"10:00","4":"10:00","5":"10:00","6":"10:00"}', extensions.crypt('1234', extensions.gen_salt('bf')), now(), 1, 'demo'),
 ('Arjun (demo)',  'Kitchen', 'Cook (demo)',      40, '{"1":"15:00","2":"15:00","3":"15:00","4":"15:00","6":"15:00","7":"15:00"}', extensions.crypt('1234', extensions.gen_salt('bf')), now(), 2, 'demo'),
 ('Petar (demo)',  'Kitchen', 'Commis (demo)',    40, '{"1":"10:00","2":"10:00","4":"10:00","5":"10:00","6":"10:00","7":"10:00"}', extensions.crypt('1234', extensions.gen_salt('bf')), now(), 3, 'demo'),
 ('Ana (demo)',    'Service', 'Head waiter (demo)', 40, '{"1":"11:30","2":"11:30","3":"11:30","5":"11:30","6":"11:30","7":"11:30"}', extensions.crypt('1234', extensions.gen_salt('bf')), now(), 1, 'demo'),
 ('Jelena (demo)', 'Service', 'Waiter (demo)',    40, '{"1":"17:00","3":"17:00","4":"17:00","5":"17:00","6":"17:00","7":"17:00"}', extensions.crypt('1234', extensions.gen_salt('bf')), now(), 2, 'demo'),
 ('Nikola (demo)', 'Service', 'Waiter (demo)',    40, '{"2":"11:30","3":"11:30","4":"11:30","5":"11:30","6":"11:30","7":"11:30"}', extensions.crypt('1234', extensions.gen_salt('bf')), now(), 3, 'demo'),
 ('Luka (demo)',   'Bar',     'Bartender (demo)', 40, '{"1":"17:00","2":"17:00","3":"17:00","4":"17:00","5":"17:00","6":"17:00"}', extensions.crypt('1234', extensions.gen_salt('bf')), now(), 1, 'demo'),
 ('Ivana (demo)',  'Bar',     'Bartender (demo)', 40, '{"1":"11:30","3":"11:30","4":"11:30","5":"11:30","6":"11:30","7":"11:30"}', extensions.crypt('1234', extensions.gen_salt('bf')), now(), 2, 'demo');

-- 3. Rota: last week, this week and next week, from each person's usual days.
--    Shift = start → start + 8 h (lunch people) or → 23:30 (17:00 starts). Others OFF.
insert into mare_shifts(staff_id, date, kind, start_t, end_t, updated_by)
select s.id, d::date,
       case when s.start_times ? extract(isodow from d)::text then 'work' else 'off' end,
       s.start_times->>extract(isodow from d)::text,
       case when s.start_times ? extract(isodow from d)::text then
         case when s.start_times->>extract(isodow from d)::text >= '15:00' then '23:30'
              else to_char((s.start_times->>extract(isodow from d)::text)::time + interval '8 hours', 'HH24:MI') end end,
       'demo'
from mare_staff s, generate_series(date '2026-09-28', date '2026-10-18', interval '1 day') d;

-- 4. Clock-ins for every worked day 28 Sep → 5 Oct, a few minutes either side,
--    with a late arrival and a forgotten clock-out to show "Needs you".
insert into mare_punches(staff_id, dir, at, source)
select h.staff_id, x.dir,
       ((h.date + (case x.dir when 'in' then h.start_t else h.end_t end)::time)::timestamp
         + make_interval(mins => (case x.dir when 'in' then -((abs(hashtext(h.staff_id::text || h.date::text)) % 9))
                                               else (abs(hashtext(h.date::text || h.staff_id::text)) % 14) end))
         + case when x.dir = 'out' and h.end_t < h.start_t then interval '1 day' else interval '0' end) at time zone 'Europe/Podgorica',
       'tablet'
from mare_shifts h cross join (values ('in'), ('out')) x(dir)
where h.kind = 'work' and h.date between '2026-09-28' and '2026-10-05';
-- Ana was late on Monday 5 Oct…
update mare_punches set at = at + interval '25 minutes'
 where dir = 'in' and staff_id = (select id from mare_staff where name = 'Ana (demo)') and (at at time zone 'Europe/Podgorica')::date = '2026-10-05';
-- …and Jelena forgot to clock out on Sunday 4 Oct.
delete from mare_punches where dir = 'out' and staff_id = (select id from mare_staff where name = 'Jelena (demo)') and (at at time zone 'Europe/Podgorica')::date in ('2026-10-04','2026-10-05');
-- Today: the morning kitchen is in.
insert into mare_punches(staff_id, dir, at, source)
select id, 'in', ('2026-10-06 09:5' || sort || ':00')::timestamp at time zone 'Europe/Podgorica', 'tablet' from mare_staff where name in ('Rahul (demo)', 'Petar (demo)');
-- Petar's code was reset once (shows on Attendance → Codes).
insert into mare_pin_events(staff_id, kind, by, at) select id, 'reset', 'milica (demo)', now() - interval '2 days' from mare_staff where name = 'Petar (demo)';

-- 5. Today's briefing, read by the morning kitchen.
insert into mare_briefings(date, covers_lunch, covers_dinner, message, specials, eighty_six, allergies, vip, kitchen_note, foh_note, updated_by)
values ('2026-10-06', 18, 42, 'DEMO briefing. Business lunch on the terrace from 12:00 — two courses €19.',
        'Grilled sea bream, caught this morning. Risotto with mussels.', 'Tiramisù (back tomorrow).',
        'Table 12: coeliac guest — gluten-free pasta only.', 'Group of 10 at 20:30, Porto Montenegro marina office.',
        'Lamb shank to be portioned before 12:00.', 'Push the sea bream; terrace heaters on from 19:00.', 'demo');
insert into mare_briefing_reads(date, staff_id, at)
select '2026-10-06', id, now() - interval '20 minutes' from mare_staff where name in ('Rahul (demo)', 'Petar (demo)');

-- 6. Closing reports 28 Sep → 5 Oct (DEMO figures).
insert into mare_closing(date, covers_lunch, covers_dinner, food, beverage, other, card, cash, tips, comps, discounts, weather, notes, updated_by)
select d::date, l, n, f, b, 0, round((f + b) * 0.82, 2), (f + b) - round((f + b) * 0.82, 2), round((f + b) * 0.05, 2), 35, 20,
       case when extract(dow from d) in (0, 6) then 'Sunny' else 'Cloudy' end, 'DEMO figures', 'demo'
from (select d, 10 + (abs(hashtext(d::text)) % 25) l, 25 + (abs(hashtext('n' || d::text)) % 40) n,
             round(900 + (abs(hashtext('f' || d::text)) % 1400)::numeric, 2) f, round(400 + (abs(hashtext('b' || d::text)) % 800)::numeric, 2) b
      from generate_series(date '2026-09-28', date '2026-10-05', interval '1 day') d) z;
-- one day where card + cash do not match the sales
update mare_closing set cash = cash - 15, incidents = 'DEMO: cash 15 € short, recounted next morning' where date = '2026-10-03';

-- 7. Purchases October (DEMO suppliers).
insert into mare_purchases(date, supplier, category, amount, invoice_no, updated_by) values
 ('2026-10-01', 'Demo fish market', 'food', 412.80, 'D-1001', 'demo'),
 ('2026-10-01', 'Demo wine merchant', 'beverage', 520.00, 'W-77', 'demo'),
 ('2026-10-02', 'Demo vegetables', 'food', 138.40, 'V-310', 'demo'),
 ('2026-10-03', 'Demo meat supplier', 'food', 365.20, 'M-58', 'demo'),
 ('2026-10-05', 'Demo fish market', 'food', 298.60, 'D-1014', 'demo'),
 ('2026-10-05', 'Demo cleaning supplies', 'other', 74.90, 'C-12', 'demo');

-- 8. Stock items with a September count.
insert into mare_inv_items(name, category, unit, unit_cost, sort, updated_by) values
 ('Spaghetti (demo)', 'food', 'kg', 2.40, 1, 'demo'), ('Olive oil (demo)', 'food', 'l', 9.80, 2, 'demo'),
 ('Parmigiano (demo)', 'food', 'kg', 21.50, 3, 'demo'), ('Prosecco (demo)', 'beverage', 'bottle', 7.90, 1, 'demo'),
 ('House red (demo)', 'beverage', 'bottle', 6.20, 2, 'demo'), ('Gin (demo)', 'beverage', 'bottle', 18.00, 3, 'demo');
insert into mare_inv_counts(month, item_id, qty, unit_cost, updated_by)
select '2026-09-01', id, (array[14, 9, 6, 36, 48, 7])[sort + case when category = 'beverage' then 3 else 0 end], unit_cost, 'demo' from mare_inv_items;

-- 9. Breakage and waste.
insert into mare_breakage(date, at, kind, item, qty, reason, cost, staff_id, reported_by, reviewed)
select '2026-10-04', now() - interval '2 days', 'breakage', 'Wine glass', 2, 'Dropped while polishing', 9.00, id, name, true from mare_staff where name = 'Luka (demo)';
insert into mare_breakage(date, at, kind, item, qty, reason, staff_id, reported_by, reviewed)
select '2026-10-05', now() - interval '1 day', 'wastage', 'Sea bream', 1.5, 'Over-ordered for a quiet Sunday', id, name, false from mare_staff where name = 'Rahul (demo)';

-- 10. Leave: one waiting, one approved (already in the rota).
insert into mare_leave(staff_id, date_from, date_to, kind, note, status, created_via)
select id, '2026-11-02', '2026-11-06', 'annual', 'Family visit (demo)', 'pending', 'phone' from mare_staff where name = 'Arjun (demo)';
insert into mare_leave(staff_id, date_from, date_to, kind, note, status, decided_by, decided_at, created_via)
select id, '2026-10-14', '2026-10-15', 'annual', 'Wedding (demo)', 'approved', 'milica (demo)', now() - interval '3 days', 'tablet' from mare_staff where name = 'Luka (demo)';
update mare_shifts set kind = 'leave', start_t = null, end_t = null, note = 'annual'
 where staff_id = (select id from mare_staff where name = 'Luka (demo)') and date between '2026-10-14' and '2026-10-15';

-- 11. Speak up (anonymous).
insert into mare_speakup(kind, text, at) values
 ('idea', 'DEMO: could we have staff meal at 16:30 instead of 17:00? The dinner team arrives hungry.', now() - interval '1 day'),
 ('problem', 'DEMO: the terrace heaters on the left side do not work, guests complain after 21:00.', now() - interval '5 hours');

-- 12. Weekly meeting with actions.
with m as (insert into mare_meetings(date, title, attendees, notes, updated_by)
           values ('2026-10-05', 'Weekly meeting', 'Milica, Rahul, Ana, Luka (demo)',
                   'DEMO notes. Business lunch launched today, half the terrace full. Winter rota from 13 Oct. Heaters to be checked. New wine list in November.', 'demo')
           returning id)
insert into mare_actions(meeting_id, text, owner, due, done, done_at, updated_by)
select m.id, a.t, a.o, a.d::date, a.done, case when a.done then now() end, 'demo' from m,
 (values ('Call the technician about the terrace heaters', 'Milica', '2026-10-05', false),
         ('Winter rota ready for 13 Oct', 'Milica', '2026-10-10', false),
         ('Business lunch menu printed in English and Montenegrin', 'Ana (demo)', '2026-10-03', true)) a(t, o, d, done);

-- 13. Two Mare recipes.
insert into mare_recipes(category, name, portions, ingredients, method, plating, allergens, updated_by) values
 ('Pasta', 'Spaghetti carbonara (demo)', '1 portion',
  E'120 g spaghetti\n40 g guanciale\n2 egg yolks\n25 g pecorino romano\nBlack pepper',
  E'1. Render the guanciale slowly until crisp; keep the fat.\n2. Whisk yolks with pecorino and pepper.\n3. Cook the spaghetti 1 minute short; finish in the pan with the fat and a little pasta water.\n4. Off the heat, add the egg mix and toss until creamy — never let it scramble.',
  'Warm bowl, nest the pasta, guanciale on top, pecorino and pepper to finish.', 'Gluten, egg, milk', 'demo'),
 ('Starters', 'Beef tartare (demo)', '1 portion',
  E'120 g beef fillet, fresh (never defrosted)\n1 tsp shallot, fine brunoise\n1 tsp capers\nDijon, olive oil, salt, pepper',
  E'1. Cut the beef by hand into 3 mm dice — no mincer.\n2. Dress just before service: mustard, oil, shallot, capers, seasoning.\n3. Taste every portion.',
  'Ring mould in the centre, quenelle of mustard, toasted bread on the side.', 'Mustard, gluten (bread)', 'demo');

-- 14. Today's checklists: opening kitchen mostly done.
insert into mare_check_ticks(date, item_id, staff_id, at)
select '2026-10-06', i.id, s.id, now() - interval '50 minutes'
from mare_check_items i, mare_staff s where i.list = 'open_kitchen' and i.sort in (1, 3) and s.name = 'Rahul (demo)';

-- 15. A late arrival already accepted, for the People → Notes history.
insert into mare_notes(staff_id, kind, ref_date, text, by)
select id, 'late_accepted', '2026-09-30', 'DEMO: bus was late, called ahead', 'milica (demo)' from mare_staff where name = 'Ana (demo)';

commit;
