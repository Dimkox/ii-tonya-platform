CREATE TABLE "provider_subject_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject_token" text NOT NULL,
	"subject_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_subject_mappings_provider_token_unique" UNIQUE("provider","subject_token")
);
--> statement-breakpoint
CREATE TABLE "privacy_deletion_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deletion_job_id" uuid NOT NULL,
	"processor" text NOT NULL,
	"manifest_ciphertext" text NOT NULL,
	"subject_deletion_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_deletion_manifests_job_processor_unique" UNIQUE("deletion_job_id","processor")
);
--> statement-breakpoint
CREATE TABLE "privacy_retention_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_class" text NOT NULL,
	"content_ref" text,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text,
	"receipt_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
UPDATE "privacy_processor_attempts"
SET "idempotency_key" = 'legacy:' || "id"::text
WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "privacy_processor_attempts" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_deletion_jobs" ADD COLUMN "legacy_provider_identifier_evidence" text;--> statement-breakpoint
ALTER TABLE "privacy_deletion_jobs" ADD COLUMN "erasure_receipt" jsonb;--> statement-breakpoint
ALTER TABLE "provider_subject_mappings" ADD CONSTRAINT "provider_subject_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_deletion_manifests" ADD CONSTRAINT "privacy_deletion_manifests_deletion_job_id_privacy_deletion_jobs_id_fk" FOREIGN KEY ("deletion_job_id") REFERENCES "public"."privacy_deletion_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_processor_attempts" ADD CONSTRAINT "privacy_processor_attempts_idempotency_unique" UNIQUE("idempotency_key");
