-- Roberto's 3.0 Action Plan — short labels for the dashboard cards (18 Oct 2026). Additive.
-- short_label: the few words a card shows ("SOP sign-off"); available_from: when a
-- figure that does not exist yet starts ("26 Oct"). Kept as data so the page
-- never carries a copy of a date that can change.
alter table ap_measures add column if not exists short_label text;
alter table ap_measures add column if not exists available_from text;
update ap_measures set short_label = 'SOP sign-off',            available_from = 'from 26 Oct'   where key = 'sop_signed';
update ap_measures set short_label = 'Training & tests',        available_from = 'from 30 Oct'   where key = 'trained';
update ap_measures set short_label = 'Mystery shopper',         available_from = 'from 9 Nov'    where key = 'mystery';
update ap_measures set short_label = 'Guest survey',            available_from = 'from 15 Nov'   where key = 'survey';
update ap_measures set short_label = 'Relaunch bookings',       available_from = 'after 16 Nov'  where key = 'relaunch_bookings';
update ap_measures set short_label = 'Promoter cost vs spend',  available_from = 'when used'     where key = 'promoter';
update ap_measures set short_label = 'Bookings by channel',     available_from = 'when the CRM is linked' where key = 'channels';
update ap_measures set short_label = 'Walk-in share (bookings)' where key = 'walkin_share';
update ap_measures set short_label = 'covers'                    where key = 'walkin_covers';
update ap_measures set short_label = 'Came a 2nd time'           where key = 'visits3';
update ap_measures set short_label = 'Monday guests (last 4 avg)' where key = 'monday_guests';
update ap_measures set short_label = 'Sunday'                    where key = 'sunday_guests';
update ap_measures set short_label = 'Roles filled'              where label = 'Roles filled';
update ap_measures set short_label = 'Catering requests'         where label like 'Catering requests%';
notify pgrst, 'reload schema';
