CREATE TABLE IF NOT EXISTS "scheduling"."constraint_set" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduling"."schedule_version" ADD COLUMN "constraint_set_ref" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "constraint_set_tenant_idx" ON "scheduling"."constraint_set" USING btree ("tenant_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduling"."schedule_version" ADD CONSTRAINT "schedule_version_constraint_set_ref_constraint_set_id_fk" FOREIGN KEY ("constraint_set_ref") REFERENCES "scheduling"."constraint_set"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
