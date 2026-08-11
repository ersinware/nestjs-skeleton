CREATE SCHEMA "admin";
--> statement-breakpoint
CREATE SCHEMA "user";
--> statement-breakpoint
CREATE TYPE "admin"."admin_role" AS ENUM('admin', 'super_admin');--> statement-breakpoint
CREATE TABLE "admin"."admin" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password" text NOT NULL,
	"role" "admin"."admin_role" DEFAULT 'admin' NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"session_version" integer DEFAULT 0 NOT NULL,
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
	"is_banned" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"session_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "admin_id_live_idx" ON "admin"."admin" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "user_id_live_idx" ON "user"."user" USING btree ("id") WHERE deleted_at IS NULL;