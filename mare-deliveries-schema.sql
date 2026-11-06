-- Roberto's Mare — Receive a delivery (6 Nov 2026). Additive only.
-- Milica asked (WhatsApp, 6 Nov): the person receiving goods records who received them, the supplier
-- (e.g. Mesopromet), the delivery date and the invoice total, and takes a photo of the invoice.
-- Staff record through mare_s_* (tablet code + PIN, or phone token + PIN); managers read and correct through
-- mare_m_* (mare_is_mgr). RLS on, no grants. Nothing is deleted: a wrong entry is cancelled with a reason.

create table if not exists public.mare_deliveries (
  id uuid primary key default gen_random_uuid(),
  date date not null,                                       -- delivery date
  supplier_id uuid references public.mare_suppliers(id),    -- from the Ordering supplier list, or null for "other"
  supplier_name text not null,
  invoice_no text,
  total numeric(12,2),                                      -- the invoice total
  vat text not null default 'with' check (vat in ('with','without')),   -- is the total with or without PDV
  note text,                                                -- missing or damaged goods
  photo text,                                               -- data url (jpeg) of the invoice
  staff_id uuid references public.mare_staff(id),
  received_by text,
  at timestamptz not null default now(),
  cancelled boolean not null default false, cancel_reason text,
  updated_by text, updated_at timestamptz default now()
);
create index if not exists mare_deliveries_date on public.mare_deliveries(date);
alter table public.mare_deliveries enable row level security;
revoke all on public.mare_deliveries from anon, authenticated;

-- Staff: the supplier names, and the last two weeks of deliveries (your own on a phone, everyone's on the tablet).
create or replace function public.mare_s_deliv_data(p_device text, p_token text, p_staff uuid, p_pin text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a jsonb; me uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := nullif(a->>'id','')::uuid;
  return jsonb_build_object('ok', true, 'today', public.mare_today(),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name) from public.mare_suppliers s where s.active), '[]'::jsonb),
    'deliveries', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'date', d.date, 'supplier_name', d.supplier_name, 'total', d.total, 'vat', d.vat, 'received_by', d.received_by,
                                                                'has_photo', d.photo is not null, 'cancelled', d.cancelled) order by d.at desc)
                            from public.mare_deliveries d where d.at > now() - interval '14 days' and (a->>'via' = 'tablet' or d.staff_id = me)), '[]'::jsonb));
end $$;

create or replace function public.mare_s_deliv_save(p_device text, p_token text, p_staff uuid, p_pin text, p_supplier uuid, p_supplier_name text, p_date date,
   p_total numeric, p_vat text, p_invoice_no text, p_note text, p_photo text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a jsonb; v uuid; nm text;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  v := nullif(a->>'id','')::uuid; if v is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  nm := btrim(coalesce(p_supplier_name, ''));
  if p_supplier is not null then select name into nm from public.mare_suppliers where id = p_supplier; end if;
  if length(coalesce(nm, '')) < 2 then return jsonb_build_object('ok', false, 'error', 'supplier'); end if;
  if p_total is null or p_total < 0 or p_total > 10000000 then return jsonb_build_object('ok', false, 'error', 'total'); end if;
  if p_date is null or p_date > public.mare_today() + 1 or p_date < public.mare_today() - 60 then return jsonb_build_object('ok', false, 'error', 'date'); end if;
  insert into public.mare_deliveries(date, supplier_id, supplier_name, invoice_no, total, vat, note, photo, staff_id, received_by)
  values (p_date, p_supplier, nm, nullif(btrim(coalesce(p_invoice_no,'')),''), round(p_total, 2), case when p_vat = 'without' then 'without' else 'with' end,
          nullif(btrim(coalesce(p_note,'')),''),
          case when p_photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(p_photo) < 1200000 then p_photo end,
          v, (select name from public.mare_staff where id = v));
  return jsonb_build_object('ok', true, 'name', (select name from public.mare_staff where id = v));
end $$;

-- Managers: a month (or any range) without the photos, one invoice photo on demand, add / correct / cancel.
create or replace function public.mare_m_deliv_data(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true,
    'deliveries', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'date', d.date, 'supplier_id', d.supplier_id, 'supplier_name', d.supplier_name, 'invoice_no', d.invoice_no,
                    'total', d.total, 'vat', d.vat, 'note', d.note, 'received_by', d.received_by, 'at', d.at, 'has_photo', d.photo is not null, 'cancelled', d.cancelled, 'cancel_reason', d.cancel_reason)
                    order by d.date desc, d.at desc) from public.mare_deliveries d where d.date between p_from and p_to), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name) from public.mare_suppliers s where s.active), '[]'::jsonb));
