import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { ExpertReferralTestkit } from "../../packages/db/src/testkit/expert-referral.js";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
let fixtures: ExpertReferralTestkit;
let repo: PostgresExpertResidencyRepository;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
  repo = new PostgresExpertResidencyRepository(testDb.db);
}, 120_000);

beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

async function createActiveTariff(): Promise<void> {
  const tariffVersionId = randomUUID();
  const now = await databaseNow();
  const activeFrom = new Date(now.getTime() - 86_400_000);
  const evidence = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create",
    tariffVersionId,
    {
      tariffKey: "residency-month",
      version: 1,
      displayName: "Monthly residency",
      description: "Thirty-day expert residency",
      priceMinor: "250001",
      durationSeconds: 2_592_000,
      activeFrom: activeFrom.toISOString(),
      activeTo: null,
    },
  );
  await repo.createTariffVersion({
    tariffVersionId,
    tariffKey: "residency-month",
    version: 1,
    displayName: "Monthly residency",
    description: "Thirty-day expert residency",
    priceMinor: 250001n,
    durationSeconds: 2_592_000,
    activeFrom,
    activeTo: null,
    ...evidence,
  });
}

async function databaseNow(): Promise<Date> {
  const row = (await testDb.db.execute<{ now: Date | string }>(
    sql`select transaction_timestamp() as now`,
  )).rows[0];
  if (row === undefined) throw new Error("database clock unavailable");
  return new Date(row.now);
}

async function seedGrant(expertId: string, input: {
  grantId: string;
  amountMinor: bigint;
  grantedAt: Date;
  expiresAt: Date;
}): Promise<void> {
  const invitee = await fixtures.createExpert();
  const referralId = randomUUID();
  const tariffId = randomUUID();
  const orderId = randomUUID();
  const settlementId = randomUUID();
  const ledgerId = randomUUID();
  const evidence = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create", tariffId,
    { priceMinor: "1", durationSeconds: 86400 },
  );
  await testDb.db.transaction(async (tx) => {
    await tx.execute(sql`insert into expert_referral_code_batches (
      inviter_expert_id, requested_count, issued_by_admin_id, approval_id, admin_session_id_hash
    ) values (${expertId}::uuid, 1, ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid, ${evidence.sessionIdHash})`);
    const batch = (await tx.execute<{ id: string }>(sql`select id from expert_referral_code_batches order by created_at desc limit 1`)).rows[0]!;
    await tx.execute(sql`insert into expert_referral_codes (
      batch_id, inviter_expert_id, code_hash, masked_suffix, hmac_key_version
    ) values (${batch.id}::uuid, ${expertId}::uuid, ${`grant-${randomUUID()}`}, '…seed', 1)`);
    const code = (await tx.execute<{ id: string }>(sql`select id from expert_referral_codes order by issued_at desc limit 1`)).rows[0]!;
    await tx.execute(sql`insert into expert_referrals (id, code_id, inviter_expert_id, invitee_expert_id)
      values (${referralId}::uuid, ${code.id}::uuid, ${expertId}::uuid, ${invitee.expertId}::uuid)`);
    await tx.execute(sql`insert into expert_residency_tariff_versions (
      id, tariff_key, version, display_name, description, price_minor, currency,
      duration_seconds, active_from, created_by_admin_id, approval_id, admin_session_id_hash
    ) values (${tariffId}::uuid, ${`grant-${tariffId}`}, 1, 'Grant tariff', 'Grant fixture', 1, 'RUB', 86400,
      '2020-01-01T00:00:00Z', ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid, ${evidence.sessionIdHash})`);
    await tx.execute(sql`insert into expert_residency_orders (
      id, expert_id, tariff_version_id, tariff_name, tariff_description, price_minor, currency,
      duration_seconds, credit_minor, cash_minor, payment_deadline, provider_deadline, idempotency_key,
      status, quoted_at, settled_at, residency_starts_at, residency_ends_at
    ) values (${orderId}::uuid, ${invitee.expertId}::uuid, ${tariffId}::uuid, 'Grant tariff', 'Grant fixture',
      1, 'RUB', 86400, 0, 1, transaction_timestamp() + interval '2 days', transaction_timestamp() + interval '2 days', ${`settled-${orderId}`}, 'settled',
      transaction_timestamp() - interval '1 day', transaction_timestamp() - interval '1 day', transaction_timestamp() - interval '1 day', transaction_timestamp())`);
    await tx.execute(sql`insert into expert_first_residency_settlements (
      id, expert_id, qualifying_order_id, eligibility_status, eligibility_reason_code,
      expert_active, expert_verified, unique_identity, abuse_cleared, settled_at
    ) values (${settlementId}::uuid, ${invitee.expertId}::uuid, ${orderId}::uuid, 'eligible', 'eligible',
      true, true, true, true, transaction_timestamp() - interval '1 day')`);
    await tx.execute(sql`insert into expert_referral_reward_grants (
      id, inviter_expert_id, referral_id, qualifying_order_id, first_settlement_id,
      amount_minor, granted_at, expires_at
    ) values (${input.grantId}::uuid, ${expertId}::uuid, ${referralId}::uuid, ${orderId}::uuid,
      ${settlementId}::uuid, ${input.amountMinor}, ${input.grantedAt}, ${input.expiresAt})`);
    await tx.execute(sql`insert into expert_referral_ledger_entries (
      id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
      reward_grant_id, idempotency_key
    ) values (${ledgerId}::uuid, ${expertId}::uuid, 'reward_grant', ${input.amountMinor}, 'reward_grant',
      ${input.grantId}::uuid, ${input.grantId}::uuid, ${`grant-ledger-${input.grantId}`})`);
    await tx.execute(sql`insert into expert_referral_ledger_allocations (
      ledger_entry_id, reward_grant_id, amount_minor
    ) values (${ledgerId}::uuid, ${input.grantId}::uuid, ${input.amountMinor})`);
  });
}

