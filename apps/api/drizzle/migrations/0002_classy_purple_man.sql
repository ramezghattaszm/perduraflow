ALTER TABLE "tenant"."tenant" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;