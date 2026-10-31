import { createHash } from "node:crypto";
import * as ts from "typescript";

export const PAYMENT_SCOPE_MAX_TRACKED_FILES = 5_000;
export const PAYMENT_SCOPE_MAX_FILE_BYTES = 1_048_576;

export const EXPERT_RESIDENCY_ALLOWED_PATHS = new Set([
  // Exact Phase0 inventory; rationale: docs/spec/phase0-guard-registration-audit.md.
  "packages/integrations/src/expert-residency/verified-event-internal.ts",
  "packages/contracts/src/expert-residency.ts",
  "packages/integrations/src/expert-residency/payment-port.ts",
  "packages/integrations/src/expert-residency/disabled-payment-adapter.ts",
  "packages/integrations/src/expert-residency/verified-event.ts",
  "packages/integrations/src/expert-residency/environment-secret-resolver.ts",
]);

export const YOOKASSA_PAYMENT_ALLOWED_PATHS = new Set([
  "packages/integrations/src/yookassa/public-expert-gateway-contracts.ts",
  "packages/integrations/src/yookassa/public-expert-gateway.ts",
  "packages/integrations/src/yookassa/public-expert-recovery.ts",

  // Early Bird candidate inventory: explicit paths, independently reviewed before release.
  "packages/integrations/src/yookassa/early-bird-candidate-verifier.ts",
  "packages/integrations/src/yookassa/early-bird-deferred-checkout-sender.ts",
  "packages/integrations/src/yookassa/early-bird-deferred-refund-verifier.ts",
  "packages/integrations/src/yookassa/early-bird-deferred-request.ts",
  "packages/integrations/src/yookassa/early-bird-deferred-verifier.ts",
  "packages/integrations/src/yookassa/early-bird-invoice-orchestrator.ts",
  "packages/integrations/src/yookassa/early-bird-list-recovery.ts",
  "packages/integrations/src/yookassa/early-bird-owner-checkout-sender.ts",
  "packages/integrations/src/yookassa/early-bird-owner-prepare-authority.ts",
  "packages/integrations/src/yookassa/early-bird-refund-discovery.ts",
  "packages/integrations/src/yookassa/early-bird-refund-verifier.ts",
  "packages/integrations/src/yookassa/early-bird-request.ts",
  "packages/integrations/src/yookassa/early-bird-sealed-request.ts",
  "packages/integrations/src/yookassa/early-bird-snapshot-sealer.ts",
  "packages/integrations/src/yookassa/early-bird-standard-checkout-sender.ts",
  "packages/integrations/src/yookassa/early-bird-standard-prepare-authority.ts",
  "packages/integrations/src/yookassa/early-bird-standard-sealed-request.ts",
  "packages/integrations/src/yookassa/early-bird-standard-snapshot-sealer.ts",
  "packages/integrations/src/yookassa/early-bird-verifier.ts",
  "packages/integrations/src/yookassa/early-bird-webhook-capability.ts",
  "packages/integrations/src/yookassa/experimental-gateway-ipc.ts",
  "packages/integrations/src/yookassa/strict-disclosure-adapter.ts",
  "packages/integrations/src/yookassa/strict-disclosure-gate.ts",

  "packages/integrations/src/yookassa/held-onboarding.ts",
  // BlockB purpose-bound onboarding verifier; no residency mint authority.
  "packages/integrations/src/yookassa/onboarding-verifier.ts",
  "packages/integrations/src/yookassa/onboarding-webhook-capability.ts",
  // Exact Phase0 inventory; rationale: docs/spec/phase0-guard-registration-audit.md.
  "packages/integrations/src/yookassa/payer-receipt-source.ts",
  "packages/integrations/src/yookassa/payer-receipt-vault.ts",
  "packages/integrations/src/yookassa/client.ts",
  "packages/integrations/src/yookassa/contracts.ts",
  "packages/integrations/src/yookassa/exact-body-recovery.ts",
  "packages/integrations/src/yookassa/operation-port.ts",
  "packages/integrations/src/yookassa/payment-adapter.ts",
  "packages/integrations/src/yookassa/reconciliation-reader.ts",
  "packages/integrations/src/yookassa/receipt-contact-source.ts",
  "packages/integrations/src/yookassa/verifier.ts",
  "packages/integrations/src/yookassa/webhook-capability.ts",
]);

export const SANDBOX_PAYMENT_ALLOWED_PATHS = new Set([
  "apps/sandbox-api/src/routes.ts",
  "apps/sandbox-api/src/server.ts",
  "packages/sandbox-payments/src/adapter.ts",
  "packages/sandbox-payments/src/contracts.ts",
  "packages/sandbox-payments/src/index.ts",
  "packages/sandbox-payments/src/repository.ts",
  "packages/sandbox-payments/src/schema.ts",
  "packages/sandbox-payments/src/verifier.ts",
  "packages/sandbox-payments/src/workflow.ts",
]);

const privilegedSandboxVerifierFactory =
  "createCanonicalExpertResidencyPaymentEventVerifier";

export const findSandboxProductionCompositionViolations = ({
  path: rawPath,
  content,
}: PaymentScopeProbe): readonly string[] => {
  const path = normalizePath(rawPath);
  if (!content.includes(privilegedSandboxVerifierFactory)) return [];
  if (
    path.startsWith("apps/sandbox-api/") ||
    /(?:^|\/)tests?\//u.test(path) ||
    /\.test\.[cm]?[jt]sx?$/u.test(path) ||
    path === "packages/integrations/src/expert-residency/verified-event.ts" ||
    path === "packages/integrations/src/index.ts"
  ) {
    return [];
  }
  return ["privileged sandbox verifier composed outside sandbox runtime"];
};

// Internal branding is financial authority. Only these exact implementations may
// depend on its module; exported primitive names cannot pass through a barrel.
const verifierAuthorityImporters = new Set([
  "packages/integrations/src/expert-residency/verified-event.ts",
  "packages/integrations/src/yookassa/verifier.ts",
]);
const verifierAuthorityPrimitives = new Set([
  "mintVerifiedExpertResidencyPaymentEvent",
  "isVerifiedExpertResidencyPaymentEvent",
]);
const isVerifierAuthorityModule = (specifier: string): boolean =>
  /(?:^|\/)verified-event-internal(?:\.[cm]?[jt]s)?$/u.test(specifier);

export const SANDBOX_PAYMENT_RELATION_SOURCE_PATHS = new Set([
  "packages/sandbox-payments/src/repository.ts",
  "packages/sandbox-payments/src/schema.ts",
  "scripts/sandbox-container-lifecycle.mjs",
]);

export const SANDBOX_PAYMENT_ALLOWED_MIGRATION_PATHS = new Set([
  "packages/sandbox-payments/migrations/0000_sandbox_expert_residency.sql",
]);

export const SANDBOX_PAYMENT_ALLOWED_RELATIONS = new Set([
  "sandbox_expert_residency_commands",
  "sandbox_expert_residency_environment",
  "sandbox_expert_residency_events",
  "sandbox_expert_residency_payments",
]);

export const EXPERT_RESIDENCY_ALLOWED_MIGRATION_PATHS = new Set([
  "packages/db/migrations/0085_resident_native_uuid_sources.sql",
  "packages/db/migrations/meta/0085_snapshot.json",
  "packages/db/migrations/state/0085_manifest.json",
  "packages/db/migrations/state/0085_sql_objects.json",

  "packages/db/migrations/0084_public_expert_payment_gateway.sql",
  "packages/db/migrations/meta/0084_snapshot.json",
  "packages/db/migrations/state/0084_manifest.json",
  "packages/db/migrations/state/0084_sql_objects.json",

  "packages/db/migrations/0083_early_bird_launch_publication.sql",
  "packages/db/migrations/meta/0083_snapshot.json",
  "packages/db/migrations/state/0083_manifest.json",
  "packages/db/migrations/state/0083_sql_objects.json",

  "packages/db/migrations/0076_owner_test_pricing.sql",
  "packages/db/migrations/meta/0076_snapshot.json",
  "packages/db/migrations/state/0076_manifest.json",
  "packages/db/migrations/state/0076_sql_objects.json",
  "packages/db/migrations/0077_early_bird_choices.sql",
  "packages/db/migrations/meta/0077_snapshot.json",
  "packages/db/migrations/state/0077_manifest.json",
  "packages/db/migrations/state/0077_sql_objects.json",
  "packages/db/migrations/0078_early_bird_launch_config.sql",
  "packages/db/migrations/meta/0078_snapshot.json",
  "packages/db/migrations/state/0078_manifest.json",
  "packages/db/migrations/state/0078_sql_objects.json",
  "packages/db/migrations/0079_early_bird_positive_price_snapshot.sql",
  "packages/db/migrations/meta/0079_snapshot.json",
  "packages/db/migrations/state/0079_manifest.json",
  "packages/db/migrations/state/0079_sql_objects.json",
  "packages/db/migrations/0080_early_bird_form_bridge.sql",
  "packages/db/migrations/meta/0080_snapshot.json",
  "packages/db/migrations/state/0080_manifest.json",
  "packages/db/migrations/state/0080_sql_objects.json",
  "packages/db/migrations/0081_early_bird_payment_runtime.sql",
  "packages/db/migrations/meta/0081_snapshot.json",
  "packages/db/migrations/state/0081_manifest.json",
  "packages/db/migrations/state/0081_sql_objects.json",
  "packages/db/migrations/0082_early_bird_worker_capabilities.sql",
  "packages/db/migrations/meta/0082_snapshot.json",
  "packages/db/migrations/state/0082_manifest.json",
  "packages/db/migrations/state/0082_sql_objects.json",

  "packages/db/migrations/0075_resident_lifecycle_completion.sql",
  "packages/db/migrations/0074_resident_native_scheduling.sql",
  "packages/db/migrations/0070_planerka_availability.sql",
  "packages/db/migrations/0069_resident_semantic_tags.sql",
  "packages/db/migrations/0060_separated_sales_review_corrections.sql",
  "packages/db/migrations/0061_resident_content_safety.sql",
  "packages/db/migrations/0062_resident_verification_messages.sql",
  "packages/db/migrations/0063_resident_verification_review_corrections.sql",
  "packages/db/migrations/0064_resident_private_jobs.sql",
  "packages/db/migrations/0065_resident_private_recovery_fences.sql",
  "packages/db/migrations/0066_resident_rich_onboarding.sql",
  "packages/db/migrations/0067_resident_rich_review_corrections.sql",
  "packages/db/migrations/0068_resident_latest_approved_publication.sql",
  "packages/db/migrations/0059_residency_separated_sales.sql",
  "packages/db/migrations/0058_residency_core_stabilization.sql",
  "packages/db/migrations/0057_resident_verification_form.sql",
  "packages/db/migrations/0056_residency_offer_corrections.sql",
  "packages/db/migrations/0055_expert_residency_lifecycle.sql",
  "packages/db/migrations/0054_expert_card_publication.sql",
  "packages/db/migrations/0053_expert_verification_onboarding.sql",
  // BlockA exact inventory: docs/spec/phase1-block-a-guard-registration.md.
  "packages/db/migrations/0052_expert_promo_applicants.sql",
  "packages/db/migrations/0051_expert_onboarding_applications.sql",
  "packages/db/migrations/0018_expert_residency_referrals.sql",
  "packages/db/migrations/0019_expert_order_provider_deadline.sql",
  "packages/db/migrations/0020_expert_provider_verification_evidence.sql",
  "packages/db/migrations/0021_expert_settlement_snapshot.sql",
  "packages/db/migrations/0022_expert_referral_admin_replays.sql",
  "packages/db/migrations/0023_yookassa_provider_operations.sql",
  "packages/db/migrations/0024_yookassa_encrypted_recovery.sql",
  "packages/db/migrations/0025_expert_telegram_residency_callbacks.sql",
  "packages/db/migrations/0026_expert_telegram_checkout_outcomes.sql",
  "packages/db/migrations/0027_expert_ai_request_receipts.sql",
  "packages/db/migrations/0028_operator_case_inbox.sql",
  "packages/db/migrations/0032_commercial_core_v2_a1.sql",
  "packages/db/migrations/0033_expert_referral_maturity_a2.sql",
  "packages/db/migrations/0034_hybrid_message_gateway_b1.sql",
  "packages/db/migrations/0035_hybrid_message_gateway_b2.sql",
  "packages/db/migrations/0036_selarti_budget_controls_b3.sql",
  "packages/db/migrations/0037_partner_commerce_a.sql",
  "packages/db/migrations/0038_test_expert_trial.sql",
  "packages/db/migrations/0071_lifecycle_scheduler_c1.sql",
  "packages/db/migrations/0072_booking_waitlist_d1.sql",
  "packages/db/migrations/0073_booking_reschedule_replay.sql",
  "packages/db/migrations/0039_consent_evidence_grant.sql",
  "packages/db/migrations/meta/0018_snapshot.json",
  "packages/db/migrations/meta/0021_snapshot.json",
  "packages/db/migrations/meta/_journal.json",
]);

export const EXPERT_RESIDENCY_ALLOWED_RELATIONS = new Set([
  "public_expert_payment_requests",
  "public_expert_payment_observations",
  "public_expert_payment_resolutions",
  "public_expert_provider_identities",

  "early_bird_launch_kit_jobs",
  // Exact relations introduced by canonical early-bird migrations.
  "early_bird_admission_candidates",
  "early_bird_admissions",
  "early_bird_candidate_observations",
  "early_bird_choices",
  "early_bird_composite_intents",
  "early_bird_composite_requests",
  "early_bird_coverage_epochs",
  "early_bird_coverage_reconciliation",
  "early_bird_coverage_revisions",
  "early_bird_deferred_accounts",
  "early_bird_deferred_effective_coverages",
  "early_bird_deferred_invoices",
  "early_bird_deferred_onboarded",
  "early_bird_deferred_receipt_contacts",
  "early_bird_deferred_receipt_tombstones",
  "early_bird_deferred_refund_facts",
  "early_bird_deferred_refund_reconciliation",
  "early_bird_deferred_refund_resolutions",
  "early_bird_deferred_requests",
  "early_bird_deferred_verified_bindings",
  "early_bird_deferred_verified_refund_bindings",
  "early_bird_effective_coverages",
  "early_bird_final_call_engagements",
  "early_bird_final_call_policy",
  "early_bird_final_call_queue",
  "early_bird_form_bridges",
  "early_bird_form_enrollments",
  "early_bird_gateway_claims",
  "early_bird_gateway_contact_state",
  "early_bird_intent_tombstones",
  "early_bird_launch_configs",
  "early_bird_message_dispatch_claims",
  "early_bird_message_dispatch_consumptions",
  "early_bird_message_replacements",
  "early_bird_payment_full_refunds",
  "early_bird_payment_successes",
  "early_bird_positive_price_snapshots",
  "early_bird_receipt_contacts",
  "early_bird_refund_binding_registry",
  "early_bird_refund_reconciliation",
  "early_bird_refund_registry",
  "early_bird_unknown_recovery",
  "early_bird_verified_bindings",
  "early_bird_verified_refund_bindings",
  "early_bird_wave_one_exclusions",
  "owner_test_pricing_grants",
  "receipt_revocation_outbox",

  "resident_lifecycle_subjects",
  "resident_lifecycle_cases",
  "resident_work_notices",
  "resident_work_notice_attempts",
  "resident_work_bot_state",

  "resident_schedule_state",
  "resident_schedule_previews",
  "resident_service_mappings",
  "resident_service_versions",
  "resident_schedule_versions",
  "resident_native_slots",
  "resident_schedule_busy",
  "resident_native_confirmations",
  "resident_native_logistics",

  "forbidden_patterns",
  "resident_card_corrections",
  "resident_card_proposal_changes",
  "resident_safety_active",
  "resident_safety_outcomes",
  "resident_safety_policies",
  "resident_safety_publications",
  "security_logs",

  "expert_sales_operator_recoveries",
  "expert_sales_bases",
  "expert_sales_choices",
  "expert_sales_selections",
  "expert_sales_form_bridges",
  "expert_sales_fee_attempts",
  "expert_sales_paid_locks",
  "expert_sales_recovery_work",
  "expert_sales_provider_requests",
  "expert_sales_provider_observations",
  "expert_sales_notices",
  "expert_sales_ticks",
  "expert_sales_erased_cohorts",
  "resident_sales_application",

  // Core stabilization: docs/spec/residency-core-stabilization-guard-registration.md.
  "hashtags_db",
  "hashtags_taxonomy",
  "expert_card_draft_tags",
  "resident_workspace_access",

  // Pre-price intake only; docs/spec/verification-schema-form-guard-registration.md.
  "residents_applications",
  "resident_message_templates",
  "resident_review_previews",
  "resident_object_deletions",
  "resident_private_objects",
  "resident_card_media",
  "resident_card_versions",
  "resident_tag_decisions",
  "tag_embeddings_cache",
  "resident_review_events",
  "resident_document_access_audit",
  "resident_evidence_jobs",
  "resident_information_requests",
  "resident_check_generations",
  "resident_review_messages",
  "resident_review_recoveries",
  "resident_verification_cohorts",
  "resident_social_observations",
  "resident_verification_application_updates",
  "resident_verification_check_work",
  "resident_verification_requests",

  // Exact correction inventory; docs/spec/residency-offer-corrections-guard-registration.md.
  "expert_application_material_jobs",
  "expert_application_promo_confirmations",
  "expert_application_promo_proofs",
  "expert_main_activation_admissions",
  "expert_manager_telegram_callbacks",
  "expert_manager_telegram_notifications",
  "expert_manager_telegram_pairings",
  "expert_offer_profile_verifications",
  "expert_offer_profiles",
  "expert_offer_schedules",
  "expert_personal_offer_notices",
  "expert_personal_offer_state",
  "expert_promo_ready_logs",
  "expert_space_tariff_approvals",

  // BlockD calendar lifecycle; docs/spec/phase1-block-d-guard-registration.md.
  "expert_residency_lifecycle",
  "expert_residency_renewal_bills",
  "expert_residency_lifecycle_audits",
  "expert_residency_lifecycle_notices",
  "expert_residency_renewal_attempts",
  // BlockC card/publication contract; docs/spec/phase1-block-c-guard-registration.md.
  "expert_card_drafts",
  "expert_card_entries",
  "expert_card_reviews",
  "expert_card_material_templates",
  "expert_card_material_jobs",
  "expert_card_promo_proofs",
  "expert_card_promo_confirmations",
  "expert_card_handoffs",
  "expert_card_requests",
  "expert_card_staff_actions",
  "expert_card_consent_epoch",
  "expert_card_main_acceptances",
  "expert_card_main_orders",
  "expert_promo_qualification_audits",
  "experts_published",
  // Separate onboarding financial facts; docs/spec/phase1-block-b-guard-registration.md.
  "expert_verification_decisions",
  "expert_onboarding_invoices",
  "expert_onboarding_payment_operations",
  "expert_verification_work",
  "expert_onboarding_payment_facts",
  // Nonfinancial acquisition only; BlockA registration rationale is versioned.
  "expert_promo_codes",
  "expert_promo_registrations",
  "expert_promo_requests",
  "expert_promo_guide_work",
  "expert_promo_bonus_indications",
  "expert_promo_manager_work",
  "expert_promo_enrollments",
  // Exact Phase0 inventory; rationale: docs/spec/phase0-guard-registration-audit.md.
  "client_paid_orders",
  "client_paid_payment_bindings",
  "client_coupon_grants",
  "client_paid_settlements",
  "planerka_service_mappings",
  "planerka_availability_refreshes",
  "planerka_booking_operations",
  "planerka_account_requests",
  "planerka_legacy_booking_reviews",
  "booking_notification_contexts",
  "booking_notification_deliveries",
  "booking_notification_attempts",
  "booking_notification_attempt_facts",
  "booking_notification_callbacks",
  "booking_notification_bot_controls",
  "booking_handoff_revocation_receipts",
  "expert_campaign_anchors",
  "expert_campaign_quotes",
  "expert_sessions",
  "expert_identity_proof_receipts",
  "payer_receipt_contacts",
  "payer_receipt_order_bindings",
  "expert_onboarding_applications",
  "commercial_participants",
  "expert_ai_request_receipts",
  "expert_referral_admin_execution_results",
  "expert_referral_code_batches",
  "expert_referral_codes",
  "expert_referrals",
  "expert_residency_tariff_versions",
  "expert_telegram_residency_callbacks",
  "expert_residency_orders",
  "expert_residency_payment_attempts",
  "expert_residency_provider_operations",
  "expert_residency_receipt_contacts",
  "expert_residency_provider_event_inbox",
  "expert_first_residency_settlements",
  "expert_referral_reward_grants",
  "expert_referral_reward_maturities",
  "expert_referral_ledger_entries",
  "expert_referral_ledger_allocations",
  "expert_referral_issuance_overrides",
  "expert_referral_abuse_holds",
  "expert_referral_feature_controls",
  "expert_referral_balances",
  "organization_profiles",
  "partner_command_receipts",
  "partner_shadow_quotes",
  "partner_tariff_policy_versions",
  "client_commercial_policy_assignments",
  "client_commercial_policy_controls",
  "dialogues",
  "dialogue_inbound",
  "dialogue_route_decisions",
  "selarti_response_proposals",
  "dialogue_deliveries",
  "dialogue_inbound_tombstones",
  "lifecycle_jobs",
  "booking_reschedule_facts",
  "booking_waitlist_command_receipts",
  "booking_waitlist_entries",
  "selarti_budget_policies",
  "selarti_cost_reservations",
  "selarti_actual_usage_facts",
  "selarti_cost_adjustments",
  "selarti_budget_alerts",
  "test_expert_audit_events",
  "test_expert_campaign_versions",
  "test_expert_deterministic_requests",
  "test_expert_lifecycle_audit_events",
  "test_expert_outcomes",
  "test_expert_prompt_assets",
  "test_expert_redemptions",
  "test_expert_reservations",
  "test_expert_sessions",
]);

