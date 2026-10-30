import { createHash, randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdRecoveryFingerprintRepository } from "./early-bird-recovery-fingerprint-repository.js";
function fixture(row?: object) {
  const userId = randomUUID(),
    operationId = randomUUID(),
    invoiceId = randomUUID(),
    grantId = randomUUID();
  const facts = {
    invoice_id: invoiceId,
    user_id: userId,
    grant_id: grantId,
    policy: "owner_test_10_20_v1",
    kind: "fixed_test",
    amount: "3000",
    mode: "live",
    marked: "2026-11-02T12:00:00+03:00",
  };
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ user_id: userId }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: row === undefined ? [facts] : [row] });
  const repository = new PostgresEarlyBirdRecoveryFingerprintRepository({
    transaction: async (fn: (tx: unknown) => unknown) => fn({ execute }),
  } as unknown as DrizzleDb);
  return {
    userId,
    operationId,
    invoiceId,
    grantId,
    facts,
    execute,
    repository,
  };
}
it("derives bounded discovery from immutable intent metadata without a receipt or request row", async () => {
  const f = fixture();
  expect(await f.repository.read(f.operationId)).toEqual({
    operationId: f.operationId,
    invoiceId: f.invoiceId,
    userIdSha256: createHash("sha256").update(f.userId).digest("hex"),
    grantIdSha256: createHash("sha256").update(f.grantId).digest("hex"),
    pricingPolicy: "owner_test_10_20_v1",
    priceKind: "fixed_test",
    totalMinor: "3000",
    mode: "live",
    createdFrom: "2026-11-02T08:55:00.000Z",
    createdBefore: "2026-11-03T08:55:00.000Z",
  });
  const query = new PgDialect().sqlToQuery(f.execute.mock.calls[3]![0]).sql;
  expect(query).not.toMatch(/early_bird_composite_requests|ciphertext|email/iu);
  expect(query).toContain("expert_card_current_messaging_authority");
  expect(query).toContain("i.status='unknown'");
  expect(query).toContain("expert_sales_erased_cohorts");
  expect(query).not.toContain("early_bird_intent_tombstones");
});
it("does not derive authority after the locked scope/consent recheck loses the subject", async () => {
  const f = fixture();
  f.execute.mockResolvedValueOnce({ rows: [] });
  // Replace the final post-lock snapshot with no currently authorized row.
  f.execute
    .mockReset()
    .mockResolvedValueOnce({ rows: [{ user_id: f.userId }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  expect(await f.repository.read(f.operationId)).toBeNull();
});
it("does not scan a deleted unknown operation or an invalid dispatch timestamp", async () => {
  const f = fixture();
  f.execute.mockReset().mockResolvedValueOnce({ rows: [] });
  expect(await f.repository.read(f.operationId)).toBeNull();
  const invalid = fixture({ marked: "not-a-timestamp" });
  expect(await invalid.repository.read(invalid.operationId)).toBeNull();
});
