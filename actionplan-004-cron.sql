-- Roberto's 3.0 Action Plan — Wednesday email at 08:00 Dubai (= 04:00 UTC). Additive.
-- Same shape as the other FOH jobs (net.http_post + x-cron-secret). The secret is
-- read from ap_cron at run time, so it is not written in this file or the repo.
-- Recipients are ONLY ap_settings.recipients (Francesco while testing).
select cron.unschedule('ap-weekly-email') where exists (select 1 from cron.job where jobname = 'ap-weekly-email');
select cron.schedule('ap-weekly-email', '0 4 * * 3', $job$
  select net.http_post(
    url := 'https://paoaivwtkzujmrgrfjuq.supabase.co/functions/v1/ap-weekly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhb2Fpdnd0a3p1am1yZ3JmanVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzAxMzAsImV4cCI6MjA5NjY0NjEzMH0.VynG9PBeIaqRG2lkMEuzskkcB11EhR-UfO9eGYsaUxk',
      'x-cron-secret', (select secret from ap_cron where id = 1)),
    body := '{"mode":"send"}'::jsonb,
    timeout_milliseconds := 150000);
$job$);
-- Grants the 'actionplan' card (the lock is ap_settings.members). Amin's row is
-- access only — no login, no password; his login is created from Admin → People.
update app_users set modules = array_append(modules, 'actionplan'), updated_at = now()
 where lower(email) in ('fguarracino@robertos.ae','onafid@robertos.ae','justin@skelmore.com') and not ('actionplan' = any(modules));
insert into app_users (email, name, modules, is_admin, is_hr, notify, updated_at)
select 'akadrie@skelmore.com', 'Amin Kadrie', array['actionplan'], false, false, '{}', now()
 where not exists (select 1 from app_users where lower(email) = 'akadrie@skelmore.com');
