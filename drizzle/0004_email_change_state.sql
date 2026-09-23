CREATE TABLE "admin"."email_change_notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"previous_email" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user"."email_change_notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"previous_email" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin"."admin" ADD COLUMN "pending_email_request_id" uuid;--> statement-breakpoint
ALTER TABLE "admin"."admin" ADD COLUMN "pending_email" text;--> statement-breakpoint
ALTER TABLE "admin"."admin" ADD COLUMN "pending_email_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "admin"."admin" ADD COLUMN "pending_email_revocation_version" integer;--> statement-breakpoint
ALTER TABLE "user"."user" ADD COLUMN "pending_email_request_id" uuid;--> statement-breakpoint
ALTER TABLE "user"."user" ADD COLUMN "pending_email" text;--> statement-breakpoint
ALTER TABLE "user"."user" ADD COLUMN "pending_email_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user"."user" ADD COLUMN "pending_email_revocation_version" integer;--> statement-breakpoint
ALTER TABLE "admin"."admin" ADD CONSTRAINT "admin_pending_email_check" CHECK ((
                ("admin"."admin"."pending_email_request_id" IS NULL AND "admin"."admin"."pending_email" IS NULL
                 AND "admin"."admin"."pending_email_expires_at" IS NULL AND "admin"."admin"."pending_email_revocation_version" IS NULL)
                OR
                ("admin"."admin"."pending_email_request_id" IS NOT NULL AND "admin"."admin"."pending_email" IS NOT NULL
                 AND "admin"."admin"."pending_email_expires_at" IS NOT NULL AND "admin"."admin"."pending_email_revocation_version" IS NOT NULL
                 AND "admin"."admin"."pending_email_revocation_version" >= 0 AND "admin"."admin"."password" IS NOT NULL)
            ));--> statement-breakpoint
ALTER TABLE "user"."user" ADD CONSTRAINT "user_pending_email_check" CHECK ((
                ("user"."user"."pending_email_request_id" IS NULL AND "user"."user"."pending_email" IS NULL
                 AND "user"."user"."pending_email_expires_at" IS NULL AND "user"."user"."pending_email_revocation_version" IS NULL)
                OR
                ("user"."user"."pending_email_request_id" IS NOT NULL AND "user"."user"."pending_email" IS NOT NULL
                 AND "user"."user"."pending_email_expires_at" IS NOT NULL AND "user"."user"."pending_email_revocation_version" IS NOT NULL
                 AND "user"."user"."pending_email_revocation_version" >= 0)
            ));