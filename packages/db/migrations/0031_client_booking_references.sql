ALTER TABLE "client_sessions" DROP CONSTRAINT "client_sessions_scope_check";
--> statement-breakpoint
ALTER TABLE "client_sessions" ADD CONSTRAINT "client_sessions_scope_check" CHECK ("scope" IN ('client_catalog:read','client_booking:write'));
--> statement-breakpoint
CREATE TABLE "client_catalog_choices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "choice_digest" char(71) NOT NULL,
  "slot_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_catalog_choices_choice_digest_unique" UNIQUE("choice_digest"),
  CONSTRAINT "client_catalog_choices_request_id_client_catalog_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."client_catalog_requests"("id") ON DELETE CASCADE,
  CONSTRAINT "client_catalog_choices_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE NO ACTION,
  CONSTRAINT "client_catalog_choices_choice_digest_check" CHECK ("choice_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "client_catalog_choices_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE INDEX "client_catalog_choices_request_expiry_idx" ON "client_catalog_choices" ("request_id","expires_at","id");
--> statement-breakpoint
CREATE TABLE "client_booking_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "choice_digest" char(71) NOT NULL,
  "booking_handle" char(47) NOT NULL,
  "reservation_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_booking_receipts_user_choice_unique" UNIQUE("user_id","choice_digest"),
  CONSTRAINT "client_booking_receipts_booking_handle_unique" UNIQUE("booking_handle"),
  CONSTRAINT "client_booking_receipts_reservation_unique" UNIQUE("reservation_id"),
  CONSTRAINT "client_booking_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "client_booking_receipts_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE CASCADE,
  CONSTRAINT "client_booking_receipts_choice_digest_check" CHECK ("choice_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "client_booking_receipts_booking_handle_check" CHECK ("booking_handle" ~ '^bk1\.[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
CREATE INDEX "client_booking_receipts_owner_handle_idx" ON "client_booking_receipts" ("user_id","booking_handle");
--> statement-breakpoint
CREATE TABLE "client_booking_erasure_work" (
  "deletion_job_id" uuid PRIMARY KEY NOT NULL,
  "phase" text DEFAULT 'cancel_active' NOT NULL,
  "lease_token" uuid,
  "lease_until" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_booking_erasure_work_deletion_job_id_privacy_deletion_jobs_id_fk" FOREIGN KEY ("deletion_job_id") REFERENCES "public"."privacy_deletion_jobs"("id") ON DELETE CASCADE,
  CONSTRAINT "client_booking_erasure_work_phase_check" CHECK ("phase" IN ('cancel_active','cleanup_public','complete','dead_letter')),
  CONSTRAINT "client_booking_erasure_work_attempt_count_check" CHECK ("attempt_count" BETWEEN 0 AND 5),
  CONSTRAINT "client_booking_erasure_work_lease_check" CHECK (("lease_token" IS NULL) = ("lease_until" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "client_booking_erasure_work_claim_idx" ON "client_booking_erasure_work" ("phase","lease_until","updated_at") WHERE "phase" IN ('cancel_active','cleanup_public');
--> statement-breakpoint
CREATE FUNCTION client_booking_guard_privacy_completion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('processor_complete','backup_verified')
     AND EXISTS (
       SELECT 1 FROM client_booking_erasure_work w
       WHERE w.deletion_job_id=NEW.id AND w.phase <> 'complete'
     ) THEN
    RAISE EXCEPTION 'client_booking_erasure_incomplete' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER client_booking_privacy_completion_guard
BEFORE UPDATE OF status ON privacy_deletion_jobs
FOR EACH ROW EXECUTE FUNCTION client_booking_guard_privacy_completion();
