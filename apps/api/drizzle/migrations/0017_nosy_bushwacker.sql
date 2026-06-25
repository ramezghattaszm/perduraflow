CREATE TABLE IF NOT EXISTS "master_data"."resource_downtime" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"kind" text NOT NULL,
	"planned" boolean DEFAULT false NOT NULL,
	"from_ts" timestamp with time zone NOT NULL,
	"to_ts" timestamp with time zone NOT NULL,
	"reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduling"."scheduled_operation" ADD COLUMN "binding_downtime_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_downtime_plant_idx" ON "master_data"."resource_downtime" USING btree ("tenant_id","plant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_downtime_resource_idx" ON "master_data"."resource_downtime" USING btree ("tenant_id","resource_id");--> statement-breakpoint
ALTER TABLE "org"."calendar" DROP COLUMN IF EXISTS "maintenance_windows";