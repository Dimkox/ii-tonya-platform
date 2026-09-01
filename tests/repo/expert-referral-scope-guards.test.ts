import { describe, expect, it } from "vitest";
import {
  EXPERT_RESIDENCY_ALLOWED_ADMIN_ACTIONS,
  EXPERT_RESIDENCY_ALLOWED_FLAGS,
  EXPERT_RESIDENCY_ALLOWED_MIGRATION_PATHS,
  EXPERT_RESIDENCY_ALLOWED_PATHS,
  EXPERT_RESIDENCY_ALLOWED_RELATIONS,
  EXPERT_RESIDENCY_ALLOWED_ROUTES,
  classifyPaymentScopeProbe,
} from "./support/payment-scope-boundary.js";

describe("expert residency referral scope boundary", () => {
  it("registers exactly the reviewed provider-neutral boundary", () => {
    expect([...EXPERT_RESIDENCY_ALLOWED_PATHS].sort()).toEqual([
      "packages/contracts/src/expert-residency.ts",
      "packages/integrations/src/expert-residency/disabled-payment-adapter.ts",
      "packages/integrations/src/expert-residency/environment-secret-resolver.ts",
      "packages/integrations/src/expert-residency/payment-port.ts",
      "packages/integrations/src/expert-residency/verified-event.ts",
    ]);
    expect([...EXPERT_RESIDENCY_ALLOWED_MIGRATION_PATHS].sort()).toEqual([
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
      "packages/db/migrations/0039_lifecycle_scheduler_c1.sql",
      "packages/db/migrations/0040_booking_waitlist_d1.sql",
      "packages/db/migrations/meta/0018_snapshot.json",
      "packages/db/migrations/meta/0021_snapshot.json",
      "packages/db/migrations/meta/_journal.json",
    ]);
    expect([...EXPERT_RESIDENCY_ALLOWED_RELATIONS].sort()).toEqual([
      "booking_reschedule_facts",
      "booking_waitlist_command_receipts",
      "booking_waitlist_entries",
      "client_commercial_policy_assignments",
      "client_commercial_policy_controls",
      "commercial_participants",
      "dialogue_deliveries",
      "dialogue_inbound",
      "dialogue_inbound_tombstones",
      "dialogue_route_decisions",
      "dialogues",
      "expert_ai_request_receipts",
      "expert_first_residency_settlements",
      "expert_referral_abuse_holds",
      "expert_referral_admin_execution_results",
      "expert_referral_balances",
      "expert_referral_code_batches",
      "expert_referral_codes",
      "expert_referral_feature_controls",
      "expert_referral_issuance_overrides",
      "expert_referral_ledger_allocations",
      "expert_referral_ledger_entries",
      "expert_referral_reward_grants",
      "expert_referral_reward_maturities",
      "expert_referrals",
      "expert_residency_orders",
      "expert_residency_payment_attempts",
      "expert_residency_provider_event_inbox",
      "expert_residency_provider_operations",
      "expert_residency_receipt_contacts",
      "expert_residency_tariff_versions",
      "expert_telegram_residency_callbacks",
      "lifecycle_jobs",
      "organization_profiles",
      "partner_command_receipts",
      "partner_shadow_quotes",
      "partner_tariff_policy_versions",
      "selarti_actual_usage_facts",
      "selarti_budget_alerts",
      "selarti_budget_policies",
      "selarti_cost_adjustments",
      "selarti_cost_reservations",
      "selarti_response_proposals",
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
    expect([...EXPERT_RESIDENCY_ALLOWED_ROUTES].sort()).toEqual([
      "/v1/admin/expert-referrals/inventory",
      "/v1/expert/assistant/messages",
      "/v1/expert/referrals/redeem",
      "/v1/expert/referrals/summary",
      "/v1/expert/residency/checkouts",
      "/v1/expert/residency/quotes",
      "/v1/expert/residency/tariffs",
      "/v1/webhooks/yookassa",
    ]);
    expect([...EXPERT_RESIDENCY_ALLOWED_FLAGS].sort()).toEqual([
      "EXPERT_AI_INGRESS_ENABLED",
      "EXPERT_REFERRAL_ENABLED",
      "EXPERT_REFERRAL_HMAC_KEYS_JSON",
      "EXPERT_REFERRAL_HMAC_KEY_REF",
      "EXPERT_REFERRAL_HMAC_KEY_VERSION",
      "EXPERT_RESIDENCY_BILLING_ENABLED",
      "EXPERT_TELEGRAM_CHECKOUT_ENABLED",
      "EXPERT_TELEGRAM_FINANCIAL_VIEWS_ENABLED",
      "EXPERT_TELEGRAM_QUERIES_ENABLED",
      "EXPERT_TELEGRAM_REFERRAL_ENABLED",
    ]);
    expect([...EXPERT_RESIDENCY_ALLOWED_ADMIN_ACTIONS].sort()).toEqual([
      "expert_referral.abuse_hold_close",
      "expert_referral.abuse_hold_open",
      "expert_referral.batch_generate",
      "expert_referral.code_revoke",
      "expert_referral.feature_switch",
      "expert_referral.hold_replay",
      "expert_referral.issuance_override",
      "expert_residency.sandbox_refund",
      "expert_residency.sandbox_settle",
      "expert_residency.tariff_create",
      "expert_residency.tariff_create_v2",
      "expert_residency.tariff_retire",
    ]);
  });

  it("allows only the reviewed expert residency boundary paths", () => {
    expect(
      classifyPaymentScopeProbe({
        path: "packages/integrations/src/expert-residency/payment-port.ts",
        content: "export interface PaymentPort {}",
      }),
    ).toEqual([]);
    expect(
      classifyPaymentScopeProbe({
        path: "packages/integrations/src/expert-residency/live-provider.ts",
        content: 'export const send = () => fetch("https://provider.invalid")',
      }),
    ).not.toEqual([]);
  });

  it("allows the disabled adapter contract but rejects network capability", () => {
    expect(
      classifyPaymentScopeProbe({
        path: "packages/integrations/src/expert-residency/disabled-payment-adapter.ts",
        content:
          'import type { PaymentPort } from "./payment-port.js"; export class DisabledPaymentAdapter {}',
      }),
    ).toEqual([]);
    expect(
      classifyPaymentScopeProbe({
        path: "packages/integrations/src/expert-residency/payment-port.ts",
        content:
          'export const send = () => https.get("https://provider.invalid");',
      }),
    ).not.toEqual([]);
  });

  it.each([
    [
      "unreviewed relation",
      "packages/db/src/schema/expert-referrals.ts",
      'export const records = pgTable("expert_referral_shadow", {});',
    ],
    [
      "unreviewed route",
      "apps/api/src/routes/expert-referrals.ts",
      'fastify.post("/v1/expert/referrals/override", handler);',
    ],
    [
      "unreviewed feature flag",
      "packages/config/src/expert-referrals.ts",
      "export const enabled = process.env.EXPERT_REFERRAL_SHADOW_ENABLED;",
    ],
    [
      "unreviewed expert AI feature flag",
      "packages/config/src/expert-ai.ts",
      "export const enabled = process.env.EXPERT_AI_SHADOW_ENABLED;",
    ],
    [
      "unreviewed expert Telegram feature flag",
      "packages/config/src/expert-telegram.ts",
      "export const enabled = process.env.EXPERT_TELEGRAM_SHADOW_ENABLED;",
    ],
    [
      "unreviewed admin action",
      "packages/application/src/expert-referrals.ts",
      'export const action = "expert_referral.shadow_override";',
    ],
    [
      "coupon commercial model",
      "packages/domain/src/client-coupon.ts",
      "export const coupon500 = 500;",
    ],
  ])("rejects %s", (_label, path, content) => {
    expect(classifyPaymentScopeProbe({ path, content })).not.toEqual([]);
  });
});
