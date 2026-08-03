import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

let testDb: ExpertReferralTestDatabase | undefined;
describe("expert residency checkout", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);
  beforeEach(async () => {
    await testDb!.reset();
  });
  afterAll(async () => {
    await testDb?.stop();
  });

  it("quotes 50/50, snapshots the tariff, and reserves grants FIFO", async () => {
    const expert = await testDb!.createExpertIdentity();
    const audit = await testDb!.createAdminAudit({
      action: "expert_residency.tariff_create",
      objectId: randomUUID(),
    });
    const repo = new PostgresExpertResidencyRepository(testDb!.db);
    const tariff = await repo.createTariffVersion({
      tariffKey: "base",
      displayName: "Base",
      priceMinor: 250001n,
      durationSeconds: 86400,
      activeFrom: new Date(Date.now() - 60_000),
      activeTo: new Date(Date.now() + 86400000),
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      for (const [offset, amount] of [
        [1, 100000n],
        [2, 100000n],
      ] as const) {
        const grantId = randomUUID();
        await tx.execute(
          sql`insert into expert_referral_reward_grants (id, expert_id, referral_id, first_settlement_id, qualifying_order_id, qualifying_payment_attempt_id, amount_minor, granted_at, expires_at, idempotency_key) values (${grantId}::uuid, ${expert.expertId}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${amount}, transaction_timestamp() + ${offset} * interval '1 day' - interval '365 days', transaction_timestamp() + ${offset} * interval '1 day', ${randomUUID()})`,
        );
        await tx.execute(
          sql`insert into expert_referral_ledger_entries (expert_id, entry_kind, amount_minor, source_type, source_id, idempotency_key) values (${expert.expertId}::uuid, 'reward_grant', ${amount}, 'reward_grant', ${grantId}::uuid, ${randomUUID()}) returning id`,
        );
        await tx.execute(
          sql`insert into expert_referral_ledger_allocations (ledger_entry_id, reward_grant_id, expert_id, amount_minor) select id, ${grantId}::uuid, ${expert.expertId}::uuid, ${amount} from expert_referral_ledger_entries where source_id=${grantId}::uuid`,
        );
      }
    });
    await expect(
      repo.quote({ expertId: expert.expertId, tariffVersionId: tariff.id }),
    ).resolves.toMatchObject({
      priceMinor: "250001",
      creditMinor: "125000",
      cashMinor: "125001",
    });
    const order = await repo.createCheckoutOrder({
      expertId: expert.expertId,
      tariffVersionId: tariff.id,
      providerDeadline: new Date(Date.now() + 3600000),
      idempotencyKey: "checkout-1",
    });
    expect(order).toMatchObject({
      priceMinor: "250001",
      creditMinor: "125000",
      cashMinor: "125001",
      status: "payment_pending",
    });
    expect(order.allocations.map((row) => row.amountMinor)).toEqual([
      "100000",
      "25000",
    ]);
    await expect(
      repo.createCheckoutOrder({
        expertId: expert.expertId,
        tariffVersionId: tariff.id,
        providerDeadline: new Date(order.paymentDeadline),
        idempotencyKey: "checkout-1",
      }),
    ).resolves.toEqual(order);
  });
});