export const EXPERT_RESIDENCY_ALLOWED_ROUTES = new Set([
  "/v1/admin/expert-cards/lifecycle",
  "/v1/admin/expert-cards/lifecycle/:caseId",
  "/v1/admin/expert-cards/lifecycle/:caseId/close",

  "/v1/admin/expert-verification/private-recovery",
  "/v1/admin/expert-verification/private-recovery/:custodyId",
  "/v1/admin/expert-verification/:applicationId/private-evidence",
  "/v1/admin/expert-verification/:applicationId/documents/:custodyId/link",

  // Protected profile recovery and paired scoped manager transport.
  "/v1/admin/expert-verification/:applicationId/profile-verification",
  "/v1/admin/expert-verification/telegram-pairing",
  "/v1/webhooks/telegram/expert-manager/:botKey",

  "/v1/admin/expert-cards",
  "/v1/admin/expert-cards/:applicationId",
  "/v1/admin/expert-cards/:applicationId/media/:mediaId/link",
  "/v1/admin/expert-cards/:applicationId/public-card",
  "/v1/admin/expert-cards/:applicationId/review",
  "/v1/admin/expert-cards/:applicationId/promo-review",
  "/v1/admin/expert-cards/:applicationId/tags/review",
  "/v1/admin/expert-cards/catalogue-export",
  "/v1/admin/expert-verification",
  "/v1/admin/expert-verification/:applicationId",
  "/v1/admin/expert-verification/invoices/:invoiceId/checkout",
  "/v1/admin/expert-verification/invoices/:invoiceId/recover",
  "/v1/admin/expert-verification/:applicationId/decision",
  "/v1/admin/expert-verification/:applicationId/review-preview",
  "/v1/admin/expert-verification/:applicationId/review-confirm",
  "/v1/admin/expert-verification/:applicationId/review-recovery",

  "/v1/webhooks/telegram/expert-promo/:botKey",
  // Exact Phase0 inventory; rationale: docs/spec/phase0-guard-registration-audit.md.
  "/v1/expert/browser/residency/checkouts",
  "/v1/expert/browser/residency/quotes",
  "/v1/expert/browser/residency/receipt-contacts",
  "/v1/expert/browser/residency/tariffs",
  "/v1/expert/browser/session",
  "/v1/expert/session",
  "/v1/expert/sessions",
  "/v1/expert/sessions/current",
  "/v1/expert/assistant/messages",
  "/v1/expert/referrals/redeem",
  "/v1/expert/referrals/summary",
  "/v1/expert/residency/tariffs",
  "/v1/expert/residency/quotes",
  "/v1/expert/residency/checkouts",
  "/v1/admin/expert-referrals/inventory",
  "/v1/webhooks/yookassa",
]);

export const EXPERT_RESIDENCY_ALLOWED_FLAGS = new Set([
  "RESIDENT_GEOCODE_ENABLED",
  "RESIDENT_PRIVATE_JOBS_ENABLED",
  "PRIVATE_OCR_ENABLED",
  "PRIVATE_TELEGRAM_PREVIEW_ENABLED",

  "EXPERT_SEPARATED_SALES_ENABLED",
  "EXPERT_ONBOARDING_HELD_ENABLED",
  "EXPERT_DRAFT_TAGS_ENABLED",
  "RESIDENT_WORKSPACE_NOTIFICATIONS_ENABLED",
  "EXPERT_VERIFICATION_FORM_ENABLED",
  "EXPERT_RESIDENCY_LIFECYCLE_ENABLED",
  "EXPERT_RESIDENCY_LIFECYCLE_COMMANDS_ENABLED",
  "EXPERT_RESIDENCY_NOTICE_DELIVERY_ENABLED",
  "EXPERT_RESIDENCY_RENEWAL_CHECKOUT_ENABLED",
  "EXPERT_REFERRAL_ENABLED",
  "EXPERT_RESIDENCY_BILLING_ENABLED",
  "EXPERT_TELEGRAM_QUERIES_ENABLED",
  "EXPERT_TELEGRAM_FINANCIAL_VIEWS_ENABLED",
  "EXPERT_AI_INGRESS_ENABLED",
  "EXPERT_TELEGRAM_REFERRAL_ENABLED",
  "EXPERT_TELEGRAM_CHECKOUT_ENABLED",
  "EXPERT_REFERRAL_HMAC_KEY_VERSION",
  "EXPERT_REFERRAL_HMAC_KEY_REF",
  "EXPERT_REFERRAL_HMAC_KEYS_JSON",
]);

export const EXPERT_RESIDENCY_ALLOWED_ADMIN_ACTIONS = new Set([
  "expert_referral.batch_generate",
  "expert_referral.code_revoke",
  "expert_referral.issuance_override",
  "expert_referral.abuse_hold_open",
  "expert_referral.abuse_hold_close",
  "expert_referral.hold_replay",
  "expert_referral.feature_switch",
  "expert_residency.tariff_create",
  "expert_residency.tariff_create_v2",
  "expert_residency.tariff_retire",
  "expert_residency.sandbox_settle",
  "expert_residency.sandbox_refund",
]);

const approvedPaymentBoundaryPaths = new Set([
  "packages/integrations/src/index.ts",
  "packages/integrations/src/payment/disabled-payment-adapter.ts",
  "packages/integrations/src/payment/payment-port.ts",
  ...YOOKASSA_PAYMENT_ALLOWED_PATHS,
]);
const approvedPaymentBoundaryHashes = new Map([
  [
    "packages/integrations/src/yookassa/public-expert-gateway-contracts.ts",
    "06020f93a396eec4258edbb0fe797d508036c571e40a6346ed6fa9b15028f366",
  ],
  [
    "packages/integrations/src/yookassa/public-expert-gateway.ts",
    "7d9117f6a7cfa536bbaa839b821b7f915f43a54b47c35c70be0c1f2c89175275",
  ],
  [
    "packages/integrations/src/yookassa/public-expert-recovery.ts",
    "865b7e41fb46db39f7a24965835629797fad264dc4f2bc263b4af5c7df2a2e7c",
  ],

  // Native scheduling: exact entrypoint/barrel review; no classifier exemption.
  [
    "packages/db/src/index.ts",
    "d62bcad8c4fa9517e478679ef57cf098a89b88f5ca1eac196051580d47b1064e",
  ],
  [
    "packages/contracts/src/index.ts",
    "b26ce919866a6b94ba398bfff3b1a9f8a46e4cac4829e81c9ee4437da960f10c",
  ],
  [
    "packages/db/src/schema/index.ts",
    "6feaf37da800ae379f968ee450cbee9d41a2ab5dd3fa76195331928384b19c89",
  ],
  [
    "apps/api/src/routes/public-client-catalog.ts",
    "e3940fbc4a7d9fea289ae937cb22dfd5e3d92eb3658b92e2929e9b3428aa0f30",
  ],
  [
    "apps/api/src/expert-card-telegram-ingress.ts",
    "f065c1884d3194c5dc6508bd9631ad61190e938e102b8271421bcf28731aaf11",
  ],
  [
    "apps/worker/src/booking-notifications.ts",
    "a6ecb6451040104885a89b440b9a6f21953dd923813bb923c8698074fbd0378d",
  ],

  [
    "packages/integrations/src/yookassa/held-onboarding.ts",
    "f938a376d3cb0bfde235a619c4be9db6b27b8c531eee699dd1fd13f15cc66182",
  ],
  [
    "packages/integrations/src/yookassa/onboarding-verifier.ts",
    "0c4867e541393854644eac11b2e7b8ac0221a3d183850f40a40d75763bda1b82",
  ],
  [
    "packages/integrations/src/yookassa/onboarding-webhook-capability.ts",
    "039cd4403d8ff78c3b58add7b1e30bc00be659f7a268a2d27dedc4b8303c5fb0",
  ],

  [
    "packages/integrations/src/expert-residency/verified-event-internal.ts",
    "4a6637fe6f456ad97fed9aefeed336558a590d07178a01ededd1649928baa2c4",
  ],
  [
    "packages/integrations/src/expert-residency/verified-event.ts",
    "48aa1b67f7b73beb4bd87e1b42bdd34ab75a8460980a8880569adc4ff5664cae",
  ],
  [
    "packages/integrations/src/yookassa/payer-receipt-source.ts",
    "25c08bcd83582d43193059371662c1f99d0cf9485facf2ff11a6c3364f7ef4e8",
  ],
  [
    "packages/integrations/src/yookassa/payer-receipt-vault.ts",
    "189c14e45c2836ad9914719f937a0f3b966849d5933ac845b3a33dcf375134dd",
  ],
  [
    "packages/integrations/src/index.ts",
    "66867a134b42d3359790287918f22acee6baedef27773fad48d302ca98d2a387",
  ],
  [
    "packages/integrations/src/payment/disabled-payment-adapter.ts",
    "1ae27257231b3b3060219eb400936ebc37b251a95969f047bc450e5050c7560f",
  ],
  [
    "packages/integrations/src/payment/payment-port.ts",
    "84dc621fc5cafdffb64cb42af0fa567cad6560ea41ea46ce393d8aa29cce950f",
  ],
  [
    "packages/integrations/src/yookassa/client.ts",
    "720a073ab5a70c1db77ec30b8dab256112dd4ce78662047584b66b078e6a6d4d",
  ],
  [
    "packages/integrations/src/yookassa/contracts.ts",
    "86eb749413850c6f3d2ca2979fb7faeed7f54c91271eed767010248c09167c9d",
  ],
  [
    "packages/integrations/src/yookassa/exact-body-recovery.ts",
    "d2e361878ca06c405670c5d03071b39c0040a03530756799f0ce8038f00892a6",
  ],
  [
    "packages/integrations/src/yookassa/operation-port.ts",
    "6f79563e0f5676d4ea4e39b339654b1794e7c3ad21f60b0e68aff0184e4cb3c2",
  ],
  [
    "packages/integrations/src/yookassa/receipt-contact-source.ts",
    "c41d94f0f85381b0265887e5c510854b3a0ca4a6d9f91b991e7c07d03d9be4dd",
  ],
  [
    "packages/integrations/src/yookassa/payment-adapter.ts",
    "39b16ddb47a45eb630ea4b50e4b2e1a717eecc51e194b54e8b03b3acd401a26a",
  ],
  [
    "packages/integrations/src/yookassa/reconciliation-reader.ts",
    "fd8271da84ee99f25043b1820625daa1cd132d1903a1bd79517e925193777956",
  ],
  [
    "packages/integrations/src/yookassa/verifier.ts",
    "daafddc3b4b46743c19abb2b2edc3ceeafe1a6f5821dcef2639e34b52fd771ab",
  ],
  [
    "packages/integrations/src/yookassa/webhook-capability.ts",
    "5aad24de2f1ab17b9fa4a22155a49b2b41eb6a5935af33e6d93b5e75ce323d3a",
  ],
]);
const approvedPackageManifestHashes = new Map([
  // Security patch only: Fastify >=5.12.5 closes the reviewed September 2026
  // advisories. Dependency names and payment integration boundaries are unchanged.
  [
    "apps/sandbox-api/package.json",
    "e274bb47edb371e673dc86fb806aa1e9c90973b73a87a02e82add2c72d161fe5",
  ],
  // API directly imports the existing workspace version of drizzle-orm.
  [
    "apps/api/package.json",
    "02e467d1e765312a6e3ab9473d428a2962539cf4bf1f26c2f5e21b35d7e79e8a",
  ],
  [
    "apps/web/package.json",
    "40d3cb3dc44b5f0a3406fdd091eb017fa05e8379841f6fc13a34a854407f2909",
  ],
  [
    "apps/worker/package.json",
    "8815b7494fbc0e1ccc7f1407f200d4b882328966267a9b34e6d76094cb15f41a",
  ],
  [
    "package.json",
    // Reviewed navigation increment: add the native Nginx proof entrypoint and
    // invoke it from verify:deploy. Existing scripts and dependency graph remain.
    "2f3f91a8d2999bf30874c9ee1fee6730d0e5761bd5aca82d81e0473b0f2a0d1e",
  ],
  [
    "packages/application/package.json",
    "594a48971ab05dbfb080ea5343e36193ee29113989f171f49392f87094c2629d",
  ],
  [
    "packages/config/package.json",
    "4f09a3f673b7c618d8005bdc84673a79390d59520920ce83947618d45168cd5d",
  ],
  [
    "packages/contracts/package.json",
    "176fc9aa618da35e1aa1c03576e1f34088dda9c131835fc0022f6ff0324dd3d2",
  ],
  [
    "packages/db/package.json",
    "8a3baf4d27138434baa7d9b591b006d99b7aa299c0215d4ee41f60f87b561d7f",
  ],
  [
    "packages/domain/package.json",
    "ebf36831c2e9c1b1838f750b0f7d8cd712e99b64a8d481b05242d6ee9ec1547e",
  ],
  [
    "packages/integrations/package.json",
    "a8cd1428b34414037b048d8b12344f5bb1f7b2f9f78918b791db6ef6f34a030e",
  ],
  [
    "packages/observability/package.json",
    "78c58e975d627f8cd9f632ca1a44f5a9c6709f62b518e2dc6eacb3b4ab918bca",
  ],
  [
    "packages/sandbox-payments/package.json",
    "f3f02f3424d14be05309bea4135fafab8ec50fdb3f645bd1a7a47d3c86113da0",
  ],
  [
    "packages/worker/package.json",
    "9548d95e818bc5d0010d9d1b6010e1a6cde75ffedfc721a9a11d0433deaac88d",
  ],
]);
// Existing loopback DOM harnesses load an operator-supplied Playwright install.
// This exception covers unresolved loader names only, never internal mint access.
const reviewedDomHarnessHashes = new Map([
  [
    "scripts/verify-resident-lifecycle-browser.mjs",
    "d555549822084538af96023f6a7a1abe6f13549b7610cec24a5ac3b00cc1167f",
  ],
  [
    "scripts/verify-resident-review-browser.mjs",
    "3ec062ea1c7b511a6a209ac24c95e22db51fbcc2dc1791c4bd44a19acd634be3",
  ],
  [
    "scripts/verify-client-web-account-browser.mjs",
    "02ffce350b89d5d89a50966693eb23cc14fd0caaf0dd2ed469ac07d5e8678e4d",
  ],
  [
    "scripts/verify-public-client-catalog-browser.mjs",
    "624d88eac52263707e442aee0c61802744c34d7e5cd8328acff2faeb1625839f",
  ],
]);

