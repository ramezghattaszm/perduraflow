CREATE TABLE IF NOT EXISTS "config"."reference_set_override" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"set_key" text NOT NULL,
	"level" text NOT NULL,
	"scope_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reference_set_override_active_unique" ON "config"."reference_set_override" USING btree ("tenant_id","set_key","level","scope_id") WHERE "config"."reference_set_override"."is_active";