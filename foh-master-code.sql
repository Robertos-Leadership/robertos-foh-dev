-- FOH master code (30 Sep 2026). A personal code that opens and edits everything.
-- Stored HASHED, in a table nobody can read from the app (RLS on, no policies).
-- The app only ever asks foh_master_check(code) -> the person's name, or null.
create table if not exists public.master_codes (
  name text not null,
  code_hash text primary key,
  created_at timestamptz not null default now()
);
alter table public.master_codes enable row level security;
revoke all on public.master_codes from anon, authenticated;

create or replace function public.foh_master_name(p_code text)
returns text language sql stable security definer set search_path = public as $$
  select m.name from master_codes m
   where m.code_hash = encode(sha256(convert_to('robertos-master:' || btrim(coalesce(p_code,'')), 'utf8')), 'hex')
   limit 1;
$$;
create or replace function public.foh_master_check(p_code text)
returns text language sql stable security definer set search_path = public as $$
  select public.foh_master_name(p_code);
$$;
revoke all on function public.foh_master_name(text) from public, anon, authenticated;
grant execute on function public.foh_master_check(text) to anon, authenticated;

-- The schedule lock also honours the master code.
create or replace function public.foh_sched_editor_name(p_emp text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    public.foh_master_name(p_emp),
    case
      when btrim(coalesce(p_emp,'')) = '' then null
      when btrim(p_emp) = '1212' then 'Admin'
      else (select s.name from foh_staff s
             where s.emp_id = btrim(p_emp) and s.active = true
               and lower(btrim(coalesce(s.section,''))) = 'management'
             limit 1)
    end);
$$;
