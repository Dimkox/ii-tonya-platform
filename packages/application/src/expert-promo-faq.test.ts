import { describe, expect, it, vi } from "vitest";
import { matchExpertPromoFaq } from "./expert-promo-faq.js";
import { createExpertApplicantService } from "./expert-applicant-service.js";
const scope = {
  botId: "123",
  botKey: "promo",
  telegramUserId: "456",
  chatId: "456",
  updateId: 1,
};
const repo = (recorded: boolean) => ({
  register: vi.fn(),
  beginEnrollment: vi.fn(),
  completeEnrollment: vi.fn(),
  recordManagerQuestion: vi.fn(async () => recorded),
});
describe("WAIT-T05 FAQ and manager handoff", () => {
  it("matches a known question", () => {
    expect(matchExpertPromoFaq("когда получу гайд pdf?")).toContain(
      "два коллеги",
    );
    expect(matchExpertPromoFaq("привет")).toBeNull();
  });
  it("answers FAQ without handoff", async () => {
    const r = repo(true);
    const s = createExpertApplicantService({
      enabled: true,
      faq: true,
      repository: r as never,
    });
    const out = await s.handle({
      ...scope,
      text: "Как отключить напоминания?",
    });
    expect((out as { text: string }).text).toContain("/optout_ref");
    expect(r.recordManagerQuestion).not.toHaveBeenCalled();
  });
  it("hands an unknown question to the manager", async () => {
    const r = repo(true);
    const s = createExpertApplicantService({
      enabled: true,
      faq: true,
      repository: r as never,
    });
    const out = await s.handle({
      ...scope,
      text: "Можно ли работать из Казани?",
    });
    expect((out as { text: string }).text).toContain("менеджеру");
    expect(r.recordManagerQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ telegramUserId: "456" }),
      "Можно ли работать из Казани?",
    );
  });
  it("stays unhandled for an unregistered user", async () => {
    const s = createExpertApplicantService({
      enabled: true,
      faq: true,
      repository: repo(false) as never,
    });
    expect(
      (await s.handle({ ...scope, text: "Можно ли работать из Казани?" }))
        .status,
    ).toBe("unhandled");
  });
});
