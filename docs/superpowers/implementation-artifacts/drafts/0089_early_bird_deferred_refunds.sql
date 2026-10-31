-- DRAFT ONLY. Requires 0082 and 0088. No grants or role creation.
-- Keep one global provider-refund namespace shared with composite payments.
ALTER TABLE early_bird_deferred_invoices ADD CONSTRAINT early_bird_deferred_invoice_identity UNIQUE(id,user_id);
ALTER TABLE early_bird_refund_registry ALTER COLUMN intent_id DROP NOT NULL;
ALTER TABLE early_bird_refund_registry ADD COLUMN deferred_invoice_id uuid;
ALTER TABLE early_bird_refund_registry ADD CONSTRAINT early_bird_refund_registry_deferred_fk FOREIGN KEY(deferred_invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE;
ALTER TABLE early_bird_refund_registry ADD CONSTRAINT early_bird_refund_registry_exact_source CHECK ((intent_id IS NOT NULL)::integer + (deferred_invoice_id IS NOT NULL)::integer = 1);
CREATE TABLE early_bird_deferred_verified_refund_bindings (
 provider_refund_id text PRIMARY KEY CHECK(provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 invoice_id uuid NOT NULL,
 user_id uuid NOT NULL,
 provider_payment_id text NOT NULL CHECK(provider_payment_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 amount_minor bigint NOT NULL CHECK(amount_minor > 0),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE
);
-- Reserve provider refund IDs at binding time across both products, even while pending.
CREATE TABLE early_bird_refund_binding_registry (
 provider_refund_id text PRIMARY KEY CHECK(provider_refund_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 product text NOT NULL CHECK(product IN ('composite','deferred')),
 user_id uuid NOT NULL,
 subject_id uuid NOT NULL
);
REVOKE ALL ON early_bird_refund_binding_registry FROM PUBLIC;
INSERT INTO early_bird_refund_binding_registry(provider_refund_id,product,user_id,subject_id)
 SELECT provider_refund_id,'composite',user_id,intent_id FROM early_bird_verified_refund_bindings;
INSERT INTO early_bird_refund_binding_registry(provider_refund_id,product,user_id,subject_id)
 SELECT provider_refund_id,'deferred',user_id,invoice_id FROM early_bird_deferred_verified_refund_bindings;
CREATE FUNCTION early_bird_refund_binding_registry_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN DELETE FROM public.early_bird_refund_binding_registry WHERE user_id=NEW.user_id; RETURN NULL; END $$;
CREATE TRIGGER early_bird_refund_binding_registry_erasure AFTER INSERT ON expert_sales_erased_cohorts FOR EACH ROW EXECUTE FUNCTION early_bird_refund_binding_registry_erasure();
CREATE FUNCTION early_bird_refund_binding_registry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject uuid; kind text;
BEGIN
 IF TG_TABLE_NAME='early_bird_deferred_verified_refund_bindings' THEN subject:=NEW.invoice_id; kind:='deferred'; ELSE subject:=NEW.intent_id; kind:='composite'; END IF;
 INSERT INTO public.early_bird_refund_binding_registry(provider_refund_id,product,user_id,subject_id) VALUES(NEW.provider_refund_id,kind,NEW.user_id,subject) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_refund_binding_global_conflict'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_deferred_refund_global_binding BEFORE INSERT ON early_bird_deferred_verified_refund_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_refund_binding_registry_guard();
CREATE TRIGGER early_bird_composite_refund_global_binding BEFORE INSERT ON early_bird_verified_refund_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_refund_binding_registry_guard();
CREATE TABLE early_bird_deferred_refund_resolutions (
 provider_refund_id text PRIMARY KEY REFERENCES early_bird_deferred_verified_refund_bindings(provider_refund_id) ON DELETE CASCADE,
 invoice_id uuid NOT NULL,
 user_id uuid NOT NULL,
 disposition text NOT NULL CHECK(disposition='canceled'),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE
);
CREATE TABLE early_bird_deferred_refund_facts (
 provider_refund_id text PRIMARY KEY REFERENCES early_bird_deferred_verified_refund_bindings(provider_refund_id) ON DELETE CASCADE,
 invoice_id uuid NOT NULL,
 user_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor > 0),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 FOREIGN KEY(invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE
);
CREATE TABLE early_bird_deferred_refund_reconciliation (
 provider_refund_id text PRIMARY KEY REFERENCES early_bird_deferred_refund_facts(provider_refund_id) ON DELETE CASCADE,
 invoice_id uuid NOT NULL,
 user_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(invoice_id,user_id) REFERENCES early_bird_deferred_invoices(id,user_id) ON DELETE CASCADE
);
REVOKE ALL ON early_bird_deferred_verified_refund_bindings,early_bird_deferred_refund_facts,early_bird_deferred_refund_reconciliation,early_bird_deferred_refund_resolutions FROM PUBLIC;
CREATE FUNCTION early_bird_deferred_refund_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) OR EXISTS(SELECT 1 FROM expert_sales_erased_cohorts WHERE user_id=OLD.user_id)) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'early_bird_deferred_refund_immutable';
END $$;
CREATE TRIGGER early_bird_deferred_refund_binding_immutable BEFORE UPDATE OR DELETE ON early_bird_deferred_verified_refund_bindings FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_immutable();
CREATE TRIGGER early_bird_deferred_refund_fact_immutable BEFORE UPDATE OR DELETE ON early_bird_deferred_refund_facts FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_immutable();
CREATE TRIGGER early_bird_deferred_refund_reconciliation_immutable BEFORE UPDATE OR DELETE ON early_bird_deferred_refund_reconciliation FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_immutable();
CREATE TRIGGER early_bird_deferred_refund_resolution_immutable BEFORE UPDATE OR DELETE ON early_bird_deferred_refund_resolutions FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_immutable();

-- Dedicated protected resolver returns only the captured, bound payment snapshot.
CREATE FUNCTION early_bird_deferred_refund_payment(target_provider text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('invoiceId',i.id::text,'userId',i.user_id::text,'operationId',i.id::text,'grantId',a.grant_id::text,'policy',a.policy_version,'stage',i.stage,'amountMinor',i.amount_minor::text,'mode','live','launchAt',to_char(a.launch_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'providerId',i.provider_id)
 FROM public.early_bird_deferred_invoices i JOIN public.early_bird_deferred_accounts a ON a.id=i.account_id AND a.user_id=i.user_id JOIN public.early_bird_deferred_verified_bindings b ON b.invoice_id=i.id AND b.user_id=i.user_id AND b.provider_id=i.provider_id AND b.evidence_digest=i.evidence_digest
 WHERE i.provider_id=target_provider AND i.captured_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.expert_sales_erased_cohorts e WHERE e.user_id=i.user_id)
$$;
REVOKE ALL ON FUNCTION early_bird_deferred_refund_payment(text) FROM PUBLIC;

-- Only a separate independently verified provider principal may invoke these.
CREATE FUNCTION early_bird_deferred_bind_refund(target_invoice uuid,target_user uuid,target_payment text,target_refund text,target_amount bigint,target_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.early_bird_deferred_invoices%ROWTYPE; old public.early_bird_deferred_verified_refund_bindings%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO i FROM public.early_bird_deferred_invoices WHERE id=target_invoice AND user_id=target_user AND provider_id=target_payment AND captured_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR target_refund IS NULL OR target_refund !~ '^[A-Za-z0-9_-]{1,64}$' OR target_amount IS NULL OR target_amount<=0 OR target_amount>i.amount_minor OR target_evidence IS NULL OR target_evidence !~ '^sha256:[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_verified_bindings b WHERE b.invoice_id=i.id AND b.user_id=i.user_id AND b.provider_id=i.provider_id AND b.evidence_digest=i.evidence_digest) THEN RAISE EXCEPTION 'early_bird_deferred_refund_binding'; END IF;
 SELECT * INTO old FROM public.early_bird_deferred_verified_refund_bindings WHERE provider_refund_id=target_refund FOR UPDATE;
 IF FOUND THEN
  IF old.invoice_id=target_invoice AND old.user_id=target_user AND old.provider_payment_id=target_payment AND old.amount_minor=target_amount AND old.evidence_digest=target_evidence THEN RETURN; END IF;
  RAISE EXCEPTION 'early_bird_deferred_refund_conflict';
 END IF;
 IF EXISTS(SELECT 1 FROM public.early_bird_refund_registry WHERE provider_refund_id=target_refund) OR EXISTS(SELECT 1 FROM public.early_bird_verified_refund_bindings WHERE provider_refund_id=target_refund) THEN RAISE EXCEPTION 'early_bird_deferred_refund_conflict'; END IF;
 INSERT INTO public.early_bird_deferred_verified_refund_bindings(provider_refund_id,invoice_id,user_id,provider_payment_id,amount_minor,evidence_digest) VALUES(target_refund,target_invoice,target_user,target_payment,target_amount,target_evidence);
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_bind_refund(uuid,uuid,text,text,bigint,text) FROM PUBLIC;

CREATE FUNCTION early_bird_deferred_commit_refund(target_invoice uuid,target_user uuid,target_payment text,target_refund text,target_amount bigint,target_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.early_bird_deferred_invoices%ROWTYPE; old public.early_bird_deferred_refund_facts%ROWTYPE; refunded bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 SELECT * INTO i FROM public.early_bird_deferred_invoices WHERE id=target_invoice AND user_id=target_user AND provider_id=target_payment AND captured_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_verified_refund_bindings r WHERE r.invoice_id=target_invoice AND r.user_id=target_user AND r.provider_payment_id=target_payment AND r.provider_refund_id=target_refund AND r.amount_minor=target_amount AND r.evidence_digest=target_evidence) THEN RAISE EXCEPTION 'early_bird_deferred_refund_binding'; END IF;
 IF EXISTS(SELECT 1 FROM public.early_bird_deferred_refund_resolutions WHERE provider_refund_id=target_refund) THEN RAISE EXCEPTION 'early_bird_deferred_refund_canceled'; END IF;
 SELECT * INTO old FROM public.early_bird_deferred_refund_facts WHERE provider_refund_id=target_refund FOR UPDATE;
 IF FOUND THEN
  IF old.invoice_id=target_invoice AND old.user_id=target_user AND old.amount_minor=target_amount AND old.evidence_digest=target_evidence THEN RETURN; END IF;
  RAISE EXCEPTION 'early_bird_deferred_refund_conflict';
 END IF;
 SELECT coalesce(sum(amount_minor),0) INTO refunded FROM public.early_bird_deferred_refund_facts WHERE invoice_id=target_invoice AND user_id=target_user;
 IF target_amount IS NULL OR target_amount<=0 OR refunded+target_amount>i.amount_minor THEN RAISE EXCEPTION 'early_bird_deferred_refund_amount'; END IF;
 INSERT INTO public.early_bird_refund_registry(provider_refund_id,intent_id,deferred_invoice_id,user_id,amount_minor) VALUES(target_refund,NULL,target_invoice,target_user,target_amount);
 INSERT INTO public.early_bird_deferred_refund_facts(provider_refund_id,invoice_id,user_id,amount_minor,evidence_digest) VALUES(target_refund,target_invoice,target_user,target_amount,target_evidence);
 IF target_amount<i.amount_minor THEN INSERT INTO public.early_bird_deferred_refund_reconciliation(provider_refund_id,invoice_id,user_id,amount_minor) VALUES(target_refund,target_invoice,target_user,target_amount); END IF;
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_commit_refund(uuid,uuid,text,text,bigint,text) FROM PUBLIC;
-- Separate verified terminal cancellation permits recovery from a canceled
-- pending refund, but never overrides a recorded successful refund.
CREATE FUNCTION early_bird_deferred_cancel_refund(target_invoice uuid,target_user uuid,target_payment text,target_refund text,target_amount bigint,target_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.early_bird_deferred_verified_refund_bindings%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 PERFORM 1 FROM public.early_bird_deferred_invoices WHERE id=target_invoice AND user_id=target_user AND provider_id=target_payment FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'early_bird_deferred_refund_binding'; END IF;
 SELECT * INTO prior FROM public.early_bird_deferred_verified_refund_bindings WHERE provider_refund_id=target_refund FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF prior.invoice_id<>target_invoice OR prior.user_id<>target_user OR prior.provider_payment_id<>target_payment OR prior.amount_minor<>target_amount OR prior.evidence_digest<>target_evidence OR EXISTS(SELECT 1 FROM public.early_bird_deferred_refund_facts WHERE provider_refund_id=target_refund) THEN RAISE EXCEPTION 'early_bird_deferred_refund_conflict'; END IF;
 INSERT INTO public.early_bird_deferred_refund_resolutions(provider_refund_id,invoice_id,user_id,disposition,evidence_digest) VALUES(target_refund,target_invoice,target_user,'canceled',target_evidence) ON CONFLICT(provider_refund_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION early_bird_deferred_cancel_refund(uuid,uuid,text,text,bigint,text) FROM PUBLIC;

-- Block starting the next stage as soon as any independently observed refund
-- exists for this account. Cancellation/reconciliation requires a reviewed path.
CREATE FUNCTION early_bird_deferred_refund_blocks_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF NEW.stage='subscription' AND EXISTS(SELECT 1 FROM public.early_bird_deferred_invoices i JOIN public.early_bird_deferred_verified_refund_bindings r ON r.invoice_id=i.id AND r.user_id=i.user_id WHERE i.account_id=NEW.account_id AND i.user_id=NEW.user_id AND NOT EXISTS(SELECT 1 FROM public.early_bird_deferred_refund_resolutions resolved WHERE resolved.provider_refund_id=r.provider_refund_id AND resolved.invoice_id=r.invoice_id AND resolved.user_id=r.user_id)) THEN RAISE EXCEPTION 'early_bird_deferred_refund_pending'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER early_bird_deferred_refund_blocks_invoice BEFORE INSERT ON early_bird_deferred_invoices FOR EACH ROW EXECUTE FUNCTION early_bird_deferred_refund_blocks_invoice();
