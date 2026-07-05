ALTER TABLE "master_data"."routing" ADD COLUMN "part_no" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "master_data"."routing" ADD COLUMN "revision" text DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "master_data"."routing" ADD COLUMN "effective_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "master_data"."routing" ADD COLUMN "effective_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "master_data"."routing" ADD COLUMN "supersedes_id" text;--> statement-breakpoint
-- Layer 0 backfill: denormalize part_no from part_id; existing routings are the single open 'A'
-- version, effective from their creation. (revision backfills to 'A' via the column default; the
-- '' part_no default is overwritten here; effective_to / supersedes_id stay NULL.)
UPDATE "master_data"."routing" r SET "part_no" = p."part_no" FROM "master_data"."part" p WHERE p."id" = r."part_id";--> statement-breakpoint
UPDATE "master_data"."routing" SET "effective_from" = "created_at";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."routing" ADD CONSTRAINT "routing_supersedes_id_routing_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "master_data"."routing"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "routing_tenant_part_no_name_open_unique" ON "master_data"."routing" USING btree ("tenant_id","part_no","name") WHERE "master_data"."routing"."effective_to" is null;