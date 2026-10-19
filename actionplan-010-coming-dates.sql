-- Roberto's 3.0 Action Plan — "coming" dates aligned to the plan's own step dates (19 Oct 2026),
-- so a card never says a figure starts before the step that builds it.
update ap_measures set available_from = 'from 28 Oct' where key = 'sop_signed';   -- step "SOPs in the app" 28 Oct
update ap_measures set available_from = 'from 2 Nov'  where key = 'trained';      -- step "Training and tests" 2 Nov
update ap_measures set available_from = 'after the first visit, 23 Nov' where key = 'mystery';   -- step "First visit" 23 Nov
update ap_measures set available_from = 'from 3 Nov'  where key = 'survey';       -- step "Guest survey" 3 Nov
