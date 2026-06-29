CREATE TABLE IF NOT EXISTS "learning"."cycle_record" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"op_actual_id" text NOT NULL,
	"piece_idx" integer NOT NULL,
	"cycle_ms" double precision NOT NULL,
	"good" boolean NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning"."cycle_record" ADD CONSTRAINT "cycle_record_op_actual_id_execution_actual_id_fk" FOREIGN KEY ("op_actual_id") REFERENCES "learning"."execution_actual"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycle_record_tenant_idx" ON "learning"."cycle_record" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycle_record_op_actual_idx" ON "learning"."cycle_record" USING btree ("op_actual_id");