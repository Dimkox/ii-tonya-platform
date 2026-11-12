import { describe, expect, it } from "vitest";
import { lifecycleNoticeText } from "../../../packages/db/src/repositories/lifecycle-scheduler-repository.js";
import { selectLifecycleKinds } from "./main.js";

const base = {
  clientMessagingConsentPolicyVersion: "client-messaging-v1",
  clientTelegramBotKey: "client-test",
};

describe("selectLifecycleKinds (SCRUM-512)", () => {
  it("is off when every lifecycle flag is off", () => {
    expect(
      selectLifecycleKinds({ ...base, features: {} } as never),
    ).toBeUndefined();
  });
  it("enables only the flagged kinds", () => {
    expect(
      selectLifecycleKinds({
        ...base,
        features: { lifecycleFeedback: true },
      } as never),
    ).toEqual({
      reminders: false,
      checkups: false,
      feedback: true,
      couponNotices: false,
    });
  });
  it("fails closed without messaging capability", () => {
    expect(() =>
      selectLifecycleKinds({ features: { lifecycleCheckups: true } } as never),
    ).toThrow("lifecycle_messaging_capability_unavailable");
  });
});

describe("lifecycleNoticeText", () => {
  it("renders each non-booking kind", () => {
    expect(lifecycleNoticeText("weekly_checkup")).toContain("Как у вас дела");
    expect(lifecycleNoticeText("post_visit_feedback")).toContain("отзыв");
    expect(
      lifecycleNoticeText("coupon_expiry_7d", {
        expiresAt: new Date("2026-12-01T10:00:00Z"),
        amountMinor: "150000",
        timezone: "Europe/Moscow",
      }),
    ).toBe("Напоминаю: ваш купон на 1500 ₽ сгорит через 7 дней (01.12.2026).");
    expect(lifecycleNoticeText("coupon_expiry_14d")).toContain("14 дней");
  });
});
