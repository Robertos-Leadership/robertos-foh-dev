-- Roberto's Mare: test people (name starting ZZ) are hidden from every manager screen, and from
-- the team's own lists unless you ARE that test person (12 Oct 2026, Francesco: "yes hide them").
-- Their phone links keep working. Generated from the live definitions.

CREATE OR REPLACE FUNCTION public.mare_mgr_overview(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a timestamptz; b timestamptz;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  a := (p_from::timestamp - interval '1 day') at time zone 'Europe/Podgorica';
  b := (p_to::timestamp + interval '2 days') at time zone 'Europe/Podgorica';
  return jsonb_build_object('ok', true, 'now', now(),
    'me', (select coalesce(name, email) from public.app_users where lower(email) = lower(auth.jwt()->>'email') limit 1),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'team', s.team, 'active', s.active, 'has_pin', s.pin_hash is not null,
        'pin_set_at', s.pin_set_at, 'contract_hours', s.contract_hours, 'start_times', s.start_times,
        'phone_token', s.phone_token, 'sort', s.sort) order by s.team, s.sort, s.name)
      from public.mare_staff s where s.name !~* '^zz'), '[]'::jsonb),
    'punches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'staff_id', p.staff_id, 'dir', p.dir, 'at', p.at, 'source', p.source, 'offline', p.offline,
        'entered_by', p.entered_by, 'reason', p.reason, 'voided', p.voided, 'void_reason', p.void_reason,
        'has_photo', exists (select 1 from public.mare_punch_photos f where f.punch_id = p.id)) order by p.at)
      from public.mare_punches p where p.at >= a and p.at < b), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.at desc)
      from public.mare_notes n where n.at > now() - interval '120 days'), '[]'::jsonb),
    'pin_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc)
      from public.mare_pin_events e where e.at > now() - interval '60 days'), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'active', d.active,
        'created_at', d.created_at, 'last_seen', d.last_seen) order by d.created_at)
      from public.mare_devices d), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.mare_m_fetch(p_tables text[], p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text; q text; v jsonb; r jsonb := '{}'::jsonb;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  foreach t in array p_tables loop
    q := case t
      when 'shifts'      then 'select * from mare_shifts where date between $1 and $2'
      when 'briefings'   then 'select * from mare_briefings where date between $1 and $2'
      when 'reads'       then 'select * from mare_briefing_reads where date between $1 and $2'
      when 'closing'     then 'select * from mare_closing where date between $1 and $2'
      when 'check_items' then 'select * from mare_check_items order by list, sort, text'
      when 'ticks'       then 'select id, date, item_id, staff_id, at, photo is not null as has_photo from mare_check_ticks where date between $1 and $2'
      when 'recipes'     then 'select id, name, category, portions, ingredients, method, plating, allergens, active, updated_by, updated_at, photo is not null as has_photo from mare_recipes order by category, name'
      when 'purchases'   then 'select * from mare_purchases where date between $1 and $2 order by date, updated_at'
      when 'inv_items'   then 'select * from mare_inv_items order by category, sort, name'
      when 'inv_counts'  then 'select * from mare_inv_counts where month between date_trunc(''month'',$1)::date - interval ''1 month'' and $2'
      when 'breakage'    then 'select id, date, at, kind, item, qty, reason, cost, staff_id, reported_by, reviewed, review_note, photo is not null as has_photo from mare_breakage where date between $1 and $2 order by at desc'
      when 'leave'       then 'select * from mare_leave where (date_to >= $1 and date_from <= $2) or status = ''pending'' or date_to >= date_trunc(''year'', $2)::date order by date_from'
      when 'speakup'     then 'select * from mare_speakup where at > now() - interval ''400 days'' order by at desc'
      when 'meetings'    then 'select * from mare_meetings order by date desc limit 60'
      when 'actions'     then 'select * from mare_actions where not done or done_at > now() - interval ''90 days'' order by done, due nulls last'
      when 'settings'    then 'select * from mare_settings'
      when 'staff'       then 'select id, name, team, active, role, annual_days, contract_hours, start_times, sort from mare_staff where name !~* ''^zz'' order by team, sort, name'
      else null end;
    if q is null then continue; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (%s) x', q) into v using p_from, p_to;
    r := r || jsonb_build_object(t, v);
  end loop;
  return jsonb_build_object('ok', true, 'now', now(), 'today', public.mare_today()) || r;
end $function$;

CREATE OR REPLACE FUNCTION public.mare_s_rota(p_device text, p_token text, p_staff uuid, p_pin text, p_ws date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a jsonb; me uuid; ws date := coalesce(p_ws, date_trunc('week', public.mare_today())::date);
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid;
  ws := date_trunc('week', ws)::date;
  if ws < public.mare_today() - 120 or ws > public.mare_today() + 120 then return jsonb_build_object('ok', false, 'error', 'range'); end if;
  return jsonb_build_object('ok', true, 'week_start', ws, 'today', public.mare_today(), 'now', now(),
    'can_rota', coalesce((select can_rota from public.mare_staff where id = me), false),
    'my_team', (select team from public.mare_staff where id = me),
    'editors', coalesce((select jsonb_agg(name order by sort, name) from public.mare_staff where active and can_rota), '[]'::jsonb),
    'kitchen_min', coalesce((select (value #>> '{}')::int from public.mare_settings where key = 'kitchen_min'), 3),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'team', s.team, 'role', s.role) order by s.team, s.sort, s.name)
                       from public.mare_staff s where s.active and (s.name !~* '^zz' or s.id = me)), '[]'::jsonb),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('staff_id', h.staff_id, 'date', h.date, 'kind', h.kind, 'start_t', h.start_t, 'end_t', h.end_t,
                                                            'start2_t', h.start2_t, 'end2_t', h.end2_t, 'note', h.note))
                        from public.mare_shifts h join public.mare_staff s on s.id = h.staff_id and s.active
                        where h.date between ws and ws + 6), '[]'::jsonb),
    'punches', coalesce((select jsonb_agg(jsonb_build_object('staff_id', p.staff_id, 'dir', p.dir, 'at', p.at) order by p.at)
                         from public.mare_punches p join public.mare_staff s on s.id = p.staff_id and s.active
                         where not p.voided and p.at >= (ws::timestamp at time zone 'Europe/Podgorica') - interval '1 day'
                           and p.at < ((ws + 8)::timestamp at time zone 'Europe/Podgorica')), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.mare_feed_for(p_me uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d date := public.mare_today(); ws date; r jsonb;
begin
  ws := d - (extract(isodow from d)::int - 1);
  r := jsonb_build_object('ok', true, 'today', d, 'now', now(), 'week_start', ws,
    'briefing', (select to_jsonb(b) from public.mare_briefings b where b.date = d),
    'briefing_media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'name', m.name, 'mime', m.mime, 'size', m.size, 'seconds', m.seconds) order by m.created_at)
                        from public.mare_media m where m.owner_kind = 'briefing' and m.owner_key = d::text and not m.removed), '[]'::jsonb),
    'reads', coalesce((select jsonb_agg(staff_id) from public.mare_briefing_reads where date = d), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'team', s.team) order by s.team, s.sort, s.name)
                        from public.mare_staff s where s.active and (s.name !~* '^zz' or s.id = p_me)), '[]'::jsonb),
    'board', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'team', s.team, 'has_pin', s.pin_hash is not null,
                          'in', coalesce(l.dir = 'in' and now() - l.at < interval '16 hours', false),
                          'since', case when l.dir = 'in' and now() - l.at < interval '16 hours' then l.at end) order by s.team, s.sort, s.name)
                        from public.mare_staff s
                        left join lateral (select dir, at from public.mare_punches p where p.staff_id = s.id and not p.voided and p.at <= now()
                                           order by p.at desc limit 1) l on true
                        where s.active), '[]'::jsonb),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('staff_id', h.staff_id, 'date', h.date, 'kind', h.kind, 'start_t', h.start_t, 'end_t', h.end_t, 'note', h.note))
                        from public.mare_shifts h join public.mare_staff s on s.id = h.staff_id and s.active
                        where h.date between ws and ws + 13), '[]'::jsonb),
    'check_items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'list', i.list, 'text', i.text, 'text_me', i.text_me, 'needs_photo', i.needs_photo) order by i.list, i.sort, i.text)
                        from public.mare_check_items i where i.active), '[]'::jsonb),
    'deadlines', (select value from public.mare_settings where key = 'check_deadlines'),
    'team_modules', (select value from public.mare_settings where key = 'team_modules'),
    'ticks', coalesce((select jsonb_agg(jsonb_build_object('item_id', t.item_id, 'at', t.at, 'name', s.name, 'has_photo', t.photo is not null))
                        from public.mare_check_ticks t left join public.mare_staff s on s.id = t.staff_id where t.date = d), '[]'::jsonb),
    'recipes', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'category', x.category) order by x.category, x.name)
                        from public.mare_recipes x where x.active), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('text', c.text, 'owner', c.owner, 'due', c.due) order by c.due nulls last)
                        from public.mare_actions c where not c.done), '[]'::jsonb));
  r := r || jsonb_build_object('punches', coalesce((select jsonb_agg(jsonb_build_object('staff_id', p.staff_id, 'dir', p.dir, 'at', p.at) order by p.at)
                        from public.mare_punches p join public.mare_staff s on s.id = p.staff_id and s.active
                        where not p.voided and p.at <= now() and p.at >= ((ws - 1)::timestamp at time zone 'Europe/Podgorica')), '[]'::jsonb));
  if p_me is not null then
    r := r || jsonb_build_object('me', jsonb_build_object(
      'id', p_me, 'name', (select name from public.mare_staff where id = p_me), 'team', (select team from public.mare_staff where id = p_me),
      'annual_days', (select annual_days from public.mare_staff where id = p_me),
      'punches', coalesce((select jsonb_agg(jsonb_build_object('dir', p.dir, 'at', p.at, 'source', p.source) order by p.at)
                  from public.mare_punches p where p.staff_id = p_me and not p.voided and p.at > now() - interval '16 days'), '[]'::jsonb),
      'leave', coalesce((select jsonb_agg(to_jsonb(l) order by l.date_from desc) from public.mare_leave l
                  where l.staff_id = p_me and l.date_to >= date_trunc('year', d)::date), '[]'::jsonb)));
  end if;
  return r;
end $function$;

