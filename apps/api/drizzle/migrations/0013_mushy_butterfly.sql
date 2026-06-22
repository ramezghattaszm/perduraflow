ALTER TABLE "scheduling"."scheduled_operation" ADD COLUMN "binding_kind" text;--> statement-breakpoint
ALTER TABLE "scheduling"."scheduled_operation" ADD COLUMN "binding_blocker_demand_line_id" text;--> statement-breakpoint
ALTER TABLE "scheduling"."scheduled_operation" ADD COLUMN "binding_blocker_op_seq" integer;