CREATE SCHEMA "admin";
--> statement-breakpoint
CREATE SCHEMA "user";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TABLE "admin"."admin" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password" text,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"session_version" integer DEFAULT 0 NOT NULL,
	"revocation_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user"."user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password" text NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"session_version" integer DEFAULT 0 NOT NULL,
	"revocation_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit"."audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"detail" jsonb,
	"target_id" uuid,
	"actor_id" uuid,
	"actor_type" text,
	"remote_address" text,
	"route" text,
	"method" text,
	"user_agent" text,
	"trace_id" text,
	"occurred_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_id_live_idx" ON "admin"."admin" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_root_unique_idx" ON "admin"."admin" USING btree ((1)) WHERE 'admin:root' = ANY(permissions);--> statement-breakpoint
CREATE INDEX "user_id_live_idx" ON "user"."user" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "audit_occurred_at_idx" ON "audit"."audit" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit"."audit" USING btree ("actor_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit"."audit" USING btree ("target_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit"."audit" USING btree ("action","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);