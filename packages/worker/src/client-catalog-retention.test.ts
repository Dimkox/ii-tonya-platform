import { describe, expect, it, vi } from "vitest";

import { runClientCatalogRetention } from "./data-retention.js";

describe("client catalog retention", () => {
  it("runs one bounded cleanup and emits only phase/outcome evidence", async () => {
    const expireDue = vi.fn(async () => ({
      examined: 3,
      expired: 2,
      removed: 1,
    }));
    const record = vi.fn();

    await expect(
      runClientCatalogRetention(
        { repository: { expireDue }, metrics: { record } },
        new Date("2026-08-15T10:00:00.000Z"),
        20,
      ),
    ).resolves.toEqual({ examined: 3, expired: 2, removed: 1 });
    expect(expireDue).toHaveBeenCalledWith({
      now: new Date("2026-08-15T10:00:00.000Z"),
      limit: 20,
    });
    expect(record).toHaveBeenCalledWith(
      { phase: "cleanup", outcome: "expired" },
      2,
    );
    expect(record).toHaveBeenCalledWith(
      { phase: "cleanup", outcome: "removed" },
      1,
    );
  });
});
