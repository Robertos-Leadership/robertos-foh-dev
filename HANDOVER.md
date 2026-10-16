# HANDOVER — Roberto's DIFC platform (FOH + Kitchen apps)

## Who / what
You're helping **Francesco Guarracino, Group Executive Chef at Roberto's DIFC (Dubai)**, who builds
these apps himself (no dev team). Vanilla **HTML/CSS/JS single-file apps on GitHub Pages + Supabase**
(Postgres/Auth/Edge Functions/Realtime). **No build step.** The platform is treated as **beta** —
security hardening is deliberately deferred (one exception below).

## The two apps
|  | FOH App | Kitchen App |
|---|---|---|
| Repo | `robertos-leadership/robertos-foh` (private — needs a PAT) | `robertos-kitchen/robertos-kitchen` (public DEV); LIVE is `Guarracinofamily/robertos-kitchen` |
| Live | https://robertos-leadership.github.io/robertos-foh/ | https://robertos-kitchen.github.io/robertos-kitchen/ |
| Supabase | **`paoaivwtkzujmrgrfjuq`** (Leadership Hub) | **`zrpglswalgjbtghudmhu`** (Kitchen) |
| Branch | `main` (push = live via GitHub Pages) | `main` |

**Critical:** two different Supabase projects. FOH stores its own data in `paoaivwtkzujmrgrfjuq` but
**reads covers + attendance from the Kitchen project** `zrpglswalgjbtghudmhu`. Anon keys are in the
client code (expected) — extract them to run read-only REST checks (`/rest/v1/...`).

## How to work
- **Commit to `main` = instantly live.** Hard-refresh (Ctrl+F5); no `?v=` cache-bust needed (single file).
- **Verify, don't assume.** Use the anon key + REST to confirm tables/columns exist and RLS posture.
  For UI/logic, run a local static server and exercise the actual functions against injected data.
- **SQL is additive only.** `create table if not exists` does NOT add columns to an existing table →
  use `ALTER TABLE … ADD COLUMN IF NOT EXISTS …; NOTIFY pgrst, 'reload schema';`. Multiple silent
  `PGRST204` failures have come from this.
- **Dubai is UTC+4.** Never use `toISOString()` to compute "today"/week — compute local Dubai date.
- **Brand tokens:** `--vino` #6B1F2A, `--sabbia`/`--cream`, `--gold` #C9A84C, Playfair/Georgia headings,
  Inter body. Reuse, don't invent.
- **The agent cannot run DDL** (anon key only) or deploy Edge Functions — Francesco runs SQL in the
  Supabase SQL Editor and deploys functions. Give him exact SQL/commands.

## Recently shipped (FOH, all live)
- Schedule: fixed Duplicate Week (dead ref + missing `notes`/`updated_at` columns), RLS write access
  (`fix-foh-rls.sql`), clock-in/out display (HH:MM vs ISO slice), **manual clock-out override**,
  frozen header, 1-decimal hours, events-page load, status badges.
- **Revenue module (Leader page, finance, login-only)** — native rebuild of `Daily Budget.xlsx`,
  verified to match the workbook exactly. Daily entry = **Restaurant/Scala × Lunch/Dinner** revenue+covers
  (avg auto), **editable per-day budget** (rates default, overridable), **Sundays enterable**,
  **Lounge-vs-Restaurant %**, matched-window **Review** vs previous month, weekday averages, full-month
  **projection vs budget**, month ◀▶ + Add month + **Year** view. **Target removed — budget is the
  sole benchmark.** Optional AI report button (Claude via Edge Function).

## ⚠️ Pending — Francesco runs in Supabase (`paoaivwtkzujmrgrfjuq`) to light up Revenue
1. `revenue-schema.sql` (run) + **`revenue-seed-history.sql`** (NOT yet run → no revenue data).
2. **`revenue-daypart-columns.sql`** (adds 8 daypart columns + `budget_override`).
- Optional: deploy `functions/revenue-assistant/index.ts` + set `ANTHROPIC_API_KEY` for AI reports.
- Full design spec: **`revenue-module-spec.md`** (in this repo).

