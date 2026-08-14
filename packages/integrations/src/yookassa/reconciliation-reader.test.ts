import { describe, expect, it, vi } from "vitest";
import { YooKassaExpertResidencyProviderReader } from "./reconciliation-reader.js";

const now = new Date("2026-08-14T10:00:00.000Z");
const paymentId = "2f4b6d0d-000f-5000-9000-000000000001";

const localPayment = (overrides: Record<string, unknown> = {}) => ({
  orderId: "00000000-0000-4000-8000-000000000001",
  provider: "yookassa",
  paymentId,
  amountMinor: "50000",
  currency: "RUB" as const,
  status: "settled" as const,
  ...overrides,
});

const providerPayment = (overrides: Record<string, unknown> = {}) => ({
  id: paymentId,
  status: "succeeded" as const,
  paid: true,
  amount: { value: "500.00", currency: "RUB" as const },
  test: true,
  createdAt: "2026-08-14T10:00:00.000Z",
  metadata: {},
  refundable: true,
  ...overrides,
});

describe("YooKassaExpertResidencyProviderReader", () => {
  it("returns exact settled snapshots from authoritative payment reads", async () => {
    const getPayment = vi.fn(async () => providerPayment());
    const reader = new YooKassaExpertResidencyProviderReader(
      { getPayment },
      "test",
    );

    await expect(
      reader.readPayments({ now, payments: [localPayment()] }),
    ).resolves.toEqual({
      kind: "available",
      payments: [
        {
          provider: "yookassa",
          paymentId,
          amountMinor: "50000",
          currency: "RUB",
          status: "settled",
        },
      ],
    });
    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(getPayment).toHaveBeenCalledWith(paymentId);
  });

  it("rejects an oversized batch before provider access", async () => {
    const getPayment = vi.fn(async () => providerPayment());
    const reader = new YooKassaExpertResidencyProviderReader(
      { getPayment },
      "test",
    );
    const payments = Array.from({ length: 101 }, (_, index) =>
      localPayment({ paymentId: `payment_${index}` }),
    );

    await expect(reader.readPayments({ now, payments })).rejects.toThrow(
      "yookassa_reconciliation_batch_invalid",
    );
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("rejects duplicate and foreign provider IDs before provider access", async () => {
    const getPayment = vi.fn(async () => providerPayment());
    const reader = new YooKassaExpertResidencyProviderReader(
      { getPayment },
      "test",
    );

    await expect(
      reader.readPayments({
        now,
        payments: [localPayment(), localPayment({ orderId: "another-order" })],
      }),
    ).rejects.toThrow("yookassa_reconciliation_duplicate_payment");
    await expect(
      reader.readPayments({
        now,
        payments: [localPayment({ provider: "sandbox" })],
      }),
    ).rejects.toThrow("yookassa_reconciliation_provider_invalid");
    expect(getPayment).not.toHaveBeenCalled();
  });

  it.each([
    [
      "amount",
      providerPayment({ amount: { value: "499.99", currency: "RUB" } }),
    ],
    [
      "currency",
      providerPayment({ amount: { value: "500.00", currency: "USD" } }),
    ],
    ["mode", providerPayment({ test: false })],
    ["identifier", providerPayment({ id: "different-provider-id" })],
    ["state", providerPayment({ paid: false })],
  ])(
    "fails the whole batch closed for a %s binding mismatch",
    async (_name, response) => {
      const getPayment = vi.fn(async () => response);
      const reader = new YooKassaExpertResidencyProviderReader(
        { getPayment },
        "test",
      );

      await expect(
        reader.readPayments({ now, payments: [localPayment()] }),
      ).rejects.toThrow("yookassa_reconciliation_binding_mismatch");
    },
  );

  it("fetches each unique payment once and never exceeds the bounded concurrency", async () => {
    let inFlight = 0;
    let maximumInFlight = 0;
    const getPayment = vi.fn(async (id: string) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return providerPayment({ id });
    });
    const reader = new YooKassaExpertResidencyProviderReader(
      { getPayment },
      "test",
    );
    const payments = Array.from({ length: 100 }, (_, index) =>
      localPayment({ paymentId: `payment_${index}` }),
    );

    const result = await reader.readPayments({ now, payments });

    expect(result).toMatchObject({ kind: "available" });
    expect(getPayment).toHaveBeenCalledTimes(100);
    expect(maximumInFlight).toBeLessThanOrEqual(4);
  });
});
