-- v3 is an opt-in owner transition. No historical quote, paid contract or form is rewritten.
CREATE TABLE expert_sales_bases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES users(id),
 tariff_version_id uuid NOT NULL REFERENCES expert_residency_tariff_versions(id), profile_revision integer NOT NULL,
 base_tariff_amount bigint NOT NULL CHECK(base_tariff_amount BETWEEN 0 AND 999999999999),
 base_offer_shown_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 participant_kind text NOT NULL CHECK(participant_kind IN('expert','space')),
 policy_version text NOT NULL DEFAULT 'expert_separated_sales_v3' CHECK(policy_version='expert_separated_sales_v3'),
 bot_id text NOT NULL, bot_key text NOT NULL, chat_id text NOT NULL, consent_version text NOT NULL,
 FOREIGN KEY(user_id,profile_revision) REFERENCES expert_offer_profiles(user_id,revision), UNIQUE(id,user_id),
 CHECK(isfinite(base_offer_shown_at))
);
--> statement-breakpoint
CREATE FUNCTION expert_sales_base_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p expert_offer_profiles%ROWTYPE; t expert_residency_tariff_versions%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 SELECT * INTO p FROM expert_offer_profiles WHERE user_id=NEW.user_id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO t FROM expert_residency_tariff_versions WHERE id=NEW.tariff_version_id FOR SHARE;
 IF p.user_id IS NULL OR t.id IS NULL OR p.revision<>NEW.profile_revision OR p.participant_kind<>NEW.participant_kind
 OR NEW.base_tariff_amount<>greatest(500000,t.price_minor+(CASE WHEN p.million_city THEN 500000 ELSE 0 END)+(CASE WHEN p.service_format='online_only' THEN 300000 ELSE 0 END)-(CASE WHEN p.ticket_minor<300000 THEN 100000 ELSE 0 END))
 OR t.commercial_policy_version<>'expert_residency_v2' OR t.currency<>'RUB' OR t.duration_seconds<>2592000 OR clock_timestamp()<t.active_from OR clock_timestamp()>=t.active_to
 OR (p.participant_kind='space' AND NOT EXISTS(SELECT 1 FROM expert_space_tariff_approvals WHERE tariff_version_id=t.id))
 OR NOT expert_card_current_messaging_authority(NEW.user_id,NEW.consent_version)
 OR NOT EXISTS(SELECT 1 FROM channel_identities ci JOIN users u ON u.id=ci.user_id AND u.active WHERE ci.user_id=NEW.user_id AND ci.provider='telegram' AND ci.bot_key=NEW.bot_key AND ci.external_id=NEW.chat_id AND ci.external_chat_id=NEW.chat_id AND ci.status='active')
 OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=NEW.user_id)
 OR EXISTS(SELECT 1 FROM expert_onboarding_invoices WHERE user_id=NEW.user_id)
 OR EXISTS(SELECT 1 FROM expert_campaign_quotes WHERE user_id=NEW.user_id)
 THEN RAISE EXCEPTION 'expert_sales_base_source'; END IF;
 NEW.base_offer_shown_at:=date_trunc('milliseconds',clock_timestamp()); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_base_source BEFORE INSERT ON expert_sales_bases FOR EACH ROW EXECUTE FUNCTION expert_sales_base_source();
CREATE TRIGGER expert_sales_base_immutable BEFORE UPDATE OR DELETE ON expert_sales_bases FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TABLE expert_sales_choices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), base_id uuid NOT NULL, user_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), action text NOT NULL CHECK(action IN('positive','promo','base','month','quarter')),
 chosen_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 request_key text NOT NULL, request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 FOREIGN KEY(base_id,user_id) REFERENCES expert_sales_bases(id,user_id), UNIQUE(base_id,revision), UNIQUE(base_id,request_key), UNIQUE(id,user_id)
);
--> statement-breakpoint
CREATE FUNCTION expert_sales_choice_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b expert_sales_bases%ROWTYPE; last_action text; rev integer;
BEGIN
 SELECT * INTO b FROM expert_sales_bases WHERE id=NEW.base_id AND user_id=NEW.user_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 SELECT action,revision INTO last_action,rev FROM expert_sales_choices WHERE base_id=b.id ORDER BY revision DESC LIMIT 1;
 IF b.id IS NULL OR EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id) OR expert_card_current_messaging_authority(NEW.user_id,b.consent_version) IS NOT TRUE OR NEW.revision<>coalesce(rev,0)+1
 OR (NEW.action='positive' AND last_action IS NOT NULL)
 OR (NEW.action IN('promo','base') AND last_action IS DISTINCT FROM 'positive')
 OR (NEW.action IN('month','quarter') AND coalesce(last_action,'') NOT IN('promo','base') AND NOT (NEW.action='month' AND last_action='quarter' AND clock_timestamp()>=b.base_offer_shown_at+interval '168 hours'))
 OR (NEW.action='quarter' AND (last_action IS DISTINCT FROM 'promo' OR clock_timestamp()>=b.base_offer_shown_at+interval '168 hours'))
 OR (NEW.action='promo' AND clock_timestamp()>=b.base_offer_shown_at+interval '240 hours')
 THEN RAISE EXCEPTION 'expert_sales_choice_source'; END IF;
 NEW.chosen_at:=date_trunc('milliseconds',clock_timestamp()); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_choice_source BEFORE INSERT ON expert_sales_choices FOR EACH ROW EXECUTE FUNCTION expert_sales_choice_source();
