-- Mare kitchen closing report: test reports also reach every recipient (9 Oct 2026)
CREATE OR REPLACE FUNCTION public.mare_s_kreport_save(p_device text, p_token text, p_staff uuid, p_pin text, p_date date, p_entries jsonb, p_chefs text[], p_feedback text, p_rating integer, p_guests integer, p_revenue numeric, p_send boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a jsonb; me uuid; nm text; tm text; d date := coalesce(p_date, public.mare_today()); ents jsonb; v_to text[]; mail bigint; test boolean; was timestamptz;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid; if me is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  select name, team into nm, tm from public.mare_staff where id = me;
  if tm <> 'Kitchen' then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if d < public.mare_today() - 7 or d > public.mare_today() then return jsonb_build_object('ok', false, 'error', 'range'); end if;
  -- keep only well-formed entries, trimmed
  select coalesce(jsonb_agg(jsonb_build_object('type', e->>'type', 'category', left(coalesce(e->>'category',''),40),
            'item', nullif(left(btrim(coalesce(e->>'item','')),120),''), 'detail', nullif(left(btrim(coalesce(e->>'detail','')),600),''),
            'action', nullif(left(btrim(coalesce(e->>'action','')),600),''))), '[]'::jsonb)
    into ents from jsonb_array_elements(case when jsonb_typeof(p_entries) = 'array' then p_entries else '[]'::jsonb end) e
   where e->>'type' in ('complaint','unavailable','operation','team');
  if jsonb_array_length(ents) > 60 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  if p_guests is not null and (p_guests < 0 or p_guests > 5000) then return jsonb_build_object('ok', false, 'error', 'guests'); end if;
  if p_revenue is not null and (p_revenue < 0 or p_revenue > 1000000) then return jsonb_build_object('ok', false, 'error', 'revenue'); end if;
  if coalesce(p_send, false) and (p_guests is null or p_revenue is null) then return jsonb_build_object('ok', false, 'error', 'figures'); end if;
  test := nm ~* '^zz\M' or coalesce(p_feedback,'') ~* '^\s*zz';
  select sent_at into was from public.mare_kreport where date = d;
  insert into public.mare_kreport(date, entries, chefs_on, feedback, rating, guests, revenue, written_by, staff_id, updated_at, is_test)
  values (d, ents, coalesce((select array_agg(left(x,60)) from unnest(coalesce(p_chefs,'{}')) x where btrim(x) <> ''), '{}'),
          nullif(left(btrim(coalesce(p_feedback,'')),4000),''), case when p_rating between 1 and 5 then p_rating end, p_guests, round(p_revenue, 2), nm, me, now(), test)
  on conflict (date) do update set entries = excluded.entries, chefs_on = excluded.chefs_on, feedback = excluded.feedback, rating = excluded.rating, guests = excluded.guests, revenue = excluded.revenue,
    written_by = excluded.written_by, staff_id = excluded.staff_id, updated_at = now(), is_test = excluded.is_test;
  if coalesce(p_send, false) then
    -- 9 Oct 2026: a test report (ZZ preview chef) reaches every recipient too, marked [TEST], so the chefs
    -- checking the preview see exactly what the team's reports look like.
    select coalesce(array_agg(x), '{}') into v_to from jsonb_array_elements_text(coalesce((select value from public.mare_settings where key = 'kitchen_report_to'), '[]'::jsonb)) x;
    if coalesce(cardinality(v_to), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'no_recipient', 'saved', true); end if;
    update public.mare_kreport set sent_at = now(), sent_by = nm, sent_count = sent_count + 1 where date = d;
    insert into public.mare_kreport_mail(date, to_list, is_test, resend) values (d, v_to, test, was is not null) returning id into mail;
    perform public.mare_kreport_kick(mail);
    return jsonb_build_object('ok', true, 'sent', true, 'mail', mail);
  end if;
  return jsonb_build_object('ok', true, 'sent', false);
end $function$
;
