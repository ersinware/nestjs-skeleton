ALTER TABLE "admin"."admin" ADD COLUMN "invite_id" uuid;--> statement-breakpoint
ALTER TABLE "admin"."admin" ADD COLUMN "invite_issued_at" timestamp;--> statement-breakpoint
ALTER TABLE "admin"."admin" ADD COLUMN "invite_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "admin"."admin" ADD COLUMN "invite_revocation_version" integer;--> statement-breakpoint
ALTER TABLE "admin"."admin" ADD CONSTRAINT "admin_invitation_check" CHECK ((
                ("admin"."admin"."invite_id" IS NULL AND "admin"."admin"."invite_issued_at" IS NULL AND "admin"."admin"."invite_expires_at" IS NULL AND "admin"."admin"."invite_revocation_version" IS NULL)
                OR
                ("admin"."admin"."invite_id" IS NOT NULL AND "admin"."admin"."invite_issued_at" IS NOT NULL AND "admin"."admin"."invite_expires_at" IS NOT NULL AND "admin"."admin"."invite_revocation_version" IS NOT NULL
                 AND "admin"."admin"."password" IS NULL AND "admin"."admin"."invite_expires_at" > "admin"."admin"."invite_issued_at" AND "admin"."admin"."invite_revocation_version" >= 0)
            ));