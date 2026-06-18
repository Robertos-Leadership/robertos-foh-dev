# Revenue Module — build spec (native rebuild of "Daily Budget.xlsx")

Goal: replace the SharePoint "Daily Budget.xlsx" with a native module in the FOH app's
**Leader page revenue module** (currently a placeholder). Manager enters actuals directly
in the app; app computes budgets/variances/MTD/comparisons. No file sync.

**Placement & security:** Manager/Leader section only (behind Supabase login). Finance data →
needs authenticated-only RLS on its tables (ties into the deferred auth/RLS foundational build).
Must NOT appear on the public FOH home.

## Data model (Supabase, project paoaivwtkzujmrgrfjuq)
- `rev_rates` (config, per weekday): `weekday` (Mon..Sun), `no_show_rate`, `avg_spend` (AED/head, restaurant),
  `walkin_rate`, `cover_target`. Seed from Rates tab (June 2026):
  Mon .08/360/.20/65 · Tue .07/400/.18/120 · Wed .06/375/.17/165 · Thu .05/415/.22/245 ·
  Fri .08/485/.16/255 · Sat .07/460/.12/260 · Sun 0/0/0/0.
- `rev_daily` (one row per service_date): `service_date`, `net_actual` (AED, from Simphony DSR — manual),
  `rest_covers_actual`, `lounge_covers_actual`, `rest_net`, `lounge_net` (optional venue split),
  `forecast` (optional override; default = budget), `notes`. Covers actual can prefill from the
  existing `covers`/SevenRooms data where available.
- `rev_targets` (config): `period` (e.g. 2026-06), `monthly_target` (June = 2,000,000), `closed_weekdays` (Sun).

## Computed (NOT stored — derive in app, mirrors the workbook formulas)
- daily_budget(day) = rates.cover_target × rates.avg_spend  (per weekday)
- vs_budget = net_actual − daily_budget
- vs_forecast = net_actual − forecast
- total_covers_actual = rest_covers_actual + lounge_covers_actual
- avg_per_cover = net_actual / total_covers_actual
- budget_covers = cover_target; budget_avg = daily_budget / cover_target
- venue avg/cover = rest_net/rest_covers, lounge_net/lounge_covers
- MTD: SUM(net_actual) for the month vs monthly_target; trading days = days with net_actual
- Review (May vs June matched window): compare June MTD to SUM of May net for the SAME day-numbers
  (1..current day). % change. Weekday averages = AVG(net) grouped by weekday, Sundays excluded.

## Morning forecast tool (optional, from Daily ForecastTemplate)
Inputs: confirmed reservations (restaurant, lounge). Using Rates by weekday:
- expected_no_shows = round(reservations × no_show_rate)
- net_covers = reservations − no_show
- walkins_est = round((rest_net_covers + lounge_net_covers) × walkin_rate/(1−walkin_rate))
- forecast_revenue = net_covers × avg_spend
- F&B mix (May DSR): Food 48% / Bev 51% / Tobacco 1%.

## Inputs the manager provides daily
net_actual (from Simphony DSR) + actual covers (rest/lounge). Everything else is computed.
(Truly automating net_actual would need a Simphony/POS integration — out of scope; manual entry for now.)

## One-time seed
Import May + June actuals from the workbook so history/Review work from day one.

## Review tab logic (THE key piece — auto-generates from daily entry)
The whole Review recalculates off ONE driver: `window_day = MAX(June day-# that has an actual)`
(Excel `C4`). As each night's net is entered, the window advances and every figure below updates.
Everything is "matched window": June days 1..window_day vs the SAME day-numbers in May.

- **Period totals (May vs June, days ≤ window_day):**
  - net sales = SUM(net) over days ≤ window_day (each side)
  - trading days = COUNT(days with a net actual)
  - avg net / trading day = net ÷ trading days
  - covers = SUM(total covers); avg spend/cover = net ÷ covers
  - %change = (June − May) / May
  - amber one-off: May day-3 Sunday private event (label "Sunday*") shown separately; subtract for like-for-like
- **Weekday averages (apples-to-apples):** AVERAGEIF(net) grouped by weekday name, May full month vs June MTD.
  Early-week = blended avg(Mon+Tue+Wed); Weekend = blended avg(Thu+Fri+Sat). Sundays excluded.
