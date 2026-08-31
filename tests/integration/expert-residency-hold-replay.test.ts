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
const provider = () =>
  new PostgresExpertResidencyProviderInboxRepository(testDb!.db);
async function setup(enabled: boolean, abuseHold = false) {
  await testDb!.enableExpertReferralCommands();
  const inviter = await testDb!.createExpertIdentity();
  const invitee = await testDb!.createExpertIdentity();
  const residency = new PostgresExpertResidencyRepository(testDb!.db);
  const tariff = {
    id: await testDb!.createResidencyTariff({
      tariffKey: `hold-${randomUUID()}`,
      displayName: "Hold",
      priceMinor: 50000,
      durationSeconds: 86400,
      commercialPolicyVersion: "legacy_residency_v1",
    }),
  };
  const order = await residency.createCheckoutOrder({
    expertId: invitee.expertId,
    tariffVersionId: tariff.id,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  await testDb!.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(
      sql`update expert_referral_feature_controls set reward_grants_enabled=${enabled} where control_key='expert_referrals'`,
    );
    await tx.execute(
      sql`insert into expert_referrals (id,code_id,inviter_expert_id,invitee_expert_id) values (${randomUUID()}::uuid,${randomUUID()}::uuid,${inviter.expertId}::uuid,${invitee.expertId}::uuid)`,
    );
    if (abuseHold)
      await tx.execute(
        sql`insert into expert_referral_abuse_holds (expert_id,status,reason_code,opened_approval_id,opened_admin_session_id_hash) values (${invitee.expertId}::uuid,'open','risk',${randomUUID()}::uuid,'test')`,
      );
  });
  return { inviter, invitee, order };
}
function payment(
  kind: "settled" | "charged_back",
  orderId: string,
  eventId: string,
) {
  return verifiedEventFixture(
    expertResidencyPaymentEventSchema.parse({
      kind,
      provider: "sandbox",
      eventId,
      paymentId: "pay_hold_1",
      orderId,
      amountMinor: "50000",
      currency: "RUB",
      occurredAt: "2026-08-03T00:00:00.000Z",
      payloadDigest: `sha256:${"c".repeat(64)}`,
    }),
    {
      verificationId: `verify_${eventId}`,
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
    },
  ) as never;
}
describe("expert residency held reward replay", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120000);
  afterAll(async () => testDb?.stop());
  beforeEach(async () => testDb!.reset(), 120000);
  it("serializes termination with replay and never grants a cancelled hold", async () => {
    const { inviter, invitee, order } = await setup(false);
    await expect(
      provider().settle(payment("settled", order.id, "hold_settle")),
    ).resolves.toMatchObject({
      rewardGranted: false,
      eligibility: "pending_feature_hold",
    });
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(
        sql`update expert_referral_feature_controls set version=2,reward_grants_enabled=true where control_key='expert_referrals'`,
      );
    });
    await Promise.all([
      provider().reverse(payment("charged_back", order.id, "hold_chargeback")),
      provider().replayHeldReward(invitee.expertId),
    ]);
    const marker = await testDb!.db.execute<{ eligibility: string }>(
      sql`select eligibility from expert_first_residency_settlements where expert_id=${invitee.expertId}::uuid`,
    );
    expect(marker.rows[0]!.eligibility).toBe("cancelled_by_refund");
    const balance = await testDb!.db.execute<{
      available: bigint | string;
      debt: bigint | string;
    }>(
      sql`select available_credit_minor as available,debt_minor as debt from expert_referral_balances where expert_id=${inviter.expertId}::uuid`,
    );
    expect(BigInt(balance.rows[0]?.available ?? 0)).toBe(0n);
    expect(BigInt(balance.rows[0]?.debt ?? 0)).toBe(0n);
  });
  it("captures an open abuse hold as permanently ineligible", async () => {
    const { invitee, order } = await setup(true, true);
    await expect(
      provider().settle(payment("settled", order.id, "abuse_settle")),
    ).resolves.toMatchObject({
      rewardGranted: false,
      eligibility: "permanently_ineligible",
    });
    const marker = await testDb!.db.execute<{ reason: string }>(
      sql`select reason_code as reason from expert_first_residency_settlements where expert_id=${invitee.expertId}::uuid`,
    );
    expect(marker.rows[0]!.reason).toBe("ineligible_abuse_hold");
  });
  it("locks complete expert sets deterministically for reciprocal replay", async () => {
    const { inviter, invitee, order } = await setup(false);
    const orderRow = await testDb!.db.execute<{ tariffId: string }>(
      sql`select tariff_version_id as "tariffId" from expert_residency_orders where id=${order.id}::uuid`,
    );
    const reciprocalOrder = await new PostgresExpertResidencyRepository(
      testDb!.db,
    ).createCheckoutOrder({
      expertId: inviter.expertId,
      tariffVersionId: orderRow.rows[0]!.tariffId,
      providerDeadline: new Date(Date.now() + 3600000),
      idempotencyKey: randomUUID(),
    });
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(
        sql`insert into expert_referrals (id,code_id,inviter_expert_id,invitee_expert_id) values (${randomUUID()}::uuid,${randomUUID()}::uuid,${invitee.expertId}::uuid,${inviter.expertId}::uuid)`,
      );
    });
    await provider().settle(payment("settled", order.id, "reciprocal_b"));
    await provider().settle(
      verifiedEventFixture(
        expertResidencyPaymentEventSchema.parse({
          kind: "settled",
          provider: "sandbox",
          eventId: "reciprocal_a",
          paymentId: "pay_hold_2",
          orderId: reciprocalOrder.id,
          amountMinor: "50000",
          currency: "RUB",
          occurredAt: "2026-08-03T00:00:00.000Z",
          payloadDigest: `sha256:${"d".repeat(64)}`,
        }),
        {
          verificationId: "verify_reciprocal_a",
          verifierKeyVersion: "sandbox-v1",
          verifiedAt: "2026-08-03T00:00:01.000Z",
        },
      ) as never,
    );
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(
        sql`update expert_referral_feature_controls set version=2,reward_grants_enabled=true where control_key='expert_referrals'`,
      );
    });
    await expect(
      Promise.all([
        provider().replayHeldReward(inviter.expertId),
        provider().replayHeldReward(invitee.expertId),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ kind: "granted" }),
      expect.objectContaining({ kind: "granted" }),
    ]);
  });
});
