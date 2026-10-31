-- DRAFT. Install only after wave admission, deferred payments, final-call and
-- verified deferred refund migrations. The deployment remains fail closed.
-- The account UUID is the deferred source key; collisions with composite keys
-- are rejected at lookup. Both captured facts must match verifier bindings.
CREATE VIEW early_bird_deferred_effective_coverages AS
 SELECT a.id AS intent_id,a.user_id,a.launch_at AS starts_at,
        a.launch_at + interval '2592000 seconds' AS ends_at
 FROM early_bird_deferred_accounts a
 JOIN early_bird_deferred_invoices ob ON ob.account_id=a.id AND ob.user_id=a.user_id AND ob.stage='onboarding' AND ob.amount_minor=a.onboarding_minor AND ob.captured_at IS NOT NULL
 JOIN early_bird_deferred_verified_bindings op ON op.invoice_id=ob.id AND op.user_id=ob.user_id AND op.provider_id=ob.provider_id AND op.amount_minor=ob.amount_minor AND op.evidence_digest=ob.evidence_digest
 JOIN early_bird_deferred_invoices sub ON sub.account_id=a.id AND sub.user_id=a.user_id AND sub.stage='subscription' AND sub.amount_minor=a.subscription_minor AND sub.captured_at IS NOT NULL AND sub.captured_at<a.launch_at
 JOIN early_bird_deferred_verified_bindings sp ON sp.invoice_id=sub.id AND sp.user_id=sub.user_id AND sp.provider_id=sub.provider_id AND sp.amount_minor=sub.amount_minor AND sp.evidence_digest=sub.evidence_digest
 WHERE NOT EXISTS(SELECT 1 FROM early_bird_wave_one_exclusions x WHERE x.user_id=a.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_composite_intents collision WHERE collision.id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_refund_facts r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_refund_reconciliation r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_verified_refund_bindings r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_refund_resolutions resolved WHERE resolved.provider_refund_id=r.provider_refund_id AND resolved.invoice_id=r.invoice_id AND resolved.user_id=r.user_id AND resolved.disposition='canceled'));
REVOKE ALL ON early_bird_deferred_effective_coverages FROM PUBLIC;

-- Onboarding payment alone permits the resident to prepare their card. It is
-- never publication coverage; only the two-payment view above can publish.
CREATE VIEW early_bird_deferred_onboarded AS
 SELECT a.id AS intent_id,a.user_id
 FROM early_bird_deferred_accounts a
 JOIN early_bird_deferred_invoices ob ON ob.account_id=a.id AND ob.user_id=a.user_id AND ob.stage='onboarding' AND ob.amount_minor=a.onboarding_minor AND ob.captured_at IS NOT NULL
 JOIN early_bird_deferred_verified_bindings proof ON proof.invoice_id=ob.id AND proof.user_id=ob.user_id AND proof.provider_id=ob.provider_id AND proof.amount_minor=ob.amount_minor AND proof.evidence_digest=ob.evidence_digest
 WHERE NOT EXISTS(SELECT 1 FROM early_bird_wave_one_exclusions x WHERE x.user_id=a.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_refund_facts r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_refund_reconciliation r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_invoices inv JOIN early_bird_deferred_verified_refund_bindings r ON r.invoice_id=inv.id AND r.user_id=inv.user_id WHERE inv.account_id=a.id AND NOT EXISTS(SELECT 1 FROM early_bird_deferred_refund_resolutions resolved WHERE resolved.provider_refund_id=r.provider_refund_id AND resolved.invoice_id=r.invoice_id AND resolved.user_id=r.user_id AND resolved.disposition='canceled'));
REVOKE ALL ON early_bird_deferred_onboarded FROM PUBLIC;

-- Existing guard trigger verifies every admission against the live candidate
-- view. Its UUID now addresses either a composite intent or deferred account.
ALTER TABLE early_bird_admissions DROP CONSTRAINT early_bird_admissions_intent_id_fkey;
ALTER TABLE experts_published DROP CONSTRAINT experts_published_wave_intent_id_fkey;