const approvedAutomationArtifactHashes = new Map([
  [
    "tests/integration/resident-native-uuid-migration-state.test.ts",
    "d41061fc847629859d2fa17a8dd270dcd8184ff0ce4556a69c28e12634315e5d",
  ],
  [
    "packages/db/src/repositories/resident-native-uuid-sources.integration.test.ts",
    "f6bf537e33983b80adfa0f95ed88a7ce24c745764bf6eb541f309010369797fd",
  ],

  [
    "scripts/experimental/yookassa_gateway/test_public_journey_reader_seam.py",
    "a7493e386749d328290a61caf3a05abddea62832aa44f4606e0dd723911c4ea6",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_public_dispatch.py",
    "eb4a8367068457864657a40edbebae150e6b7a87f8d6178b57666ccd871dc688",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_public_dispatch_response.py",
    "0af5600221ee3eb90efd166623b06f2bf08e661195c0627368699ff9381d85e6",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_public_provider_projection.py",
    "78b71bfb1281bfca676e615ad509db7d0f800ca144bded4d66ec11f97c1c3e4b",
  ],

  [
    "deploy/gateway-provision/sandbox-node-resolution.test.mjs",
    "93824ccd347fd699abf2b07d0047f9c05d91b2ef0cbe8eaf9bd39234ff0adf34",
  ],
  [
    "scripts/early-bird-bridge/migration-tags.mjs",
    "5b5ffabda2003c0b92f3c56f741dfb39065d9da04fa102bc6ed69c16268e38c9",
  ],
  [
    "scripts/early-bird-bridge/migration-tags.test.mjs",
    "11c0c1af96d0589a1883d1e91b31e5d31e38be3c8cf23e1214e638702704d20f",
  ],

  [
    "apps/api/src/early-bird-bound-reconciliation.ts",
    "1dae2c33985c037dd360597502e1876e5732a3a67dbc7ebd531df4c5f4f4276b",
  ],
  [
    "apps/api/src/early-bird-bound-reconciliation.test.ts",
    "f7e793bb0d7c4072d073ba38bc1e212109449efb859fa83d3b75af518fb47688",
  ],
  [
    "apps/api/src/early-bird-discovery-pool.ts",
    "ea99baf7b019f372db0e9ddce4fbbfde6edabaef7bf69d0876545eb0dc2c96ac",
  ],
  [
    "apps/api/src/early-bird-discovery-pool.test.ts",
    "0975a6e930fdc085def9a11ac0f0efe021187813b865306d4b9bb9ad49ce6dcf",
  ],
  [
    "packages/db/src/repositories/early-bird-bound-reconciliation.integration.test.ts",
    "ac49f85a12713c584bdef353a9b009ac5e00ed8194c41af7a7fd3be1c4c39564",
  ],
  [
    "apps/api/src/early-bird-gateway-bootstrap.ts",
    "47e6e1d629a90d01f49cc9d9e036c13b9845db2585e4680c1f18f302f2e27acb",
  ],
  [
    "apps/api/src/expert-early-bird-webhook-runtime.ts",
    "2ca2c4a224525543a4f4ac2b2af3088c52fc3bf7cecd0213fd9dd779c5c25a98",
  ],
  [
    "apps/api/src/server.ts",
    "d3f290dd170493f4ec439968de283594156d55d256ffa8e95019b4253e0a520e",
  ],

  [
    "deploy/gateway-provision/test_prepare_systemd_sandbox.sh",
    "e255dde28e9f984d86e572148ff44783f8a487b2460fa2054247de710c6a26cf",
  ],
  [
    "deploy/gateway-provision/readme.md",
    "69f3d2630d2429a3a23372a4e38d2d48c175b37eeac48353c995966c4097b32c",
  ],
  [
    "deploy/gateway-provision/prepare-bounded-handoff.test.mjs",
    "2c21a8281f26996f8d5b43c4a1aa2a12ed2742b3d1728128316e51f3626bb998",
  ],
  [
    "deploy/gateway-provision/prepare-code-publication.test.mjs",
    "ca1ba4a21d24277349e6b6303b09649954b38fca68f2918d21bef9139f7ba8af",
  ],
  [
    "deploy/gateway-provision/prepare-code-selector.test.mjs",
    "66ca1b68708f15418a0308abcadd9daa3a64835b9bbf710366a4b7b28127912a",
  ],
  [
    "deploy/gateway-provision/prepare-native.mjs",
    "4e426fb8c5f8811d65b8a6f7119981deeddcbb28424495945d9dc330e215da53",
  ],
  [
    "deploy/gateway-provision/prepare-native.test.mjs",
    "e6c8e0f70026beb6fd3203ea4e4ca76d5f5f460bc4ee9c18ccc23a8b58ad1b05",
  ],
  [
    "deploy/gateway-provision/prepare-timeout.test.mjs",
    "645a0bdf843e765057a48242c5d79924be2c7b9ac24d30bfeb876f78ac36bc46",
  ],
  [
    "deploy/gateway-provision/prepare-units.test.mjs",
    "ee33e40f7796c761e349ef8f020619fd53ea5bcd4bf7c62ba9fdee1fee0304c4",
  ],
  [
    "deploy/gateway-provision/prepare_gateway.py",
    "b102daa05bf956af20252e73b009014f817df42e98ec93edc2fc6da2feaf46da",
  ],
  [
    "deploy/gateway-provision/sysusers.conf",
    "809595afed785bcae104a5fde8427c7a6bbca77dc84028506c17714915dafd1f",
  ],
  [
    "deploy/gateway-provision/test_prepare_gateway.py",
    "5660041061bf0b894da7f34b663212397c31d2d17ec145ccc6d59a58879c215c",
  ],
  [
    "deploy/gateway-provision/test_prepare_gateway_bad_marker.py",
    "a8372dbc153be0c43aaf7e09b45d87df1cce3fefc2d076ccf8538d50546f81b9",
  ],
  [
    "deploy/gateway-provision/test_prepare_gateway_cross_uid.sh",
    "26bfd539fdccea5b84b6f6565add11972ac58cbe9111fae81dcb0555cb35b96a",
  ],
  [
    "deploy/gateway-provision/tmpfiles.conf",
    "e290c1f9a3431d11dd4e4a75d4a673dbe46443cc5a4bd1195ca7c779aaf08469",
  ],
  [
    "deploy/systemd/ii-tonya-yookassa-gateway.service",
    "851d74e2c1c1cc74547fc3f1112de46f54b6616e72e4fb18613ea955a671905f",
  ],
  [
    "deploy/systemd/ii-tonya-early-bird-prepare.service",
    "990226f0e73b383a955ff594e2682def578faa25dd8169240deebddd6ff39c3a",
  ],
  [
    "deploy/systemd/ii-tonya-migrate.service.d/30-early-bird-prepare.conf",
    "ebe7d7bcf12c9258bfe2a092528bc53ed57ca1cb94579dcc57abd5a14e5517a5",
  ],
  [
    "pyproject.toml",
    "b464d7bec6b0509dfbea85aba8e3ed7e21570136caadc1ea94f5ed44d953a7df",
  ],
  [
    "tests/repo/python-ci-discovery.test.ts",
    "47938a713547abb0f44313d589d0c916fa1a7e879e0de1b2272f739135719efb",
  ],

  [
    "trivy.yaml",
    "005ad605cb97d59d352f50d130328cd7d4c833e053c2e3c910600e7d6eb9ea6a",
  ],
  [
    ".getzilla/templates/ci/github-actions-verify.yml",
    "e1fe50a372b9a2e10baa8e40d86afd50a434e7bbafd8fdf058c1a2588c847242",
  ],
  [
    "tests/runtime/test_claw_healthcheck.py",
    "35fa8c45c657123a5f4abc2c5eb6c1c1484d263f81b25fd874922d96e40a827e",
  ],
  [
    "tests/runtime/test_helper_healthchecks.py",
    "10674de815f3d53c6a32786de5b5dee7e8ed8e81d8defb37b2b7153454f39896",
  ],

  [
    "scripts/getzilla_reviewed_opengrep.py",
    "4128701bd9042a62b7a49dbbe8d98a7ffab18f1b21a1d65060bc9776c4bc141a",
  ],
  [
    "scripts/test_getzilla_reviewed_opengrep.py",
    "2a479f1cd4e054a2dbc8e9552c3ed8488250a3c2cf7566fa14e7b1aecbc4cf0d",
  ],
  [
    "engineering/opengrep-reviewed-observations.json",
    "314bb68190223c01418fe456cb3abf444afac60c1a6d676d99e8e5091d1a1e00",
  ],

  [
    "scripts/early-bird-bridge/archive-hash.test.mjs",
    "6d9355de355dbb00f0fbc7805ce7eaaa499a86d1e939115b7e7930f5c1a6e408",
  ],
  [
    "scripts/early-bird-bridge/archive-hash.mjs",
    "a0cc12570da4939ac7e5b83bd2530b1fb785b5918ce60a3b4c28ef7c22bcaa97",
  ],
  [
    "scripts/build-early-bird-bridge-release.mjs",
    "8616ead0ac58ae25da40a8876d277add9756e2debbac998ca411877dd17d44d5",
  ],
  [
    "scripts/early-bird-bridge/bridge.test.mjs",
    "f4caa6c174140c6dce026e93bb50a0915f5362613a58cdd071a0eec70b46a9ad",
  ],
  [
    "scripts/early-bird-bridge/journal-validation.mjs",
    "e4fed9e9c0b5b1a1d532c6edcca91059024f3ea7be32f4bf462ebba3cefb4174",
  ],
  [
    "scripts/early-bird-bridge/runtime.mjs",
    "7c8cc2ade3cd2dc74e9b562509740ee8eed695c454715ae9b3729c9e4e20bbae",
  ],

  // Early Bird transport and isolation experiment inventory.
  [
    "scripts/experimental/yookassa_gateway/bound_gateway.py",
    "af73e40afacbc085bbbc77ba5251a9068af77d753387aac33531f7bdd0822f14",
  ],
  [
    "scripts/experimental/yookassa_gateway/docker_isolation_probe.py",
    "17ce69d3585331de596ea09f9f94b560372463b82e3c373075d63fd30e2a2f69",
  ],
  [
    "scripts/experimental/yookassa_gateway/durable_state.py",
    "94cf39987b6bc1cb912681b809ed15dddcb1d691c54a9f5a29b52a21d46e34d4",
  ],
  [
    "scripts/experimental/yookassa_gateway/egress_fence.py",
    "4e8b7c6aa14c4eff4ea52fc061b4c8db3c18c65a908d1821b4fd2decc46388f2",
  ],
  [
    "scripts/experimental/yookassa_gateway/gateway.py",
    "1964d8b53cb76e7a1da0759297bcebf42fa25d13baad3393fff8e043d6299d90",
  ],
  [
    "scripts/experimental/yookassa_gateway/ipc.py",
    "79513ade279773ba25cac17ee716f193d9020323c988cfaa5244f81b23ee59c2",
  ],
  [
    "scripts/experimental/yookassa_gateway/launcher.py",
    "4df8910a99feed921e0294b985edc7c44d4a0847aff2a8437901c8c9d0709850",
  ],
  [
    "scripts/experimental/yookassa_gateway/nonce_registry.py",
    "72084ff2c5f1060ec9f064b65a16b5b348c74421036b3955a4dea43e8442ad67",
  ],
  [
    "scripts/experimental/yookassa_gateway/pg_authority.py",
    "f95e6b1403963176382f2e0f7b81f215473fd841f65ed148c665e0d487f9d1aa",
  ],
  [
    "scripts/experimental/yookassa_gateway/provider_reader.py",
    "a3c372d686289e91340b27a2f1236ab435e6c679ff50620562d8c223937a7895",
  ],
  [
    "scripts/experimental/yookassa_gateway/revocation.py",
    "062709620d084360e33e7ec1e1eaa78928a7fdb56939d92e93a40abd7269c3ac",
  ],
  [
    "scripts/experimental/yookassa_gateway/subject_tokens.py",
    "078aaa8b6958fd06e3cb30fa781e9a39f197db0c5426dc981b28f4c5268203fa",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_bound_gateway.py",
    "3a868a7e7a8aaa1b94ceb23166a12316ce96da6e7a83da5b2c2d130bde1aa7b1",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_durable_state.py",
    "48e90a949725b2c4de09611b5f448fd05d587426522f8e7e099d858652caf318",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_egress_fence.py",
    "b5099099a65590382600f40b838986cf1c6b9f66549d543b298cfc93a1411ffc",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_gateway.py",
    "0eae248ae887fd0fef367bd2e754b378168c9ad4666d04e1a233959c4e98e839",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_ipc.py",
    "a1a29c13fa4c8f29c5cdc8b2e71f64149838cdb061031f07581ac7c7f57b3acf",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_launcher.py",
    "48a8748e709ccfd75698329a903f6e6176db3b1108abf146fa2345855ca1e5ce",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_nonce_registry.py",
    "ad03694851cfca9996903528bed5c25a28610283c3f737d4e20515e84b2d6459",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_pg_authority_integration.py",
    "e61f0973d47371da914b46b12f98721905bcf0e99c514a6f6969b5186541e2cf",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_provider_reader.py",
    "1e0f5d03080578d0078dbf52da4bc8f5c4edbaabda2757d1d9dc84fd03bc824e",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_provision_assets.py",
    "0b5b9b0717ad5d3401f269c8a1e54d54d485288675b876109942fbfdc754a97e",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_revocation.py",
    "e1fe21c451ffc7a71e55167ae55102304efffea2c3a0256e4cf40292bfe9eb9e",
  ],
  [
    "scripts/experimental/yookassa_gateway/test_subject_tokens.py",
    "2a4ab15ec1d2e8acbea1582cfb9ca7adc653d7749ab944ea47e6908e3566a275",
  ],

  // Read-only GitHub Actions gates explicitly authorized for this public repository.
  [
    ".github/workflows/getzilla-verify.yml",
    "aebf70b9c82114b31bf1aa805db66bcce0e82ab219a1a546a848d5c01f238833",
  ],
  [
    "scripts/assert-ci-db-results.mjs",
    "8601073b27526749c862183739357c5c2b178c07e84bca7ba9ff424be99fe893",
  ],
  [
    "scripts/getzilla_ci_timeout.py",
    "5ab585ae193f5ee1ae71ea3dc7efeb553564384f109eb108f6031dd05c403053",
  ],
  [
    "scripts/getzilla_ci_evidence.py",
    "f2b75687272ae897c79e2f3caed848e061c4454901fa05b1c4be908bd4a4e0dd",
  ],
  [
    "scripts/getzilla_verify_ci.py",
    "0f149c73c6322383479533c659d7114664fd3c50033d4aa867b86e39b8e464ff",
  ],
  [
    "scripts/getzilla_ci.py",
    "2c80527a78c5efc3e67f7f028116e8481d8c1b942f44f32270a2b4078e620194",
  ],
  [
    "scripts/getzilla_startup_cpu.py",
    "fada6c2b77d7f759a8a411cf49594b384b1e94be024d149e0d0d8f14bc07afbd",
  ],
  // Exact reviewed local semantic helper; docs/spec/resident-semantic-tags-guard-registration.md.
  [
    "compose.semantic-tags.yaml",
    "55c4e129bc7a3c8920eec86bf2a0093c0a9b4ea3fdecf7e09bf4c96550b5b33c",
  ],
  [
    "runtime/semantic-tags/dockerfile",
    "fa84dfb61d49b317ec27a1a86d5e5abafaaf31f1623a7ab39a7b7cc842aab673",
  ],
  [
    "runtime/semantic-tags/engine.py",
    "7b11b0e524b600c754b365d1cc15dec27ade6a8d08980a387cd49303d8957b6c",
  ],
  [
    "runtime/semantic-tags/server.py",
    "aeb03825a3f42faf70d9be2dcbe12805cd036cd32a34f8ada2adf071d1819130",
  ],
  [
    "runtime/semantic-tags/test_engine.py",
    "8f08ec40a43d39dfced965e199824091b9dfeaf43f3e2cab9cccb7f31d957635",
  ],
  // Reviewed S2b isolated helper and synthetic witnesses; exact paths and bytes only.
  [
    "compose.private-parser.yaml",
    "f427649d02cc363c4e4894cf03b7a436da345be08b1c9c7468871d2d80b805da",
  ],
  [
    "packages/integrations/parser/dockerfile",
    "939497f4a5b0061f8002c78dbf0d467a06fc3fd7efb5793b0fb3922a4fead39d",
  ],
  [
    "packages/integrations/parser/build-image.sh",
    "ad9cc39982c5a9660e8787cd661bcd332ff435e5569cae65744f2d0847188d52",
  ],
  [
    "packages/integrations/parser/socket_server.py",
    "8d65070a7c92c78bf42c9e5380f5f9747ea7221f3c063a0d06de444a9c697643",
  ],
  [
    "packages/integrations/parser/test_coverage.py",
    "c91184645d5c5124866095e59c148886595e038051a45cb1fe5cf582be5c8aed",
  ],
  [
    "tests/acceptance/private-verification/make-parser-fixtures.py",
    "795a063f1a196623535e1c8c0ccc26c2decd4f0ce5052f5558d5f64d667a7e23",
  ],
  [
    "tests/support/managed-private-parser.py",
    "2d85d53831a00081e82ad81621e0fcc01f261e7b05d09cd9e20c5fbb948f6053",
  ],
  [
    "tests/acceptance/private-verification/sandbox-probe.py",
    "72b32159bdeb7b8d376700efcd8618e15c6baa471de7d748845bb6ac2cf93219",
  ],
  [
    "tests/acceptance/private-verification/socket-denial-probe.py",
    "cef2796c060a34323c7ea38fb2bc6f135330b49641504c6fc44639497866c295",
  ],
  // Exact core stabilization artifacts; no adjacent namespace exemption.
  [
    "packages/integrations/parser/helper.py",
    "c9afa24fa01446c2aea4d5772491fc09d44f394b4160b2caaf7b5969abacf7d5",
  ],
  [
    "packages/integrations/parser/test_helper.py",
    "3df51295dc4820998763a4fa9e1322cf9767c564c2eb7282562850be59f0cdda",
  ],

  // Read-only owner backlog validator: inspect source coverage, task links and dependency DAG.
  [
    "_bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py",
    "358e738320f3a8998f8d4a0e82d4e582a757afde9b696b6ba5e64825c244c95b",
  ],
  // Host bootstrap for the native production runtime (PR #70). These mutate the server
  // out of band, so their content is pinned here as well as in deploy/bootstrap/SHA256SUMS.
  [
    "deploy/bootstrap/bootstrap-ii-tonya-remote.sh",
    "a8a191b91ce4510137a8018af9fe4111570988ef52445c645ef50adfb7cf7372",
  ],
  [
    "deploy/bootstrap/bootstrap-ii-tonya-deploy.ps1",
    "34a3b1a8df60c835f221117ad17013efe758838abfe7739d0cdf2fda4889ec1f",
  ],
  [
    "deploy/bootstrap/bootstrap-ii-tonya-deploy.cmd",
    "a0e47f22d78674efa3dcdac1e7119bdf09d7d12e1baba7ec3c94c34daa255b0b",
  ],
  [
    // #81 gave every gate mode its own step log and environment snapshot
    // (summary-<mode>.tsv, environment-<mode>.txt) instead of one shared pair that every run
    // truncated, and wrapped the release gate body in step() so the artifact build is
    // recorded with an exit code and a duration. Registered in the same change as the runner.
    "scripts/run-claw-ci.sh",
    "99d14383600ee43346e237fbf7f31e04cba4ebce780669df3f28385f29329677",
  ],
  [
    "scripts/build-native-release.sh",
    "bae33e338e21801ee2e5fbf3abd68b0e1bec91839a90766ac6d814e4f4d83b50",
  ],
  [
    // 87f6270 switched the release signature check to `cosign verify-blob --bundle` (the
    // artifact is a sigstore bundle, not a bare signature) and added `--retry-connrefused`
    // to the readiness probe, so a cold API start no longer aborts a good deployment.
    // Registering the new normalized-content hash instead of relaxing the rule.
    "scripts/deploy-native-remote.sh",
    "24afb2b40e1d3970a865468888950c89ecb984c465eeefe9d46bd280936766ec",
  ],
  [
    "scripts/provision-claw-syft.sh",
    "39f638068394485aa621da9f7ed609d1c15ee9bd7574b27d8c29b494481b1470",
  ],
  [
    // 5596c3b also DROP SCHEMA drizzle so a leftover migrator ledger cannot skip
    // 0018 after public was emptied.
    "scripts/smoke-native-release.sh",
    "8948a5ee1292657b69294c726e3bf608ba050f2914e8db4f9e6c19d9afa91de1",
  ],
  [
    "scripts/migrate-native.mjs",
    "2a5d9ea65d70b7301e175aad6acf6dc6a0a4d41a3c70018f28dd30a614a78df3",
  ],
  [
    "deploy/systemd/ii-tonya-api.service",
    "df0632758cc00034f2f2392d93974c652fc0834c0dd33ffd1e75a127f629061b",
  ],
  [
    "deploy/systemd/ii-tonya-worker.service",
    "947443343b6d7c102fa1f62d40eb2e3c914060c6fff4736dfb307eee7f75fcdf",
  ],
  [
    "deploy/systemd/ii-tonya-migrate.service",
    "8e6f70fe21d37b7e9eab4c30ef26424c411fa0ecbffb118371d0f1de221b72f7",
  ],
  [
    "deploy/claw/dockerfile.test",
    "85a98d0bc817ee49d823c9b3b0d9b11446c675cebb89497bc348e29035fb9c94",
  ],
  [
    "deploy/claw/dockerfile.test.dockerignore",
    "a1f042b49a3c339792d3dc7f0c7202af94bfd2ce77a5f0f08384367b687dbaea",
  ],
  // Host-side Claw drivers. They were the single unversioned copy of the test ladder that
  // repeats a suite and uses the container's proxy egress - neither of which
  // scripts/run-claw-ci.sh does. Registered on first versioning, content unchanged.
  [
    "deploy/claw/claw-final-policy.sh",
    "319d62945717789e475a53883c7c74e166f1d646a3b950a35f48229f9b852180",
  ],
  [
    "deploy/claw/claw-final-three-pass.sh",
    "79d791ba5556de31ee0fe5972ed286cc3ab01202bb0149767dd03a6aa40320d2",
  ],
  [
    "scripts/validate-runtime-env.sh",
    "54bd8f94a80fd551d424266b9b64c4195f1e390bd36e31477c24c1387c10ae25",
  ],
  // Local pre-push gate remains an additional check before the hosted gates run.
  [
    "scripts/pre-push-gate.sh",
    "23232e1879b62690c75924542baac7fab0b8e5ebae3f7d7c8e75f1f3bb350249",
  ],
  [
    "scripts/install-git-hooks.sh",
    "a10b4d8c12942164e0636ee04403091c389c8311bcad591e923e8ff76dd1574d",
  ],
  [
    "scripts/run-claw-container-tests.sh",
    "1ef6001fd2e26714566468ac7ec7bebc9046e68c68c80a2b0868430a268f86d7",
  ],
  [
    "scripts/check-development-environment.ps1",
    "696975e2a494294e670d125d604c1d92d925866150fac557ec50f12bfef73365",
  ],
  [
    "dockerfile",
    "36932f5fc5347a8892fd42ed86f521824903e7a6e7c165f2bdedb59d7843e25e",
  ],
  [
    "compose.yaml",
    "13448e6622615a0e611b72c1f3fdbef20ee325d714bb0954ad0357216c5703a9",
  ],
  [
    "dockerfile.sandbox",
    "bb919da4b8d1922082248765f86c4d036928a2924f4f2043fe9cafb5db0dc575",
  ],
  [
    "compose.sandbox.yaml",
    "8422294e4c5b72875c34d3054c1645b468a1f2ed970afc0d6d3acf5d9811bcb7",
  ],
  [
    "scripts/build-sandbox-image-offline.sh",
    "cfc689d1ba9f6723db1a4402c89ac1a3e564d6a76dc88343d0be064bca1fbe3e",
  ],
  [
    "scripts/run-sandbox-container-smoke.sh",
    "d7a148471a2a5c75d89e3ee694fb0fc11594b210c89450470b4855ef5cbe8ef3",
  ],
  [
    "scripts/sandbox-container-lifecycle.mjs",
    "e5b8108e0da5d62fa7eab356b43638f0c24ce53c5a69b98f6c035902c294fb1e",
  ],
]);
const approvedPackageDependencies = new Map<string, ReadonlySet<string>>([
  [
    "apps/sandbox-api/package.json",
    new Set([
      "@fastify/rate-limit",
      "@ii-tonya/api",
      "@ii-tonya/db",
      "@ii-tonya/integrations",
      "@ii-tonya/sandbox-payments",
      "@opentelemetry/api",
      "drizzle-orm",
      "fastify",
      "pg",
      "pino",
      "zod",
    ]),
  ],
  [
    "apps/api/package.json",
    new Set([
      "@fastify/rate-limit",
      "@ii-tonya/application",
      "@ii-tonya/config",
      "@ii-tonya/db",
      "@ii-tonya/integrations",
      "@ii-tonya/observability",
      "drizzle-orm",
      "fastify",
    ]),
  ],
  [
    "apps/worker/package.json",
    new Set([
      "@ii-tonya/config",
      "@ii-tonya/db",
      "@ii-tonya/integrations",
      "@ii-tonya/observability",
      "@ii-tonya/worker",
    ]),
  ],
  ["apps/web/package.json", new Set(["typescript", "vite", "vitest"])],
  [
    "package.json",
    new Set([
      "@eslint/js",
      "@types/node",
      "@vitest/coverage-v8",
      "drizzle-kit",
      "drizzle-orm",
      "eslint",
      "globals",
      "prettier",
      "tsup",
      "tsx",
      "typescript",
      "typescript-eslint",
      "vitest",
      "yaml",
    ]),
  ],
  [
    "packages/application/package.json",
    new Set(["@ii-tonya/contracts", "@ii-tonya/domain"]),
  ],
  ["packages/config/package.json", new Set(["zod"])],
  [
    "packages/contracts/package.json",
    new Set(["zod", "@js-temporal/polyfill"]),
  ],
  [
    "packages/db/package.json",
    new Set([
      "@ii-tonya/contracts",
      "@ii-tonya/domain",
      "@ii-tonya/integrations",
      "@testcontainers/postgresql",
      "@types/pg",
      "drizzle-kit",
      "drizzle-orm",
      "pg",
    ]),
  ],
  ["packages/domain/package.json", new Set(["fast-check"])],
  [
    "packages/integrations/package.json",
    new Set([
      "@ii-tonya/contracts",
      "zod",
      "@aws-sdk/client-s3",
      "@aws-sdk/s3-request-presigner",
    ]),
  ],
  [
    "packages/observability/package.json",
    new Set(["@opentelemetry/api", "@opentelemetry/sdk-node", "pino"]),
  ],
  [
    "packages/sandbox-payments/package.json",
    new Set([
      "@ii-tonya/contracts",
      "@ii-tonya/db",
      "@ii-tonya/integrations",
      "drizzle-orm",
      "zod",
    ]),
  ],
  [
    "packages/worker/package.json",
    new Set([
      "@ii-tonya/application",
      "@ii-tonya/contracts",
      "@ii-tonya/db",
      "@ii-tonya/domain",
      "@ii-tonya/integrations",
    ]),
  ],
]);
const approvedDependencySpecifiers = new Map([
  ["@js-temporal/polyfill", "0.5.1"],
  ["@eslint/js", "^9.31.0"],
  ["@fastify/rate-limit", "^10.3.0"],
  ["@ii-tonya/application", "workspace:*"],
  ["@ii-tonya/config", "workspace:*"],
  ["@ii-tonya/contracts", "workspace:*"],
  ["@ii-tonya/api", "workspace:*"],
  ["@ii-tonya/db", "workspace:*"],
  ["@ii-tonya/domain", "workspace:*"],
  ["@ii-tonya/integrations", "workspace:*"],
  ["@ii-tonya/observability", "workspace:*"],
  ["@ii-tonya/sandbox-payments", "workspace:*"],
  ["@ii-tonya/worker", "workspace:*"],
  ["@aws-sdk/client-s3", "3.1157.0"],
  ["@aws-sdk/s3-request-presigner", "3.1157.0"],
  ["@opentelemetry/api", "^1.9.0"],
  ["@opentelemetry/sdk-node", "^0.221.0"],
  ["@testcontainers/postgresql", "^10.28.0"],
  ["@types/node", "^24.0.0"],
  ["@types/pg", "^8.15.5"],
  ["@vitest/coverage-v8", "^4.1.11"],
  ["drizzle-kit", "^0.31.4"],
  ["drizzle-orm", "^0.45.2"],
  ["eslint", "^9.31.0"],
  ["fast-check", "^4.2.0"],
  ["fastify", "^5.12.6"],
  ["globals", "^14.0.0"],
  ["pg", "^8.16.3"],
  ["pino", "^9.7.0"],
  ["prettier", "^3.6.2"],
  ["tsup", "^8.5.0"],
  ["tsx", "^4.20.3"],
  ["typescript", "^5.8.3"],
  ["typescript-eslint", "^8.30.1"],
  ["vite", "^7.3.7"],
  ["vitest", "^4.1.11"],
  ["yaml", "^2.8.0"],
  ["zod", "^4.6.6"],
]);
const approvedMigrationHashes = new Map([
  [
    "packages/db/migrations/0085_resident_native_uuid_sources.sql",
    "5b45f11ac06f88f603d1b300ebc746a051ef5a1f265a112fe0d27951a893cd27",
  ],
  [
    "packages/db/migrations/meta/0085_snapshot.json",
    "e79fdb57dd2dc0fce71109108f804d8d84c9a8ab7c7bca035e1ae34f5390dfdb",
  ],
  [
    "packages/db/migrations/state/0085_manifest.json",
    "d5516fcab4ea59aebc625855d97af0e43b9974ff35f045122589507d4a3ac4da",
  ],
  [
    "packages/db/migrations/state/0085_sql_objects.json",
    "2ad27c8f6921bae057a106fb32f441df73cb13c1ace7361f09bdd39af2b6597d",
  ],

  [
    "packages/db/migrations/0084_public_expert_payment_gateway.sql",
    "99dc320d06298e9747156104a4b0dab9c60c349ec43c593dfd85cb235caefbaf",
  ],
  [
    "packages/db/migrations/meta/0084_snapshot.json",
    "df3328c8dfd6bb9bf24534d84ef9eec2947882c8aaf571619e6aaaff17d4dca7",
  ],
  [
    "packages/db/migrations/state/0084_manifest.json",
    "1e8dcb99c8a4f96cd1f02d214a60ec9aaf80c59049eb9e9ae833960aa6d7bc34",
  ],
  [
    "packages/db/migrations/state/0084_sql_objects.json",
    "8ec0d6ccbfcc2ffc7d371246b5a64a332b7aad09da08e39c18ae7473eb02bbc2",
  ],

  [
    "packages/db/migrations/0083_early_bird_launch_publication.sql",
    "69427ca04b5b16004764d8cc6c20c061e1fad85b89eed60352f56529048918f7",
  ],
  [
    "packages/db/migrations/meta/0083_snapshot.json",
    "41024b5f86a6459c0cca696fea67ffd230968b23e636e404b2d110d31f34b72b",
  ],
  [
    "packages/db/migrations/state/0083_manifest.json",
    "9fb5d29a40def4eff9985e23e560f731bce8b2cfc67882eb1d4a4c25915ecfb3",
  ],
  [
    "packages/db/migrations/state/0083_sql_objects.json",
    "d1590c8692c70f01ec5b63bc7755b64a71ed2ee70005e4c4efc0b8cf1c1ccde9",
  ],

  // Candidate exact hashes, subject to independent migration-state review.
  [
    "packages/db/migrations/0076_owner_test_pricing.sql",
    "7334ee4171e929cc3c28210a96095c852a98344905491cbb2c517a50a24bdbf7",
  ],
  [
    "packages/db/migrations/meta/0076_snapshot.json",
    "06b7cebbecd73dc7ae9d668d7b92226e22ca6336576b6c772aa3b9307c0e096b",
  ],
  [
    "packages/db/migrations/state/0076_manifest.json",
    "ca00fe53cc4994f18d82caba2613d04faac551c25ce1bdaf1f96771c0fddd7a5",
  ],
  [
    "packages/db/migrations/state/0076_sql_objects.json",
    "88ecf68b10ec3b4ba183031cfea428915b94544b3996467877badec7134357a1",
  ],
  [
    "packages/db/migrations/0077_early_bird_choices.sql",
    "ec9ac668fd36bc3aa935aca74e12b3c519054f71723aa1b271cc0e257d83bbee",
  ],
  [
    "packages/db/migrations/meta/0077_snapshot.json",
    "068c685c0a6681a91499f95cc31e33241f60fb1136282c3cf116ef2d83a7656f",
  ],
  [
    "packages/db/migrations/state/0077_manifest.json",
    "04008b06cd1418cfc797d4ccc3c3c13376fe4d539d4dc94b73df0dcff84a9631",
  ],
  [
    "packages/db/migrations/state/0077_sql_objects.json",
    "39b9a0e0fedf370e5367e243e6d67d130697cc3608f2ae28ba8f77b04255e7ce",
  ],
  [
    "packages/db/migrations/0078_early_bird_launch_config.sql",
    "dc23901982dfdf558c514177f183547ef69926106a55ddcedcceefec11daabb6",
  ],
  [
    "packages/db/migrations/meta/0078_snapshot.json",
    "7b84549711ea7c3633626a8b64689e77afa5afaadb1241e3638934b8ef3bd1c0",
  ],
  [
    "packages/db/migrations/state/0078_manifest.json",
    "e18bb030d960c7c84205385985eb2ae26037c6e7767a07300fa14afdbfe12e25",
  ],
  [
    "packages/db/migrations/state/0078_sql_objects.json",
    "da89ab544697c632a897914ec3a6adbaf1126cd21633d7578399a43bebe0fea5",
  ],
  [
    "packages/db/migrations/0079_early_bird_positive_price_snapshot.sql",
    "e40c283e457187dfa4a66c0f5fc760df4d4ba3bdf97a6b2894f0ef35f82512ba",
  ],
  [
    "packages/db/migrations/meta/0079_snapshot.json",
    "e28ba9fb19654894d4e32b4d14b27142eae02a6045101b24c29b312d5369527a",
  ],
  [
    "packages/db/migrations/state/0079_manifest.json",
    "477569ccc8c8fdecabedd5c43a733185f0a95b62cb9ed8a34eb62d98bffa23e9",
  ],
  [
    "packages/db/migrations/state/0079_sql_objects.json",
    "3f23edde15295ff8218d96b170c846a119b0328ad2738178d334ac44d23dce5a",
  ],
  [
    "packages/db/migrations/0080_early_bird_form_bridge.sql",
    "357109a656d32d58e3cc1dbe45c202967a71c1c35bdba5a65962ccc20509f81b",
  ],
  [
    "packages/db/migrations/meta/0080_snapshot.json",
    "f4028553051076f6fef7403581081e10c851988f402bc339158d3f7f11f57933",
  ],
  [
    "packages/db/migrations/state/0080_manifest.json",
    "43a70a062bd4401f925e6dcf8ec1d10d329f7631ce96a4c78338bef2d7958fa3",
  ],
  [
    "packages/db/migrations/state/0080_sql_objects.json",
    "46b59c594e2bb9248d6fc7afada3dcbd1d979c4da191af44a57517233769cef8",
  ],
  [
    "packages/db/migrations/0081_early_bird_payment_runtime.sql",
    "4896c3e2482efc27db1578bbb8ede5098796c404faa75cb5d20ff268657a4353",
  ],
  [
    "packages/db/migrations/meta/0081_snapshot.json",
    "75f56f98afd07cee87bd45589fb9204587135c0414c231ca2cbaf0c212af7913",
  ],
  [
    "packages/db/migrations/state/0081_manifest.json",
    "8925caf78fb4fe968a04de3a1dc67aed23353c5ab698386b4264680a1d441de6",
  ],
  [
    "packages/db/migrations/state/0081_sql_objects.json",
    "526bd86b2aaa402209d4cc9e79ee7ef2964243ee3a2d7d728fdb9a6cc1a1b8aa",
  ],
  [
    "packages/db/migrations/0082_early_bird_worker_capabilities.sql",
    "9e992d43465b475cd1d2210f0bb3134632504c30bb17402e1dd7dd4e91a9c80d",
  ],
  [
    "packages/db/migrations/meta/0082_snapshot.json",
    "b39e3227ff5c1d8873892668a19721e63455bf20e94aa7a701a4ad15715834b4",
  ],
  [
    "packages/db/migrations/state/0082_manifest.json",
    "30158652f23ef434105026a6e541c9d3e8d06639c1dc7948c9ee8eb383221ef4",
  ],
  [
    "packages/db/migrations/state/0082_sql_objects.json",
    "0206f2249f0eb992dcecdf51cf332479d742b64a05ff2b7046c831df2a4a143f",
  ],

  [
    "packages/db/migrations/0075_resident_lifecycle_completion.sql",
    "3fe2e53365eedb359d2912fe1b26962aeea520008a29d4e810456b67c3ddbda8",
  ],
  [
    "packages/db/migrations/meta/0075_snapshot.json",
    "7ae2df88f63b3a56802eaf72ccb4b544d76c1ecf0c6221a2dbee7541e84cf57a",
  ],
  [
    "packages/db/migrations/state/0075_manifest.json",
    "ce7082df4b3d7a4351774f2aafb789901c5d9d25038afdd30c6b395d3ea592af",
  ],
  [
    "packages/db/migrations/state/0075_sql_objects.json",
    "686d0d154b0c0897cbf57b321e2cca55d3355ab9082aac8cd5e1d57e8a83d80f",
  ],

  [
    "packages/db/migrations/0074_resident_native_scheduling.sql",
    "7ad346d5b1601d517173b03d1de7d020c8368ea195cc36e0facb2bb4cdd1fc53",
  ],
  [
    "packages/db/migrations/meta/0074_snapshot.json",
    "660ae7042892e4e001f33b719370fb79862d8a039ef8b84955b19add73421f72",
  ],
  [
    "packages/db/migrations/state/0074_manifest.json",
    "b49f86f02dc39518573bc381cb62b174c05988c41a281334f2caff58501b3bf3",
  ],
  [
    "packages/db/migrations/state/0074_sql_objects.json",
    "1210b6e2625484f2027a41afa2e4ef10452b3c64756e19e6c5beeee6ba21f4ca",
  ],
  [
    "packages/db/migrations/history/native-before-main-20261027/0070_resident_native_scheduling.sql",
    "57aa4832165fcaf88665ee6d3d9b358a05c94c8d27f1a6bc09167d0667129e75",
  ],
  [
    "packages/db/migrations/history/native-before-main-20261027/manifest.json",
    "85f53a3b8e77704c1110ab4e8b1af8f15d0628f6de076de1a56e39b304665713",
  ],
  [
    "packages/db/migrations/history/native-before-main-20261027/meta/0070_snapshot.json",
    "790760c28b969aecb1131ff8645c6a5708102318fc579b50a2e0bb778f07b220",
  ],
  [
    "packages/db/migrations/history/native-before-main-20261027/meta/_journal.json",
    "b9c66b8bb815b460dcf5fdbac623a9bb79c1c38239ca8dc618e59b5f0a86f0d7",
  ],
  [
    "packages/db/migrations/history/native-before-main-20261027/state/0070_manifest.json",
    "222b8f1e33823895774099ce115cb6475adfa2e279850e91c8a29a41b27b800e",
  ],
  [
    "packages/db/migrations/history/native-before-main-20261027/state/0070_sql_objects.json",
    "82fc8811b7e6c761a16a63c9fcb919d814000692c75abfdf345b9f7e5b4cfee0",
  ],

  [
    "packages/db/migrations/meta/0070_snapshot.json",
    "538bfaf12180e49f5f2a0e9d4a4d2574645b899401d52aaf632fe1ce37b4ab0c",
  ],
  [
    "packages/db/migrations/state/0070_manifest.json",
    "aff9330d9c1bbd94ef511e298ebd6d8c40849a4abcc0d869a41208d9179ee925",
  ],
  [
    "packages/db/migrations/state/0070_sql_objects.json",
    "96a9dd70096a148a598a23c5a0719f50f3545659015234e5a9a6913da8a04aff",
  ],
  [
    "packages/db/migrations/meta/0071_snapshot.json",
    "e511235411b7c01a50e672daf14e5309563f5a8199ce583189512a83b8e187f8",
  ],
  [
    "packages/db/migrations/state/0071_manifest.json",
    "44564b00bcde15055269fd0a0e4dfb5fb94044e18d6dfda8867b4ff993209ef4",
  ],
  [
    "packages/db/migrations/state/0071_sql_objects.json",
    "57a3764156e186e7e6ca025059d489141e57add709de267691f54881052b97cf",
  ],
  [
    "packages/db/migrations/meta/0072_snapshot.json",
    "2dbc15b5c2f22ace38a587cf7190d0751eb9a9463c8f900160b9b7004909fa92",
  ],
  [
    "packages/db/migrations/state/0072_manifest.json",
    "0933260beb39a30155da3a96dec70875e1d9a5a4341e3469e38c3bd3df53b90f",
  ],
  [
    "packages/db/migrations/state/0072_sql_objects.json",
    "d011f500ac43301819458357621847f25ccbd1a5eb0c3050f243840f53e6eebd",
  ],
  [
    "packages/db/migrations/meta/0073_snapshot.json",
    "e415d2dfb48f49cacd58af880d239f3cc8c6f6da05ee55720db5535e07f10613",
  ],
  [
    "packages/db/migrations/state/0073_manifest.json",
    "db078855e5d7bffe45b65e40c0d295734fc50f3d804062044e13d364ee78edca",
  ],
  [
    "packages/db/migrations/state/0073_sql_objects.json",
    "43732405c71a10780f3549adef95bb41a092f1bf640ef608d53ded1419e75339",
  ],
  [
    "packages/db/migrations/history/main-before-unification/0039_lifecycle_scheduler_c1.sql",
    "32f260d7e4dcbc73a490266165156bf525ab0aa6aa7bd2496ee65bec1a18b71d",
  ],
  [
    "packages/db/migrations/history/main-before-unification/0040_booking_waitlist_d1.sql",
    "22822e0fa1c386b72f345e63f508b53a07e65210434259d65ef501f041b9d7b8",
  ],
  [
    "packages/db/migrations/history/main-before-unification/0041_booking_reschedule_replay.sql",
    "6b8f79dbf68e2150d0dce0b95302662389375c6c93ee194760403569f06042ed",
  ],
  [
    "packages/db/migrations/history/main-before-unification/manifest.json",
    "eb0370db0c6dc802c30b300cf8fc6bcac7cd7afe2853d5266075da9bc2ecefcf",
  ],
  [
    "packages/db/migrations/history/rc-before-unification/0051_planerka_availability.sql",
    "d8d48425445b6bc80e7b1d027a5141b433507db725b9673a8e516e177008c89e",
  ],
  [
    "packages/db/migrations/history/rc-before-unification/manifest.json",
    "7f9b67cfdde6889b3af37ad192b8247c21f32c1276b2a7c5c3b0e7ab9affb9e8",
  ],
  [
    "packages/db/migrations/0070_planerka_availability.sql",
    "d8d48425445b6bc80e7b1d027a5141b433507db725b9673a8e516e177008c89e",
  ],
  [
    "packages/db/migrations/0069_resident_semantic_tags.sql",
    "a5c787fb5e784b5cde3c8aa8f19d6f43e916b25c3587d5ed61b72490ff78d4d2",
  ],
  [
    "packages/db/migrations/meta/0069_snapshot.json",
    "9887f6cdc11a4684993b375e0dc7cdf101fc1409c093d6f6c1f74a04e0e33247",
  ],
  [
    "packages/db/migrations/state/0069_sql_objects.json",
    "e8ca1f50fe003a504d6cf335db6b58215a1f0dc92a0f005f17a4066fdd9a4517",
  ],
  [
    "packages/db/migrations/state/0069_manifest.json",
    "55a7bdb1f65af85e21ee7bc549dd4461870a781b65e59e43a2904bbb94e9e671",
  ],

  [
    "packages/db/migrations/0068_resident_latest_approved_publication.sql",
    "573c612c1c00841f38929ec89eee01b1e27ef6a5dab11bc4d8b032f535ca98f9",
  ],
  [
    "packages/db/migrations/meta/0068_snapshot.json",
    "00a3b8600e6158f2f844daabd4779a423a58e3b9de52f73a9f9bec0a0064daab",
  ],
  [
    "packages/db/migrations/state/0068_sql_objects.json",
    "5e5c3670e3272d2b7e3eca095a200a457a28c01c6cdffe73cbcc3124a3006e3b",
  ],
  [
    "packages/db/migrations/state/0068_manifest.json",
    "48974d54f539dbf674604335cdc00228aa91b1b3dbb32cc55af1e40ab7304781",
  ],

  [
    "packages/db/migrations/0067_resident_rich_review_corrections.sql",
    "7f79f93ef2cf00a79b3740472147c0e650abf154b545fec34be9b0d443ae8422",
  ],
  [
    "packages/db/migrations/meta/0067_snapshot.json",
    "37fee0f597aaee54127c47461f9ee674db668280c1703ac5ecf2861bd371071a",
  ],
  [
    "packages/db/migrations/state/0067_sql_objects.json",
    "86770b5ead5c04bd7cd1ac9988fa6e49798ffeef46d065aae5cbffb27ac61e45",
  ],
  [
    "packages/db/migrations/state/0067_manifest.json",
    "acfac0882803c6df25917311027e211a818d04d9efe3f3dfe6232f3ba00ecde3",
  ],

  [
    "packages/db/migrations/0066_resident_rich_onboarding.sql",
    "7c81e8b71f77d256aef1a2fd8c8ee672a15ddb2680855f7c10bf182ec7d4b196",
  ],
  [
    "packages/db/migrations/meta/0066_snapshot.json",
    "ee67fcc27b22f6ee480a3285e4cefe6dea2c73cfeb34addbf431e7544a39fd78",
  ],
  [
    "packages/db/migrations/state/0066_sql_objects.json",
    "36d43b7aee8965bbc8080632485bc0df37a119b5d9ae37d22cb2c6afd9505b55",
  ],
  [
    "packages/db/migrations/state/0066_manifest.json",
    "ce4d4ab299ae4ad05817ee746c3108056c3b9aed8da3e2df6b03b35da7ef1585",
  ],

  [
    "packages/db/migrations/0065_resident_private_recovery_fences.sql",
    "932d096ed16419f3a25814ccd881d116ff76847f1984fba61557164c0c4d6307",
  ],
  [
    "packages/db/migrations/meta/0065_snapshot.json",
    "f7874d7bf5025a00589b452088afe364731746fee98d2ff1da0e5fd98eea52f6",
  ],
  [
    "packages/db/migrations/state/0065_sql_objects.json",
    "0abdb21719f5a63aa8f87ca84a6b46e9be4c5bf5f0fb065562b118fbb492a53f",
  ],
  [
    "packages/db/migrations/state/0065_manifest.json",
    "724315937a3764631452f1994bfeca6cc5dede6949df0790bd49ae2ce4911caa",
  ],

  [
    "packages/db/migrations/0064_resident_private_jobs.sql",
    "9d792a30d7044cd7a3a9a49091266bb9fd2bc4fe2968809cf67175ffb6c94ab3",
  ],
  [
    "packages/db/migrations/meta/0064_snapshot.json",
    "651975b80ba7f4a7b43ed70643c756ad944668e4099e5ecfe1258fa45e22858a",
  ],
  [
    "packages/db/migrations/state/0064_sql_objects.json",
    "2967be9de10c11e299ea9a4c316d826e6041c17ba4c2a0dc016329ca733f6b16",
  ],
  [
    "packages/db/migrations/state/0064_manifest.json",
    "f00c4aa05958039ed6b0367602be094660ae90c8782107138be10b686adba9af",
  ],

  [
    "packages/db/migrations/0063_resident_verification_review_corrections.sql",
    "a68c5513b4ee341950e6e39eae2c81ff6004b02ba2f1df689a7cc9a41f4e042a",
  ],
  [
    "packages/db/migrations/meta/0063_snapshot.json",
    "1c6e9a6ed43c4c963ef6986ea28edaf2de0035ea6a584341505e4723be6c0aa0",
  ],
  [
    "packages/db/migrations/state/0063_sql_objects.json",
    "a4df0d0aac2b6fee356fa29f625db4ea65afabdc7d6ce7d69be7228e6ccb3909",
  ],
  [
    "packages/db/migrations/state/0063_manifest.json",
    "793201b793c47a67fb07a3cc765eacb17ef04dccc262101ec4f7f87a87278469",
  ],

  [
    "packages/db/migrations/0062_resident_verification_messages.sql",
    "6fedda508f5b6fede3dbf3c0113262fbba06c892f16ff2146ee455b1a887a1ff",
  ],
  [
    "packages/db/migrations/meta/0062_snapshot.json",
    "eb4bc06d16ce0fe1900a46fd3e3c1734867fe7b5b421df8ac0acd8c10c76b7e8",
  ],
  [
    "packages/db/migrations/state/0062_sql_objects.json",
    "23fc5f17f92cee664dfa6b67fb48eeeebca8523e8fae1717fad387757a17c751",
  ],
  [
    "packages/db/migrations/state/0062_manifest.json",
    "bc3ead0c5ebe1cddf40b41a83a109cccb724a4c49a00753034690de573a8a660",
  ],

  [
    "packages/db/migrations/0061_resident_content_safety.sql",
    "2e8c028c080e8e00a5c8a02bddaae31bb6f90fc5ce536c041c9852d560619a3b",
  ],
  [
    "packages/db/migrations/meta/0061_snapshot.json",
    "368c6872330255d153218cb00a8c5b0702f0740338ff653a8fe4941dd0e346d5",
  ],
  [
    "packages/db/migrations/state/0061_sql_objects.json",
    "30bf08027abf68d8bfcb0f2d56e393e56e26c6c412da5f92b706e8d498f6b237",
  ],
  [
    "packages/db/migrations/state/0061_manifest.json",
    "1b036e4fd3729eba94ac67dba0beeef8a8f7fe194dbca09be44d6450524036dc",
  ],

  [
    "packages/db/migrations/0060_separated_sales_review_corrections.sql",
    "4b9f5b78690f8eb7bd59d7d1d2f8f51fd73b3ae50ac2e99bd28767cff4f43933",
  ],
  [
    "packages/db/migrations/meta/0060_snapshot.json",
    "c2590b2c31ccfb74236a34b0e20598005b5cefea1a67641c113fb4ad3ffc4a7d",
  ],
  [
    "packages/db/migrations/state/0060_sql_objects.json",
    "fc9fdaca9ba3bf7b9772265cd095d29f15af01338f3a0b58edda3491537175d2",
  ],
  [
    "packages/db/migrations/state/0060_manifest.json",
    "9dc31e816dd08f3971b59920fa251f87bdb9a881f4ec690cd884e205e0f89cf1",
  ],

  [
    "packages/db/migrations/state/0059_sql_objects.json",
    "25d1c71c3a0ad26a24c0ed538662792d54b4136527e6b4cf9773003aebec6353",
  ],
  [
    "packages/db/migrations/state/0059_manifest.json",
    "414ccd8d616a65be0beb91a94cc2d8220db1929db85c9e736b289be93e4952cc",
  ],
  [
    "packages/db/migrations/meta/0059_snapshot.json",
    "65f53050b8edbc5abe06cdde115b6ea6dc6751960b894dcf7b7f78a6d12d5ed5",
  ],
  [
    "packages/db/migrations/0059_residency_separated_sales.sql",
    "b0b50a318ed689d1c9032787e17e3889224d7ec0d0b842fafd800d725dbd3846",
  ],
  // Exact core stabilization artifacts; no adjacent namespace exemption.
  [
    "packages/db/migrations/0058_residency_core_stabilization.sql",
    "b8e32b6377288312800692f03090a341744bec0f360ca108cf03bdadc63aab61",
  ],
  [
    "packages/db/migrations/meta/0058_snapshot.json",
    "79449bbe6d9a42942cb32794250fb8a1ce2fdccbc751e7cc5ef1b88dbaafc78c",
  ],
  [
    "packages/db/migrations/state/0058_stabilization_sql_objects.json",
    "4e502af2dc8bb11fffdd55d8a7a6175c7c328396304d661f6a6d34c9f59b4b07",
  ],

  // SQL replay + additive catalogue; docs/spec/verification-schema-form-guard-registration.md.
  [
    "packages/db/migrations/0057_resident_verification_form.sql",
    "06b540f1cfd16a86984454fd52ab90e0bfb0d9984c1ed82f23c0799283292093",
  ],
  [
    "packages/db/migrations/meta/0057_snapshot.json",
    "2eaa0c604dc8f3ffac0b0754e4fa2bd17d1fe98e14cc2b553f0bfa6721f91fb4",
  ],
  [
    "packages/db/migrations/state/0057_verification_sql_objects.json",
    "23158ba19989bc5919a93bc967465244a2865f2be3d6550e8d2bacb538d2dc6c",
  ],

  // Reviewed additive v2 SQL, PG-derived supported snapshot and exact catalogue.
  [
    "packages/db/migrations/0056_residency_offer_corrections.sql",
    "6605ab63ddf5ac31f7b49e5d45c93e96118e731cf9aa1a6c6d287ef1d6f01c1b",
  ],
  [
    "packages/db/migrations/meta/0056_snapshot.json",
    "b22ff021153b6a85fce4dad523921edba378be4ca518ffeb8d26c3811c0c5ec5",
  ],
  [
    "packages/db/migrations/state/0056_offer_sql_objects.json",
    "1b785221149f28bcff758f1829ec909ef385fbab2580ea11f61753933b61709d",
  ],

  // BlockD actual full-chain replay; docs/spec/phase1-block-d-guard-registration.md.
  [
    "packages/db/migrations/0055_expert_residency_lifecycle.sql",
    "ff08821bc86ffb3157fa759419251dbb5e68167629cf8e1d8114826e42be74d1",
  ],
  [
    "packages/db/migrations/meta/0055_snapshot.json",
    "d6d7052022a575a9ca297e407a36a993d30e9548ae8034ab96c3e36d8cab758c",
  ],
  [
    "packages/db/migrations/state/0055_manifest.json",
    "03e735f484bed1b70522a03479b06e8eb71ffb2c9493f9d19e58701b3e58de0a",
  ],
  [
    "packages/db/migrations/state/0055_sql_objects.json",
    "19376bc5d926c10c68b35839526d0685199fab172d9eee4001fb2ce320032dce",
  ],

  // BlockC actual full-chain SQL catalogue; no generation authority.
  [
    "packages/db/migrations/0054_expert_card_publication.sql",
    "526ac3bd5fa9ac6edfee72128d2898ae19b1ea6555161091b897db0ed1f860f8",
  ],
  [
    "packages/db/migrations/meta/0054_snapshot.json",
    "6740fe1ebd96adf044694be07759d99a3b45f0aaa67ea910588940741f87ff69",
  ],
  [
    "packages/db/migrations/state/0054_manifest.json",
    "9e13049f850d32a0fd6c4c816ff45359f9d1e9d40a32e9f3130523a530c94cc3",
  ],
  [
    "packages/db/migrations/state/0054_sql_objects.json",
    "2f21249b5210b9725bd5a0ff029827b4c55b54fb859d6e98f4799cecebe7c9c2",
  ],

  // BlockB full SQL replay; docs/spec/phase1-block-b-guard-registration.md.
  [
    "packages/db/migrations/0053_expert_verification_onboarding.sql",
    "28563c02972211e931645521b2a5f1f36668c2c621813c1a942850120803b182",
  ],
  [
    "packages/db/migrations/meta/0053_snapshot.json",
    "455be9c95a7e086ce42d1b432176f7fc07368d0846c400386bb036b8ad8f8dbb",
  ],
  [
    "packages/db/migrations/state/0053_manifest.json",
    "fafd4b12b1fab06e6292cab3ffd7bdcd520b3aac164d1c99f61dd91b1172ab80",
  ],
  [
    "packages/db/migrations/state/0053_sql_objects.json",
    "f56c527a2794a5f3fe71b155bb4133d012d56225ac240c11faa0980259ac3f75",
  ],

  // BlockA SQL-replayed state: docs/spec/phase1-block-a-guard-registration.md.
  [
    "packages/db/migrations/0052_expert_promo_applicants.sql",
    "bc75a0731f408194741548f4bb7a9342aa0fbc4e2d1dad52d97dceb325b933f1",
  ],
  [
    "packages/db/migrations/meta/0052_snapshot.json",
    "91120bff86bcc62bae1bd7883d875c9409dcc1adca1ee9e0104a8f56fe6fd8e8",
  ],
  [
    "packages/db/migrations/state/0052_manifest.json",
    "76bef7cc0003b995bd0d9afc1b45a5d33e5c5da73a7e7b42c56e17ff5bab1029",
  ],
  [
    "packages/db/migrations/state/0052_sql_objects.json",
    "2b5870f64ef8a125e474b8bb404340b570b8c4e7291d964a3d2113e0958b1c42",
  ],

  // Reviewed SQL0042–0050 and reconstructed metadata; no bytes changed.
  [
    "packages/db/migrations/0042_client_paid_orders.sql",
    "adc94b568ddee0b8e29244e5f602f1781b02aba70dfca3bc8048d9882e250d94",
  ],
  [
    "packages/db/migrations/meta/0042_snapshot.json",
    "282f3ff749dd9a057c2eb83b08e12df2467a957e21e0a39115f0b89c64c5d48a",
  ],
  [
    "packages/db/migrations/state/0042_manifest.json",
    "3fc0e60b7e588e0ee2f7ebdec70af366ebf3276f51f47921f781d68d6712490d",
  ],
  [
    "packages/db/migrations/state/0042_sql_objects.json",
    "151ab1dc8fc02864cd317939e23c4dc4a79bedb9f2fd9060cacdb95044e13fba",
  ],
  [
    "packages/db/migrations/0043_planerka_booking_operations.sql",
    "259104111cfe60ad07d77a4e6e07d65f2df741f1fa77b19114a1d385fcd0c913",
  ],
  [
    "packages/db/migrations/meta/0043_snapshot.json",
    "4eb8d01149034a06f4ac77a9082366bce2ebffd443d075a5c8ad8570cff2d890",
  ],
  [
    "packages/db/migrations/state/0043_manifest.json",
    "efb470d8d7ce307deb0868389611da15e1e2a83306dc9fb08dffa74a76ec0cf5",
  ],
  [
    "packages/db/migrations/state/0043_sql_objects.json",
    "587961fee2f2abe09cb3119ec27d968ffdcf4091f4cf0429f2cf09a6acae392a",
  ],
  [
    "packages/db/migrations/0044_booking_notification_delivery.sql",
    "f8bedcec57d442018bf10bf8f6f496a7bb686decd26d7f94ecda0ff7f04c1f60",
  ],
  [
    "packages/db/migrations/meta/0044_snapshot.json",
    "fe533483a523bdfe1efc217522046fe80143fab2f1e03a05c7d441109e971276",
  ],
  [
    "packages/db/migrations/state/0044_manifest.json",
    "baf87f1b00a889f72995b16eeee3aa4767f6942c3cc9e30807b8240890370f5a",
  ],
  [
    "packages/db/migrations/state/0044_sql_objects.json",
    "52985e59bb67add6b3246822ecc6ef95a9e4ec20db314fc536ac127ba4944cb6",
  ],
  [
    "packages/db/migrations/0045_booking_notification_controls.sql",
    "2d48d6e29661a5f6c405a0ccd45ee7deca900392d2d7fec229c489abf839a3ec",
  ],
  [
    "packages/db/migrations/meta/0045_snapshot.json",
    "9feb08fc0b09419b6402faeb1e223ad85398a86fcded1f658839b4063a0f62f8",
  ],
  [
    "packages/db/migrations/state/0045_manifest.json",
    "466b7667b16ba72ad0ea5fc6e620a2c6ff38589051607d3c7189c07ced4b6f7d",
  ],
  [
    "packages/db/migrations/state/0045_sql_objects.json",
    "f394bee58713e60f1cec828e3c8eddbc91da6aaf79db6472db07a6e03a149d6a",
  ],
  [
    "packages/db/migrations/0046_booking_handoff_revocation.sql",
    "67898707a8d46162e06706681632900f956b0c961f480994fc98bdcd51c2997e",
  ],
  [
    "packages/db/migrations/meta/0046_snapshot.json",
    "7740b7153af60ea160a6144460a676eaac81406fed302f66a58894d320e46626",
  ],
  [
    "packages/db/migrations/state/0046_manifest.json",
    "8314d248bfbb998479aedac5ce62e77192b2dcd9b91cd769e036650474f087ae",
  ],
  [
    "packages/db/migrations/state/0046_sql_objects.json",
    "7cbc46dda67d475839f076e7d51de0da5815886eb156765e4f93845556b2ecca",
  ],
  [
    "packages/db/migrations/0047_expert_campaign_quotes.sql",
    "feab6a3d5afe04d32f89b5e1ca7f157252a2aad10bc4c252a2f5a889d8c0d8eb",
  ],
  [
    "packages/db/migrations/meta/0047_snapshot.json",
    "ff5dba10059c1d048cff9d81f3194a355891f7845a633376454e591dd81b78d8",
  ],
  [
    "packages/db/migrations/state/0047_manifest.json",
    "a04cfe79b44ed94502815f2ec0318e7101f06017a91edd47296c58e00fa8d208",
  ],
  [
    "packages/db/migrations/state/0047_sql_objects.json",
    "147b6cc1eca852e523995e65dd44e37f66342eebec40153530d9e33fb1abd867",
  ],
  [
    "packages/db/migrations/0048_expert_campaign_orders.sql",
    "4d89da04a0dee6f6b6f5fa360ebb2c6cc84c4341770b3b11854b5c57b0f76d59",
  ],
  [
    "packages/db/migrations/meta/0048_snapshot.json",
    "599855326596fff428fda669b1c8997c1319c0394ca49ef4ae77ed09e34d81be",
  ],
  [
    "packages/db/migrations/state/0048_manifest.json",
    "13f248ed704e091e6b65acb469ecbf331ce4aec125323dc453271b6f7e19b26a",
  ],
  [
    "packages/db/migrations/state/0048_sql_objects.json",
    "195a4bc016d1ccfacc3c1569dc08f6af44136c5bd2132429091e69bc5179e93e",
  ],
  [
    "packages/db/migrations/0049_expert_sessions.sql",
    "5e3f0283ad5e1e065bf2e21e21dd4c9f7b4dbbbdbff9bbea345708b4b47c25de",
  ],
  [
    "packages/db/migrations/meta/0049_snapshot.json",
    "f79d7e11e65f425afcdc227ab5768cf152632bf0af0198bdffebe804d2506c2a",
  ],
  [
    "packages/db/migrations/state/0049_manifest.json",
    "387d14038e7c0dd5ad228a4f4a78103e5255aee0ee4ddad2cc3ff7f6485e4af0",
  ],
  [
    "packages/db/migrations/state/0049_sql_objects.json",
    "a9a6e024cae54a09675818db5da626da2014ead4de2aed095b6f8d893f4e7588",
  ],
  [
    "packages/db/migrations/0050_expert_receipt_contact_bindings.sql",
    "bfaeb278183a8fefe2c9bd14e094618a15de754a02be1fd11d25f4dfd5d04399",
  ],
  [
    "packages/db/migrations/meta/0050_snapshot.json",
    "f3bc44aa46cf4aa1f78c0682d5e1957fd62b961febb0d65440831b0fff33d1f3",
  ],
  [
    "packages/db/migrations/state/0050_manifest.json",
    "dcaaebcc1758173562505cce8315b6a276cf5490ffa2467d37b5e290c6626b45",
  ],
  [
    "packages/db/migrations/state/0050_sql_objects.json",
    "6a5473befe28851655729a979cef7d595ff72fd17959a63515da857440417cfd",
  ],
  [
    "packages/db/migrations/0051_expert_onboarding_applications.sql",
    "e244079a72a25c2707a30864c704c0ce692e96ee1f39eefc8a4203536cb99a64",
  ],
  [
    "packages/db/migrations/meta/0051_snapshot.json",
    "0c16dd5981f99e2b018dad31c7ab4d867c1c68e7beb2cf206fe5fbb05ffff681",
  ],
  [
    "packages/db/migrations/state/0051_manifest.json",
    "3f1c4fa63a8778d232d049b449a89242736db879260fc4f192f5c7c95bf6c18a",
  ],
  [
    "packages/db/migrations/state/0051_sql_objects.json",
    "0a203b2d46e09d345a19c0c71bbe849cc35e4164800689d0739ba4cd16af957a",
  ],
  [
    "packages/db/migrations/0041_client_erasure_requests.sql",
    "2e54f405b3a15acccf8c5cafd88dc385ccba5a0b5b287e8e0e5c8cd1c04a18ee",
  ],
  [
    "packages/db/migrations/meta/0041_snapshot.json",
    "365c054817f116f51c3e8b548a18191e9041700617e117b0222f2a7e98e33941",
  ],
  [
    "packages/db/migrations/state/0041_manifest.json",
    "34d68756512bf30eefa1fe3a0ad1bbbf0a2ca1150ab59a86cfd2a4bb305ae952",
  ],
  [
    "packages/db/migrations/state/0041_sql_objects.json",
    "be90ac47a3012b04af76ac275893e303cb48849716f2f47b299047433e9d2d25",
  ],
  [
    "packages/db/migrations/0040_client_session_booking_grants.sql",
    "abd7de7b230598e2f63309c660c98de4d1812e87737dcefbfe0e8a15f2f32979",
  ],
  [
    "packages/db/migrations/meta/0039_snapshot.json",
    "b7dbbb1318fa677e2f43e0975a6f858dae9fab00ff3863899cfd5e7baca8cdc1",
  ],
  [
    "packages/db/migrations/meta/0040_snapshot.json",
    "7f6d547793b02b9da77a5daa584a70bb10e0239e2bbef1169d1e9a7c7d1ca411",
  ],
  [
    "packages/db/migrations/state/0039_manifest.json",
    "db670f20b5f7c44e5a2c2590945f24f133456c5e11415a9b9451a3abc8bac9de",
  ],
  [
    "packages/db/migrations/state/0039_sql_objects.json",
    "1723fa6d795402eca56b42708a2ecc69f280574a273b9056f42fa901d1a2ef49",
  ],
  [
    "packages/db/migrations/state/0040_manifest.json",
    "0286858c8df2db68231d611be308f3fba7599a1820637476ce0c3e3351c6d730",
  ],
  [
    "packages/db/migrations/state/0040_sql_objects.json",
    "013d69c02997e3bf2fc097c9050b52603c9b62e54d293191c3dd44757ad03ebf",
  ],
  [
    "packages/sandbox-payments/migrations/0000_sandbox_expert_residency.sql",
    "495e8b352021c1fb6d0fc027e1621df6137d0d15c4a54cff5ce975cb2c318e0a",
  ],
  [
    "packages/db/migrations/0000_mvp.sql",
    "067926dd1249fabdc59f91dedd39ebfade05a55a3de38059705092f512139216",
  ],
  [
    "packages/db/migrations/0001_message-package-metadata.sql",
    "eb09df658b46f735c4dbaedf899c8b4b87ac77649655842666cdd3ab2972c6a2",
  ],
  [
    "packages/db/migrations/0002_atomic-message-accounting.sql",
    "d29a4db9cd25d98cf9b586e2d64e8094fbd8ccbf4a41fe2b2c3752843b5ffea5",
  ],
  [
    "packages/db/migrations/0003_booking-concurrency.sql",
    "c070a7696279f3379ade453e4291626aae6e81bc21162c7bc0d628435131bbcd",
  ],
  [
    "packages/db/migrations/0004_durable_outbox.sql",
    "e2a2292c1401e0e5b19f4d7cf2adfd79a37391fe7854049cc3c4a883777794ab",
  ],
  [
    "packages/db/migrations/0005_outbox_fencing_tokens.sql",
    "d726342f962f66f975e7350ec1a3dadb78eac6d32349a0c09932bf56d5edcb4d",
  ],
  [
    "packages/db/migrations/0006_telegram-callback-expert-fk.sql",
    "551998e8ae51fe5d2267ca2dc4d13e54d8af05f084bcfd8cb92a63f0ba3d1567",
  ],
  [
    "packages/db/migrations/0007_catalog-eligibility-fields.sql",
    "cd056b56578fd09915da44e99bb63f025757c2561bfb0391a327107680748303",
  ],
  [
    "packages/db/migrations/0008_booking-expert-view.sql",
    "d08810977e9e8fef657e60147627a7c078ff91929626d4e2cd52a083f0bef840",
  ],
  [
    "packages/db/migrations/0009_young_arachne.sql",
    "4ffb0a9a5746c46873fed26adeac21865b02c3bac50a22bf8cf96b6a00c99f34",
  ],
  [
    "packages/db/migrations/0010_brown_purifiers.sql",
    "b00006d3b168a7b1295e7da6028756e3fd8dda5f13310765c54484fd205b8da0",
  ],
  [
    "packages/db/migrations/0011_sad_red_ghost.sql",
    "e51142adf199100404453875cff4088614019eb126805d28ce2922fe114b1bf7",
  ],
  [
    "packages/db/migrations/0012_productive_siren.sql",
    "12fe46e565320459cccb9c23f7637b1a34ccb4407fef3ad25fc767cfa5ca6851",
  ],
  [
    "packages/db/migrations/0013_gorgeous_deathstrike.sql",
    "2e7d88b34ca12b010c18ca722cddad2323c7a60dbb0c56db408d8db5d5d292c2",
  ],
  [
    "packages/db/migrations/0014_admin_feedback_controls.sql",
    "b1b36ae08655a70398b0133e38bbb1442a6bc0ea37f75a78c1e5b01808e67339",
  ],
  [
    "packages/db/migrations/0015_admin_iam.sql",
    "c84622593e18513feae28abf47d82f52bf2bb77f54a50e77d4d5c353cda1aabc",
  ],
  [
    "packages/db/migrations/0016_task17c_admin_workflows.sql",
    "3fb0532ce45de66c4d1f86c74aaf473e525d9440e6937d716ed50dc3e93e9045",
  ],
  [
    "packages/db/migrations/0017_adorable_sinister_six.sql",
    "255b88191d6bdfc679ea5066b247c47ad19fca41832baace209db424736972fa",
  ],
  [
    "packages/db/migrations/0018_expert_residency_referrals.sql",
    "8ecae37aea385c75659f0dbba2c06f62e5bffabca20ed85dd1b703e7d7a032a4",
  ],
  [
    "packages/db/migrations/0019_expert_order_provider_deadline.sql",
    "be80e9b716d42bb6e39fb4da8958b6685337cc6ef73ee0beb58f8487c058918a",
  ],
  [
    "packages/db/migrations/0020_expert_provider_verification_evidence.sql",
    "651c8a5a99acb9c36e7cf8e99d8f9202e37bd077dfe6d8826079e7a8f402605e",
  ],
  [
    "packages/db/migrations/0021_expert_settlement_snapshot.sql",
    "e62b24ccf54900eb4bdb7014881d1a9ae0e555ab5a8875177f20ac30ef21ce14",
  ],
  [
    "packages/db/migrations/0022_expert_referral_admin_replays.sql",
    "f4262b0905c945ccec107603106e120875f12ea23d570fc4d90bdddd8bc899cc",
  ],
  [
    "packages/db/migrations/0023_yookassa_provider_operations.sql",
    "2c6f04eb2d1e5d019f710e3111d09e6f3ac01be986e3ee8e6e548a551aa9d5fc",
  ],
  [
    "packages/db/migrations/0024_yookassa_encrypted_recovery.sql",
    "05c9447c12d75a0b4a8400822a43d9dfd8ed4855fdb3913dd5836923a8c0679c",
  ],
  [
    "packages/db/migrations/0025_expert_telegram_residency_callbacks.sql",
    "7af18618c6a06638b85dfbba734ee9ffea416629493eb139575ac6c5d3905b2d",
  ],
  [
    "packages/db/migrations/0026_expert_telegram_checkout_outcomes.sql",
    "35868ffc1cb73de322942aebee08922a75d226e30d5e739b1dc5d6681de2816b",
  ],
  [
    "packages/db/migrations/0027_expert_ai_request_receipts.sql",
    "67eed73ef55735f94a3b4727bd5bcd8479b678d6b61f0ebb7c2d7d46d3bf9c7e",
  ],
  [
    "packages/db/migrations/0028_operator_case_inbox.sql",
    "ae71d45564466e71f3efa4c3c96227d28ea21af2483ff1c2c14b60210ba22d4c",
  ],
  [
    "packages/db/migrations/0029_client_catalog_requests.sql",
    "5f0e0ac72df3021946dcad4215137aba3d0724d4c8e4fb9d74767e31e920bb8c",
  ],
  [
    "packages/db/migrations/0030_client_sessions.sql",
    "01b13ed88582144faefad2fb0ca4e4ec0767ed25d3b6ebddb357a78e2250b31a",
  ],
  [
    "packages/db/migrations/0031_client_booking_references.sql",
    "b625de5a14c3aa542116b4ad7c88df6ddeab99b893fdbda83bca0f6d8c1f4529",
  ],
  [
    "packages/db/migrations/0032_commercial_core_v2_a1.sql",
    "e70a77073e08bb15b4ad37dc49b75842bf8ff4284f9e062c5302a54bc7ba8a6d",
  ],
  [
    "packages/db/migrations/0033_expert_referral_maturity_a2.sql",
    "dd263b77ae2e8dde0ebe8bde6a3ce1886858c2e465afe0df8857323845e48746",
  ],
  [
    "packages/db/migrations/0034_hybrid_message_gateway_b1.sql",
    "b7b8136238d8533f641887c0fccf33cc2021f67c1046f0e4cf540200abcff456",
  ],
  [
    "packages/db/migrations/0035_hybrid_message_gateway_b2.sql",
    "90ff0fd219c2ec882919d7328089950e69920fd4eede30000484080ab9c0b205",
  ],
  [
    "packages/db/migrations/0036_selarti_budget_controls_b3.sql",
    "233680aade58a86cfcbb46197ba4281158812c4bd370c9f8acf40b4c5ecce4df",
  ],
  [
    "packages/db/migrations/0037_partner_commerce_a.sql",
    "922701d401fc6ca39f4c71d914f00477faf587078d1e38e02a3afbc4fc86d4f2",
  ],
  [
    "packages/db/migrations/0038_test_expert_trial.sql",
    "beb9358660e430821ea3881d7bd301310bcd239688e11970fe3cc07b5ee3c957",
  ],
  [
    "packages/db/migrations/0071_lifecycle_scheduler_c1.sql",
    "32f260d7e4dcbc73a490266165156bf525ab0aa6aa7bd2496ee65bec1a18b71d",
  ],
  [
    "packages/db/migrations/0072_booking_waitlist_d1.sql",
    "22822e0fa1c386b72f345e63f508b53a07e65210434259d65ef501f041b9d7b8",
  ],
  [
    "packages/db/migrations/0073_booking_reschedule_replay.sql",
    "6b8f79dbf68e2150d0dce0b95302662389375c6c93ee194760403569f06042ed",
  ],
  [
    "packages/db/migrations/0039_consent_evidence_grant.sql",
    "1da4691ba27f4e22bc84346cc367b820d4f12280fcb1f04077f75111bc5b2e0f",
  ],
  [
    "packages/db/migrations/meta/_journal.json",
    "b0d18cfa79d43f40aad82d9a4327e09770dea4074105b8ec36bf293384c588fb",
  ],
  [
    "packages/db/migrations/meta/0000_snapshot.json",
    "a14d4d2de4fb32d36e2e84e55ad57e8f3cee59dad903adb6f68036ac6b54b8a8",
  ],
  [
    "packages/db/migrations/meta/0001_snapshot.json",
    "8e2d5febb23b7017ecf0de19acb4b7207d32e47ddd66af72586b030a4146f71b",
  ],
  [
    "packages/db/migrations/meta/0002_snapshot.json",
    "0af1d4abb7f505136cbd36239d6fcb2a44de9bd479f613f8aa2b9a663506c7e8",
  ],
  [
    "packages/db/migrations/meta/0003_snapshot.json",
    "d4682f177711765f3a54f7018657617657470efc18aa8b4e74fcf0cf0e9ddc68",
  ],
  [
    "packages/db/migrations/meta/0004_snapshot.json",
    "64f8c016d7f457ae75744666880efda6c2e30f8554d4a36844d0dd418bc22ae0",
  ],
  [
    "packages/db/migrations/meta/0005_snapshot.json",
    "c4f244df4c1ab894d37522cf0bb140cadb262124c17bfeee4b5570a29bd9dbc8",
  ],
  [
    "packages/db/migrations/meta/0006_snapshot.json",
    "3feec1d2443b1ae9e6b8e6d03fb41a7fb6d6ee0995adfd63650cfc062d487df5",
  ],
  [
    "packages/db/migrations/meta/0007_snapshot.json",
    "4c589a340cdd27dde006965ebe4abcb35e3ef5d81f2e564ad34385d99e1b115e",
  ],
  [
    "packages/db/migrations/meta/0008_snapshot.json",
    "70a79a380f0cd1476b9630700cca47dae309e4441ad37fb8ca38ae6c9c8c9b3a",
  ],
  [
    "packages/db/migrations/meta/0009_snapshot.json",
    "9baef30564ea5f3ac9b4fce898a8290e625bba601bfaf1a87bc25a44ad208e59",
  ],
  [
    "packages/db/migrations/meta/0010_snapshot.json",
    "3ed7aec9d82f66e55c47fcb644dc04816d94c05a74a4dabd71fe749683eae0a8",
  ],
  [
    "packages/db/migrations/meta/0011_snapshot.json",
    "06c3b7b0aec9f3acfd260ac6f0d4ca261ddb41c2ed45993577c0b8753dbdc6e6",
  ],
  [
    "packages/db/migrations/meta/0012_snapshot.json",
    "f8ceccd525ca144dd160976b487acd41116ffcfde65ff630d92003928a49b045",
  ],
  [
    "packages/db/migrations/meta/0013_snapshot.json",
    "162528fc521552603321ee76c0cce5afa8ea558ace356f3fd0b69065ba511923",
  ],
  [
    "packages/db/migrations/meta/0015_snapshot.json",
    "201253c5d75b93fb1e3b483d91e4dbc2cedeab93912f029b681a92ea3cb82ebb",
  ],
  [
    "packages/db/migrations/meta/0016_snapshot.json",
    "e1b95f18854218f2a1e9376d03988e132f8bed6ea5f7969321a3e3be4566d9ef",
  ],
  [
    "packages/db/migrations/meta/0017_snapshot.json",
    "42dd577fe90276a165e03294701ea22ad799cfdd5e631e69d94b5008a9bcb903",
  ],
  [
    "packages/db/migrations/meta/0018_snapshot.json",
    "83da1296cdc198313c219a968c6f66caa7503b745a6429fc2e34feab70eaeb37",
  ],
  [
    "packages/db/migrations/meta/0021_snapshot.json",
    "e62da7882f0319512589b1bf0ad88f44f69e6ec1e29d89b299b2e9aafd44ec16",
  ],
  [
    "packages/db/migrations/meta/_journal.json",
    "b0d18cfa79d43f40aad82d9a4327e09770dea4074105b8ec36bf293384c588fb",
  ],
]);
const approvedDatabaseRelations = new Set([
  // Exact correction inventory; docs/spec/residency-offer-corrections-guard-registration.md.
  "expert_application_material_jobs",
  "expert_application_promo_confirmations",
  "expert_application_promo_proofs",
  "expert_main_activation_admissions",
  "expert_manager_telegram_callbacks",
  "expert_manager_telegram_notifications",
  "expert_manager_telegram_pairings",
  "expert_offer_profile_verifications",
  "expert_offer_profiles",
  "expert_offer_schedules",
  "expert_personal_offer_notices",
  "expert_personal_offer_state",
  "expert_promo_ready_logs",
  "expert_space_tariff_approvals",

  // BlockD calendar lifecycle; docs/spec/phase1-block-d-guard-registration.md.
  "expert_residency_lifecycle",
  "expert_residency_renewal_bills",
  "expert_residency_lifecycle_audits",
  "expert_residency_lifecycle_notices",
  "expert_residency_renewal_attempts",
  // BlockC card/publication contract; docs/spec/phase1-block-c-guard-registration.md.
  "expert_card_drafts",
  "expert_card_entries",
  "expert_card_reviews",
  "expert_card_material_templates",
  "expert_card_material_jobs",
  "expert_card_promo_proofs",
  "expert_card_promo_confirmations",
  "expert_card_handoffs",
  "expert_card_requests",
  "expert_card_staff_actions",
  "expert_card_consent_epoch",
  "expert_card_main_acceptances",
  "expert_card_main_orders",
  "expert_promo_qualification_audits",
  "experts_published",
  // Separate onboarding financial facts; docs/spec/phase1-block-b-guard-registration.md.
  "expert_verification_decisions",
  "expert_onboarding_invoices",
  "expert_onboarding_payment_operations",
  "expert_verification_work",
  "expert_onboarding_payment_facts",
  // Nonfinancial acquisition only; BlockA registration rationale is versioned.
  "expert_promo_codes",
  "expert_promo_registrations",
  "expert_promo_requests",
  "expert_promo_guide_work",
  "expert_promo_bonus_indications",
  "expert_promo_manager_work",
  "expert_promo_enrollments",
  "expert_onboarding_applications",
  "admin_case_actions",
  "admin_approvals",
  "admin_object_assignments",
  "admin_role_assignments",
  "admin_sessions",
  "audit_events",
  "channel_identities",
  "client_booking_erasure_work",
  "client_booking_receipts",
  "booking_reschedule_facts",
  "booking_waitlist_command_receipts",
  "booking_waitlist_entries",
  "client_catalog_choices",
  "client_catalog_erasure_index",
  "client_catalog_requests",
  "client_catalog_snapshots",
  "client_catalog_tombstones",
  "client_identity_proof_receipts",
  "client_erasure_requests",
  "expert_telegram_residency_callbacks",
  "client_profiles",
  "client_session_booking_grants",
  "client_sessions",
  "consent_document_versions",
  "consent_presentations",
  "consent_states",
  "consents",
  "conversation_messages",
  "conversations",
  "dead_letters",
  "delivery_attempts",
  "expert_services",
  "experts",
  "feedback",
  "human_escalations",
  "integration_errors",
  "integration_inbox",
  "integration_outbox",
  "message_events",
  "message_ledger_entries",
  "message_packages",
  "notifications",
  "outbox_operator_alerts",
  "package_balances",
  "privacy_deletion_jobs",
  "privacy_deletion_manifests",
  "privacy_processor_attempts",
  "privacy_retention_items",
  "projection_checkpoints",
  "prompt_versions",
  "provider_cursors",
  "provider_subject_mappings",
  "reconciliation_mismatches",
  "reconciliation_runs",
  "reservations",
  "safety_incidents",
  "slots",
  "users",
  "webhook_inbox",
  ...EXPERT_RESIDENCY_ALLOWED_RELATIONS,
  ...SANDBOX_PAYMENT_ALLOWED_RELATIONS,
]);

