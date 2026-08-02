ALTER TABLE "feedback" ALTER COLUMN "reservation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "source_event_id" text;--> statement-breakpoint
UPDATE "feedback" SET "source_event_id" = 'legacy:' || "id"::text WHERE "source_event_id" IS NULL;--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "source_event_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "content_hash" text NOT NULL DEFAULT 'legacy-unavailable';--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "negative_policy_version" text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "escalation_status" text NOT NULL DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_source_event_unique" UNIQUE("source_event_id");
