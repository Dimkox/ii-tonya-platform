import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdReceiptRetention } from "./early-bird-receipt-retention.js";
it("rejects an invalid subject before opening a transaction", async () => {
  const transaction = vi.fn();
  const store = new PostgresEarlyBirdReceiptRetention({
    transaction,
  } as unknown as DrizzleDb);
  await expect(
    store.expireSelected({ id: "bad", userId: randomUUID() }),
  ).rejects.toThrow();
  expect(transaction).not.toHaveBeenCalled();
});
it("rechecks the exact subject and contact under transaction locks", async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: randomUUID() }] });
  const store = new PostgresEarlyBirdReceiptRetention({
    transaction: (fn: (tx: unknown) => unknown) => fn({ execute }),
  } as unknown as DrizzleDb);
  expect(
    await store.expireSelected({ id: randomUUID(), userId: randomUUID() }),
  ).toBe(true);
  expect(execute).toHaveBeenCalledTimes(4);
});
