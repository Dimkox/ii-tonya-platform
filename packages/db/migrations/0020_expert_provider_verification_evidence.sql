ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "verification_id" text;
ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "verifier_key_version" text;
ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "verified_at" timestamp with time zone;
UPDATE "expert_residency_provider_event_inbox" SET "verification_id" = 'legacy', "verifier_key_version" = 'legacy', "verified_at" = "received_at" WHERE "verification_id" IS NULL;
ALTER TABLE "expert_residency_provider_event_inbox" ALTER COLUMN "verification_id" SET NOT NULL;
ALTER TABLE "expert_residency_provider_event_inbox" ALTER COLUMN "verifier_key_version" SET NOT NULL;
ALTER TABLE "expert_residency_provider_event_inbox" ALTER COLUMN "verified_at" SET NOT NULL;
