-- Layer 0 Commit 6 (0025): demand_input drops the part VERSION-id ref for the durable business key
-- part_no (a live/forward ref, resolved as-of build time). Add nullable, backfill from the join
-- (part_id still present), enforce NOT NULL, then drop part_id. schedule_version gains the recorded
-- master-data resolve-as-of anchor (§4.6; null for pre-Layer-0 versions).
ALTER TABLE "scheduling"."demand_input" ADD COLUMN "part_no" text;--> statement-breakpoint
UPDATE "scheduling"."demand_input" d SET "part_no" = p."part_no" FROM "master_data"."part" p WHERE p."id" = d."part_id";--> statement-breakpoint
ALTER TABLE "scheduling"."demand_input" ALTER COLUMN "part_no" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."schedule_version" ADD COLUMN "master_data_asof" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduling"."demand_input" DROP COLUMN IF EXISTS "part_id";
