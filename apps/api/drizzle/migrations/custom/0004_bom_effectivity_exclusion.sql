-- Layer 2 Commit 2a.1 — BOM version non-overlap exclusion (custom SQL; Drizzle can't model EXCLUDE).
-- Redundant-by-design with the partial-unique open-published index but strictly stronger: no two
-- NON-DRAFT rows (published or superseded) share (tenant_id, parent_part_no) with overlapping
-- [effective_from, effective_to) — including overlapping CLOSED (superseded) windows the partial index
-- can't see. DRAFT rows are excluded (they have no window; effective_from IS NULL) via the partial WHERE.
-- At most one effective BOM version per parent at any instant, enforced by the database.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS + ADD CONSTRAINT guarded by a pg_constraint existence
-- check (an EXCLUDE constraint owns a same-named index, so a blind re-ADD raises duplicate_table at
-- index_create, not duplicate_object — the existence guard is re-run-safe regardless).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- bom: no two NON-DRAFT rows share (tenant_id, parent_part_no) with overlapping [effective_from, effective_to).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bom_effectivity_no_overlap' AND conrelid = 'master_data.bom'::regclass
  ) THEN
    ALTER TABLE "master_data"."bom"
      ADD CONSTRAINT "bom_effectivity_no_overlap"
      EXCLUDE USING gist (
        "tenant_id" WITH =,
        "parent_part_no" WITH =,
        tstzrange("effective_from", "effective_to") WITH &&
      )
      WHERE (status <> 'draft');
  END IF;
END $$;
