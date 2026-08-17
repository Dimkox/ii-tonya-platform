ALTER TABLE "provider_subject_mappings" ADD COLUMN "tenant_token" text;--> statement-breakpoint
ALTER TABLE "provider_subject_mappings" ADD COLUMN "token_version" integer;--> statement-breakpoint
ALTER TABLE "provider_subject_mappings" ADD CONSTRAINT "provider_subject_mappings_conversation_token_check" CHECK (("provider" = 'selarti.client-thread.v1' AND "tenant_token" ~ '^hmac-sha256:v1:[0-9a-f]{64}$' AND "token_version" = 1) OR ("provider" <> 'selarti.client-thread.v1' AND "tenant_token" IS NULL AND "token_version" IS NULL));--> statement-breakpoint
CREATE INDEX "provider_subject_mappings_conversation_lookup_idx" ON "provider_subject_mappings" ("provider","tenant_token","subject_token","token_version");--> statement-breakpoint
CREATE TABLE "client_conversation_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_subject_mapping_id" uuid NOT NULL,
  "scope" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_conversation_grants_mapping_scope_unique" UNIQUE("provider_subject_mapping_id","scope"),
  CONSTRAINT "client_conversation_grants_provider_subject_mapping_id_provider_subject_mappings_id_fk" FOREIGN KEY ("provider_subject_mapping_id") REFERENCES "public"."provider_subject_mappings"("id") ON DELETE CASCADE,
  CONSTRAINT "client_conversation_grants_scope_check" CHECK ("scope" IN ('client_catalog:read','client_booking:write')),
  CONSTRAINT "client_conversation_grants_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "client_conversation_grants_revocation_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);--> statement-breakpoint
