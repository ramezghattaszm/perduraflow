CREATE TABLE IF NOT EXISTS "config"."reference_set_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"set_key" text NOT NULL,
	"level" text NOT NULL,
	"scope_id" text NOT NULL,
	"member_key" text NOT NULL,
	"action" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"revision" integer NOT NULL,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reference_set_audit_scope_idx" ON "config"."reference_set_audit" USING btree ("tenant_id","set_key","level","scope_id");