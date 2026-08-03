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
    await expect(providerRepo().reverse(partial)).resolves.toMatchObject({
      cashRefundedMinor: 10000n,
      restoredCreditMinor: 0n,
      rewardReversed: false,
      terminated: false,
    });
    await expect(providerRepo().reverse(partial)).resolves.toMatchObject({
      cashRefundedMinor: 10000n,
      terminated: false,
    });
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
      sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key) values (${inviter.expertId}::uuid,'spend',-60000,${grant.ledgerId}::uuid,'test_spend',${order.id}::uuid,${randomUUID()}) returning id`,
    );
    await testDb!.db.execute(
      sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${spend.rows[0]!.id}::uuid,${grant.id}::uuid,${inviter.expertId}::uuid,-60000)`,
    );
    const chargeback = providerEvent("charged_back", order.id, "50000", "b2");
    await expect(
      Promise.all([
        providerRepo().reverse(chargeback),
        providerRepo().reverse(chargeback),
      ]),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ debtMinor: 60000n, restoredCreditMinor: 0n }),
      ]),
    );
    expect(
      (
        await testDb!.db.execute(
          sql`select count(*)::int as n from expert_referral_ledger_entries where entry_kind='reversal'`,
        )
      ).rows[0]!.n,
    ).toBe(1);
  });
});
