import { describe, expect, it } from "vitest";
import {
  expertResidencyCheckoutCommandSchema,
  expertResidencyPaymentEventSchema,
  expertResidencyVerificationEvidenceSchema,
  type ExpertResidencyPaymentEvent,
} from "../../packages/contracts/src/index.js";
import * as productionIntegrations from "../../packages/integrations/src/index.js";
import { requireVerifiedExpertResidencyPaymentEvent } from "../../packages/integrations/src/expert-residency/verified-event.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/testing.testkit.js";

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

  it("accepts only explicit provider-neutral refund and chargeback termination facts", () => {
    const partialRefund = {
      ...rawEvent,
      kind: "refunded",
      eventId: "evt_refund_00000001",
      amountMinor: "10000",
      terminatesResidency: false,
    };
    const chargeback = {
      ...rawEvent,
      kind: "charged_back",
      eventId: "evt_chargeback_00000001",
      amountMinor: "50000",
      terminatesResidency: true,
    };

    expect(expertResidencyPaymentEventSchema.parse(partialRefund)).toEqual(
      partialRefund,
    );
    expect(expertResidencyPaymentEventSchema.parse(chargeback)).toEqual(
      chargeback,
    );
    expect(
      expertResidencyPaymentEventSchema.parse({
        ...chargeback,
        eventId: "evt_partial_chargeback_00000001",
        terminatesResidency: false,
      }),
    ).toMatchObject({ kind: "charged_back", terminatesResidency: false });
    for (const candidate of [
      { ...partialRefund, terminatesResidency: undefined },
      { ...partialRefund, terminatesResidency: "false" },
      { ...rawEvent, terminatesResidency: false },
    ]) {
      expect(
        expertResidencyPaymentEventSchema.safeParse(candidate).success,
      ).toBe(false);
    }
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

  it("bounds positive minor units to PostgreSQL signed bigint", () => {
    const maximum = "9223372036854775807";
    const tooLarge = "9223372036854775808";
    expect(
      expertResidencyPaymentEventSchema.parse({
        ...rawEvent,
        amountMinor: maximum,
      }).amountMinor,
    ).toBe(maximum);
    expect(
      expertResidencyCheckoutCommandSchema.parse({
        orderId: rawEvent.orderId,
        idempotencyKey: "checkout_bigint_max",
        amountMinor: maximum,
        currency: "RUB",
        expiresAt: "2026-08-03T00:30:00.000Z",
      }).amountMinor,
    ).toBe(maximum);
    for (const amountMinor of [tooLarge, "0", "-1", "+1", "1.0", "1e3"]) {
      expect(
        expertResidencyPaymentEventSchema.safeParse({
          ...rawEvent,
          amountMinor,
        }).success,
      ).toBe(false);
      expect(
        expertResidencyCheckoutCommandSchema.safeParse({
          orderId: rawEvent.orderId,
          idempotencyKey: "checkout_invalid_money",
          amountMinor,
          currency: "RUB",
          expiresAt: "2026-08-03T00:30:00.000Z",
        }).success,
      ).toBe(false);
    }
  });

  it("requires one canonical UTC millisecond timestamp representation", () => {
    for (const occurredAt of [
      "2026-08-03T00:00:00Z",
      "2026-08-03T00:00:00.123456Z",
      "2026-08-03T03:00:00.000+03:00",
      "2026-08-03 00:00:00.000Z",
    ]) {
      expect(
        expertResidencyPaymentEventSchema.safeParse({
          ...rawEvent,
          occurredAt,
        }).success,
      ).toBe(false);
      expect(
        expertResidencyVerificationEvidenceSchema.safeParse({
          verificationId: "verify_timestamp",
          verifierKeyVersion: "sandbox-v1",
          verifiedAt: occurredAt,
          payloadDigest: rawEvent.payloadDigest,
        }).success,
      ).toBe(false);
    }
    expect(
      expertResidencyPaymentEventSchema.parse({
        ...rawEvent,
        occurredAt: "2026-08-03T00:00:00.123Z",
      }).occurredAt,
    ).toBe("2026-08-03T00:00:00.123Z");
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
