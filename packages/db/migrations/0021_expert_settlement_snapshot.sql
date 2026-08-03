ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "result_payload" jsonb;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "result_schema_version" integer;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "result_legacy_exempt" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "expert_residency_provider_event_inbox" SET "result_legacy_exempt"=true WHERE status='processed' AND event_kind IN ('refunded','charged_back');
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD COLUMN "settlement_control_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD COLUMN "settlement_invitee_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD COLUMN "settlement_invitee_channel_identity_id" uuid;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD COLUMN "settlement_inviter_expert_id" uuid;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD COLUMN "settlement_inviter_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD COLUMN "settlement_inviter_channel_identity_id" uuid;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" DISABLE TRIGGER "expert_first_settlement_guard";
--> statement-breakpoint
UPDATE expert_first_residency_settlements
SET eligibility='permanently_ineligible', reason_code='legacy_snapshot_unavailable'
WHERE eligibility='pending_feature_hold';
--> statement-breakpoint
UPDATE expert_first_residency_settlements m
SET settlement_invitee_user_id=(SELECT e.user_id FROM experts e WHERE e.id=m.expert_id),
    settlement_invitee_channel_identity_id=(SELECT ci.id FROM channel_identities ci JOIN experts e ON e.user_id=ci.user_id WHERE e.id=m.expert_id ORDER BY ci.id LIMIT 1),
    settlement_inviter_expert_id=(SELECT r.inviter_expert_id FROM expert_referrals r WHERE r.id=m.referral_id),
    settlement_inviter_user_id=(SELECT ie.user_id FROM expert_referrals r JOIN experts ie ON ie.id=r.inviter_expert_id WHERE r.id=m.referral_id),
    settlement_inviter_channel_identity_id=(SELECT ci.id FROM expert_referrals r JOIN experts ie ON ie.id=r.inviter_expert_id JOIN channel_identities ci ON ci.user_id=ie.user_id WHERE r.id=m.referral_id ORDER BY ci.id LIMIT 1);
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ENABLE TRIGGER "expert_first_settlement_guard";
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_residency_settlements_settlement_invitee_user_id_users_id_fk" FOREIGN KEY ("settlement_invitee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_residency_settlements_settlement_invitee_channel_identity_id_channel_identities_id_fk" FOREIGN KEY ("settlement_invitee_channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_residency_settlements_settlement_inviter_expert_id_experts_id_fk" FOREIGN KEY ("settlement_inviter_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_residency_settlements_settlement_inviter_user_id_users_id_fk" FOREIGN KEY ("settlement_inviter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_residency_settlements_settlement_inviter_channel_identity_id_channel_identities_id_fk" FOREIGN KEY ("settlement_inviter_channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expert_first_residency_settlements" ADD CONSTRAINT "expert_first_settlement_pending_snapshot_complete" CHECK (eligibility <> 'pending_feature_hold' OR (settlement_invitee_user_id IS NOT NULL AND settlement_invitee_channel_identity_id IS NOT NULL AND settlement_inviter_expert_id IS NOT NULL AND settlement_inviter_user_id IS NOT NULL AND settlement_inviter_channel_identity_id IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION expert_jsonb_has_exact_keys(value jsonb, expected text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT jsonb_typeof(value)='object'
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(value) AS keys(k))
      = (SELECT array_agg(k ORDER BY k) FROM unnest(expected) AS keys(k));
