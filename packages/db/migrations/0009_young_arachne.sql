ALTER TABLE "privacy_deletion_jobs" ADD COLUMN "evidence_pseudonym" text;--> statement-breakpoint
ALTER TABLE "privacy_deletion_jobs" ADD COLUMN "backup_policy_version" text;--> statement-breakpoint
ALTER TABLE "privacy_deletion_jobs" ADD COLUMN "backup_verification_state" text;--> statement-breakpoint
ALTER TABLE "privacy_deletion_jobs" ADD COLUMN "backup_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_processor_attempts" ADD COLUMN "idempotency_key" text;