const forbiddenProviderContent =
  /\b(fetch|axios|stripe|yookassa|PAYMENT_API_KEY)\b/u;

const providerName =
  /^(?:@stripe\/|stripe(?:\/|$)|@yookassa\/|yookassa(?:\/|$)|@a2seven\/yoo-checkout(?:\/|$)|cloudpayments(?:\/|$)|paypal(?:\/|$)|@paypal\/|adyen(?:\/|$)|@adyen\/|square(?:\/|$)|@square\/)/iu;
const commercialDependencySegments = new Set([
  "billing",
  "checkout",
  "commerce",
  "merchant",
  "pay",
  "payment",
  "payments",
]);
const providerPath =
  /(?:^|\/)(?:commercial|commerce|stripe|yookassa|cloudpayments|paypal|adyen|square)(?:[-_.\/]|$)/iu;
const paymentIntegrationArtifact =
  /(?:^|\/)payments?(?:[-_](?:adapter|client|codec|gateway|provider|service))?(?:[-_.\/]|$)/iu;
const paymentApiPath = /(?:^|\/)(?:checkout|payments?|refunds?)(?:[-_.\/]|$)/iu;
const paymentApplicationPath =
  /(?:^|\/)(?:payments?(?:[-_].*)?|.*payment[-_](?:consumer|handler)|entitlement[-_]grant|settlement[-_]worker|checkout[-_].*(?:access|entitlement|grant))(?:[-_.\/]|$)/iu;
