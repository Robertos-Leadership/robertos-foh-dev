-- Roberto's Mare — several suppliers per article (21 Oct 2026).
-- Milica: "for most products we have 2 or 3 suppliers … depends on availability, delivery".
-- supplier_ids is the list; supplier_id stays and is ALWAYS supplier_ids[1] (the usual one),
-- so the team app and mare_ord_create keep working unchanged. A trigger keeps the two in step,
-- also for a page still running the old code that only writes supplier_id. Additive only.

alter table public.mare_articles add column if not exists supplier_ids uuid[] not null default '{}';
update public.mare_articles set supplier_ids = array[supplier_id] where supplier_id is not null and supplier_ids = '{}';

create or replace function public.mare_articles_sup_sync() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(cardinality(new.supplier_ids), 0) = 0 and new.supplier_id is not null then new.supplier_ids := array[new.supplier_id];
    else new.supplier_id := new.supplier_ids[1]; end if;
  elsif new.supplier_ids is distinct from old.supplier_ids then
    new.supplier_id := new.supplier_ids[1];
  elsif new.supplier_id is distinct from old.supplier_id then
    -- old page: "set supplier" makes it the usual one, keeps the others
    new.supplier_ids := case when new.supplier_id is null then '{}'::uuid[] else array[new.supplier_id] || array_remove(old.supplier_ids, new.supplier_id) end;
  end if;
  new.supplier_ids := coalesce(new.supplier_ids, '{}');
  return new;
end $$;
drop trigger if exists mare_articles_sup_sync on public.mare_articles;
create trigger mare_articles_sup_sync before insert or update on public.mare_articles for each row execute function public.mare_articles_sup_sync();

-- Bulk: p_mode 'set' (old behaviour, the default for cached pages), 'add', 'remove'.
drop function if exists public.mare_m_ord_set_supplier(uuid[], uuid);
create or replace function public.mare_m_ord_set_supplier(p_ids uuid[], p_supplier uuid, p_mode text default 'set')
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_mode = 'add' then
    if p_supplier is null then return jsonb_build_object('ok', false, 'error', 'supplier'); end if;
    update public.mare_articles set supplier_ids = supplier_ids || p_supplier, updated_by = auth.jwt()->>'email', updated_at = now()
     where id = any(p_ids) and not (p_supplier = any(supplier_ids));
  elsif p_mode = 'remove' then
    if p_supplier is null then
      update public.mare_articles set supplier_ids = '{}', updated_by = auth.jwt()->>'email', updated_at = now() where id = any(p_ids) and supplier_ids <> '{}';
    else
      update public.mare_articles set supplier_ids = array_remove(supplier_ids, p_supplier), updated_by = auth.jwt()->>'email', updated_at = now()
       where id = any(p_ids) and p_supplier = any(supplier_ids);
    end if;
  else
    update public.mare_articles set supplier_ids = case when p_supplier is null then '{}'::uuid[] else array[p_supplier] end,
           updated_by = auth.jwt()->>'email', updated_at = now() where id = any(p_ids);
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'n', n);
end $$;
revoke all on function public.mare_m_ord_set_supplier(uuid[], uuid, text) from public, anon;
grant execute on function public.mare_m_ord_set_supplier(uuid[], uuid, text) to authenticated;

-- A supplier's article count = articles that list it, not only those where it is the usual one.
create or replace function public.mare_m_ord_data(p_days integer default 60)
returns jsonb language plpgsql security definer set search_path = public as $function$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'now', now(), 'today', public.mare_today(), 'admin', public.mare_is_admin(),
    'articles', coalesce((select jsonb_agg(to_jsonb(a) order by a.store, a.name) from public.mare_articles a), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('n_articles', (select count(*) from public.mare_articles a where s.id = any(a.supplier_ids) and a.active),
                                                                               'last_order', (select max(o.created_at) from public.mare_orders o where o.supplier_id = s.id and o.status <> 'cancelled'))
                                     order by s.active desc, s.name) from public.mare_suppliers s), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(to_jsonb(f) order by f.sort, f.label) from public.mare_supplier_fields f where f.active), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from public.mare_orders o where o.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days,60), 400)))), '[]'::jsonb));
end $function$;