CREATE OR REPLACE VIEW early_bird_admission_candidates AS
SELECT s.intent_id,s.user_id,e.id AS expert_id,d.id AS draft_id,r.id AS review_id,
       r.revision,r.public_digest,r.public_payload,c.starts_at,c.ends_at
FROM early_bird_payment_successes s
JOIN early_bird_effective_coverages c ON c.intent_id=s.intent_id
JOIN early_bird_composite_intents i ON i.id=s.intent_id AND i.user_id=s.user_id
JOIN early_bird_choices choice ON choice.id=i.choice_id AND choice.user_id=i.user_id
JOIN early_bird_choices approved_choice ON approved_choice.base_id=choice.base_id AND approved_choice.user_id=choice.user_id
JOIN early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=i.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
JOIN expert_card_drafts d ON d.application_id=a.id AND d.user_id=i.user_id
JOIN resident_card_versions v ON v.draft_id=d.id
JOIN expert_card_reviews r ON r.id=v.review_id AND r.user_id=i.user_id AND r.action='approve' AND r.revision=v.revision AND r.public_payload=v.public_payload
JOIN users u ON u.id=i.user_id AND u.active
JOIN experts e ON e.user_id=u.id
WHERE c.starts_at<=clock_timestamp() AND c.ends_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM residents_applications f JOIN expert_verification_decisions vd ON vd.application_id=b.application_id AND vd.user_id=b.user_id AND vd.decision='approved' JOIN resident_review_events re ON re.attempt_id=f.id AND re.manager_id=vd.manager_id AND re.session_hash=vd.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
 AND v.revision=(SELECT max(latest.revision) FROM resident_card_versions latest WHERE latest.draft_id=d.id)
 AND expert_card_current_messaging_authority(i.user_id,d.messaging_policy_version)
 AND EXISTS(SELECT 1 FROM channel_identities ci WHERE ci.user_id=i.user_id AND ci.provider='telegram' AND ci.bot_key=d.work_bot_key AND ci.external_id=d.work_chat_id AND ci.external_chat_id=d.work_chat_id AND ci.status='active')
 AND resident_safety_assess(v.safety_fields,v.revision)=v.safety_proof
 AND NOT (v.safety_proof->>'blocked')::boolean
 AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open')
 AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle l WHERE l.expert_id=e.id AND l.status='paused')
 AND NOT EXISTS(SELECT 1 FROM early_bird_coverage_reconciliation pending WHERE pending.user_id=i.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_refund_reconciliation pending WHERE pending.user_id=i.user_id)
UNION ALL
SELECT c.intent_id,c.user_id,e.id AS expert_id,d.id AS draft_id,r.id AS review_id,
       r.revision,r.public_digest,r.public_payload,c.starts_at,c.ends_at
FROM early_bird_deferred_effective_coverages c
JOIN early_bird_deferred_accounts i ON i.id=c.intent_id AND i.user_id=c.user_id
JOIN early_bird_choices choice ON choice.id=i.choice_id AND choice.user_id=i.user_id
JOIN early_bird_choices approved_choice ON approved_choice.base_id=choice.base_id AND approved_choice.user_id=choice.user_id
JOIN early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
JOIN expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=i.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
JOIN expert_card_drafts d ON d.application_id=a.id AND d.user_id=i.user_id
JOIN resident_card_versions v ON v.draft_id=d.id
JOIN expert_card_reviews r ON r.id=v.review_id AND r.user_id=i.user_id AND r.action='approve' AND r.revision=v.revision AND r.public_payload=v.public_payload
JOIN users u ON u.id=i.user_id AND u.active
JOIN experts e ON e.user_id=u.id
WHERE c.starts_at<=clock_timestamp() AND c.ends_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM residents_applications f JOIN expert_verification_decisions vd ON vd.application_id=b.application_id AND vd.user_id=b.user_id AND vd.decision='approved' JOIN resident_review_events re ON re.attempt_id=f.id AND re.manager_id=vd.manager_id AND re.session_hash=vd.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
 AND v.revision=(SELECT max(latest.revision) FROM resident_card_versions latest WHERE latest.draft_id=d.id)
 AND expert_card_current_messaging_authority(i.user_id,d.messaging_policy_version)
 AND EXISTS(SELECT 1 FROM channel_identities ci WHERE ci.user_id=i.user_id AND ci.provider='telegram' AND ci.bot_key=d.work_bot_key AND ci.external_id=d.work_chat_id AND ci.external_chat_id=d.work_chat_id AND ci.status='active')
 AND resident_safety_assess(v.safety_fields,v.revision)=v.safety_proof
 AND NOT (v.safety_proof->>'blocked')::boolean
 AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds h WHERE h.expert_id=e.id AND h.status='open')
 AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle l WHERE l.expert_id=e.id AND l.status='paused')
 AND NOT EXISTS(SELECT 1 FROM early_bird_coverage_reconciliation pending WHERE pending.user_id=i.user_id)
 AND NOT EXISTS(SELECT 1 FROM early_bird_refund_reconciliation pending WHERE pending.user_id=i.user_id);

