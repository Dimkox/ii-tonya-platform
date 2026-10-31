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
it("records reconciliation when a wave refund precedes a future legacy coverage", async () => {
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
  const intent = coverage.intentId;
  await coverage.recordWaveSuccess();
  const wave = (
    await fixture.db.execute<{ starts: string | Date; ends: string | Date }>(
      sql`select starts_at as starts,ends_at as ends from early_bird_effective_coverages where intent_id=${intent}::uuid`,
    )
  ).rows[0]!;
  const settled = await new PostgresExpertResidencyProviderInboxRepository(
    fixture.db,
  ).settle(event as never);
  expect(settled.residencyStartsAt).toBe(new Date(wave.ends).toISOString());
  expect(new Date(settled.residencyStartsAt).getTime()).toBeGreaterThan(
    Date.now(),
  );
  const immutableOrder = (
    await fixture.db.execute(
      sql`select to_jsonb(o) value from expert_residency_orders o where id=${order.id}::uuid`,
    )
  ).rows[0]!.value;
  await coverage.recordFullRefund();
  // Replay the exact persisted canonical refund command, preserving SQL times
  // and its original verified identity. Do not manufacture another provider fact.
  await fixture.db.execute(
    sql`select early_bird_record_full_refund(r.intent_id,r.user_id,r.provider_refund_id,r.evidence_digest,r.amount_minor,r.occurred_at) from early_bird_payment_full_refunds r where r.intent_id=${intent}::uuid`,
  );
  const pending = await fixture.db.execute<{ orderId: string }>(
    sql`select order_id as "orderId" from early_bird_coverage_reconciliation where intent_id=${intent}::uuid`,
  );
  expect(pending.rows.map((row) => row.orderId)).toEqual([order.id]);
  expect(
    (
      await fixture.db.execute(
        sql`select count(*)::int n from early_bird_payment_full_refunds where intent_id=${intent}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(1);
  expect(
    (
      await fixture.db.execute(
        sql`select to_jsonb(o) value from expert_residency_orders o where id=${order.id}::uuid`,
      )
    ).rows[0]!.value,
  ).toEqual(immutableOrder);
  await expect(
    fixture.db.execute(
      sql`select early_bird_active_coverage_end(${expert.userId}::uuid)`,
    ),
  ).rejects.toThrow();
}, 120_000);
