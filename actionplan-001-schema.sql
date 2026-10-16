-- ════════════════════════════════════════════════════════════════════════
-- Roberto's 3.0 Action Plan — Phase 1 schema (FOH project paoaivwtkzujmrgrfjuq)
-- 16 Oct 2026. ADDITIVE ONLY: new ap_* tables, functions, policies. Nothing
-- existing is altered or removed. Safe to re-run (if not exists / or replace).
--
-- WHO CAN SEE IT: exactly the emails in ap_settings.members (Francesco, Ouafaa,
-- Amin, Justin). Enforced here with RLS — hiding the tile is not the lock.
-- Anyone else signed in reads zero rows and the screen says "No access".
-- WHO CAN APPROVE: ap_settings.approver (Amin) — proposed changes and the week.
-- WHO CAN CHANGE SETTINGS (recipients, members): an app Admin (fn_is_app_admin).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists ap_settings (
  id int primary key default 1 check (id = 1),
  members text[] not null default array['fguarracino@robertos.ae','onafid@robertos.ae','akadrie@skelmore.com','justin@skelmore.com'],
  approver text not null default 'akadrie@skelmore.com',
  -- The Wednesday email goes ONLY here. Testing: Francesco only. He switches it to Amin.
  recipients text[] not null default array['fguarracino@robertos.ae'],
  relaunch_date date not null default '2026-11-02',
  plan_start date not null default '2026-10-19',
  updated_at timestamptz default now()
);
insert into ap_settings (id) values (1) on conflict (id) do nothing;

