-- Roberto's 3.0 action plan — Andrea Sacchi's changes before the plan goes to Amin (19 Oct 2026).
-- Sent by Francesco as marked-up slides. Updates only; nothing deleted.

-- Point 5: the call list becomes a monthly campaign
update ap_steps set title = 'Weekly call', how = 'Monthly campaign with offer and database to call' where id = '9249dc2b-d01d-4913-af1f-3432d821bceb';
-- Point 6: all three steps due 30 Oct
update ap_steps set due_date = '2026-10-30' where id in ('8e3cece0-473e-4029-9dbd-317c5a8bd64b', '0c4c464d-af8a-48c9-8cf8-8ceb9d8be4cd', '29028649-295e-4911-808e-a8dc8f2f93ac');
-- Point 7: look and ideas 26 Oct, promote 30 Oct (first night stays 8 Nov)
update ap_steps set due_date = '2026-10-26' where id in ('415e4313-074d-4d0f-8fdc-97c77f06f8a6', 'e3d79220-a5de-4b50-b55c-a80ad98f7992');
update ap_steps set due_date = '2026-10-30' where id = '51505fa1-2623-46f8-acdb-1bcc94893def';
-- Point 8: Mustafa joins the invites, due 30 Oct; content plan reworded
update ap_steps set owner = 'Andrea, Mustafa', due_date = '2026-10-30' where id = 'b2d4a3c8-5686-4d6d-8072-52d0d78bcc7c';
update ap_steps set how = 'Content from his visit' where id = '20c6b26c-743f-44d5-94fb-65dab6ef19cd';
-- Point 9: Mustafa joins the villa guest list; Chef Enrico does the menu; about 60 guests
update ap_steps set owner = 'Andrea, Mustafa', how = 'VIPs, partners, press' where id = 'ec90c281-8ac5-46c8-b3f1-972da4029744';
update ap_steps set how = 'Chef Enrico' where id = 'd5c25498-2cad-4028-80e5-7bc24c56a96d';
update ap_steps set title = 'The dinner (3 Nov, about 60 guests)', how = 'Tuesday 3 November, about 60 guests' where id = '0abb7395-471a-41fd-8ee3-ab5afdf6936a';

-- Same day, after Andrea's email to Amin (19 Oct 08:02): Enrico wants 40-50 guests, a seated
-- four-course dinner, 60 at most; Mustafa builds the VIP list from Roberto's clientele with Chef Leo.
update ap_steps set title = 'The dinner (3 Nov, 40–50 guests)', how = 'Seated four-course dinner, 40–50 guests, 60 at most' where id = '0abb7395-471a-41fd-8ee3-ab5afdf6936a';
update ap_steps set how = 'VIP list from Roberto''s clientele (Mustafa, with Chef Leo for catering)' where id = 'ec90c281-8ac5-46c8-b3f1-972da4029744';
update ap_steps set how = 'Chef Enrico, four courses' where id = 'd5c25498-2cad-4028-80e5-7bc24c56a96d';

-- UNDO (values read just before this ran):
-- update ap_steps set title='Weekly call list', how=null where id='9249dc2b-d01d-4913-af1f-3432d821bceb';
-- update ap_steps set due_date='2026-10-26' where id in ('8e3cece0-473e-4029-9dbd-317c5a8bd64b','0c4c464d-af8a-48c9-8cf8-8ceb9d8be4cd','29028649-295e-4911-808e-a8dc8f2f93ac');
-- update ap_steps set due_date='2026-10-21' where id in ('415e4313-074d-4d0f-8fdc-97c77f06f8a6','e3d79220-a5de-4b50-b55c-a80ad98f7992');
-- update ap_steps set due_date='2026-10-23' where id='51505fa1-2623-46f8-acdb-1bcc94893def';
-- update ap_steps set owner='Andrea', due_date='2026-10-22' where id='b2d4a3c8-5686-4d6d-8072-52d0d78bcc7c';
-- update ap_steps set how=null where id in ('20c6b26c-743f-44d5-94fb-65dab6ef19cd','ec90c281-8ac5-46c8-b3f1-972da4029744','d5c25498-2cad-4028-80e5-7bc24c56a96d');
-- update ap_steps set owner='Andrea' where id='ec90c281-8ac5-46c8-b3f1-972da4029744';
-- update ap_steps set title='The dinner (3 Nov, about 80 guests)', how=null where id='0abb7395-471a-41fd-8ee3-ab5afdf6936a';
