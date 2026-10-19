-- Roberto's 3.0 action plan — the Wednesday email moves to 09:00 Dubai (= 05:00 UTC), 19 Oct 2026.
-- Francesco told Amin "every Wednesday at 9:00 am" in the plan email he sent at 13:25 Dubai.
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ap-weekly-email'), schedule := '0 5 * * 3');
-- UNDO: select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ap-weekly-email'), schedule := '0 4 * * 3');
