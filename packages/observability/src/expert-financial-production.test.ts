import { metrics as apiMetrics } from "@opentelemetry/api";
import { metrics as sdkMetrics } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ids = {
  admin: "00000000-0000-4000-8000-000000000901",
  inviter: "00000000-0000-4000-8000-000000000902",
  code: "00000000-0000-4000-8000-000000000903",
  approval: "00000000-0000-4000-8000-000000000904",
} as const;

describe("expert financial production-boundary metrics", () => {
  const reader = new sdkMetrics.PeriodicExportingMetricReader({
    exporter: new sdkMetrics.InMemoryMetricExporter(
      sdkMetrics.AggregationTemporality.CUMULATIVE,
    ),
    exportIntervalMillis: 60_000,
  });
  const provider = new sdkMetrics.MeterProvider({ readers: [reader] });

  beforeAll(() => {
    expect(apiMetrics.setGlobalMeterProvider(provider)).toBe(true);
  });

  afterAll(async () => {
    await provider.shutdown();
    apiMetrics.disable();
  });

  it("emits every finite lifecycle category from real production boundaries", async () => {
    const [
      referralModule,
      residencyModule,
      adminModule,
      expiryModule,
      reconciliationModule,
      replayModule,
    ] = await Promise.all([
      import("../../application/src/expert-referral-service.js"),
      import("../../application/src/expert-residency-service.js"),
      import("../../application/src/expert-referral-admin-service.js"),
      import("../../worker/src/expert-residency-expiry.js"),
      import("../../worker/src/expert-residency-reconciliation.js"),
      import("../../worker/src/expert-referral-hold-replay.js"),
    ]);

    const referral = referralModule.createExpertReferralService({
      referralEnabled: true,
      identity: { authorize: async (principal) => principal },
      controls: {
        readForCommand: async () => ({ version: 1, newCommandsEnabled: true }),
      },
      commands: {
        redeem: async () => ({ referralId: "private-referral-id" }),
      },
      queries: {
        summary: async (expertId) => ({
          expertId,
          spendableBalanceMinor: "0",
          reservedBalanceMinor: "0",
          debtMinor: "0",
          nearestExpiryAt: null,
        }),
      },
    });
    const principal = {
      expertId: "private-expert-id",
      userId: "private-user-id",
      provider: "sandbox",
      externalId: "private-external-id",
    };
    await referral.redeemCode(
      principal,
      "PRIVATE-PLAINTEXT-CODE",
      "private-idempotency-key",
    );

    const residency = residencyModule.createExpertResidencyService({
      billingEnabled: true,
      identity: { authorize: async (candidate) => candidate },
      controls: {
        readForCommand: async () => ({ version: 1, newCommandsEnabled: true }),
      },
      orders: {
        quote: async () => ({
          tariffVersionId: "private-tariff-id",
          displayName: "Private tariff name",
          description: "Private tariff description",
          priceMinor: "200000",
          currency: "RUB" as const,
          durationSeconds: 31_536_000,
          creditMinor: "100000",
          cashMinor: "100000",
        }),
        createCheckoutOrder: async ({ expertId }) =>
          ({
            orderId: "private-order-id",
            expertId,
            tariffVersionId: "private-tariff-id",
            displayName: "Private tariff name",
            description: "Private tariff description",
            priceMinor: "200000",
            currency: "RUB" as const,
            durationSeconds: 31_536_000,
            creditMinor: "100000",
            cashMinor: "100000",
            paymentDeadline: new Date("2026-09-02T01:00:00.000Z"),
            status: "quoted",
            allocations: [],
            telemetry: {
              disposition: "applied",
              effects: [
                {
                  operation: "bonus_share",
                  outcome: "applied",
                  errorCode: "none",
                },
              ],
            },
          }) as const,
        releaseExpiredOrders: async () => ({
          kind: "expired" as const,
          released: true as const,
          telemetry: {
            disposition: "applied" as const,
            effects: [],
          },
        }),
        reverseRewardGrant: async () => ({
          rewardReversed: true,
          removedCreditMinor: 25_000n,
          cancelledReservationMinor: 5_000n,
          debtMinor: 10_000n,
          telemetry: {
            disposition: "applied" as const,
            effects: [
              {
                operation: "reversal" as const,
                outcome: "reversed" as const,
                errorCode: "none" as const,
              },
              {
                operation: "debt" as const,
                outcome: "debt_created" as const,
                errorCode: "none" as const,
              },
            ],
          },
        }),
      },
      payment: {
        createCheckout: async ({ expiresAt }) => ({
          kind: "created" as const,
          provider: "sandbox",
          paymentId: "private-payment-id",
          checkoutUrl: "https://provider.invalid/private-payment-id",
          expiresAt,
        }),
        reconcile: async () => null,
      },
      existingState: {
        settle: (() => {
          let applied = false;
          return async () => {
            if (applied) {
              return {
                kind: "settled" as const,
                telemetry: {
                  disposition: "duplicate" as const,
                  effects: [] as const,
                },
              };
            }
            applied = true;
            return {
              kind: "settled" as const,
              telemetry: {
                disposition: "applied" as const,
                effects: [
                  {
                    operation: "first_payment_qualification" as const,
                    outcome: "eligible" as const,
                    errorCode: "none" as const,
                  },
                  {
                    operation: "credit_spend" as const,
                    outcome: "spent" as const,
                    errorCode: "none" as const,
                  },
                  {
                    operation: "reward_grant" as const,
                    outcome: "granted" as const,
                    errorCode: "none" as const,
                  },
                ],
              },
            };
          };
        })(),
        refund: async () => ({
          kind: "refunded" as const,
          telemetry: {
            disposition: "applied" as const,
            effects: [
              {
                operation: "refund" as const,
                outcome: "refunded" as const,
                errorCode: "none" as const,
              },
              {
                operation: "reversal" as const,
                outcome: "reversed" as const,
                errorCode: "none" as const,
              },
              {
                operation: "debt" as const,
                outcome: "debt_created" as const,
                errorCode: "none" as const,
              },
            ],
          },
        }),
        replayHeldReward: async () => ({
          kind: "debt_repaid" as const,
          amountMinor: "10000",
          telemetry: {
            disposition: "applied" as const,
            effects: [
              {
                operation: "held_replay" as const,
                outcome: "debt_repaid" as const,
                errorCode: "none" as const,
              },
              {
                operation: "reward_grant" as const,
                outcome: "debt_repaid" as const,
                errorCode: "none" as const,
              },
              {
                operation: "debt" as const,
                outcome: "debt_repaid" as const,
                errorCode: "none" as const,
              },
            ],
          },
        }),
      },
    });
    await residency.quote(principal, "private-tariff-id");
    await residency.checkout(principal, {
      tariffKey: "private-tariff-id",
      idempotencyKey: "private-checkout-idempotency",
      providerDeadline: new Date("2026-09-02T01:00:00.000Z"),
    });
    await residency.settle({} as never);
    await residency.settle({} as never);
    await residency.refund({} as never);
    await residency.releaseExpiredOrder({ orderId: "private-order-id" });
    await residency.reverseReward({
      grantId: "private-grant-id",
      inviterExpertId: principal.expertId,
      reversedAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    await residency.replayHeldReward({
      expertId: principal.expertId,
      qualifyingOrderId: "private-order-id",
    });

    const admin = adminModule.createExpertReferralAdminService({
      environment: {
        read: () => ({ referralEnabled: true, residencyBillingEnabled: true }),
      },
      referrals: {
        issueBatch: async (command) => ({
          batchId: "private-batch-id",
          inviterExpertId: command.inviterExpertId,
          codes: [
            {
              codeId: ids.code,
              plaintext: "PRIVATE-PLAINTEXT-CODE",
              maskedSuffix: "private-suffix",
            },
          ],
        }),
        revokeCode: async (command) => ({
          codeId: command.codeId,
          inviterExpertId: ids.inviter,
          maskedSuffix: "private-suffix",
          status: "revoked" as const,
          issuedAt: new Date("2026-09-02T00:00:00.000Z"),
        }),
        maskedInventory: async () => [],
      },
      overrides: { createIssuanceOverride: async () => null },
      controls: {} as never,
      tariffs: {} as never,
      heldRewards: {} as never,
    });
    const adminPrincipal = {
      id: ids.admin,
      sessionIdHash: "private-session-hash",
      roles: ["entitlement_admin" as const],
      mfaVerifiedAt: new Date("2026-09-02T00:00:00.000Z"),
    };
    const authorization = {
      approvalId: ids.approval,
      nonce: "private-approval-nonce",
    };
    await admin.issueBatch(adminPrincipal, {
      ...authorization,
      routeObjectId: ids.inviter,
      inviterExpertId: ids.inviter,
      count: 1,
    });
    await admin.revokeCode(adminPrincipal, {
      ...authorization,
      routeObjectId: ids.code,
      codeId: ids.code,
      reasonCode: "private_reason",
    });

    await expiryModule.expireExpertResidencyOrders(
      {
        expireDueBatch: async () => ({ examined: 2, changed: 1, failed: 1 }),
      },
      new Date("2026-09-02T00:00:00.000Z"),
      2,
    );
    await reconciliationModule.reconcileExpertResidencyPayments(
      {
        claimReconciliationBatch: async () => [
          {
            attemptId: "private-attempt-id",
            providerPaymentId: "private-payment-id",
            claimedAt: "2026-09-02T00:00:00.000Z",
          },
        ],
        compareAndRecordReconciliation: async () => "mismatch" as const,
      },
      { reconcile: async () => ({ payload: "private-provider-payload" }) },
      new Date("2026-09-02T00:00:00.000Z"),
      1,
    );
    await reconciliationModule.reconcileExpertResidencyPayments(
      {
        claimReconciliationBatch: async () => [
          {
            attemptId: "private-attempt-id",
            providerPaymentId: "private-payment-id",
            claimedAt: "2026-09-02T00:00:00.000Z",
          },
        ],
        compareAndRecordReconciliation: async () => "matched" as const,
      },
      { reconcile: async () => ({ payload: "private-provider-payload" }) },
      new Date("2026-09-02T00:00:00.000Z"),
      1,
    );
    await replayModule.replayHeldRewards(
      {
        replayDueBatch: async () => ({
          examined: 2,
          granted: 1,
          debtRepaid: 1,
          ineligible: 0,
          cancelled: 0,
          stillHeld: 0,
          failed: 0,
        }),
      },
      new Date("2026-09-02T00:00:00.000Z"),
      2,
    );

    const collected = await reader.collect();
    const points = collected.resourceMetrics.scopeMetrics.flatMap((scope) =>
      scope.metrics.flatMap((metric) =>
        metric.dataPoints.map((point) => ({
          name: metric.descriptor.name,
          attributes: point.attributes,
        })),
      ),
    );
    const lifecycle = points.filter(
      (point) => point.name === "ii_tonya_expert_referral_lifecycle",
    );
    expect(
      points.some(
        (point) =>
          point.name === "ii_tonya_expert_referral_operation_duration_ms",
      ),
    ).toBe(true);
    expect(
      new Set(lifecycle.map((point) => point.attributes.operation)),
    ).toEqual(
      new Set([
        "batch_lifecycle",
        "code_lifecycle",
        "redemption",
        "first_payment_qualification",
        "reward_grant",
        "credit_spend",
        "credit_expiry",
        "debt",
        "bonus_share",
        "duplicate_event",
        "held_replay",
        "refund",
        "reversal",
        "reconciliation_mismatch",
      ]),
    );
    for (const point of lifecycle) {
      expect(Object.keys(point.attributes).sort()).toEqual([
        "errorCode",
        "module",
        "operation",
        "outcome",
      ]);
      const serialized = JSON.stringify(point.attributes);
      expect(serialized).not.toMatch(
        /private|plaintext|suffix|payload|exception|reason|https?:/iu,
      );
    }
  });
});
