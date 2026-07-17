-- ══════════════════════════════════════════════════════════════════
--  rev-monthly-schema.sql — monthly revenue history (Revenue module)
-- ------------------------------------------------------------------
--  WHY THIS TABLE EXISTS
--  rev_daily holds one row per NIGHT and is what every Revenue screen is
--  built on. For 2016-2025 we have no nightly detail — only the finance
--  file's monthly totals (Simphony 'Sales Net VAT', Food+Beverage+Tobacco).
--  Splitting a monthly total across ~30 invented nights would put figures on
--  the screen that never happened, so instead a month lives here as ONE row
--  and the app labels it for what it is: a monthly total, no nightly detail.
--
--  ROW CAP: one row per MONTH. PostgREST caps a read at 1000 rows = 83 years,
--  so this table cannot silently truncate the way a daily table can.
--
--  PRECEDENCE: rev_daily always wins. A month with real nights ignores its
--  row here entirely (see revYearRow in foh-revenue.js).
--
--  SOURCE: "Copy of R's DIFC Sales  Cost 2022-2026.xlsx" (Desktop), verified
--  17 Jul 2026 — every year that appears in 2+ sheets agrees across all 12
--  months (0 disagreements in 320+ comparisons); Food+Bev+Tobacco equals the
--  file's own total for all 115 months; Jan 2026 (60,583.78) and Apr 2026
--  (874,807.62) reconcile to Simphony to the dirham.
-- ══════════════════════════════════════════════════════════════════

create table if not exists rev_monthly (
  period       text primary key,          -- YYYY-MM
  status       text not null default 'traded',   -- 'traded' | 'closed'
  net_actual   numeric,                   -- net sales = food + bev + tobacco
  food_net     numeric,
  bev_net      numeric,
  tobacco_net  numeric,
  source       text,                      -- where the figure came from, shown on screen
  note         text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  constraint rev_monthly_status_ck check (status in ('traded','closed')),
  -- A traded month must carry a figure; a closed month must not invent one.
  constraint rev_monthly_traded_ck check (status <> 'traded' or net_actual is not null)
);

alter table rev_monthly enable row level security;
drop policy if exists "rev_monthly auth" on rev_monthly;
create policy "rev_monthly auth" on rev_monthly for all to authenticated using (true) with check (true);

