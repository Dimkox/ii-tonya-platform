import { expect, it } from "vitest";
import {
  renderResidentReviewMessage,
  residentTemplateKeys,
} from "./resident-review-message.js";
it("seeds five slots and keeps refund manual until genuine policy authority", () => {
  expect(residentTemplateKeys).toHaveLength(5);
  expect(() =>
    renderResidentReviewMessage({ key: "REJECT_POST_PAYMENT_REFUND" }),
  ).toThrow("resident_refund_policy_unavailable");
});
it("omits invented waitlist promise, renders neutral greeting and protected soft facts", () => {
  const r = renderResidentReviewMessage({
    key: "REJECT_NICHE_MISMATCH",
    reapplyAt: "2028-02-29T10:00:00.000Z",
  });
  expect(r.text).toContain("Здравствуйте");
  expect(r.text).not.toContain("сохранили ваши контакты");
  expect(r.text).toContain("через 1 месяц с даты решения");
  expect(() =>
    renderResidentReviewMessage({
      key: "REJECT_NICHE_MISMATCH",
      reapplyAt: "2028-02-29T10:00:00.000Z",
      editedText: "Возврат выполнен",
    }),
  ).toThrow("resident_protected_message");
});
it("numbers bounded questions and links the actual deadline without promising a fresh48hours", () => {
  const r = renderResidentReviewMessage({
    key: "REQ_INFO_GENERIC",
    questions: ["Опыт?", "Кейсы?"],
    deadline: "2026-10-28T10:00:00.000Z",
  });
  expect(r.text).toContain("1. Опыт?\n2. Кейсы?");
  expect(r.text).toContain("/verification");
  expect(r.text).not.toContain("Срок ответа: 48 часов");
  expect(() =>
    renderResidentReviewMessage({
      key: "REQ_INFO_GENERIC",
      questions: Array(11).fill("?"),
    }),
  ).toThrow();
});
