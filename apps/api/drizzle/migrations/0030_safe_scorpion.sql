CREATE TABLE IF NOT EXISTS "master_data"."plant_part_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"plant_part_no" text NOT NULL,
	"part_no" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"supersedes_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."plant_part_mapping" ADD CONSTRAINT "plant_part_mapping_supersedes_id_plant_part_mapping_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "master_data"."plant_part_mapping"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plant_part_mapping_tenant_idx" ON "master_data"."plant_part_mapping" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plant_part_mapping_tenant_plant_alias_open_unique" ON "master_data"."plant_part_mapping" USING btree ("tenant_id","plant_id","plant_part_no") WHERE "master_data"."plant_part_mapping"."effective_to" is null;