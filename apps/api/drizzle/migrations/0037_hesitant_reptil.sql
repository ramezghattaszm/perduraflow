CREATE TABLE IF NOT EXISTS "org"."line" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "master_data"."resource" ADD COLUMN "line_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "line_tenant_idx" ON "org"."line" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "line_plant_idx" ON "org"."line" USING btree ("plant_id");