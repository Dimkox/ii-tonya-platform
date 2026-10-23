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
  "packages/db/migrations/0039_consent_evidence_grant.sql",
  "packages/db/migrations/meta/0018_snapshot.json",
  "packages/db/migrations/meta/0021_snapshot.json",
  "packages/db/migrations/meta/_journal.json",
]);

export const EXPERT_RESIDENCY_ALLOWED_RELATIONS = new Set([
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
  "/v1/admin/expert-cards",
  "/v1/admin/expert-cards/:applicationId",
  "/v1/admin/expert-cards/:applicationId/public-card",
  "/v1/admin/expert-cards/:applicationId/review",
  "/v1/admin/expert-cards/:applicationId/promo-review",
  "/v1/admin/expert-verification",
  "/v1/admin/expert-verification/:applicationId",
  "/v1/admin/expert-verification/invoices/:invoiceId/checkout",
  "/v1/admin/expert-verification/:applicationId/decision",
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
    "packages/integrations/src/yookassa/onboarding-verifier.ts",
    "0c4867e541393854644eac11b2e7b8ac0221a3d183850f40a40d75763bda1b82",
  ],
  [
    "packages/integrations/src/yookassa/onboarding-webhook-capability.ts",
    "a6b8ec8649dcc9c8865630d610d466a64e8cf2d8afc072790befd99a05e32c13",
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
    "6ad654da46447e339f1beca611dece1279d2b76a13a64672b7fd40cad5431abb",
  ],
  [
    "packages/integrations/src/yookassa/payer-receipt-vault.ts",
    "189c14e45c2836ad9914719f937a0f3b966849d5933ac845b3a33dcf375134dd",
  ],
  [
    "packages/integrations/src/index.ts",
    "9d7150fd46a6a38d9a3968b6f551e96a70c5f5fbe671b0c22d513920f3b7e11f",
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
    "89a55569d5170d266f2c416963f26c023a11947917be6a102140f785e2173802",
  ],
  [
    "packages/integrations/src/yookassa/contracts.ts",
    "2f2dec6322fb43c669bcc2dcc1b2ba3a85ec39b740120034182b3d1a846556e0",
  ],
  [
    "packages/integrations/src/yookassa/exact-body-recovery.ts",
    "f1adc2c5e4d610f8d7977a0e048313ae44b8365ce3fe7247785544c6362e47f3",
  ],
  [
    "packages/integrations/src/yookassa/operation-port.ts",
    "1dbf7d327899b3366329da96b438b17fd50a18b7839bbf6c28313ddffe12fd64",
  ],
  [
    "packages/integrations/src/yookassa/receipt-contact-source.ts",
    "c41d94f0f85381b0265887e5c510854b3a0ca4a6d9f91b991e7c07d03d9be4dd",
  ],
  [
    "packages/integrations/src/yookassa/payment-adapter.ts",
    "1d7be29d640f6895983bfffc7b2db49d84855baac626dbdc8b46e5c4ff964bf2",
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
    "449a71ee2e260137f66e409824c7b940503a5227ddb2838b793ae2959eca555d",
  ],
  [
    "apps/api/package.json",
    "612edab1de19229840f06fe1cead61134e8ba5bba085bfb5a41a43540c68a51b",
  ],
  [
    "apps/web/package.json",
    "12a1b7ae68a27c1c79c816357e92a00b772385f1cc6e4877c33f7f271694def1",
  ],
  [
    "apps/worker/package.json",
    "8815b7494fbc0e1ccc7f1407f200d4b882328966267a9b34e6d76094cb15f41a",
  ],
  [
    "package.json",
    // Reviewed navigation increment: add the native Nginx proof entrypoint and
    // invoke it from verify:deploy. Existing scripts and dependency graph remain.
    "db3bc1f5f1d61883a1dfde9374f1411694c4746c5a0ed7f6dc28a153f80fcc02",
  ],
  [
    "packages/application/package.json",
    "594a48971ab05dbfb080ea5343e36193ee29113989f171f49392f87094c2629d",
  ],
  [
    "packages/config/package.json",
    "8d60e8bda20c29b9ff7d28ce0bd24265694ee09970ec020cc9e90cb4c1b72ffa",
  ],
  [
    "packages/contracts/package.json",
    "a516d484080039198439e6d4f035900b2d23252356d55896c4f63a36f5924eed",
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
    "e041afbaee8eacfd08b0ac94127f5fd181787713ffb89e56c6d33aa055d708df",
  ],
  [
    "packages/observability/package.json",
    "78c58e975d627f8cd9f632ca1a44f5a9c6709f62b518e2dc6eacb3b4ab918bca",
  ],
  [
    "packages/sandbox-payments/package.json",
    "b8426f19f7d6aeb30e5ffdb2d0e50af134d7445db11e4022eb2f00a378fbc495",
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
    "scripts/verify-client-web-account-browser.mjs",
    "02ffce350b89d5d89a50966693eb23cc14fd0caaf0dd2ed469ac07d5e8678e4d",
  ],
  [
    "scripts/verify-public-client-catalog-browser.mjs",
    "624d88eac52263707e442aee0c61802744c34d7e5cd8328acff2faeb1625839f",
  ],
]);

