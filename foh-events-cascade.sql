-- foh-events-cascade.sql  —  Batch 8 (Events module)
--
-- Purpose: make deleting an events_desk row automatically remove its child rows
-- (event_items + event_log) at the DATABASE level, so a draft delete can never
-- leave orphaned rows — belt-and-suspenders alongside the app-side cleanup now in
-- peDeleteEvent().
--
-- Safe to run more than once (idempotent). For each child table it finds the
-- existing foreign key on event_id -> events_desk(id); if that key is NOT already
-- ON DELETE CASCADE it is dropped and recreated with ON DELETE CASCADE. If no such
-- FK exists yet, one is created. It does not touch any data.
--
-- Run in Supabase project paoaivwtkzujmrgrfjuq  (SQL editor).

DO $$
DECLARE
  child text;
  r     record;
  fk_cols text[];
BEGIN
  FOREACH child IN ARRAY ARRAY['event_items','event_log'] LOOP

    -- Skip cleanly if the child table doesn't exist in this database.
    IF to_regclass(child) IS NULL THEN
      RAISE NOTICE 'Table % not found — skipped', child;
      CONTINUE;
    END IF;

    -- Look at every FK on child(...) that references events_desk, keep only the
    -- single-column one on event_id, and ensure it is ON DELETE CASCADE.
    FOR r IN
      SELECT con.conname, con.confdeltype, con.conkey, con.conrelid
      FROM pg_constraint con
      JOIN pg_class c  ON c.oid  = con.conrelid
      JOIN pg_class rc ON rc.oid = con.confrelid
      WHERE con.contype = 'f'
        AND c.relname  = child
        AND rc.relname = 'events_desk'
    LOOP
      SELECT array_agg(att.attname ORDER BY att.attnum)
        INTO fk_cols
      FROM unnest(r.conkey) k
      JOIN pg_attribute att ON att.attrelid = r.conrelid AND att.attnum = k;

      IF fk_cols = ARRAY['event_id'] THEN
        IF r.confdeltype <> 'c' THEN     -- 'c' = CASCADE; replace anything else
          EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', child, r.conname);
          EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (event_id) REFERENCES events_desk(id) ON DELETE CASCADE',
            child, r.conname);
          RAISE NOTICE 'Recreated FK % on % as ON DELETE CASCADE', r.conname, child;
        ELSE
          RAISE NOTICE 'FK % on % already ON DELETE CASCADE — left as is', r.conname, child;
        END IF;
      END IF;
    END LOOP;

    -- If there is no FK on child(event_id) at all, add one (with cascade).
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class c  ON c.oid  = con.conrelid
      JOIN pg_class rc ON rc.oid = con.confrelid
      WHERE con.contype = 'f'
        AND c.relname  = child
        AND rc.relname = 'events_desk'
        AND (
          SELECT array_agg(att.attname ORDER BY att.attnum)
          FROM unnest(con.conkey) k
          JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k
        ) = ARRAY['event_id']
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (event_id) REFERENCES events_desk(id) ON DELETE CASCADE',
        child, child || '_event_id_fkey');
      RAISE NOTICE 'Added missing FK on %(event_id) as ON DELETE CASCADE', child;
    END IF;

  END LOOP;
END $$;
