import { describe, expect, it } from "vitest";
import { renderWaitlistInvite, waitlistV4Text } from "./waitlist-funnel-v4.js";

describe("waitlist v4 content", () => {
  it("offers the known channel and renders both approved templates", () => {
    expect(
      waitlistV4Text.welcome("https://t.me/ii_tonya_experts_promo"),
    ).toContain("https://ii-tonya.ru/privacy");
    expect(
      waitlistV4Text.welcome("https://t.me/ii_tonya_experts_promo"),
    ).toContain("https://t.me/ii_tonya_experts_promo");
    for (const variant of [1, 2] as const) {
      const text = renderWaitlistInvite(
        variant,
        "REF_ABC123",
        "https://t.me/ii_tonya_experts_promo",
      );
      expect(text).toContain("https://t.me/ii_tonya_experts_promo");
      expect(text).toContain("REF_ABC123");
    }
    expect(
      renderWaitlistInvite(
        1,
        "REF_ABC123",
        "https://t.me/ii_tonya_experts_promo",
      ),
    ).toContain("умный ассистент");
    expect(
      renderWaitlistInvite(
        2,
        "REF_ABC123",
        "https://t.me/ii_tonya_experts_promo",
      ),
    ).toContain("Я сейчас подключаюсь");
  });
  it("contains the soft exit and waiting-for-launch language", () => {
    expect(waitlistV4Text.declined).toContain("Без согласия");
    expect(waitlistV4Text.wait).toContain("ПРОМОКОД");
    expect(waitlistV4Text.referralOffer).toContain("сетью экспертов");
  });
});
