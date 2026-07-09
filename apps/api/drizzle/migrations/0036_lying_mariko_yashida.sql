CREATE TABLE IF NOT EXISTS "master_data"."asset_part_map" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tooling_asset_id" text NOT NULL,
	"part_no" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."tooling_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"asset_type" text NOT NULL,
	"tool_family" text,
	"plant_id" text NOT NULL,
	"tool_life_units" numeric,
	"tool_life_uom" text,
	"single_location" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."tooling_eligible_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tooling_asset_id" text NOT NULL,
	"resource_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."asset_part_map" ADD CONSTRAINT "asset_part_map_tooling_asset_id_tooling_asset_id_fk" FOREIGN KEY ("tooling_asset_id") REFERENCES "master_data"."tooling_asset"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."tooling_eligible_resource" ADD CONSTRAINT "tooling_eligible_resource_tooling_asset_id_tooling_asset_id_fk" FOREIGN KEY ("tooling_asset_id") REFERENCES "master_data"."tooling_asset"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."tooling_eligible_resource" ADD CONSTRAINT "tooling_eligible_resource_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "master_data"."resource"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_part_map_asset_idx" ON "master_data"."asset_part_map" USING btree ("tooling_asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_part_map_part_idx" ON "master_data"."asset_part_map" USING btree ("tenant_id","part_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tooling_asset_tenant_idx" ON "master_data"."tooling_asset" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tooling_asset_asset_id_active_unique" ON "master_data"."tooling_asset" USING btree ("tenant_id","asset_id") WHERE "master_data"."tooling_asset"."is_active";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tooling_eligible_resource_asset_idx" ON "master_data"."tooling_eligible_resource" USING btree ("tooling_asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tooling_eligible_resource_resource_idx" ON "master_data"."tooling_eligible_resource" USING btree ("resource_id");