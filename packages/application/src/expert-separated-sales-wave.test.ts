import { describe, expect, it, vi } from "vitest";
import { createExpertSeparatedSalesService } from "./expert-separated-sales-service.js";

const scope = {
  botId: "bot",
  botKey: "key",
  telegramUserId: "42",
  chatId: "42",
  updateId: 1,
  text: "",
  callbackData: "eb:00000000-0000-4000-8000-000000000001:1:now",
};
const make = (
  wave?: Pick<
    NonNullable<
      Parameters<typeof createExpertSeparatedSalesService>[0]["wave"]
    >,
    "handle"
  >,
) => {
  const transition = vi.fn().mockResolvedValue(null);
  const form = { handle: vi.fn().mockResolvedValue(null) };
  return {
    transition,
    form,
    service: createExpertSeparatedSalesService({
      repository: { transition },
      form,
      ...(wave
        ? { wave: { ...wave, isActive: vi.fn().mockResolvedValue(true) } }
        : {}),
    }),
  };
};

describe("early bird routing", () => {
  it("returns to normal sales at the launch boundary", async () => {
    const transition = vi.fn().mockResolvedValue(null);
    const handle = vi.fn();
    const service = createExpertSeparatedSalesService({
      repository: { transition },
      form: { handle: vi.fn() },
      wave: { isActive: async () => false, handle },
    });
    const input = {
      ...scope,
      callbackData: "ss:00000000-0000-4000-8000-000000000001:1:positive",
    };
    expect(await service.handle(input)).toBeNull();
    expect(handle).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledOnce();
  });
  it("fails closed for a wave callback when wave authority is unavailable", async () => {
    const { service, transition } = make();
    expect(await service.handle(scope)).toEqual({ status: "rejected" });
    expect(transition).not.toHaveBeenCalled();
  });
  it("lets the wave authority handle its callback without calling the old onboarding flow", async () => {
    const handle = vi
      .fn()
      .mockResolvedValue({ status: "handled", text: "Счёт готов" });
    const { service, transition, form } = make({ handle });
    expect(await service.handle(scope)).toEqual({
      status: "handled",
      text: "Счёт готов",
    });
    expect(handle).toHaveBeenCalledWith(scope);
    expect(transition).not.toHaveBeenCalled();
    expect(form.handle).not.toHaveBeenCalled();
  });
  it("does not fall back to legacy selection when the active wave handler declines it", async () => {
    const { service, transition } = make({
      handle: vi.fn().mockResolvedValue(null),
    });
    const input = {
      ...scope,
      callbackData: "ss:00000000-0000-4000-8000-000000000001:1:positive",
    };
    expect(await service.handle(input)).toEqual({ status: "unavailable" });
    expect(transition).not.toHaveBeenCalled();
  });
  it("allows category selection to use the existing qualification flow", async () => {
    const { service, transition } = make({
      handle: vi.fn().mockResolvedValue(null),
    });
    const input = {
      ...scope,
      callbackData: "sb:00000000-0000-4000-8000-000000000001",
    };
    expect(await service.handle(input)).toBeNull();
    expect(transition).toHaveBeenCalledOnce();
  });
  it("does not route wave receipt commands to legacy payment handling", async () => {
    const { service, transition } = make({
      handle: vi.fn().mockResolvedValue(null),
    });
    const { callbackData: _callbackData, ...textScope } = scope;
    void _callbackData;
    const input = { ...textScope, text: "/receipt synthetic@example.invalid" };
    expect(await service.handle(input)).toEqual({ status: "unavailable" });
    expect(transition).not.toHaveBeenCalled();
  });
  it("rejects unrecognized wave callbacks even if the authority declines them", async () => {
    const { service, transition } = make({
      handle: vi.fn().mockResolvedValue(null),
    });
    expect(await service.handle(scope)).toEqual({ status: "rejected" });
    expect(transition).not.toHaveBeenCalled();
  });
});

it("opens the actual verification form after an authorized wave choice", async () => {
  const form = {
    handle: vi.fn().mockResolvedValue({ status: "handled", text: "Анкета" }),
  };
  const transition = vi.fn();
  const service = createExpertSeparatedSalesService({
    repository: { transition },
    form: { handle: vi.fn() },
    waveForm: form,
    wave: {
      isActive: () => true,
      handle: vi.fn().mockResolvedValue({ status: "wave_form", start: true }),
    },
  });
  expect(await service.handle(scope)).toEqual({
    status: "handled",
    text: "Анкета",
  });
  expect(form.handle).toHaveBeenCalledWith(
    expect.objectContaining({
      text: "/verification",
      telegramUserId: scope.telegramUserId,
      updateId: scope.updateId,
    }),
  );
  expect(form.handle.mock.calls[0]![0]).not.toHaveProperty("callbackData");
  expect(transition).not.toHaveBeenCalled();
});

it("passes subsequent verified wave-form inputs through without the legacy selection path", async () => {
  const form = {
    handle: vi
      .fn()
      .mockResolvedValue({ status: "handled", text: "Следующий вопрос" }),
  };
  const transition = vi.fn();
  const service = createExpertSeparatedSalesService({
    repository: { transition },
    form: { handle: vi.fn() },
    waveForm: form,
    wave: {
      isActive: () => true,
      handle: vi.fn().mockResolvedValue({ status: "wave_form", start: false }),
    },
  });
  const input = { ...scope, text: "ответ", callbackData: "rv:form" };
  expect(await service.handle(input)).toEqual({
    status: "handled",
    text: "Следующий вопрос",
  });
  expect(form.handle).toHaveBeenCalledWith(input);
  expect(transition).not.toHaveBeenCalled();
});

