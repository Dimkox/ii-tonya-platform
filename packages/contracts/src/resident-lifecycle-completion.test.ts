import { describe, expect, it } from "vitest";
import {
  qualityNeedsReview,
  renderResidentWorkNotice,
} from "./resident-lifecycle-completion.js";

describe("resident lifecycle boundaries", () => {
  it("requires a strictly greater than twenty percent nonempty cohort", () => {
    expect(qualityNeedsReview(0, 0)).toBe(false);
    expect(qualityNeedsReview(1, 5)).toBe(false);
    expect(qualityNeedsReview(2, 5)).toBe(true);
    expect(() => qualityNeedsReview(6, 5)).toThrow();
    expect(() => qualityNeedsReview(-1, 5)).toThrow();
  });
  it("does not turn approval into public activation or material readiness", () => {
    const text = renderResidentWorkNotice("card_approved", null, false);
    expect(text).toContain("проверена");
    expect(text).not.toContain("материалы готовы");
    expect(text).not.toContain("доступна клиентам");
  });
  it("preserves exact return reason without claiming an old publication was removed", () => {
    const reason = "Уточните длительность услуги <30 минут>.";
    expect(renderResidentWorkNotice("card_returned", reason, true)).toContain(
      reason,
    );
    expect(
      renderResidentWorkNotice("card_returned", reason, true),
    ).not.toContain("приостановлен");
    expect(() =>
      renderResidentWorkNotice("card_returned", null, false),
    ).toThrow();
  });
  it("gives only supported activation instructions without private logistics", () => {
    const text = renderResidentWorkNotice("first_activation", null, true);
    expect(text).toContain("/schedule");
    expect(text).toContain("/slots_busy");
    expect(text).not.toMatch(/переносите|https?:|автоматически верн/iu);
  });
});
