CREATE TYPE expert_referral_maturity_status AS ENUM ('pending', 'granted', 'cancelled');
--> statement-breakpoint
CREATE TABLE expert_referral_reward_maturities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_settlement_id uuid NOT NULL,
  referral_id uuid NOT NULL,
  qualifying_order_id uuid NOT NULL,
  qualifying_payment_attempt_id uuid NOT NULL,
  inviter_expert_id uuid NOT NULL REFERENCES experts(id),
  invitee_expert_id uuid NOT NULL REFERENCES experts(id),
  policy_version text NOT NULL DEFAULT 'expert_referral_v2_30d',
  amount_minor bigint NOT NULL DEFAULT 100000,
  settled_at timestamptz NOT NULL,
  matures_at timestamptz NOT NULL,
  status expert_referral_maturity_status NOT NULL DEFAULT 'pending',
  granted_at timestamptz,
  cancelled_at timestamptz,
  terminal_reason text,
  idempotency_key text NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  resolved_at timestamptz,
  reason_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_referral_maturity_settlement_fk FOREIGN KEY (first_settlement_id, referral_id, qualifying_order_id, qualifying_payment_attempt_id)
    REFERENCES expert_first_residency_settlements(id, referral_id, qualifying_order_id, qualifying_payment_attempt_id),
  CONSTRAINT expert_referral_maturity_policy CHECK (policy_version = 'expert_referral_v2_30d' AND amount_minor = 100000),
  CONSTRAINT expert_referral_maturity_settled_clock CHECK (matures_at = settled_at + interval '30 days'),
  CONSTRAINT expert_referral_maturity_terminal_state CHECK (
    (status = 'pending' AND granted_at IS NULL AND cancelled_at IS NULL AND terminal_reason IS NULL)
    OR (status = 'granted' AND granted_at IS NOT NULL AND cancelled_at IS NULL AND terminal_reason IS NULL)
    OR (status = 'cancelled' AND granted_at IS NULL AND cancelled_at IS NOT NULL AND terminal_reason IS NOT NULL AND terminal_reason IN ('terminating_provider_reversal', 'eligibility_lost', 'feature_disabled'))
  ),
  CONSTRAINT expert_referral_maturity_idempotency_nonempty CHECK (idempotency_key = 'expert-referral-maturity:v1:' || first_settlement_id::text),
  CONSTRAINT expert_referral_maturity_attempt_bounded CHECK (attempt_count between 0 and 2147483647)
);
--> statement-breakpoint
CREATE UNIQUE INDEX expert_referral_maturities_settlement_unique ON expert_referral_reward_maturities(first_settlement_id);
--> statement-breakpoint
CREATE UNIQUE INDEX expert_referral_maturities_order_unique ON expert_referral_reward_maturities(qualifying_order_id);
--> statement-breakpoint
CREATE UNIQUE INDEX expert_referral_maturities_payment_unique ON expert_referral_reward_maturities(qualifying_payment_attempt_id);
--> statement-breakpoint
CREATE UNIQUE INDEX expert_referral_maturities_referral_unique ON expert_referral_reward_maturities(referral_id);
--> statement-breakpoint
CREATE UNIQUE INDEX expert_referral_maturities_idempotency_unique ON expert_referral_reward_maturities(idempotency_key);
--> statement-breakpoint
CREATE INDEX expert_referral_maturities_due_idx ON expert_referral_reward_maturities(matures_at, id) WHERE status = 'pending';
--> statement-breakpoint
ALTER TABLE expert_referral_reward_grants ADD COLUMN maturity_id uuid;
--> statement-breakpoint
ALTER TABLE expert_referral_reward_grants ADD CONSTRAINT expert_reward_grants_maturity_fk FOREIGN KEY (maturity_id) REFERENCES expert_referral_reward_maturities(id);
--> statement-breakpoint
CREATE UNIQUE INDEX expert_reward_grants_maturity_unique ON expert_referral_reward_grants(maturity_id) WHERE maturity_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION expert_referral_maturities_append_only_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('granted', 'cancelled') THEN RAISE EXCEPTION 'expert_referral_maturities_terminal_immutable' USING ERRCODE = '23514'; END IF;
  IF NEW.status IN ('granted', 'cancelled') AND (NEW.settled_at <> OLD.settled_at OR NEW.matures_at <> OLD.matures_at OR NEW.first_settlement_id <> OLD.first_settlement_id OR NEW.referral_id <> OLD.referral_id OR NEW.qualifying_order_id <> OLD.qualifying_order_id OR NEW.qualifying_payment_attempt_id <> OLD.qualifying_payment_attempt_id OR NEW.inviter_expert_id <> OLD.inviter_expert_id) THEN
    RAISE EXCEPTION 'expert_referral_maturities_financial_facts_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER expert_referral_maturities_terminal_guard BEFORE UPDATE ON expert_referral_reward_maturities FOR EACH ROW EXECUTE FUNCTION expert_referral_maturities_append_only_terminal();
--> statement-breakpoint
CREATE FUNCTION expert_referral_maturities_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'expert_referral_maturities_append_only' USING ERRCODE = '23514'; END; $$;
--> statement-breakpoint
CREATE TRIGGER expert_referral_maturities_delete_guard BEFORE DELETE ON expert_referral_reward_maturities FOR EACH ROW EXECUTE FUNCTION expert_referral_maturities_no_delete();
