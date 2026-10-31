import { randomUUID } from "node:crypto";
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
it("rejects a forged wave publication without an admission", async () => {
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
      sql`insert into experts_published(expert_id,user_id,application_audit_id,draft_id,review_id,revision,public_payload,public_digest,paid_order_id,wave_intent_id,next_billing_date,active) values(${expert.expertId}::uuid,${expert.userId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,1,'{}'::jsonb,${`sha256:${"c".repeat(64)}`},null,${intent}::uuid,clock_timestamp()+interval '1 day',true)`,
    );
  } catch (error) {
    rejection = (error as { cause?: { message?: string } }).cause?.message;
  }
  expect(rejection).toContain("expert_published_wave_source");
  expect(await state()).toEqual({
    paid: true,
    active: true,
    approvedCards: 0,
    admissions: 0,
    publications: 0,
    refunds: 0,
  });
}, 120_000);