-- Scheduler secret: no policies at all, so only the service role (the edge
-- function) can read it. The pg_cron job presents it as x-cron-secret.
create table if not exists ap_cron (id int primary key default 1 check (id = 1), secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
insert into ap_cron (id) values (1) on conflict (id) do nothing;

create table if not exists ap_points (
  id uuid primary key default gen_random_uuid(),
  num int not null unique,
  title text not null,
  goal text,
  "group" text not null,          -- Standards | People | Business growth | Relaunch
  sort int not null default 0,
  created_at timestamptz default now()
);

create table if not exists ap_steps (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references ap_points(id) on delete cascade,
  title text not null,
  how text,
  owner text,                      -- free name (Andrea and Francesco fill these in)
  due_date date,
  done_at timestamptz,
  done_by text,                    -- set by trigger from the signed-in email
  is_app boolean not null default false,
  sort int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists ap_steps_point on ap_steps(point_id, sort);

create table if not exists ap_measures (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references ap_points(id) on delete cascade,
  key text unique,                 -- feed id the ap-weekly function fills (null = manual)
  label text not null,
  source text,
  frequency text,
  baseline text,
  target text,
  unit text,                       -- % | guests | rating | count | text
  current numeric,
  current_label text,              -- what to print when current is null ("No data", "Arrives with the SOP library")
  detail jsonb,
  sort int not null default 0,
  updated_at timestamptz
);

-- Weekly snapshots: the email and the history read the SAME stored numbers.
create table if not exists ap_snapshots (
  id uuid primary key default gen_random_uuid(),
  measure_id uuid not null references ap_measures(id) on delete cascade,
  week_start date not null,        -- Monday of the week measured (Dubai)
  value numeric,
  label text,
  detail jsonb,
  recorded_at timestamptz default now(),
  unique (measure_id, week_start)
);

-- Weekly results log: what worked or didn't, per point per week (people write it).
create table if not exists ap_results (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references ap_points(id) on delete cascade,
  week_start date not null,
  note text not null,
  author_email text,
  created_at timestamptz default now()
);

create table if not exists ap_comments (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references ap_points(id) on delete cascade,
  step_id uuid references ap_steps(id) on delete set null,
  author_email text,
  body text not null,
  created_at timestamptz default now()
);

create table if not exists ap_changes (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references ap_points(id) on delete cascade,
  proposal text not null,
  proposed_by text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists ap_weeks (
  week_start date primary key,     -- Monday (Dubai)
  status text not null default 'pending' check (status in ('pending','approved','changes')),
  approved_by text,
  approved_at timestamptz,
  note text
);

-- ── helpers ─────────────────────────────────────────────────────────────
create or replace function ap_me() returns text language sql stable as
$$ select lower(coalesce(auth.jwt()->>'email','')) $$;

create or replace function ap_is_member() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from ap_settings s where ap_me() = any (select lower(x) from unnest(s.members) x)) $$;

create or replace function ap_is_approver() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from ap_settings s where lower(s.approver) = ap_me() and ap_me() <> '') $$;

create or replace function ap_today() returns date language sql stable as
$$ select (now() at time zone 'Asia/Dubai')::date $$;

-- ── step rules ──────────────────────────────────────────────────────────
-- A LATE step (open, due date passed) can only get a new date through
-- ap_move_date(), which writes the reason as a comment in the same transaction.
create or replace function ap_steps_guard() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.done_at is not null and old.done_at is null then
    new.done_by := coalesce(nullif(ap_me(),''), new.done_by);
  elsif new.done_at is null then
    new.done_by := null;
  end if;
  if old.done_at is null and old.due_date is not null and old.due_date < ap_today()
     and new.due_date is distinct from old.due_date
     and coalesce(current_setting('ap.reason_ok', true),'') <> '1' then
    raise exception 'This step is late. Give it a new date with a reason.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists ap_steps_guard on ap_steps;
create trigger ap_steps_guard before update on ap_steps for each row execute function ap_steps_guard();

create or replace function ap_move_date(p_step uuid, p_date date, p_reason text) returns void
language plpgsql security invoker as $$
declare s ap_steps;
begin
  if not ap_is_member() then raise exception 'No access'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to move a late date.'; end if;
  select * into s from ap_steps where id = p_step;
  if not found then raise exception 'Step not found'; end if;
  perform set_config('ap.reason_ok','1', true);
  update ap_steps set due_date = p_date where id = p_step;
  perform set_config('ap.reason_ok','', true);
  insert into ap_comments (point_id, step_id, author_email, body)
  values (s.point_id, s.id, ap_me(),
          'Date moved for "' || s.title || '": ' || coalesce(to_char(s.due_date,'DD Mon'),'none') || ' → ' || coalesce(to_char(p_date,'DD Mon'),'none') || '. Reason: ' || trim(p_reason));
end $$;

-- Only the approver can decide a proposed change. Stamps who and when.
create or replace function ap_changes_guard() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if auth.role() <> 'service_role' and not ap_is_approver() then
      raise exception 'Only Amin can approve or reject a change.' using errcode = 'P0001';
    end if;
    new.decided_by := ap_me(); new.decided_at := now();
  end if;
  new.proposal := old.proposal; new.proposed_by := old.proposed_by;   -- the proposal itself never changes
  return new;
end $$;
drop trigger if exists ap_changes_guard on ap_changes;
create trigger ap_changes_guard before update on ap_changes for each row execute function ap_changes_guard();

create or replace function ap_weeks_stamp() returns trigger language plpgsql as $$
begin new.approved_by := ap_me(); new.approved_at := now(); return new; end $$;
drop trigger if exists ap_weeks_stamp on ap_weeks;
create trigger ap_weeks_stamp before insert or update on ap_weeks for each row execute function ap_weeks_stamp();

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table ap_settings  enable row level security;
alter table ap_cron      enable row level security;
alter table ap_points    enable row level security;
alter table ap_steps     enable row level security;
alter table ap_measures  enable row level security;
alter table ap_snapshots enable row level security;
alter table ap_results   enable row level security;
alter table ap_comments  enable row level security;
alter table ap_changes   enable row level security;
alter table ap_weeks     enable row level security;

drop policy if exists ap_settings_read on ap_settings;
create policy ap_settings_read on ap_settings for select to authenticated using (ap_is_member());
drop policy if exists ap_settings_admin on ap_settings;
create policy ap_settings_admin on ap_settings for update to authenticated using (ap_is_member() and fn_is_app_admin()) with check (ap_is_member() and fn_is_app_admin());

drop policy if exists ap_points_read on ap_points;
create policy ap_points_read on ap_points for select to authenticated using (ap_is_member());

drop policy if exists ap_steps_read on ap_steps;
create policy ap_steps_read on ap_steps for select to authenticated using (ap_is_member());
drop policy if exists ap_steps_edit on ap_steps;
create policy ap_steps_edit on ap_steps for update to authenticated using (ap_is_member()) with check (ap_is_member());

drop policy if exists ap_measures_read on ap_measures;
create policy ap_measures_read on ap_measures for select to authenticated using (ap_is_member());
-- Only measures with no feed (key is null = "Manual") may be typed in the app.
drop policy if exists ap_measures_manual on ap_measures;
create policy ap_measures_manual on ap_measures for update to authenticated using (ap_is_member() and key is null) with check (ap_is_member() and key is null);

drop policy if exists ap_snapshots_read on ap_snapshots;
create policy ap_snapshots_read on ap_snapshots for select to authenticated using (ap_is_member());

drop policy if exists ap_results_read on ap_results;
create policy ap_results_read on ap_results for select to authenticated using (ap_is_member());
drop policy if exists ap_results_add on ap_results;
create policy ap_results_add on ap_results for insert to authenticated with check (ap_is_member() and lower(author_email) = ap_me());

drop policy if exists ap_comments_read on ap_comments;
create policy ap_comments_read on ap_comments for select to authenticated using (ap_is_member());
drop policy if exists ap_comments_add on ap_comments;
create policy ap_comments_add on ap_comments for insert to authenticated with check (ap_is_member() and lower(author_email) = ap_me());

drop policy if exists ap_changes_read on ap_changes;
create policy ap_changes_read on ap_changes for select to authenticated using (ap_is_member());
drop policy if exists ap_changes_add on ap_changes;
create policy ap_changes_add on ap_changes for insert to authenticated with check (ap_is_member() and lower(proposed_by) = ap_me() and status = 'pending');
drop policy if exists ap_changes_decide on ap_changes;
create policy ap_changes_decide on ap_changes for update to authenticated using (ap_is_approver()) with check (ap_is_approver());

drop policy if exists ap_weeks_read on ap_weeks;
create policy ap_weeks_read on ap_weeks for select to authenticated using (ap_is_member());
drop policy if exists ap_weeks_ins on ap_weeks;
create policy ap_weeks_ins on ap_weeks for insert to authenticated with check (ap_is_approver());
drop policy if exists ap_weeks_upd on ap_weeks;
create policy ap_weeks_upd on ap_weeks for update to authenticated using (ap_is_approver()) with check (ap_is_approver());

-- No anon access to anything; no DELETE policy anywhere (nothing is deleted from the app).
revoke all on ap_settings, ap_cron, ap_points, ap_steps, ap_measures, ap_snapshots, ap_results, ap_comments, ap_changes, ap_weeks from anon;
grant select, insert, update on ap_settings, ap_points, ap_steps, ap_measures, ap_snapshots, ap_results, ap_comments, ap_changes, ap_weeks to authenticated;
revoke all on ap_cron from authenticated;
grant execute on function ap_move_date(uuid, date, text), ap_is_member(), ap_is_approver() to authenticated;
revoke execute on function ap_move_date(uuid, date, text) from anon;

notify pgrst, 'reload schema';
