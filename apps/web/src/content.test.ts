import { describe, expect, it } from "vitest";
import { landingContent } from "./content.js";

describe("landing content", () => {
  it("keeps the approved identity and complete public structure", () => {
    expect(landingContent.brand).toBe("ии-Тоня");
    expect(landingContent.hero.title).toBe("Привет, я ии-Тоня 👋");
    expect(landingContent.clientCategories).toHaveLength(7);
    expect(landingContent.clientFlow).toHaveLength(3);
    expect(landingContent.tariffs.map(({ code }) => code)).toEqual([
      "base",
      "exclusive",
      "event",
    ]);
    expect(landingContent.faq.length).toBeGreaterThanOrEqual(10);
    expect(landingContent.operator.ogrnip).toBe("326680000031840");
  });

  it("contains no coercive, guaranteed, or placeholder claims", () => {
    const copy = JSON.stringify(landingContent);
    expect(copy).not.toMatch(
      /успей|гарантируем|гарантия (?:результата|обращений)|гарантированный|без маркировки рекламы|\[\.\.\.\]/iu,
    );
    expect(copy).not.toMatch(/ОГРНИП\s*\[|лучший|лечит/iu);
    expect(copy).not.toMatch(
      /пакет(?:ы|а)? сообщений|купон|реферальн|резервирует слот|напоминания придут|доступен 24\/7/iu,
    );
  });
});
