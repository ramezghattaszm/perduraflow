CREATE TABLE IF NOT EXISTS "master_data"."uom_conversion" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"part_id" text NOT NULL,
	"alternate_uom" text NOT NULL,
	"base_uom" text NOT NULL,
	"factor" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uom_conversion_part_alt_unique" UNIQUE("tenant_id","part_id","alternate_uom")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_data"."uom_conversion" ADD CONSTRAINT "uom_conversion_part_id_part_id_fk" FOREIGN KEY ("part_id") REFERENCES "master_data"."part"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uom_conversion_tenant_idx" ON "master_data"."uom_conversion" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uom_conversion_part_idx" ON "master_data"."uom_conversion" USING btree ("part_id");