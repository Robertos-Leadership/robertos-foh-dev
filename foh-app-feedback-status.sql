-- ═══════════════════════════════════════════════════════════════════════════
-- foh-app-feedback-status.sql  —  Feedback: status you can check, and a link
-- the team can open any time to see where their feedback got to.
--
-- Runs AFTER foh-app-feedback.sql and foh-app-feedback-actions.sql.
-- Additive and safe to re-run. Nothing here touches a single answer anyone sent.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- "Mark done" was a tick: a CLAIM, with nothing behind it. This platform does
-- not accept claims anywhere else and should not accept one here. So a fix now
-- has to carry evidence, and the team can check on us without asking.
--
-- Three things change:
--
-- 1. app_feedback_done becomes app_feedback_work — it never only held "done";
--    it holds where a piece of work has got to. Existing rows are migrated, not
--    dropped.
--
-- 2. A fix must say WHAT changed, WHICH build it shipped in, and — the one that
--    actually earns trust — HOW to check it yourself in the app. That last line
--    is what made the COO round-2 email land: "the link below lists each one so
--    you can check them against the app". The app can then confirm the build is
--    genuinely live by comparing it with the build it is running. That proves
--    the code SHIPPED. It does not prove the code WORKS — only someone driving
--    the real flow proves that, which is what 'verified' records.
--
-- 3. app_feedback_people gives each person one unguessable token, so
--    foh-feedback-status.html?t=<token> can show them their own items with NO
--    login — the same shape as the questionnaire itself. The link is the
--    product. Answers stay authenticated-only: anon reaches this ONLY through
--    the security-definer function below, which returns one person's rows and
--    nothing else. There is no anon SELECT on any feedback table.
--
-- NOTE: question TEXT is not stored here and never should be. It lives in
-- foh-rounds.js, which the status page already loads — so the page resolves
-- every label client-side and the database stays a record of state, not copy.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 1. app_feedback_done → app_feedback_work ───────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='app_feedback_done')
     and not exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='app_feedback_work') then
    alter table app_feedback_done rename to app_feedback_work;
  end if;
end $$;

create table if not exists app_feedback_work (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null,
  qkey       text not null,
  done_by    text,
  done_at    timestamptz default now(),
  venue_id   text default 'robertos-difc',
  unique (topic, qkey)
);

-- Where this piece of work has got to.
--   progress — picked up, not shipped
--   fixed    — shipped: must carry what_changed + build + check_line
--   verified — someone drove the real flow and saw it work
alter table app_feedback_work add column if not exists status       text not null default 'fixed';
alter table app_feedback_work add column if not exists what_changed text;
alter table app_feedback_work add column if not exists commit_sha   text;
alter table app_feedback_work add column if not exists build        text;
alter table app_feedback_work add column if not exists check_line   text;
alter table app_feedback_work add column if not exists verified_at  timestamptz;
alter table app_feedback_work add column if not exists verified_by  text;
alter table app_feedback_work add column if not exists verified_what text;
alter table app_feedback_work add column if not exists updated_at   timestamptz default now();

do $$ begin
  alter table app_feedback_work drop constraint if exists app_feedback_work_status_ck;
  alter table app_feedback_work add constraint app_feedback_work_status_ck
    check (status in ('progress','fixed','verified'));
  -- Evidence is not optional. 'fixed' without what changed, the build it shipped
  -- in, and how to check it is exactly the tick this replaces — the database
  -- refuses it rather than trusting the screen to ask nicely.
  alter table app_feedback_work drop constraint if exists app_feedback_work_evidence_ck;
  alter table app_feedback_work add constraint app_feedback_work_evidence_ck
    check (
      status = 'progress'
      or (coalesce(btrim(what_changed),'') <> ''
          and coalesce(btrim(build),'') <> ''
          and coalesce(btrim(check_line),'') <> '')
    );
end $$;

create index if not exists app_feedback_work_topic_idx on app_feedback_work (topic);

-- ── 2. One token per person, so they can look without asking ───────────────
create table if not exists app_feedback_people (
  who        text primary key,                    -- the name used in the round link
  token      text unique not null default encode(gen_random_bytes(16),'hex'),
  email      text,
  created_at timestamptz default now()
);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Admin-only, both directions, on every table. anon never selects here: the
-- status page reaches its own row ONLY through feedback_status() below.
alter table app_feedback_work enable row level security;
alter table app_feedback_people enable row level security;

drop policy if exists app_feedback_done_all on app_feedback_work;
drop policy if exists app_feedback_work_all on app_feedback_work;
create policy app_feedback_work_all on app_feedback_work
  for all to authenticated using (true) with check (true);

drop policy if exists app_feedback_people_all on app_feedback_people;
create policy app_feedback_people_all on app_feedback_people
  for all to authenticated using (true) with check (true);

-- ── 3. What the status page may see ────────────────────────────────────────
-- SECURITY DEFINER so it can read past RLS — but it is a narrow door: it takes
-- an unguessable token, resolves it to exactly ONE person, and returns only
-- that person's own submissions plus the work state of the rounds they answered.
-- It never returns anyone else's answers, never returns who else was asked, and
-- takes no other parameter that could widen it.
--
-- Only the LATEST submission per round is returned — the same rule Admin counts
-- by, so the person and Francesco are never looking at two different truths.
create or replace function feedback_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_who text;
  v_out jsonb;
begin
  select who into v_who from app_feedback_people where token = p_token;
  if v_who is null then
    return jsonb_build_object('ok', false);
  end if;

  select jsonb_build_object(
    'ok', true,
    'who', v_who,
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'topic', s.topic, 'answers', s.answers, 'created_at', s.created_at))
      from (
        select distinct on (f.topic) f.topic, f.answers, f.created_at
        from app_feedback f
        where lower(btrim(f.who)) = lower(btrim(v_who))
        order by f.topic, f.created_at desc
      ) s
    ), '[]'::jsonb),
    'work', coalesce((
      select jsonb_agg(jsonb_build_object(
               'topic', w.topic, 'qkey', w.qkey, 'status', w.status,
               'what_changed', w.what_changed, 'build', w.build,
               'check_line', w.check_line, 'verified_at', w.verified_at,
               'updated_at', w.updated_at))
      from app_feedback_work w
      where w.topic in (
        select distinct f2.topic from app_feedback f2
        where lower(btrim(f2.who)) = lower(btrim(v_who))
      )
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

revoke all on function feedback_status(text) from public;
grant execute on function feedback_status(text) to anon, authenticated;

-- Refresh PostgREST so the new table + function are visible immediately.
notify pgrst, 'reload schema';

-- After running: Admin → Feedback gains a status control with evidence on each
-- line, a "Copy the fix brief" button, and a "Copy their status link" button
-- that hands you  foh-feedback-status.html?t=<token>  for that person.
