CREATE TABLE IF NOT EXISTS "master_data"."resource_type_config" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"splittable" boolean DEFAULT false NOT NULL,
	"ot_cap_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org"."calendar" ADD COLUMN "working_days" jsonb DEFAULT '[1,2,3,4,5,6]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "master_data"."resource" ADD COLUMN "ot_cap_minutes" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_type_config_tenant_idx" ON "master_data"."resource_type_config" USING btree ("tenant_id");