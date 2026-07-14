-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK for security-batch-a.sql — restores the previous wide-open state
-- (allow-all for anon + authenticated) on all five tables. Run only if a
-- screen breaks and needs instant restore; then investigate.
-- ════════════════════════════════════════════════════════════════════════
do $$
declare t text; p record;
begin
  foreach t in array array['rev_daily','rev_rates','rev_targets','closing_reports','finance'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for all using (true) with check (true)', t || '_allow_all', t);
  end loop;
end $$;
notify pgrst, 'reload schema';