const paymentDbPath = /(?:^|\/)(?:payments?|refunds?|charges?)(?:[-_.\/]|$)/iu;
const commercialRoute =
  /\/(?:checkout|payments?|refunds?|stripe|yookassa)(?:\/|$)/iu;
const paymentApplicationIdentifier =
  /^(?:Payment\w*Consumer|\w*PaymentConsumer|grant\w*Entitlement\w*Payment|grant\w*Payment\w*Entitlement|Payment\w*EntitlementGrant|(?:Payment|Checkout|Refund)\w*Routes?)$/iu;
const paymentApiIdentifier =
  /^(?:payment|checkout|refund|stripe|yookassa)\w*Routes?$/iu;
const expertResidencyRoute =
  /^\/v1\/(?:(?:admin\/)?expert(?:-|\/)|webhooks\/telegram\/expert(?:-|\/))/u;
const expertResidencyFlag =
  /^(?:EXPERT_(?:REFERRAL|RESIDENCY|TELEGRAM|AI|VERIFICATION|DRAFT_TAGS)_|RESIDENT_WORKSPACE_)/u;
const expertResidencyAdminAction = /^(?:expert_referral|expert_residency)\./u;
const prohibitedCouponOrReferralModel =
  /(?:^|\/)(?:client-)?(?:coupon|referral)(?:[-_.\/]|$)/iu;
