CREATE TABLE IF NOT EXISTS "scheduling"."conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduling"."conversation_turn" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"grounded_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_id" text,
	"model" text,
	"prompt_version" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduling"."conversation_turn" ADD CONSTRAINT "conversation_turn_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "scheduling"."conversation"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_tenant_idx" ON "scheduling"."conversation" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_turn_conv_idx" ON "scheduling"."conversation_turn" USING btree ("conversation_id");