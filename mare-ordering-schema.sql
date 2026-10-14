-- Roberto's Mare — Ordering (14 Oct 2026). Additive only.
-- Milica asked for the kitchen and bar article lists, their suppliers and prices in the app,
-- prices updated by uploading the stock-system export ("Lager artikala"), and kitchen and bar
-- ordering from the app. Decided by Francesco the same day:
--   · an article goes in WITHOUT a supplier; Milica assigns suppliers herself later;
--   · a separate supplier page with fixed fields plus any field she adds herself;
--   · every order goes to Milica first; a per-supplier tick (admin only, off at the start)
--     lets that supplier's orders go straight out from the person who ordered;
--   · Viber, WhatsApp and email are opened on the sender's own device with the order written in;
--     the app never sends to a supplier by itself.
-- Same rules as every mare_* table: RLS on, no grants; managers go through mare_m_* (mare_is_mgr),
-- staff through mare_s_* (mare_s_auth: tablet code + PIN, or phone token + PIN).

create table if not exists public.mare_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text, phone text, viber text, whatsapp text, email text,
  order_by text check (order_by in ('viber','whatsapp','email','phone')),
  delivery_days text, cutoff text, notes text,
  extra jsonb not null default '{}'::jsonb,          -- values of the fields Milica adds (key → text)
  direct boolean not null default false,             -- orders skip Milica (admin only)
  active boolean not null default true,              -- never deleted: "No longer used"
  updated_by text, updated_at timestamptz default now()
);
create table if not exists public.mare_supplier_fields (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  kind text not null default 'text' check (kind in ('text','number','phone','email','date')),
  sort int not null default 0,
  active boolean not null default true,
  updated_by text, updated_at timestamptz default now()
);
create table if not exists public.mare_articles (
  id uuid primary key default gen_random_uuid(),
  store text not null check (store in ('kitchen','bar')),
  code text not null,                                -- Šifra in the stock system: the match key, never the name
  name text not null,                                -- as in the stock system (the upload keeps it current)
  name_me text, name_en text,                        -- optional names typed in the app; the upload never touches them
  grp text, unit text,
  pack text,                                         -- how it is bought, e.g. "box 6 x 0.7 L" (optional)
  price numeric,                                     -- average purchase price from the stock list, per unit; null = no price
  price_at date,
  supplier_id uuid references public.mare_suppliers(id),
  active boolean not null default true,              -- false = off the order list (kept for history)
  updated_by text, updated_at timestamptz default now(),
  unique (store, code)
);
create table if not exists public.mare_price_log (
  id bigserial primary key,
  article_id uuid not null references public.mare_articles(id) on delete cascade,
  old_price numeric, new_price numeric,
  source text not null default 'edit',               -- 'upload' | 'edit' | 'first load'
  at timestamptz not null default now(), by text
);
create sequence if not exists public.mare_order_no;
create table if not exists public.mare_orders (
  id uuid primary key default gen_random_uuid(),
  no bigint not null default nextval('public.mare_order_no'),
  store text not null check (store in ('kitchen','bar')),
  supplier_id uuid references public.mare_suppliers(id),   -- null = "supplier to choose"
  status text not null default 'waiting' check (status in ('waiting','direct','sent','cancelled')),
  lines jsonb not null default '[]'::jsonb,          -- [{article_id, code, name, unit, qty, price}]
  total numeric,
  note text, deliver_on date,
  staff_id uuid references public.mare_staff(id), by_name text,
  created_at timestamptz not null default now(),
  sent_at timestamptz, sent_by text, sent_via text,
  updated_by text, updated_at timestamptz default now()
);
create index if not exists mare_orders_created on public.mare_orders (created_at desc);
create index if not exists mare_articles_supplier on public.mare_articles (supplier_id);

alter table public.mare_suppliers enable row level security;
alter table public.mare_supplier_fields enable row level security;
alter table public.mare_articles enable row level security;
alter table public.mare_price_log enable row level security;
alter table public.mare_orders enable row level security;
revoke all on public.mare_suppliers, public.mare_supplier_fields, public.mare_articles, public.mare_price_log, public.mare_orders from anon, authenticated;
revoke all on sequence public.mare_order_no from anon, authenticated;

