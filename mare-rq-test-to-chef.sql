-- Mare recipe questions: test questions also reach the chef (9 Oct 2026, Andrea's preview got no email)
CREATE OR REPLACE FUNCTION public.mare_s_rq_ask(p_device text, p_token text, p_staff uuid, p_pin text, p_kind text, p_recipe text, p_name text, p_q uuid, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a jsonb; v uuid; nm text; q public.mare_rq; mid bigint; v_to text[]; mail bigint; t text := btrim(coalesce(p_text,''));
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  v := (a->>'id')::uuid; if v is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  if length(t) < 3 then return jsonb_build_object('ok', false, 'error', 'text'); end if;
  if (select count(*) from public.mare_rq_msgs where at > now() - interval '1 day' and not from_chef) >= 60 then
    return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  select name into nm from public.mare_staff where id = v;
  if p_q is null then
    if p_kind not in ('mare','dubai','batch') or length(btrim(coalesce(p_recipe,''))) = 0 or length(btrim(coalesce(p_name,''))) = 0 then
      return jsonb_build_object('ok', false, 'error', 'recipe'); end if;
    insert into public.mare_rq(recipe_kind, recipe_id, recipe_name, staff_id, staff_name, is_test)
    values (p_kind, left(btrim(p_recipe),80), left(btrim(p_name),200), v, nm, t ~* '^zz' or nm ~* '^zz') returning * into q;
  else
    select * into q from public.mare_rq where id = p_q;
    if q.id is null then return jsonb_build_object('ok', false, 'error', 'thread'); end if;
    update public.mare_rq set last_at = now(), answered = false where id = q.id;
  end if;
  insert into public.mare_rq_msgs(q_id, from_chef, author, text) values (q.id, false, nm, left(t, 2000)) returning id into mid;
  -- 9 Oct 2026: a test question (ZZ preview chefs) goes to the chef AND Francesco, marked [TEST], so the
  -- chef sees exactly what a real question looks like during the preview.
  if q.is_test then select array_agg(distinct x) into v_to from (
      select lower(x) x from jsonb_array_elements_text(coalesce((select value from public.mare_settings where key = 'recipe_question_to'), '[]'::jsonb)) x
      union select 'fguarracino@robertos.ae') z;
  else select array_agg(lower(x)) into v_to from jsonb_array_elements_text(coalesce((select value from public.mare_settings where key = 'recipe_question_to'), '[]'::jsonb)) x;
  end if;
  if v_to is not null and cardinality(v_to) > 0 then
    insert into public.mare_rq_mail(q_id, msg_id, to_list, is_test) values (q.id, mid, v_to, q.is_test) returning id into mail;
    perform public.mare_rq_kick(mail);
  end if;
  return jsonb_build_object('ok', true, 'thread', public.mare_rq_json(q.id), 'mailed', coalesce(cardinality(v_to), 0) > 0);
end $function$

;
