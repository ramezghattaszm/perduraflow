-- Layer 1 Commit 1 (0026): part-core completion. make_buy is the authoritative sourcing flag — add
-- with a TRANSIENT default so the 11 existing rows fill, backfill the de-facto buy-component(s) from
-- scheduling.material_requirement, then DROP the default (every insert must state make_buy, like
-- part_no). customer_part_no/customer_id/program are nullable engineering refs (no backfill).
ALTER TABLE "master_data"."part" ADD COLUMN "make_buy" text DEFAULT 'make' NOT NULL;--> statement-breakpoint
ALTER TABLE "master_data"."part" ADD COLUMN "customer_part_no" text;--> statement-breakpoint
ALTER TABLE "master_data"."part" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "master_data"."part" ADD COLUMN "program" text;--> statement-breakpoint
-- Backfill: every part_no consumed as a buy-component today (component_part_no in material_requirement,
-- same tenant) → 'buy'; all others stay 'make' (the transient default). Rides the revision — all versions
-- of a buy part_no become 'buy'.
UPDATE "master_data"."part" p SET "make_buy" = 'buy'
WHERE EXISTS (
  SELECT 1 FROM "scheduling"."material_requirement" mr
  WHERE mr."component_part_no" = p."part_no" AND mr."tenant_id" = p."tenant_id"
);--> statement-breakpoint
-- Drop the transient default — make_buy is now mandatory-and-explicit.
ALTER TABLE "master_data"."part" ALTER COLUMN "make_buy" DROP DEFAULT;
