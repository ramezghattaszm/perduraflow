-- Layer 1 Commit 5 — plant-local mapping non-overlap exclusion (custom SQL; Drizzle can't model
-- EXCLUDE). Redundant-by-design with the partial-unique open-mapping index but strictly stronger:
-- tstzrange(effective_from, effective_to) with NULL upper = unbounded, so two rows for the same
-- (tenant_id, plant_id, plant_part_no) with overlapping windows are rejected — including overlapping
-- CLOSED windows the partial index (open-only) can't see. At most one effective mapping per
-- (plant, alias) at any instant, enforced by the database.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS + ADD CONSTRAINT guarded by a pg_constraint existence
-- check (an EXCLUDE constraint owns a same-named index, so a blind re-ADD raises duplicate_table at
-- index_create, not duplicate_object — the existence guard is re-run-safe regardless).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- plant_part_mapping: no two rows share (tenant_id, plant_id, plant_part_no) with overlapping windows.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plant_part_mapping_effectivity_no_overlap' AND conrelid = 'master_data.plant_part_mapping'::regclass
  ) THEN
    ALTER TABLE "master_data"."plant_part_mapping"
      ADD CONSTRAINT "plant_part_mapping_effectivity_no_overlap"
      EXCLUDE USING gist (
        "tenant_id" WITH =,
        "plant_id" WITH =,
        "plant_part_no" WITH =,
        tstzrange("effective_from", "effective_to") WITH &&
      );
  END IF;
END $$;
