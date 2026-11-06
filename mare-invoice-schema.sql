-- Roberto's Mare — read the invoice photo into lines (6 Nov 2026). Additive only.
-- Francesco: the system turns the invoice photo into lines (item, quantity, unit, price) for the Excel,
-- only when someone presses the button, and once checked the prices update the Ordering prices.
-- The reading itself is done by the edge function mare-invoice-read; it writes NOTHING. A manager saves the lines
-- here, corrects them, ticks "checked", and only then can the prices be applied (each line linked to an
-- article by the person, with the old and new price shown). Nothing is deleted: a removed line is marked.

alter table public.mare_deliveries add column if not exists read_status text check (read_status in ('read','checked'));
alter table public.mare_deliveries add column if not exists read_at timestamptz;
alter table public.mare_deliveries add column if not exists read_note text;          -- what the reader could not read
alter table public.mare_deliveries add column if not exists inv_total_read numeric(14,2);   -- the total printed on the invoice, as read
alter table public.mare_deliveries add column if not exists checked_by text;
alter table public.mare_deliveries add column if not exists checked_at timestamptz;

create table if not exists public.mare_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.mare_deliveries(id),
  sort int not null default 0,
  code text, name text not null, unit text,
  qty numeric, unit_price numeric, discount_pct numeric, vat_pct numeric, line_total numeric,
  article_id uuid references public.mare_articles(id),     -- linked by a person; the price goes there
  price_applied_at timestamptz,
  removed boolean not null default false,
  updated_by text, updated_at timestamptz default now()
);
create index if not exists mare_delivery_lines_d on public.mare_delivery_lines(delivery_id);
alter table public.mare_delivery_lines enable row level security;
revoke all on public.mare_delivery_lines from anon, authenticated;

create or replace function public.mare_m_deliv_lines(p_delivery uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true,
    'status', (select read_status from public.mare_deliveries where id = p_delivery),
    'note', (select read_note from public.mare_deliveries where id = p_delivery),
    'inv_total', (select inv_total_read from public.mare_deliveries where id = p_delivery),
    'lines', coalesce((select jsonb_agg(to_jsonb(l) - 'delivery_id' order by l.sort) from public.mare_delivery_lines l where l.delivery_id = p_delivery and not l.removed), '[]'::jsonb));
end $$;