CREATE TRIGGER expert_sales_choice_immutable BEFORE UPDATE OR DELETE ON expert_sales_choices FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TABLE expert_sales_selections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), base_id uuid NOT NULL, user_id uuid NOT NULL, choice_id uuid NOT NULL UNIQUE,
 promo_accepted_flag boolean NOT NULL, term_months integer NOT NULL CHECK(term_months IN(1,3)),
 monthly_price_minor bigint NOT NULL CHECK(monthly_price_minor>=500000), package_price_minor bigint,
 selected_total_minor bigint NOT NULL CHECK(selected_total_minor BETWEEN 500000 AND 999999999999),
 energy_discount_bps integer NOT NULL, package_discount_bps integer NOT NULL,
 selected_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), offer_expiry_date timestamptz NOT NULL,
 FOREIGN KEY(base_id,user_id) REFERENCES expert_sales_bases(id,user_id), FOREIGN KEY(choice_id,user_id) REFERENCES expert_sales_choices(id,user_id), UNIQUE(id,user_id),
 CHECK(isfinite(selected_at) AND isfinite(offer_expiry_date) AND selected_at<offer_expiry_date),
 CHECK((term_months=1 AND selected_total_minor=monthly_price_minor) OR (term_months=3 AND package_price_minor IS NOT NULL AND selected_total_minor=package_price_minor AND package_price_minor>=1500000))
);
--> statement-breakpoint
CREATE FUNCTION expert_sales_selection_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b expert_sales_bases%ROWTYPE; c expert_sales_choices%ROWTYPE; promo boolean; energy integer; pack integer; stage_end timestamptz; monthly bigint; quarter bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 SELECT * INTO b FROM expert_sales_bases WHERE id=NEW.base_id AND user_id=NEW.user_id;
 SELECT * INTO c FROM expert_sales_choices WHERE id=NEW.choice_id AND user_id=NEW.user_id AND base_id=b.id;
 SELECT action='promo' INTO promo FROM expert_sales_choices WHERE base_id=b.id AND revision<c.revision AND action IN('promo','base') ORDER BY revision DESC LIMIT 1;
 IF b.id IS NULL OR EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id) OR c.id IS NULL OR promo IS NULL OR c.action NOT IN('month','quarter') OR NEW.term_months<>(CASE WHEN c.action='month' THEN 1 ELSE 3 END) OR NEW.promo_accepted_flag<>promo OR expert_card_current_messaging_authority(NEW.user_id,b.consent_version) IS NOT TRUE THEN RAISE EXCEPTION 'expert_sales_selection_source'; END IF;
 NEW.selected_at:=date_trunc('milliseconds',clock_timestamp());
 energy:=CASE WHEN NOT promo THEN 0 WHEN NEW.selected_at<b.base_offer_shown_at+interval '96 hours' THEN 4000 WHEN NEW.selected_at<b.base_offer_shown_at+interval '168 hours' THEN 3000 WHEN NEW.selected_at<b.base_offer_shown_at+interval '240 hours' THEN 2000 ELSE 0 END;
 pack:=CASE WHEN NOT promo OR NEW.selected_at>=b.base_offer_shown_at+interval '168 hours' THEN 0 WHEN b.participant_kind='space' THEN 1000 WHEN NEW.selected_at<b.base_offer_shown_at+interval '96 hours' THEN 1500 ELSE 1000 END;
 stage_end:=CASE WHEN NEW.selected_at<b.base_offer_shown_at+interval '96 hours' THEN b.base_offer_shown_at+interval '96 hours' WHEN NEW.selected_at<b.base_offer_shown_at+interval '168 hours' THEN b.base_offer_shown_at+interval '168 hours' WHEN NEW.selected_at<b.base_offer_shown_at+interval '240 hours' THEN b.base_offer_shown_at+interval '240 hours' ELSE NEW.selected_at+interval '24 hours' END;
 monthly:=greatest(500000,div(b.base_tariff_amount::numeric*(10000-energy)+5000,10000));
 quarter:=CASE WHEN NEW.selected_at<b.base_offer_shown_at+interval '168 hours' THEN greatest(1500000,div(b.base_tariff_amount::numeric*3*(10000-energy)*(10000-pack)+50000000,100000000)) ELSE NULL END;
 IF ROW(NEW.energy_discount_bps,NEW.package_discount_bps,NEW.monthly_price_minor,NEW.package_price_minor) IS DISTINCT FROM ROW(energy,pack,monthly,quarter) OR (NEW.term_months=3 AND quarter IS NULL) THEN RAISE EXCEPTION 'expert_sales_selection_arithmetic'; END IF;
 NEW.offer_expiry_date:=stage_end; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_selection_source BEFORE INSERT ON expert_sales_selections FOR EACH ROW EXECUTE FUNCTION expert_sales_selection_source();
