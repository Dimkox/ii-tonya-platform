import { describe, expect, it, vi } from "vitest";
import { createExpertEarlyBirdService } from "./expert-early-bird-service.js";
import { earlyBirdPositiveButton } from "./routes/early-bird-message.js";

const offerId = "00000000-0000-4000-8000-000000000001";
const input = {
  botId: "123",
  botKey: "promo-key",
  telegramUserId: "456",
  chatId: "456",
  updateId: 17,
  text: "",
  callbackData: earlyBirdPositiveButton(offerId, 2, null).callback_data,
};
const offer = {
  id: offerId,
  revision: 3,
  name: "Анна",
  clientStart: "2027-01-10T21:00:00.000Z",
  discountEligible: true,
};
const command = { ...input, callbackData: `eb:${offerId}:3:now` };

const makeWave = (
  authority: Parameters<typeof createExpertEarlyBirdService>[0],
) =>
  createExpertEarlyBirdService(authority, {
    phase: "WAVE_1_EARLY_BIRD",
    enrollmentStartMs: Date.parse("2026-11-01T00:00:00+03:00"),
    clientStartMs: Date.parse(offer.clientStart),
    now: () => Date.parse("2026-11-10T00:00:00Z"),
  });

describe("wave one expert sales", () => {
  it("keeps wave disabled outside its configured phase and enrollment period", () => {
    const now = Date.parse("2026-10-31T20:59:59.999Z");
    const opts = {
      phase: "WAVE_1_EARLY_BIRD" as const,
      enrollmentStartMs: now + 1,
      clientStartMs: Date.parse(offer.clientStart),
      now: () => now,
    };
    expect(
      createExpertEarlyBirdService(
        { present: vi.fn(), choose: vi.fn() },
        opts,
      ).isActive(),
    ).toBe(false);
    expect(
      createExpertEarlyBirdService(
        { present: vi.fn(), choose: vi.fn() },
        { ...opts, enrollmentStartMs: now, phase: "PUBLIC_LAUNCH" },
      ).isActive(),
    ).toBe(false);
    expect(
      createExpertEarlyBirdService(
        { present: vi.fn(), choose: vi.fn() },
        { ...opts, enrollmentStartMs: now },
      ).isActive(),
    ).toBe(true);
  });
  it("switches the wave off exactly at the configured client start", () => {
    let now = Date.parse("2027-01-10T20:59:59.999Z");
    const service = createExpertEarlyBirdService(
      { present: vi.fn(), choose: vi.fn() },
      {
        phase: "WAVE_1_EARLY_BIRD",
        clientStartMs: Date.parse(offer.clientStart),
        now: () => now,
      },
    );
    expect(service.isActive()).toBe(true);
    now += 1;
    expect(service.isActive()).toBe(false);
  });
  it("offers subscription checkout from the authoritative onboarding-only status", async () => {
    const current = vi.fn().mockResolvedValue({
      id: offerId,
      revision: 3,
      status: "ONBOARDING_ONLY",
      baseMonthlyMinor: "2000",
    });
    const service = makeWave({
      present: vi.fn(),
      choose: vi.fn(),
      current,
    });
    const { callbackData: _callbackData, ...textInput } = input;
    void _callbackData;
    const result = await service.handle({ ...textInput, text: "/my_tariff" });
    expect(current).toHaveBeenCalledWith(
      expect.objectContaining({ telegramUserId: "456" }),
    );
    expect(result).toMatchObject({
      status: "handled",
      text: expect.stringContaining("20 ₽"),
      replyMarkup: {
        inline_keyboard: [[{ callback_data: `eb:${offerId}:3:subscription` }]],
      },
    });
  });
  it("shows the paid tariff while waiting for launch", async () => {
    const current = vi.fn().mockResolvedValue({
      id: offerId,
      revision: 2,
      status: "FULLY_PREPAID_WITH_DISCOUNT",
      baseMonthlyMinor: "800000",
      lockedMonthlyMinor: "500000",
      clientStart: offer.clientStart,
    });
    const service = makeWave({
      present: vi.fn(),
      choose: vi.fn(),
      current,
    });
    const { callbackData: _callbackData, ...textInput } = input;
    void _callbackData;
    const result = await service.handle({ ...textInput, text: "/my_tariff" });
    expect(result).toMatchObject({
      status: "handled",
      text: expect.stringContaining("5000 ₽"),
    });
    expect(result?.status === "handled" && result.text).toContain(
      "11 января 2027 года",
    );
  });
  it("rejects offer dates that disagree with the configured launch", async () => {
    const present = vi
      .fn()
      .mockResolvedValue({ ...offer, clientStart: "2027-01-11T21:00:00.000Z" });
    expect(await makeWave({ present, choose: vi.fn() }).handle(input)).toEqual({
      status: "unavailable",
    });
  });
  it("rejects an unrenderable next revision before changing authority state", async () => {
    const present = vi.fn();
    const service = makeWave({ present, choose: vi.fn() });
    expect(
      await service.handle({
        ...input,
        callbackData: `ep:${Buffer.from(offerId.replaceAll("-", ""), "hex").toString("base64url")}:999999:s`,
      }),
    ).toEqual({ status: "rejected" });
    expect(present).not.toHaveBeenCalled();
  });
  it("passes the exact displayed grant into positive consent", async () => {
    const grantId = "00000000-0000-4000-8000-000000000002";
    const present = vi.fn().mockResolvedValue(offer);
    const service = makeWave({ present, choose: vi.fn() });
    const callbackData = earlyBirdPositiveButton(
      offerId,
      2,
      grantId,
    ).callback_data;
    expect((await service.handle({ ...input, callbackData }))?.status).toBe(
      "handled",
    );
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId,
        revision: 2,
        expectedGrantId: grantId,
      }),
    );
  });
  it("asks for a new calculation when price grant changes", async () => {
    const service = makeWave({
      present: vi.fn().mockRejectedValue(new Error("early_bird_price_changed")),
      choose: vi.fn(),
    });
    const result = await service.handle(input);
    expect(result).toMatchObject({
      status: "handled",
      text: expect.stringContaining("Цена изменилась"),
    });
  });
  it("renders dates and buttons only from the authoritative offer", async () => {
    const present = vi.fn().mockResolvedValue(offer);
    const choose = vi.fn();
    const result = await makeWave({
      present,
      choose,
    }).handle(input);
    expect(result).toMatchObject({
      status: "handled",
      text: expect.stringContaining("11 января 2027 года"),
    });
    expect(result?.status === "handled" && result.replyMarkup).toMatchObject({
      inline_keyboard: [
        [{ callback_data: `eb:${offerId}:3:now` }],
        [{ callback_data: `eb:${offerId}:3:later` }],
      ],
    });
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramUserId: "456",
        updateId: 17,
        offerId,
        revision: 2,
      }),
    );
    expect(choose).not.toHaveBeenCalled();
  });
  it("routes a bound choice to authority and shows exactly one invoice", async () => {
    const choose = vi.fn().mockResolvedValue({
      kind: "invoice",
      purpose: "combined",
      url: "https://yookassa.ru/checkout/test",
      totalMinor: "3000",
      onboardingMinor: "1000",
      subscriptionMinor: "2000",
      clientStart: offer.clientStart,
    });
    const result = await makeWave({
      present: vi.fn(),
      choose,
    }).handle(command);
    expect(choose).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId,
        revision: 3,
        choice: "now",
        telegramUserId: "456",
        updateId: 17,
      }),
    );
    expect(result).toMatchObject({
      status: "handled",
      text: expect.stringContaining("30 ₽"),
    });
    expect(result?.status === "handled" && result.text).toContain(
      "11 января 2027 года",
    );
  });
  it("allows an onboarding-only expert to obtain the authoritative base subscription invoice", async () => {
    const choose = vi.fn().mockResolvedValue({
      kind: "invoice",
      purpose: "subscription",
      url: "https://yookassa.ru/checkout/test",
      totalMinor: "2000",
      onboardingMinor: "0",
      subscriptionMinor: "2000",
      clientStart: offer.clientStart,
    });
    const result = await makeWave({
      present: vi.fn(),
      choose,
    }).handle({ ...input, callbackData: `eb:${offerId}:3:subscription` });
    expect(choose).toHaveBeenCalledWith(
      expect.objectContaining({
        choice: "subscription",
        offerId,
        revision: 3,
        telegramUserId: "456",
      }),
    );
    expect(result).toMatchObject({
      status: "handled",
      text: expect.stringContaining("20 ₽"),
    });
  });
  it("rejects an invoice purpose that does not match the selected action", async () => {
    const choose = vi.fn().mockResolvedValue({
      kind: "invoice",
      purpose: "subscription",
      url: "https://yookassa.ru/checkout",
      totalMinor: "3000",
      onboardingMinor: "1000",
      subscriptionMinor: "2000",
      clientStart: offer.clientStart,
    });
    expect(
      await makeWave({ present: vi.fn(), choose }).handle(command),
    ).toEqual({ status: "unavailable" });
  });
  it("rejects invoice dates that disagree with the configured launch", async () => {
    const choose = vi.fn().mockResolvedValue({
      kind: "invoice",
      purpose: "combined",
      url: "https://yookassa.ru/checkout",
      totalMinor: "3000",
      onboardingMinor: "1000",
      subscriptionMinor: "2000",
      clientStart: "2027-01-11T21:00:00.000Z",
    });
    const service = makeWave({ present: vi.fn(), choose });
    expect(await service.handle(command)).toEqual({ status: "unavailable" });
  });
  it("fails closed for stale choices and unsafe or mismatched payment links", async () => {
    const choose = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        kind: "invoice",
        purpose: "combined",
        url: "https://bad.example/checkout",
        totalMinor: "3000",
        onboardingMinor: "1000",
        subscriptionMinor: "2000",
        clientStart: offer.clientStart,
      })
      .mockResolvedValueOnce({
        kind: "invoice",
        purpose: "combined",
        url: "https://yookassa.ru/checkout",
        totalMinor: "3001",
        onboardingMinor: "1000",
        subscriptionMinor: "2000",
        clientStart: offer.clientStart,
      });
    const service = makeWave({ present: vi.fn(), choose });
    expect(await service.handle(command)).toEqual({ status: "rejected" });
    expect(await service.handle(command)).toEqual({ status: "unavailable" });
    expect(await service.handle(command)).toEqual({ status: "unavailable" });
  });
});

