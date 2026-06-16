CREATE SCHEMA "policy";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning"."parameter_prediction" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"routing_operation_id" text NOT NULL,
	"param" text NOT NULL,
	"predicted_value" double precision NOT NULL,
	"threshold" double precision NOT NULL,
	"crossing_at" timestamp with time zone,
	"horizon_minutes" integer NOT NULL,
	"confidence" double precision NOT NULL,
	"fit_slope" double precision NOT NULL,
	"fit_r2" double precision NOT NULL,
	"window_size" integer DEFAULT 0 NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"proposed_action" text NOT NULL,
	"action_tier" text NOT NULL,
	"disposition" text NOT NULL,
	"applied_learned_value" double precision,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"superseded_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy"."autonomy_config" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tier1_auto_threshold" double precision DEFAULT 0.75 NOT NULL,
	"tier2_mode" text DEFAULT 'advisory' NOT NULL,
	"wear_band_override" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autonomy_config_tenant_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parameter_prediction_tenant_idx" ON "learning"."parameter_prediction" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parameter_prediction_key_idx" ON "learning"."parameter_prediction" USING btree ("tenant_id","resource_id","routing_operation_id","param");