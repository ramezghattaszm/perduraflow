CREATE SCHEMA "master_data";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."part" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"part_no" text NOT NULL,
	"description" text,
	"part_type" text NOT NULL,
	"uom" text NOT NULL,
	"material" text,
	"gauge" text,
	"colour" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_tenant_part_no_unique" UNIQUE("tenant_id","part_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."resource" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"resource_type" text NOT NULL,
	"plant_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"rate" double precision,
	"rate_uom" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."resource_group" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"plant_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."resource_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"resource_group_id" text NOT NULL,
	"resource_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."routing" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"part_id" text NOT NULL,
	"name" text NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."routing_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"routing_id" text NOT NULL,
	"op_seq" integer NOT NULL,
	"resource_group_id" text NOT NULL,
	"std_setup_time" double precision DEFAULT 0 NOT NULL,
	"std_cycle_time" double precision DEFAULT 0 NOT NULL,
	"changeover_attribute_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."certification" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certification_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."operator" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"home_plant_id" text NOT NULL,
	"labor_rate" double precision,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_data"."operator_qualification" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"certification_id" text NOT NULL,
	CONSTRAINT "operator_qualification_pair_unique" UNIQUE("operator_id","certification_id")
);
--> statement-breakpoint
ALTER TABLE "org"."customer" ADD COLUMN "priority" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "org"."program" ADD COLUMN "priority" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."resource_group_member" ADD CONSTRAINT "resource_group_member_resource_group_id_resource_group_id_fk" FOREIGN KEY ("resource_group_id") REFERENCES "master_data"."resource_group"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."resource_group_member" ADD CONSTRAINT "resource_group_member_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "master_data"."resource"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."routing" ADD CONSTRAINT "routing_part_id_part_id_fk" FOREIGN KEY ("part_id") REFERENCES "master_data"."part"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."routing_operation" ADD CONSTRAINT "routing_operation_routing_id_routing_id_fk" FOREIGN KEY ("routing_id") REFERENCES "master_data"."routing"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."routing_operation" ADD CONSTRAINT "routing_operation_resource_group_id_resource_group_id_fk" FOREIGN KEY ("resource_group_id") REFERENCES "master_data"."resource_group"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."operator_qualification" ADD CONSTRAINT "operator_qualification_operator_id_operator_id_fk" FOREIGN KEY ("operator_id") REFERENCES "master_data"."operator"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."operator_qualification" ADD CONSTRAINT "operator_qualification_certification_id_certification_id_fk" FOREIGN KEY ("certification_id") REFERENCES "master_data"."certification"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_tenant_idx" ON "master_data"."part" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_tenant_idx" ON "master_data"."resource" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_group_tenant_idx" ON "master_data"."resource_group" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rgm_group_idx" ON "master_data"."resource_group_member" USING btree ("resource_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rgm_resource_idx" ON "master_data"."resource_group_member" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_tenant_idx" ON "master_data"."routing" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_part_idx" ON "master_data"."routing" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_operation_routing_idx" ON "master_data"."routing_operation" USING btree ("routing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certification_tenant_idx" ON "master_data"."certification" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_tenant_idx" ON "master_data"."operator" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_qualification_operator_idx" ON "master_data"."operator_qualification" USING btree ("operator_id");