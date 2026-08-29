ALTER TABLE admin_object_assignments DROP CONSTRAINT admin_object_assignments_type_allowed;
ALTER TABLE admin_object_assignments ADD CONSTRAINT admin_object_assignments_type_allowed CHECK (object_type IN ('safety_case','feedback_queue','selarti_budget_policy'));

CREATE TABLE selarti_budget_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  status text NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  global_cap_rub_minor bigint NOT NULL,
  global_warning_rub_minor bigint NOT NULL,
  global_soft_rub_minor bigint NOT NULL,
  per_user_warning_rub_minor bigint NOT NULL,
  per_user_soft_rub_minor bigint NOT NULL,
  per_user_hard_rub_minor bigint NOT NULL,
  official_usd_rub_quote_micros bigint NOT NULL,
  selarti_uplift_bps integer NOT NULL DEFAULT 1000,
  usd_micros_per_request bigint NOT NULL,
  usd_micros_per_unit bigint NOT NULL,
  worst_case_billable_units bigint NOT NULL,
  rate_version text NOT NULL,
  model_version text NOT NULL,
  stress_inflation_bps integer NOT NULL DEFAULT 6000,
  approval_id uuid NOT NULL UNIQUE REFERENCES admin_approvals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selarti_budget_policy_status_check CHECK (status IN ('approved','retired')),
  CONSTRAINT selarti_budget_policy_window_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT selarti_budget_policy_threshold_check CHECK (global_cap_rub_minor > 0 AND global_cap_rub_minor <= 999999999999 AND global_warning_rub_minor >= 0 AND global_warning_rub_minor <= 999999999999 AND global_warning_rub_minor <= global_soft_rub_minor AND global_soft_rub_minor <= 999999999999 AND global_soft_rub_minor <= global_cap_rub_minor AND per_user_warning_rub_minor >= 0 AND per_user_warning_rub_minor <= 999999999999 AND per_user_warning_rub_minor <= per_user_soft_rub_minor AND per_user_soft_rub_minor <= 999999999999 AND per_user_soft_rub_minor <= per_user_hard_rub_minor AND per_user_hard_rub_minor <= 999999999999 AND per_user_hard_rub_minor <= global_cap_rub_minor),
  CONSTRAINT selarti_budget_policy_id_version_unique UNIQUE(id,version),
  CONSTRAINT selarti_budget_policy_cost_check CHECK (
    official_usd_rub_quote_micros > 0 AND official_usd_rub_quote_micros <= 999999999999 AND
    selarti_uplift_bps = 1000 AND usd_micros_per_request >= 0 AND usd_micros_per_request <= 999999999999 AND
    usd_micros_per_unit >= 0 AND usd_micros_per_unit <= 999999999999 AND
    worst_case_billable_units > 0 AND worst_case_billable_units <= 1000000 AND stress_inflation_bps = 6000 AND
    ceil(((usd_micros_per_request::numeric + usd_micros_per_unit::numeric * worst_case_billable_units::numeric) *
      ceil(official_usd_rub_quote_micros::numeric * (10000 + selarti_uplift_bps)::numeric / 10000) * 100) /
      1000000000000) > 0 AND
    ceil(((usd_micros_per_request::numeric + usd_micros_per_unit::numeric * worst_case_billable_units::numeric) *
      ceil(official_usd_rub_quote_micros::numeric * (10000 + selarti_uplift_bps)::numeric / 10000) * 100) /
      1000000000000) <= 999999999999
  )
);
CREATE UNIQUE INDEX selarti_budget_policy_one_active_idx ON selarti_budget_policies((status)) WHERE status='approved' AND effective_to IS NULL;
CREATE FUNCTION lock_and_reject_selarti_budget_policy_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(739184, 42036);
  IF EXISTS (
    SELECT 1 FROM selarti_budget_policies p
    WHERE p.status='approved' AND tstzrange(p.effective_from, p.effective_to, '[)') &&
      tstzrange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN RAISE EXCEPTION 'selarti budget policy window overlaps approved policy'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER selarti_budget_policy_no_overlap BEFORE INSERT ON selarti_budget_policies FOR EACH ROW EXECUTE FUNCTION lock_and_reject_selarti_budget_policy_overlap();
CREATE FUNCTION validate_and_consume_selarti_budget_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approval admin_approvals%ROWTYPE; expected_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(739184, 42036);
  expected_hash := 'sha256:' || encode(digest(convert_to(to_json(concat_ws('|','selarti-budget-policy-v1',NEW.version,NEW.status,to_char(NEW.effective_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),coalesce(to_char(NEW.effective_to at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'-'),NEW.global_cap_rub_minor,NEW.global_warning_rub_minor,NEW.global_soft_rub_minor,NEW.per_user_warning_rub_minor,NEW.per_user_soft_rub_minor,NEW.per_user_hard_rub_minor,NEW.official_usd_rub_quote_micros,NEW.selarti_uplift_bps,NEW.usd_micros_per_request,NEW.usd_micros_per_unit,NEW.worst_case_billable_units,NEW.rate_version,NEW.model_version,NEW.stress_inflation_bps))::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO approval FROM admin_approvals WHERE id=NEW.approval_id FOR UPDATE;
  IF approval.id IS NULL OR approval.action<>'selarti_budget.policy_approve' OR approval.object_type<>'selarti_budget_policy' OR approval.object_id<>NEW.id OR approval.required_role<>'security_admin' OR approval.requester_id=approval.approver_id OR approval.approver_id IS NULL OR approval.requester_session_id_hash IS NULL OR approval.requester_mfa_verified_at IS NULL OR approval.approver_session_id_hash IS NULL OR approval.approver_mfa_verified_at IS NULL OR approval.approved_at IS NULL OR approval.approved_at>NEW.created_at OR approval.consumed_at IS NOT NULL OR approval.expires_at<=NEW.created_at OR approval.payload_hash<>expected_hash OR approval.requester_mfa_verified_at < NEW.created_at - interval '15 minutes' OR approval.requester_mfa_verified_at > NEW.created_at OR approval.approver_mfa_verified_at < NEW.created_at - interval '15 minutes' OR approval.approver_mfa_verified_at > NEW.created_at OR NOT EXISTS (SELECT 1 FROM admin_sessions s JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role='security_admin' WHERE s.session_id_hash=approval.requester_session_id_hash AND s.admin_id=approval.requester_id AND s.mfa_verified_at=approval.requester_mfa_verified_at AND s.revoked_at IS NULL AND s.expires_at>NEW.created_at) OR NOT EXISTS (SELECT 1 FROM admin_sessions s JOIN admin_role_assignments r ON r.admin_id=s.admin_id AND r.role='security_admin' WHERE s.session_id_hash=approval.approver_session_id_hash AND s.admin_id=approval.approver_id AND s.mfa_verified_at=approval.approver_mfa_verified_at AND s.revoked_at IS NULL AND s.expires_at>NEW.created_at) THEN RAISE EXCEPTION 'selarti budget approval invalid'; END IF;
  UPDATE admin_approvals SET consumed_at=NEW.created_at WHERE id=NEW.approval_id;
  RETURN NEW;
END $$;
CREATE TRIGGER selarti_budget_policy_approval BEFORE INSERT ON selarti_budget_policies FOR EACH ROW EXECUTE FUNCTION validate_and_consume_selarti_budget_approval();
CREATE FUNCTION reject_selarti_budget_policy_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'selarti budget policies are immutable'; END $$;
CREATE TRIGGER selarti_budget_policy_immutable BEFORE UPDATE OR DELETE ON selarti_budget_policies FOR EACH ROW EXECUTE FUNCTION reject_selarti_budget_policy_mutation();

CREATE TABLE selarti_cost_reservations (
  request_id text PRIMARY KEY,
  payload_hash char(64) NOT NULL,
  policy_id uuid NOT NULL REFERENCES selarti_budget_policies(id),
  policy_version integer NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  dialogue_id uuid NOT NULL REFERENCES dialogues(id),
  period_start date NOT NULL,
  official_usd_rub_quote_micros bigint NOT NULL,
  effective_usd_rub_quote_micros bigint NOT NULL,
  selarti_uplift_bps integer NOT NULL,
  usd_micros_per_request bigint NOT NULL,
  usd_micros_per_unit bigint NOT NULL,
  worst_case_billable_units bigint NOT NULL,
  worst_case_usd_micros bigint NOT NULL,
  reserved_rub_minor bigint NOT NULL,
  rate_version text NOT NULL,
  model_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selarti_cost_reservation_policy_fk FOREIGN KEY(policy_id,policy_version) REFERENCES selarti_budget_policies(id,version),
  CONSTRAINT selarti_cost_reservation_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT selarti_cost_reservation_amount_check CHECK (reserved_rub_minor > 0 AND worst_case_usd_micros > 0)
);
CREATE INDEX selarti_cost_reservations_period_idx ON selarti_cost_reservations(period_start,user_id);

CREATE TABLE selarti_actual_usage_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id text NOT NULL UNIQUE,
  request_id text NOT NULL REFERENCES selarti_cost_reservations(request_id),
  payload_hash char(64) NOT NULL,
  outcome text NOT NULL,
  actual_usd_micros bigint,
  actual_rub_minor bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selarti_actual_usage_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT selarti_actual_usage_outcome_check CHECK (outcome IN ('unknown','not_applied','applied')),
  CONSTRAINT selarti_actual_usage_amount_check CHECK ((outcome='applied' AND actual_usd_micros IS NOT NULL AND actual_usd_micros >= 0 AND actual_rub_minor IS NOT NULL AND actual_rub_minor >= 0) OR (outcome<>'applied' AND actual_usd_micros IS NULL AND actual_rub_minor IS NULL))
);
CREATE INDEX selarti_actual_usage_request_idx ON selarti_actual_usage_facts(request_id,created_at,id);
CREATE UNIQUE INDEX selarti_actual_usage_terminal_unique ON selarti_actual_usage_facts(request_id) WHERE outcome IN ('not_applied','applied');
CREATE UNIQUE INDEX selarti_actual_usage_unknown_unique ON selarti_actual_usage_facts(request_id) WHERE outcome='unknown';

CREATE TABLE selarti_cost_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL REFERENCES selarti_cost_reservations(request_id),
  kind text NOT NULL,
  amount_rub_minor bigint NOT NULL,
  fact_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selarti_cost_adjustment_unique UNIQUE(request_id,kind),
  CONSTRAINT selarti_cost_adjustment_kind_check CHECK (kind IN ('released','consumed','unused_released','overrun')),
  CONSTRAINT selarti_cost_adjustment_amount_check CHECK (amount_rub_minor >= 0)
);

CREATE TABLE selarti_budget_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  policy_version integer NOT NULL,
  outcome text NOT NULL,
  amount_rub_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selarti_budget_alert_unique UNIQUE(request_id,outcome),
  CONSTRAINT selarti_budget_alert_outcome_check CHECK (outcome IN ('warning','soft_stop','hard_stop','overrun','unknown')),
  CONSTRAINT selarti_budget_alert_amount_check CHECK (amount_rub_minor >= 0)
);
CREATE INDEX selarti_budget_alerts_created_idx ON selarti_budget_alerts(created_at,id);