CREATE TRIGGER expert_sales_selection_immutable BEFORE UPDATE OR DELETE ON expert_sales_selections FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TABLE expert_sales_form_bridges (
 application_id uuid PRIMARY KEY REFERENCES expert_onboarding_applications(id) ON DELETE CASCADE,
 form_id uuid NOT NULL UNIQUE, user_id uuid NOT NULL, submitted_revision integer NOT NULL,
 selection_id uuid NOT NULL, quote_id uuid NOT NULL REFERENCES expert_campaign_quotes(id),
 FOREIGN KEY(form_id,user_id) REFERENCES residents_applications(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(selection_id,user_id) REFERENCES expert_sales_selections(id,user_id)
);
--> statement-breakpoint
CREATE TABLE expert_sales_fee_attempts (
 invoice_id uuid PRIMARY KEY REFERENCES expert_onboarding_invoices(id), user_id uuid NOT NULL,
 selection_id uuid NOT NULL, policy_version text NOT NULL DEFAULT 'expert_separated_sales_v3' CHECK(policy_version='expert_separated_sales_v3'),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(selection_id,user_id) REFERENCES expert_sales_selections(id,user_id),
 CHECK(isfinite(expires_at) AND isfinite(created_at) AND expires_at>created_at)
);
--> statement-breakpoint
CREATE TABLE expert_sales_paid_locks (
 user_id uuid PRIMARY KEY REFERENCES users(id), invoice_id uuid NOT NULL UNIQUE REFERENCES expert_onboarding_payment_facts(invoice_id),
 selection_id uuid NOT NULL, final_locked_price bigint NOT NULL, term_months integer NOT NULL,
 locked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(selection_id,user_id) REFERENCES expert_sales_selections(id,user_id),
 CHECK(final_locked_price BETWEEN 500000 AND 999999999999 AND term_months IN(1,3))
);
--> statement-breakpoint
CREATE TABLE expert_sales_recovery_work (
 invoice_id uuid PRIMARY KEY REFERENCES expert_onboarding_payment_facts(invoice_id),
 reason text NOT NULL CHECK(reason IN('expired_terms','duplicate_fee','capture_unproven','application_erased','owner_inactive','consent_unavailable','application_unavailable')),
 status text NOT NULL DEFAULT 'refund_review' CHECK(status='refund_review'), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE FUNCTION expert_sales_paid_lock_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_sales_fee_attempts a JOIN expert_onboarding_payment_facts f ON f.invoice_id=a.invoice_id AND f.user_id=a.user_id AND f.admission='interview' JOIN expert_sales_selections s ON s.id=a.selection_id AND s.user_id=a.user_id WHERE a.invoice_id=NEW.invoice_id AND a.user_id=NEW.user_id AND s.id=NEW.selection_id AND s.selected_total_minor=NEW.final_locked_price AND s.term_months=NEW.term_months AND f.captured_at<a.expires_at AND EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN residents_applications form ON form.id=b.form_id AND form.user_id=b.user_id AND form.revision=b.submitted_revision AND form.submitted_at IS NOT NULL JOIN expert_sales_bases base ON base.user_id=b.user_id JOIN users u ON u.id=b.user_id AND u.active JOIN expert_onboarding_applications app ON app.id=b.application_id AND app.verification_status='approved' WHERE b.user_id=a.user_id AND expert_card_current_messaging_authority(b.user_id,base.consent_version)) AND EXISTS(SELECT 1 FROM expert_sales_provider_requests r JOIN expert_sales_provider_observations o ON o.invoice_id=r.invoice_id AND o.provider_object_id=r.provider_object_id AND o.status='waiting_for_capture' AND o.observed_at<=r.dispatched_at WHERE r.invoice_id=a.invoice_id AND r.kind='capture' AND r.status IN('dispatched','observed') AND r.dispatched_at<a.expires_at AND r.dispatched_at<=f.captured_at)) THEN RAISE EXCEPTION 'expert_sales_paid_lock_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_paid_lock_source BEFORE INSERT ON expert_sales_paid_locks FOR EACH ROW EXECUTE FUNCTION expert_sales_paid_lock_source();
CREATE TRIGGER expert_sales_paid_lock_immutable BEFORE UPDATE OR DELETE ON expert_sales_paid_locks FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER expert_sales_attempt_immutable BEFORE UPDATE OR DELETE ON expert_sales_fee_attempts FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER expert_sales_recovery_immutable BEFORE UPDATE OR DELETE ON expert_sales_recovery_work FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
ALTER TABLE expert_campaign_quotes ADD COLUMN sales_selection_id uuid REFERENCES expert_sales_selections(id), ADD COLUMN paid_lock_invoice_id uuid REFERENCES expert_sales_paid_locks(invoice_id);
--> statement-breakpoint
ALTER TABLE expert_campaign_anchors DROP CONSTRAINT expert_campaign_anchor_valid;
ALTER TABLE expert_campaign_anchors ADD CONSTRAINT expert_campaign_anchor_valid CHECK(rule_version IN('expert_energy_start_v1','expert_energy_start_v2','expert_separated_sales_v3') AND isfinite(calculation_timestamp) AND calculation_timestamp BETWEEN '1970-01-01'::timestamptz AND '275760-09-13'::timestamptz AND calculation_timestamp=date_trunc('milliseconds',calculation_timestamp));
--> statement-breakpoint
-- Preserve every old expression verbatim, with a separate strictly guarded v3 branch.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_expr(conbin,conrelid) AS expr FROM pg_constraint WHERE conrelid='expert_campaign_quotes'::regclass AND conname IN('expert_campaign_quote_identity_valid','expert_campaign_quote_time_valid','expert_campaign_quote_stage_valid','expert_campaign_quote_arithmetic_valid','expert_campaign_quote_v2_valid') LOOP
 EXECUTE format('ALTER TABLE expert_campaign_quotes DROP CONSTRAINT %I',c.conname);
 EXECUTE format('ALTER TABLE expert_campaign_quotes ADD CONSTRAINT %I CHECK ((rule_version=''expert_separated_sales_v3'') OR (%s))',c.conname,c.expr);
 END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE expert_campaign_quotes ADD CONSTRAINT expert_sales_quote_identity CHECK((rule_version='expert_separated_sales_v3' AND sales_selection_id IS NOT NULL AND currency='RUB' AND term_months IN(1,3) AND duration_seconds=2592000*term_months AND price_minor BETWEEN 500000 AND 999999999999 AND isfinite(quoted_at) AND isfinite(expires_at) AND quoted_at<expires_at AND expires_at<=quoted_at+interval '24 hours' AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$') OR (rule_version<>'expert_separated_sales_v3' AND sales_selection_id IS NULL AND paid_lock_invoice_id IS NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resident_verification_price_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.rule_version='expert_separated_sales_v3' AND EXISTS(SELECT 1 FROM expert_sales_bases b WHERE b.user_id=NEW.user_id AND b.base_offer_shown_at=NEW.calculation_timestamp) THEN RETURN NEW; END IF;
 IF NOT resident_verification_price_allowed(NEW.user_id) THEN RAISE EXCEPTION 'resident_verification_required'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION expert_sales_quote_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s expert_sales_selections%ROWTYPE; b expert_sales_bases%ROWTYPE; t expert_residency_tariff_versions%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 SELECT * INTO s FROM expert_sales_selections WHERE id=NEW.sales_selection_id AND user_id=NEW.user_id;
 SELECT * INTO b FROM expert_sales_bases WHERE id=s.base_id AND user_id=s.user_id;
 SELECT * INTO t FROM expert_residency_tariff_versions WHERE id=b.tariff_version_id;
 IF s.id IS NULL OR b.id IS NULL OR t.id IS NULL OR expert_card_current_messaging_authority(NEW.user_id,b.consent_version) IS NOT TRUE
 OR ROW(NEW.tariff_version_id,NEW.profile_revision,NEW.calculation_timestamp,NEW.term_months,NEW.base_monthly_minor,NEW.monthly_price_minor,NEW.package_price_minor,NEW.price_minor,NEW.energy_discount_bps,NEW.start_discount_bps,NEW.display_name,NEW.credit_cap_bps,NEW.individual_services_enabled,NEW.group_event_limit,NEW.statistics_level,NEW.support_priority)
 IS DISTINCT FROM ROW(b.tariff_version_id,b.profile_revision,b.base_offer_shown_at,s.term_months,b.base_tariff_amount,s.monthly_price_minor,s.package_price_minor,s.selected_total_minor,s.energy_discount_bps,s.package_discount_bps,t.display_name,t.credit_cap_bps,t.individual_services_enabled,t.group_event_limit,t.statistics_level,t.support_priority)
 OR NEW.discounted_monthly_minor<>div(b.base_tariff_amount::numeric*(10000-s.energy_discount_bps)+5000,10000) OR NEW.floor_applied IS DISTINCT FROM (CASE WHEN s.term_months=1 THEN div(b.base_tariff_amount::numeric*(10000-s.energy_discount_bps)+5000,10000)<500000 ELSE div(b.base_tariff_amount::numeric*3*(10000-s.energy_discount_bps)*(10000-s.package_discount_bps)+50000000,100000000)<1500000 END)
 OR NEW.quoted_at>clock_timestamp() OR NEW.expires_at<=clock_timestamp()
 OR (NEW.paid_lock_invoice_id IS NULL AND (NEW.expires_at>s.offer_expiry_date OR EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id)))
 OR (NEW.paid_lock_invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expert_sales_paid_locks l WHERE l.user_id=NEW.user_id AND l.invoice_id=NEW.paid_lock_invoice_id AND l.selection_id=s.id AND l.final_locked_price=NEW.price_minor AND l.term_months=NEW.term_months))
 THEN RAISE EXCEPTION 'expert_sales_quote_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_quote_source BEFORE INSERT ON expert_campaign_quotes FOR EACH ROW WHEN(NEW.rule_version='expert_separated_sales_v3') EXECUTE FUNCTION expert_sales_quote_source();