it("does not expose legacy promotion text when a wave form is not admitted", async () => {
  const { service, transition } = make({
    handle: vi.fn().mockResolvedValue(null),
  });
  const { callbackData: _ignored, ...textScope } = scope;
  void _ignored;
  expect(await service.handle({ ...textScope, text: "ответ" })).toEqual({
    status: "unavailable",
  });
  expect(transition).not.toHaveBeenCalled();
});

it("lets a newly registered wave applicant see the qualification menu on /start", async () => {
  const transition = vi.fn().mockResolvedValue({
    id: "",
    revision: 0,
    state: "qualification",
    tariffs: [],
    replay: false,
  });
  const service = createExpertSeparatedSalesService({
    repository: { transition },
    form: { handle: vi.fn() },
    wave: { isActive: () => true, handle: vi.fn().mockResolvedValue(null) },
  });
  const { callbackData: _ignored, ...textScope } = scope;
  void _ignored;
  const result = await service.handle({ ...textScope, text: "/start" });
  expect(result).toMatchObject({
    status: "handled",
    text: expect.stringContaining("базовой цены"),
  });
  expect(transition).toHaveBeenCalledOnce();
});

it("does not display legacy prices when an existing wave user starts again", async () => {
  const transition = vi.fn().mockResolvedValue({
    id: "id",
    revision: 1,
    state: "promotion",
    baseMonthlyMinor: "999000",
    monthlyPriceMinor: "500000",
    standardOnly: false,
    replay: false,
  });
  const service = createExpertSeparatedSalesService({
    repository: { transition },
    form: { handle: vi.fn() },
    wave: { isActive: () => true, handle: vi.fn().mockResolvedValue(null) },
  });
  const { callbackData: _ignored, ...textScope } = scope;
  void _ignored;
  expect(await service.handle({ ...textScope, text: "/start" })).toEqual({
    status: "unavailable",
  });
});

it("routes an authority-confirmed legacy user through the legacy form during wave", async () => {
  const transition = vi.fn().mockResolvedValue({
    id: "id",
    revision: 1,
    state: "form",
    selectedTotalMinor: "900000",
    termMonths: 1,
    replay: false,
  });
  const form = {
    handle: vi
      .fn()
      .mockResolvedValue({ status: "handled", text: "Legacy form" }),
  };
  const service = createExpertSeparatedSalesService({
    repository: { transition },
    form,
    wave: {
      isActive: () => true,
      handle: vi.fn().mockResolvedValue({ status: "wave_legacy" }),
    },
  });
  const input = { ...scope, callbackData: "rv:form" };
  expect(await service.handle(input)).toEqual({
    status: "handled",
    text: "Legacy form",
  });
  expect(form.handle).toHaveBeenCalledWith(input);
});

it("continues an already admitted wave form after public launch", async () => {
  const transition = vi.fn();
  const waveForm = {
    handle: vi.fn().mockResolvedValue({ status: "handled", text: "Wave form" }),
  };
  const service = createExpertSeparatedSalesService({
    repository: { transition },
    form: { handle: vi.fn() },
    waveForm,
    wave: {
      isActive: () => false,
      handle: vi.fn(),
      continueForm: vi.fn().mockResolvedValue(true),
    },
  });
  const input = { ...scope, callbackData: "rv:form" };
  expect(await service.handle(input)).toEqual({
    status: "handled",
    text: "Wave form",
  });
  expect(waveForm.handle).toHaveBeenCalledWith(input);
  expect(transition).not.toHaveBeenCalled();
});

it("keeps an existing legacy applicant's /start flow during the wave", async () => {
  const transition = vi.fn().mockResolvedValue({
    id: "id",
    revision: 1,
    state: "form",
    selectedTotalMinor: "900000",
    termMonths: 1,
    replay: false,
  });
  const form = {
    handle: vi
      .fn()
      .mockResolvedValue({ status: "handled", text: "Legacy form" }),
  };
  const service = createExpertSeparatedSalesService({
    repository: { transition },
    form,
    wave: {
      isActive: () => true,
      handle: vi.fn().mockResolvedValue({ status: "wave_legacy" }),
    },
  });
  const { callbackData: _ignored, ...textScope } = scope;
  void _ignored;
  expect(await service.handle({ ...textScope, text: "/start" })).toEqual({
    status: "handled",
    text: "Legacy form",
  });
});

it("routes an authority-approved soft-reject reapplication to the wave form after launch", async () => {
  const waveForm = {
    handle: vi
      .fn()
      .mockResolvedValue({ status: "handled", text: "Повторная анкета" }),
  };
  const continueForm = vi.fn().mockResolvedValue(true);
  const service = createExpertSeparatedSalesService({
    repository: { transition: vi.fn() },
    form: { handle: vi.fn() },
    waveForm,
    wave: { isActive: () => false, handle: vi.fn(), continueForm },
  });
  const { callbackData: _ignored, ...textScope } = scope;
  void _ignored;
  const input = { ...textScope, text: "/reapply" };
  expect(await service.handle(input)).toEqual({
    status: "handled",
    text: "Повторная анкета",
  });
  expect(continueForm).toHaveBeenCalledWith(input);
  expect(waveForm.handle).toHaveBeenCalledWith(input);
});
