import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expertResidencyPaymentEventSchema } from "../../packages/contracts/src/expert-residency.js";
import { PostgresExpertReferralWorkerRepository } from "../../packages/db/src/repositories/expert-referral-worker-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";

let testDb: ExpertReferralTestDatabase | undefined;

const provider = () =>
  new PostgresExpertResidencyProviderInboxRepository(testDb!.db);
const worker = () => new PostgresExpertReferralWorkerRepository(testDb!.db);

function event(
  kind: "settled" | "refunded" | "charged_back",
  orderId: string,
  eventId: string,
  amountMinor = "390000",
) {
  return verifiedEventFixture(
    expertResidencyPaymentEventSchema.parse({
      kind,
      provider: "matrix",
      eventId,
      paymentId: `pay_${orderId}`,
      orderId,
      amountMinor,
      currency: "RUB",
      occurredAt: "2026-08-29T00:00:00.000Z",
      payloadDigest: `sha256:${eventId
        .padEnd(64, "a")
        .slice(0, 64)
        .replace(/[^0-9a-f]/gu, "a")}`,
    }),
    {
      verificationId: `verify_${eventId}`,
      verifierKeyVersion: "matrix-v1",
      verifiedAt: "2026-08-29T00:00:01.000Z",
    },
  ) as never;
}