end $$;

create or replace function public.mare_m_deliv_photo(p_id uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'photo', (select photo from public.mare_deliveries where id = p_id));
end $$;

create or replace function public.mare_m_deliv_save(p_row jsonb, p_by text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r public.mare_deliveries; v_id uuid; ph text;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  v_id := nullif(p_row->>'id', '')::uuid;
  ph := case when (p_row->>'photo') ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(p_row->>'photo') < 1200000 then p_row->>'photo' end;
  if v_id is null then
    if length(btrim(coalesce(p_row->>'supplier_name',''))) < 2 then return jsonb_build_object('ok', false, 'error', 'supplier'); end if;
    insert into public.mare_deliveries(date, supplier_id, supplier_name, invoice_no, total, vat, note, photo, received_by, updated_by)
    values (coalesce(nullif(p_row->>'date','')::date, public.mare_today()), nullif(p_row->>'supplier_id','')::uuid, btrim(p_row->>'supplier_name'), nullif(btrim(coalesce(p_row->>'invoice_no','')),''),
            nullif(p_row->>'total','')::numeric, case when p_row->>'vat' = 'without' then 'without' else 'with' end, nullif(btrim(coalesce(p_row->>'note','')),''), ph,
            coalesce(nullif(p_row->>'received_by',''), p_by), p_by) returning * into r;
  else
    update public.mare_deliveries set
      date = case when p_row ? 'date' and nullif(p_row->>'date','') is not null then (p_row->>'date')::date else date end,
      supplier_name = case when p_row ? 'supplier_name' and length(btrim(coalesce(p_row->>'supplier_name',''))) >= 2 then btrim(p_row->>'supplier_name') else supplier_name end,
      supplier_id = case when p_row ? 'supplier_id' then nullif(p_row->>'supplier_id','')::uuid else supplier_id end,
      invoice_no = case when p_row ? 'invoice_no' then nullif(btrim(coalesce(p_row->>'invoice_no','')),'') else invoice_no end,
      total = case when p_row ? 'total' then nullif(p_row->>'total','')::numeric else total end,
      vat = case when p_row ? 'vat' then (case when p_row->>'vat' = 'without' then 'without' else 'with' end) else vat end,
      note = case when p_row ? 'note' then nullif(btrim(coalesce(p_row->>'note','')),'') else note end,
      photo = case when ph is not null then ph else photo end,
      cancelled = case when p_row ? 'cancelled' then (p_row->>'cancelled')::boolean else cancelled end,
      cancel_reason = case when p_row ? 'cancel_reason' then nullif(btrim(coalesce(p_row->>'cancel_reason','')),'') else cancel_reason end,
      updated_by = p_by, updated_at = now()
    where id = v_id returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'row', to_jsonb(r) - 'photo');
end $$;

revoke all on function public.mare_s_deliv_data(text,text,uuid,text), public.mare_s_deliv_save(text,text,uuid,text,uuid,text,date,numeric,text,text,text,text),
  public.mare_m_deliv_data(date,date), public.mare_m_deliv_photo(uuid), public.mare_m_deliv_save(jsonb,text) from public;
grant execute on function public.mare_s_deliv_data(text,text,uuid,text), public.mare_s_deliv_save(text,text,uuid,text,uuid,text,date,numeric,text,text,text,text),
  public.mare_m_deliv_data(date,date), public.mare_m_deliv_photo(uuid), public.mare_m_deliv_save(jsonb,text) to anon, authenticated;
