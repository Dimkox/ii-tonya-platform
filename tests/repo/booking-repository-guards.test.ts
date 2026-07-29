import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("booking SQL mutation guards", () => {
  it("bounds slot observation freshness on both sides of the server clock", () => {
    const repository = readFileSync(
      "packages/db/src/repositories/booking-repository.ts",
      "utf8",
    );

    expect(repository).toContain(
      "and s.observed_at >= ${new Date(command.now.getTime() - SLOT_FRESHNESS_MS)}",
    );
    expect(repository).toContain("and s.observed_at <= ${command.now}");
  });
});
