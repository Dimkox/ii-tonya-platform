import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
vi.mock(
  "@ii-tonya/integrations",
  async () =>
    await import("../../packages/integrations/src/expert-residency/verified-event.js"),
);
import { expertResidencyPaymentEventSchema } from "../../packages/contracts/src/expert-residency.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";
let testDb: ExpertReferralTestDatabase | undefined;
async function orderFixture() {
  const expert = await testDb!.createExpertIdentity();
  const audit = await testDb!.createAdminAudit({
    action: "expert_residency.tariff_create",
    objectId: randomUUID(),
  });
  const residency = new PostgresExpertResidencyRepository(testDb!.db);
  const tariff = await residency.createTariffVersion({
    tariffKey: `settlement-${randomUUID()}`,
    displayName: "Settlement",
    priceMinor: 50000n,
    durationSeconds: 86400,
    activeFrom: new Date(Date.now() - 1000),
    activeTo: new Date(Date.now() + 86400000),
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  const order = await residency.createCheckoutOrder({
    expertId: expert.expertId,
    tariffVersionId: tariff.id,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  return { expert, order };
}
function event(
  orderId: string,
  eventId = "evt_00000001",
  digest = `sha256:${"a".repeat(64)}`,
) {
  return verifiedEventFixture(
    expertResidencyPaymentEventSchema.parse({
      kind: "settled",
      provider: "sandbox",
      eventId,
      paymentId: "pay_00000001",
      orderId,
      amountMinor: "50000",
      currency: "RUB",
      occurredAt: "2026-08-03T00:00:00.000Z",
      payloadDigest: digest,
    }),
    {
      verificationId: "verify_00000001",
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
    },
  ) as unknown as Parameters<
    PostgresExpertResidencyProviderInboxRepository["settle"]
  >[0];
}
describe("expert residency settlement", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120000);
  afterAll(async () => testDb?.stop());
  beforeEach(async () => testDb!.reset());
  it("settles once without inventing a referral reward", async () => {
    const { order } = await orderFixture();
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb!.db);
    const result = await repo.settle(event(order.id));
    expect(result).toMatchObject({
      kind: "settled",
      orderId: order.id,
      firstSettlement: true,
      rewardGranted: false,
    });
    const rows = await testDb!.db.execute(
      sql`select count(*)::int as n from expert_first_residency_settlements where qualifying_order_id=${order.id}::uuid`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });
  it("returns the exact prior result and rejects conflicting replay content", async () => {
    const { order } = await orderFixture();
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb!.db);
    const first = await repo.settle(event(order.id));
    await expect(repo.settle(event(order.id))).resolves.toEqual(first);
    await expect(
      repo.settle(event(order.id, "evt_00000001", `sha256:${"b".repeat(64)}`)),
    ).rejects.toThrow("EXPERT_RESIDENCY_PROVIDER_EVENT_CONFLICT");
  });
  it("rejects mismatched amount before settlement", async () => {
    const { order } = await orderFixture();
    const bad = verifiedEventFixture(
      expertResidencyPaymentEventSchema.parse({
        kind: "settled",
        provider: "sandbox",
        eventId: "evt_mismatch",
        paymentId: "pay_mismatch",
        orderId: order.id,
        amountMinor: "49999",
        currency: "RUB",
        occurredAt: "2026-08-03T00:00:00.000Z",
        payloadDigest: `sha256:${"d".repeat(64)}`,
      }),
      {
        verificationId: "verify_2",
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:01.000Z",
      },
    ) as unknown as Parameters<
      PostgresExpertResidencyProviderInboxRepository["settle"]
    >[0];
    await expect(
      new PostgresExpertResidencyProviderInboxRepository(testDb!.db).settle(
        bad,
      ),
    ).rejects.toThrow("EXPERT_RESIDENCY_PAYMENT_MISMATCH");
  });
  it("repays multiple debt grants FIFO with allocations and replay idempotency", async () => {
    const inviter = await testDb!.createExpertIdentity();
    const { expert: invitee, order } = await orderFixture();
    const approval = await testDb!.createFeatureControlApproval({
      expectedVersion: 0,
      newCommandsEnabled: false,
      rewardGrantsEnabled: true,
    });
    await testDb!.db.execute(
      sql`insert into expert_referral_feature_controls (control_key,version,new_commands_enabled,reward_grants_enabled,updated_approval_id,updated_admin_session_id_hash) values ('expert_referrals',1,false,true,${approval.approvalId}::uuid,${approval.sessionIdHash})`,
    );
    const referralId = randomUUID(),
      grantOne = "ffffffff-ffff-4fff-8fff-ffffffffffff",
      grantTwo = "00000000-0000-4000-8000-000000000001",
      reversalOne = randomUUID(),
      reversalTwo = randomUUID();
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(
        sql`insert into expert_referrals (id,code_id,inviter_expert_id,invitee_expert_id) values (${referralId}::uuid,${randomUUID()}::uuid,${inviter.expertId}::uuid,${invitee.expertId}::uuid)`,
      );
      for (const [grantId, amount, reversalId, days] of [
        [grantOne, 60000, reversalOne, 2],
        [grantTwo, 70000, reversalTwo, 1],
      ] as const) {
        await tx.execute(
          sql`insert into expert_referral_reward_grants (id,expert_id,referral_id,first_settlement_id,qualifying_order_id,qualifying_payment_attempt_id,amount_minor,granted_at,expires_at,idempotency_key) values (${grantId}::uuid,${inviter.expertId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,100000,transaction_timestamp()-(${days}||' days')::interval,transaction_timestamp()+(${365 - days}||' days')::interval,${randomUUID()})`,
        );
        await tx.execute(
          sql`insert into expert_referral_ledger_entries (id,expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${reversalId}::uuid,${inviter.expertId}::uuid,'reversal',${-amount},${randomUUID()}::uuid,'test_debt',${grantId}::uuid,${randomUUID()})`,
        );
        await tx.execute(
          sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${reversalId}::uuid,${grantId}::uuid,${inviter.expertId}::uuid,${-amount})`,
        );
      }
    });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb!.db);
    const verified = event(order.id, "evt_debt", `sha256:${"e".repeat(64)}`);
    const first = await repo.settle(verified);
    await expect(repo.settle(verified)).resolves.toEqual(first);
    const allocations = await testDb!.db.execute<{
      grantId: string;
      amount: string | bigint;
    }>(
      sql`select a.reward_grant_id as "grantId",a.amount_minor as amount from expert_referral_ledger_allocations a join expert_referral_ledger_entries e on e.id=a.ledger_entry_id where e.entry_kind='debt_repayment' and e.source_id in (select id from expert_first_residency_settlements where qualifying_order_id=${order.id}::uuid) order by a.reward_grant_id`,
    );
    expect(allocations.rows.map((x) => [x.grantId, BigInt(x.amount)])).toEqual(
      expect.arrayContaining([
        [grantOne, 60000n],
        [grantTwo, 40000n],
      ]),
    );
    expect(allocations.rows).toHaveLength(2);
  });
  it("repays partial debt and grants the exact spendable remainder once", async () => {
    const inviter = await testDb!.createExpertIdentity();
    const { expert: invitee, order } = await orderFixture();
    const approval = await testDb!.createFeatureControlApproval({
      expectedVersion: 0,
      newCommandsEnabled: false,
      rewardGrantsEnabled: true,
    });
    await testDb!.db.execute(
      sql`insert into expert_referral_feature_controls (control_key,version,new_commands_enabled,reward_grants_enabled,updated_approval_id,updated_admin_session_id_hash) values ('expert_referrals',1,false,true,${approval.approvalId}::uuid,${approval.sessionIdHash})`,
    );
    const referral = randomUUID(),
      grant = randomUUID(),
      reversal = randomUUID();
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(
        sql`insert into expert_referrals (id,code_id,inviter_expert_id,invitee_expert_id) values (${referral}::uuid,${randomUUID()}::uuid,${inviter.expertId}::uuid,${invitee.expertId}::uuid)`,
      );
      await tx.execute(
        sql`insert into expert_referral_reward_grants (id,expert_id,referral_id,first_settlement_id,qualifying_order_id,qualifying_payment_attempt_id,amount_minor,granted_at,expires_at,idempotency_key) values (${grant}::uuid,${inviter.expertId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,100000,transaction_timestamp()-interval '1 day',transaction_timestamp()+interval '364 days',${randomUUID()})`,
      );
      await tx.execute(
        sql`insert into expert_referral_ledger_entries (id,expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${reversal}::uuid,${inviter.expertId}::uuid,'reversal',-30000,${randomUUID()}::uuid,'test_debt',${grant}::uuid,${randomUUID()})`,
      );
      await tx.execute(
        sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${reversal}::uuid,${grant}::uuid,${inviter.expertId}::uuid,-30000)`,
      );
    });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb!.db);
    const verified = event(
      order.id,
      "evt_partial_debt",
      `sha256:${"f".repeat(64)}`,
    );
    const first = await repo.settle(verified);
    await expect(repo.settle(verified)).resolves.toEqual(first);
    const totals = await testDb!.db.execute<{
      repaid: bigint | string;
      granted: bigint | string;
      allocations: number;
    }>(
      sql`select coalesce(sum(e.amount_minor) filter(where e.entry_kind='debt_repayment'),0)::bigint repaid,coalesce(sum(e.amount_minor) filter(where e.entry_kind='reward_grant' and e.source_type='reward_grant'),0)::bigint granted,(select count(*)::int from expert_referral_ledger_allocations a join expert_referral_ledger_entries x on x.id=a.ledger_entry_id where x.expert_id=${inviter.expertId}::uuid and (x.source_type='first_settlement' or (x.source_type='reward_grant' and x.source_id in (select id from expert_referral_reward_grants where qualifying_order_id=${order.id}::uuid)))) allocations from expert_referral_ledger_entries e where e.expert_id=${inviter.expertId}::uuid`,
    );
    expect({
      ...totals.rows[0],
      repaid: BigInt(totals.rows[0]!.repaid),
      granted: BigInt(totals.rows[0]!.granted),
    }).toEqual({ repaid: 30000n, granted: 70000n, allocations: 2 });
  });
});
