CREATE TABLE IF NOT EXISTS "scheduling"."material_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"component_part_id" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"qty" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduling"."material_requirement" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"part_id" text NOT NULL,
	"component_part_id" text NOT NULL,
	"qty_per_unit" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_availability_tenant_idx" ON "scheduling"."material_availability" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_availability_plant_idx" ON "scheduling"."material_availability" USING btree ("plant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_requirement_tenant_idx" ON "scheduling"."material_requirement" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_requirement_part_idx" ON "scheduling"."material_requirement" USING btree ("part_id");