--> statement-breakpoint
CREATE FUNCTION expert_sales_bridge_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM residents_applications f JOIN expert_sales_selections s ON s.user_id=f.user_id JOIN expert_campaign_quotes q ON q.sales_selection_id=s.id AND q.user_id=f.user_id JOIN expert_onboarding_applications a ON a.campaign_quote_id=q.id AND a.user_id=f.user_id WHERE f.id=NEW.form_id AND f.user_id=NEW.user_id AND f.status='UNDER_REVIEW' AND f.submitted_at IS NOT NULL AND f.revision=NEW.submitted_revision AND s.id=NEW.selection_id AND q.id=NEW.quote_id AND a.id=NEW.application_id AND a.verification_status='pending') THEN RAISE EXCEPTION 'expert_sales_bridge_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_bridge_source BEFORE INSERT ON expert_sales_form_bridges FOR EACH ROW EXECUTE FUNCTION expert_sales_bridge_source();
CREATE TRIGGER expert_sales_bridge_immutable BEFORE UPDATE ON expert_sales_form_bridges FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE FUNCTION expert_sales_attempt_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN expert_onboarding_invoices i ON i.application_id=b.application_id AND i.user_id=b.user_id JOIN expert_verification_decisions d ON d.id=i.decision_id AND d.decision='approved' JOIN expert_sales_selections s ON s.id=b.selection_id WHERE i.id=NEW.invoice_id AND b.user_id=NEW.user_id AND s.id=NEW.selection_id AND NEW.expires_at<=s.offer_expiry_date AND NEW.expires_at<=NEW.created_at+interval '24 hours' AND NEW.created_at>=d.created_at) THEN RAISE EXCEPTION 'expert_sales_attempt_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_attempt_source BEFORE INSERT ON expert_sales_fee_attempts FOR EACH ROW EXECUTE FUNCTION expert_sales_attempt_source();
--> statement-breakpoint
ALTER TABLE expert_onboarding_payment_facts DROP CONSTRAINT expert_onboarding_fact_admission;
ALTER TABLE expert_onboarding_payment_facts ADD CONSTRAINT expert_onboarding_fact_admission CHECK((admission='interview' AND reason_code='payment_verified') OR (admission='blocked' AND reason_code IN('application_erased','owner_inactive','consent_unavailable','application_unavailable','expired_terms','duplicate_fee','capture_unproven')));