-- Every price change is kept, whoever made it (upload, a typed edit, the first load).
create or replace function public.mare_articles_price_log() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if new.price is not null then insert into public.mare_price_log(article_id, old_price, new_price, source, by) values (new.id, null, new.price, coalesce(nullif(current_setting('mare.price_source', true),''), 'edit'), new.updated_by); end if;
  elsif new.price is distinct from old.price then
    insert into public.mare_price_log(article_id, old_price, new_price, source, by) values (new.id, old.price, new.price, coalesce(nullif(current_setting('mare.price_source', true),''), 'edit'), new.updated_by);
  end if;
  return new;
end $$;
drop trigger if exists mare_articles_price_log on public.mare_articles;
create trigger mare_articles_price_log after insert or update of price on public.mare_articles for each row execute function public.mare_articles_price_log();

-- ── managers ────────────────────────────────────────────────────────────────
create or replace function public.mare_m_ord_data(p_days int default 60) returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'now', now(), 'today', public.mare_today(), 'admin', public.mare_is_admin(),
    'articles', coalesce((select jsonb_agg(to_jsonb(a) order by a.store, a.name) from public.mare_articles a), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('n_articles', (select count(*) from public.mare_articles a where a.supplier_id = s.id and a.active),
                                                                               'last_order', (select max(o.created_at) from public.mare_orders o where o.supplier_id = s.id and o.status <> 'cancelled'))
                                     order by s.active desc, s.name) from public.mare_suppliers s), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(to_jsonb(f) order by f.sort, f.label) from public.mare_supplier_fields f where f.active), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from public.mare_orders o where o.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days,60), 400)))), '[]'::jsonb));
end $$;

create or replace function public.mare_m_price_history(p_article uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return jsonb_build_object('ok', true, 'log', coalesce((select jsonb_agg(to_jsonb(l) order by l.at desc) from public.mare_price_log l where l.article_id = p_article), '[]'::jsonb));
end $$;

-- One save for the ordering tables: an existing row gets only the columns sent, a new row is inserted.
create or replace function public.mare_m_ord_save(p_table text, p_row jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb := p_row; cols text[]; sets text; ret jsonb; who text := auth.jwt()->>'email'; found_row boolean;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_table not in ('mare_suppliers','mare_supplier_fields','mare_articles','mare_orders') then return jsonb_build_object('ok', false, 'error', 'table'); end if;
  -- Only the Mare admin decides that a supplier's orders skip her.
  if p_table = 'mare_suppliers' and r ? 'direct' and not public.mare_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin only'); end if;
  if p_table = 'mare_suppliers' and r ? 'name' and length(btrim(coalesce(r->>'name',''))) < 2 then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  if p_table = 'mare_articles' and r ? 'price' and r->>'price' is not null and (r->>'price')::numeric < 0 then return jsonb_build_object('ok', false, 'error', 'price'); end if;
  if p_table = 'mare_orders' then r := r - 'no' - 'created_at' - 'staff_id' - 'by_name'; end if;
  if nullif(r->>'id','') is null then r := r || jsonb_build_object('id', gen_random_uuid()); end if;
  if p_table = 'mare_articles' and r ? 'price' then r := r || jsonb_build_object('price_at', public.mare_today()); end if;
  r := r || jsonb_build_object('updated_by', who, 'updated_at', now());
  select array_agg(c.column_name::text) into cols from information_schema.columns c where c.table_schema = 'public' and c.table_name = p_table and r ? c.column_name;
  execute format('select exists (select 1 from public.%I where id = $1)', p_table) into found_row using (r->>'id')::uuid;
  if found_row then
    select string_agg(format('%I = x.%I', c, c), ', ') into sets from unnest(cols) c where c <> 'id';
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) x where t.id = x.id returning to_jsonb(t.*)', p_table, sets, p_table) into ret using r;
  else
    if p_table = 'mare_orders' then return jsonb_build_object('ok', false, 'error', 'order'); end if;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(%I.*)', p_table,
      (select string_agg(format('%I', c), ',') from unnest(cols) c), (select string_agg(format('%I', c), ',') from unnest(cols) c), p_table, p_table) into ret using r;
  end if;
  return jsonb_build_object('ok', true, 'row', ret);
end $$;

