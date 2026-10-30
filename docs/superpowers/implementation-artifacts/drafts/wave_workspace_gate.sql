-- DRAFT ONLY. Workspace eligibility is not publication authority. The caller
-- must hold the user's consent-subject lock and recheck messaging consent.
CREATE FUNCTION early_bird_paid_workspace(target_user uuid) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.application_id
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
 ORDER BY s.recorded_at,s.intent_id LIMIT 1
$$;
REVOKE ALL ON FUNCTION early_bird_paid_workspace(uuid) FROM PUBLIC;
