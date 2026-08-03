ALTER TABLE "expert_residency_provider_event_inbox" ADD COLUMN "result_payload" jsonb;
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
    settlement_invitee_channel_identity_id=(SELECT min(ci.id) FROM channel_identities ci JOIN experts e ON e.user_id=ci.user_id WHERE e.id=m.expert_id),
    settlement_inviter_expert_id=(SELECT r.inviter_expert_id FROM expert_referrals r WHERE r.id=m.referral_id),
    settlement_inviter_user_id=(SELECT ie.user_id FROM expert_referrals r JOIN experts ie ON ie.id=r.inviter_expert_id WHERE r.id=m.referral_id),
    settlement_inviter_channel_identity_id=(SELECT min(ci.id) FROM expert_referrals r JOIN experts ie ON ie.id=r.inviter_expert_id JOIN channel_identities ci ON ci.user_id=ie.user_id WHERE r.id=m.referral_id);
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
