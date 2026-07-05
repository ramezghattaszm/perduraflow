CREATE TABLE IF NOT EXISTS "master_data"."master_data_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"business_key" text NOT NULL,
	"version_id" text NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"source_ref" text,
	"effective_from" timestamp with time zone,
	"changed_fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_data_audit_tenant_idx" ON "master_data"."master_data_audit" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_data_audit_entity_idx" ON "master_data"."master_data_audit" USING btree ("tenant_id","entity_type","version_id");