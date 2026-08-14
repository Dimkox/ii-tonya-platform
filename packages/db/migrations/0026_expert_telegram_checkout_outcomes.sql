ALTER TABLE "expert_telegram_residency_callbacks" ADD COLUMN "checkout_status" text DEFAULT 'issued' NOT NULL;
--> statement-breakpoint
ALTER TABLE "expert_telegram_residency_callbacks" ADD COLUMN "checkout_url" varchar(2048);
--> statement-breakpoint
ALTER TABLE "expert_telegram_residency_callbacks" ADD COLUMN "processing_fence" uuid;
--> statement-breakpoint
ALTER TABLE "expert_telegram_residency_callbacks" ADD COLUMN "processing_lease_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "expert_telegram_residency_callbacks" ADD COLUMN "outcome_recorded_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "expert_telegram_residency_callbacks"
SET "checkout_status" = 'unknown', "outcome_recorded_at" = "consumed_at"
WHERE "consumed_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "expert_telegram_residency_callbacks" ADD CONSTRAINT "expert_telegram_residency_callbacks_checkout_state_check" CHECK (("checkout_status" = 'issued' AND "consumed_at" IS NULL) OR ("checkout_status" <> 'issued' AND "consumed_at" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "expert_telegram_residency_callbacks" ADD CONSTRAINT "expert_telegram_residency_callbacks_processing_lease_check" CHECK (("checkout_status" = 'processing' AND "processing_fence" IS NOT NULL AND "processing_lease_until" IS NOT NULL) OR ("checkout_status" <> 'processing' AND "processing_fence" IS NULL AND "processing_lease_until" IS NULL));
--> statement-breakpoint
ALTER TABLE "expert_telegram_residency_callbacks" ADD CONSTRAINT "expert_telegram_residency_callbacks_checkout_outcome_check" CHECK ((("checkout_status" IN ('issued','processing')) AND "outcome_recorded_at" IS NULL AND "checkout_url" IS NULL) OR ("checkout_status" IN ('unavailable','unknown') AND "outcome_recorded_at" IS NOT NULL AND "checkout_url" IS NULL) OR ("checkout_status" = 'ready' AND "outcome_recorded_at" IS NOT NULL AND "checkout_url" IS NOT NULL AND char_length("checkout_url") BETWEEN 1 AND 2048 AND "checkout_url" ~* '^https://[^[:space:]]+$'));
--> statement-breakpoint
CREATE INDEX "expert_telegram_residency_callbacks_processing_lease_idx" ON "expert_telegram_residency_callbacks" USING btree ("processing_lease_until") WHERE "checkout_status" = 'processing';
--> statement-breakpoint
CREATE INDEX "expert_telegram_residency_callbacks_url_cleanup_idx" ON "expert_telegram_residency_callbacks" USING btree ("expires_at") WHERE "checkout_url" IS NOT NULL;
