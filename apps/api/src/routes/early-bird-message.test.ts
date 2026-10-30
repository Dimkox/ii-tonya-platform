import { describe, expect, it } from "vitest";
import { earlyBirdTermsMessage } from "./early-bird-message.js";

describe("early bird terms message", () => {
  it("explains the deferred launch, unified payment and alternative", () => {
    const result = earlyBirdTermsMessage(
      "Анна",
      new Date("2027-01-10T21:00:00Z"),
      true,
    );
    expect(result).toContain("Анна, отлично!");
    expect(result).toContain("11 января 2027 года");
    expect(result).toContain("НЕ НУЖНО публиковать анонсы");
    expect(result).toContain("единым чеком с онбордингом в течение 10 дней");
    expect(result).toContain("до 10 января");
    expect(result).toContain("базовой цене без скидки");
    expect(result).toContain("с даты старта");
  });
});

import {
  earlyBirdChoiceButtons,
  parseEarlyBirdChoice,
} from "./early-bird-message.js";

it("does not offer a discount once eligibility is lost", () => {
  const offerId = "00000000-0000-4000-8000-000000000001";
  const message = earlyBirdTermsMessage(
    "Анна",
    new Date("2027-01-10T21:00:00Z"),
    false,
  );
  const buttons = earlyBirdChoiceButtons(offerId, 4, false);
  expect(message).toContain("Скидка недоступна");
  expect(message).not.toContain("чтобы сохранить скидку");
  expect(buttons.flat().some((button) => button.text.includes("скидк"))).toBe(
    false,
  );
});

describe("early bird choice contract", () => {
  const offerId = "00000000-0000-4000-8000-000000000001";
  it("round trips both version-bound buttons", () => {
    const buttons = earlyBirdChoiceButtons(offerId, 4, true);
    expect(
      buttons.map((row) => parseEarlyBirdChoice(row[0]!.callback_data)),
    ).toEqual([
      { offerId, revision: 4, choice: "now" },
      { offerId, revision: 4, choice: "later" },
    ]);
    expect(
      buttons
        .flat()
        .every((button) => Buffer.byteLength(button.callback_data) <= 64),
    ).toBe(true);
  });
  it("rejects forged malformed callback payloads and invalid revisions", () => {
    expect(parseEarlyBirdChoice(`eb:${offerId}:04:now`)).toBeNull();
    expect(parseEarlyBirdChoice(`eb:${offerId}:1:other`)).toBeNull();
    expect(parseEarlyBirdChoice(`eb:${offerId}:1000000:now`)).toBeNull();
    expect(() => earlyBirdChoiceButtons(offerId, -1, true)).toThrow();
  });
});

it("binds the displayed grant identity to the positive callback within Telegram's limit", async () => {
  const { earlyBirdPositiveButton, parseEarlyBirdPositive } =
    await import("./early-bird-message.js");
  const offerId = "00000000-0000-4000-8000-000000000001";
  const grantId = "00000000-0000-4000-8000-000000000002";
  for (const grant of [grantId, null]) {
    const button = earlyBirdPositiveButton(offerId, 999998, grant);
    expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    expect(parseEarlyBirdPositive(button.callback_data)).toEqual({
      offerId,
      revision: 999998,
      grantId: grant,
    });
  }
});