--> statement-breakpoint
ALTER FUNCTION expert_campaign_current_profile_valid(uuid,uuid) RENAME TO expert_campaign_current_profile_valid_v2;
CREATE FUNCTION expert_campaign_current_profile_valid(target_user uuid,target_quote uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT expert_campaign_current_profile_valid_v2(target_user,target_quote) OR EXISTS(SELECT 1 FROM expert_campaign_quotes q JOIN expert_sales_paid_locks l ON l.user_id=q.user_id AND l.invoice_id=q.paid_lock_invoice_id AND l.selection_id=q.sales_selection_id JOIN expert_sales_form_bridges b ON b.user_id=q.user_id AND b.selection_id=l.selection_id JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.verification_status='approved' WHERE q.id=target_quote AND q.user_id=target_user AND q.rule_version='expert_separated_sales_v3')
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_campaign_order_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  quote expert_campaign_quotes%ROWTYPE;
  tariff expert_residency_tariff_versions%ROWTYPE;
  expert experts%ROWTYPE;
  checked_at timestamptz;
BEGIN
  IF NEW.commercial_policy_version <> 'expert_campaign_v1' THEN RETURN NEW; END IF;
  SELECT * INTO quote FROM expert_campaign_quotes WHERE id=NEW.campaign_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expert_campaign_order_source' USING ERRCODE='23514';
  END IF;
  LOCK TABLE consent_document_versions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(quote.user_id::text,0));
  IF NOT expert_campaign_current_profile_valid(quote.user_id,quote.id) THEN RAISE EXCEPTION 'expert_offer_current_profile_required' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM users WHERE id=quote.user_id AND active=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expert_campaign_order_source' USING ERRCODE='23514'; END IF;
  SELECT * INTO expert FROM experts WHERE id=NEW.expert_id FOR SHARE;
  IF NOT FOUND OR expert.user_id IS DISTINCT FROM quote.user_id OR (
    (quote.rule_version IN('expert_energy_start_v2','expert_separated_sales_v3') OR NOT expert.active OR NOT expert.verified) AND NOT EXISTS(
      SELECT 1 FROM expert_card_main_acceptances a WHERE a.expert_id=NEW.expert_id AND a.user_id=quote.user_id
        AND a.quote_id=quote.id AND a.application_id IS NOT NULL AND a.review_id IS NOT NULL
        AND expert_card_activation_gate_valid(a.user_id,a.review_id)
        AND (a.acceptance_source='explicit' OR a.offer_schedule_id=(SELECT latest.id FROM expert_offer_schedules latest WHERE latest.user_id=quote.user_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)))) THEN
    RAISE EXCEPTION 'expert_campaign_order_source' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM expert_campaign_quotes WHERE id=quote.id FOR SHARE;
  SELECT * INTO tariff FROM expert_residency_tariff_versions WHERE id=quote.tariff_version_id FOR SHARE;
  checked_at := clock_timestamp();
  IF checked_at < quote.quoted_at OR checked_at >= quote.expires_at THEN
    RAISE EXCEPTION 'expert_campaign_order_expired' USING ERRCODE='23514',CONSTRAINT='expert_campaign_order_expired';
  END IF;
  IF NOT FOUND OR tariff.commercial_policy_version <> 'expert_residency_v2'
    OR ((checked_at < tariff.active_from OR checked_at >= tariff.active_to) AND NOT (quote.rule_version='expert_separated_sales_v3' AND EXISTS(SELECT 1 FROM expert_sales_paid_locks l WHERE l.user_id=quote.user_id AND l.invoice_id=quote.paid_lock_invoice_id AND l.selection_id=quote.sales_selection_id)))
    OR NEW.created_at < quote.quoted_at OR NEW.created_at > checked_at
    OR NEW.provider_deadline IS DISTINCT FROM quote.expires_at
    OR NOT isfinite(NEW.created_at) OR NOT isfinite(NEW.payment_deadline)
    OR ROW(NEW.tariff_version_id,NEW.campaign_term_months,NEW.snapshot_display_name,NEW.price_minor,NEW.currency,
      NEW.duration_seconds,NEW.credit_cap_bps,NEW.individual_services_enabled,NEW.group_event_limit,NEW.statistics_level,NEW.support_priority)
      IS DISTINCT FROM ROW(quote.tariff_version_id,quote.term_months,quote.display_name,quote.price_minor,quote.currency,
      quote.duration_seconds,quote.credit_cap_bps,quote.individual_services_enabled,quote.group_event_limit,quote.statistics_level,quote.support_priority)
  THEN RAISE EXCEPTION 'expert_campaign_order_source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_main_activation_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT expert_campaign_current_profile_valid(NEW.user_id,NEW.quote_id) OR NOT EXISTS(
 SELECT 1 FROM expert_card_main_orders m JOIN expert_residency_orders o ON o.id=m.order_id AND o.expert_id=m.expert_id AND o.campaign_quote_id=m.quote_id AND o.status='settled'
 JOIN expert_campaign_quotes q ON q.id=m.quote_id AND q.user_id=m.user_id AND q.rule_version IN ('expert_energy_start_v1','expert_energy_start_v2','expert_separated_sales_v3') AND q.profile_revision IS NOT DISTINCT FROM NEW.profile_revision
 JOIN expert_residency_provider_event_inbox p ON p.id=NEW.provider_event_id AND p.order_id=o.id AND p.provider='yookassa' AND p.authenticated=true AND p.identity_version=1 AND p.status='processing' AND p.event_kind='settled' AND p.amount_minor=o.cash_minor AND p.currency=o.currency AND p.payment_id=o.provider_payment_id
 JOIN expert_residency_provider_operations po ON po.order_id=o.id AND po.operation_kind='create_payment' AND po.environment_mode=m.provider_mode AND po.provider_object_id=p.payment_id AND po.amount_minor=p.amount_minor AND po.currency=p.currency AND po.status IN('pending','unknown_outcome','succeeded')
 WHERE m.order_id=NEW.order_id AND m.user_id=NEW.user_id AND m.expert_id=NEW.expert_id AND m.quote_id=NEW.quote_id AND m.purpose='main_residency'
 AND m.application_audit_id=NEW.application_audit_id AND m.review_audit_id=NEW.review_audit_id AND m.public_digest=NEW.public_digest
 AND m.application_id IS NOT NULL AND m.review_id IS NOT NULL AND expert_card_activation_gate_valid(m.user_id,m.review_id)
 AND NEW.admitted_at>=p.verified_at AND NEW.admitted_at<=clock_timestamp()) THEN RAISE EXCEPTION 'expert_main_activation_admission_source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE VIEW resident_sales_application AS
 SELECT f.*,b.base_tariff_amount,b.base_offer_shown_at,
 s.promo_accepted_flag,l.final_locked_price,s.offer_expiry_date,
 s.monthly_price_minor,s.package_price_minor,s.selected_total_minor,s.term_months,
 CASE WHEN l.user_id IS NOT NULL THEN 'ONBOARDING_STARTED' WHEN clock_timestamp()>=b.base_offer_shown_at+interval '240 hours' THEN 'STANDARD_TARIFF_LOCKED' ELSE 'UNPAID' END AS sales_status
 FROM residents_applications f JOIN expert_sales_bases b ON b.user_id=f.user_id
 LEFT JOIN LATERAL (SELECT s.* FROM expert_sales_selections s WHERE s.base_id=b.id ORDER BY s.selected_at DESC,s.id DESC LIMIT 1) s ON true
 LEFT JOIN expert_sales_paid_locks l ON l.user_id=f.user_id;
