-- Roberto's Mare — remove ALL demo and test data before the real team starts.
-- Keeps only the checklist lines and the settings. Run once, on the go-live day,
-- after Andrea's review is closed. Irreversible: it empties every mare_ table.
begin;
delete from mare_punch_photos; delete from mare_notes; delete from mare_punches; delete from mare_pin_events; delete from mare_pin_fails;
delete from mare_briefing_reads; delete from mare_briefings; delete from mare_closing; delete from mare_check_ticks;
delete from mare_shifts; delete from mare_recipes; delete from mare_purchases; delete from mare_inv_counts; delete from mare_inv_items;
delete from mare_breakage; delete from mare_leave; delete from mare_speakup; delete from mare_actions; delete from mare_meetings;
delete from mare_devices; delete from mare_staff;
commit;
