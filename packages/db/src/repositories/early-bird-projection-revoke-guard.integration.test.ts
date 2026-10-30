import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createEarlyBirdCanonicalCoverageFixture } from "../testkit/early-bird-canonical-coverage-fixture.js";

let coverage: Awaited<
  ReturnType<typeof createEarlyBirdCanonicalCoverageFixture>
>;
beforeAll(async () => {
  coverage = await createEarlyBirdCanonicalCoverageFixture();
  await coverage.recordWaveSuccess();
  // Both isolated clocks pass the immutable launch; a real paid period is active.
  await coverage.advanceClock(
    (Date.parse("2027-01-12T12:00:00Z") - Date.now()) / 1000,
  );
}, 120_000);
afterAll(async () => {
  await coverage?.stop();
}, 120_000);
async function state() {
  return (
    await coverage.db.db.execute<{
      paid: boolean;
      active: boolean;
      approvedCards: number;
      admissions: number;
      publications: number;
      refunds: number;
    }>(sql`select
    exists(select 1 from early_bird_payment_successes where intent_id=${coverage.intentId}::uuid and user_id=${coverage.expert.userId}::uuid and provider_object_id=${coverage.payment.id} and disposition='eligible') paid,
    exists(select 1 from early_bird_effective_coverages where intent_id=${coverage.intentId}::uuid and starts_at<=clock_timestamp() and ends_at>clock_timestamp()) active,
    (select count(*)::int from expert_card_drafts where user_id=${coverage.expert.userId}::uuid and status='approved') as "approvedCards",
    (select count(*)::int from early_bird_admissions where intent_id=${coverage.intentId}::uuid) admissions,
    (select count(*)::int from experts_published where expert_id=${coverage.expert.expertId}::uuid) publications,
    (select count(*)::int from early_bird_payment_full_refunds where intent_id=${coverage.intentId}::uuid) refunds
  `)
  ).rows[0];
}
it("rejects projection deactivation without a verified full refund", async () => {
  const fixture = coverage.db,
    expert = coverage.expert,
    intent = coverage.intentId;
  expect(await state()).toEqual({
    paid: true,
    active: true,
    approvedCards: 0,
    admissions: 0,
    publications: 0,
    refunds: 0,
  });
  let rejection: unknown;
  try {
    await fixture.db.execute(
      sql`select early_bird_deactivate_refunded_projection(${expert.userId}::uuid,${intent}::uuid)`,
    );
  } catch (error) {
    rejection = (error as { cause?: { message?: string } }).cause?.message;
  }
  expect(rejection).toContain("early_bird_projection_refund_required");
  expect(await state()).toEqual({
    paid: true,
    active: true,
    approvedCards: 0,
    admissions: 0,
    publications: 0,
    refunds: 0,
  });
}, 120_000);
