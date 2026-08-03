import { describe, expect, it } from "vitest";
import { expertResidencyPaymentEventSchema } from "@ii-tonya/contracts";
import { disabledExpertResidencyPaymentEventVerifier, verifiedEventFixture } from "./verified-event.js";

describe("verified expert residency payment events", () => {
  const raw = expertResidencyPaymentEventSchema.parse({ kind: "settled", provider: "sandbox", eventId: "evt_00000001", paymentId: "pay_00000001", orderId: "00000000-0000-4000-8000-000000000001", amountMinor: "50000", currency: "RUB", occurredAt: "2026-08-03T00:00:00.000Z", payloadDigest: `sha256:${"a".repeat(64)}` });
  it("constructs branded events only through verifier fixture", () => {
    expect(verifiedEventFixture(raw, { verificationId: "verify_00000001", verifierKeyVersion: "sandbox-v1", verifiedAt: "2026-08-03T00:00:01.000Z" })).toMatchObject(raw);
  });
  it("rejects production verification while disabled", async () => {
    await expect(disabledExpertResidencyPaymentEventVerifier.verify({ rawBody: new Uint8Array(), headers: {} })).resolves.toEqual({ kind: "rejected" });
  });
});
