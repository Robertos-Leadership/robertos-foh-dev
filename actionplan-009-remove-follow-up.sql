-- Roberto's 3.0 Action Plan — step "Follow up" (point 9) removed at Francesco's request (19 Oct 2026):
-- "that task isn't clear, remove it". The row had no comments.
delete from ap_steps where id = '31fd3084-829f-40f7-b02c-d278d0a8d7c6' and title = 'Follow up';

-- To restore it exactly as it was:
-- insert into ap_steps (id, point_id, title, owner, due_date, is_app, sort)
-- select '31fd3084-829f-40f7-b02c-d278d0a8d7c6', p.id, 'Follow up', 'Francesco', '2026-10-27', false, 5
-- from ap_points p where p.num = 9;
