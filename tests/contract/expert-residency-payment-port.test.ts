import { describe, expect, it } from "vitest";
import {
  expertResidencyCheckoutCommandSchema,
  expertResidencyPaymentEventSchema,
  type ExpertResidencyPaymentEvent,
} from "../../packages/contracts/src/index.js";
import * as productionIntegrations from "../../packages/integrations/src/index.js";
import {
  requireVerifiedExpertResidencyPaymentEvent,
  verifiedEventFixture,
} from "../../packages/integrations/src/expert-residency/verified-event.js";

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

describe("expert residency provider-neutral payment contract", () => {
  it("accepts the exact canonical event and checkout command", () => {
    expect(expertResidencyPaymentEventSchema.parse(rawEvent)).toEqual(rawEvent);
    const checkout = {
      orderId: rawEvent.orderId,
      idempotencyKey: "checkout_00000001",
      amountMinor: "50000",
      currency: "RUB",
      expiresAt: "2026-08-03T00:30:00.000Z",
    };
    expect(expertResidencyCheckoutCommandSchema.parse(checkout)).toEqual(
      checkout,
    );
  });

  it("rejects extra fields, raw payloads, malformed digests, and non-canonical money", () => {
    for (const candidate of [
      { ...rawEvent, rawPayload: { card: "unsafe" } },
      { ...rawEvent, unexpected: true },
      { ...rawEvent, payloadDigest: "sha256:nope" },
      { ...rawEvent, amountMinor: "050000" },
      { ...rawEvent, amountMinor: "-1" },
      { ...rawEvent, currency: "rub" },
      { ...rawEvent, occurredAt: "2026-08-03T03:00:00+03:00" },
    ]) {
      expect(() =>
        expertResidencyPaymentEventSchema.parse(candidate),
      ).toThrow();
    }
  });

  it("requires the runtime verifier brand before settlement code can consume an event", async () => {
    const settle = async (event: unknown) => {
      requireVerifiedExpertResidencyPaymentEvent(event);
      return { kind: "settled" as const };
    };
    await expect(settle(rawEvent)).rejects.toThrow("verified_event_required");
    const verified = verifiedEventFixture(rawEvent, {
      verificationId: "verify_00000001",
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
      payloadDigest: rawEvent.payloadDigest,
    });
    await expect(settle(verified)).resolves.toMatchObject({ kind: "settled" });
  });

  it("does not expose a verified-event constructor through production exports", () => {
    expect(productionIntegrations).not.toHaveProperty("verifiedEventFixture");
    expect(productionIntegrations).not.toHaveProperty("verifiedEventBrand");
  });
});