-- ── Traded months from the finance file (115 months, 2016-2026) ──
insert into rev_monthly (period, status, net_actual, food_net, bev_net, tobacco_net, source) values
  ('2016-01', 'traded', 5549675.9, 2860994.65, 2647732.25, 40949.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-02', 'traded', 5157998.62, 2625080.62, 2489635.0, 43283.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-03', 'traded', 5239869.0, 2611949.0, 2574813.0, 53107.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-04', 'traded', 4962363.0, 2475815.0, 2440063.0, 46485.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-05', 'traded', 5015509.0, 2523112.0, 2445049.0, 47348.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-06', 'traded', 1926873.0, 965948.0, 939497.0, 21428.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-07', 'traded', 3238137.0, 1591148.0, 1615884.0, 31105.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-08', 'traded', 3556441.0, 1725951.0, 1786581.0, 43909.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-09', 'traded', 4726846.0, 2394170.0, 2288767.0, 43909.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-10', 'traded', 5422652.0, 2833487.0, 2541005.0, 48160.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-11', 'traded', 6074952.0, 3120147.0, 2899778.0, 55027.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2016-12', 'traded', 5323458.0, 2789933.0, 2483152.0, 50373.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-01', 'traded', 5059828.0, 2638225.0, 2376440.0, 45163.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-02', 'traded', 5932224.0, 3074536.0, 2807724.0, 49964.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-03', 'traded', 6389500.0, 3130055.0, 3193286.0, 66159.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-04', 'traded', 5681298.0, 2859619.0, 2769349.0, 52330.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-05', 'traded', 5316314.0, 2681304.0, 2587438.0, 47572.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-06', 'traded', 1996001.0, 1019878.0, 959423.0, 16700.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-07', 'traded', 4224359.0, 1979683.0, 2205302.0, 39374.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-08', 'traded', 3719044.0, 1705259.0, 1975525.0, 38260.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-09', 'traded', 4892519.0, 2349206.0, 2500588.0, 42725.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-10', 'traded', 6218106.0, 3032952.0, 3109170.0, 75984.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-11', 'traded', 6432782.0, 3073273.0, 3279563.0, 79946.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2017-12', 'traded', 5763573.3, 2853919.8, 2835913.5, 73740.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2018-01', 'traded', 5974462.4, 2890236.94, 3019760.46, 64465.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2018-02', 'traded', 5443628.0, 2605912.0, 2772234.0, 65482.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2018-03', 'traded', 5602154.0, 2717338.0, 2810229.0, 74587.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2018-04', 'traded', 5391677.0, 2619884.0, 2699717.0, 72076.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2018-05', 'traded', 3454739.0, 1809608.0, 1603925.0, 41206.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2018-06', 'traded', 2566211.5, 1280717.6, 1254308.1, 31185.8, 'Finance file — Sales & Cost (Simphony net)'),
  ('2018-10', 'traded', 847426.44, 358667.0, 477808.98, 10950.46, 'Finance file — Sales & Cost (Simphony net)'),
  ('2018-11', 'traded', 6463306.97, 3086595.0, 3309876.12, 66835.85, 'Finance file — Sales & Cost (Simphony net)'),
  ('2018-12', 'traded', 5713465.07, 2788885.09, 2872271.3, 52308.68, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-01', 'traded', 5418483.0, 2620204.0, 2745144.0, 53135.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-02', 'traded', 5395418.47, 2618870.11, 2719159.03, 57389.33, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-03', 'traded', 5662002.56, 2733079.86, 2874778.53, 54144.17, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-04', 'traded', 4989840.27, 2501698.86, 2440697.63, 47443.78, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-05', 'traded', 2135305.61, 1161250.28, 956840.06, 17215.27, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-06', 'traded', 3644293.27, 1799171.02, 1811846.88, 33275.37, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-07', 'traded', 3529264.0, 1627668.0, 1865331.0, 36265.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-08', 'traded', 2752677.06, 1272969.69, 1452070.08, 27637.29, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-09', 'traded', 4577835.3, 2145789.79, 2371227.22, 60818.29, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-10', 'traded', 5313958.3, 2614000.05, 2645017.3, 54940.95, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-11', 'traded', 5538325.74, 2617888.04, 2863473.88, 56963.82, 'Finance file — Sales & Cost (Simphony net)'),
  ('2019-12', 'traded', 4817294.12, 2395540.41, 2375055.48, 46698.23, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-01', 'traded', 5113135.24, 2517943.38, 2555432.82, 39759.04, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-02', 'traded', 4786344.88, 2274705.96, 2473831.2, 37807.72, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-03', 'traded', 1802871.63, 879256.83, 908663.3, 14951.5, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-06', 'traded', 2033775.16, 990229.36, 1015635.21, 27910.59, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-07', 'traded', 3201575.88, 1513629.91, 1642027.78, 45918.19, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-08', 'traded', 3934821.27, 1749349.44, 2131083.2, 54388.63, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-09', 'traded', 3451490.68, 1550645.35, 1846931.07, 53914.26, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-10', 'traded', 4393751.32, 2005184.46, 2320942.16, 67624.7, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-11', 'traded', 5817814.4, 2513259.16, 3220232.24, 84323.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2020-12', 'traded', 7878308.79, 3649931.32, 4123346.35, 105031.12, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-01', 'traded', 7466551.6, 3122886.74, 4242396.16, 101268.7, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-02', 'traded', 3552378.77, 1817986.29, 1689774.61, 44617.87, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-03', 'traded', 4456412.83, 2193205.72, 2202880.0, 60327.11, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-04', 'traded', 3997226.17, 2110527.31, 1822990.54, 63708.32, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-05', 'traded', 5220075.71, 2484513.89, 2669734.97, 65826.85, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-06', 'traded', 6508345.44, 3053528.34, 3382818.91, 71998.19, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-07', 'traded', 3783598.62, 1721592.96, 2014523.53, 47482.13, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-08', 'traded', 3734379.19, 1681241.03, 2004409.31, 48728.85, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-09', 'traded', 5990237.87, 2746918.5, 3160922.41, 82396.96, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-10', 'traded', 7855734.49, 3635341.17, 4121846.77, 98546.55, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-11', 'traded', 8080920.48, 3791250.38, 4184600.19, 105069.91, 'Finance file — Sales & Cost (Simphony net)'),
  ('2021-12', 'traded', 8090716.15, 3798701.15, 4195338.47, 96676.53, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-01', 'traded', 7568157.68, 3277114.96, 4182984.08, 108058.64, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-02', 'traded', 6639880.63, 3011554.5, 3526785.41, 101540.72, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-03', 'traded', 7540129.4, 3468491.21, 3960304.99, 111333.2, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-04', 'traded', 3433947.27, 1701560.15, 1679088.07, 53299.05, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-05', 'traded', 5795288.91, 2769299.72, 2922147.41, 103841.78, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-06', 'traded', 4508459.67, 2125945.44, 2311882.64, 70631.59, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-07', 'traded', 3488008.56, 1547292.13, 1882161.36, 58555.07, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-08', 'traded', 3475603.28, 1622004.46, 1789010.35, 64588.47, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-09', 'traded', 5190812.84, 2412409.93, 2702090.67, 76312.24, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-10', 'traded', 6020408.73, 2799198.96, 3131675.54, 89534.23, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-11', 'traded', 6513071.15, 3045342.46, 3383825.02, 83903.67, 'Finance file — Sales & Cost (Simphony net)'),
  ('2022-12', 'traded', 5647242.56, 2783385.25, 2771459.8, 92397.51, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-01', 'traded', 6198966.49, 2935104.31, 3136220.19, 127641.99, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-02', 'traded', 5788639.21, 2683414.59, 2977453.22, 127771.4, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-03', 'traded', 5079246.64, 2437614.87, 2550924.12, 90707.65, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-04', 'traded', 3167818.73, 1527866.44, 1586811.42, 53140.87, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-05', 'traded', 5352278.15, 2498043.22, 2762189.47, 92045.46, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-06', 'traded', 4228599.09, 2026158.23, 2127980.98, 74459.88, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-07', 'traded', 3221524.03, 1525695.59, 1622207.57, 73620.87, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-08', 'traded', 3295664.35, 1559798.94, 1652541.59, 83323.82, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-09', 'traded', 5099512.25, 2316714.63, 2678387.63, 104409.99, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-10', 'traded', 5217589.75, 2545889.58, 2595691.32, 76008.85, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-11', 'traded', 5450967.38, 2722221.01, 2632671.12, 96075.25, 'Finance file — Sales & Cost (Simphony net)'),
  ('2023-12', 'traded', 4818737.59, 2446398.41, 2294479.42, 77859.76, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-01', 'traded', 4467766.24, 2284080.59, 2109338.05, 74347.6, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-02', 'traded', 5062403.86, 2518862.2, 2451820.2, 91721.46, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-03', 'traded', 2961051.5, 1474329.96, 1445835.92, 40885.62, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-04', 'traded', 3250647.97, 1598044.66, 1619355.75, 33247.56, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-05', 'traded', 4119115.65, 2027789.14, 2023099.89, 68226.62, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-06', 'traded', 2995746.31, 1526711.09, 1425074.23, 43960.99, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-07', 'traded', 2263669.68, 1105937.54, 1121751.35, 35980.79, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-08', 'traded', 2416335.48, 1124573.54, 1235103.02, 56658.92, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-09', 'traded', 3108780.08, 1520222.94, 1543521.06, 45036.08, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-10', 'traded', 3545787.95, 1829996.46, 1667466.64, 48324.85, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-11', 'traded', 3634956.73, 1895810.34, 1698132.02, 41014.37, 'Finance file — Sales & Cost (Simphony net)'),
  ('2024-12', 'traded', 2974089.87, 1548109.25, 1388351.07, 37629.55, 'Finance file — Sales & Cost (Simphony net)'),
  ('2025-01', 'traded', 3342912.49, 1690072.69, 1597268.94, 55570.86, 'Finance file — Sales & Cost (Simphony net)'),
  ('2025-02', 'traded', 3591122.42, 1839849.52, 1689562.97, 61709.93, 'Finance file — Sales & Cost (Simphony net)'),
  ('2025-03', 'traded', 1369640.01, 728780.37, 627973.95, 12885.69, 'Finance file — Sales & Cost (Simphony net)'),
  ('2025-04', 'traded', 2532868.59, 1306574.6, 1190414.9, 35879.09, 'Finance file — Sales & Cost (Simphony net)'),
  ('2025-05', 'traded', 2631197.92, 1258391.31, 1327219.09, 45587.52, 'Finance file — Sales & Cost (Simphony net)'),
  ('2025-06', 'traded', 1302376.04, 677877.4, 609512.93, 14985.71, 'Finance file — Sales & Cost (Simphony net)'),
  ('2026-01', 'traded', 60583.79, 27295.56, 32072.72, 1215.51, 'Finance file — Sales & Cost (Simphony net)'),
  ('2026-02', 'traded', 1665150.0, 824690.0, 825691.0, 14769.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2026-03', 'traded', 403019.0, 200119.0, 198120.0, 4780.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2026-04', 'traded', 874807.62, 360595.27, 503526.62, 10685.73, 'Finance file — Sales & Cost (Simphony net)'),
  ('2026-05', 'traded', 1635787.0, 815444.0, 807961.0, 12382.0, 'Finance file — Sales & Cost (Simphony net)'),
  ('2026-06', 'traded', 1550158.18, 744809.32, 783422.29, 21926.57, 'Finance file — Sales & Cost (Simphony net)')
on conflict (period) do update set
  status=excluded.status, net_actual=excluded.net_actual, food_net=excluded.food_net,
  bev_net=excluded.bev_net, tobacco_net=excluded.tobacco_net, source=excluded.source,
  updated_at=now();

-- ── Closed: the venue did not trade (Francesco, 17 Jul 2026) ──
-- These are NOT missing data. Without these rows the Year view would report
-- them as holes in the YTD, which would be untrue.
insert into rev_monthly (period, status, net_actual, source, note) values
  ('2025-07', 'closed', 0, 'Confirmed by Francesco, 17 Jul 2026', 'Venue closed — did not trade'),
  ('2025-08', 'closed', 0, 'Confirmed by Francesco, 17 Jul 2026', 'Venue closed — did not trade'),
  ('2025-09', 'closed', 0, 'Confirmed by Francesco, 17 Jul 2026', 'Venue closed — did not trade'),
  ('2025-10', 'closed', 0, 'Confirmed by Francesco, 17 Jul 2026', 'Venue closed — did not trade'),
  ('2025-11', 'closed', 0, 'Confirmed by Francesco, 17 Jul 2026', 'Venue closed — did not trade'),
  ('2025-12', 'closed', 0, 'Confirmed by Francesco, 17 Jul 2026', 'Venue closed — did not trade')
on conflict (period) do update set
  status=excluded.status, net_actual=excluded.net_actual, source=excluded.source,
  note=excluded.note, updated_at=now();

-- ══════════════════════════════════════════════════════════════════
--  CONTEXT — why a month reads the way it does
-- ------------------------------------------------------------------
--  A number without its reason is a number that misleads. Jan-Mar 2026 look
--  catastrophic next to 2025 and are nothing of the sort: the venue reopened on
--  31 Jan 2026 after the Jul-Dec 2025 closure. Without these lines the board
--  reads a collapse; with them it reads an opening. Every one of these is
--  Francesco's own account (17 Jul 2026), not an inference from the figures.
--
--  This runs AFTER the inserts above, so re-running the whole file is safe:
--  the inserts do not touch note or trading_days, and these updates restore them.
-- ══════════════════════════════════════════════════════════════════
alter table rev_monthly add column if not exists trading_days integer;

comment on column rev_monthly.trading_days is
  'Nights actually traded, when known. NULL = not known — never a guess, and never used to derive a per-night average.';

update rev_monthly set trading_days = 1,
  note = 'Reopened 31 January 2026 — one trading night'
where period = '2026-01';
-- Corroborated: Simphony reports 196 guests and 111 checks for the whole of
-- January 2026 — the size of a single opening night, not a month of trading.

update rev_monthly set
  note = 'Soft opening month — the first full month after reopening'
where period = '2026-02';

update rev_monthly set
  note = 'Iran–US conflict — trade fell sharply'
where period = '2026-03';

-- ── Months the file leaves blank and NOBODY has confirmed ──
-- 2020-04, 2020-05  (the Covid closure period — likely, but unconfirmed)
-- 2018-07, 2018-08, 2018-09
-- They are deliberately NOT seeded: we do not know whether the venue was closed
-- or the figures were never recorded, and guessing is exactly what this module
-- exists to prevent. They render as holes until someone confirms. To mark them
-- closed once confirmed, add them to the 'closed' insert above.

-- ── Check what landed ──
-- select status, count(*), min(period), max(period), sum(net_actual)
-- from rev_monthly group by status;
-- select period, net_actual, trading_days, note from rev_monthly
-- where note is not null order by period;