CREATE OR REPLACE FUNCTION early_bird_paid_workspace(target_user uuid) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(( SELECT b.application_id
 FROM public.early_bird_payment_successes s
 JOIN public.early_bird_composite_intents i ON i.id=s.intent_id AND i.user_id=s.user_id
 JOIN public.early_bird_choices current_choice ON current_choice.id=i.choice_id AND current_choice.user_id=i.user_id
 JOIN public.early_bird_choices approved_choice ON approved_choice.base_id=current_choice.base_id AND approved_choice.user_id=current_choice.user_id
 JOIN public.early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
 JOIN public.expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=b.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
 JOIN public.users u ON u.id=i.user_id AND u.active
 WHERE i.user_id=target_user AND s.disposition='eligible'
  AND EXISTS(SELECT 1 FROM public.residents_applications f JOIN public.expert_verification_decisions d ON d.application_id=b.application_id AND d.user_id=b.user_id AND d.decision='approved' JOIN public.resident_review_events re ON re.attempt_id=f.id AND re.manager_id=d.manager_id AND re.session_hash=d.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(public.digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_payment_full_refunds r WHERE r.intent_id=s.intent_id)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_coverage_reconciliation q WHERE q.user_id=i.user_id)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation q WHERE q.user_id=i.user_id)
 ORDER BY s.recorded_at,s.intent_id LIMIT 1), (SELECT b.application_id
 FROM public.early_bird_deferred_onboarded s
 JOIN public.early_bird_deferred_accounts i ON i.id=s.intent_id AND i.user_id=s.user_id
 JOIN public.early_bird_choices current_choice ON current_choice.id=i.choice_id AND current_choice.user_id=i.user_id
 JOIN public.early_bird_choices approved_choice ON approved_choice.base_id=current_choice.base_id AND approved_choice.user_id=current_choice.user_id
 JOIN public.early_bird_form_bridges b ON b.choice_id=approved_choice.id AND b.user_id=i.user_id
 JOIN public.expert_onboarding_applications a ON a.id=b.application_id AND a.user_id=b.user_id AND a.verification_status='approved' AND a.archived_at IS NULL AND a.archive_until_date IS NULL
 JOIN public.users u ON u.id=i.user_id AND u.active
 WHERE i.user_id=target_user
  AND EXISTS(SELECT 1 FROM public.residents_applications f JOIN public.expert_verification_decisions d ON d.application_id=b.application_id AND d.user_id=b.user_id AND d.decision='approved' JOIN public.resident_review_events re ON re.attempt_id=f.id AND re.manager_id=d.manager_id AND re.session_hash=d.manager_session_hash AND re.action=f.status AND re.action IN ('APPROVED_BASIC','APPROVED_EXCLUSIVE') WHERE f.id=b.form_id AND f.user_id=b.user_id AND f.is_current AND re.submitted_revision=b.submitted_revision AND re.submitted_digest=b.submitted_digest AND f.submitted_revision=b.submitted_revision AND encode(public.digest(f.submitted_draft::text,'sha256'),'hex')=b.submitted_digest)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_coverage_reconciliation q WHERE q.user_id=i.user_id)
  AND NOT EXISTS(SELECT 1 FROM public.early_bird_refund_reconciliation q WHERE q.user_id=i.user_id)
 ORDER BY s.intent_id LIMIT 1))
$$;
