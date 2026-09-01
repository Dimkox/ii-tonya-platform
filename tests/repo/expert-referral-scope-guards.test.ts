import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPERT_RESIDENCY_ALLOWED_ADMIN_ACTIONS,
  EXPERT_RESIDENCY_ALLOWED_FLAGS,
  EXPERT_RESIDENCY_ALLOWED_PATHS,
  EXPERT_RESIDENCY_ALLOWED_RELATIONS,
  EXPERT_RESIDENCY_ALLOWED_ROUTES,
  EXPERT_RESIDENCY_ALLOWED_RUNTIME_AUDIT_ACTIONS,
  classifyPaymentScopeProbe,
} from "./support/payment-scope-boundary.js";

describe("expert residency referral scope guards", () => {
  it("publishes only the reviewed provider-neutral boundary", () => {
    expect([...EXPERT_RESIDENCY_ALLOWED_PATHS]).toEqual(
      expect.arrayContaining([
        "packages/contracts/src/expert-residency.ts",
        "packages/integrations/src/expert-residency/payment-port.ts",
      ]),
    );
    expect([...EXPERT_RESIDENCY_ALLOWED_PATHS]).toEqual([
      "packages/contracts/src/expert-residency.ts",
      "packages/integrations/src/expert-residency/payment-port.ts",
      "packages/integrations/src/expert-residency/disabled-payment-adapter.ts",
      "packages/integrations/src/expert-residency/verified-event.ts",
      "packages/integrations/src/expert-residency/environment-secret-resolver.ts",
    ]);
    expect([...EXPERT_RESIDENCY_ALLOWED_RELATIONS]).toEqual([
      "expert_referral_code_batches",
      "expert_referral_codes",
      "expert_referrals",
      "expert_residency_tariff_versions",
      "expert_residency_orders",
      "expert_residency_payment_attempts",
      "expert_residency_provider_event_inbox",
      "expert_first_residency_settlements",
      "expert_referral_reward_grants",
      "expert_referral_ledger_entries",
      "expert_referral_ledger_allocations",
      "expert_referral_issuance_overrides",
      "expert_referral_abuse_holds",
      "expert_referral_feature_controls",
      "expert_referral_balances",
    ]);
    expect([...EXPERT_RESIDENCY_ALLOWED_ROUTES]).toEqual([
      "/v1/expert/referrals/redeem",
      "/v1/expert/referrals/summary",
      "/v1/expert/residency/quotes",
      "/v1/expert/residency/checkouts",
      "/v1/admin/expert-referrals/inventory",
      "/v1/admin/expert-referrals/*",
      "/v1/admin/expert-referrals/actions/:action/:objectId/approvals",
      "/v1/admin/expert-referrals/approvals/:approvalId/approve",
      "/v1/admin/expert-referrals/actions/:action/:objectId/execute",
      "/v1/admin/expert-referrals/inviters/:inviterExpertId/inventory",
    ]);
    expect([...EXPERT_RESIDENCY_ALLOWED_FLAGS]).toEqual([
      "EXPERT_REFERRAL_ENABLED",
      "EXPERT_RESIDENCY_BILLING_ENABLED",
      "EXPERT_REFERRAL_HMAC_KEY_VERSION",
      "EXPERT_REFERRAL_HMAC_KEY_REF",
      "EXPERT_REFERRAL_HMAC_KEYS_JSON",
    ]);
    expect([...EXPERT_RESIDENCY_ALLOWED_ADMIN_ACTIONS]).toEqual([
      "expert_referral.batch_generate",
      "expert_referral.code_revoke",
      "expert_referral.issuance_override",
      "expert_referral.abuse_hold_open",
      "expert_referral.abuse_hold_close",
      "expert_referral.hold_replay",
      "expert_referral.feature_switch",
      "expert_residency.tariff_create",
      "expert_residency.tariff_retire",
    ]);
    expect([...EXPERT_RESIDENCY_ALLOWED_RUNTIME_AUDIT_ACTIONS]).toEqual([
      "expert_residency.charged_back",
      "expert_residency.expired",
      "expert_residency.held_reward_replayed",
      "expert_residency.refunded",
      "expert_residency.settled",
    ]);
  });

  it.each([
    [
      "an unlisted expert residency integration",
      "packages/integrations/src/expert-residency/live-provider.ts",
      'export const send = () => fetch("https://provider.invalid")',
    ],
    [
      "an unlisted expert residency contract sibling",
      "packages/contracts/src/expert-residency-copy.ts",
      "export interface ExpertResidencyPaymentPort {}",
    ],
    [
      "provider content inside the named boundary",
      "packages/integrations/src/expert-residency/payment-port.ts",
      'export const send = () => fetch("https://provider.invalid")',
    ],
    [
      "client coupon commercial bypass",
      "packages/domain/src/client-coupon.ts",
      "export const coupon500 = 500",
    ],
    [
      "a case-variant expert referral domain sibling",
      "packages/domain/src/Expert-Referral.ts",
      "export const bypass = () => 0n;",
    ],
    [
      "an unreviewed expert referral route",
      "apps/api/src/routes/expert-referrals.ts",
      'fastify.post("/v1/expert/referrals/export", handler);',
    ],
    [
      "an unreviewed expert referral feature flag",
      "packages/config/src/expert-referrals.ts",
      "export const enabled = process.env.EXPERT_REFERRAL_EXPORT_ENABLED;",
    ],
    [
      "an unreviewed expert referral admin action",
      "packages/application/src/expert-referrals.ts",
      'export const action = "expert_referral.export";',
    ],
    [
      "an unreviewed expert referral admin action in a template literal",
      "packages/application/src/expert-referrals.ts",
      "export const action = `expert_referral.export`;",
    ],
    [
      "an unreviewed expert residency audit action",
      "packages/db/src/repositories/expert-residency-provider-inbox-repository.ts",
      `class SettlementAudit {
        private auditAndOutbox(result: { kind: "refunded" | "expired" }) {
          const action = result.kind === "refunded"
            ? "expert_residency.refunded"
            : "expert_residency.expired";
          return action;
        }
      }`,
    ],
    [
      "a settlement audit label in an admin-command module",
      "packages/application/src/expert-residency.ts",
      `class SettlementAudit {
        private auditAndOutbox(result: { kind: "settled" | "expired" }) {
          const action = result.kind === "settled"
            ? "expert_residency.settled"
            : "expert_residency.expired";
          return action;
        }
      }`,
    ],
    [
      "a settlement audit label outside the repository audit method",
      "packages/db/src/repositories/expert-residency-provider-inbox-repository.ts",
      'export const action = "expert_residency.settled";',
    ],
    [
      "a settlement audit label in a shadow repository class",
      "packages/db/src/repositories/expert-residency-provider-inbox-repository.ts",
      `class ShadowSettlementAudit {
        private auditAndOutbox(result: { kind: "settled" | "expired" }) {
          const action = result.kind === "settled"
            ? "expert_residency.settled"
            : "expert_residency.expired";
          return action;
        }
      }`,
    ],
    [
      "a settlement audit label in a nested same-name repository class",
      "packages/db/src/repositories/expert-residency-provider-inbox-repository.ts",
      `function hiddenAuditContext() {
        class PostgresExpertResidencyProviderInboxRepository {
          private auditAndOutbox(result: { kind: "settled" | "expired" }) {
            const action = result.kind === "settled"
              ? "expert_residency.settled"
              : "expert_residency.expired";
            return action;
          }
        }
        return PostgresExpertResidencyProviderInboxRepository;
      }`,
    ],
    [
      "a settlement audit label in a nested class static block",
      "packages/db/src/repositories/expert-residency-provider-inbox-repository.ts",
      `class PostgresExpertResidencyProviderInboxRepository {
        private auditAndOutbox(result: { kind: "settled" | "expired" }) {
          class HiddenAdminContext {
            static {
              const action = result.kind === "settled"
                ? "expert_residency.settled"
                : "expert_residency.expired";
              void action;
            }
          }
          return HiddenAdminContext;
        }
      }`,
    ],
    [
      "a settlement audit label in a nested class constructor",
      "packages/db/src/repositories/expert-residency-provider-inbox-repository.ts",
      `class PostgresExpertResidencyProviderInboxRepository {
        private auditAndOutbox(result: { kind: "settled" | "expired" }) {
          class HiddenAdminContext {
            constructor() {
              const action = result.kind === "settled"
                ? "expert_residency.settled"
                : "expert_residency.expired";
              void action;
            }
          }
          return HiddenAdminContext;
        }
      }`,
    ],
    [
      "an unreviewed expert referral feature flag destructured from process.env",
      "packages/config/src/expert-referrals.ts",
      "const { EXPERT_REFERRAL_EXPORT_ENABLED } = process.env;",
    ],
    [
      "an unreviewed expert referral relation",
      "packages/db/src/schema/expert-referrals.ts",
      'export const records = pgTable("expert_referral_exports", {});',
    ],
  ])("rejects %s", (_label, path, content) => {
    expect(classifyPaymentScopeProbe({ path, content })).not.toEqual([]);
  });

  it("allows only the reviewed expert referral admin route surface", () => {
    expect(
      classifyPaymentScopeProbe({
        path: "apps/api/src/routes/expert-referral-admin.ts",
        content: readFileSync(
          "apps/api/src/routes/expert-referral-admin.ts",
          "utf8",
        ),
      }),
    ).toEqual([]);
  });

  it.each([
    [
      "the reviewed pure expert referral domain",
      "packages/domain/src/expert-referral.ts",
      "export const pureRule = () => 0n;",
    ],
    [
      "expert referral redemption route",
      "apps/api/src/routes/expert-referrals.ts",
      'fastify.post("/v1/expert/referrals/redeem", handler);',
    ],
    [
      "expert residency billing flag",
      "packages/config/src/expert-residency.ts",
      "export const enabled = process.env.EXPERT_RESIDENCY_BILLING_ENABLED;",
    ],
    [
      "expert referral code revocation action",
      "packages/application/src/expert-referrals.ts",
      'export const action = "expert_referral.code_revoke";',
    ],
    [
      "expert residency settlement and expiry audit actions",
      "packages/db/src/repositories/expert-residency-provider-inbox-repository.ts",
      `class PostgresExpertResidencyProviderInboxRepository {
        private auditAndOutbox(result: { kind: "settled" | "expired" }) {
          const action = result.kind === "settled"
            ? "expert_residency.settled"
            : "expert_residency.expired";
          return action;
        }
      }`,
    ],
    [
      "expert referral relation",
      "packages/db/src/schema/expert-referrals.ts",
      'export const records = pgTable("expert_referrals", {});',
    ],
  ])("allows reviewed %s", (_label, path, content) => {
    expect(classifyPaymentScopeProbe({ path, content })).toEqual([]);
  });
});