--> statement-breakpoint
CREATE TABLE expert_sales_provider_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),invoice_id uuid NOT NULL REFERENCES expert_sales_fee_attempts(invoice_id),
 kind text NOT NULL CHECK(kind IN('create','capture','cancel')), idempotency_key uuid NOT NULL UNIQUE,
 request_body text, encrypted_body text,key_reference text,request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
 body_expires_at timestamptz CHECK(body_expires_at IS NULL OR isfinite(body_expires_at)),contact_id uuid REFERENCES payer_receipt_contacts(id), status text NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','dispatched','observed','cancelled')),
 provider_object_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), dispatched_at timestamptz,
 UNIQUE(invoice_id,kind), CHECK((kind='create' AND request_body IS NULL AND contact_id IS NOT NULL) OR (kind='capture' AND request_body='{"amount":{"value":"3000.00","currency":"RUB"}}' AND contact_id IS NULL) OR (kind='cancel' AND request_body='{}' AND contact_id IS NULL)),
 CHECK((encrypted_body IS NULL)=(key_reference IS NULL))
);
--> statement-breakpoint
CREATE TABLE expert_sales_provider_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),invoice_id uuid NOT NULL REFERENCES expert_sales_fee_attempts(invoice_id),
 provider_object_id text NOT NULL,status text NOT NULL CHECK(status IN('pending','waiting_for_capture','succeeded','canceled')),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[0-9a-f]{64}$'), observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(invoice_id,evidence_digest)
);
--> statement-breakpoint
CREATE TRIGGER expert_sales_observation_immutable BEFORE UPDATE OR DELETE ON expert_sales_provider_observations FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE FUNCTION expert_sales_provider_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['encrypted_body','key_reference','status','provider_object_id','dispatched_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['encrypted_body','key_reference','status','provider_object_id','dispatched_at']) OR (OLD.encrypted_body IS DISTINCT FROM NEW.encrypted_body AND NEW.encrypted_body IS NOT NULL) OR (OLD.key_reference IS DISTINCT FROM NEW.key_reference AND NEW.key_reference IS NOT NULL) OR (OLD.provider_object_id IS NOT NULL AND OLD.provider_object_id IS DISTINCT FROM NEW.provider_object_id) OR (OLD.dispatched_at IS NOT NULL AND OLD.dispatched_at IS DISTINCT FROM NEW.dispatched_at) OR (OLD.status<>'prepared' AND NEW.status='prepared') THEN RAISE EXCEPTION 'expert_sales_request_immutable'; END IF;
 ELSE
  IF NEW.status<>'prepared' OR NEW.dispatched_at IS NOT NULL OR (NEW.kind='create' AND (NEW.encrypted_body IS NULL OR NEW.key_reference IS NULL OR NEW.body_expires_at IS NULL OR NEW.body_expires_at<=clock_timestamp())) OR (NEW.kind<>'create' AND NOT EXISTS(SELECT 1 FROM expert_sales_provider_observations o WHERE o.invoice_id=NEW.invoice_id AND o.provider_object_id=NEW.provider_object_id AND o.status='waiting_for_capture' AND o.observed_at>clock_timestamp()-interval '30 seconds')) THEN RAISE EXCEPTION 'expert_sales_request_source'; END IF;
 END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_provider_request_guard BEFORE INSERT OR UPDATE ON expert_sales_provider_requests FOR EACH ROW EXECUTE FUNCTION expert_sales_provider_request_guard();
CREATE TRIGGER expert_sales_provider_request_no_delete BEFORE DELETE ON expert_sales_provider_requests FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
-- Legacy invoices retain their single-attempt uniqueness. v3 retries are explicit,
-- monotonically numbered attempts of the same genuine manager decision.
ALTER TABLE expert_onboarding_invoices ADD COLUMN sales_attempt_number integer CHECK(sales_attempt_number>0);
ALTER TABLE expert_onboarding_invoices DROP CONSTRAINT expert_onboarding_invoices_application_audit_id_key;
ALTER TABLE expert_onboarding_invoices DROP CONSTRAINT expert_onboarding_invoices_decision_id_key;
CREATE UNIQUE INDEX expert_onboarding_legacy_application_once ON expert_onboarding_invoices(application_audit_id) WHERE sales_attempt_number IS NULL;
CREATE UNIQUE INDEX expert_onboarding_legacy_decision_once ON expert_onboarding_invoices(decision_id) WHERE sales_attempt_number IS NULL;
CREATE UNIQUE INDEX expert_onboarding_sales_attempt_once ON expert_onboarding_invoices(decision_id,sales_attempt_number) WHERE sales_attempt_number IS NOT NULL;
--> statement-breakpoint
ALTER TABLE expert_sales_selections DROP CONSTRAINT expert_sales_selections_choice_id_key;
CREATE UNIQUE INDEX expert_sales_selection_clock_once ON expert_sales_selections(choice_id,selected_at);
--> statement-breakpoint
CREATE TABLE expert_sales_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),base_id uuid NOT NULL REFERENCES expert_sales_bases(id),stage_at timestamptz NOT NULL,kind text NOT NULL CHECK(kind IN('refresh','24h','3h','reselect')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','dispatched','delivered','cancelled')),attempt_id uuid,receipt jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(base_id,stage_at,kind),CHECK(receipt IS NULL OR status='delivered')
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION expert_sales_attempt_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_sales_form_bridges b JOIN expert_onboarding_invoices i ON i.application_id=b.application_id AND i.user_id=b.user_id JOIN expert_verification_decisions d ON d.id=i.decision_id AND d.decision='approved' JOIN expert_sales_selections approved ON approved.id=b.selection_id JOIN expert_sales_selections s ON s.base_id=approved.base_id AND s.id=(SELECT id FROM expert_sales_selections WHERE user_id=b.user_id ORDER BY selected_at DESC,id DESC LIMIT 1) JOIN residents_applications form ON form.id=b.form_id AND form.user_id=b.user_id AND form.revision=b.submitted_revision AND form.submitted_at IS NOT NULL WHERE i.id=NEW.invoice_id AND b.user_id=NEW.user_id AND s.id=NEW.selection_id AND NEW.expires_at<=s.offer_expiry_date AND NEW.expires_at<=NEW.created_at+interval '24 hours' AND NEW.created_at>=d.created_at AND i.sales_attempt_number IS NOT NULL) THEN RAISE EXCEPTION 'expert_sales_attempt_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION expert_sales_invoice_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.sales_attempt_number IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM expert_sales_form_bridges b WHERE b.application_id=NEW.application_id AND b.user_id=NEW.user_id) OR NEW.sales_attempt_number<>(SELECT coalesce(max(sales_attempt_number),0)+1 FROM expert_onboarding_invoices WHERE decision_id=NEW.decision_id) OR (NEW.sales_attempt_number>1 AND NOT EXISTS(SELECT 1 FROM expert_onboarding_invoices prior JOIN expert_sales_fee_attempts prior_terms ON prior_terms.invoice_id=prior.id WHERE prior.decision_id=NEW.decision_id AND prior.sales_attempt_number=NEW.sales_attempt_number-1 AND prior_terms.expires_at<=clock_timestamp())) OR EXISTS(SELECT 1 FROM expert_sales_provider_requests r JOIN expert_onboarding_invoices prior ON prior.id=r.invoice_id WHERE prior.user_id=NEW.user_id AND r.status='dispatched') OR EXISTS(SELECT 1 FROM expert_sales_paid_locks WHERE user_id=NEW.user_id) THEN RAISE EXCEPTION 'expert_sales_invoice_source'; END IF;
 ELSIF EXISTS(SELECT 1 FROM expert_sales_bases WHERE user_id=NEW.user_id) THEN RAISE EXCEPTION 'expert_sales_invoice_version_required';
 END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_invoice_source BEFORE INSERT ON expert_onboarding_invoices FOR EACH ROW EXECUTE FUNCTION expert_sales_invoice_source();
