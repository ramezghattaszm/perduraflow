-- Layer 0 Commit 6 (0024): material_requirement/material_availability drop the part VERSION-id refs
-- for the durable business key part_no/component_part_no. Add nullable, backfill from the join to
-- master_data.part (the id columns are still present at this point), enforce NOT NULL, then drop the ids.
DROP INDEX IF EXISTS "material_requirement_part_idx";--> statement-breakpoint
ALTER TABLE "scheduling"."material_availability" ADD COLUMN "component_part_no" text;--> statement-breakpoint
ALTER TABLE "scheduling"."material_requirement" ADD COLUMN "part_no" text;--> statement-breakpoint
ALTER TABLE "scheduling"."material_requirement" ADD COLUMN "component_part_no" text;--> statement-breakpoint
UPDATE "scheduling"."material_availability" ma SET "component_part_no" = p."part_no" FROM "master_data"."part" p WHERE p."id" = ma."component_part_id";--> statement-breakpoint
UPDATE "scheduling"."material_requirement" mr SET "part_no" = fp."part_no", "component_part_no" = cp."part_no" FROM "master_data"."part" fp, "master_data"."part" cp WHERE fp."id" = mr."part_id" AND cp."id" = mr."component_part_id";--> statement-breakpoint
ALTER TABLE "scheduling"."material_availability" ALTER COLUMN "component_part_no" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."material_requirement" ALTER COLUMN "part_no" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."material_requirement" ALTER COLUMN "component_part_no" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_requirement_part_no_idx" ON "scheduling"."material_requirement" USING btree ("part_no");--> statement-breakpoint
ALTER TABLE "scheduling"."material_availability" DROP COLUMN IF EXISTS "component_part_id";--> statement-breakpoint
ALTER TABLE "scheduling"."material_requirement" DROP COLUMN IF EXISTS "part_id";--> statement-breakpoint
ALTER TABLE "scheduling"."material_requirement" DROP COLUMN IF EXISTS "component_part_id";