describe("expert residency checkout", () => {
  it("quotes the exact 50 percent cap and reserves eligible credit FIFO", async () => {
    await createActiveTariff();
    const expert = await fixtures.createExpert();
    const now = await databaseNow();
    const firstGrantedAt = new Date(now.getTime() - 2 * 86_400_000);
    const firstExpiresAt = new Date(firstGrantedAt.getTime() + 365 * 86_400_000);
    const secondGrantedAt = new Date(now.getTime() - 86_400_000);
    const secondExpiresAt = new Date(secondGrantedAt.getTime() + 365 * 86_400_000);
    const providerDeadline = new Date(now.getTime() + 10 * 86_400_000);
    await seedGrant(expert.expertId, {
      grantId: "00000000-0000-4000-8000-000000000101",
      amountMinor: 100000n,
      grantedAt: firstGrantedAt,
      expiresAt: firstExpiresAt,
    });
    await seedGrant(expert.expertId, {
      grantId: "00000000-0000-4000-8000-000000000102",
      amountMinor: 100000n,
      grantedAt: secondGrantedAt,
      expiresAt: secondExpiresAt,
    });

    expect(await repo.quote({ expertId: expert.expertId, tariffKey: "residency-month" })).toMatchObject({
      creditMinor: "125000",
      cashMinor: "125001",
    });
    const order = await repo.createCheckoutOrder({
      expertId: expert.expertId,
      tariffKey: "residency-month",
      providerDeadline,
      idempotencyKey: "checkout-fifo",
    });

    expect(order.allocations.map((row) => row.grantId)).toEqual([
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
    ]);
    expect(order.allocations.map((row) => row.amountMinor)).toEqual(["100000", "25000"]);
    expect(order.creditMinor).toBe("125000");
    expect(order.cashMinor).toBe("125001");
    expect(order).not.toHaveProperty("providerDeadline");
    const persistedDeadline = (await testDb.db.execute<{ providerDeadline: Date | string | null }>(sql`
      select provider_deadline as "providerDeadline" from expert_residency_orders
      where id = ${order.orderId}::uuid
    `)).rows[0]?.providerDeadline;
    expect(persistedDeadline).not.toBeNull();
    if (persistedDeadline === null || persistedDeadline === undefined) throw new Error("provider_deadline_missing");
    const persistedDeadlineAt = persistedDeadline instanceof Date
      ? persistedDeadline
      : new Date(persistedDeadline);
    expect(persistedDeadlineAt.getTime()).toBe(providerDeadline.getTime());
    expect((await repo.balance(expert.expertId)).spendableBalanceMinor).toBe("75000");
    await expect(repo.createCheckoutOrder({
      expertId: expert.expertId,
      tariffKey: "residency-month",
      providerDeadline: new Date(providerDeadline.getTime() + 1_000),
      idempotencyKey: "checkout-fifo",
    })).rejects.toMatchObject({ code: "checkout_idempotency_conflict" });
  });

  it("replays an identical checkout after its status becomes terminal", async () => {
    await createActiveTariff();
    const expert = await fixtures.createExpert();
    const providerDeadline = new Date((await databaseNow()).getTime() + 86_400_000);
    const command = {
      expertId: expert.expertId,
      tariffKey: "residency-month",
      providerDeadline,
      idempotencyKey: "terminal-replay",
    };
    const created = await repo.createCheckoutOrder(command);
    await testDb.db.execute(sql`update expert_residency_orders set status = 'failed' where id = ${created.orderId}::uuid`);

    await expect(repo.createCheckoutOrder(command)).resolves.toMatchObject({
      orderId: created.orderId,
      status: "failed",
    });
  });
});
