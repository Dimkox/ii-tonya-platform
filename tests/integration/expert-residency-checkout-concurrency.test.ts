import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { ExpertReferralTestkit } from "../../packages/db/src/testkit/expert-referral.js";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
let fixtures: ExpertReferralTestkit;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

async function databaseNow(): Promise<Date> {
  const row = (await testDb.db.execute<{ now: Date | string }>(sql`select transaction_timestamp() as now`)).rows[0];
  if (row === undefined) throw new Error("database clock unavailable");
  return new Date(row.now);
}

async function seedGrant(expertId: string, amountMinor: bigint): Promise<void> {
  const invitee = await fixtures.createExpert();
  const referralId = randomUUID();
  const tariffId = randomUUID();
  const orderId = randomUUID();
  const settlementId = randomUUID();
  const grantId = randomUUID();
  const ledgerId = randomUUID();
  const evidence = await fixtures.createAdminEvidence("expert_residency.tariff_create", tariffId, { priceMinor: "1", durationSeconds: 86400 });
  await testDb.db.transaction(async (tx) => {
    await tx.execute(sql`insert into expert_referral_code_batches (inviter_expert_id, requested_count, issued_by_admin_id, approval_id, admin_session_id_hash)
      values (${expertId}::uuid, 1, ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid, ${evidence.sessionIdHash})`);
    const batch = (await tx.execute<{ id: string }>(sql`select id from expert_referral_code_batches order by created_at desc limit 1`)).rows[0]!;
    await tx.execute(sql`insert into expert_referral_codes (batch_id, inviter_expert_id, code_hash, masked_suffix, hmac_key_version)
      values (${batch.id}::uuid, ${expertId}::uuid, ${`seed-${randomUUID()}`}, '…seed', 1)`);
    const code = (await tx.execute<{ id: string }>(sql`select id from expert_referral_codes order by issued_at desc limit 1`)).rows[0]!;
    await tx.execute(sql`insert into expert_referrals (id, code_id, inviter_expert_id, invitee_expert_id)
      values (${referralId}::uuid, ${code.id}::uuid, ${expertId}::uuid, ${invitee.expertId}::uuid)`);
    await tx.execute(sql`insert into expert_residency_tariff_versions (id, tariff_key, version, display_name, description, price_minor, currency, duration_seconds, active_from, created_by_admin_id, approval_id, admin_session_id_hash)
      values (${tariffId}::uuid, ${`seed-${tariffId}`}, 1, 'Seed', 'Seed', 1, 'RUB', 86400, '2020-01-01T00:00:00Z', ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid, ${evidence.sessionIdHash})`);
    await tx.execute(sql`insert into expert_residency_orders (id, expert_id, tariff_version_id, tariff_name, tariff_description, price_minor, currency, duration_seconds, credit_minor, cash_minor, payment_deadline, provider_deadline, idempotency_key, status, quoted_at, settled_at, residency_starts_at, residency_ends_at)
      values (${orderId}::uuid, ${invitee.expertId}::uuid, ${tariffId}::uuid, 'Seed', 'Seed', 1, 'RUB', 86400, 0, 1, transaction_timestamp() + interval '2 days', transaction_timestamp() + interval '2 days', ${`seed-order-${orderId}`}, 'settled', transaction_timestamp() - interval '1 day', transaction_timestamp() - interval '1 day', transaction_timestamp() - interval '1 day', transaction_timestamp())`);
    await tx.execute(sql`insert into expert_first_residency_settlements (id, expert_id, qualifying_order_id, eligibility_status, eligibility_reason_code, expert_active, expert_verified, unique_identity, abuse_cleared, settled_at)
      values (${settlementId}::uuid, ${invitee.expertId}::uuid, ${orderId}::uuid, 'eligible', 'eligible', true, true, true, true, transaction_timestamp() - interval '1 day')`);
    await tx.execute(sql`insert into expert_referral_reward_grants (id, inviter_expert_id, referral_id, qualifying_order_id, first_settlement_id, amount_minor, granted_at, expires_at)
      values (${grantId}::uuid, ${expertId}::uuid, ${referralId}::uuid, ${orderId}::uuid, ${settlementId}::uuid, ${amountMinor}, transaction_timestamp(), transaction_timestamp() + interval '365 days')`);
    await tx.execute(sql`insert into expert_referral_ledger_entries (id, account_expert_id, entry_kind, amount_minor, source_type, source_id, reward_grant_id, idempotency_key)
      values (${ledgerId}::uuid, ${expertId}::uuid, 'reward_grant', ${amountMinor}, 'reward_grant', ${grantId}::uuid, ${grantId}::uuid, ${`seed-ledger-${grantId}`})`);
    await tx.execute(sql`insert into expert_referral_ledger_allocations (ledger_entry_id, reward_grant_id, amount_minor) values (${ledgerId}::uuid, ${grantId}::uuid, ${amountMinor})`);
  });
}

describe("expert residency checkout concurrency", () => {
  it("reconciles all concurrent checkout reservations exactly to the ledger grant", async () => {
    const expert = await fixtures.createExpert();
    const tariffId = randomUUID();
    const now = await databaseNow();
    const activeFrom = new Date(now.getTime() - 86_400_000);
    const providerDeadline = new Date(now.getTime() + 86_400_000);
    const evidence = await fixtures.createAdminEvidence("expert_residency.tariff_create", tariffId, {
      tariffKey: "concurrent", version: 1, displayName: "Concurrent", description: "Concurrent",
      priceMinor: "100000", durationSeconds: 86400, activeFrom: activeFrom.toISOString(), activeTo: null,
    });
    const repo = new PostgresExpertResidencyRepository(testDb.db);
    await repo.createTariffVersion({ tariffVersionId: tariffId, tariffKey: "concurrent", version: 1,
      displayName: "Concurrent", description: "Concurrent", priceMinor: 100000n, durationSeconds: 86400,
      activeFrom, activeTo: null, ...evidence });
    await seedGrant(expert.expertId, 100000n);

    const results = await Promise.allSettled([0, 1, 2].map((index) =>
      repo.createCheckoutOrder({ expertId: expert.expertId, tariffKey: "concurrent", providerDeadline, idempotencyKey: `concurrent-${index}` }),
    ));
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof repo.createCheckoutOrder>>> => result.status === "fulfilled");
    const totalReserved = fulfilled.reduce((sum, result) => sum + BigInt(result.value.creditMinor), 0n);

    expect(results).toHaveLength(3);
    expect(fulfilled).toHaveLength(3);
    expect(totalReserved).toBe(100000n);
    expect(fulfilled.map(({ value }) => value.creditMinor).sort()).toEqual(["0", "50000", "50000"]);
    expect(await repo.balance(expert.expertId)).toMatchObject({
      spendableBalanceMinor: "0",
      reservedBalanceMinor: "100000",
    });
  });
});
