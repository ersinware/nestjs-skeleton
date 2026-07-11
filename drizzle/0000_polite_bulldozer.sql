CREATE TYPE "public"."outbox_status" AS ENUM('PENDING', 'QUEUED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('admin', 'super_admin');--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_id" text NOT NULL,
	"type" text NOT NULL,
	"status" "outbox_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin.admin" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password" text NOT NULL,
	"role" "admin_role" DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin.admin_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user.user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user.user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "idx_outbox_pending_status" ON "outbox" USING btree ("id") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "admins_id_deleted_at_idx" ON "admin.admin" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "users_id_deleted_at_idx" ON "user.user" USING btree ("id") WHERE deleted_at IS NULL;