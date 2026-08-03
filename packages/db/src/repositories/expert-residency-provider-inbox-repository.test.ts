import { describe, expect, it, vi } from "vitest";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
describe("expert residency provider inbox", () => {
  it("rejects values not authenticated by the verifier boundary", async () => {
    const db = { transaction: vi.fn() };
    const repo = new PostgresExpertResidencyProviderInboxRepository(db as never);
    await expect(repo.settle({ kind: "settled" } as never)).rejects.toThrow("verified_event_required");
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
