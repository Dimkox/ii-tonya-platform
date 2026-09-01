import { describe, expect, it } from "vitest";

import {
  renderExpertReferralSummary,
  renderExpertResidencyQuote,
} from "./telegram-adapter.js";

describe("Telegram expert referral rendering", () => {
  it("renders only masked code state and unchanged decimal strings", () => {
    const rendered = renderExpertReferralSummary({
      code: { status: "redeemed", maskedSuffix: "…A1B2" },
      spendableBalanceMinor: "000100000",
      reservedBalanceMinor: "25000",
      debtMinor: "5000",
      nearestExpiryAt: "2027-08-01T00:00:00.000Z",
    });
    expect(rendered).toContain("…A1B2");
    expect(rendered).toContain("000100000");
    expect(rendered).toContain("25000");
    expect(rendered).toContain("5000");
    expect(rendered).toContain("2027-08-01T00:00:00.000Z");
  });

  it("renders the exact server quote without calculating money", () => {
    const rendered = renderExpertResidencyQuote({
      tariffVersionId: "00000000-0000-4000-8000-000000001302",
      displayName: "Expert month",
      description: "30 days",
      priceMinor: "200001",
      currency: "RUB",
      durationSeconds: 2_592_000,
      creditMinor: "100000",
      cashMinor: "100001",
    });
    expect(rendered).toContain("200001 RUB");
    expect(rendered).toContain("100000");
    expect(rendered).toContain("100001");
  });

  it.each([
    { spendableBalanceMinor: "1.00" },
    { debtMinor: "-1" },
    { nearestExpiryAt: "tomorrow" },
    { code: { status: "issued", maskedSuffix: "PLAINTEXT-CODE" } },
  ])("rejects unsafe summary rendering input %#", (mutation) => {
    expect(() =>
      renderExpertReferralSummary({
        code: { status: "none", maskedSuffix: null },
        spendableBalanceMinor: "0",
        reservedBalanceMinor: "0",
        debtMinor: "0",
        nearestExpiryAt: null,
        ...mutation,
      } as never),
    ).toThrow("invalid_expert_referral_view");
  });
});