const sandboxFinancialAuthorityRelation =
  /\b(?:expert_first_residency_settlements|expert_referral_reward_grants|expert_referral_ledger_entries|expert_referral_ledger_allocations|expert_referral_balances|expert_residency_orders|expert_residency_payment_attempts|expert_residency_provider_event_inbox)\b/u;
const sandboxRelationToken = /\bsandbox_expert_residency_[a-z0-9_]+\b/iu;
const sandboxRelationTokens = /\bsandbox_expert_residency_[a-z0-9_]+\b/giu;

export interface PaymentScopeProbe {
  readonly path: string;
  readonly content: string;
}

const normalizePath = (path: string): string =>
  path.replaceAll("\\", "/").toLowerCase();

const isTestSource = (path: string): boolean =>
  /(?:^|\/)tests?\//u.test(path) ||
  /\.(?:test|spec|testkit)\.[cm]?[jt]sx?$/u.test(path);

const isExecutableAutomationPath = (path: string): boolean =>
  /\.(?:ps1|sh|bash|py|cmd|bat)$/u.test(path) ||
  /^\.github\/workflows\/.+\.(?:yml|yaml)$/u.test(path) ||
  /(?:^|\/)dockerfile(?:[._-].*)?$/u.test(path) ||
  /(?:^|\/)(?:docker-)?compose(?:\.[^/]+)?\.(?:yml|yaml)$/u.test(path);

