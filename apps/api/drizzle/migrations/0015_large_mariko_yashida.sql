ALTER TABLE "learning"."parameter_prediction" ADD COLUMN "dismissed_at_confidence" double precision;--> statement-breakpoint
ALTER TABLE "learning"."parameter_prediction" ADD COLUMN "dismissed_at_horizon_minutes" integer;--> statement-breakpoint
ALTER TABLE "policy"."autonomy_config" ADD COLUMN "snooze_conf_delta" double precision;--> statement-breakpoint
ALTER TABLE "policy"."autonomy_config" ADD COLUMN "snooze_urgency_minutes" integer;