--> statement-breakpoint
CREATE TABLE expert_sales_erased_cohorts(user_id uuid PRIMARY KEY REFERENCES users(id),erased_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE expert_sales_bases ALTER COLUMN bot_id DROP NOT NULL,ALTER COLUMN bot_key DROP NOT NULL,ALTER COLUMN chat_id DROP NOT NULL,ALTER COLUMN consent_version DROP NOT NULL;
ALTER TABLE expert_sales_choices ALTER COLUMN request_key DROP NOT NULL,ALTER COLUMN request_digest DROP NOT NULL;
--> statement-breakpoint
CREATE FUNCTION expert_sales_privacy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid; BEGIN
 owner:=OLD.user_id;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='expert_sales_bases' THEN
  IF (to_jsonb(NEW)-ARRAY['bot_id','bot_key','chat_id','consent_version'])=(to_jsonb(OLD)-ARRAY['bot_id','bot_key','chat_id','consent_version']) AND NEW.bot_id IS NULL AND NEW.bot_key IS NULL AND NEW.chat_id IS NULL AND NEW.consent_version IS NULL THEN RETURN NEW; END IF; END IF;
  IF TG_TABLE_NAME='expert_sales_choices' THEN
  IF (to_jsonb(NEW)-ARRAY['request_key','request_digest'])=(to_jsonb(OLD)-ARRAY['request_key','request_digest']) AND NEW.request_key IS NULL AND NEW.request_digest IS NULL THEN RETURN NEW; END IF; END IF;
 END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=owner) AND NOT EXISTS(SELECT 1 FROM expert_onboarding_invoices WHERE user_id=owner) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'expert_sales_immutable';
END $$;
--> statement-breakpoint
DROP TRIGGER expert_sales_base_immutable ON expert_sales_bases;
DROP TRIGGER expert_sales_choice_immutable ON expert_sales_choices;
DROP TRIGGER expert_sales_selection_immutable ON expert_sales_selections;
CREATE TRIGGER expert_sales_base_immutable BEFORE UPDATE OR DELETE ON expert_sales_bases FOR EACH ROW EXECUTE FUNCTION expert_sales_privacy_guard();
CREATE TRIGGER expert_sales_choice_immutable BEFORE UPDATE OR DELETE ON expert_sales_choices FOR EACH ROW EXECUTE FUNCTION expert_sales_privacy_guard();
CREATE TRIGGER expert_sales_selection_immutable BEFORE UPDATE OR DELETE ON expert_sales_selections FOR EACH ROW EXECUTE FUNCTION expert_sales_privacy_guard();
--> statement-breakpoint
CREATE FUNCTION erase_expert_sales_subject(subject uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(subject::text,0));
 IF NOT EXISTS(SELECT 1 FROM expert_sales_bases WHERE user_id=subject) THEN RETURN; END IF;
 INSERT INTO expert_sales_erased_cohorts(user_id) VALUES(subject) ON CONFLICT DO NOTHING;
 UPDATE expert_sales_bases SET bot_id=NULL,bot_key=NULL,chat_id=NULL,consent_version=NULL WHERE user_id=subject;
 UPDATE expert_sales_choices SET request_key=NULL,request_digest=NULL WHERE user_id=subject;
 UPDATE expert_sales_provider_requests r SET encrypted_body=NULL,key_reference=NULL,status=CASE WHEN status='prepared' THEN 'cancelled' ELSE status END FROM expert_sales_fee_attempts a WHERE a.invoice_id=r.invoice_id AND a.user_id=subject;
 UPDATE expert_sales_notices n SET status='cancelled',receipt=NULL FROM expert_sales_bases b WHERE b.id=n.base_id AND b.user_id=subject;
 -- Uninvoiced sales with no issued quote can be removed completely; the opaque
 -- tombstone prevents a later consent grant from resetting the campaign clock.
 IF NOT EXISTS(SELECT 1 FROM expert_campaign_quotes WHERE user_id=subject) AND NOT EXISTS(SELECT 1 FROM expert_onboarding_invoices WHERE user_id=subject) THEN
  DELETE FROM expert_sales_ticks WHERE base_id IN(SELECT id FROM expert_sales_bases WHERE user_id=subject);
  DELETE FROM expert_sales_notices WHERE base_id IN(SELECT id FROM expert_sales_bases WHERE user_id=subject);
  DELETE FROM expert_sales_selections WHERE user_id=subject;
  DELETE FROM expert_sales_choices WHERE user_id=subject;
  DELETE FROM expert_sales_bases WHERE user_id=subject;
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION expert_sales_privacy_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='users' THEN PERFORM erase_expert_sales_subject(NEW.id);
 ELSIF TG_TABLE_NAME='channel_identities' OR TG_OP='DELETE' THEN PERFORM erase_expert_sales_subject(OLD.user_id);
 ELSE PERFORM erase_expert_sales_subject(NEW.user_id); END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER expert_sales_user_erasure AFTER UPDATE OF active ON users FOR EACH ROW WHEN(OLD.active AND NOT NEW.active) EXECUTE FUNCTION expert_sales_privacy_cleanup();
