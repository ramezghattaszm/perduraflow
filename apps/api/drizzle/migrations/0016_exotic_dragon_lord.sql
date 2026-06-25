CREATE SCHEMA "config";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config"."config_override" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"setting_group" text NOT NULL,
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
CREATE TABLE IF NOT EXISTS "config"."config_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"setting_group" text NOT NULL,
	"level" text NOT NULL,
	"scope_id" text NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"revision" integer NOT NULL,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "config_override_active_unique" ON "config"."config_override" USING btree ("tenant_id","setting_group","level","scope_id") WHERE "config"."config_override"."is_active";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_audit_scope_idx" ON "config"."config_audit" USING btree ("tenant_id","setting_group","level","scope_id");