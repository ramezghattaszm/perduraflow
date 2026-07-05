ALTER TABLE "master_data"."routing" DROP CONSTRAINT "routing_part_id_part_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "routing_part_idx";--> statement-breakpoint
ALTER TABLE "master_data"."routing" ALTER COLUMN "part_no" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_part_no_idx" ON "master_data"."routing" USING btree ("tenant_id","part_no");--> statement-breakpoint
ALTER TABLE "master_data"."routing" DROP COLUMN IF EXISTS "part_id";