import { describe, expect, it } from "vitest";
import { expertResidencyPaymentEventSchema } from "../../packages/contracts/src/expert-residency.js";
describe("expert residency payment contract", () => {
  const valid = { kind: "settled", provider: "sandbox", eventId: "evt_00000001", paymentId: "pay_00000001", orderId: "00000000-0000-4000-8000-000000000001", amountMinor: "50000", currency: "RUB", occurredAt: "2026-08-03T00:00:00.000Z", payloadDigest: `sha256:${"a".repeat(64)}` } as const;
  it("accepts canonical events and rejects malformed or extra payload", () => {
    expect(expertResidencyPaymentEventSchema.parse(valid)).toEqual(valid);
    expect(() => expertResidencyPaymentEventSchema.parse({ ...valid, rawPayload: "secret" })).toThrow();
    expect(() => expertResidencyPaymentEventSchema.parse({ ...valid, payloadDigest: "bad" })).toThrow();
  });
});