-- Ordering: a line may name one of the article's own suppliers ('sup'); otherwise the usual one.
CREATE OR REPLACE FUNCTION public.mare_ord_create(p_store text, p_lines jsonb, p_note text, p_deliver date, p_staff uuid, p_by text, p_from_mgr boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare l jsonb; a record; grp jsonb := '{}'::jsonb; k text; made jsonb := '[]'::jsonb; o record; sj jsonb; sdirect boolean; q numeric; tot numeric; ls uuid;
begin
  if p_store not in ('kitchen','bar') then return jsonb_build_object('ok', false, 'error', 'store'); end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
  if jsonb_array_length(p_lines) > 200 then return jsonb_build_object('ok', false, 'error', 'too many lines'); end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := nullif(l->>'qty','')::numeric;
    if q is null or q <= 0 or q > 100000 then continue; end if;
    select * into a from public.mare_articles where id = (l->>'id')::uuid and active;
    if not found then continue; end if;
    ls := case when nullif(l->>'sup','') is not null and (l->>'sup')::uuid = any(a.supplier_ids) then (l->>'sup')::uuid else a.supplier_id end;
    k := coalesce(ls::text, 'none');
    grp := jsonb_set(grp, array[k], coalesce(grp->k, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'article_id', a.id, 'code', a.code, 'name', a.name, 'name_en', a.name_en, 'name_me', a.name_me, 'unit', a.unit, 'qty', q, 'price', a.price)));
  end loop;
  if grp = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
  for k in select jsonb_object_keys(grp) loop
    select coalesce(sum((x->>'qty')::numeric * (x->>'price')::numeric), 0) into tot from jsonb_array_elements(grp->k) x where x->>'price' is not null;
    sj := null; sdirect := false;
    if k <> 'none' then
      select jsonb_build_object('id', s.id, 'name', s.name, 'order_by', s.order_by, 'viber', s.viber, 'whatsapp', s.whatsapp, 'email', s.email, 'phone', s.phone), s.direct
        into sj, sdirect from public.mare_suppliers s where s.id = k::uuid;
    end if;
    insert into public.mare_orders(store, supplier_id, status, lines, total, note, deliver_on, staff_id, by_name, updated_by)
    values (p_store, case when k = 'none' then null else k::uuid end,
            case when not p_from_mgr and k <> 'none' and coalesce(sdirect, false) then 'direct' else 'waiting' end,
            grp->k, round(tot, 2), nullif(btrim(coalesce(p_note,'')),''), p_deliver, p_staff, p_by, p_by)
    returning * into o;
    made := made || jsonb_build_array(to_jsonb(o) || jsonb_build_object('supplier', sj));
  end loop;
  return jsonb_build_object('ok', true, 'orders', made);
end $function$;

-- Team app gets the list too (not used yet; keeps the shape ready).
CREATE OR REPLACE FUNCTION public.mare_s_ord_data(p_device text, p_token text, p_staff uuid, p_pin text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare a jsonb; me uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := nullif(a->>'id','')::uuid;
  return jsonb_build_object('ok', true, 'today', public.mare_today(),
    'my_team', (select team from public.mare_staff where id = me),
    'articles', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'store', x.store, 'code', x.code, 'name', x.name, 'name_me', x.name_me, 'name_en', x.name_en,
                                                              'grp', x.grp, 'unit', x.unit, 'pack', x.pack, 'price', x.price, 'supplier_id', x.supplier_id, 'supplier_ids', x.supplier_ids) order by x.name)
                          from public.mare_articles x where x.active), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'direct', s.direct, 'delivery_days', s.delivery_days, 'cutoff', s.cutoff)) from public.mare_suppliers s where s.active), '[]'::jsonb),
    -- the last two weeks: on a phone only your own orders, on the tablet everyone's
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'no', o.no, 'store', o.store, 'status', o.status, 'total', o.total, 'lines', o.lines, 'created_at', o.created_at,
                                                            'by_name', o.by_name, 'sent_at', o.sent_at, 'supplier', (select s.name from public.mare_suppliers s where s.id = o.supplier_id)) order by o.created_at desc)
                        from public.mare_orders o where o.created_at > now() - interval '14 days' and (a->>'via' = 'tablet' or o.staff_id = me)), '[]'::jsonb));
end $function$;

-- Several contacts per supplier (they work in shifts). The fixed contact/phone/viber/whatsapp/email
-- stay as the first contact; more go here as [{name, when, phone, viber, whatsapp, email}].
alter table public.mare_suppliers add column if not exists contacts jsonb not null default '[]'::jsonb;
