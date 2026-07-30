import { describe, expect, it, vi } from "vitest";
import { runRetentionBatch } from "./data-retention.js";

describe("data retention", () => {
  it("deletes expired content references but not ledger, consent, safety, or audit facts", async () => {
    const repository = {
      claimExpiredContent: vi.fn().mockResolvedValue([
        { id: "content-1", class: "conversation_content" },
        { id: "payload-1", class: "provider_payload" },
      ]),
      markStarted: vi.fn(),
      deleteContent: vi.fn().mockResolvedValue({ kind: "deleted" }),
      markDeleted: vi.fn(),
      markUnknown: vi.fn(),
      reconcile: vi.fn(),
      deadLetter: vi.fn(),
      alert: vi.fn(),
    };
    const result = await runRetentionBatch(
      {
        repository,
        allowedClasses: new Set(["conversation_content", "provider_payload"]),
        audit: { append: vi.fn() },
      },
      new Date("2026-07-28T10:00:00.000Z"),
      100,
    );
    expect(result).toEqual({ examined: 2, deleted: 2, failed: 0 });
    expect(repository.deleteContent).toHaveBeenCalledTimes(2);
  });

  it("rejects every immutable or unapproved retention class", async () => {
    const repository = {
      claimExpiredContent: vi.fn().mockResolvedValue([
        { id: "ledger-1", class: "message_ledger" },
      ]),
      markStarted: vi.fn(),
      deleteContent: vi.fn(),
      markDeleted: vi.fn(),
      markUnknown: vi.fn(),
      reconcile: vi.fn(),
      deadLetter: vi.fn(),
      alert: vi.fn(),
    };
    await expect(runRetentionBatch({
      repository,
      allowedClasses: new Set(["conversation_content", "provider_payload"]),
      audit: { append: vi.fn() },
    }, new Date("2026-07-28T10:00:00.000Z"), 100)).rejects.toThrow(
      "Retention class message_ledger is forbidden",
    );
    expect(repository.deleteContent).not.toHaveBeenCalled();
    expect(repository.alert).toHaveBeenCalledWith(
      expect.objectContaining({ class: "message_ledger" }),
    );
  });
});
