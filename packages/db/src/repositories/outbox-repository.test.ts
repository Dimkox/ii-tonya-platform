import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresOutboxRepository } from "./outbox-repository.js";

describe("PostgreSQL outbox repository", () => {
  it.each([0, -1, 1.5, 1_001, Number.NaN])(
    "rejects unsafe recovery limit %s before opening a transaction",
    async (limit) => {
      const transaction = vi.fn(async () => 0);
      const repository = new PostgresOutboxRepository({
        transaction,
      } as unknown as DrizzleDb);

      await expect(repository.recoverExpiredDispatchLeases(limit)).rejects.toThrow(
        "limit must be a safe integer between 1 and 1000",
      );
      await expect(repository.recoverExpiredReconciliationLeases(limit)).rejects.toThrow(
        "limit must be a safe integer between 1 and 1000",
      );
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