const isVersionedBmadToolingPath = (path: string): boolean =>
  path.startsWith("_bmad/") || /^\.agents\/skills\/bmad-[^/]+\//u.test(path);

// Getzilla workflow tooling installed by `getzilla update`: its engine, hooks, root hook
// shims and helper scripts. Vendored like BMAD; it never ships with the product.
const GETZILLA_ROOT_HOOK_SHIMS = new Set([
  "session_start.py",
  "user_prompt_submit.py",
  "pre_tool_use.py",
  "post_tool_use.py",
  "pre_compact.py",
  "subagent_start.py",
  "subagent_stop.py",
  "stop_gate.py",
  "session_end.py",
]);

const isVersionedGetzillaToolingPath = (path: string): boolean =>
  path.startsWith(".getzilla/") ||
  path.startsWith(".grok/hooks/") ||
  /^scripts\/getzilla_[a-z_]+\.py$/u.test(path) ||
  GETZILLA_ROOT_HOOK_SHIMS.has(path);

// Exact reviewed deployment and CI discovery inventory.
const reviewedGatewayProvisionArtifacts = new Set([
  "tests/integration/resident-native-uuid-migration-state.test.ts",
  "packages/db/src/repositories/resident-native-uuid-sources.integration.test.ts",

  "scripts/experimental/yookassa_gateway/test_public_journey_reader_seam.py",
  "scripts/experimental/yookassa_gateway/test_public_dispatch.py",
  "scripts/experimental/yookassa_gateway/test_public_dispatch_response.py",
  "scripts/experimental/yookassa_gateway/test_public_provider_projection.py",

  "deploy/gateway-provision/sandbox-node-resolution.test.mjs",
  "scripts/early-bird-bridge/migration-tags.mjs",
  "scripts/early-bird-bridge/migration-tags.test.mjs",

  "apps/api/src/early-bird-bound-reconciliation.ts",
  "apps/api/src/early-bird-bound-reconciliation.test.ts",
  "apps/api/src/early-bird-discovery-pool.ts",
  "apps/api/src/early-bird-discovery-pool.test.ts",
  "packages/db/src/repositories/early-bird-bound-reconciliation.integration.test.ts",
  "apps/api/src/early-bird-gateway-bootstrap.ts",
  "apps/api/src/expert-early-bird-webhook-runtime.ts",
  "apps/api/src/server.ts",

  "deploy/gateway-provision/test_prepare_systemd_sandbox.sh",
  "deploy/gateway-provision/readme.md",
  "deploy/gateway-provision/prepare-bounded-handoff.test.mjs",
  "deploy/gateway-provision/prepare-code-publication.test.mjs",
  "deploy/gateway-provision/prepare-code-selector.test.mjs",
  "deploy/gateway-provision/prepare-native.mjs",
  "deploy/gateway-provision/prepare-native.test.mjs",
  "deploy/gateway-provision/prepare-timeout.test.mjs",
  "deploy/gateway-provision/prepare-units.test.mjs",
  "deploy/gateway-provision/prepare_gateway.py",
  "deploy/gateway-provision/sysusers.conf",
  "deploy/gateway-provision/test_prepare_gateway.py",
  "deploy/gateway-provision/test_prepare_gateway_bad_marker.py",
  "deploy/gateway-provision/test_prepare_gateway_cross_uid.sh",
  "deploy/gateway-provision/tmpfiles.conf",
  "deploy/systemd/ii-tonya-yookassa-gateway.service",
  "deploy/systemd/ii-tonya-early-bird-prepare.service",
  "deploy/systemd/ii-tonya-migrate.service.d/30-early-bird-prepare.conf",
  "pyproject.toml",
  "tests/repo/python-ci-discovery.test.ts",
]);

export const isPaymentScopeInspectionPath = (rawPath: string): boolean => {
  const path = normalizePath(rawPath);
  if (reviewedGatewayProvisionArtifacts.has(path)) return true;
  if (
    path === "engineering/opengrep-reviewed-observations.json" ||
    path === "trivy.yaml" ||
    path === ".getzilla/templates/ci/github-actions-verify.yml"
  )
    return true;
  if (isVersionedBmadToolingPath(path)) return false;
  if (isVersionedGetzillaToolingPath(path)) return false;
  if (path.endsWith("/package.json") || path === "package.json") return true;
  if (
    /^packages\/db\/migrations\/.+\.(?:sql|json)$/u.test(path) ||
    SANDBOX_PAYMENT_ALLOWED_MIGRATION_PATHS.has(path) ||
    path.endsWith(".sql")
  ) {
    return true;
  }
  if (isExecutableAutomationPath(path)) return true;
  return /\.[cm]?[jt]sx?$/u.test(path) && !isTestSource(path);
};

const hasCommercialDependencySegment = (value: string): boolean =>
  providerName.test(value) ||
  value
    .toLowerCase()
    .split(/[@/_-]+/u)
    .some((segment) => commercialDependencySegments.has(segment));

const isCommercialProviderSpecifier = (value: string): boolean =>
  !value.startsWith(".") && hasCommercialDependencySegment(value);

const isApprovedSandboxRuntimeImport = (
  path: string,
  specifier: string,
): boolean =>
  path.startsWith("apps/sandbox-api/") &&
  specifier === "@ii-tonya/sandbox-payments";

const sandboxObjectTypePaths = new Set([
  "apps/sandbox-api/src/routes.ts",
  "packages/db/src/repositories/admin-repository.ts",
  "packages/sandbox-payments/src/workflow.ts",
]);

const literalText = (node: ts.Expression | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

const callMethodName = (
  expression: ts.LeftHandSideExpression,
): string | undefined => {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) {
    return literalText(expression.argumentExpression);
  }
  return undefined;
};

const routeFromCall = (node: ts.CallExpression): string | undefined => {
  const method = callMethodName(node.expression);
  if (!method) return undefined;
  if (["get", "post", "put", "patch", "delete", "use"].includes(method)) {
    return literalText(node.arguments[0]);
  }
  if (method !== "route") return undefined;
  const options = node.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  for (const property of options.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === "url") ||
        (ts.isStringLiteral(property.name) && property.name.text === "url"))
    ) {
      return literalText(property.initializer);
    }
  }
  return undefined;
};

const isApprovedPaymentBoundaryImport = (
  path: string,
  specifier: string,
): boolean =>
  (path === "packages/integrations/src/index.ts" &&
    [
      "./payment/disabled-payment-adapter.js",
      "./payment/payment-port.js",
      "./expert-residency/disabled-payment-adapter.js",
      "./expert-residency/payment-port.js",
      "./expert-residency/verified-event.js",
      "./projections/make-projection-sink.js",
      "./projections/projection-port.js",
    ].includes(specifier)) ||
  (path === "packages/integrations/src/payment/disabled-payment-adapter.ts" &&
    specifier === "./payment-port.js") ||
  (path ===
    "packages/integrations/src/expert-residency/disabled-payment-adapter.ts" &&
    specifier === "./payment-port.js") ||
  (path === "packages/integrations/src/yookassa/payment-adapter.ts" &&
    specifier === "../expert-residency/payment-port.js") ||
  (path === "packages/integrations/src/index.ts" &&
    specifier.startsWith("./yookassa/"));

