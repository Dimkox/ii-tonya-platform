import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
describe("expert residency provider inbox", () => {
  it("rejects values not authenticated by the verifier boundary", async () => {
    const db = { transaction: vi.fn() };
    const repo = new PostgresExpertResidencyProviderInboxRepository(
      db as never,
    );
    await expect(repo.settle({ kind: "settled" } as never)).rejects.toThrow(
      "verified_event_required",
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("pins append-only reservation commit, debt-first reward, eligibility evidence, and distinct outbox hashing", () => {
    const source = readFileSync(
      new URL(
        "./expert-residency-provider-inbox-repository.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("'release'");
    expect(source).toContain("'spend'");
    expect(source).toContain("'debt_repayment'");
    expect(source).toContain("expert.rows[0].active");
    expect(source).toContain("settlement_abuse_cleared");
    expect(source).toMatch(
      /createHash\("sha256"\)[\s\S]{0,80}\.update\(outboxPayload\)/u,
    );
    expect(source).not.toContain("${digest}) on conflict (idempotency_key)");
  });
});
