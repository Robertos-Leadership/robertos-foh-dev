-- Roberto's 3.0 action plan — date check (19 Oct 2026): SOP sign-off cannot start before Amin approves the SOPs (30 Oct).
update ap_measures set available_from = 'from 30 Oct, after Amin approves', baseline = '0% (staff sign from 30 Oct, after Amin approves)' where key = 'sop_signed';
-- UNDO: update ap_measures set available_from = 'from 28 Oct', baseline = '0% (library opens 26 Oct)' where key = 'sop_signed';
