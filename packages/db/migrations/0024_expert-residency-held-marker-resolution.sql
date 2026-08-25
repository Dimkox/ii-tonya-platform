DROP TRIGGER "expert_first_residency_settlements_append_only" ON "expert_first_residency_settlements";--> statement-breakpoint
CREATE FUNCTION enforce_expert_first_settlement_pending_resolution()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert first settlement marker is immutable',
      CONSTRAINT = 'expert_first_settlement_pending_resolution';
  END IF;

  IF OLD.eligibility_status <> 'pending_feature_hold'
    OR NEW.eligibility_status NOT IN ('eligible', 'ineligible', 'cancelled_by_refund')
    OR (to_jsonb(NEW) - 'eligibility_status' - 'eligibility_reason_code')
      IS DISTINCT FROM
      (to_jsonb(OLD) - 'eligibility_status' - 'eligibility_reason_code')
    OR (NEW.eligibility_status = 'eligible'
      AND NEW.eligibility_reason_code <> 'eligible_after_feature_replay')
    OR (NEW.eligibility_status = 'ineligible'
      AND NEW.eligibility_reason_code NOT IN (
        'held_snapshot_ineligible',
        'held_order_not_settled',
        'held_residency_not_active',
        'held_referral_missing'
      ))
    OR (NEW.eligibility_status = 'cancelled_by_refund'
      AND NEW.eligibility_reason_code NOT IN (
        'terminating_refund',
        'terminating_chargeback'
      ))
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'expert first settlement marker transition is invalid',
      CONSTRAINT = 'expert_first_settlement_pending_resolution';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "expert_first_residency_settlements_pending_resolution"
BEFORE UPDATE OR DELETE ON "expert_first_residency_settlements"
FOR EACH ROW EXECUTE FUNCTION enforce_expert_first_settlement_pending_resolution();
