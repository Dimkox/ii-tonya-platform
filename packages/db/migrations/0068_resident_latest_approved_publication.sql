-- The latest immutable approval remains publication authority while a newer draft is incomplete.
-- Preserve the existing admission, paid coverage, activation and visibility guards.
CREATE OR REPLACE FUNCTION enforce_expert_published_card_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN

 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id'])=(to_jsonb(OLD)-ARRAY['review_id','revision','public_digest','public_payload','updated_at','active','next_billing_date','paid_order_id']) AND EXISTS(
 SELECT 1 FROM resident_card_versions v JOIN expert_card_reviews r ON r.id=v.review_id JOIN expert_card_drafts d ON d.id=v.draft_id AND ((r.id=(SELECT latest.review_id FROM resident_card_versions latest WHERE latest.draft_id=d.id ORDER BY latest.revision DESC LIMIT 1)) OR (r.id=OLD.review_id AND NEW.review_id=OLD.review_id))
 JOIN expert_card_main_orders m ON m.order_id=NEW.paid_order_id AND m.user_id=NEW.user_id AND m.expert_id=NEW.expert_id
 JOIN expert_main_activation_admissions a ON a.order_id=m.order_id AND a.review_audit_id=m.review_audit_id AND a.public_digest=m.public_digest
 WHERE v.review_id=NEW.review_id AND v.draft_id=NEW.draft_id AND v.revision=NEW.revision AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND r.user_id=NEW.user_id AND expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND EXISTS(SELECT 1 FROM expert_residency_current_coverage(NEW.expert_id) c WHERE c.source_order_id=NEW.paid_order_id AND c.ends_at=NEW.next_billing_date) AND (NOT NEW.active OR (EXISTS(SELECT 1 FROM experts e WHERE e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified) AND NOT EXISTS(SELECT 1 FROM expert_referral_abuse_holds WHERE expert_id=NEW.expert_id AND status='open') AND NOT EXISTS(SELECT 1 FROM expert_residency_lifecycle WHERE expert_id=NEW.expert_id AND status='paused')))
 ) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NOT NEW.active AND (to_jsonb(NEW)-ARRAY['active','updated_at'])=(to_jsonb(OLD)-ARRAY['active','updated_at']) THEN RETURN NEW; END IF;
 IF NEW.draft_id IS NULL OR NEW.review_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM experts e JOIN users u ON u.id=e.user_id AND u.active JOIN expert_card_reviews r ON r.id=NEW.review_id
   JOIN expert_card_drafts d ON d.id=NEW.draft_id AND d.approved_review_id=r.id AND d.revision=r.revision
   JOIN expert_residency_orders o ON o.id=NEW.paid_order_id AND o.expert_id=e.id AND o.status='settled'
   JOIN expert_card_main_orders m ON m.order_id=o.id AND m.expert_id=e.id AND m.user_id=NEW.user_id AND m.review_id=r.id AND m.revision=NEW.revision AND m.public_digest=NEW.public_digest
   WHERE expert_card_activation_gate_valid(NEW.user_id,NEW.review_id) AND e.id=NEW.expert_id AND e.user_id=NEW.user_id AND e.active AND e.verified AND d.user_id=e.user_id
     AND EXISTS(SELECT 1 FROM expert_main_activation_admissions admission WHERE admission.order_id=o.id AND admission.user_id=NEW.user_id AND admission.expert_id=NEW.expert_id AND admission.quote_id=m.quote_id AND admission.application_audit_id=NEW.application_audit_id AND admission.review_audit_id=m.review_audit_id AND admission.public_digest=NEW.public_digest)
     AND d.application_id=NEW.application_audit_id AND r.action='approve' AND r.revision=NEW.revision
     AND r.public_digest=NEW.public_digest AND r.public_payload=NEW.public_payload AND o.residency_ends_at=NEW.next_billing_date)
 OR (NEW.active AND (NEW.next_billing_date<=clock_timestamp() OR NOT EXISTS(
   SELECT 1 FROM expert_residency_orders o WHERE o.expert_id=NEW.expert_id AND o.status='settled' AND o.residency_starts_at<=clock_timestamp() AND o.residency_ends_at>clock_timestamp()))) THEN
  RAISE EXCEPTION 'expert_published_card_source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
