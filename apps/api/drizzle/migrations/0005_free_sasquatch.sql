CREATE SCHEMA "learning";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning"."execution_actual" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actual_event_id" text NOT NULL,
	"schedule_version_id" text NOT NULL,
	"scheduled_operation_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"routing_operation_id" text NOT NULL,
	"part_id" text NOT NULL,
	"actual_start" timestamp with time zone NOT NULL,
	"actual_end" timestamp with time zone NOT NULL,
	"actual_setup_time" double precision,
	"actual_cycle_time" double precision,
	"std_setup_time" double precision DEFAULT 0 NOT NULL,
	"std_cycle_time" double precision DEFAULT 0 NOT NULL,
	"good_qty" double precision NOT NULL,
	"scrap_qty" double precision DEFAULT 0 NOT NULL,
	"downtime_minutes" double precision DEFAULT 0 NOT NULL,
	"downtime_reason" text,
	"source" text DEFAULT 'simulator' NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning"."learned_parameter" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"routing_operation_id" text NOT NULL,
	"param" text NOT NULL,
	"std_baseline" double precision NOT NULL,
	"learned_value" double precision,
	"source" text DEFAULT 'standard' NOT NULL,
	"confidence" double precision,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"window_size" integer DEFAULT 0 NOT NULL,
	"window_mean" double precision DEFAULT 0 NOT NULL,
	"window_stddev" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'learning' NOT NULL,
	"last_stepped_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learned_parameter_key_unique" UNIQUE("tenant_id","resource_id","routing_operation_id","param")
);
--> statement-breakpoint
ALTER TABLE "master_data"."resource" ADD COLUMN "run_cost_per_hour" double precision;--> statement-breakpoint
ALTER TABLE "master_data"."resource" ADD COLUMN "setup_cost" double precision;--> statement-breakpoint
ALTER TABLE "master_data"."resource" ADD COLUMN "overhead_per_unit" double precision;--> statement-breakpoint
ALTER TABLE "master_data"."operator" ADD COLUMN "available" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_actual_tenant_idx" ON "learning"."execution_actual" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_actual_version_idx" ON "learning"."execution_actual" USING btree ("schedule_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_actual_op_idx" ON "learning"."execution_actual" USING btree ("resource_id","routing_operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learned_parameter_tenant_idx" ON "learning"."learned_parameter" USING btree ("tenant_id");