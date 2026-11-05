import { describe, expect, it, vi } from "vitest";
import { createExpertApplicantService } from "./expert-applicant-service.js";

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
      token: "abcdefghijklmnop",
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
    completeEnrollment: vi.fn(async () => ({
      kind: "granted" as const,
      replay: false,
    })),
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
      text: "/consent abcdefghijklmnop granted",
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
  it("softly exits when consent is denied", async () => {
    const f = setup();
    f.repository.completeEnrollment.mockResolvedValue({
      kind: "denied",
      replay: false,
    });
    const result = await f.service.handle({
      ...base,
      text: "/consent abcdefghijklmnop denied",
    });
    expect(result.status).toBe("handled");
    if (result.status === "handled")
      expect(result.text).toContain("Без согласия");
    expect(f.repository.register).not.toHaveBeenCalled();
  });
});