## Next build (planned)
**Closing Report** — recreate `Daily Snapshot June 2026.xlsx` (one sheet/day) as the **primary daily
entry point**, replacing the simple modal. Full operational log (manager on duty; Day/Night/Late shift
feedback+challenges; comps; private events; comments good/bad; support) in a new `closing_reports`
table, **rolling its numbers into `rev_daily`** automatically. Decision: capture **everything**.
Mapping in `revenue-module-spec.md`.

## Known issues (full diagnostic — mostly beta-deferred)
- 🔴 **Resend API key hardcoded in the public Kitchen repo** (`supabase/functions/send-market-order/index.ts`
  line 8). Code cleanup deferred, but **rotate the key** (live + public). Later: `Deno.env.get('RESEND_API_KEY')` + secret.
- ⚠️ **`supabase/cosec-cron.sql` is a landmine** — old schedule, no `cosec-sync-yesterday` backfill;
  **re-running it reverts the COSEC clock-out fix.** Don't run it; regenerate from live `cron.job` if touched.
- FOH **manager tables (events/weeks/tasks/finance) are empty** → Events module opens blank (seed never
  run here, or data lives in the separate Leadership Hub — confirm with Francesco).
- `send-roster` / `send-closing-report` Edge Functions deployed but **source not in any repo**
  (`supabase functions download` to recover).
- 🔐 Rotate the leaked GitHub PAT when convenient.
- **Confirmed healthy:** all tables exist, RLS correctly blocks anon writes on the manager layer,
  timezone handling correct, covers sync live, COSEC clock-out fix working (verified 2026-06-18),
  market-list upsert constraints solid.

## COSEC reference
Matrix COSEC **CENTRA** web API. Historical pull (semicolons, DDMMYYYY):
`…/attendance-daily?action=get;date-range=DDMMYYYY-DDMMYYYY;`. Bare endpoint serves **today only**.
The 18-Jun fix added a `date-range` variant + daily `cosec-sync-yesterday` backfill cron. The feed is
org-wide (FOH staff included); clock-in/out reaches FOH via the shared Kitchen `attendance` table.

**Start by** confirming with Francesco which task to pick up (likely: verify the pending Revenue SQL is
run, or build the Closing Report). Read `revenue-module-spec.md` and the FOH `index.html` revenue
section first.

## Roberto's 3.0 Action Plan (module `actionplan`, Phase 1, built 16 Oct 2026)
- **Screen:** `foh-actionplan.js`, a card under "Executive" on the Manager landing. Overview (plan %, steps, late, relaunch, 10 points in 4 groups, filters), a page per point (steps with owner and date, How we check, weekly results, proposed changes, comments), and Amin's weekly approval.
- **Who:** `ap_settings.members` = fguarracino@robertos.ae, onafid@robertos.ae, akadrie@skelmore.com, justin@skelmore.com. **RLS on every `ap_*` table is the lock.** The `actionplan` key in `app_users.modules` only shows the card. Anyone else reads zero rows and sees "No access". `ap_settings.approver` (Amin) is the only one who can approve changes or the week (enforced by RLS and a trigger). An app Admin can edit `ap_settings`.
- **Tables:** `ap_settings`, `ap_points`, `ap_steps`, `ap_measures`, `ap_snapshots` (weekly stored numbers), `ap_results` (what worked, per week), `ap_comments`, `ap_changes`, `ap_weeks`, `ap_cron` (scheduler secret, service only), `ap_sr_nights` (cache of settled SevenRooms nights, service only). SQL: `actionplan-001…004*.sql`.
- **Rules:** a late step's date only moves through `ap_move_date(step, date, reason)`, which saves the reason as a comment. A direct update is refused by the `ap_steps_guard` trigger.
- **Function `ap-weekly`** (verify_jwt on): `refresh` (any member), `preview`, and `send` (pg_cron job `ap-weekly-email`, Wed 04:00 UTC = 08:00 Dubai, or an Admin). It computes walk-in share, channels, 90-day return (SevenRooms through Kitchen `sevenrooms-sync`, same rules as Reservation Reports), Monday and Sunday guests (`rev_daily`; a missing night shows "No data", never 0) and the Google rating. It stores them in `ap_measures` + `ap_snapshots`. **The email goes only to `ap_settings.recipients`**, which is Francesco while testing.
