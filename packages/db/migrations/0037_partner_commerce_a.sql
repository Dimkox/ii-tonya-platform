CREATE TABLE commercial_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_kind text NOT NULL,
  onboarding_state text NOT NULL DEFAULT 'started',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_participants_kind_check CHECK (participant_kind IN ('EXPERT','CENTER','ORGANIZER')),
  CONSTRAINT commercial_participants_onboarding_state_check CHECK (onboarding_state IN ('started','kind_selected','profile_incomplete','profile_ready','offer_available')),
  CONSTRAINT commercial_participants_user_kind_unique UNIQUE (user_id, participant_kind),
  CONSTRAINT commercial_participants_id_kind_unique UNIQUE (id, participant_kind)
);
CREATE INDEX commercial_participants_user_idx ON commercial_participants(user_id, created_at, id);

CREATE TABLE organization_profiles (
  participant_id uuid PRIMARY KEY,
  participant_kind text NOT NULL,
  legal_name text NOT NULL,
  online_only boolean NOT NULL DEFAULT false,
  city_million_plus boolean NOT NULL DEFAULT false,
  verification_state text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_profiles_kind_check CHECK (participant_kind IN ('CENTER','ORGANIZER')),
  CONSTRAINT organization_profiles_participant_fk FOREIGN KEY (participant_id, participant_kind) REFERENCES commercial_participants(id, participant_kind) ON DELETE CASCADE,
  CONSTRAINT organization_profiles_verification_check CHECK (verification_state IN ('unverified','pending','verified','rejected')),
  CONSTRAINT organization_profiles_legal_name_check CHECK (char_length(legal_name) BETWEEN 1 AND 300)
);

CREATE TABLE partner_tariff_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id text NOT NULL,
  policy_version integer NOT NULL,
  partner_kind text NOT NULL,
  standard_price_minor bigint NOT NULL,
  referred_six_price_minor bigint NOT NULL,
  referred_ten_price_minor bigint NOT NULL,
  online_only_surcharge_minor bigint NOT NULL,
  city_million_plus_surcharge_minor bigint NOT NULL,
  currency text NOT NULL,
  duration_seconds integer NOT NULL,
  event_entitlements jsonb NOT NULL,
  resident_commission_bps integer NOT NULL,
  nonresident_commission_bps integer NOT NULL,
  nonresident_card_fee_minor bigint NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_tariff_policy_versions_kind_check CHECK (partner_kind IN ('CENTER','ORGANIZER')),
  CONSTRAINT partner_tariff_policy_versions_id_check CHECK (char_length(policy_version_id) BETWEEN 1 AND 128),
  CONSTRAINT partner_tariff_policy_versions_currency_check CHECK (currency='RUB'),
  CONSTRAINT partner_tariff_policy_versions_version_check CHECK (policy_version > 0),
  CONSTRAINT partner_tariff_policy_versions_money_check CHECK (standard_price_minor > 0 AND referred_six_price_minor > 0 AND referred_ten_price_minor > 0 AND referred_ten_price_minor <= referred_six_price_minor AND referred_six_price_minor <= standard_price_minor AND online_only_surcharge_minor=300000 AND city_million_plus_surcharge_minor=500000 AND duration_seconds=2592000 AND resident_commission_bps=1000 AND nonresident_commission_bps=1500 AND nonresident_card_fee_minor=450000),
  CONSTRAINT partner_tariff_policy_versions_status_check CHECK (status IN ('draft','approved','retired')),
  CONSTRAINT partner_tariff_policy_versions_window_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT partner_tariff_policy_versions_entitlements_check CHECK ((partner_kind='CENTER' AND event_entitlements='{"bands":[{"capacity":30,"count":10}]}'::jsonb) OR (partner_kind='ORGANIZER' AND event_entitlements='{"bands":[{"capacity":50,"count":5},{"capacity":100,"count":3},{"capacity":500,"count":1}]}'::jsonb)),
  CONSTRAINT partner_tariff_policy_versions_id_version_unique UNIQUE (policy_version_id, policy_version),
  CONSTRAINT partner_tariff_policy_versions_kind_identity_unique UNIQUE (policy_version_id, partner_kind)
);
CREATE UNIQUE INDEX partner_tariff_policy_versions_active_idx ON partner_tariff_policy_versions(partner_kind) WHERE status='approved' AND effective_to IS NULL;
CREATE INDEX partner_tariff_policy_versions_effective_idx ON partner_tariff_policy_versions(partner_kind, effective_from, effective_to);
CREATE FUNCTION lock_partner_policy_window() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='approved' THEN
    PERFORM pg_advisory_xact_lock(739184, 42037);
    IF EXISTS (SELECT 1 FROM partner_tariff_policy_versions p WHERE p.status='approved' AND p.partner_kind=NEW.partner_kind AND p.id<>NEW.id AND tstzrange(p.effective_from,p.effective_to,'[)') && tstzrange(NEW.effective_from,NEW.effective_to,'[)')) THEN
      RAISE EXCEPTION 'partner tariff policy window overlaps approved policy' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_tariff_policy_versions_no_overlap BEFORE INSERT OR UPDATE ON partner_tariff_policy_versions FOR EACH ROW EXECUTE FUNCTION lock_partner_policy_window();

