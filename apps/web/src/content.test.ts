import { describe, expect, it } from "vitest";
import { landingContent } from "./content.js";

describe("landing content", () => {
  it("keeps the approved identity and complete public structure", () => {
    expect(landingContent.brand).toBe("ии-Тоня");
    expect(landingContent.tariffs.map(({ code }) => code)).toEqual([
      "base",
      "exclusive",
      "event",
    ]);
    expect(landingContent.faq).toHaveLength(8);
  });

  it("contains no coercive, guaranteed, or placeholder claims", () => {
    const copy = JSON.stringify(landingContent);
    expect(copy).not.toMatch(
      /успей|гарантир|без маркировки рекламы|\[\.\.\.\]/iu,
    );
    expect(copy).not.toMatch(/ОГРНИП\s*\[|лучший|лечит|диагноз/iu);
  });
});
