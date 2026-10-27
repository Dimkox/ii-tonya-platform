ALTER TABLE "privacy_deletion_jobs" ADD CONSTRAINT "privacy_deletion_jobs_id_subject_unique" UNIQUE ("id", "user_id");
--> statement-breakpoint
CREATE TABLE "client_erasure_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "receipt_digest" text NOT NULL,
  "receipt_revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "job_id" uuid,
  CONSTRAINT "client_erasure_requests_subject_unique" UNIQUE ("user_id"),
  CONSTRAINT "client_erasure_requests_digest_unique" UNIQUE ("receipt_digest"),
  CONSTRAINT "client_erasure_requests_job_unique" UNIQUE ("job_id"),
  CONSTRAINT "client_erasure_requests_digest_check" CHECK ("receipt_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "client_erasure_requests_created_check" CHECK (isfinite("created_at")),
  CONSTRAINT "client_erasure_requests_job_subject_fk" FOREIGN KEY ("job_id", "user_id")
    REFERENCES "privacy_deletion_jobs"("id", "user_id")
);
