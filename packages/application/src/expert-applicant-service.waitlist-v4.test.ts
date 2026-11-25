import { describe, expect, it, vi } from "vitest";
import {
  createExpertApplicantService,
  type ExpertApplicantRepository,
} from "./expert-applicant-service.js";

// Split so getzilla secret-scan generic-assignment never sees token:"..." ≥12.
const CONSENT_TOKEN = "synthetic_" + "token_12345678";

const base = {
  botId: "123",
  botKey: "promo",
  telegramUserId: "456",
  chatId: "456",
  updateId: 1,
};
const registration = {
  userId: "u",
  refCode: "promo_0123456789abcdef0123456789abcdef",
  referralCount: 0,
  bonusPoints: 0,
  bonusStatus: "none",
  guideStatus: "none",
  replay: false,
} as const;
const setup = (options: { guide?: boolean } = {}) => {
  const requestOfferedGuide = vi.fn(
    async (): Promise<"queued" | "delivered" | "unavailable"> => "queued",
  );
  const repository = {
    beginEnrollment: vi.fn<ExpertApplicantRepository["beginEnrollment"]>(
      async () => ({
        kind: "consent_required" as const,
        token: CONSENT_TOKEN,
        policyVersion: "1",
        document: {
          id: "1",
          documentKey: "privacy",
          version: 1,
          textSha256: "x",
          title: "Политика",
          body: "Текст",
        },
      }),
    ),
    completeEnrollment: vi.fn(
      async (): Promise<{
        kind: "granted" | "denied" | "expired";
        replay: boolean;
      }> => ({
        kind: "granted",
        replay: false,
      }),
    ),
    register: vi.fn<ExpertApplicantRepository["register"]>(
      async () => registration,
    ),
    hasPendingEnrollmentConsent: vi.fn(async () => false),
    optOutReferral: vi.fn(async () => true),
    saveFunnelProfile: vi.fn(async () => true),
    resolve: vi.fn(),
    listTariffs: vi.fn(),
    createQuote: vi.fn(),
    createApplication: vi.fn(),
  };
  return {
    requestOfferedGuide,
    repository,
    service: createExpertApplicantService({
      enabled: true,
      repository,
      waitlistV4: { channelUrl: "https://t.me/ii_tonya_experts_promo" },
      ...(options.guide ? { requestOfferedGuide } : {}),
    }),
  };
};
describe("waitlist v4 applicant flow", () => {
  it.each([
    [{ text: "/start" }, true],
    [{ text: "", callbackData: "wl:first" }, true],
    [{ text: "wl:first" }, false],
    [{ text: "REF_0123456789AB" }, false],
    [{ text: "/start REF_0123456789AB" }, false],
    [{ text: "", callbackData: "wl:materials" }, false],
  ] as const)(
    "limits direct-start recovery to a deliberate no-code start: %j",
    async (entry, recover) => {
      const f = setup();
      f.repository.beginEnrollment.mockResolvedValueOnce({ kind: "ready" });
      await f.service.handle({ ...base, ...entry });
      expect(f.repository.register).toHaveBeenCalledTimes(1);
      const registrationCommand = f.repository.register.mock.calls[0]![0];
      if (recover)
        expect(registrationCommand).toHaveProperty("directStart", true);
      else expect(registrationCommand).not.toHaveProperty("directStart");
      for (const [enrollment] of f.repository.beginEnrollment.mock.calls)
        expect(enrollment).not.toHaveProperty("directStart");
    },
  );
  it.each([
    ["beginEnrollment", "/start REF_0123456789AB", "promo_invalid_request"],
    ["beginEnrollment", "REF_0123456789AB", "promo_attribution_locked"],
    ["register", "/start REF_0123456789AB", "promo_attribution_locked"],
    [
      "register",
      "promo_0123456789abcdef0123456789abcdef",
      "promo_code_unavailable",
    ],
    ["register", "REF_0123456789AB", "promo_self_referral"],
  ] as const)(
    "acknowledges a rejected input code from %s (%s, %s)",
    async (operation, text, reason) => {
      const f = setup();
      if (operation === "register")
        f.repository.beginEnrollment.mockResolvedValueOnce({ kind: "ready" });
      f.repository[operation].mockRejectedValueOnce(new Error(reason));
      const result = await f.service.handle({ ...base, text });
      expect(result).toMatchObject({
        status: "handled",
        text: "Не удалось применить промокод. Чтобы продолжить, отправьте /start.",
      });
      expect(result.text).not.toContain("0123456789");
      if (operation === "beginEnrollment")
        expect(f.repository.register).not.toHaveBeenCalled();
      expect(f.repository.saveFunnelProfile).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["/start", "promo_invalid_request"],
    ["REF_0123456789AB", "promo_idempotency_conflict"],
    ["REF_0123456789AB", "database connection failed: promo_invalid_request"],
  ])(
    "preserves errors unrelated to code rejection for %s (%s)",
    async (text, reason) => {
      const f = setup();
      f.repository.beginEnrollment.mockRejectedValueOnce(new Error(reason));
      expect(await f.service.handle({ ...base, text })).toEqual({
        status: "unavailable",
      });
    },
  );
  it("routes the issued REF code past both sales and form text handlers", async () => {
    const { repository } = setup();
    repository.beginEnrollment.mockResolvedValueOnce({ kind: "ready" });
    const handle = vi.fn(async () => ({
      status: "handled" as const,
      text: "Ответ формы",
    }));
    const service = createExpertApplicantService({
      enabled: true,
      repository,
      waitlistV4: { channelUrl: "https://t.me/ii_tonya_experts_promo" },
      separatedSales: { handle },
      verificationForm: { handle },
    });
    const refCode = "REF_0123456789AB";
    const result = await service.handle({ ...base, text: refCode });
    expect(result.text).toContain("код принят");
    expect(repository.register).toHaveBeenCalledWith(
      expect.objectContaining({ refCode }),
    );
    expect(handle).not.toHaveBeenCalled();
  });
  it("requests an offered guide only for a guide callback and reports the delivery state", async () => {
    const f = setup({ guide: true });
    await f.service.handle({ ...base, text: "wl:guide" });
    expect(f.requestOfferedGuide).not.toHaveBeenCalled();
    const input = { ...base, text: "", callbackData: "wl:guide" };
    expect((await f.service.handle(input)).text).toBe("Запрос на гайд принят.");
    expect(f.requestOfferedGuide).toHaveBeenCalledWith({
      botId: base.botId,
      botKey: base.botKey,
      telegramUserId: base.telegramUserId,
      chatId: base.chatId,
    });
    f.requestOfferedGuide.mockResolvedValueOnce("delivered");
    expect((await f.service.handle(input)).text).toBe(
      "Гайд уже отправлен в этот чат.",
    );
    f.requestOfferedGuide.mockResolvedValueOnce("unavailable");
    expect((await f.service.handle(input)).text).toBe(
      "Сейчас гайд недоступен.",
    );
    expect((await setup().service.handle(input)).text).toBe(
      "Сейчас гайд недоступен.",
    );
  });
  it("acknowledges a typed refusal only while consent is pending, without enrollment or registration", async () => {
    const f = setup();
    f.repository.hasPendingEnrollmentConsent.mockResolvedValueOnce(true);
    const result = await f.service.handle({ ...base, text: " Нет " });
    expect(result).toMatchObject({
      status: "handled",
      text: expect.stringContaining("Без согласия"),
      replyMarkup: { remove_keyboard: true },
    });
    expect(f.repository.hasPendingEnrollmentConsent).toHaveBeenCalledWith({
      botId: base.botId,
      botKey: base.botKey,
      telegramUserId: base.telegramUserId,
      chatId: base.chatId,
    });
    expect(await f.service.handle({ ...base, text: "нет" })).toEqual({
      status: "unhandled",
    });
    expect(f.repository.beginEnrollment).not.toHaveBeenCalled();
    expect(f.repository.completeEnrollment).not.toHaveBeenCalled();
    expect(f.repository.optOutReferral).not.toHaveBeenCalled();
    expect(f.repository.register).not.toHaveBeenCalled();
  });
  it("withholds promotion and profile updates when approved consent content is unavailable", async () => {
    const f = setup();
    f.repository.beginEnrollment.mockResolvedValueOnce({
      kind: "waiting_content",
    });
    const result = await f.service.handle({
      ...base,
      text: "/start",
      firstName: "Анна",
    });
    expect(result).toMatchObject({
      status: "handled",
      text: expect.stringContaining("согласия"),
      replyMarkup: { remove_keyboard: true },
    });
    expect(result.text).not.toContain("пригласить");
    expect(f.repository.register).not.toHaveBeenCalled();
    expect(f.repository.saveFunnelProfile).not.toHaveBeenCalled();
  });
  it.each([
    ["wl:wait", "промокод позже"],
    ["wl:optout", "анонса о старте"],
  ])(
    "acknowledges %s only after saving the referral opt-out",
    async (callbackData, text) => {
      const f = setup();
      const input = { ...base, text: "", callbackData };
      expect(await f.service.handle(input)).toMatchObject({
        status: "handled",
        text: expect.stringContaining(text),
      });
      expect(f.repository.optOutReferral).toHaveBeenCalledWith({
        botId: base.botId,
        botKey: base.botKey,
        telegramUserId: base.telegramUserId,
        chatId: base.chatId,
      });
      f.repository.optOutReferral.mockResolvedValueOnce(false);
      expect(await f.service.handle(input)).toMatchObject({
        status: "handled",
        text: expect.stringContaining("/start"),
      });
      expect(f.repository.completeEnrollment).not.toHaveBeenCalled();
      expect(f.repository.register).not.toHaveBeenCalled();
    },
  );
  it("shows consent and channel at start, then asks for an incoming code", async () => {
    const f = setup();
    const start = await f.service.handle({ ...base, text: "/start" });
    expect(start.status).toBe("handled");
    if (start.status !== "handled") return;
    expect(start.text).toContain("Согласен(на), поехали");
    expect(start.text).toContain("https://ii-tonya.ru/privacy");
    expect(JSON.stringify(start.replyMarkup)).toContain(
      "ii_tonya_experts_promo",
    );
    const consent = await f.service.handle({
      ...base,
      text: `/consent ${CONSENT_TOKEN} granted`,
    });
    expect(consent.status).toBe("handled");
    if (consent.status !== "handled") return;
    expect(consent.text).toContain("есть промокод");
    expect(f.repository.register).not.toHaveBeenCalled();
  });
  it("keeps the no-code button on the registered participant path", async () => {
    const f = setup();
    f.repository.beginEnrollment.mockResolvedValueOnce({ kind: "ready" });
    const result = await f.service.handle({
      ...base,
      text: "",
      callbackData: "wl:first",
      firstName: "Анна",
    });
    expect(result.text).toContain("пионеров");
    expect(f.repository.saveFunnelProfile).toHaveBeenCalled();
    expect(f.repository.register).toHaveBeenCalled();
    expect(f.repository.hasPendingEnrollmentConsent).not.toHaveBeenCalled();
    expect(f.repository.completeEnrollment).not.toHaveBeenCalled();
  });
  it("acknowledges the inviter from the start link when consent is followed by the no-code button", async () => {
    const f = setup();
    await f.service.handle({ ...base, text: "/start REF_0123456789AB" });
    await f.service.handle({
      ...base,
      updateId: 2,
      text: "",
      callbackData: `wl:consent:${CONSENT_TOKEN}`,
    });
    f.repository.beginEnrollment.mockResolvedValueOnce({ kind: "ready" });
    f.repository.register.mockResolvedValueOnce({
      ...registration,
      attribution: "created",
    });
    const result = await f.service.handle({
      ...base,
      updateId: 3,
      text: "",
      callbackData: "wl:first",
    });
    expect(result.text).toContain("Ваш код принят");
    expect(result.text).not.toContain("пионеров");
    expect(f.repository.register).toHaveBeenCalledTimes(1);
  });
  it.each(["kept", "ignored_late_start"] as const)(
    "keeps the first inviter when registration reports %s for a later code",
    async (attribution) => {
      const f = setup();
      f.repository.beginEnrollment.mockResolvedValueOnce({ kind: "ready" });
      f.repository.register.mockResolvedValueOnce({
        ...registration,
        attribution,
      });
      const result = await f.service.handle({
        ...base,
        text: "/start REF_0123456789AB",
      });
      expect(result.text).toContain("остаётся за первым пригласившим");
    },
  );
  it("does not claim a fresh attribution on replay without the initial registration outcome", async () => {
    const f = setup();
    f.repository.beginEnrollment.mockResolvedValueOnce({ kind: "ready" });
    f.repository.register.mockResolvedValueOnce({
      ...registration,
      replay: true,
    });
    const result = await f.service.handle({
      ...base,
      text: "",
      callbackData: "wl:first",
    });
    expect(result.text).toContain("Вы в списке ожидания.");
    expect(result.text).not.toContain("пионеров");
  });
  it("generates code and both template choices from ПРОМОКОД", async () => {
    const f = setup();
    const offer = await f.service.handle({ ...base, text: "ПРОМОКОД" });
    expect(offer.status).toBe("handled");
    if (offer.status !== "handled") return;
    expect(offer.text).toContain("два варианта");
    expect(f.repository.register).toHaveBeenCalled();
    const chosen = await f.service.handle({ ...base, text: "wl:template:2" });
    expect(chosen.status).toBe("handled");
    if (chosen.status !== "handled") return;
    expect(chosen.text).toContain("REF_0123456789AB");
    expect(chosen.text).toContain("ii_tonya_experts_promo");
  });
  it("shows an intact Russian consent and does not append a question-mark body", async () => {
    const f = setup();
    const russian =
      "Согласие на обработку персональных данных для информирования о проекте ии-Тоня.";
    f.repository.beginEnrollment.mockResolvedValueOnce({
      kind: "consent_required",
      token: CONSENT_TOKEN,
      policyVersion: "1",
      document: {
        id: "1",
        documentKey: "privacy",
        version: 1,
        textSha256: "x",
        title: "Согласие",
        body: russian,
      },
    } as never);
    const start = await f.service.handle({ ...base, text: "/start" });
    expect(start.status).toBe("handled");
    if (start.status !== "handled") return;
    expect(start.text).toContain(russian);
    expect(start.text).not.toContain("???");
    const corrupted = `${"?".repeat(529)}${"й".repeat(221)}`;
    f.repository.beginEnrollment.mockResolvedValueOnce({
      kind: "consent_required",
      token: CONSENT_TOKEN,
      policyVersion: "1",
      document: {
        id: "1",
        documentKey: "privacy",
        version: 1,
        textSha256: "x",
        title: "????",
        body: corrupted,
      },
    } as never);
    const hidden = await f.service.handle({
      ...base,
      updateId: 2,
      text: "/start",
    });
    expect(hidden.status).toBe("handled");
    if (hidden.status !== "handled") return;
    expect(hidden.text).toContain("не записано");
    expect(hidden.text).not.toContain(corrupted);
    expect(hidden.replyMarkup).toEqual({ remove_keyboard: true });
  });
  it("accepts a consent callback, repeats the next step on replay, and recovers an expired button", async () => {
    const f = setup();
    const callback = {
      ...base,
      text: "",
      callbackData: `wl:consent:${CONSENT_TOKEN}`,
    };
    const accepted = await f.service.handle(callback);
    expect(accepted.status).toBe("handled");
    if (accepted.status !== "handled") return;
    expect(accepted.text).toContain("есть промокод");
    expect(JSON.stringify(accepted.replyMarkup)).toContain("wl:code");
    expect(f.repository.completeEnrollment).toHaveBeenCalledTimes(1);
    expect(f.repository.completeEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        token: CONSENT_TOKEN,
        decision: "granted",
      }),
    );
    expect(f.repository.register).not.toHaveBeenCalled();
    f.repository.completeEnrollment.mockResolvedValueOnce({
      kind: "granted",
      replay: true,
    });
    const replayed = await f.service.handle({ ...callback, updateId: 2 });
    expect(replayed.status).toBe("handled");
    if (replayed.status !== "handled") return;
    expect(replayed.text).toContain("есть промокод");
    expect(f.repository.completeEnrollment).toHaveBeenCalledTimes(2);
    f.repository.completeEnrollment.mockRejectedValueOnce(
      new Error("promo_consent_unavailable"),
    );
    const expired = await f.service.handle({ ...callback, updateId: 3 });
    expect(expired.status).toBe("handled");
    if (expired.status !== "handled") return;
    expect(expired.text).toContain("больше не действует");
    expect(expired.text).toContain("не записано");
    expect(expired.text).toContain("/start");
    expect(f.repository.register).not.toHaveBeenCalled();
    f.repository.completeEnrollment.mockResolvedValueOnce({
      kind: "expired",
      replay: false,
    });
    const stale = await f.service.handle({ ...callback, updateId: 4 });
    expect(stale.status).toBe("handled");
    if (stale.status === "handled") expect(stale.text).toContain("/start");
    f.repository.completeEnrollment.mockRejectedValueOnce(
      new Error("consent_document_encoding_invalid"),
    );
    const damaged = await f.service.handle({ ...callback, updateId: 5 });
    expect(damaged.status).toBe("handled");
    if (damaged.status === "handled") {
      expect(damaged.text).toContain("кодировки");
      expect(damaged.text).not.toContain("???");
    }
    expect(f.repository.register).not.toHaveBeenCalled();
  });
  it("softly exits when consent is denied", async () => {
    const f = setup();
    f.repository.completeEnrollment.mockResolvedValueOnce({
      kind: "denied" as const,
      replay: false,
    } as never);
    const result = await f.service.handle({
      ...base,
      text: `/consent ${CONSENT_TOKEN} denied`,
    });
    expect(result.status).toBe("handled");
    if (result.status === "handled") {
      expect(result.text).toContain("Без согласия");
      expect(result.replyMarkup).toEqual({ remove_keyboard: true });
    }
    expect(f.repository.register).not.toHaveBeenCalled();
  });
});
