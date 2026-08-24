import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { ExpertReferralTestkit } from "../../packages/db/src/testkit/expert-referral.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

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

async function databaseNow(): Promise<Date> {
  const row = (
    await testDb.db.execute<{ now: Date | string }>(
      sql`select transaction_timestamp() as now`,
    )
  ).rows[0];
  if (row === undefined) throw new Error("database clock unavailable");
  return new Date(row.now);
}

async function seedGrant(expertId: string): Promise<void> {
  const invitee = await fixtures.createExpert();
  const referralId = randomUUID();
  const tariffId = randomUUID();
  const orderId = randomUUID();
  const settlementId = randomUUID();
  const grantId = randomUUID();
  const ledgerId = randomUUID();
  const evidence = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create",
    tariffId,
    { priceMinor: "1", durationSeconds: 86400 },
  );
  await testDb.db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into expert_referral_code_batches (inviter_expert_id, requested_count, issued_by_admin_id, approval_id, admin_session_id_hash) values (${expertId}::uuid, 1, ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid, ${evidence.sessionIdHash})`,
    );
    const batch = (
      await tx.execute<{ id: string }>(
        sql`select id from expert_referral_code_batches order by created_at desc limit 1`,
      )
    ).rows[0]!;
    await tx.execute(
      sql`insert into expert_referral_codes (batch_id, inviter_expert_id, code_hash, masked_suffix, hmac_key_version) values (${batch.id}::uuid, ${expertId}::uuid, ${`seed-${randomUUID()}`}, '…seed', 1)`,
    );
    const code = (
      await tx.execute<{ id: string }>(
        sql`select id from expert_referral_codes order by issued_at desc limit 1`,
      )
    ).rows[0]!;
    await tx.execute(
      sql`insert into expert_referrals (id, code_id, inviter_expert_id, invitee_expert_id) values (${referralId}::uuid, ${code.id}::uuid, ${expertId}::uuid, ${invitee.expertId}::uuid)`,
    );
    await tx.execute(
      sql`insert into expert_residency_tariff_versions (id, tariff_key, version, display_name, description, price_minor, currency, duration_seconds, active_from, created_by_admin_id, approval_id, admin_session_id_hash) values (${tariffId}::uuid, ${`seed-${tariffId}`}, 1, 'Seed', 'Seed', 1, 'RUB', 86400, '2020-01-01T00:00:00Z', ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid, ${evidence.sessionIdHash})`,
    );
    await tx.execute(
      sql`insert into expert_residency_orders (id, expert_id, tariff_version_id, tariff_name, tariff_description, price_minor, currency, duration_seconds, credit_minor, cash_minor, payment_deadline, provider_deadline, idempotency_key, status, quoted_at, settled_at, residency_starts_at, residency_ends_at) values (${orderId}::uuid, ${invitee.expertId}::uuid, ${tariffId}::uuid, 'Seed', 'Seed', 1, 'RUB', 86400, 0, 1, transaction_timestamp() + interval '2 days', transaction_timestamp() + interval '2 days', ${`seed-order-${orderId}`}, 'settled', transaction_timestamp() - interval '1 day', transaction_timestamp() - interval '1 day', transaction_timestamp() - interval '1 day', transaction_timestamp())`,
    );
    await tx.execute(
      sql`insert into expert_first_residency_settlements (id, expert_id, qualifying_order_id, eligibility_status, eligibility_reason_code, expert_active, expert_verified, unique_identity, abuse_cleared, settled_at) values (${settlementId}::uuid, ${invitee.expertId}::uuid, ${orderId}::uuid, 'eligible', 'eligible', true, true, true, true, transaction_timestamp() - interval '1 day')`,
    );
    await tx.execute(
      sql`insert into expert_referral_reward_grants (id, inviter_expert_id, referral_id, qualifying_order_id, first_settlement_id, amount_minor, granted_at, expires_at) values (${grantId}::uuid, ${expertId}::uuid, ${referralId}::uuid, ${orderId}::uuid, ${settlementId}::uuid, 100000, transaction_timestamp(), transaction_timestamp() + interval '365 days')`,
    );
    await tx.execute(
      sql`insert into expert_referral_ledger_entries (id, account_expert_id, entry_kind, amount_minor, source_type, source_id, reward_grant_id, idempotency_key) values (${ledgerId}::uuid, ${expertId}::uuid, 'reward_grant', 100000, 'reward_grant', ${grantId}::uuid, ${grantId}::uuid, ${`seed-ledger-${grantId}`})`,
    );
    await tx.execute(
      sql`insert into expert_referral_ledger_allocations (ledger_entry_id, reward_grant_id, amount_minor) values (${ledgerId}::uuid, ${grantId}::uuid, 100000)`,
    );
  });
}

describe("expert residency deadline", () => {
  it("chooses expiry at the exact database deadline", async () => {
    const decision = (
      await testDb.db.execute<{ decision: string }>(sql`
      select expert_residency_payment_deadline_state(transaction_timestamp()) as decision
    `)
    ).rows[0];

    expect(decision).toEqual({ decision: "expire_and_release" });
  });

  it("expires and releases a reservation when database time equals the deadline", async () => {
    const expert = await fixtures.createExpert();
    const tariffId = randomUUID();
    const now = await databaseNow();
    const activeFrom = new Date(now.getTime() - 86_400_000);
    const providerDeadline = new Date(now.getTime() + 86_400_000);
    const evidence = await fixtures.createAdminEvidence(
      "expert_residency.tariff_create",
      tariffId,
      {
        tariffKey: "deadline",
        version: 1,
        displayName: "Deadline",
        description: "Deadline",
        priceMinor: "2",
        durationSeconds: 86400,
        activeFrom: activeFrom.toISOString(),
        activeTo: null,
      },
    );
    await repo.createTariffVersion({
      tariffVersionId: tariffId,
      tariffKey: "deadline",
      version: 1,
      displayName: "Deadline",
      description: "Deadline",
      priceMinor: 2n,
      durationSeconds: 86400,
      activeFrom,
      activeTo: null,
      ...evidence,
    });
    await seedGrant(expert.expertId);
    const order = await repo.createCheckoutOrder({
      expertId: expert.expertId,
      tariffKey: "deadline",
      providerDeadline,
      idempotencyKey: "deadline",
    });
    await testDb.db.execute(
      sql`alter table expert_residency_orders disable trigger expert_order_snapshot_immutable`,
    );
    await testDb.db.execute(
      sql`update expert_residency_orders set payment_deadline = transaction_timestamp() where id = ${order.orderId}::uuid`,
    );
    await testDb.db.execute(
      sql`alter table expert_residency_orders enable trigger expert_order_snapshot_immutable`,
    );

    expect(await repo.releaseExpiredOrders({ orderId: order.orderId })).toEqual(
      { kind: "expired", released: true },
    );
    expect(await repo.releaseExpiredOrders({ orderId: order.orderId })).toEqual(
      { kind: "expired", released: false },
    );
    expect((await repo.balance(expert.expertId)).spendableBalanceMinor).toBe(
      "100000",
    );
  });
});
