import { expect, it } from "vitest";
import { scheduledMainInput } from "./expert-scheduled-main-checkout.js";

it("accepts only opaque stored schedule/quote identities, never financial or Telegram facts", () => {
  const scheduleId = "11111111-1111-4111-8111-111111111111";
  const quoteId = "22222222-2222-4222-8222-222222222222";
  expect(scheduledMainInput(scheduleId, quoteId)).toEqual({
    scheduleId,
    quoteId,
  });
  for (const value of [null, "", {}, { userId: scheduleId }, `${scheduleId}\n`])
    expect(() => scheduledMainInput(value, quoteId)).toThrow(
      "card_main_invalid_request",
    );
  expect(() => scheduledMainInput(scheduleId, null)).toThrow(
    "card_main_invalid_request",
  );
});
