import { describe, expect, it } from "vitest";
import { expertResidencyPaymentEventSchema } from "@ii-tonya/contracts";
import {
  assertVerifiedExpertResidencyPaymentEvent,
  createCanonicalExpertResidencyPaymentEventVerifier,
  disabledExpertResidencyPaymentEventVerifier,
  verifiedEventFixture,
} from "./verified-event.js";

describe("verified expert residency payment events", () => {
  const raw = expertResidencyPaymentEventSchema.parse({
    kind: "settled",
    provider: "sandbox",
    eventId: "evt_00000001",
    paymentId: "pay_00000001",
    orderId: "00000000-0000-4000-8000-000000000001",
    amountMinor: "50000",
    currency: "RUB",
    occurredAt: "2026-08-03T00:00:00.000Z",
    payloadDigest: `sha256:${"a".repeat(64)}`,
  });
  it("constructs branded events only through verifier fixture", () => {
    expect(
      verifiedEventFixture(raw, {
        verificationId: "verify_00000001",
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:01.000Z",
      }),
    ).toMatchObject(raw);
  });
  it("rejects production verification while disabled", async () => {
    await expect(
      disabledExpertResidencyPaymentEventVerifier.verify({
        rawBody: new TextEncoder().encode(
          JSON.stringify({ ...raw, provider: "ii_tonya_sandbox" }),
        ),
        headers: { "content-type": "application/json" },
      }),
    ).resolves.toEqual({ kind: "rejected" });
  });
  it("brands validated canonical events with bounded evidence", () => {
    const verifier = createCanonicalExpertResidencyPaymentEventVerifier();
    const verified = verifier.verifyCanonical(raw, {
      verificationId: "verify_00000001",
      verifierKeyVersion: "key-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
    });

    expect(() =>
      assertVerifiedExpertResidencyPaymentEvent(verified),
    ).not.toThrow();
    expect(() =>
      verifier.verifyCanonical(raw, {
        verificationId: "verify_00000001",
        verifierKeyVersion: "x".repeat(101),
        verifiedAt: "2026-08-03T00:00:01.000Z",
      }),
    ).toThrow("invalid_verification_evidence");
  });
  it("rejects forged, mutated, and malformed verification evidence", () => {
    expect(() =>
      assertVerifiedExpertResidencyPaymentEvent({
        ...raw,
        verificationId: "verify_00000001",
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:01.000Z",
      }),
    ).toThrow("verified_event_required");
    expect(() =>
      verifiedEventFixture(raw, {
        verificationId: "",
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:01.000Z",
      }),
    ).toThrow("invalid_verification_evidence");
    expect(() =>
      verifiedEventFixture(raw, {
        verificationId: "verify_1",
        verifierKeyVersion: "x".repeat(101),
        verifiedAt: "2026-08-03T00:00:01Z",
      }),
    ).toThrow("invalid_verification_evidence");
  });
});
