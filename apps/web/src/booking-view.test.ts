import { expect, it } from "vitest";
import { bookingStateText, renderBookingChoices } from "./booking-view.js";
const card = {
  displayName: "<script>private</script>",
  serviceCode: "career",
  language: "ru",
  availability: "fresh_slots" as const,
  slots: [
    {
      startsAt: "2026-10-10T12:00:00.000Z",
      choiceHandle: `ch1.${"A".repeat(43)}`,
    },
  ],
};
it("offers an explicit reservation only for a protected fresh slot and escapes expert text", () => {
  const html = renderBookingChoices([card], true);
  expect(html).toContain("data-reserve");
  expect(html).toContain("Зарезервировать");
  expect(html).toContain("Europe/Moscow");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="?');
});
it("never makes catalogue-only slots actionable", () => {
  const html = renderBookingChoices(
    [{ ...card, availability: "catalog_only" }],
    true,
  );
  expect(html).not.toContain("data-reserve");
  expect(html).toContain("Нет доступного времени");
});
it("shows an honest empty catalogue and reserve-disabled state", () => {
  expect(renderBookingChoices([], true)).toContain("Нет доступного времени");
  expect(renderBookingChoices([card], false)).not.toContain("data-reserve");
});
it("shows the service offer on the card and in the booking confirmation", () => {
  const html = renderBookingChoices(
    [
      {
        ...card,
        priceMinor: 300_000,
        currency: "RUB",
        format: "hybrid",
        location: "Казань",
      },
    ],
    true,
  );
  expect(html).toContain("3 000 ₽ · Онлайн/офлайн · Казань");
  expect(
    bookingStateText({
      bookingHandle: `bk1.${"A".repeat(43)}`,
      state: "booked",
      startsAt: "2026-10-10T12:00:00.000Z",
      reservedUntil: "2026-10-10T11:00:00.000Z",
      priceMinor: 300_000,
      currency: "RUB",
      format: "online",
    }),
  ).toBe(
    "Встреча подтверждена. Статус оплаты здесь не определяется. 3 000 ₽ · Онлайн",
  );
  expect(
    bookingStateText({
      bookingHandle: `bk1.${"A".repeat(43)}`,
      state: "booked",
      startsAt: "2026-10-10T12:00:00.000Z",
      reservedUntil: "2026-10-10T11:00:00.000Z",
    }),
  ).toBe("Встреча подтверждена. Статус оплаты здесь не определяется.");
});
it("uses the approved native service title while keeping the stable code as binding data", () => {
  const native = {
    ...card,
    serviceCode: "resident_0123456789",
    serviceTitle: "Разбор задач",
  };
  const html = renderBookingChoices([native], true);
  expect(html).toContain("Разбор задач");
  expect(html).not.toContain("resident_0123456789");
  expect(html).toContain('data-reserve="0:0"');
});
