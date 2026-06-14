CREATE SCHEMA "tenant";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "org";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant"."tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth"."approval_tier" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth"."role" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default_seed" boolean DEFAULT false NOT NULL,
	"data_scope" text DEFAULT 'plant' NOT NULL,
	"scoped_plant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scoped_plant_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_tier_id" text,
	"can_configure" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"avatar_url" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"role_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth"."otp_code" (
	"id" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"type" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org"."plant" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"region" text,
	"location" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org"."plant_group" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"group_type" text NOT NULL,
	"allows_resource_sharing" boolean DEFAULT false NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org"."plant_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_group_id" text NOT NULL,
	"plant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org"."customer" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"firm_fence_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org"."program" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"name" text NOT NULL,
	"firm_fence_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org"."calendar" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plant_id" text,
	"name" text NOT NULL,
	"shift_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"holidays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"maintenance_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth"."role" ADD CONSTRAINT "role_approval_tier_id_approval_tier_id_fk" FOREIGN KEY ("approval_tier_id") REFERENCES "auth"."approval_tier"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth"."user" ADD CONSTRAINT "user_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "auth"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org"."plant_group_member" ADD CONSTRAINT "plant_group_member_plant_group_id_plant_group_id_fk" FOREIGN KEY ("plant_group_id") REFERENCES "org"."plant_group"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org"."plant_group_member" ADD CONSTRAINT "plant_group_member_plant_id_plant_id_fk" FOREIGN KEY ("plant_id") REFERENCES "org"."plant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org"."program" ADD CONSTRAINT "program_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "org"."customer"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_tier_tenant_idx" ON "auth"."approval_tier" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_tenant_idx" ON "auth"."role" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tenant_idx" ON "auth"."user" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plant_tenant_idx" ON "org"."plant" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plant_group_tenant_idx" ON "org"."plant_group" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plant_group_member_tenant_idx" ON "org"."plant_group_member" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plant_group_member_group_idx" ON "org"."plant_group_member" USING btree ("plant_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_tenant_idx" ON "org"."customer" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_tenant_idx" ON "org"."program" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_customer_idx" ON "org"."program" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_tenant_idx" ON "org"."calendar" USING btree ("tenant_id");