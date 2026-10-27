import { describe, expect, it } from "vitest";
import { startMvpHarness } from "./support/mvp-harness.js";

describe("AC-025 exact MVP chain", () => {
  it("grants 500, records exactly two dialogue debits, searches verified services, reserves, confirms, cancels, and reconciles without duplicates", async () => {
    const clock = new Date();
    const at = (offsetMs: number) =>
      new Date(clock.getTime() + offsetMs).toISOString();
    const app = await startMvpHarness({
      clock,
      testOnlyOutboundBillingMode: "provider_delivery_event",
    });
    try {
      const client = await app.createClient({ explicitProfileConsent: true });
      const grant = await app.adminGrantPackage({
        userId: client.userId,
        size: 500,
        validForDays: 30,
        idempotencyKey: "grant-ac025-1",
      });
      expect(grant.expiresAt).toBe(at(30 * 24 * 60 * 60 * 1000));
      await app.acceptOrdinaryInbound({
        client,
        text: "Подбери проверенного специалиста",
        providerEventId: "selarti-inbound-ac025-1",
      });
      const queuedAnswer = await app.queueOrdinaryAnswer({
        client,
        text: "Нашла подходящие варианты",
      });
      expect(await app.dialogueDebitCount(client.userId)).toBe(1);
      await app.recordOutboundDelivery({
        outbox: queuedAnswer,
        provider: "selarti",
        providerDeliveryEventId: "selarti-delivered-ac025-1",
        deliveredAt: at(3000),
      });
      expect(await app.dialogueDebitCount(client.userId)).toBe(2);
      expect(await app.balance(client.userId)).toBe(498);
      const matches = await app.searchVerifiedServices({
        query: "психолог",
        startsAfter: at(24 * 60 * 60 * 1000),
      });
      expect(matches.length).toBeGreaterThan(0);
      const catalogFacts = await app.verifiedCatalogFacts(
        matches[0]!.expertId,
        matches[0]!.slotId,
      );
      expect(catalogFacts).toMatchObject({
        expertActive: true,
        expertVerified: true,
        serviceActive: true,
      });
      const reservation = await app.reserve({
        client,
        slotId: matches[0]!.slotId,
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
      expect(await app.bookingNotificationFacts(reservation.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: "client.booking_confirmed",
            charge: 0,
          }),
          expect.objectContaining({
            reason: "telegram.booking_cancelled",
            charge: 0,
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

      app.setProviderStatusForNegativeControl(reservation.id, "booked");
      expect((await app.runReconciliation()).mismatches).toEqual([
        expect.objectContaining({ reservationId: reservation.id }),
      ]);

      await app.corruptBookingNotificationForNegativeControl(reservation.id);
      await expect(
        app.assertBookingNotifications(reservation.id),
      ).rejects.toThrow("Authoritative booking notifications");

      await app.removeQueuedSendForNegativeControl(queuedAnswer.id);
      await expect(
        app.recordOutboundDelivery({
          outbox: queuedAnswer,
          provider: "selarti",
          providerDeliveryEventId: "selarti-delivered-ac025-negative",
          deliveredAt: at(4000),
        }),
      ).rejects.toThrow("Provider send path has no authoritative outbox row");
    } finally {
      await app.close();
    }
  });
}, 120_000);
