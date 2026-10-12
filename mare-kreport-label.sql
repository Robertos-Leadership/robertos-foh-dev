-- Roberto's Mare: the chefs' Send button names who really receives the closing report
-- (12 Oct 2026, Francesco: "change it"). It follows mare_settings kitchen_report_to, the list the
-- Admin page ticks. A person's display name comes from mare_settings mail_names (e.g. "Chef Andrea"),
-- else the first name on their login, else the start of the address. The old fixed
-- kitchen_report_label is no longer read.
insert into public.mare_settings(key, value)
values ('mail_names', '{"fguarracino@robertos.ae":"Chef Francesco","afalcone@robertos.ae":"Chef Andrea"}'::jsonb)
on conflict (key) do nothing;

create or replace function public.mare_kreport_to_label()
returns text language sql stable security definer set search_path to 'public' as $$
  with r as (
    select lower(e.em) as em, e.ord from public.mare_settings s, jsonb_array_elements_text(s.value) with ordinality as e(em, ord)
     where s.key = 'kitchen_report_to' and jsonb_typeof(s.value) = 'array'
  ), n as (
    select coalesce((select m.value ->> r.em from public.mare_settings m where m.key = 'mail_names'),
                    (select split_part(btrim(u.name), ' ', 1) from public.app_users u where lower(u.email) = r.em and btrim(coalesce(u.name, '')) <> ''),
                    split_part(r.em, '@', 1)) as nm, r.ord
      from r
  ), a as (select array_agg(nm order by ord) as x from n)
  select case coalesce(array_length(x, 1), 0)
           when 0 then 'the chefs'
           when 1 then x[1]
           else array_to_string(x[1:array_length(x, 1) - 1], ', ') || ' and ' || x[array_length(x, 1)]
         end
    from a;
$$;
revoke all on function public.mare_kreport_to_label() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mare_s_kreport_get(p_device text, p_token text, p_staff uuid, p_pin text, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a jsonb; d date := coalesce(p_date, public.mare_today()); me uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := (a->>'id')::uuid;
  if d < public.mare_today() - 60 or d > public.mare_today() then return jsonb_build_object('ok', false, 'error', 'range'); end if;
  return jsonb_build_object('ok', true, 'date', d, 'today', public.mare_today(),
    'send_to', public.mare_kreport_to_label(),
    'report', (select to_jsonb(k) - 'staff_id' - 'is_test' from public.mare_kreport k where k.date = d),
    'kitchen', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'on', exists (select 1 from public.mare_shifts h where h.staff_id = s.id and h.date = d and h.kind = 'work')) order by s.sort, s.name)
                         from public.mare_staff s where s.active and s.team = 'Kitchen' and s.name !~* '^zz\M'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('date', k.date, 'sent_at', k.sent_at, 'by', coalesce(k.sent_by, k.written_by), 'n', jsonb_array_length(k.entries)) order by k.date desc)
                        from (select * from public.mare_kreport where date >= public.mare_today() - 14 and (not is_test or me = staff_id) order by date desc limit 14) k), '[]'::jsonb));
end $function$;
