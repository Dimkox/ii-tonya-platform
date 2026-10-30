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
it("rejects forged immutable admission without a qualified reviewed card", async () => {
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
  expect(
    (
      await fixture.db.execute(
        sql`select to_regclass('public.early_bird_admissions') as name`,
      )
    ).rows[0]?.name,
  ).toBe("early_bird_admissions");
  await expect(
    fixture.db.execute(
      sql`insert into early_bird_admissions(intent_id,user_id,expert_id,draft_id,review_id,revision,public_digest) values(${intent}::uuid,${expert.userId}::uuid,${expert.expertId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,1,${`sha256:${"c".repeat(64)}`})`,
    ),
  ).rejects.toThrow();
  expect(await state()).toEqual({
    paid: true,
    active: true,
    approvedCards: 0,
    admissions: 0,
    publications: 0,
    refunds: 0,
  });
}, 120_000);
