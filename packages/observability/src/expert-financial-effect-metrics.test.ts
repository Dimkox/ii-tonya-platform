import { metrics as apiMetrics } from "@opentelemetry/api";
import { metrics as sdkMetrics } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ExpertResidencyDependencies,
  ExpertResidencyService,
} from "../../application/src/expert-residency-service.js";

type CreateService = (
  dependencies: ExpertResidencyDependencies,
) => ExpertResidencyService;

const principal = {
  expertId: "private-expert-id",
  userId: "private-user-id",
  provider: "sandbox",
  externalId: "private-external-id",
};

const effect = (operation: string, outcome: string) => ({
  operation,
  outcome,
  errorCode: "none",
});

describe("authoritative expert financial effect metrics", () => {
  const reader = new sdkMetrics.PeriodicExportingMetricReader({
    exporter: new sdkMetrics.InMemoryMetricExporter(
      sdkMetrics.AggregationTemporality.CUMULATIVE,
    ),
    exportIntervalMillis: 60_000,
  });
  const provider = new sdkMetrics.MeterProvider({ readers: [reader] });
  let createService: CreateService;
  let reconcilePayments: (typeof import("../../worker/src/expert-residency-reconciliation.js"))["reconcileExpertResidencyPayments"];

  beforeAll(async () => {
    expect(apiMetrics.setGlobalMeterProvider(provider)).toBe(true);
    ({ createExpertResidencyService: createService } =
      await import("../../application/src/expert-residency-service.js"));
    ({ reconcileExpertResidencyPayments: reconcilePayments } =
      await import("../../worker/src/expert-residency-reconciliation.js"));
  });

  afterAll(async () => {
    await provider.shutdown();
    apiMetrics.disable();
  });

  const totals = async (): Promise<Map<string, number>> => {
    const collected = await reader.collect();
    const result = new Map<string, number>();
    for (const scope of collected.resourceMetrics.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name !== "ii_tonya_expert_referral_lifecycle") {
          continue;
        }
        for (const point of metric.dataPoints) {
          const operation = String(point.attributes.operation);
          result.set(
            operation,
            (result.get(operation) ?? 0) + Number(point.value),
          );
        }
      }
    }
    return result;
  };

  const change = (
    before: Map<string, number>,
    after: Map<string, number>,
    operation: string,
  ) => (after.get(operation) ?? 0) - (before.get(operation) ?? 0);

  const dependencies = (
    overrides: Partial<ExpertResidencyDependencies> = {},
  ): ExpertResidencyDependencies => ({
    billingEnabled: true,
    identity: { authorize: async (candidate) => candidate },
    controls: {
      readForCommand: async () => ({ version: 1, newCommandsEnabled: true }),
    },
    orders: {
      quote: async () => ({
        tariffVersionId: "private-tariff-id",
        displayName: "Private tariff",
        description: "Private tariff",
        priceMinor: "200000",
        currency: "RUB",
        durationSeconds: 31_536_000,
        creditMinor: "100000",
        cashMinor: "100000",
      }),
      createCheckoutOrder: async ({ expertId }) =>
        ({
          orderId: "private-order-id",
          expertId,
          tariffVersionId: "private-tariff-id",
          displayName: "Private tariff",
          description: "Private tariff",
          priceMinor: "200000",
          currency: "RUB",
          durationSeconds: 31_536_000,
          creditMinor: "100000",
          cashMinor: "100000",
          paymentDeadline: new Date("2026-09-02T01:00:00.000Z"),
          status: "quoted",
          allocations: [],
          telemetry: {
            disposition: "applied",
            effects: [effect("bonus_share", "applied")],
          },
        }) as never,
      releaseExpiredOrders: async () => ({
        kind: "settlement_allowed",
        released: false,
        telemetry: { disposition: "applied", effects: [] },
      }),
      reverseRewardGrant: async () => ({
        rewardReversed: false,
        removedCreditMinor: 0n,
        cancelledReservationMinor: 0n,
        debtMinor: 0n,
        telemetry: { disposition: "applied", effects: [] },
      }),
    },
    payment: {
      createCheckout: async ({ expiresAt }) => ({
        kind: "created",
        provider: "sandbox",
        paymentId: "private-payment-id",
        checkoutUrl: "https://provider.invalid/checkout",
        expiresAt,
      }),
      reconcile: async () => null,
    },
    existingState: {
      settle: async () =>
        ({
          kind: "settled",
          telemetry: { disposition: "applied", effects: [] },
        }) as never,
      refund: async () =>
        ({
          kind: "refunded",
          telemetry: { disposition: "applied", effects: [] },
        }) as never,
      replayHeldReward: async () =>
        ({
          kind: "still_held",
          telemetry: { disposition: "applied", effects: [] },
        }) as never,
    },
    ...overrides,
  });

  it("does not emit credit spend for an authoritative cash-only settlement", async () => {
    const service = createService(
      dependencies({
        existingState: {
          settle: async () =>
            ({
              kind: "settled",
              telemetry: {
                disposition: "applied",
                effects: [effect("first_payment_qualification", "eligible")],
              },
            }) as never,
          refund: async () => ({ kind: "refunded" }) as never,
          replayHeldReward: async () => ({ kind: "still_held" }) as never,
        },
      }),
    );
    const before = await totals();

    await service.settle({} as never);

    const after = await totals();
    expect(change(before, after, "first_payment_qualification")).toBe(1);
    expect(change(before, after, "credit_spend")).toBe(0);
    expect(change(before, after, "reward_grant")).toBe(0);
  });

  it("does not classify first application or reconciliation match as a duplicate", async () => {
    const service = createService(
      dependencies({
        existingState: {
          settle: async () =>
            ({
              kind: "settled",
              telemetry: {
                disposition: "applied",
                effects: [effect("credit_spend", "spent")],
              },
            }) as never,
          refund: async () => ({ kind: "refunded" }) as never,
          replayHeldReward: async () => ({ kind: "still_held" }) as never,
        },
      }),
    );
    const before = await totals();
    await service.settle({} as never);
    await reconcilePayments(
      {
        claimReconciliationBatch: async () => [
          {
            attemptId: "private-attempt",
            providerPaymentId: "private-payment",
            claimedAt: "2026-09-02T00:00:00.000Z",
          },
        ],
        compareAndRecordReconciliation: async () => "matched",
      },
      { reconcile: async () => ({ verified: true }) },
      new Date("2026-09-02T00:00:00.000Z"),
      1,
    );

    const after = await totals();
    expect(change(before, after, "duplicate_event")).toBe(0);
  });

  it("emits only duplicate event for an explicit idempotent replay", async () => {
    const applied = {
      kind: "settled" as const,
      telemetry: {
        disposition: "applied",
        effects: [
          effect("first_payment_qualification", "eligible"),
          effect("credit_spend", "spent"),
          effect("reward_grant", "granted"),
        ],
      },
    };
    const duplicate = {
      kind: "settled" as const,
      telemetry: { disposition: "duplicate", effects: [] },
    };
    let calls = 0;
    const service = createService(
      dependencies({
        existingState: {
          settle: async () => (calls++ === 0 ? applied : duplicate) as never,
          refund: async () => ({ kind: "refunded" }) as never,
          replayHeldReward: async () => ({ kind: "still_held" }) as never,
        },
      }),
    );
    await service.settle({} as never);
    const beforeReplay = await totals();

    await service.settle({} as never);

    const afterReplay = await totals();
    expect(change(beforeReplay, afterReplay, "duplicate_event")).toBe(1);
    expect(
      change(beforeReplay, afterReplay, "first_payment_qualification"),
    ).toBe(0);
    expect(change(beforeReplay, afterReplay, "credit_spend")).toBe(0);
    expect(change(beforeReplay, afterReplay, "reward_grant")).toBe(0);
  });

  it("does not infer refund, reversal, or debt effects from absent metadata", async () => {
    const service = createService(dependencies());
    const before = await totals();

    await service.refund({} as never);

    const after = await totals();
    expect(change(before, after, "refund")).toBe(0);
    expect(change(before, after, "reversal")).toBe(0);
    expect(change(before, after, "debt")).toBe(0);
  });

  it("emits bonus share from checkout allocation and never from quote", async () => {
    const service = createService(dependencies());
    const beforeQuote = await totals();
    await service.quote(principal, "private-tariff-id");
    const afterQuote = await totals();
    expect(change(beforeQuote, afterQuote, "bonus_share")).toBe(0);

    await service.checkout(principal, {
      tariffKey: "private-tariff-id",
      idempotencyKey: "private-idempotency-key",
      providerDeadline: new Date("2026-09-02T01:00:00.000Z"),
    });
    const afterCheckout = await totals();
    expect(change(afterQuote, afterCheckout, "bonus_share")).toBe(1);
  });
});
