import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdVerifiedPaymentReader } from "./early-bird-verified-payment-reader.js";

const operationId = "00000000-0000-4000-8000-000000000001";
const binding = {
  invoiceId: "00000000-0000-4000-8000-000000000002",
  operationId,
  userId: "00000000-0000-4000-8000-000000000003",
  providerObjectId: "verified-payment",
  pricingPolicy: "wave1_standard_v1",
  priceKind: "full_price",
  mode: "live",
  onboardingMinor: "300000",
  subscriptionMinor: "1000000",
  totalMinor: "1300000",
  baseOfferShownAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
  launchAt: "2027-01-10T21:00:00.000Z",
};
function fixture(data: unknown, safe = true) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ safe }] })
    .mockResolvedValueOnce({ rows: [{ data }] });
  const transaction = vi.fn(
    async (work: (tx: { execute: typeof execute }) => unknown) =>
      work({ execute }),
  );
  const reader = new PostgresEarlyBirdVerifiedPaymentReader(
    { transaction } as unknown as DrizzleDb,
    "wave_reader",
  );
  return { reader, execute, transaction };
}
it("reads a stored binding by operation without requiring receipt data", async () => {
  const { reader, execute } = fixture(binding);
  expect(await reader.findBindingByOperation(operationId)).toEqual(binding);
  expect(execute).toHaveBeenCalledTimes(2);
});
it("rejects a returned binding for another operation", async () => {
  const { reader } = fixture({
    ...binding,
    operationId: "00000000-0000-4000-8000-000000000004",
  });
  await expect(reader.findBindingByOperation(operationId)).rejects.toThrow(
    "early_bird_verified_reader_binding_invalid",
  );
});
it("keeps missing binding and unsafe principal fail closed", async () => {
  const absent = fixture(null);
  expect(await absent.reader.findBindingByOperation(operationId)).toBeNull();
  const unsafe = fixture(binding, false);
  await expect(
    unsafe.reader.findBindingByOperation(operationId),
  ).rejects.toThrow("early_bird_verified_reader_principal_unsafe");
  expect(unsafe.execute).toHaveBeenCalledOnce();
});
it("rejects invalid operation IDs before DB access", async () => {
  const { reader, transaction } = fixture(binding);
  expect(await reader.findBindingByOperation("bad-operation")).toBeNull();
  expect(transaction).not.toHaveBeenCalled();
});
