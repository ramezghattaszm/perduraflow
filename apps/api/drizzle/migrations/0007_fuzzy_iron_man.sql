CREATE TABLE IF NOT EXISTS "scheduling"."historical_outcome" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"resource_id" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"otif" double precision NOT NULL,
	"cost_per_unit" double precision,
	"oee_availability" double precision,
	"oee_performance" double precision,
	"oee_quality" double precision,
	"oee" double precision,
	"late_orders" integer DEFAULT 0 NOT NULL,
	"throughput" double precision,
	"label" text NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduling"."what_if_narration" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"result_id" text NOT NULL,
	"option_id" text,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"prose" text,
	"model" text,
	"prompt_version" text,
	"provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduling"."what_if_result" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"base_version_id" text NOT NULL,
	"change_set" jsonb NOT NULL,
	"base_kpis" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"recommended_option_id" text,
	"determinism_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduling"."what_if_narration" ADD CONSTRAINT "what_if_narration_result_id_what_if_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "scheduling"."what_if_result"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "historical_outcome_tenant_idx" ON "scheduling"."historical_outcome" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "historical_outcome_plant_idx" ON "scheduling"."historical_outcome" USING btree ("plant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "what_if_narration_result_idx" ON "scheduling"."what_if_narration" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "what_if_result_tenant_idx" ON "scheduling"."what_if_result" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "what_if_result_determinism_idx" ON "scheduling"."what_if_result" USING btree ("determinism_key");