-- ══════════════════════════════════════════════════════════════════════
-- Roberto's Mare — "View as" (6 Oct 2026), on top of mare-modules-schema.sql.
-- A manager can see the team app exactly as one person (or the tablet) sees
-- it, read-only, and set which modules each team / each manager can open.
--   mare_settings 'team_modules' {"Kitchen":[...], "Service":[...], ...}
--   mare_settings 'mgr_modules'  {"email@…":[...]}   (no entry = everything)
-- ══════════════════════════════════════════════════════════════════════

-- The team feed, built for one person (or for the tablet when p_me is null).
-- Internal: only the functions below call it.
create or replace function public.mare_feed_for(p_me uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := public.mare_today(); ws date; r jsonb;
begin
  ws := d - (extract(isodow from d)::int - 1);
  r := jsonb_build_object('ok', true, 'today', d, 'now', now(), 'week_start', ws,
    'briefing', (select to_jsonb(b) from public.mare_briefings b where b.date = d),
    'reads', coalesce((select jsonb_agg(staff_id) from public.mare_briefing_reads where date = d), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'team', s.team) order by s.team, s.sort, s.name)
                        from public.mare_staff s where s.active), '[]'::jsonb),
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
end $$;

-- Staff: same as before, now through the shared builder.
create or replace function public.mare_s_feed(p_device text, p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  a := public.mare_s_auth(p_device, p_token, null, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  return public.mare_feed_for((a->>'id')::uuid);
end $$;

-- Managers: the same screen as one person (p_staff) or as the tablet (null). Read-only use.
create or replace function public.mare_m_view_as(p_staff uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_staff is not null and not exists (select 1 from public.mare_staff where id = p_staff) then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  return public.mare_feed_for(p_staff) || jsonb_build_object('preview', true);
end $$;

create or replace function public.mare_m_recipe(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'recipe', (select to_jsonb(x) from public.mare_recipes x where x.id = p_id));
end $$;

-- Who can open the Mare management app (FOH logins with 'mare', or Admin).
create or replace function public.mare_m_managers() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'me', lower(auth.jwt()->>'email'), 'managers', coalesce((
    select jsonb_agg(jsonb_build_object('email', lower(u.email), 'name', coalesce(u.name, u.email), 'title', u.title, 'is_admin', u.is_admin) order by u.is_admin, u.name)
      from public.app_users u where 'mare' = any(u.modules) or u.is_admin), '[]'::jsonb));
end $$;

do $$ declare f text; begin
  foreach f in array array['mare_feed_for(uuid)','mare_m_view_as(uuid)','mare_m_recipe(uuid)','mare_m_managers()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;
grant execute on function public.mare_m_view_as(uuid) to authenticated;
grant execute on function public.mare_m_recipe(uuid) to authenticated;
grant execute on function public.mare_m_managers() to authenticated;
-- mare_s_feed keeps its existing grant (anon, authenticated).

insert into public.mare_settings(key, value) values
  ('team_modules', '{"Kitchen":["brief","check","rota","recipes","breakage","leave","speak"],"Service":["brief","check","rota","recipes","breakage","leave","speak"],"Bar":["brief","check","rota","recipes","breakage","leave","speak"],"Other":["brief","check","rota","recipes","breakage","leave","speak"]}'::jsonb),
  ('mgr_modules', '{}'::jsonb)
on conflict (key) do nothing;
