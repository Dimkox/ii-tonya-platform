CREATE TABLE "expert_residency_receipt_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "contact_kind" text NOT NULL,
  "ciphertext" text NOT NULL,
  "key_reference" text NOT NULL,
  "consent_id" uuid NOT NULL,
  "consent_decision" text NOT NULL,
  "consent_purpose" text NOT NULL,
  "policy_version" text NOT NULL,
  "verified_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT transaction_timestamp() NOT NULL,
  CONSTRAINT "expert_receipt_contacts_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE restrict,
  CONSTRAINT "expert_receipt_contacts_consent_fk" FOREIGN KEY ("consent_id") REFERENCES "consents"("id") ON DELETE restrict,
  CONSTRAINT "expert_receipt_contacts_kind" CHECK ("contact_kind" in ('email','phone')),
  CONSTRAINT "expert_receipt_contacts_ciphertext" CHECK (length("ciphertext") between 1 and 8192),
  CONSTRAINT "expert_receipt_contacts_key_reference" CHECK ("key_reference" ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9._/-]{1,192}$'),
  CONSTRAINT "expert_receipt_contacts_consent" CHECK ("consent_decision" in ('granted','denied')),
  CONSTRAINT "expert_receipt_contacts_verification" CHECK (("consent_decision" = 'granted' and "verified_at" is not null) or ("consent_decision" = 'denied' and "verified_at" is null)),
  CONSTRAINT "expert_receipt_contacts_revocation" CHECK ("revoked_at" is null or ("verified_at" is not null and "revoked_at" >= "verified_at"))
);
--> statement-breakpoint
CREATE INDEX "expert_receipt_contacts_authority_idx" ON "expert_residency_receipt_contacts" ("user_id","consent_purpose","policy_version","created_at" DESC,"id" DESC);
--> statement-breakpoint
CREATE TRIGGER "expert_receipt_contacts_append_only" BEFORE UPDATE OR DELETE ON "expert_residency_receipt_contacts" FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD COLUMN "replay_ciphertext" text;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD COLUMN "replay_key_reference" text;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD COLUMN "replay_body_version" integer;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD COLUMN "recovery_attempt" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD COLUMN "recovery_next_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD COLUMN "recovery_lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD COLUMN "recovery_lease_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD COLUMN "recovery_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD COLUMN "manual_review_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD CONSTRAINT "expert_provider_operations_replay_bundle" CHECK (
  ("replay_ciphertext" is null and "replay_key_reference" is null and "replay_body_version" is null and "recovery_expires_at" is null)
  or
  (length("replay_ciphertext") between 1 and 32768 and "replay_key_reference" ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9._/-]{1,192}$' and "replay_body_version" between 1 and 2147483647 and "recovery_expires_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD CONSTRAINT "expert_provider_operations_recovery_attempt" CHECK ("recovery_attempt" between 0 and 100);
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD CONSTRAINT "expert_provider_operations_recovery_lease" CHECK (("recovery_lease_token" is null) = ("recovery_lease_until" is null));
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_operations" ADD CONSTRAINT "expert_provider_operations_manual_review" CHECK ("manual_review_at" is null or ("provider_object_id" is null and "status" = 'unknown_outcome'));
--> statement-breakpoint
CREATE INDEX "expert_provider_operations_unbound_recovery_idx" ON "expert_residency_provider_operations" ("recovery_next_at","created_at","id")
WHERE "provider_object_id" is null AND "status" = 'unknown_outcome' AND "replay_ciphertext" is not null AND "manual_review_at" is null;
