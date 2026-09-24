ALTER TABLE "admin"."email_change_notification" RENAME COLUMN "account_id" TO "aggregate_id";--> statement-breakpoint
ALTER TABLE "user"."email_change_notification" RENAME COLUMN "account_id" TO "aggregate_id";--> statement-breakpoint
