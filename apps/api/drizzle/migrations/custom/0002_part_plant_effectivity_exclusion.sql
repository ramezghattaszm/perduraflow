-- Layer 1 Commit 4 — per-plant override non-overlap exclusion (custom SQL; Drizzle can't model
-- EXCLUDE). Redundant-by-design with the partial-unique open-override index but strictly stronger:
-- tstzrange(effective_from, effective_to) with NULL upper = unbounded, so two rows for the same
-- (tenant_id, part_no, plant_id) with overlapping windows are rejected — including overlapping CLOSED
-- windows the partial index (open-only) can't see. At most one effective override per (part, plant)
-- at any instant, enforced by the database.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS + ADD CONSTRAINT guarded by a pg_constraint existence
-- check (an EXCLUDE constraint owns a same-named index, so a blind re-ADD raises duplicate_table at
-- index_create, not duplicate_object — the existence guard is re-run-safe regardless).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- part_plant: no two rows share (tenant_id, part_no, plant_id) with overlapping [effective_from, effective_to).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'part_plant_effectivity_no_overlap' AND conrelid = 'master_data.part_plant'::regclass
  ) THEN
    ALTER TABLE "master_data"."part_plant"
      ADD CONSTRAINT "part_plant_effectivity_no_overlap"
      EXCLUDE USING gist (
        "tenant_id" WITH =,
        "part_no" WITH =,
        "plant_id" WITH =,
        tstzrange("effective_from", "effective_to") WITH &&
      );
  END IF;
END $$;
