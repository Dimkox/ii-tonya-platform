import { describe, expect, it } from "vitest";
import type { ExpertResidencyPaymentEvent } from "@ii-tonya/contracts";
import {
  DisabledExpertResidencyPaymentEventVerifier,
  isVerifiedExpertResidencyPaymentEvent,
  requireVerifiedExpertResidencyPaymentEvent,
  verifiedEventFixture,
} from "./verified-event.js";

const rawEvent: ExpertResidencyPaymentEvent = {
  kind: "settled",
  provider: "sandbox",
  eventId: "evt_00000001",
  paymentId: "pay_00000001",
  orderId: "00000000-0000-4000-8000-000000000601",
  amountMinor: "50000",
  currency: "RUB",
  occurredAt: "2026-08-03T00:00:00.000Z",
  payloadDigest: `sha256:${"a".repeat(64)}`,
};

describe("verified expert residency payment events", () => {
  it("rejects a structurally identical event that did not cross the verifier boundary", () => {
    expect(isVerifiedExpertResidencyPaymentEvent(rawEvent)).toBe(false);
    expect(() => requireVerifiedExpertResidencyPaymentEvent(rawEvent)).toThrow(
      "verified_event_required",
    );

    const copied = {
      ...verifiedEventFixture(rawEvent, {
        verificationId: "verify_00000001",
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:01.000Z",
        payloadDigest: rawEvent.payloadDigest,
      }),
    };
    expect(isVerifiedExpertResidencyPaymentEvent(copied)).toBe(false);
  });

  it("constructs a bounded verified fixture only when evidence matches the event", () => {
    const verified = verifiedEventFixture(rawEvent, {
      verificationId: "verify_00000001",
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
      payloadDigest: rawEvent.payloadDigest,
    });

    expect(requireVerifiedExpertResidencyPaymentEvent(verified)).toBe(verified);
    expect(verified.verification).toEqual({
      verificationId: "verify_00000001",
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
      payloadDigest: rawEvent.payloadDigest,
    });
    expect(() =>
      verifiedEventFixture(rawEvent, {
        verificationId: "verify_00000001",
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:01.000Z",
        payloadDigest: `sha256:${"b".repeat(64)}`,
      }),
    ).toThrow("verification_digest_mismatch");
    expect(() =>
      verifiedEventFixture(rawEvent, {
        verificationId: "verify_00000001",
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-02T23:59:59.999Z",
        payloadDigest: rawEvent.payloadDigest,
      }),
    ).toThrow("verification_precedes_event");
  });

  it("brands provider-neutral refund and chargeback discriminants with their termination fact", () => {
    for (const event of [
      {
        ...rawEvent,
        kind: "refunded" as const,
        eventId: "evt_refund_00000001",
        terminatesResidency: false,
      },
      {
        ...rawEvent,
        kind: "charged_back" as const,
        eventId: "evt_chargeback_00000001",
        terminatesResidency: true,
      },
    ]) {
      const verified = verifiedEventFixture(event, {
        verificationId: `verify_${event.eventId}`,
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:01.000Z",
        payloadDigest: event.payloadDigest,
      });

      expect(
        requireVerifiedExpertResidencyPaymentEvent(verified),
      ).toMatchObject({
        kind: event.kind,
        terminatesResidency: event.terminatesResidency,
      });
    }
  });

  it("keeps production verification disabled without inspecting raw input", async () => {
    let reads = 0;
    const input = new Proxy(
      { rawBody: new Uint8Array([1]), headers: { authorization: "secret" } },
      {
        get() {
          reads += 1;
          throw new Error("disabled verifier inspected input");
        },
      },
    );

    await expect(
      new DisabledExpertResidencyPaymentEventVerifier().verify(input),
    ).resolves.toEqual({ kind: "rejected" });
    expect(reads).toBe(0);
  });
});
