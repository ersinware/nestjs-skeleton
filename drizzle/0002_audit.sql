CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TABLE "audit"."audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"target_id" uuid,
	"actor_id" uuid,
	"actor_role" text,
	"remote_address" text,
	"route" text,
	"method" text,
	"user_agent" text,
	"trace_id" text,
	"occurred_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_occurred_at_idx" ON "audit"."audit" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit"."audit" USING btree ("actor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit"."audit" USING btree ("target_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit"."audit" USING btree ("action","occurred_at" DESC NULLS LAST);