-- Roberto's 3.0 Action Plan — 2nd-visit target set from our own history (19 Oct 2026, Francesco).
-- Benchmark, normal trading May–Aug 2026: 4.5% of first-time guests came back within 30 days
-- (205 of 4,519). Checked against raw SevenRooms nights and the ap_sr_nights cache.
-- Target 7% replaces "+10 points vs baseline (14.4%)", which was carried over from an older figure.
update ap_measures set target = '7%', baseline = '4.5% (May–Aug: 205 of 4,519 first-timers)' where key = 'visits3';
