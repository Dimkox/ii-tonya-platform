import { randomUUID, createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdStandardSendAdmission } from "./early-bird-standard-send-admission.js";

function fixture(status = "prepared") {
  const body = '{"amount":{"value":"9000.00","currency":"RUB"}}';
  const userId = randomUUID(),
    operationId = randomUUID(),
    invoiceId = randomUUID(),
    idempotencyKey = randomUUID();
  const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const row = {
    contactAvailable: true,
    status,
    userId,
    operationId,
    invoiceId,
    priceKind: "discounted",
    eligible: true,
    participant: "expert",
    base: "1000000",
    monthly: "600000",
    total: "900000",
    quote: "2026-11-01T01:00:00.000Z",
    idempotencyKey,
    digest,
    ciphertext: "sealed",
    keyReference: "vault:v1",
    offer: "2026-11-01T00:00:00.000Z",
    expiry: "2026-11-11T00:00:00.000Z",
    launch: "2027-01-10T21:00:00.000Z",
  };
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ safe: true }] })
    .mockResolvedValueOnce({ rows: [{ data: row }] })
    .mockResolvedValueOnce({ rows: [{ id: operationId }] });
  const transaction = vi.fn(async (fn) => fn({ execute }));
  return {
    body,
    userId,
    operationId,
    receiptContactId: randomUUID(),
    row,
    execute,
    transaction,
    store: new PostgresEarlyBirdStandardSendAdmission(
      {
        transaction,
      } as unknown as DrizzleDb,
      "wave_sender_login",
    ),
  };
}
it("authenticates bytes under the transaction and consumes permission once", async () => {
  const f = fixture();
  const authenticate = vi.fn((snapshot: unknown) => {
    void snapshot;
    return f.body;
  });
  const admitted = await f.store.admit(f, authenticate);
  expect(admitted.kind).toBe("initial_send_admitted");
  expect(authenticate.mock.calls[0]![0]).toMatchObject({
    intent: { operationId: f.operationId, totalMinor: "900000" },
    sealed: { digest: f.row.digest },
  });
  expect(f.execute).toHaveBeenCalledTimes(4);
});
it("never authenticates or readmits an unknown payment", async () => {
  const f = fixture("unknown"),
    authenticate = vi.fn(() => f.body);
  expect(await f.store.admit(f, authenticate)).toEqual({
    kind: "reconcile",
    operationId: f.operationId,
  });
  expect(authenticate).not.toHaveBeenCalled();
});
it("rejects a digest mismatch before consuming permission", async () => {
  const f = fixture();
  await expect(f.store.admit(f, () => "changed")).rejects.toThrow(
    "early_bird_send_request_mismatch",
  );
  expect(f.execute).toHaveBeenCalledTimes(3);
});
it("never returns admission after an uncertain commit", async () => {
  const f = fixture();
  f.transaction.mockImplementationOnce(async (fn) => {
    await fn({ execute: f.execute });
    throw new Error("commit response lost");
  });
  await expect(f.store.admit(f, () => f.body)).rejects.toThrow(
    "commit response lost",
  );
});