async function fixture(
  policy: "expert_residency_v2" | "legacy_residency_v1" = "expert_residency_v2",
) {
  const inviter = await testDb!.createExpertIdentity();
  const invitee = await testDb!.createExpertIdentity();
  const residency = new PostgresExpertResidencyRepository(testDb!.db);
  const audit = await testDb!.createAdminAudit({
    action: "expert_residency.tariff_create",
    objectId: randomUUID(),
  });
  const tariff = await residency.createTariffVersion({
    tariffKey: `maturity-${randomUUID()}`,
    displayName: "Maturity",
    priceMinor: 50000n,
    durationSeconds: 86400,
    activeFrom: new Date(Date.now() - 1000),
    activeTo: new Date(Date.now() + 86400000),
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  await testDb!.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    if (policy === "expert_residency_v2")
      await tx.execute(
        sql`update expert_residency_tariff_versions set tariff_key='START',display_name='Старт',price_minor=390000,duration_seconds=2592000,commercial_policy_version='expert_residency_v2',credit_cap_bps=3000,individual_services_enabled=true,group_event_limit=0,statistics_level='basic',support_priority='standard' where id=${tariff.id}::uuid`,
      );
    await tx.execute(
      sql`update expert_referral_feature_controls set version=version+1, reward_grants_enabled=true where control_key='expert_referrals'`,
    );
    await tx.execute(
      sql`insert into expert_referrals (id,code_id,inviter_expert_id,invitee_expert_id) values (${randomUUID()}::uuid,${randomUUID()}::uuid,${inviter.expertId}::uuid,${invitee.expertId}::uuid)`,
    );
  });
  const order = await residency.createCheckoutOrder({
    expertId: invitee.expertId,
    tariffVersionId: tariff.id,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  return { inviter, invitee, order };
}

async function makeDue(orderId: string, offset = "0 seconds") {
  await testDb!.db.execute(sql`
    update expert_referral_reward_maturities
    set settled_at=transaction_timestamp()-interval '30 days'-(${offset})::interval,
        matures_at=transaction_timestamp()-(${offset})::interval,
        lease_until=null
    where qualifying_order_id=${orderId}::uuid
  `);
}

async function maturity(orderId: string) {
  return testDb!.db.execute<{
    id: string;
    status: string;
    maturesAt: Date;
  }>(sql`
    select id,status,matures_at as "maturesAt" from expert_referral_reward_maturities
    where qualifying_order_id=${orderId}::uuid
  `);
}

describe("A2.1 real-PostgreSQL referral maturity matrix", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120000);
  afterAll(async () => testDb?.stop());
  beforeEach(async () => {
    await testDb!.reset();
    await testDb!.enableExpertReferralCommands();
  });

  it("keeps V2 settlements pending without spendable credit while legacy compatibility remains immediate", async () => {
    const v2 = await fixture();
    await expect(
      provider().settle(event("settled", v2.order.id, "v2_settlement")),
    ).resolves.toMatchObject({ rewardGranted: false, eligibility: "eligible" });
    expect((await maturity(v2.order.id)).rows).toMatchObject([
      { status: "pending" },
    ]);
    expect(
      (
        await testDb!.db.execute(
          sql`select count(*)::int as n from expert_referral_reward_grants`,
        )
      ).rows[0]!.n,
    ).toBe(0);
    const legacy = await fixture("legacy_residency_v1");
    await expect(
      provider().settle(
        event("settled", legacy.order.id, "legacy_settlement", "50000"),
      ),
    ).resolves.toMatchObject({ rewardGranted: true });
  });

  it("uses database time at the due boundary instead of caller time", async () => {
    const { order } = await fixture();
    await provider().settle(event("settled", order.id, "clock_settlement"));
    await makeDue(order.id, "-1 hour");
    await expect(
      worker().grantDueMaturityBatch({
        now: new Date("2099-01-01T00:00:00.000Z"),
        batchSize: 1,
      }),
    ).resolves.toMatchObject({ examined: 0, granted: 0 });
    await makeDue(order.id);
    await expect(
      worker().grantDueMaturityBatch({
        now: new Date("2000-01-01T00:00:00.000Z"),
        batchSize: 1,
      }),
    ).resolves.toMatchObject({ granted: 1 });
  });

  it("is idempotent across duplicate batches, concurrent workers, and an expired lease", async () => {
    const { order } = await fixture();
    await provider().settle(event("settled", order.id, "lease_settlement"));
    await makeDue(order.id);
    await testDb!.db.execute(
      sql`update expert_referral_reward_maturities set lease_until=transaction_timestamp()-interval '1 second' where qualifying_order_id=${order.id}::uuid`,
    );
    const results = await Promise.all([
      worker().grantDueMaturityBatch({ now: new Date(), batchSize: 1 }),
      worker().grantDueMaturityBatch({ now: new Date(), batchSize: 1 }),
    ]);
    expect(results.reduce((total, result) => total + result.granted, 0)).toBe(
      1,
    );
    await expect(
      worker().grantDueMaturityBatch({ now: new Date(), batchSize: 1 }),
    ).resolves.toMatchObject({ examined: 0, granted: 0 });
    expect(
      (
        await testDb!.db.execute(
          sql`select count(*)::int as n from expert_referral_reward_grants where maturity_id is not null`,
        )
      ).rows[0]!.n,
    ).toBe(1);
  });

  it("leaves a due maturity pending while the feature switch is off", async () => {
    const { order } = await fixture();
    await provider().settle(event("settled", order.id, "gate_settlement"));
    await makeDue(order.id);
    await testDb!.db.execute(
      sql`update expert_referral_feature_controls set reward_grants_enabled=false where control_key='expert_referrals'`,
    );
    await expect(
      worker().grantDueMaturityBatch({ now: new Date(), batchSize: 1 }),
    ).resolves.toMatchObject({ pending: 1, granted: 0, cancelled: 0 });
    expect((await maturity(order.id)).rows).toMatchObject([
      { status: "pending" },
    ]);
  });

  it("lets a full terminating refund cancel a due pending maturity before the worker", async () => {
    const { order } = await fixture();
    await provider().settle(
      event("settled", order.id, "refund_first_settlement"),
    );
    await makeDue(order.id);
    await expect(
      provider().reverse(event("refunded", order.id, "refund_first")),
    ).resolves.toMatchObject({ terminated: true, rewardReversed: false });
    await expect(
      worker().grantDueMaturityBatch({ now: new Date(), batchSize: 1 }),
    ).resolves.toMatchObject({ examined: 0, granted: 0 });
    expect((await maturity(order.id)).rows).toMatchObject([
      { status: "cancelled" },
    ]);
  });

  it("binds a matured grant to its maturity and reverses unused value without debt", async () => {
    const { inviter, order } = await fixture();
    await provider().settle(event("settled", order.id, "grant_settlement"));
    await makeDue(order.id);
    await worker().grantDueMaturityBatch({ now: new Date(), batchSize: 1 });
    const grant = await testDb!.db.execute<{ maturityId: string | null }>(
      sql`select maturity_id as "maturityId" from expert_referral_reward_grants`,
    );
    expect(grant.rows).toHaveLength(1);
    expect(grant.rows[0]!.maturityId).not.toBeNull();
    await expect(
      provider().reverse(event("charged_back", order.id, "grant_refund")),
    ).resolves.toMatchObject({ rewardReversed: true, debtMinor: 0n });
    const balance = await testDb!.db.execute<{
      available: bigint | string;
      debt: bigint | string;
    }>(
      sql`select available_credit_minor as available,debt_minor as debt from expert_referral_balances where expert_id=${inviter.expertId}::uuid`,
    );
    expect(BigInt(balance.rows[0]!.available)).toBe(0n);
    expect(BigInt(balance.rows[0]!.debt)).toBe(0n);
  });

  it("conserves a spent matured reward as recoverable debt on terminating reversal", async () => {
    const { inviter, order } = await fixture();
    await provider().settle(event("settled", order.id, "spent_settlement"));
    await makeDue(order.id);
    await worker().grantDueMaturityBatch({ now: new Date(), batchSize: 1 });
    const grant = (
      await testDb!.db.execute<{ id: string; ledgerId: string }>(
        sql`select g.id,e.id as "ledgerId" from expert_referral_reward_grants g join expert_referral_ledger_entries e on e.source_id=g.id and e.entry_kind='reward_grant'`,
      )
    ).rows[0]!;
    const spendId = randomUUID();
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(
        sql`insert into expert_referral_ledger_entries (id,expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${spendId}::uuid,${inviter.expertId}::uuid,'spend',-40000,${grant.ledgerId}::uuid,'matrix_spend',${order.id}::uuid,${randomUUID()})`,
      );
      await tx.execute(
        sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${spendId}::uuid,${grant.id}::uuid,${inviter.expertId}::uuid,-40000)`,
      );
    });
    await expect(
      provider().reverse(event("charged_back", order.id, "spent_refund")),
    ).resolves.toMatchObject({ rewardReversed: true, debtMinor: 40000n });
    const balance = await testDb!.db.execute<{
      available: bigint | string;
      debt: bigint | string;
    }>(
      sql`select available_credit_minor as available,debt_minor as debt from expert_referral_balances where expert_id=${inviter.expertId}::uuid`,
    );
    expect(BigInt(balance.rows[0]!.available)).toBe(0n);
    expect(BigInt(balance.rows[0]!.debt)).toBe(40000n);
  });

  it("cancels a due pending maturity before a terminating refund and permits only serialized refund-or-maturity histories", async () => {
    for (let round = 0; round < 3; round += 1) {
      await testDb!.reset();
      await testDb!.enableExpertReferralCommands();
      const { order } = await fixture();
      await provider().settle(
        event("settled", order.id, `race_settlement_${round}`),
      );
      await makeDue(order.id);
      await Promise.all([
        worker().grantDueMaturityBatch({ now: new Date(), batchSize: 1 }),
        provider().reverse(event("refunded", order.id, `race_refund_${round}`)),
      ]);
      const state = (await maturity(order.id)).rows[0]!;
      expect(["cancelled", "granted"]).toContain(state.status);
      expect(
        (
          await testDb!.db.execute(
            sql`select count(*)::int as n from expert_referral_reward_grants`,
          )
        ).rows[0]!.n,
      ).toBeLessThanOrEqual(1);
    }
  }, 120000);
});