CREATE TABLE partner_shadow_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_version_id text NOT NULL,
  policy_version integer NOT NULL,
  partner_kind text NOT NULL,
  qualified_expert_count integer NOT NULL,
  tier text NOT NULL,
  base_price_minor bigint NOT NULL,
  online_only_surcharge_minor bigint NOT NULL,
  city_million_plus_surcharge_minor bigint NOT NULL,
  final_price_minor bigint NOT NULL,
  currency text NOT NULL,
  duration_seconds integer NOT NULL,
  event_entitlements jsonb NOT NULL,
  resident_commission_bps integer NOT NULL,
  nonresident_commission_bps integer NOT NULL,
  nonresident_card_fee_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_shadow_quotes_kind_check CHECK (partner_kind IN ('CENTER','ORGANIZER')),
  CONSTRAINT partner_shadow_quotes_tier_check CHECK (tier IN ('STANDARD','REFERRED_6_9','REFERRED_10_PLUS')),
  CONSTRAINT partner_shadow_quotes_currency_check CHECK (currency='RUB' AND duration_seconds=2592000),
  CONSTRAINT partner_shadow_quotes_count_check CHECK (qualified_expert_count >= 0),
  CONSTRAINT partner_shadow_quotes_arithmetic_check CHECK (base_price_minor + online_only_surcharge_minor + city_million_plus_surcharge_minor = final_price_minor),
  CONSTRAINT partner_shadow_quotes_money_check CHECK (base_price_minor > 0 AND online_only_surcharge_minor >= 0 AND city_million_plus_surcharge_minor >= 0 AND final_price_minor > 0 AND resident_commission_bps=1000 AND nonresident_commission_bps=1500 AND nonresident_card_fee_minor=450000),
  CONSTRAINT partner_shadow_quotes_entitlements_check CHECK ((partner_kind='CENTER' AND event_entitlements='{"bands":[{"capacity":30,"count":10}]}'::jsonb) OR (partner_kind='ORGANIZER' AND event_entitlements='{"bands":[{"capacity":50,"count":5},{"capacity":100,"count":3},{"capacity":500,"count":1}]}'::jsonb)),
  CONSTRAINT partner_shadow_quotes_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES commercial_participants(id),
  CONSTRAINT partner_shadow_quotes_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES partner_tariff_policy_versions(id),
  CONSTRAINT partner_shadow_quotes_participant_kind_fk FOREIGN KEY (participant_id, partner_kind) REFERENCES commercial_participants(id, participant_kind),
  CONSTRAINT partner_shadow_quotes_policy_kind_fk FOREIGN KEY (policy_version_id, partner_kind) REFERENCES partner_tariff_policy_versions(policy_version_id, partner_kind)
);
CREATE INDEX partner_shadow_quotes_participant_idx ON partner_shadow_quotes(participant_id, created_at, id);

CREATE TABLE partner_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_command_receipts_command_check CHECK (command IN ('partner_onboarding','partner_quote')),
  CONSTRAINT partner_command_receipts_idempotency_unique UNIQUE (user_id, command, idempotency_key),
  CONSTRAINT partner_command_receipts_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);

CREATE FUNCTION reject_partner_commerce_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'partner commerce rows are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER partner_tariff_policy_versions_immutable BEFORE UPDATE OR DELETE ON partner_tariff_policy_versions FOR EACH ROW EXECUTE FUNCTION reject_partner_commerce_mutation();
CREATE TRIGGER partner_shadow_quotes_immutable BEFORE UPDATE OR DELETE ON partner_shadow_quotes FOR EACH ROW EXECUTE FUNCTION reject_partner_commerce_mutation();
