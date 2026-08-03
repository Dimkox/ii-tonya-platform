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
import {
  assertVerifiedExpertResidencyPaymentEvent,
  verifiedEventFixture,
} from "../../packages/integrations/src/expert-residency/verified-event.js";
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
    const repo = new PostgresExpertResidencyProviderInboxRepository(
      testDb!.db,
      assertVerifiedExpertResidencyPaymentEvent,
    );
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
    const repo = new PostgresExpertResidencyProviderInboxRepository(
      testDb!.db,
      assertVerifiedExpertResidencyPaymentEvent,
    );
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
        ...event(order.id),
        amountMinor: "49999",
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
      new PostgresExpertResidencyProviderInboxRepository(
        testDb!.db,
        assertVerifiedExpertResidencyPaymentEvent,
      ).settle(bad),
    ).rejects.toThrow("EXPERT_RESIDENCY_PAYMENT_MISMATCH");
  });
});
