CREATE TABLE "expert_referral_admin_execution_results" (
  "approval_id" uuid PRIMARY KEY NOT NULL,
  "second_approval_id" uuid,
  "action" text NOT NULL,
  "object_id" uuid NOT NULL,
  "payload_hash" text NOT NULL,
  "nonce_hash" text NOT NULL,
  "second_nonce_hash" text,
  "requester_session_id_hash" text NOT NULL,
  "safe_result" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "expert_referral_admin_result_action_allowed" CHECK ("action" in ('expert_referral.batch_generate','expert_referral.code_revoke','expert_referral.issuance_override','expert_referral.abuse_hold_open','expert_referral.abuse_hold_close','expert_residency.tariff_create','expert_residency.tariff_retire','expert_referral.hold_replay','expert_referral.feature_switch')),
  CONSTRAINT "expert_referral_admin_result_payload_hash_format" CHECK ("payload_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "expert_referral_admin_result_nonce_hash_format" CHECK ("nonce_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "expert_referral_admin_result_second_binding" CHECK (("action" <> 'expert_referral.issuance_override' and "second_approval_id" is null and "second_nonce_hash" is null) or ("action" = 'expert_referral.issuance_override' and "second_approval_id" is not null and "second_nonce_hash" ~ '^sha256:[0-9a-f]{64}$' and "second_approval_id" <> "approval_id")),
  CONSTRAINT "expert_referral_admin_result_object_only" CHECK (jsonb_typeof("safe_result") = 'object'),
  CONSTRAINT "expert_referral_admin_result_no_secrets" CHECK (not ("safe_result" ?| array['codes','plaintext','digest','hash','nonce'])),
  CONSTRAINT "expert_referral_admin_result_exact_schema" CHECK (
    ("action" = 'expert_referral.batch_generate' and "safe_result" ?& array['batchId','count'] and "safe_result" - array['batchId','count'] = '{}'::jsonb and jsonb_typeof("safe_result"->'batchId')='string' and jsonb_typeof("safe_result"->'count')='number') or
    ("action" = 'expert_referral.code_revoke' and "safe_result" ?& array['id','status'] and "safe_result" - array['id','status'] = '{}'::jsonb and jsonb_typeof("safe_result"->'id')='string' and jsonb_typeof("safe_result"->'status')='string') or
    ("action" = 'expert_referral.issuance_override' and "safe_result" ? 'overrideId' and "safe_result" - 'overrideId' = '{}'::jsonb and jsonb_typeof("safe_result"->'overrideId')='string') or
    ("action" in ('expert_referral.abuse_hold_open','expert_referral.abuse_hold_close') and "safe_result" ?& array['id','expertId','status'] and "safe_result" - array['id','expertId','status'] = '{}'::jsonb and jsonb_typeof("safe_result"->'id')='string' and jsonb_typeof("safe_result"->'expertId')='string' and jsonb_typeof("safe_result"->'status')='string') or
    ("action" = 'expert_residency.tariff_create' and "safe_result" ? 'tariffVersionId' and "safe_result" - 'tariffVersionId' = '{}'::jsonb and jsonb_typeof("safe_result"->'tariffVersionId')='string') or
    ("action" = 'expert_residency.tariff_retire' and "safe_result" ?& array['tariffVersionId','activeTo'] and "safe_result" - array['tariffVersionId','activeTo'] = '{}'::jsonb and jsonb_typeof("safe_result"->'tariffVersionId')='string' and jsonb_typeof("safe_result"->'activeTo')='string') or
    ("action" = 'expert_referral.hold_replay' and "safe_result" ?& array['kind','reason'] and "safe_result" - array['kind','reason'] = '{}'::jsonb and jsonb_typeof("safe_result"->'kind')='string' and jsonb_typeof("safe_result"->'reason')='string') or
    ("action" = 'expert_referral.feature_switch' and "safe_result" ? 'version' and "safe_result" - 'version' = '{}'::jsonb and jsonb_typeof("safe_result"->'version')='number')
  )
);
--> statement-breakpoint
ALTER TABLE "expert_referral_admin_execution_results" ADD CONSTRAINT "expert_referral_admin_results_approval_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expert_referral_admin_execution_results" ADD CONSTRAINT "expert_referral_admin_results_second_approval_fk" FOREIGN KEY ("second_approval_id") REFERENCES "public"."admin_approvals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expert_referral_admin_execution_results" ADD CONSTRAINT "expert_referral_admin_results_session_fk" FOREIGN KEY ("requester_session_id_hash") REFERENCES "public"."admin_sessions"("session_id_hash") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION reject_expert_referral_admin_result_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='expert_referral_admin_result_immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER expert_referral_admin_results_immutable BEFORE UPDATE OR DELETE ON "expert_referral_admin_execution_results" FOR EACH ROW EXECUTE FUNCTION reject_expert_referral_admin_result_mutation();
