import { expect, it, vi } from "vitest";
import { createEarlyBirdInvoice } from "./early-bird-invoice-orchestrator.js";

const intent = {
  invoiceId: "2526c71d-803f-4c3d-9b57-74e902170001",
  userId: "2526c71d-803f-4c3d-9b57-74e902170002",
  operationId: "2526c71d-803f-4c3d-9b57-74e902170003",
  idempotencyKey: "2526c71d-803f-4c3d-9b57-74e902170005",
  grantId: "2526c71d-803f-4c3d-9b57-74e902170004",
  pricingPolicy: "owner_test_10_20_v1",
  priceKind: "fixed_test",
  mode: "live",
  onboardingMinor: "1000",
  subscriptionMinor: "2000",
  totalMinor: "3000",
  baseOfferShownAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
  launchAt: "2027-01-10T21:00:00.000Z",
} as const;
const fiscal = {
  vatCode: 1,
  paymentSubject: "service",
  paymentMode: "full_payment",
};
const source = {
  intent,
  customer: { email: "fixture@example.invalid" },
  returnUrl: "https://example.invalid/return",
  onboardingFiscal: fiscal,
  subscriptionFiscal: fiscal,
};

it("fails closed without a complete authority and gateway", async () => {
  await expect(createEarlyBirdInvoice(null, intent.userId)).resolves.toEqual({
    kind: "unavailable",
  });
});
it("persists the exact 30 ruble request before dispatching only its opaque operation identity", async () => {
  const calls: string[] = [];
  const prepare = vi.fn(async () => source);
  const persist = vi.fn(async (request) => {
    calls.push("persist");
    expect(JSON.parse(request.body).amount.value).toBe("30.00");
    return true;
  });
  const dispatch = vi.fn(async () => {
    calls.push("dispatch");
    return { kind: "unknown" as const };
  });
  const result = await createEarlyBirdInvoice(
    { authority: { prepare, persist }, gateway: { dispatch } },
    intent.userId,
  );
  expect(result).toEqual({ kind: "unknown" });
  expect(calls).toEqual(["persist", "dispatch"]);
  expect(dispatch).toHaveBeenCalledWith({
    userId: intent.userId,
    operationId: intent.operationId,
  });
});
it("does not dispatch on user mismatch, invalid snapshots or failed persistence", async () => {
  const dispatch = vi.fn();
  const persist = vi.fn(async () => false);
  const dependencies = {
    authority: { prepare: async () => source, persist },
    gateway: { dispatch },
  };
  await expect(
    createEarlyBirdInvoice(
      dependencies,
      "2526c71d-803f-4c3d-9b57-74e902170006",
    ),
  ).resolves.toEqual({ kind: "unavailable" });
  await expect(
    createEarlyBirdInvoice(dependencies, intent.userId),
  ).resolves.toEqual({ kind: "unavailable" });
  expect(dispatch).not.toHaveBeenCalled();
});
it("does not replay a request after an uncertain gateway failure", async () => {
  const dispatch = vi.fn(async () => {
    throw new Error("network");
  });
  const result = await createEarlyBirdInvoice(
    {
      authority: { prepare: async () => source, persist: async () => true },
      gateway: { dispatch },
    },
    intent.userId,
  );
  expect(result).toEqual({ kind: "unknown" });
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it("never persists or dispatches a tampered owner price snapshot", async () => {
  const persist = vi.fn(async () => true);
  const dispatch = vi.fn();
  const result = await createEarlyBirdInvoice(
    {
      authority: {
        prepare: async () =>
          ({ ...source, intent: { ...intent, totalMinor: "3001" } }) as never,
        persist,
      },
      gateway: { dispatch },
    },
    intent.userId,
  );
  expect(result).toEqual({ kind: "unavailable" });
  expect(persist).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});