it("opens the verification form only when the wave authority confirms form admission", async () => {
  const choose = vi.fn().mockResolvedValue({ kind: "form" });
  expect(await makeWave({ present: vi.fn(), choose }).handle(command)).toEqual({
    status: "wave_form",
    start: true,
  });
});

it("routes later form inputs only after the authority confirms the same user's form admission", async () => {
  const formEligible = vi.fn().mockResolvedValue(true);
  const service = makeWave({ present: vi.fn(), choose: vi.fn(), formEligible });
  const next = { ...input, callbackData: "rv:form", text: "" };
  expect(await service.handle(next)).toEqual({
    status: "wave_form",
    start: false,
  });
  expect(formEligible).toHaveBeenCalledWith(next);
  formEligible.mockResolvedValueOnce(false);
  expect(await service.handle(next)).toBeNull();
});

it("does not feed a receipt command into the questionnaire", async () => {
  const formEligible = vi.fn().mockResolvedValue(true);
  const service = makeWave({ present: vi.fn(), choose: vi.fn(), formEligible });
  const { callbackData: _ignored, ...textInput } = input;
  void _ignored;
  expect(
    await service.handle({
      ...textInput,
      text: "/receipt private@example.invalid",
    }),
  ).toBeNull();
  expect(formEligible).not.toHaveBeenCalled();
});

it("permits legacy routing only after the scope is authoritatively classified", async () => {
  const legacyEligible = vi.fn().mockResolvedValue(true);
  const service = makeWave({
    present: vi.fn(),
    choose: vi.fn(),
    legacyEligible,
  });
  expect(await service.handle({ ...input, callbackData: "rv:legacy" })).toEqual(
    { status: "wave_legacy" },
  );
  expect(legacyEligible).toHaveBeenCalledOnce();
  expect(
    await service.handle({ ...input, callbackData: `eb:${offerId}:3:now` }),
  ).toEqual({ status: "rejected" });
});

it("allows only authoritative continuation when public phase is active", async () => {
  const formContinuationEligible = vi.fn().mockResolvedValue(true);
  const service = createExpertEarlyBirdService(
    { present: vi.fn(), choose: vi.fn(), formContinuationEligible },
    {
      phase: "PUBLIC_LAUNCH",
      clientStartMs: Date.parse(offer.clientStart),
      now: () => Date.parse("2027-01-12T00:00:00Z"),
    },
  );
  expect(service.isActive()).toBe(false);
  expect(await service.continueForm(input)).toBe(true);
  expect(formContinuationEligible).toHaveBeenCalledWith(input);
});
