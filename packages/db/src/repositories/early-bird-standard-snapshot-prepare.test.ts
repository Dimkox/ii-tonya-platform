import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdStandardSnapshotPrepare } from "./early-bird-standard-snapshot-prepare.js";
it("does not serialize or persist without the bound live receipt", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const db = {
    transaction: (fn: (tx: unknown) => unknown) => fn({ execute }),
  } as unknown as DrizzleDb;
  const store = new PostgresEarlyBirdStandardSnapshotPrepare(db);
  const input = {
    userId: randomUUID(),
    baseId: randomUUID(),
    choiceId: randomUUID(),
    operationId: randomUUID(),
    invoiceId: randomUUID(),
    idempotencyKey: randomUUID(),
    receiptContactId: randomUUID(),
    requestExpiresAt: new Date().toISOString(),
    mode: "live" as const,
  };
  const seal = Object.assign(vi.fn(), { fingerprint: vi.fn() });
  expect(await store.prepare(input, seal)).toEqual({ kind: "unavailable" });
  expect(seal).not.toHaveBeenCalled();
});