const approvedAutomationArtifactHashes = new Map([
  // Read-only owner backlog validator: inspect source coverage, task links and dependency DAG.
  [
    "_bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py",
    "c9fe761993a035ff74b6ce6c8469eab888bb4469e509e9e0c54423cc56977395",
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
    "f8157d9d0c23de1cf813f32664e702f25c06ec4f6cad0b2404808307b2cfd0b5",
  ],
  [
    // 87f6270 switched the release signature check to `cosign verify-blob --bundle` (the
    // artifact is a sigstore bundle, not a bare signature) and added `--retry-connrefused`
    // to the readiness probe, so a cold API start no longer aborts a good deployment.
    // Registering the new normalized-content hash instead of relaxing the rule.
    "scripts/deploy-native-remote.sh",
    "0a487419596c82cec0f386a85fff90fc6cc2ae228a97b09176a64b736bfb56eb",
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
    "ab01263f0edf37cb9eaf4502c5365b3b81002f4c761631359f41012bd98e76fc",
  ],
  [
    "deploy/systemd/ii-tonya-worker.service",
    "f507dedeaa04d0c39aad9fba03d9c90f3a2d280fcd31221d19caae87b6a3dc26",
  ],
  [
    "deploy/systemd/ii-tonya-migrate.service",
    "d2914b6ef210d94d42fa8f08c89c300c3f8dbe8a0637669ed3cc5e94ae785704",
  ],
  [
    "deploy/claw/dockerfile.test",
    "d69356b4769493c64c69d8f2e7d5dd178d7a408b0fa6b15cdeb856925b874ebe",
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
  // Pre-push gate: this repository has no hosted CI by its own policy
  // (workflow-semantics requires .github/workflows to be empty) and branch protection is
  // unavailable on the current plan, so these scripts are the only automatic check between a
  // commit and a push.
  [
    "scripts/pre-push-gate.sh",
    "435e4e1c4242f66acf18b22a5465f2e1413406cf1968530445781522ffb29ca6",
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
  ["packages/contracts/package.json", new Set(["zod"])],
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
    new Set(["@ii-tonya/contracts", "zod"]),
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
  ["@opentelemetry/api", "^1.9.0"],
  ["@opentelemetry/sdk-node", "^0.221.0"],
  ["@testcontainers/postgresql", "^10.28.0"],
  ["@types/node", "^24.0.0"],
  ["@types/pg", "^8.15.5"],
  ["@vitest/coverage-v8", "^3.2.4"],
  ["drizzle-kit", "^0.31.4"],
  ["drizzle-orm", "^0.45.2"],
  ["eslint", "^9.31.0"],
  ["fast-check", "^4.2.0"],
  ["fastify", "^5.12.5"],
  ["globals", "^14.0.0"],
  ["pg", "^8.16.3"],
  ["pino", "^9.7.0"],
  ["prettier", "^3.6.2"],
  ["tsup", "^8.5.0"],
  ["tsx", "^4.20.3"],
  ["typescript", "^5.8.3"],
  ["typescript-eslint", "^8.30.1"],
  ["vite", "^7.3.6"],
  ["vitest", "^3.2.4"],
  ["yaml", "^2.8.0"],
  ["zod", "^4.3.6"],
]);
const approvedMigrationHashes = new Map([
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
    "packages/db/migrations/0039_consent_evidence_grant.sql",
    "1da4691ba27f4e22bc84346cc367b820d4f12280fcb1f04077f75111bc5b2e0f",
  ],
  [
    "packages/db/migrations/meta/_journal.json",
    "64fb1f05732a4f17de1f9ea14ac1aba17cb17df1b93167e9470c5037637efa58",
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
    "64fb1f05732a4f17de1f9ea14ac1aba17cb17df1b93167e9470c5037637efa58",
  ],
]);
const approvedDatabaseRelations = new Set([
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
const expertResidencyRoute = /^\/v1\/(?:admin\/)?expert(?:-|\/)/u;
const expertResidencyFlag = /^EXPERT_(?:REFERRAL|RESIDENCY|TELEGRAM|AI)_/u;
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

export const isPaymentScopeInspectionPath = (rawPath: string): boolean => {
  const path = normalizePath(rawPath);
  if (isVersionedBmadToolingPath(path)) return false;
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
        path === "packages/integrations/src/yookassa/client.ts" &&
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
