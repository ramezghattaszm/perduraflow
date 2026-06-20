CREATE TABLE IF NOT EXISTS "scheduling"."resource_operator_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "master_data"."operator" ADD COLUMN "performance_factor" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_operator_assignment_tenant_idx" ON "scheduling"."resource_operator_assignment" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_operator_assignment_resource_idx" ON "scheduling"."resource_operator_assignment" USING btree ("resource_id");