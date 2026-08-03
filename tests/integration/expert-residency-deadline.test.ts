import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
let testDb: ExpertReferralTestDatabase | undefined;
describe("expert residency deadline", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120000);
  afterAll(async () => testDb?.stop());
  it("treats equality as expiry and releases exactly once", async () => {
    const expert = await testDb!.createExpertIdentity();
    const repo = new PostgresExpertResidencyRepository(testDb!.db);
    const audit = await testDb!.createAdminAudit({
      action: "expert_residency.tariff_create",
      objectId: randomUUID(),
    });
    const tariff = await repo.createTariffVersion({
      tariffKey: "deadline",
      displayName: "Deadline",
      priceMinor: 100000n,
      durationSeconds: 86400,
      activeFrom: new Date(Date.now() - 1000),
      activeTo: new Date(Date.now() + 86400000),
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });
    const order = await repo.createCheckoutOrder({
      expertId: expert.expertId,
      tariffVersionId: tariff.id,
      providerDeadline: new Date(Date.now() + 3600000),
      idempotencyKey: "deadline",
    });
    await testDb!.db.execute(
      sql`update expert_residency_orders set payment_deadline=transaction_timestamp() where id=${order.id}::uuid`,
    );
    await expect(repo.releaseExpiredOrders()).resolves.toEqual({
      examined: 1,
      released: 1,
    });
    await expect(repo.releaseExpiredOrders()).resolves.toEqual({
      examined: 0,
      released: 0,
    });
    const stored = await testDb!.db.execute<{ status: string }>(
      sql`select status from expert_residency_orders where id=${order.id}::uuid`,
    );
    expect(stored.rows[0]?.status).toBe("expired");
  });
});
