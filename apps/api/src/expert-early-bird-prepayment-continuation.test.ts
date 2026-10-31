import { expect, it, vi } from "vitest";
import { createExpertEarlyBirdService } from "./expert-early-bird-service.js";
const input = {
  botId: "1",
  botKey: "wave",
  telegramUserId: "123",
  chatId: "123",
  updateId: 1,
  text: "/my_tariff",
};
const start = Date.parse("2027-01-11T00:00:00+03:00");
const invoice = {
  kind: "invoice" as const,
  purpose: "combined" as const,
  totalMinor: "3000",
  onboardingMinor: "1000",
  subscriptionMinor: "2000",
  url: "https://yoomoney.ru/continuation",
  clientStart: new Date(start).toISOString(),
};
function fixture(choice: "now" | "later" = "now", approved = true) {
  const authority = {
    present: vi.fn(),
    choose: vi.fn(),
    current: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      revision: 2,
      status: approved
        ? ("APPROVED_UNPAID" as const)
        : ("AWAITING_APPROVAL" as const),
      choice,
      baseMonthlyMinor: "2000",
    })),
    continuePayment: vi.fn(async () => ({
      choice,
      outcome:
        choice === "now"
          ? invoice
          : {
              ...invoice,
              purpose: "onboarding" as const,
              totalMinor: "1000",
              subscriptionMinor: "0",
            },
    })),
  };
  const service = createExpertEarlyBirdService(authority, {
    phase: "WAVE_1_EARLY_BIRD",
    clientStartMs: start,
    enrollmentStartMs: Date.parse("2026-11-01T00:00:00+03:00"),
    now: () => Date.parse("2026-11-02T00:00:00Z"),
  });
  return { authority, service };
}
it.each(["now", "later"] as const)(
  "shows the saved %s choice after approval without preparing or sending from status",
  async (choice) => {
    const f = fixture(choice);
    const reply = await f.service.handle(input);
    expect(reply).toMatchObject({
      status: "handled",
      replyMarkup: { inline_keyboard: [[{ callback_data: "eb:continue" }]] },
    });
    expect(JSON.stringify(reply)).toContain(
      choice === "now" ? "единый" : "онбординг",
    );
    expect(f.authority.continuePayment).not.toHaveBeenCalled();
    expect(f.authority.choose).not.toHaveBeenCalled();
  },
);
it("keeps review pending visible and offers no pay action", async () => {
  const f = fixture("now", false);
  expect(await f.service.handle(input)).toMatchObject({ status: "handled" });
  expect(JSON.stringify(await f.service.handle(input))).not.toContain(
    "eb:continue",
  );
  expect(f.authority.continuePayment).not.toHaveBeenCalled();
});
it.each(["now", "later"] as const)(
  "continues authenticated %s payment through its exact validated invoice",
  async (choice) => {
    const f = fixture(choice);
    const click = { ...input, text: "", callbackData: "eb:continue" };
    const reply = await f.service.handle(click);
    expect(f.authority.continuePayment).toHaveBeenCalledWith(click);
    expect(f.authority.choose).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ status: "handled" });
    expect(JSON.stringify(reply)).toContain(
      choice === "now" ? "10 ₽ + тариф 20 ₽ = 30 ₽" : "Счёт за онбординг: 10 ₽",
    );
  },
);
it("gives receipt and current-tariff guidance when approved checkout has no active receipt", async () => {
  const f = fixture();
  f.authority.continuePayment.mockResolvedValueOnce({
    choice: "now",
    outcome: { kind: "pending" },
  } as never);
  const reply = await f.service.handle({
    ...input,
    text: "",
    callbackData: "eb:continue",
  });
  expect(reply).toMatchObject({ status: "handled" });
  expect(JSON.stringify(reply)).toContain("/receipt");
  expect(JSON.stringify(reply)).toContain("/my_tariff");
});
it.each([
  {
    ...invoice,
    purpose: "onboarding",
    totalMinor: "1000",
    subscriptionMinor: "0",
  },
  { ...invoice, totalMinor: "3001" },
  { ...invoice, url: "https://evil.example/pay" },
])("refuses inconsistent continuation invoice %#", async (altered) => {
  const f = fixture();
  f.authority.continuePayment.mockResolvedValueOnce({
    choice: "now",
    outcome: altered,
  } as never);
  expect(
    await f.service.handle({ ...input, text: "", callbackData: "eb:continue" }),
  ).toEqual({ status: "unavailable" });
});
