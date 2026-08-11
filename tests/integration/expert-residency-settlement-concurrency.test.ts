import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expertResidencyPaymentEventSchema } from "../../packages/contracts/src/expert-residency.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";
let testDb: ExpertReferralTestDatabase | undefined;
describe("expert residency settlement concurrency", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
    await testDb.enableExpertReferralCommands();
  }, 120000);
  afterAll(async () => testDb?.stop());
  it("creates one marker and at most one reward", async () => {
    const expert = await testDb!.createExpertIdentity();
    const audit = await testDb!.createAdminAudit({
      action: "expert_residency.tariff_create",
      objectId: randomUUID(),
    });
    const rr = new PostgresExpertResidencyRepository(testDb!.db);
    const tariff = await rr.createTariffVersion({
      tariffKey: `race-${randomUUID()}`,
      displayName: "Race",
      priceMinor: 50000n,
      durationSeconds: 86400,
      activeFrom: new Date(Date.now() - 1000),
      activeTo: new Date(Date.now() + 86400000),
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });
    const order = await rr.createCheckoutOrder({
      expertId: expert.expertId,
      tariffVersionId: tariff.id,
      providerDeadline: new Date(Date.now() + 3600000),
      idempotencyKey: randomUUID(),
    });
    const raw = expertResidencyPaymentEventSchema.parse({
      kind: "settled",
      provider: "sandbox",
      eventId: "evt_race",
      paymentId: "pay_race",
      orderId: order.id,
      amountMinor: "50000",
      currency: "RUB",
      occurredAt: "2026-08-03T00:00:00.000Z",
      payloadDigest: `sha256:${"c".repeat(64)}`,
    });
    const verified = verifiedEventFixture(raw, {
      verificationId: "verify_race",
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
    }) as unknown as Parameters<
      PostgresExpertResidencyProviderInboxRepository["settle"]
    >[0];
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb!.db);
    const results = await Promise.all([
      repo.settle(verified),
      repo.settle(verified),
    ]);
    expect(results[0]).toEqual(results[1]);
    const counts = await testDb!.db.execute<{
      markers: number;
      rewards: number;
    }>(
      sql`select (select count(*)::int from expert_first_residency_settlements where qualifying_order_id=${order.id}::uuid) markers,(select count(*)::int from expert_referral_reward_grants where qualifying_order_id=${order.id}::uuid) rewards`,
    );
    expect(counts.rows[0]).toEqual({ markers: 1, rewards: 0 });
  });
  it("settles reciprocal referrals without deadlock", async () => {
    await testDb!.reset();
    await testDb!.enableExpertReferralCommands();
    const [a, b] = await Promise.all([
      testDb!.createExpertIdentity(),
      testDb!.createExpertIdentity(),
    ]);
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(
        sql`insert into expert_referrals (id,code_id,inviter_expert_id,invitee_expert_id) values (${randomUUID()}::uuid,${randomUUID()}::uuid,${a.expertId}::uuid,${b.expertId}::uuid),(${randomUUID()}::uuid,${randomUUID()}::uuid,${b.expertId}::uuid,${a.expertId}::uuid)`,
      );
    });
    const audit = await testDb!.createAdminAudit({
      action: "expert_residency.tariff_create",
      objectId: randomUUID(),
    });
    const rr = new PostgresExpertResidencyRepository(testDb!.db);
    const tariff = await rr.createTariffVersion({
      tariffKey: `reciprocal-${randomUUID()}`,
      displayName: "Reciprocal",
      priceMinor: 50000n,
      durationSeconds: 86400,
      activeFrom: new Date(Date.now() - 1000),
      activeTo: new Date(Date.now() + 86400000),
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });
    const [oa, ob] = await Promise.all(
      [a, b].map((expert, index) =>
        rr.createCheckoutOrder({
          expertId: expert.expertId,
          tariffVersionId: tariff.id,
          providerDeadline: new Date(Date.now() + 3600000),
          idempotencyKey: `reciprocal-${index}-${randomUUID()}`,
        }),
      ),
    );
    const make = (orderId: string, index: number) =>
      verifiedEventFixture(
        expertResidencyPaymentEventSchema.parse({
          kind: "settled",
          provider: "sandbox",
          eventId: `evt_reciprocal_${index}`,
          paymentId: `pay_reciprocal_${index}`,
          orderId,
          amountMinor: "50000",
          currency: "RUB",
          occurredAt: "2026-08-03T00:00:00.000Z",
          payloadDigest: `sha256:${String(index + 1).repeat(64)}`,
        }),
        {
          verificationId: `verify_reciprocal_${index}`,
          verifierKeyVersion: "sandbox-v1",
          verifiedAt: "2026-08-03T00:00:01.000Z",
        },
      ) as unknown as Parameters<
        PostgresExpertResidencyProviderInboxRepository["settle"]
      >[0];
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb!.db);
    await expect(
      Promise.all([repo.settle(make(oa!.id, 0)), repo.settle(make(ob!.id, 1))]),
    ).resolves.toHaveLength(2);
  });
});
