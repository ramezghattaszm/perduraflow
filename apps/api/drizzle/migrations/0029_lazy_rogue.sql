CREATE TABLE IF NOT EXISTS "master_data"."part_plant" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"part_no" text NOT NULL,
	"plant_id" text NOT NULL,
	"make_buy" text,
	"material" text,
	"gauge" text,
	"colour" text,
	"tool_family" text,
	"shared_attributes" jsonb,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"supersedes_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."part_plant" ADD CONSTRAINT "part_plant_supersedes_id_part_plant_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "master_data"."part_plant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_plant_tenant_idx" ON "master_data"."part_plant" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "part_plant_tenant_part_plant_open_unique" ON "master_data"."part_plant" USING btree ("tenant_id","part_no","plant_id") WHERE "master_data"."part_plant"."effective_to" is null;