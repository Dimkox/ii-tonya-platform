import { expect, it } from "vitest";
import { renderBookingChoices } from "./booking-view.js";
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
