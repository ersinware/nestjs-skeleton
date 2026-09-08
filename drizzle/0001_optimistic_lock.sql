ALTER TABLE "admin"."admin" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user"."user" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;