$$;
--> statement-breakpoint
ALTER TABLE "expert_residency_provider_event_inbox" ADD CONSTRAINT "expert_provider_reversal_result_shape" CHECK (
  event_kind NOT IN ('refunded','charged_back') OR status <> 'processed' OR
  (result_legacy_exempt AND result_schema_version IS NULL AND result_payload IS NULL) OR
  (result_schema_version=1 AND jsonb_typeof(result_payload)='object' AND expert_jsonb_has_exact_keys(result_payload,ARRAY['kind','eventId','paymentId','orderId','cashRefundedMinor','restoredCreditMinor','rewardReversed','debtMinor','terminated']::text[])
   AND result_payload->>'kind'=event_kind
   AND result_payload->>'eventId'=external_event_id
   AND result_payload->>'paymentId'=payment_id
   AND result_payload->>'orderId'=order_id::text
   AND result_payload->>'cashRefundedMinor' ~ '^(0|[1-9][0-9]{0,11})$'
   AND result_payload->>'restoredCreditMinor'='0'
   AND jsonb_typeof(result_payload->'rewardReversed')='boolean'
   AND result_payload->>'debtMinor' ~ '^(0|[1-9][0-9]{0,11})$'
   AND jsonb_typeof(result_payload->'terminated')='boolean')
);
--> statement-breakpoint
CREATE FUNCTION expert_provider_reversal_result_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.result_legacy_exempt THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='expert_provider_reversal_legacy_exempt_forbidden', MESSAGE='expert_provider_reversal_legacy_exempt_forbidden';
  END IF;
  IF TG_OP='UPDATE' AND NEW.result_legacy_exempt AND NOT OLD.result_legacy_exempt THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='expert_provider_reversal_legacy_exempt_forbidden', MESSAGE='expert_provider_reversal_legacy_exempt_forbidden';
  END IF;
  IF TG_OP='INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status='processed' AND OLD.event_kind IN ('refunded','charged_back')
     AND (NEW.result_payload IS DISTINCT FROM OLD.result_payload OR NEW.result_schema_version IS DISTINCT FROM OLD.result_schema_version OR NEW.result_legacy_exempt IS DISTINCT FROM OLD.result_legacy_exempt)
  THEN
    RAISE EXCEPTION USING ERRCODE='55000', CONSTRAINT='expert_provider_reversal_result_immutable', MESSAGE='expert_provider_reversal_result_immutable';
  END IF;
  IF NEW.status='processed' AND NEW.event_kind IN ('refunded','charged_back')
     AND OLD.status IS DISTINCT FROM 'processed' AND (NEW.result_schema_version IS DISTINCT FROM 1 OR NEW.result_legacy_exempt)
  THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='expert_provider_reversal_result_required', MESSAGE='expert_provider_reversal_result_required';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "expert_provider_reversal_result_guard"
  BEFORE INSERT OR UPDATE ON "expert_residency_provider_event_inbox"
  FOR EACH ROW EXECUTE FUNCTION expert_provider_reversal_result_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION expert_first_settlement_guard_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000', CONSTRAINT='expert_first_settlement_transition', MESSAGE='expert_first_settlement_guard';
  END IF;
  IF NOT (
      (OLD.eligibility = 'pending_feature_hold' AND NEW.eligibility IN ('eligible','permanently_ineligible','cancelled_by_refund'))
      OR (OLD.eligibility = 'eligible' AND NEW.eligibility = 'cancelled_by_refund')
    )
    OR ROW(NEW.id,NEW.expert_id,NEW.settlement_sequence,NEW.qualifying_order_id,NEW.qualifying_payment_attempt_id,NEW.referral_id,NEW.settlement_expert_active,NEW.settlement_expert_verified,NEW.settlement_abuse_cleared,NEW.settlement_control_version,NEW.settlement_invitee_user_id,NEW.settlement_invitee_channel_identity_id,NEW.settlement_inviter_expert_id,NEW.settlement_inviter_user_id,NEW.settlement_inviter_channel_identity_id,NEW.settled_at,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.expert_id,OLD.settlement_sequence,OLD.qualifying_order_id,OLD.qualifying_payment_attempt_id,OLD.referral_id,OLD.settlement_expert_active,OLD.settlement_expert_verified,OLD.settlement_abuse_cleared,OLD.settlement_control_version,OLD.settlement_invitee_user_id,OLD.settlement_invitee_channel_identity_id,OLD.settlement_inviter_expert_id,OLD.settlement_inviter_user_id,OLD.settlement_inviter_channel_identity_id,OLD.settled_at,OLD.created_at)
  THEN
    RAISE EXCEPTION USING ERRCODE='55000', CONSTRAINT='expert_first_settlement_transition', MESSAGE='expert_first_settlement_guard';
  END IF;
  RETURN NEW;
END;
$$;