-- Tick several articles, give them one supplier (null = no supplier).
create or replace function public.mare_m_ord_set_supplier(p_ids uuid[], p_supplier uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  update public.mare_articles set supplier_id = p_supplier, updated_by = auth.jwt()->>'email', updated_at = now() where id = any(p_ids);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- A manager places an order herself (same split by supplier as the team's).
create or replace function public.mare_ord_create(p_store text, p_lines jsonb, p_note text, p_deliver date, p_staff uuid, p_by text, p_from_mgr boolean) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare l jsonb; a record; grp jsonb := '{}'::jsonb; k text; made jsonb := '[]'::jsonb; o record; sj jsonb; sdirect boolean; q numeric; tot numeric;
begin
  if p_store not in ('kitchen','bar') then return jsonb_build_object('ok', false, 'error', 'store'); end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
  if jsonb_array_length(p_lines) > 200 then return jsonb_build_object('ok', false, 'error', 'too many lines'); end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := nullif(l->>'qty','')::numeric;
    if q is null or q <= 0 or q > 100000 then continue; end if;
    select * into a from public.mare_articles where id = (l->>'id')::uuid and active;
    if not found then continue; end if;
    k := coalesce(a.supplier_id::text, 'none');
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
end $$;
revoke all on function public.mare_ord_create(text, jsonb, text, date, uuid, text, boolean) from public, anon, authenticated;

create or replace function public.mare_m_ord_create(p_store text, p_lines jsonb, p_note text, p_deliver date) returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  return public.mare_ord_create(p_store, p_lines, p_note, p_deliver, null,
    coalesce((select nullif(u.name,'') from public.app_users u where lower(u.email) = lower(auth.jwt()->>'email') limit 1), auth.jwt()->>'email'), true);
end $$;

-- Upload of the stock list. p_apply false = only say what would change; true = do it.
-- Rows: [{code, name, grp, unit, price}]. Matching is on (store, code) only.
create or replace function public.mare_m_ord_upload(p_store text, p_rows jsonb, p_apply boolean, p_retire boolean default false) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare x jsonb; a record; nw jsonb := '[]'::jsonb; ch jsonb := '[]'::jsonb; same int := 0; seen text[] := '{}'; gone jsonb; pr numeric; who text := auth.jwt()->>'email'; nm jsonb := '[]'::jsonb;
begin
  if not public.mare_is_mgr() then return jsonb_build_object('ok', false, 'error', 'access'); end if;
  if p_store not in ('kitchen','bar') then return jsonb_build_object('ok', false, 'error', 'store'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
  perform set_config('mare.price_source', 'upload', true);
  for x in select * from jsonb_array_elements(p_rows) loop
    if nullif(btrim(x->>'code'),'') is null or nullif(btrim(x->>'name'),'') is null then continue; end if;
    if btrim(x->>'code') = any(seen) then continue; end if;
    seen := seen || btrim(x->>'code');
    pr := nullif(nullif(x->>'price','')::numeric, 0);
    select * into a from public.mare_articles where store = p_store and code = btrim(x->>'code');
    if not found then
      nw := nw || jsonb_build_array(jsonb_build_object('code', btrim(x->>'code'), 'name', btrim(x->>'name'), 'unit', x->>'unit', 'price', pr));
      if p_apply then insert into public.mare_articles(store, code, name, grp, unit, price, price_at, updated_by) values (p_store, btrim(x->>'code'), btrim(x->>'name'), nullif(btrim(x->>'grp'),''), nullif(btrim(x->>'unit'),''), pr, public.mare_today(), who); end if;
    else
      if a.price is distinct from pr then
        ch := ch || jsonb_build_array(jsonb_build_object('code', a.code, 'name', a.name, 'unit', a.unit, 'old', a.price, 'new', pr));
      else same := same + 1; end if;
      if a.name is distinct from btrim(x->>'name') then nm := nm || jsonb_build_array(jsonb_build_object('code', a.code, 'old', a.name, 'new', btrim(x->>'name'))); end if;
      if p_apply then
        update public.mare_articles set name = btrim(x->>'name'), grp = coalesce(nullif(btrim(x->>'grp'),''), grp), unit = coalesce(nullif(btrim(x->>'unit'),''), unit),
               price = pr, price_at = case when price is distinct from pr then public.mare_today() else price_at end, active = true, updated_by = who, updated_at = now()
         where id = a.id and (name is distinct from btrim(x->>'name') or price is distinct from pr or not active
                              or grp is distinct from coalesce(nullif(btrim(x->>'grp'),''), grp) or unit is distinct from coalesce(nullif(btrim(x->>'unit'),''), unit));
      end if;
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name) order by name), '[]'::jsonb) into gone from public.mare_articles where store = p_store and active and not (code = any(seen));
  if p_apply and p_retire then update public.mare_articles set active = false, updated_by = who, updated_at = now() where store = p_store and active and not (code = any(seen)); end if;
  return jsonb_build_object('ok', true, 'applied', p_apply, 'new', nw, 'changed', ch, 'renamed', nm, 'same', same, 'gone', gone);
