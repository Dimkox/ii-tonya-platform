import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
let testDb: ExpertReferralTestDatabase | undefined;
describe("expert residency checkout concurrency", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  it("never double-reserves one grant", async () => {
    const expert = await testDb!.createExpertIdentity();
    const repo = new PostgresExpertResidencyRepository(testDb!.db);
    const audit = await testDb!.createAdminAudit({
      action: "expert_residency.tariff_create",
      objectId: randomUUID(),
    });
    const tariff = await repo.createTariffVersion({
      tariffKey: "race",
      displayName: "Race",
      priceMinor: 200000n,
      durationSeconds: 86400,
      activeFrom: new Date(Date.now() - 1000),
      activeTo: new Date(Date.now() + 86400000),
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });
    const grantId = randomUUID();
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(
        sql`insert into expert_referral_reward_grants (id,expert_id,referral_id,first_settlement_id,qualifying_order_id,qualifying_payment_attempt_id,amount_minor,granted_at,expires_at,idempotency_key) values (${grantId}::uuid,${expert.expertId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,100000,transaction_timestamp()-interval '364 days',transaction_timestamp()+interval '1 day',${randomUUID()})`,
      );
      const entry = await tx.execute<{ id: string }>(
        sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,source_type,source_id,idempotency_key) values (${expert.expertId}::uuid,'reward_grant',100000,'reward_grant',${grantId}::uuid,${randomUUID()}) returning id`,
      );
      await tx.execute(
        sql`insert into expert_referral_ledger_allocations values (${entry.rows[0]!.id}::uuid,${grantId}::uuid,${expert.expertId}::uuid,100000,default)`,
      );
    });
    const results = await Promise.all(
      ["a", "b"].map((id) =>
        repo.createCheckoutOrder({
          expertId: expert.expertId,
          tariffVersionId: tariff.id,
          providerDeadline: new Date(Date.now() + 3600000),
          idempotencyKey: id,
        }),
      ),
    );
    expect(results.reduce((n, o) => n + BigInt(o.creditMinor), 0n)).toBe(
      100000n,
    );
  });
});
