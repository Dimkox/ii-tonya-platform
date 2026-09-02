import { describe, expect, it, vi } from "vitest";

const metricAttempts = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("@opentelemetry/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@opentelemetry/api")>();
  const throwing = (
    _value: number,
    attributes: Record<string, unknown> = {},
  ) => {
    metricAttempts.push(attributes);
    throw new Error("otel_exporter_failed_after_financial_commit");
  };
  const instrument = { add: throwing, record: throwing };
  return {
    ...actual,
    metrics: {
      getMeter: () => ({
        createCounter: () => instrument,
        createHistogram: () => instrument,
        createUpDownCounter: () => instrument,
      }),
    },
  };
});

describe("expert financial telemetry failure isolation", () => {
  it("returns committed success when the OTel instrument throws", async () => {
    metricAttempts.length = 0;
    const { createExpertResidencyService } = await import(
      "../../application/src/expert-residency-service.js"
    );
    const committed = {
      kind: "settled" as const,
      telemetry: {
        disposition: "applied",
        effects: [
          {
            operation: "first_payment_qualification",
            outcome: "eligible",
            errorCode: "none",
          },
        ],
      },
    };
    const service = createExpertResidencyService({
      billingEnabled: false,
      identity: { authorize: async () => null },
      controls: { readForCommand: async () => ({ version: 1, newCommandsEnabled: false }) },
      orders: {} as never,
      payment: {} as never,
      existingState: {
        settle: async () => committed as never,
        refund: async () => ({ kind: "refunded" }) as never,
        replayHeldReward: async () => ({ kind: "still_held" }) as never,
      },
    });

    await expect(service.settle({} as never)).resolves.toBe(committed);
    expect(metricAttempts).toHaveLength(1);
    expect(metricAttempts[0]).toMatchObject({
      operation: "first_payment_qualification",
      outcome: "eligible",
    });
    expect(metricAttempts).not.toContainEqual(
      expect.objectContaining({ outcome: "failed" }),
    );
  });
});
