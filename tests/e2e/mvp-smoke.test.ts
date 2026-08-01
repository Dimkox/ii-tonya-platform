import { describe, expect, it } from "vitest";
import { startMvpHarness } from "./support/mvp-harness.js";

describe("AC-025 exact MVP chain", () => {
  it("grants 500, records exactly two dialogue debits, searches verified services, reserves, confirms, cancels, and reconciles without duplicates", async () => {
    const app = await startMvpHarness({
      clock: new Date("2026-07-28T10:00:00.000Z"),
      testOnlyOutboundBillingMode: "provider_delivery_event",
    });
    try {
      const client = await app.createClient({ explicitProfileConsent: true });
      const grant = await app.adminGrantPackage({
        userId: client.userId,
        size: 500,
        validForDays: 60,
        idempotencyKey: "grant-ac025-1",
      });
      expect(grant.expiresAt).toBe("2026-09-26T10:00:00.000Z");
      await app.acceptOrdinaryInbound({
        client,
        text: "Подбери проверенного специалиста",
        providerEventId: "selarti-inbound-ac025-1",
      });
      await app.queueOrdinaryAnswer({
        client,
        text: "Нашла подходящие варианты",
        outboxId: "assistant-outbox-ac025-1",
      });
      expect(await app.dialogueDebitCount(client.userId)).toBe(1);
      await app.recordOutboundDelivery({
        userId: client.userId,
        outboxId: "assistant-outbox-ac025-1",
        provider: "selarti",
        providerDeliveryEventId: "selarti-delivered-ac025-1",
        deliveredAt: "2026-07-28T10:00:03.000Z",
      });
      expect(await app.dialogueDebitCount(client.userId)).toBe(2);
      expect(await app.balance(client.userId)).toBe(498);
      const matches = await app.searchVerifiedServices({
        query: "психолог",
        startsAfter: "2026-07-29T10:00:00.000Z",
      });
      expect(matches.length).toBeGreaterThan(0);
      expect(
        matches.every(
          (match) =>
            match.expert.active &&
            match.expert.verified &&
            match.service.active,
        ),
      ).toBe(true);
      const reservation = await app.reserve({
        client,
        slotId: matches[0]!.slot.id,
        idempotencyKey: "reserve-ac025-1",
      });
      await app.expertConfirm({
        reservationId: reservation.id,
        expertId: reservation.expertId,
        expectedVersion: reservation.version,
        idempotencyKey: "confirm-ac025-1",
      });
      await app.clientCancel({
        reservationId: reservation.id,
        userId: client.userId,
        idempotencyKey: "cancel-ac025-1",
      });
      expect(await app.notificationLedgerFacts(reservation.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: "reservation_confirmed",
            kind: "free",
            delta: 0,
          }),
          expect.objectContaining({
            reason: "reservation_cancelled",
            kind: "free",
            delta: 0,
          }),
        ]),
      );
      expect(await app.balance(client.userId)).toBe(498);
      const firstReconciliation = await app.runReconciliation();
      const secondReconciliation = await app.runReconciliation();
      expect(firstReconciliation.mismatches).toEqual([]);
      expect(secondReconciliation).toMatchObject({
        mismatches: [],
        newLedgerFacts: 0,
        newInboxRows: 0,
        newOutboxRows: 0,
      });
      await expect(
        app.assertExactlyOnce([
          "package.granted",
          "message.inbound.accepted",
          "message.outbound.delivered",
          "reservation.created",
          "reservation.booked",
          "reservation.cancelled_by_client",
        ]),
      ).resolves.toBeUndefined();
    } finally {
      await app.close();
    }
  });
}, 120_000);
