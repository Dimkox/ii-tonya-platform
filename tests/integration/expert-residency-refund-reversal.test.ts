import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expertResidencyPaymentEventSchema } from "../../packages/contracts/src/expert-residency.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";

let testDb: ExpertReferralTestDatabase | undefined;
const providerRepo = () =>
  new PostgresExpertResidencyProviderInboxRepository(testDb!.db);
async function orderFixture() {
  const expert = await testDb!.createExpertIdentity();
  const audit = await testDb!.createAdminAudit({
    action: "expert_residency.tariff_create",
    objectId: randomUUID(),
  });
  const repo = new PostgresExpertResidencyRepository(testDb!.db);
  const tariff = await repo.createTariffVersion({
    tariffKey: `refund-${randomUUID()}`,
    displayName: "Refund",
    priceMinor: 50000n,
    durationSeconds: 86400,
    activeFrom: new Date(Date.now() - 1000),
    activeTo: new Date(Date.now() + 86400000),
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  return {
    expert,
    order: await repo.createCheckoutOrder({
      expertId: expert.expertId,
      tariffVersionId: tariff.id,
      providerDeadline: new Date(Date.now() + 3600000),
      idempotencyKey: randomUUID(),
    }),
  };
}
function providerEvent(
  kind: "settled" | "refunded" | "charged_back",
  orderId: string,
  amount: string,
  eventId: string,
) {
  return verifiedEventFixture(
    expertResidencyPaymentEventSchema.parse({
      kind,
      provider: "sandbox",
      eventId,
      paymentId: "pay_refund_1",
      orderId,
      amountMinor: amount,
      currency: "RUB",
      occurredAt: "2026-08-03T00:00:00.000Z",
      payloadDigest: `sha256:${eventId
        .padEnd(64, "a")
        .slice(0, 64)
        .replace(/[^0-9a-f]/gu, "a")}`,
    }),
    {
      verificationId: `verify_${eventId}`,
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
    },
  ) as never;
}
async function seedHistoricalDebt(expertId: string, amount: bigint) {
  const grantId = randomUUID();
  const reversalId = randomUUID();
  await testDb!.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(
      sql`insert into expert_referral_reward_grants (id,expert_id,referral_id,first_settlement_id,qualifying_order_id,qualifying_payment_attempt_id,amount_minor,granted_at,expires_at,idempotency_key) values (${grantId}::uuid,${expertId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,100000,transaction_timestamp()-interval '1 day',transaction_timestamp()+interval '364 days',${randomUUID()})`,
    );
    await tx.execute(
      sql`insert into expert_referral_ledger_entries (id,expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${reversalId}::uuid,${expertId}::uuid,'reversal',${-amount},${randomUUID()}::uuid,'historical_debt',${grantId}::uuid,${randomUUID()})`,
    );
    await tx.execute(
      sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${reversalId}::uuid,${grantId}::uuid,${expertId}::uuid,${-amount})`,
    );
  });
}
describe("expert residency refund and reversal", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120000);
  afterAll(async () => testDb?.stop());
  beforeEach(async () => testDb!.reset());
  it("bounds cumulative cash refunds and never restores credit", async () => {
    const { order } = await orderFixture();
    await providerRepo().settle(
      providerEvent("settled", order.id, "50000", "a1"),
    );
    const partial = providerEvent("refunded", order.id, "10000", "a2");
    const first = await providerRepo().reverse(partial);
    expect(first).toMatchObject({
      cashRefundedMinor: 10000n,
      restoredCreditMinor: 0n,
      rewardReversed: false,
      terminated: false,
    });
    await expect(providerRepo().reverse(partial)).resolves.toEqual(first);
    await expect(
      providerRepo().reverse(
        providerEvent("refunded", order.id, "40001", "a3"),
      ),
    ).rejects.toThrow("EXPERT_RESIDENCY_REFUND_EXCEEDS_CAPTURED_CASH");
    expect(
      (
        await testDb!.db.execute(
          sql`select count(*)::int as n from expert_residency_provider_event_inbox where event_kind='refunded' and status='processed'`,
        )
      ).rows[0]!.n,
    ).toBe(1);
    const persisted = await testDb!.db.execute<{ payload: unknown }>(
      sql`select result_payload as payload from expert_residency_provider_event_inbox where external_event_id='a2'`,
    );
    expect(persisted.rows[0]!.payload).toMatchObject({ debtMinor: "0" });
  });
  it("turns historically spent reward into debt exactly once", async () => {
    const inviter = await testDb!.createExpertIdentity();
    const { expert, order } = await orderFixture();
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(
        sql`insert into expert_referral_feature_controls (control_key,version,new_commands_enabled,reward_grants_enabled,updated_approval_id,updated_admin_session_id_hash) values ('expert_referrals',1,false,true,${randomUUID()}::uuid,'test')`,
      );
      await tx.execute(
        sql`insert into expert_referrals (id,code_id,inviter_expert_id,invitee_expert_id) values (${randomUUID()}::uuid,${randomUUID()}::uuid,${inviter.expertId}::uuid,${expert.expertId}::uuid)`,
      );
    });
    await providerRepo().settle(
      providerEvent("settled", order.id, "50000", "b1"),
    );
    const grant = (
      await testDb!.db.execute<{ id: string; ledgerId: string }>(
        sql`select g.id,e.id as "ledgerId" from expert_referral_reward_grants g join expert_referral_ledger_entries e on e.source_id=g.id and e.entry_kind='reward_grant'`,
      )
    ).rows[0]!;
    const spend = await testDb!.db.execute<{ id: string }>(
      sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${inviter.expertId}::uuid,'spend',-30000,${grant.ledgerId}::uuid,'test_spend',${order.id}::uuid,${randomUUID()}) returning id`,
    );
    await testDb!.db.execute(
      sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${spend.rows[0]!.id}::uuid,${grant.id}::uuid,${inviter.expertId}::uuid,-30000)`,
    );
    const reservation = await testDb!.db.execute<{ id: string }>(
      sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,order_id,source_type,source_id,idempotency_key) values (${inviter.expertId}::uuid,'reservation',-20000,${order.id}::uuid,'test_reservation',${order.id}::uuid,${randomUUID()}) returning id`,
    );
    const expiry = await testDb!.db.execute<{ id: string }>(
      sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${inviter.expertId}::uuid,'expiry',-10000,${grant.ledgerId}::uuid,'test_expiry',${grant.id}::uuid,${randomUUID()}) returning id`,
    );
    await testDb!.db.execute(
      sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${reservation.rows[0]!.id}::uuid,${grant.id}::uuid,${inviter.expertId}::uuid,-20000),(${expiry.rows[0]!.id}::uuid,${grant.id}::uuid,${inviter.expertId}::uuid,-10000)`,
    );
    const chargeback = providerEvent("charged_back", order.id, "50000", "b2");
    await expect(
      Promise.all([
        providerRepo().reverse(chargeback),
        providerRepo().reverse(chargeback),
      ]),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ debtMinor: 30000n, restoredCreditMinor: 0n }),
      ]),
    );
    expect(
      (
        await testDb!.db.execute(
          sql`select count(*)::int as n from expert_referral_ledger_entries where entry_kind='reversal'`,
        )
      ).rows[0]!.n,
    ).toBe(1);
    expect(
      (
        await testDb!.db.execute(
          sql`select count(*)::int as n from expert_referral_ledger_entries where entry_kind='release' and original_entry_id=${reservation.rows[0]!.id}::uuid`,
        )
      ).rows[0]!.n,
    ).toBe(1);
  });
  it.each([
    [100000n, 0],
    [60000n, 1],
  ])(
    "compensates debt repayment provenance for prior debt %s",
    async (priorDebt, expectedNewGrants) => {
      const inviter = await testDb!.createExpertIdentity();
      const { expert, order } = await orderFixture();
      await seedHistoricalDebt(inviter.expertId, priorDebt);
      await testDb!.db.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role=replica`);
        await tx.execute(
          sql`insert into expert_referral_feature_controls (control_key,version,new_commands_enabled,reward_grants_enabled,updated_approval_id,updated_admin_session_id_hash) values ('expert_referrals',1,false,true,${randomUUID()}::uuid,'test')`,
        );
        await tx.execute(
          sql`insert into expert_referrals (id,code_id,inviter_expert_id,invitee_expert_id) values (${randomUUID()}::uuid,${randomUUID()}::uuid,${inviter.expertId}::uuid,${expert.expertId}::uuid)`,
        );
      });
      await providerRepo().settle(
        providerEvent("settled", order.id, "50000", `debt${expectedNewGrants}`),
      );
      expect(
        (
          await testDb!.db.execute(
            sql`select count(*)::int as n from expert_referral_reward_grants where expert_id=${inviter.expertId}::uuid and qualifying_order_id=${order.id}::uuid`,
          )
        ).rows[0]!.n,
      ).toBe(expectedNewGrants);
      const result = await providerRepo().reverse(
        providerEvent(
          "charged_back",
          order.id,
          "50000",
          `debtcb${expectedNewGrants}`,
        ),
      );
      expect(result.debtMinor).toBe(priorDebt);
      const balance = await testDb!.db.execute<{
        available: bigint | string;
      }>(
        sql`select available_minor as available from expert_referral_balances where expert_id=${inviter.expertId}::uuid`,
      );
      expect(BigInt(balance.rows[0]?.available ?? 0)).toBe(0n);
      const repaymentReversal = await testDb!.db.execute<{ n: number }>(
        sql`select count(*)::int as n from expert_referral_ledger_entries r join expert_referral_ledger_entries p on p.id=r.original_entry_id where r.entry_kind='reversal' and r.source_type='provider_reversal' and p.entry_kind='debt_repayment' and p.source_id in (select id from expert_first_residency_settlements where qualifying_order_id=${order.id}::uuid)`,
      );
      expect(repaymentReversal.rows[0]!.n).toBe(1);
    },
  );
});
