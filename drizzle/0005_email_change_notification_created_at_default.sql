ALTER TABLE "admin"."email_change_notification" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user"."email_change_notification" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