CREATE INDEX "client_conversation_grants_mapping_scope_lookup_idx" ON "client_conversation_grants" ("provider_subject_mapping_id","scope","expires_at");--> statement-breakpoint
CREATE TABLE "client_conversation_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_event_id" uuid NOT NULL,
  "binding_id" uuid,
  "required_scope" text NOT NULL,
  "tool_kind" text NOT NULL,
  "proposal_digest" char(64) NOT NULL,
  "payload_envelope_version" smallint,
  "payload_key_id" text,
  "payload_nonce" bytea,
  "payload_ciphertext" bytea,
  "payload_tag" bytea,
  "payload_expires_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "claim_fence" bigint DEFAULT 0 NOT NULL,
  "claim_owner_id" text,
  "claim_token" uuid,
  "lease_until" timestamp with time zone,
  "reconciliation_owner_id" text,
  "reconciliation_claim_token" uuid,
  "reconciliation_lease_until" timestamp with time zone,
  "attempt" integer DEFAULT 0 NOT NULL,
  "reconciliation_attempt" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone,
  "result_digest" char(64),
  "terminal_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_conversation_operations_message_event_unique" UNIQUE("message_event_id"),
  CONSTRAINT "client_conversation_operations_nonce_unique" UNIQUE("payload_key_id","payload_nonce"),
  CONSTRAINT "client_conversation_operations_message_event_id_message_events_id_fk" FOREIGN KEY ("message_event_id") REFERENCES "public"."message_events"("id") ON DELETE CASCADE,
  CONSTRAINT "client_conversation_operations_binding_id_provider_subject_mappings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."provider_subject_mappings"("id") ON DELETE SET NULL,
  CONSTRAINT "client_conversation_operations_proposal_digest_check" CHECK ("proposal_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "client_conversation_operations_result_digest_check" CHECK ("result_digest" IS NULL OR "result_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "client_conversation_operations_fence_check" CHECK ("claim_fence" >= 0 AND "attempt" BETWEEN 0 AND 5 AND "reconciliation_attempt" BETWEEN 0 AND 5),
  CONSTRAINT "client_conversation_operations_tool_scope_check" CHECK (("tool_kind" = 'show_catalog' AND "required_scope" = 'client_catalog:read') OR ("tool_kind" = 'start_booking' AND "required_scope" = 'client_booking:write')),
  CONSTRAINT "client_conversation_operations_expiry_check" CHECK ("payload_expires_at" > "created_at" AND "payload_expires_at" <= "created_at" + interval '24 hours' AND "updated_at" >= "created_at"),
  CONSTRAINT "client_conversation_operations_key_check" CHECK ("payload_key_id" IS NULL OR "payload_key_id" ~ '^[A-Za-z0-9_-]{1,32}$'),
  CONSTRAINT "client_conversation_operations_crypto_check" CHECK (("status" IN ('pending','retry_wait','unknown_outcome','processing','reconciling') AND "payload_envelope_version" = 1 AND "payload_key_id" IS NOT NULL AND octet_length("payload_nonce") = 12 AND "payload_ciphertext" IS NOT NULL AND octet_length("payload_tag") = 16) OR ("status" IN ('succeeded','denied','dead_letter','privacy_expired') AND "payload_envelope_version" IS NULL AND "payload_key_id" IS NULL AND "payload_nonce" IS NULL AND "payload_ciphertext" IS NULL AND "payload_tag" IS NULL)),
  CONSTRAINT "client_conversation_operations_lease_check" CHECK (("status" = 'processing' AND "claim_owner_id" IS NOT NULL AND "claim_token" IS NOT NULL AND "lease_until" IS NOT NULL AND "lease_until" <= "payload_expires_at" AND "reconciliation_owner_id" IS NULL AND "reconciliation_claim_token" IS NULL AND "reconciliation_lease_until" IS NULL) OR ("status" = 'reconciling' AND "reconciliation_owner_id" IS NOT NULL AND "reconciliation_claim_token" IS NOT NULL AND "reconciliation_lease_until" IS NOT NULL AND "reconciliation_lease_until" <= "payload_expires_at" AND "claim_owner_id" IS NULL AND "claim_token" IS NULL AND "lease_until" IS NULL) OR ("status" NOT IN ('processing','reconciling') AND "claim_owner_id" IS NULL AND "claim_token" IS NULL AND "lease_until" IS NULL AND "reconciliation_owner_id" IS NULL AND "reconciliation_claim_token" IS NULL AND "reconciliation_lease_until" IS NULL)),
  CONSTRAINT "client_conversation_operations_retry_check" CHECK (("status" = 'retry_wait' AND "next_attempt_at" IS NOT NULL) OR ("status" <> 'retry_wait' AND "next_attempt_at" IS NULL)),
  CONSTRAINT "client_conversation_operations_terminal_check" CHECK (("status" = 'succeeded' AND "result_digest" IS NOT NULL AND "terminal_reason" IS NULL) OR ("status" = 'denied' AND "result_digest" IS NULL AND "terminal_reason" = 'grant_denied') OR ("status" = 'dead_letter' AND "result_digest" IS NULL AND "terminal_reason" IN ('invalid_operation','attempts_exhausted','crypto_invalid')) OR ("status" = 'privacy_expired' AND "result_digest" IS NULL AND "terminal_reason" = 'payload_expired') OR ("status" IN ('pending','processing','retry_wait','unknown_outcome','reconciling') AND "result_digest" IS NULL AND "terminal_reason" IS NULL))
);--> statement-breakpoint
CREATE INDEX "client_conversation_operations_dispatch_idx" ON "client_conversation_operations" ("status","next_attempt_at","lease_until") WHERE "status" IN ('pending','retry_wait','unknown_outcome','reconciling');--> statement-breakpoint
CREATE INDEX "client_conversation_operations_expiry_idx" ON "client_conversation_operations" ("payload_expires_at","id") WHERE "status" IN ('pending','processing','retry_wait','unknown_outcome','reconciling');--> statement-breakpoint
CREATE TABLE "client_conversation_runtime_leases" (
  "capability" text NOT NULL, "instance_id" text NOT NULL, "contract_version" integer NOT NULL, "build_sha" char(40) NOT NULL, "heartbeat_at" timestamp with time zone NOT NULL, "lease_until" timestamp with time zone NOT NULL,
  CONSTRAINT "client_conversation_runtime_leases_pkey" PRIMARY KEY("capability","instance_id"),
  CONSTRAINT "client_conversation_runtime_leases_capability_check" CHECK ("capability" IN ('dispatch_v1','cleanup_v1')),
  CONSTRAINT "client_conversation_runtime_leases_contract_check" CHECK ("contract_version" = 1),
  CONSTRAINT "client_conversation_runtime_leases_sha_check" CHECK ("build_sha" ~ '^[0-9a-f]{40}$'),
  CONSTRAINT "client_conversation_runtime_leases_duration_check" CHECK ("lease_until" > "heartbeat_at" AND "lease_until" <= "heartbeat_at" + interval '30 seconds')
);--> statement-breakpoint
CREATE TABLE "client_conversation_operation_cases" (
  "operation_id" uuid NOT NULL, "case_kind" text NOT NULL, "reason" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_conversation_operation_cases_operation_kind_unique" UNIQUE("operation_id","case_kind"),
  CONSTRAINT "client_conversation_operation_cases_operation_id_client_conversation_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."client_conversation_operations"("id") ON DELETE CASCADE,
  CONSTRAINT "client_conversation_operation_cases_kind_check" CHECK ("case_kind" IN ('operator_case','deletion_receipt')),
  CONSTRAINT "client_conversation_operation_cases_reason_check" CHECK ("reason" IN ('grant_denied','invalid_operation','attempts_exhausted','payload_expired','crypto_invalid'))
);