CREATE TRIGGER expert_sales_consent_erasure AFTER INSERT ON consents FOR EACH ROW WHEN(NEW.consent_type='client_messaging' AND NEW.decision IN('denied','revoked')) EXECUTE FUNCTION expert_sales_privacy_cleanup();
CREATE TRIGGER expert_sales_form_erasure AFTER DELETE ON residents_applications FOR EACH ROW EXECUTE FUNCTION expert_sales_privacy_cleanup();
CREATE TRIGGER expert_sales_identity_erasure AFTER DELETE ON channel_identities FOR EACH ROW EXECUTE FUNCTION expert_sales_privacy_cleanup();
CREATE TRIGGER expert_sales_identity_revocation AFTER UPDATE OF status,user_id,provider,bot_key,external_id,external_chat_id ON channel_identities FOR EACH ROW WHEN(NEW.status<>'active' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR ROW(NEW.provider,NEW.bot_key,NEW.external_id,NEW.external_chat_id) IS DISTINCT FROM ROW(OLD.provider,OLD.bot_key,OLD.external_id,OLD.external_chat_id)) EXECUTE FUNCTION expert_sales_privacy_cleanup();
--> statement-breakpoint
CREATE TABLE expert_sales_ticks(base_id uuid PRIMARY KEY REFERENCES expert_sales_bases(id),checked_at timestamptz NOT NULL DEFAULT '-infinity');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION expert_campaign_current_profile_valid(target_user uuid,target_quote uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT expert_campaign_current_profile_valid_v2(target_user,target_quote) OR EXISTS(
 SELECT 1 FROM expert_campaign_quotes q JOIN expert_sales_paid_locks l ON l.user_id=q.user_id AND l.invoice_id=q.paid_lock_invoice_id AND l.selection_id=q.sales_selection_id
 JOIN expert_sales_selections selected ON selected.id=l.selection_id JOIN expert_sales_form_bridges b ON b.user_id=q.user_id
 JOIN expert_sales_selections original ON original.id=b.selection_id AND original.base_id=selected.base_id
 JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.verification_status='approved'
 WHERE q.id=target_quote AND q.user_id=target_user AND q.rule_version='expert_separated_sales_v3' )
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_expert_card_main_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.application_id IS NULL OR NEW.review_id IS NULL OR NOT expert_campaign_current_profile_valid(NEW.user_id,NEW.quote_id) OR NOT expert_card_activation_gate_valid(NEW.user_id,NEW.review_id)
 OR NOT EXISTS(SELECT 1 FROM expert_card_drafts d JOIN expert_card_reviews r ON r.id=d.approved_review_id
   JOIN expert_campaign_quotes q ON q.id=NEW.quote_id AND q.user_id=NEW.user_id
   JOIN experts e ON e.id=NEW.expert_id AND e.user_id=NEW.user_id
   WHERE d.application_id=NEW.application_id AND d.user_id=NEW.user_id AND r.id=NEW.review_id
     AND r.revision=NEW.revision AND r.public_digest=NEW.public_digest AND q.quoted_at<=clock_timestamp() AND q.expires_at>clock_timestamp()
     AND (q.rule_version='expert_energy_start_v1' OR (q.rule_version='expert_separated_sales_v3' AND EXISTS(SELECT 1 FROM expert_sales_paid_locks l WHERE l.user_id=q.user_id AND l.invoice_id=q.paid_lock_invoice_id AND l.selection_id=q.sales_selection_id)) OR (q.rule_version='expert_energy_start_v2' AND q.profile_revision=(SELECT max(revision) FROM expert_offer_profiles WHERE user_id=NEW.user_id) AND EXISTS(SELECT 1 FROM expert_offer_profile_verifications pv WHERE pv.user_id=NEW.user_id AND pv.profile_revision=q.profile_revision)))) THEN
  RAISE EXCEPTION 'expert_card_main_acceptance_source' USING ERRCODE='23514';
 END IF;
 IF NEW.acceptance_source='schedule' AND NOT EXISTS(SELECT 1 FROM expert_offer_schedules s JOIN expert_campaign_quotes q ON q.id=NEW.quote_id JOIN expert_card_main_acceptances original ON original.id=s.original_acceptance_id AND original.acceptance_source='explicit'
 WHERE s.id=NEW.offer_schedule_id AND s.id=(SELECT latest.id FROM expert_offer_schedules latest WHERE latest.user_id=NEW.user_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1) AND s.user_id=NEW.user_id AND s.application_id=NEW.application_id AND s.expert_id=NEW.expert_id AND s.review_id=NEW.review_id AND s.revision=NEW.revision AND s.public_digest=NEW.public_digest AND s.tariff_version_id=q.tariff_version_id AND s.term_months=q.term_months AND s.profile_revision=q.profile_revision) THEN RAISE EXCEPTION 'expert_offer_schedule_binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