-- Replace the lines of one delivery with what the screen sends: lines with an id are updated, lines without are added,
-- and lines no longer sent are marked removed (never deleted).
create or replace function public.mare_m_deliv_lines_save(p_delivery uuid, p_lines jsonb, p_status text, p_note text, p_inv_total numeric, p_by text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare x jsonb; i int := 0; keep uuid[] := '{}'; lid uuid;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if not exists (select 1 from public.mare_deliveries where id = p_delivery) then return jsonb_build_object('ok', false, 'error', 'delivery'); end if;
  if jsonb_typeof(p_lines) <> 'array' then return jsonb_build_object('ok', false, 'error', 'lines'); end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if length(btrim(coalesce(x->>'name',''))) < 1 then continue; end if;
    lid := nullif(x->>'id','')::uuid;
    if lid is not null and exists (select 1 from public.mare_delivery_lines where id = lid and delivery_id = p_delivery) then
      update public.mare_delivery_lines set sort = i, code = nullif(btrim(coalesce(x->>'code','')),''), name = btrim(x->>'name'), unit = nullif(btrim(coalesce(x->>'unit','')),''),
        qty = nullif(x->>'qty','')::numeric, unit_price = nullif(x->>'unit_price','')::numeric, discount_pct = nullif(x->>'discount_pct','')::numeric, vat_pct = nullif(x->>'vat_pct','')::numeric,
        line_total = nullif(x->>'line_total','')::numeric, article_id = nullif(x->>'article_id','')::uuid, removed = false, updated_by = p_by, updated_at = now() where id = lid;
    else
      insert into public.mare_delivery_lines(delivery_id, sort, code, name, unit, qty, unit_price, discount_pct, vat_pct, line_total, article_id, updated_by)
      values (p_delivery, i, nullif(btrim(coalesce(x->>'code','')),''), btrim(x->>'name'), nullif(btrim(coalesce(x->>'unit','')),''), nullif(x->>'qty','')::numeric, nullif(x->>'unit_price','')::numeric,
              nullif(x->>'discount_pct','')::numeric, nullif(x->>'vat_pct','')::numeric, nullif(x->>'line_total','')::numeric, nullif(x->>'article_id','')::uuid, p_by) returning id into lid;
    end if;
    keep := keep || lid;
  end loop;
  update public.mare_delivery_lines set removed = true, updated_by = p_by, updated_at = now() where delivery_id = p_delivery and not removed and not (id = any(keep));
  update public.mare_deliveries set
    read_status = case when p_status in ('read','checked') then p_status else read_status end,
    read_at = case when p_status = 'read' then now() else read_at end,
    read_note = case when p_note is not null then nullif(btrim(p_note),'') else read_note end,
    inv_total_read = coalesce(p_inv_total, inv_total_read),
    checked_by = case when p_status = 'checked' then p_by else checked_by end,
    checked_at = case when p_status = 'checked' then now() else checked_at end,
    updated_by = p_by, updated_at = now()
  where id = p_delivery;
  return jsonb_build_object('ok', true);
end $$;

-- Put the invoice prices into Ordering. Only for a delivery whose lines are CHECKED, only the lines the person ticked,
-- and each change lands in the price history with the invoice as its source.
create or replace function public.mare_m_deliv_apply_prices(p_delivery uuid, p_items jsonb, p_by text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare x jsonb; n int := 0; d record; pr numeric; aid uuid;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  select * into d from public.mare_deliveries where id = p_delivery;
  if not found or d.read_status is distinct from 'checked' then return jsonb_build_object('ok', false, 'error', 'not_checked'); end if;
  perform set_config('mare.price_source', 'invoice ' || d.date::text || ' ' || left(d.supplier_name, 40), true);
  for x in select * from jsonb_array_elements(p_items) loop
    pr := nullif(x->>'price','')::numeric; aid := nullif(x->>'article_id','')::uuid;
    if pr is null or pr <= 0 or aid is null then continue; end if;
    if not exists (select 1 from public.mare_delivery_lines where id = nullif(x->>'line_id','')::uuid and delivery_id = p_delivery and not removed) then continue; end if;
    update public.mare_articles set price = pr, price_at = public.mare_today(), updated_by = p_by, updated_at = now() where id = aid;
    update public.mare_delivery_lines set article_id = aid, price_applied_at = now(), updated_by = p_by, updated_at = now() where id = nullif(x->>'line_id','')::uuid;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'applied', n);
end $$;

-- All lines of a period, for the Excel second sheet.
create or replace function public.mare_m_deliv_lines_period(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'lines', coalesce((select jsonb_agg(jsonb_build_object('date', d.date, 'supplier', d.supplier_name, 'invoice_no', d.invoice_no, 'status', d.read_status,
      'code', l.code, 'name', l.name, 'unit', l.unit, 'qty', l.qty, 'unit_price', l.unit_price, 'discount_pct', l.discount_pct, 'vat_pct', l.vat_pct, 'line_total', l.line_total,
      'article', (select a.code || ' ' || a.name from public.mare_articles a where a.id = l.article_id)) order by d.date, d.at, l.sort)
    from public.mare_delivery_lines l join public.mare_deliveries d on d.id = l.delivery_id where d.date between p_from and p_to and not d.cancelled and not l.removed), '[]'::jsonb));
end $$;

revoke all on function public.mare_m_deliv_lines(uuid), public.mare_m_deliv_lines_save(uuid, jsonb, text, text, numeric, text), public.mare_m_deliv_apply_prices(uuid, jsonb, text), public.mare_m_deliv_lines_period(date, date) from public;
grant execute on function public.mare_m_deliv_lines(uuid), public.mare_m_deliv_lines_save(uuid, jsonb, text, text, numeric, text), public.mare_m_deliv_apply_prices(uuid, jsonb, text), public.mare_m_deliv_lines_period(date, date) to anon, authenticated;
