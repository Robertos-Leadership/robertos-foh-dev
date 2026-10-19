-- Roberto's 3.0 action plan — point 3 becomes ONE audit (19 Oct 2026, Francesco).
-- The mystery shopper audit uses the same form as Chef Enrico's audit (Kitchen App,
-- live 15 Oct). The same link goes to the outside agency, to Ops and to Amin.
-- Enrico's audit on 2 Nov is the first score. The guest survey is dropped.
-- Additive only: one step added, one step reworded, the survey measure HIDDEN.

update ap_points set title = 'Mystery shopper audit',
  goal = 'One audit, the same as Chef Enrico''s. The agency, Ops and Amin use the same link, so every visit gets one score.'
where num = 3;

insert into ap_steps (point_id, title, how, owner, due_date, is_app, sort)
select p.id, 'Enrico''s audit', 'Chef Enrico scores the visit on 2 Nov: the first score on the list', 'Francesco', '2026-11-02', true, 1
from ap_points p where p.num = 3 and not exists (select 1 from ap_steps s where s.point_id = p.id and s.title = 'Enrico''s audit');

update ap_steps set title = 'Audit link, same as Enrico''s', how = 'One form and one score for the agency, Ops and Amin', sort = 2
where id = '77c0e704-cdb6-4b4f-96b3-e1ff8084995c';          -- was "Mystery shopper form", Andrea, 1 Nov
update ap_steps set sort = 3 where id = '85bf6c8c-cb45-4ec8-8607-712c32b20a7c';   -- Appoint a company, Justin, 9 Nov
update ap_steps set how = 'Then twice a month', sort = 4 where id = '13526811-8f69-4f4d-9c84-d49094a3d76e';   -- First visit, 23 Nov
update ap_steps set title = 'Ops and Amin use the same link', how = 'GM and managers, and Amin when he visits', owner = 'Ouafaa', is_app = false, sort = 5
where id = '281afbb5-d4b4-407b-9f44-e4c3b60f8f8f';          -- was "Guest survey", Francesco, 3 Nov

update ap_measures set label = 'Audit score', short_label = 'Audit score', source = 'Audit link (agency, Ops, Amin)', frequency = 'Every audit',
  available_from = 'from Enrico''s audit, 2 Nov', current_label = 'Arrives with the audit link (Phase 4)'
where key = 'mystery';
update ap_measures set hidden = true where key = 'survey';

-- UNDO (values read just before this ran):
-- update ap_points set title='Mystery shopper and guest survey', goal='Bring both back, so we know what guests really see.' where num=3;
-- update ap_steps set title='Mystery shopper form', how=null, sort=2 where id='77c0e704-cdb6-4b4f-96b3-e1ff8084995c';
-- update ap_steps set sort=1 where id='85bf6c8c-cb45-4ec8-8607-712c32b20a7c';
-- update ap_steps set how=null, sort=3 where id='13526811-8f69-4f4d-9c84-d49094a3d76e';
-- update ap_steps set title='Guest survey', how=null, owner='Francesco', is_app=true, sort=4 where id='281afbb5-d4b4-407b-9f44-e4c3b60f8f8f';
-- update ap_measures set label='Mystery shopper score', short_label='Mystery shopper', source='FOH App', frequency='Twice a month',
--   available_from='after the first visit, 23 Nov', current_label='Arrives with the mystery shopper form (Phase 4)' where key='mystery';
-- update ap_measures set hidden=false where key='survey';
-- The added step "Enrico's audit" stays (no deletes on production without Francesco's OK).