- **Spend/cover by venue (matched window):** Restaurant = SUM(rest_net)/SUM(rest_covers); Lounge = SUM(lounge_net)/SUM(lounge_covers); blended = net/total_covers. May vs June.
- **Covers by venue (matched window):** rest / lounge / total, May vs June.
- **Full-month projection (live):** each REMAINING June day (day-# > window_day) is valued at *June's own*
  weekday average (the live rows above). projected_remaining = Σ (remaining-day-count[weekday] × june_weekday_avg);
  Sundays = 0. full_month_forecast = june_MTD + projected_remaining.
  - vs Target: forecast − 2,000,000 ; vs Budget: forecast − budget_total(all trading days = Σ daily_budget).
  - Note: a one-off big night (e.g. 9 Jun Tue 124,882) inflates that weekday's avg → flag possible overstatement.

Inputs this needs per day (May seeded static, June live): net, rest_covers, lounge_covers, rest_net, lounge_net,
day-of-month #, weekday (both derivable from service_date). Targets: monthly_target (2,000,000), budget_total (Σ daily_budget).

## Scalability — months & years are data, never hardcoded (REQUIREMENT)
- `rev_daily` is keyed by full `service_date`, so ANY month/year lives in the same table — no per-month
  tabs, no schema change to add July. The Excel's separate May/June tabs collapse into one dated dataset.
- **Add a month = 1 click.** A month selector (◀ June ▶) with "+ Add month" that just starts the next
  month's view. No seeding needed — daily budget is derived live from `rev_rates` by weekday; you only
  enter actuals. Optionally create that month's target row (default from `rev_targets`, editable).
- **Comparison generalises:** the Review's "vs May" becomes "vs the PREVIOUS month" for any month
  (July vs June, etc.) — same matched-window-by-day-number logic, just `compare_period = selected − 1 month`
  (and previous-period can be overridden, e.g. vs same month last year once history exists).
- **Yearly view:** because everything is one dated source, a year roll-up = aggregate `rev_daily` by month →
  month-by-month net vs each month's target, YTD net vs Σ targets, weekday/venue trends across the year.
  Same engine, different grouping.
- `rev_rates` is global per weekday (reused every month); update quarterly. `rev_targets` holds one row per
  period (month) so each month's target travels with it.

## Consistency (REQUIREMENT)
- **Single source of truth:** every panel/tab (Today, Month grid, Review, Projection, Year) derives from the
  same `rev_daily` + `rev_rates` + `rev_targets`. No panel computes off its own copy — totals always agree.
- **Covers reconcile with the rest of the app:** actual covers prefill from the existing SevenRooms `covers`
  data so the revenue module and the landing/Manager covers never disagree.
- **Brand:** reuse the existing CSS variables only — `--vino` #6B1F2A, `--sabbia`/`--cream`, `--gold` #C9A84C,
  `--ink`; Playfair Display / Georgia for headings, Inter/system for body. Match the existing card style
  (module boxes, event cards, schedule). No new palette. Same money formatting (`AED x,xxx`) and 1-decimal
  rounding conventions already used in the app.

## AI report agent (optional capability — grounded, not hallucinated)
Lets the manager ask for reports in plain language ("summarise June vs May for the board",
"why is Friday down?", "project July at this run-rate", "export an investor one-pager").

- **Architecture mirrors the existing Kitchen `survey-assistant` pattern** (team.js): a secure Supabase
  Edge Function proxy (e.g. `revenue-assistant`) that holds the **Anthropic API key server-side** — NEVER
  in client JS or the repo (ARCHITECTURE.md §4). Client calls it with `x-proxy-secret`, `action:'chat'`.
- **Model:** `claude-sonnet-4-6` for normal reports (platform default); `claude-opus-4-8` for deeper /
  board-grade monthly analysis; `claude-haiku-4-5` for quick cheap summaries. Latest Claude only.
- **Grounded in real figures:** the client compiles a compact text briefing from `rev_daily`/Review/projection
  (same idea as team.js `teamAiBriefing`) and passes it as context, so the agent reasons over the actual
  numbers and can't invent them. Read-only — the agent never writes data.
- **Output:** markdown report rendered in the module; exportable via the existing pipes — ExcelJS (xlsx,
  as Send-to-HR already does) and the Resend email function (send-to-recipients), or print/PDF.
- **Security:** behind the Manager login (finance); the proxy enforces the shared secret; no raw data leaves
  except the briefing the manager requested.

## UI (app style — brand tokens above)
- Month selector ◀ ▶ + "+ Add month" + a Year toggle.
- Today card: actual vs budget (variance %), covers vs target, avg/cover.
- Month grid: per-day net / budget / variance / covers, with MTD total vs target bar.
- Review panel: matched-window vs previous month + weekday averages + venue spend/covers.
- Projection panel: full-month forecast (June run-rate by weekday) vs target & budget.
- Year view: month-by-month net vs target, YTD vs Σ targets.
- Edit = tap a day → enter net + covers (mirrors Save-shift pattern).