end $$;

-- ── staff (tablet or own phone) ─────────────────────────────────────────────
create or replace function public.mare_s_ord_data(p_device text, p_token text, p_staff uuid, p_pin text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a jsonb; me uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := nullif(a->>'id','')::uuid;
  return jsonb_build_object('ok', true, 'today', public.mare_today(),
    'my_team', (select team from public.mare_staff where id = me),
    'articles', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'store', x.store, 'code', x.code, 'name', x.name, 'name_me', x.name_me, 'name_en', x.name_en,
                                                              'grp', x.grp, 'unit', x.unit, 'pack', x.pack, 'price', x.price, 'supplier_id', x.supplier_id) order by x.name)
                          from public.mare_articles x where x.active), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'direct', s.direct, 'delivery_days', s.delivery_days, 'cutoff', s.cutoff)) from public.mare_suppliers s where s.active), '[]'::jsonb),
    -- the last two weeks: on a phone only your own orders, on the tablet everyone's
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'no', o.no, 'store', o.store, 'status', o.status, 'total', o.total, 'lines', o.lines, 'created_at', o.created_at,
                                                            'by_name', o.by_name, 'sent_at', o.sent_at, 'supplier', (select s.name from public.mare_suppliers s where s.id = o.supplier_id)) order by o.created_at desc)
                        from public.mare_orders o where o.created_at > now() - interval '14 days' and (a->>'via' = 'tablet' or o.staff_id = me)), '[]'::jsonb));
end $$;

create or replace function public.mare_s_ord_send(p_device text, p_token text, p_staff uuid, p_pin text, p_store text, p_lines jsonb, p_note text, p_deliver date) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a jsonb; me uuid;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := nullif(a->>'id','')::uuid; if me is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  return public.mare_ord_create(p_store, p_lines, p_note, p_deliver, me, (select name from public.mare_staff where id = me), false);
end $$;

-- A "direct" order: the person who ordered opened Viber / WhatsApp / email and says it went.
create or replace function public.mare_s_ord_mark(p_device text, p_token text, p_staff uuid, p_pin text, p_id uuid, p_via text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a jsonb; me uuid; n int;
begin
  a := public.mare_s_auth(p_device, p_token, p_staff, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  me := nullif(a->>'id','')::uuid; if me is null then return jsonb_build_object('ok', false, 'error', 'staff'); end if;
  update public.mare_orders set status = 'sent', sent_at = now(), sent_by = (select name from public.mare_staff where id = me), sent_via = left(p_via, 20), updated_at = now()
   where id = p_id and status = 'direct' and staff_id = me;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;

revoke all on function public.mare_m_ord_data(int), public.mare_m_price_history(uuid), public.mare_m_ord_save(text, jsonb), public.mare_m_ord_set_supplier(uuid[], uuid),
  public.mare_m_ord_create(text, jsonb, text, date), public.mare_m_ord_upload(text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.mare_m_ord_data(int), public.mare_m_price_history(uuid), public.mare_m_ord_save(text, jsonb), public.mare_m_ord_set_supplier(uuid[], uuid),
  public.mare_m_ord_create(text, jsonb, text, date), public.mare_m_ord_upload(text, jsonb, boolean, boolean) to authenticated;
revoke all on function public.mare_s_ord_data(text, text, uuid, text), public.mare_s_ord_send(text, text, uuid, text, text, jsonb, text, date), public.mare_s_ord_mark(text, text, uuid, text, uuid, text) from public;
grant execute on function public.mare_s_ord_data(text, text, uuid, text), public.mare_s_ord_send(text, text, uuid, text, text, jsonb, text, date), public.mare_s_ord_mark(text, text, uuid, text, uuid, text) to anon, authenticated;
revoke all on function public.mare_articles_price_log() from public, anon, authenticated;

-- The four fields every supplier page starts with besides the fixed ones are NOT seeded:
-- Milica adds her own (Francesco: "whatever she wants").
