import { expect, it } from "vitest";
import { createClientCatalogSourceReader } from "./client-catalog-outbox.js";
const now = new Date("2026-11-01T00:00:00Z");
it("native validity discovers approved service titles and binds choices without provider observations", async () => {
  const source = createClientCatalogSourceReader(
    {
      listPublicServices: async () => [
        {
          sourceKey: "00000000-0000-4000-8000-000000000001",
          displayName: "Анна",
          serviceCode: "resident_stable",
          serviceTitle: "Разбор задач",
          language: "ru",
        },
      ],
    },
    {
      read: async () => ({
        kind: "complete",
        slots: [
          {
            localSlotId: "00000000-0000-4000-8000-000000000002",
            sourceOrder: "1",
            startsAt: new Date("2026-11-03T10:00:00Z"),
            observedAt: null,
            nativeValidUntil: new Date("2026-11-30T21:00:00Z"),
            remainingCapacity: 1,
          },
        ],
      }),
    },
    {},
  );
  const result = await source.listBookingAware!({
    databaseNow: now,
    requestExpiresAt: new Date("2026-11-01T00:05:00Z"),
  });
  expect(result.cards[0]).toMatchObject({
    serviceTitle: "Разбор задач",
    availability: "fresh_slots",
  });
  expect(result.choices).toHaveLength(1);
  expect(result.choices[0]!.expiresAt.toISOString()).toBe(
    "2026-11-01T00:05:00.000Z",
  );
});
