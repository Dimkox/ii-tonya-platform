ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "verification_id" text;--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "verifier_key_version" text;--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "expert_residency_provider_event_inbox"
SET "verification_id" = 'legacy-unverified:' || "id"::text,
    "verifier_key_version" = 'legacy-unverified',
    "verified_at" = "received_at",
    "authenticated" = false
WHERE "verification_id" IS NULL;--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ALTER COLUMN "verification_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ALTER COLUMN "verifier_key_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ALTER COLUMN "verified_at" SET NOT NULL;
