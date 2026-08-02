ALTER TABLE "message_packages" ADD COLUMN "kind" text DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "message_packages" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_packages" ADD COLUMN "granted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "message_packages" SET "granted_at" = "created_at" WHERE "granted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "message_packages" ALTER COLUMN "granted_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "message_packages" ALTER COLUMN "granted_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "message_packages_eligible_order" ON "message_packages" USING btree ("user_id","kind","expires_at","granted_at","id");--> statement-breakpoint
ALTER TABLE "message_packages" ADD CONSTRAINT "message_packages_kind_allowed" CHECK ("message_packages"."kind" in ('admin', 'paid', 'intro'));
