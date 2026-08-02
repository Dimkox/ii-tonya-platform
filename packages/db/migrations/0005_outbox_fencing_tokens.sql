ALTER TABLE "integration_outbox" ADD COLUMN "dispatch_claim_token" text;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "reconciliation_claim_token" text;
