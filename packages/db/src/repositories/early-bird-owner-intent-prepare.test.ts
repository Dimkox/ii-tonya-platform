import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { PostgresEarlyBirdOwnerIntentPrepare } from "./early-bird-owner-intent-prepare.js";
import type { DrizzleDb } from "../client.js";

const input = () => ({
  userId: randomUUID(),
  baseId: randomUUID(),
  choiceId: randomUUID(),
  grantId: randomUUID(),
  operationId: randomUUID(),
  invoiceId: randomUUID(),
  idempotencyKey: randomUUID(),
  digest: `sha256:${"a".repeat(64)}`,
  ciphertext: "sealed-fixture",
  keyReference: "vault:fixture",
  requestExpiresAt: "2026-11-02T01:00:00.000Z",
});
it("inserts intent and immutable sealed request in one transaction", async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: "created" }] })
    .mockResolvedValueOnce({ rows: [{ id: "created" }] });
  const transaction = vi.fn(async (fn) => fn({ execute }));
  const store = new PostgresEarlyBirdOwnerIntentPrepare({
    transaction,
  } as unknown as DrizzleDb);
  expect(await store.prepare(input())).toEqual({ kind: "prepared" });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(5);
});
it("propagates request insertion errors so the transaction rolls back", async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: "created" }] })
    .mockRejectedValueOnce(new Error("request failure"));
  const store = new PostgresEarlyBirdOwnerIntentPrepare({
    transaction: (fn: (tx: unknown) => unknown) => fn({ execute }),
  } as unknown as DrizzleDb);
  await expect(store.prepare(input())).rejects.toThrow("request failure");
});
it("rejects invalid inputs before starting a transaction", async () => {
  const transaction = vi.fn();
  const store = new PostgresEarlyBirdOwnerIntentPrepare({
    transaction,
  } as unknown as DrizzleDb);
  await expect(store.prepare({ ...input(), digest: "bad" })).rejects.toThrow(
    "early_bird_prepare_invalid",
  );
  expect(transaction).not.toHaveBeenCalled();
});
