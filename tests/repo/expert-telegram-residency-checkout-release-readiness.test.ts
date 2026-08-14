import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ER-TG-003 release traceability", () => {
  it("maps every stable requirement to implementation, verification, recovery, and owner", () => {
    const text = readFileSync(
      "docs/spec/expert-telegram-residency-checkout.md",
      "utf8",
    );
    const rows = text
      .split(/\r?\n/u)
      .filter((line) => /^\|\s*ER-TG-003-R\d\s*\|/u.test(line));
    expect(rows.map((line) => line.split("|")[1]?.trim())).toEqual(
      Array.from({ length: 8 }, (_, index) => `ER-TG-003-R${index + 1}`),
    );
    for (const row of rows) {
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(6);
      expect(cells.every((cell) => cell.length > 0)).toBe(true);
    }
    expect(text).toContain("EXPERT_TELEGRAM_CHECKOUT_ENABLED=false");
    expect(text).toContain("No live Telegram or payment provider is activated");
  });
});