const isNetworkCall = (node: ts.CallExpression): boolean => {
  if (ts.isIdentifier(node.expression)) {
    return /^(?:fetch|request)$/u.test(node.expression.text);
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const owner = node.expression.expression;
  return (
    ts.isIdentifier(owner) && /^(?:axios|http|https|undici)$/u.test(owner.text)
  );
};

const moduleSpecifierFromCall = (
  node: ts.CallExpression,
): string | undefined => {
  if (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require")
  ) {
    return literalText(node.arguments[0]);
  }
  return undefined;
};

const processEnvKey = (
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined => {
  const expression = node.expression;
  if (
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "process" ||
    expression.name.text !== "env"
  ) {
    return undefined;
  }
  return ts.isPropertyAccessExpression(node)
    ? node.name.text
    : literalText(node.argumentExpression);
};

const isPaymentCredentialKey = (key: string): boolean =>
  /^PAYMENTS?_(?:API_?KEY|TOKEN|SECRET|WEBHOOK_SECRET|BASE_URL|PROVIDER)$/u.test(
    key,
  ) || /^YOOKASSA_(?:SHOP_ID|SECRET_KEY|SECRET_REF)$/u.test(key);

const isCommercialNetworkTarget = (target: string): boolean =>
  /(?:^|[/:._-])(?:pay|payment|payments|checkout|billing|merchant|commerce)(?:[/:._-]|$)/iu.test(
    target,
  );

const isPaymentApplicationIdentifier = (identifier: string): boolean => {
  if (paymentApplicationIdentifier.test(identifier)) return true;
  const normalized = identifier.toLowerCase();
  return (
    /^settlement\w*worker$/u.test(normalized) ||
    (normalized.includes("checkout") &&
      /(?:access|entitlement|grant)/u.test(normalized))
  );
};

const inspectTypeScript = (
  path: string,
  content: string,
  violations: string[],
): void => {
  const source = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const isReviewedDomHarness =
    reviewedDomHarnessHashes.get(path) ===
    createHash("sha256")
      .update(content.replace(/\r\n?/gu, "\n"), "utf8")
      .digest("hex");

  // Fold bounded local constants, failing closed on unknown or shadowed names.
  // Production currently has no executable dynamic imports; literal public
  // modules remain valid, while computed unresolved authority cannot evade review.
  const constants = new Map<string, ts.Expression | undefined>();
  const destructuredLoaderBindings = new Map<string, ts.Expression[]>();
  const collectConstants = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const isConst =
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0;
      constants.set(
        node.name.text,
        constants.has(node.name.text)
          ? undefined
          : isConst
            ? node.initializer
            : undefined,
      );
    }
    if (
      (ts.isParameter(node) || ts.isBindingElement(node)) &&
      ts.isIdentifier(node.name)
    ) {
      constants.set(node.name.text, undefined);
      if (
        ts.isBindingElement(node) &&
        ts.isObjectBindingPattern(node.parent) &&
        ts.isVariableDeclaration(node.parent.parent) &&
        node.parent.parent.initializer &&
        (node.propertyName && ts.isIdentifier(node.propertyName)
          ? node.propertyName.text
          : node.name.text) === "createRequire"
      ) {
        const bindings = destructuredLoaderBindings.get(node.name.text) ?? [];
        bindings.push(node.parent.parent.initializer);
        destructuredLoaderBindings.set(node.name.text, bindings);
      }
    }
    ts.forEachChild(node, collectConstants);
  };
  collectConstants(source);
  const resolveModule = (
    node: ts.Expression | undefined,
    seen = new Set<string>(),
    depth = 0,
  ): string | undefined => {
    if (!node || depth > 20) return undefined;
    const literal = literalText(node);
    if (literal !== undefined) return literal;
    if (ts.isParenthesizedExpression(node))
      return resolveModule(node.expression, seen, depth + 1);
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      return resolveModule(
        constants.get(node.text),
        new Set([...seen, node.text]),
        depth + 1,
      );
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = resolveModule(node.left, seen, depth + 1);
      const right = resolveModule(node.right, seen, depth + 1);
      return left === undefined || right === undefined
        ? undefined
        : left + right;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const part = resolveModule(span.expression, seen, depth + 1);
        if (part === undefined) return undefined;
        value += part + span.literal.text;
      }
      return value;
    }
    return undefined;
  };

  const nodeLoaderImports = new Map<string, "factory" | "module">();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !["node:module", "module"].includes(statement.moduleSpecifier.text)
    )
      continue;
    const clause = statement.importClause;
    if (clause?.name) nodeLoaderImports.set(clause.name.text, "module");
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      nodeLoaderImports.set(bindings.name.text, "module");
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === "createRequire") {
          nodeLoaderImports.set(element.name.text, "factory");
        }
      }
    }
  }
  type LoaderKind = "require" | "factory" | "module";
  const loaderKind = (
    node: ts.Expression | undefined,
    seen = new Set<string>(),
    depth = 0,
  ): LoaderKind | undefined => {
    if (!node || depth > 20) return undefined;
    if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))
      return loaderKind(node.expression, seen, depth + 1);
    if (ts.isIdentifier(node)) {
      if (node.text === "require") return "require";
      if (seen.has(node.text)) return undefined;
      const imported = nodeLoaderImports.get(node.text);
      if (imported) return imported;
      for (const initializer of destructuredLoaderBindings.get(node.text) ??
        []) {
        if (
          loaderKind(initializer, new Set([...seen, node.text]), depth + 1) ===
          "module"
        )
          return "factory";
      }
      return loaderKind(
        constants.get(node.text),
        new Set([...seen, node.text]),
        depth + 1,
      );
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const property = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : resolveModule(node.argumentExpression);
      if (
        property === "require" &&
        ((ts.isIdentifier(node.expression) &&
          ["module", "globalThis", "global"].includes(node.expression.text)) ||
          loaderKind(node.expression, seen, depth + 1) === "module")
      )
        return "require";
    }
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      (ts.isPropertyAccessExpression(node)
        ? node.name.text
        : resolveModule(node.argumentExpression)) === "createRequire" &&
      loaderKind(node.expression, seen, depth + 1) === "module"
    )
      return "factory";
    if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ["node:module", "module"].includes(
          resolveModule(node.arguments[0]) ?? "",
        )
      )
        return "module";
      const kind = loaderKind(node.expression, seen, depth + 1);
      if (kind === "factory") return "require";
      if (
        kind === "require" &&
        ["node:module", "module"].includes(
          resolveModule(node.arguments[0]) ?? "",
        )
      )
        return "module";
    }
    return undefined;
  };

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    content,
  );
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    for (const match of scanner
      .getTokenText()
      .matchAll(sandboxRelationTokens)) {
      const relationName = match[0].toLowerCase();
      if (
        relationName === "sandbox_expert_residency_payment" &&
        sandboxObjectTypePaths.has(path)
      ) {
        continue;
      }
      if (SANDBOX_PAYMENT_RELATION_SOURCE_PATHS.has(path)) {
        if (!SANDBOX_PAYMENT_ALLOWED_RELATIONS.has(relationName)) {
          violations.push(
            `unknown sandbox relation in approved sandbox source: ${relationName}`,
          );
        }
      } else {
        violations.push(
          "sandbox relation token outside approved sandbox paths",
        );
      }
    }
  }

  if (
    EXPERT_RESIDENCY_ALLOWED_PATHS.has(path) &&
    forbiddenProviderContent.test(content)
  ) {
    violations.push("forbidden provider content in expert residency boundary");
  }
  if (
    SANDBOX_PAYMENT_ALLOWED_PATHS.has(path) &&
    sandboxFinancialAuthorityRelation.test(content)
  ) {
    violations.push("sandbox source references a financial authority relation");
  }

  if (path === "packages/integrations/src/index.ts") {
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement)) {
        violations.push("unapproved runtime declaration in integrations index");
      }
    }
  } else if (path === "packages/integrations/src/payment/payment-port.ts") {
    const allowedInterfaces = new Set([
      "CreateCheckoutCommand",
      "PaymentPort",
      "PaymentWebhookCommand",
      "RefundCommand",
    ]);
    for (const statement of source.statements) {
      if (
        !ts.isInterfaceDeclaration(statement) ||
        !allowedInterfaces.has(statement.name.text)
      ) {
        violations.push("unapproved declaration in payment port");
      }
    }
  } else if (
    path === "packages/integrations/src/payment/disabled-payment-adapter.ts"
  ) {
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const importClause = statement.importClause;
        const bindings = importClause?.namedBindings;
        const importedNames =
          bindings && ts.isNamedImports(bindings)
            ? bindings.elements.map((element) => element.name.text)
            : [];
        if (
          !importClause?.isTypeOnly ||
          !bindings ||
          !ts.isNamedImports(bindings) ||
          importedNames.some(
            (name) =>
              ![
                "CreateCheckoutCommand",
                "PaymentPort",
                "PaymentWebhookCommand",
                "RefundCommand",
              ].includes(name),
          )
        ) {
          violations.push("unapproved import in disabled payment adapter");
        }
      } else if (
        !ts.isClassDeclaration(statement) ||
        !statement.name ||
        !["DisabledPaymentAdapter", "PaymentsDisabledError"].includes(
          statement.name.text,
        )
      ) {
        violations.push("unapproved declaration in disabled payment adapter");
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      isVerifierAuthorityModule(node.moduleReference.expression.text) &&
      !verifierAuthorityImporters.has(path)
    ) {
      violations.push(
        "internal verifier authority require alias outside trusted implementation",
      );
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (
        isVerifierAuthorityModule(specifier) &&
        (!verifierAuthorityImporters.has(path) || ts.isExportDeclaration(node))
      ) {
        violations.push(
          "internal verifier authority module outside trusted implementation",
        );
      }
      if (
        isCommercialProviderSpecifier(specifier) &&
        !isApprovedSandboxRuntimeImport(path, specifier)
      ) {
        violations.push(`provider SDK import: ${specifier}`);
      } else if (
        /(?:^|\/)payment(?:\/|[-_])/iu.test(specifier) &&
        !isApprovedPaymentBoundaryImport(path, specifier)
      ) {
        violations.push(
          `payment boundary import outside allowlist: ${specifier}`,
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const isRuntimeImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        loaderKind(node.expression) === "require";
      const specifier = isRuntimeImport
        ? resolveModule(node.arguments[0])
        : moduleSpecifierFromCall(node);
      if (isRuntimeImport && specifier === undefined && !isReviewedDomHarness) {
        violations.push(
          "unresolved runtime module import requires explicit review",
        );
      }
      if (
        specifier &&
        isVerifierAuthorityModule(specifier) &&
        !verifierAuthorityImporters.has(path)
      ) {
        violations.push(
          "internal verifier authority runtime import outside trusted implementation",
        );
      }
      if (specifier) {
        if (
          isCommercialProviderSpecifier(specifier) &&
          !isApprovedSandboxRuntimeImport(path, specifier)
        ) {
          violations.push(`payment provider runtime import: ${specifier}`);
        } else if (
          /(?:^|\/)payment(?:\/|[-_])/iu.test(specifier) &&
          !isApprovedPaymentBoundaryImport(path, specifier)
        ) {
          violations.push(
            `payment boundary runtime import outside allowlist: ${specifier}`,
          );
        }
      }
    }

    if (
      (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
      verifierAuthorityPrimitives.has(node.text) &&
      !verifierAuthorityImporters.has(path) &&
      path !==
        "packages/integrations/src/expert-residency/verified-event-internal.ts"
    ) {
      violations.push(
        "internal verifier primitive exposed outside trusted implementation",
      );
    }
    if (
      ts.isExportSpecifier(node) &&
      verifierAuthorityPrimitives.has((node.propertyName ?? node.name).text)
    ) {
      violations.push("internal verifier primitive re-export");
    }

    if (path.startsWith("apps/api/")) {
      if (ts.isCallExpression(node)) {
        const route = routeFromCall(node);
        if (
          route &&
          commercialRoute.test(route) &&
          !EXPERT_RESIDENCY_ALLOWED_ROUTES.has(route)
        ) {
          violations.push(`commercial API route: ${route}`);
        }
        if (
          route &&
          expertResidencyRoute.test(route) &&
          !EXPERT_RESIDENCY_ALLOWED_ROUTES.has(route)
        ) {
          violations.push(`unapproved expert residency API route: ${route}`);
        }
      }
      if (
        ts.isIdentifier(node) &&
        paymentApiIdentifier.test(node.text) &&
        path !== "apps/api/src/routes/yookassa-webhook.ts" &&
        !(
          path === "apps/api/src/app.ts" &&
          node.text === "yookassaWebhookRoutes"
        )
      ) {
        violations.push(`commercial API route identifier: ${node.text}`);
      }
    }

    if (
      path.startsWith("packages/application/") &&
      ts.isIdentifier(node) &&
      isPaymentApplicationIdentifier(node.text)
    ) {
      violations.push(`payment application identifier: ${node.text}`);
    }

    if (
      path.startsWith("packages/db/") &&
      ts.isCallExpression(node) &&
      /^(?:pgTable|mysqlTable|sqliteTable|pgView|pgMaterializedView)$/u.test(
        ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : "",
      )
    ) {
      const tableName = literalText(node.arguments[0]);
      if (tableName) {
        if (
          SANDBOX_PAYMENT_ALLOWED_RELATIONS.has(tableName) &&
          !SANDBOX_PAYMENT_ALLOWED_PATHS.has(path)
        ) {
          violations.push(
            `sandbox relation outside sandbox package: ${tableName}`,
          );
        } else if (!approvedDatabaseRelations.has(tableName)) {
          violations.push(`unapproved database relation: ${tableName}`);
        }
      }
    }

    if (ts.isCallExpression(node) && isNetworkCall(node)) {
      const target = literalText(node.arguments[0]);
      const literalOrigins = [
        ...content.matchAll(/https?:\/\/[^\s"'`]+/gu),
      ].map((match) => match[0]);
      const approvedYooKassaCall =
        (path === "packages/integrations/src/yookassa/client.ts" ||
          path === "packages/integrations/src/yookassa/held-onboarding.ts") &&
        ((target !== undefined &&
          target.startsWith("https://api.yookassa.ru/v3/")) ||
          (content.includes('const ORIGIN = "https://api.yookassa.ru"') &&
            literalOrigins.every(
              (origin) => origin === "https://api.yookassa.ru",
            )));
      if (
        !approvedYooKassaCall &&
        (approvedPaymentBoundaryPaths.has(path) ||
          EXPERT_RESIDENCY_ALLOWED_PATHS.has(path) ||
          (target !== undefined && isCommercialNetworkTarget(target)))
      ) {
        violations.push("payment provider network call");
      }
    }

    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const key = processEnvKey(node);
      if (
        key &&
        (approvedPaymentBoundaryPaths.has(path) || isPaymentCredentialKey(key))
      ) {
        violations.push(`payment credential environment access: ${key}`);
      }
      if (
        key &&
        expertResidencyFlag.test(key) &&
        !EXPERT_RESIDENCY_ALLOWED_FLAGS.has(key)
      ) {
        violations.push(`unapproved expert residency environment flag: ${key}`);
      }
    }

    if (
      ts.isStringLiteral(node) &&
      expertResidencyAdminAction.test(node.text) &&
      !EXPERT_RESIDENCY_ALLOWED_ADMIN_ACTIONS.has(node.text)
    ) {
      violations.push(`unapproved expert residency admin action: ${node.text}`);
    }

    if (
      path === "packages/integrations/src/payment/payment-port.ts" &&
      ts.isClassDeclaration(node)
    ) {
      violations.push("runtime class in payment port");
    }

    if (
      path ===
        "packages/integrations/src/payment/disabled-payment-adapter.ts" &&
      ts.isClassDeclaration(node) &&
      node.name &&
      !["DisabledPaymentAdapter", "PaymentsDisabledError"].includes(
        node.name.text,
      )
    ) {
      violations.push(`unapproved payment adapter class: ${node.name.text}`);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
};

const inspectPackageManifest = (
  path: string,
  content: string,
  violations: string[],
): void => {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch {
    violations.push("package manifest is not valid JSON");
    return;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    violations.push("package manifest is not an object");
    return;
  }

  const approvedDependencies = approvedPackageDependencies.get(path);
  for (const sectionName of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const section = (manifest as Record<string, unknown>)[sectionName];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }
    for (const dependency of Object.keys(section)) {
      const specifier = (section as Record<string, unknown>)[dependency];
      if (
        !approvedDependencies?.has(dependency) ||
        specifier !== approvedDependencySpecifiers.get(dependency)
      ) {
        violations.push(`unapproved package dependency: ${dependency}`);
      }
    }
  }
};

const inspectMigration = (
  path: string,
  content: string,
  violations: string[],
): void => {
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/--[^\r\n]*/gu, "");
  if (
    !SANDBOX_PAYMENT_ALLOWED_MIGRATION_PATHS.has(path) &&
    sandboxRelationToken.test(withoutComments)
  ) {
    violations.push("sandbox relation token outside approved sandbox paths");
  }

  if (
    paymentDbPath.test(path) &&
    !EXPERT_RESIDENCY_ALLOWED_MIGRATION_PATHS.has(path) &&
    !SANDBOX_PAYMENT_ALLOWED_MIGRATION_PATHS.has(path)
  ) {
    violations.push("commercial database migration path");
  }
  if (
    !path.startsWith("packages/db/migrations/") &&
    !SANDBOX_PAYMENT_ALLOWED_MIGRATION_PATHS.has(path)
  ) {
    return;
  }
  if (path.endsWith(".json")) {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(content);
    } catch {
      violations.push("database snapshot is not valid JSON");
      return;
    }
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return;
    }
    for (const sectionName of ["tables", "views"]) {
      const section = (snapshot as Record<string, unknown>)[sectionName];
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        continue;
      }
      for (const relation of Object.values(section)) {
        if (
          !relation ||
          typeof relation !== "object" ||
          Array.isArray(relation)
        ) {
          continue;
        }
        const name = (relation as Record<string, unknown>).name;
        if (typeof name === "string" && !approvedDatabaseRelations.has(name)) {
          violations.push(`unapproved database snapshot relation: ${name}`);
        }
      }
    }
    return;
  }

  for (const match of withoutComments.matchAll(
    /\bcreate\s+(?:materialized\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?(?:(?:"?[\w]+"?)\.)?"?([\w]+)"?/giu,
  )) {
    const relationName = match[1];
    if (relationName) {
      if (
        SANDBOX_PAYMENT_ALLOWED_RELATIONS.has(relationName) &&
        !SANDBOX_PAYMENT_ALLOWED_MIGRATION_PATHS.has(path)
      ) {
        violations.push(
          `sandbox migration relation outside sandbox package: ${relationName}`,
        );
      } else if (!approvedDatabaseRelations.has(relationName)) {
        violations.push(
          `unapproved database migration relation: ${relationName}`,
        );
      }
    }
  }
};

export const classifyPaymentScopeProbe = ({
  path: rawPath,
  content,
}: PaymentScopeProbe): readonly string[] => {
  const path = normalizePath(rawPath);

  const violations: string[] = [
    ...findSandboxProductionCompositionViolations({
      path: rawPath,
      content,
    }),
  ];
  if (path.startsWith("packages/integrations/")) {
    if (
      !approvedPaymentBoundaryPaths.has(path) &&
      !EXPERT_RESIDENCY_ALLOWED_PATHS.has(path) &&
      !YOOKASSA_PAYMENT_ALLOWED_PATHS.has(path) &&
      (providerPath.test(path) || paymentIntegrationArtifact.test(path))
    ) {
      violations.push("live or deferred payment integration path");
    }
    if (
      path.startsWith("packages/integrations/src/expert-residency/") &&
      !EXPERT_RESIDENCY_ALLOWED_PATHS.has(path)
    ) {
      violations.push("unapproved expert residency integration path");
    }
  } else if (path.startsWith("apps/api/") && paymentApiPath.test(path)) {
    violations.push("commercial API route path");
  } else if (
    path.startsWith("packages/application/") &&
    paymentApplicationPath.test(path)
  ) {
    violations.push("payment consumer or entitlement path");
  } else if (path.startsWith("packages/db/") && paymentDbPath.test(path)) {
    violations.push("commercial database schema path");
  } else if (
    path.startsWith("packages/sandbox-payments/src/") &&
    !SANDBOX_PAYMENT_ALLOWED_PATHS.has(path)
  ) {
    violations.push("unapproved sandbox payment source path");
  }

  if (
    path.startsWith("packages/domain/src/") &&
    prohibitedCouponOrReferralModel.test(path)
  ) {
    violations.push("commercial coupon or referral domain model path");
  }

  if (path.endsWith("/package.json") || path === "package.json") {
    inspectPackageManifest(path, content, violations);
  } else if (
    /^packages\/db\/migrations\/.+\.(?:sql|json)$/u.test(path) ||
    SANDBOX_PAYMENT_ALLOWED_MIGRATION_PATHS.has(path) ||
    path.endsWith(".sql")
  ) {
    inspectMigration(path, content, violations);
  } else if (/\.[cm]?[jt]sx?$/u.test(path)) {
    inspectTypeScript(path, content, violations);
  }

  return [...new Set(violations)].sort();
};

export const classifyApprovedTrackedScopeContent = ({
  path: rawPath,
  content,
}: PaymentScopeProbe): readonly string[] => {
  const path = normalizePath(rawPath);
  const isPackageManifest =
    path.endsWith("/package.json") || path === "package.json";
  const isMigration =
    path.startsWith("packages/db/migrations/") ||
    SANDBOX_PAYMENT_ALLOWED_MIGRATION_PATHS.has(path);
  const expectedHash =
    approvedPaymentBoundaryHashes.get(path) ??
    approvedMigrationHashes.get(path) ??
    approvedPackageManifestHashes.get(path) ??
    approvedAutomationArtifactHashes.get(path) ??
    reviewedDomHarnessHashes.get(path);
  if (!expectedHash) {
    if (isPackageManifest) return ["unapproved package manifest artifact path"];
    if (isMigration) return ["unapproved database migration artifact path"];
    if (isExecutableAutomationPath(path)) {
      return ["unapproved executable or automation artifact path"];
    }
    return [];
  }
  const normalizedContent = content.replace(/\r\n?/gu, "\n");
  const actualHash = createHash("sha256")
    .update(normalizedContent, "utf8")
    .digest("hex");
  return actualHash === expectedHash
    ? []
    : [`approved tracked scope hash mismatch: ${actualHash}`];
};

/** Full PG75 catalogue crossed 1 MiB; never broaden the general inspection bound.
 * Read callback is invoked only for this exact path and observed byte count;
 * original exact artifact hash still owns admission. */
export function isApprovedLargeScopeArtifact(
  path: string,
  bytes: number,
  read: () => string,
): boolean {
  const approvedSizes = new Map<string, number>([
    ["packages/db/migrations/meta/0085_snapshot.json", 1192800],
    ["packages/db/migrations/state/0085_sql_objects.json", 1876151],

    ["packages/db/migrations/meta/0084_snapshot.json", 1192800],
    ["packages/db/migrations/state/0084_sql_objects.json", 1876143],

    ["packages/db/migrations/state/0083_sql_objects.json", 1416389],
    ["packages/db/migrations/meta/0083_snapshot.json", 1166391],
    ["packages/db/migrations/state/0075_sql_objects.json", 1064832],
    ["packages/db/migrations/state/0076_sql_objects.json", 1075861],
    ["packages/db/migrations/state/0077_sql_objects.json", 1083552],
    ["packages/db/migrations/state/0078_sql_objects.json", 1087803],
    ["packages/db/migrations/state/0079_sql_objects.json", 1096357],
    ["packages/db/migrations/state/0080_sql_objects.json", 1108149],
    ["packages/db/migrations/meta/0081_snapshot.json", 1161986],
    ["packages/db/migrations/state/0081_sql_objects.json", 1380625],
    ["packages/db/migrations/meta/0082_snapshot.json", 1161986],
    ["packages/db/migrations/state/0082_sql_objects.json", 1398938],
  ]);
  if (approvedSizes.get(path) !== bytes) return false;
  const content = read();
  return (
    Buffer.byteLength(content, "utf8") === bytes &&
    createHash("sha256").update(content).digest("hex") ===
      approvedMigrationHashes.get(path)
  );
}
