-- Layer 0 Commit 4 — effectivity non-overlap exclusion constraints (custom SQL; Drizzle can't
-- model EXCLUDE). Redundant-by-design with the partial-unique open-version indexes but strictly
-- stronger: tstzrange(effective_from, effective_to) with NULL upper = unbounded, so two OPEN
-- versions overlap and are rejected — AND, unlike the partial index (which only sees open rows),
-- these also reject overlapping CLOSED windows for the same business key. IATF: at most one
-- effective version per key at any instant, enforced by the database.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS + ADD CONSTRAINT guarded by a pg_constraint existence
-- check (an EXCLUDE constraint owns a same-named index, so a blind re-ADD raises duplicate_table at
-- index_create, not duplicate_object — the existence guard is re-run-safe regardless).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- part: no two rows share (tenant_id, part_no) with overlapping [effective_from, effective_to).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'part_effectivity_no_overlap' AND conrelid = 'master_data.part'::regclass
  ) THEN
    ALTER TABLE "master_data"."part"
      ADD CONSTRAINT "part_effectivity_no_overlap"
      EXCLUDE USING gist (
        "tenant_id" WITH =,
        "part_no" WITH =,
        tstzrange("effective_from", "effective_to") WITH &&
      );
  END IF;
END $$;

-- routing: no two rows share (tenant_id, part_no, name) with overlapping [effective_from, effective_to).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routing_effectivity_no_overlap' AND conrelid = 'master_data.routing'::regclass
  ) THEN
    ALTER TABLE "master_data"."routing"
      ADD CONSTRAINT "routing_effectivity_no_overlap"
      EXCLUDE USING gist (
        "tenant_id" WITH =,
        "part_no" WITH =,
        "name" WITH =,
        tstzrange("effective_from", "effective_to") WITH &&
      );
  END IF;
END $$;
