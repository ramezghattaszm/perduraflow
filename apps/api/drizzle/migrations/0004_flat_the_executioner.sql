CREATE SCHEMA "binding";
--> statement-breakpoint
CREATE SCHEMA "scheduling";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "binding"."contract_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"major" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_binding_tenant_contract_major_unique" UNIQUE("tenant_id","contract_id","major")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduling"."demand_input" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"demand_line_id" text NOT NULL,
	"release_reference" text,
	"part_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"program_id" text,
	"demand_type" text DEFAULT 'stock' NOT NULL,
	"firmness" text NOT NULL,
	"required_qty" double precision NOT NULL,
	"uom" text NOT NULL,
	"required_date" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduling"."optimizer_run" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"objective_summary" text NOT NULL,
	"status" text NOT NULL,
	"stop_reason" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"input_demand_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduling"."schedule_version" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"horizon_start" timestamp with time zone NOT NULL,
	"horizon_end" timestamp with time zone NOT NULL,
	"optimizer_run_id" text NOT NULL,
	"supersedes_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduling"."scheduled_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"schedule_version_id" text NOT NULL,
	"demand_line_id" text NOT NULL,
	"part_id" text NOT NULL,
	"routing_operation_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"op_seq" integer NOT NULL,
	"sequence_position" integer NOT NULL,
	"planned_start" timestamp with time zone NOT NULL,
	"planned_end" timestamp with time zone NOT NULL,
	"planned_qty" double precision NOT NULL,
	"setup_time" double precision NOT NULL,
	"cycle_time" double precision NOT NULL,
	"setup_source" text DEFAULT 'standard' NOT NULL,
	"cycle_source" text DEFAULT 'standard' NOT NULL,
	"setup_confidence" double precision,
	"cycle_confidence" double precision,
	"at_risk" boolean DEFAULT false NOT NULL,
	"at_risk_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduling"."schedule_version" ADD CONSTRAINT "schedule_version_optimizer_run_id_optimizer_run_id_fk" FOREIGN KEY ("optimizer_run_id") REFERENCES "scheduling"."optimizer_run"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduling"."scheduled_operation" ADD CONSTRAINT "scheduled_operation_schedule_version_id_schedule_version_id_fk" FOREIGN KEY ("schedule_version_id") REFERENCES "scheduling"."schedule_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_binding_tenant_idx" ON "binding"."contract_binding" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demand_input_tenant_idx" ON "scheduling"."demand_input" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demand_input_plant_idx" ON "scheduling"."demand_input" USING btree ("plant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "optimizer_run_tenant_idx" ON "scheduling"."optimizer_run" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_version_tenant_idx" ON "scheduling"."schedule_version" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_version_plant_idx" ON "scheduling"."schedule_version" USING btree ("plant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_operation_version_idx" ON "scheduling"."scheduled_operation" USING btree ("schedule_version_id");