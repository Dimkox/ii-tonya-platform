import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "packages/db/migrations/0091_expert_service_offer.sql",
  "utf8",
);
const journal = JSON.parse(
  readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
) as { entries: { idx: number; tag: string; when: number }[] };

describe("expert service offer migration", () => {
  it("journals 0091 after the planerka purge migration", () => {
    expect(journal.entries[91]).toMatchObject({
      idx: 91,
      tag: "0091_expert_service_offer",
      when: 1793152800022,
    });
    expect(journal.entries[91]!.when).toBeGreaterThan(
      journal.entries[90]!.when,
    );
    expect(journal.entries[90]!.tag).toBe("0090_planerka_test_purge");
  });

  it("adds nullable display facts and rejects a negative price or unknown format in the database", () => {
    expect(sql).toContain("ADD COLUMN price_minor integer");
    expect(sql).toContain("ADD COLUMN currency text NOT NULL DEFAULT 'RUB'");
    expect(sql).toContain("ADD COLUMN format text");
    expect(sql).toContain("ADD COLUMN location text");
    expect(sql).toContain("CHECK (price_minor IS NULL OR price_minor >= 0)");
    expect(sql).toContain("CHECK (currency IN ('RUB'))");
    expect(sql).toContain(
      "CHECK (format IS NULL OR format IN ('online', 'offline', 'hybrid'))",
    );
    expect(sql).not.toMatch(/yookassa|PAYMENTS_/iu);
  });
});
