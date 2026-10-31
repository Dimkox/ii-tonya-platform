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
it("chains wave prepayment after an existing long legacy coverage", async () => {
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
    durationSeconds: 31536000,
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
  const intent = coverage.intentId;
  const previous = await new PostgresExpertResidencyProviderInboxRepository(
    fixture.db,
    { waveCoverage: true },
  ).settle(event as never);
  await coverage.recordWaveSuccess();
  const wave = await fixture.db.execute<{ starts: Date | string }>(
    sql`select starts_at as starts from early_bird_payment_successes where intent_id=${intent}::uuid`,
  );
  expect(new Date(wave.rows[0]!.starts).toISOString()).toBe(
    previous.residencyEndsAt,
  );
}, 120_000);
