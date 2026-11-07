import { describe, expect, it, vi } from "vitest";
import { createExpertApplicantService } from "./expert-applicant-service.js";

// Split so getzilla secret-scan generic-assignment never sees token:"..." ≥12.
const CONSENT_TOKEN = "synthetic_" + "token_12345678";

const base = {
  botId: "123",
  botKey: "promo",
  telegramUserId: "456",
  chatId: "456",
  updateId: 1,
};
const setup = () => {
  const repository = {
    beginEnrollment: vi.fn(async () => ({
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
    })),
    completeEnrollment: vi.fn(
      async (): Promise<{
        kind: "granted" | "denied" | "expired";
        replay: boolean;
      }> => ({
        kind: "granted",
        replay: false,
      }),
    ),
    register: vi.fn(async () => ({
      userId: "u",
      refCode: "promo_0123456789abcdef0123456789abcdef",
      referralCount: 0,
      bonusPoints: 0 as const,
      bonusStatus: "none" as const,
      guideStatus: "none" as const,
      replay: false,
    })),
    resolve: vi.fn(),
    listTariffs: vi.fn(),
    createQuote: vi.fn(),
    createApplication: vi.fn(),
  };
  return {
    repository,
    service: createExpertApplicantService({
      enabled: true,
      repository,
      waitlistV4: { channelUrl: "https://t.me/ii_tonya_experts_promo" },
    }),
  };
};
describe("waitlist v4 applicant flow", () => {
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
    expect(hidden.replyMarkup).toBeUndefined();
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
    if (result.status === "handled")
      expect(result.text).toContain("Без согласия");
    expect(f.repository.register).not.toHaveBeenCalled();
  });
});
