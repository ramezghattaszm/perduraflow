CREATE TABLE IF NOT EXISTS "master_data"."bom" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"parent_part_no" text NOT NULL,
	"revision" text DEFAULT 'A' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"supersedes_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."bom_component" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"bom_id" text NOT NULL,
	"component_part_no" text NOT NULL,
	"qty_per" numeric NOT NULL,
	"scrap_pct" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."bom" ADD CONSTRAINT "bom_supersedes_id_bom_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "master_data"."bom"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."bom_component" ADD CONSTRAINT "bom_component_bom_id_bom_id_fk" FOREIGN KEY ("bom_id") REFERENCES "master_data"."bom"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_tenant_idx" ON "master_data"."bom" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_parent_draft_unique" ON "master_data"."bom" USING btree ("tenant_id","parent_part_no") WHERE "master_data"."bom"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_parent_published_open_unique" ON "master_data"."bom" USING btree ("tenant_id","parent_part_no") WHERE "master_data"."bom"."status" = 'published' and "master_data"."bom"."effective_to" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_component_bom_idx" ON "master_data"."bom_component" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_component_tenant_idx" ON "master_data"."bom_component" USING btree ("tenant_id");