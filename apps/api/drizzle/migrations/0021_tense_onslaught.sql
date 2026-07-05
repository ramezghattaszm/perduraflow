ALTER TABLE "master_data"."part" DROP CONSTRAINT "part_tenant_part_no_unique";--> statement-breakpoint
ALTER TABLE "master_data"."part" ADD COLUMN "revision" text DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "master_data"."part" ADD COLUMN "effective_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "master_data"."part" ADD COLUMN "effective_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "master_data"."part" ADD COLUMN "supersedes_id" text;--> statement-breakpoint
-- Layer 0 backfill: existing rows are the single open 'A' version, effective from their creation.
-- (revision already backfills to 'A' via the column default; effective_to / supersedes_id stay NULL.)
UPDATE "master_data"."part" SET "effective_from" = "created_at";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."part" ADD CONSTRAINT "part_supersedes_id_part_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "master_data"."part"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "part_tenant_part_no_open_unique" ON "master_data"."part" USING btree ("tenant_id","part_no") WHERE "master_data"."part"."effective_to" is null;