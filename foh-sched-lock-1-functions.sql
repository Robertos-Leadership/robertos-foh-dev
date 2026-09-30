-- FOH schedule lock — STEP 1 of 2: ADDITIVE ONLY (30 Sep 2026)
-- Adds the checked write path for foh_roster. Changes NO existing policy, so the live
-- app keeps working exactly as before until step 2 is run.
--
-- Who may edit the schedule: an ACTIVE foh_staff row in section 'Management' whose emp_id
-- matches, or the Admin code 1212 (same super-user code the app already uses).
-- Managers are read from foh_staff, never copied — add a manager's emp_id in Admin and
-- they can edit; remove them and they cannot.

create or replace function public.foh_sched_editor_name(p_emp text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when btrim(coalesce(p_emp,'')) = '' then null
    when btrim(p_emp) = '1212' then 'Admin'
    else (select s.name from foh_staff s
           where s.emp_id = btrim(p_emp) and s.active = true
             and lower(btrim(coalesce(s.section,''))) = 'management'
           limit 1)
  end;
$$;

-- Returns the manager's name, or null. The app calls this to unlock the schedule.
create or replace function public.foh_sched_check(p_emp text)
returns text language sql stable security definer set search_path = public as $$
  select public.foh_sched_editor_name(p_emp);
$$;

-- Upsert shift rows. Only the keys present in each row are written (same as a PostgREST
-- upsert), and only real foh_roster columns. p_overwrite=false skips days that already exist.
create or replace function public.foh_roster_upsert(p_emp text, p_rows jsonb, p_overwrite boolean default true)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r jsonb; k text; cols text[]; sets text[]; n integer := 0;
  valid text[] := array(select column_name::text from information_schema.columns
                         where table_schema='public' and table_name='foh_roster'
                           and column_name not in ('id','created_at'));
begin
  if public.foh_sched_editor_name(p_emp) is null then
    raise exception 'Only a manager can edit the schedule' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows must be an array'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if not (r ? 'staff_id' and r ? 'work_date') then raise exception 'row needs staff_id and work_date'; end if;
    cols := array[]::text[]; sets := array[]::text[];
    for k in select jsonb_object_keys(r) loop
      if k = any(valid) then
        cols := cols || quote_ident(k);
        if k not in ('staff_id','work_date') then sets := sets || format('%I = excluded.%I', k, k); end if;
      end if;
    end loop;
    execute format(
      'insert into foh_roster (%s) select %s from jsonb_populate_record(null::foh_roster, $1) on conflict (staff_id, work_date) %s',
      array_to_string(cols, ','), array_to_string(cols, ','),
      case when p_overwrite and array_length(sets,1) > 0 then 'do update set ' || array_to_string(sets, ',') else 'do nothing' end
    ) using r;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Delete shift rows. Every filter is optional but AT LEAST ONE is required, so this can never
-- become an unbounded "delete everything". p_after is strictly-after (work_date > p_after).
create or replace function public.foh_roster_delete(p_emp text, p_staff_ids uuid[] default null,
  p_from date default null, p_to date default null, p_after date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if public.foh_sched_editor_name(p_emp) is null then
    raise exception 'Only a manager can edit the schedule' using errcode = '42501';
  end if;
  if p_staff_ids is null and p_from is null and p_to is null and p_after is null then
    raise exception 'delete needs at least one filter';
  end if;
  delete from foh_roster
   where (p_staff_ids is null or staff_id = any(p_staff_ids))
     and (p_from  is null or work_date >= p_from)
     and (p_to    is null or work_date <= p_to)
     and (p_after is null or work_date >  p_after);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.foh_sched_editor_name(text) from public, anon, authenticated;
grant execute on function public.foh_sched_check(text) to anon, authenticated;
grant execute on function public.foh_roster_upsert(text, jsonb, boolean) to anon, authenticated;
grant execute on function public.foh_roster_delete(text, uuid[], date, date, date) to anon, authenticated;
