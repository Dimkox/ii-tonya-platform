import { createEarlyBirdCanonicalCoverageFixture } from "../testkit/early-bird-canonical-coverage-fixture.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { expertResidencyPaymentEventSchema } from "@ii-tonya/contracts";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/verified-event.js";
import type { ExpertReferralTestDatabase } from "../testkit/expert-referral.js";
import { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
let fixture: ExpertReferralTestDatabase;
let coverage: Awaited<
  ReturnType<typeof createEarlyBirdCanonicalCoverageFixture>
>;
beforeAll(async () => {
  coverage = await createEarlyBirdCanonicalCoverageFixture();
  fixture = coverage.db;
}, 120_000);
afterAll(async () => {
  await coverage?.stop();
}, 120_000);
it("retries legacy settlement after an overlapping wave payment commits", async () => {
  const expert = coverage.expert;
  const repository = new PostgresExpertResidencyRepository(fixture.db);
  const audit = await fixture.createAdminAudit({
    action: "expert_residency.tariff_create",
    objectId: randomUUID(),
  });
  const tariff = await repository.createTariffVersion({
    tariffKey: `test-${randomUUID()}`,
    displayName: "Test",
    priceMinor: 50000n,
    durationSeconds: 86400,
    activeFrom: new Date(Date.now() - 1000),
    activeTo: new Date(Date.now() + 86400000),
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  const order = await repository.createCheckoutOrder({
    expertId: expert.expertId,
    tariffVersionId: tariff.id,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  const event = verifiedEventFixture(
    expertResidencyPaymentEventSchema.parse({
      kind: "settled",
      provider: "sandbox",
      eventId: `evt_${randomUUID()}`,
      paymentId: `pay_${randomUUID()}`,
      orderId: order.id,
      amountMinor: "50000",
      currency: "RUB",
      occurredAt: new Date().toISOString(),
      payloadDigest: `sha256:${"a".repeat(64)}`,
    }),
    {
      verificationId: `verify_${randomUUID()}`,
      verifierKeyVersion: "test-v1",
      verifiedAt: new Date().toISOString(),
    },
  );
  // Legacy establishes its SERIALIZABLE snapshot before awaiting the subject
  // lock. The wave writer commits an epoch and paid interval while it waits.
  let release!: () => void, held!: () => void;
  const ready = new Promise<void>((resolve) => {
    held = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wave = fixture.db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level serializable`);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${expert.userId}::uuid::text,0))`,
    );
    held();
    await gate;
    await tx.execute(
      sql`select early_bird_commit_verified_payment(${JSON.stringify(coverage.paymentSnapshot)}::jsonb,${coverage.paymentProof.evidenceDigest},${coverage.paymentProof.capturedAt}::timestamptz)`,
    );
  });
  await ready;
  const pending = new PostgresExpertResidencyProviderInboxRepository(
    fixture.db,
    { waveCoverage: true },
  ).settle(event as never);
  const outcome = pending.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  let waited = false;
  try {
    for (let n = 0; n < 20; n++) {
      const seen = await fixture.db.execute<{ waiting: boolean }>(
        sql`select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and wait_event='advisory') as waiting`,
      );
      if (seen.rows[0]?.waiting) {
        waited = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release();
    await wave;
  }
  const result = await outcome;
  expect(waited).toBe(true);
  expect(result).toHaveProperty(
    "value.residencyStartsAt",
    "2027-02-09T21:00:00.000Z",
  );
  const committed = await fixture.db.execute<{
    ends: Date | string;
    provider: string;
  }>(
    sql`select c.ends_at as ends,s.provider_object_id as provider from early_bird_effective_coverages c join early_bird_payment_successes s on s.intent_id=c.intent_id where c.intent_id=${coverage.intentId}::uuid`,
  );
  expect(new Date(committed.rows[0]!.ends).toISOString()).toBe(
    "2027-02-09T21:00:00.000Z",
  );
  expect(committed.rows[0]!.provider).toBe(coverage.payment.id);
}, 120_000);
