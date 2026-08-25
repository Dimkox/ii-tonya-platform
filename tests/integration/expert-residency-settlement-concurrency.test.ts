import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ExpertCodeCrypto,
  type ExpertCodeKeyring,
} from "../../packages/application/src/expert-code-crypto.js";
import type { ExpertResidencyPaymentEvent } from "../../packages/contracts/src/index.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { ExpertReferralTestkit } from "../../packages/db/src/testkit/expert-referral.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/testing.testkit.js";

const keyring: ExpertCodeKeyring = {
  currentVersion: "v1",
  versions: ["v1"],
  key: () => new Uint8Array(32).fill(8),
};
let testDb: TestDatabase;
let fixtures: ExpertReferralTestkit;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForFeatureControlWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = (
      await testDb.db.execute<{ waiting: boolean }>(sql`select exists (
        select 1 from pg_stat_activity
        where wait_event_type = 'Lock'
          and query like '%expert_referral_feature_controls%'
      ) as waiting`)
    ).rows[0]?.waiting;
    if (waiting) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("settlement_did_not_wait_for_feature_control");
}

describe("expert residency settlement concurrency", () => {
  it("serializes renewals and creates exactly one first marker and reward", async () => {
    await fixtures.enableFeatureControl();
    const inviter = await fixtures.createExpert();
    const invitee = await fixtures.createExpert();
    const referralRepo = new PostgresExpertReferralRepository(
      testDb.db,
      new ExpertCodeCrypto(keyring),
    );
    const issueEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 1, overrideId: null },
    );
    const batch = await referralRepo.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 1,
      ...issueEvidence,
    });
    await referralRepo.redeemCode({
      plaintext: batch.codes[0]!.plaintext,
      inviteeExpertId: invitee.expertId,
      provider: invitee.provider,
      externalId: invitee.externalId,
    });

    const residencyRepo = new PostgresExpertResidencyRepository(testDb.db);
    const now = new Date(
      (
        await testDb.db.execute<{ now: Date | string }>(
          sql`select transaction_timestamp() as now`,
        )
      ).rows[0]!.now,
    );
    const events: ExpertResidencyPaymentEvent[] = [];
    for (const index of [1, 2]) {
      const tariffVersionId = randomUUID();
      const tariffKey = `concurrent-${tariffVersionId}`;
      const evidence = await fixtures.createAdminEvidence(
        "expert_residency.tariff_create",
        tariffVersionId,
        {
          tariffKey,
          version: 1,
          displayName: `Concurrent ${index}`,
          description: "Concurrent settlement",
          priceMinor: "100000",
          durationSeconds: 86_400,
          activeFrom: new Date(now.getTime() - 86_400_000).toISOString(),
          activeTo: null,
        },
      );
      await residencyRepo.createTariffVersion({
        tariffVersionId,
        tariffKey,
        version: 1,
        displayName: `Concurrent ${index}`,
        description: "Concurrent settlement",
        priceMinor: 100000n,
        durationSeconds: 86_400,
        activeFrom: new Date(now.getTime() - 86_400_000),
        activeTo: null,
        ...evidence,
      });
      const order = await residencyRepo.createCheckoutOrder({
        expertId: invitee.expertId,
        tariffKey,
        providerDeadline: new Date(now.getTime() + 86_400_000),
        idempotencyKey: `concurrent-checkout-${index}-${tariffVersionId}`,
      });
      const attemptId = randomUUID();
      const paymentId = `pay_${randomUUID()}`;
      await testDb.db.transaction(async (tx) => {
        await tx.execute(sql`insert into expert_residency_payment_attempts (
          id, order_id, provider, provider_request_id, expected_amount_minor,
          currency, status, idempotency_key
        ) values (${attemptId}::uuid, ${order.orderId}::uuid, 'sandbox', ${paymentId},
          100000, 'RUB', 'pending', ${`attempt-${attemptId}`})`);
        await tx.execute(sql`update expert_residency_orders set payment_provider = 'sandbox',
          provider_payment_id = ${paymentId}, status = 'payment_pending',
          payment_started_at = transaction_timestamp() where id = ${order.orderId}::uuid`);
      });
      events.push({
        kind: "settled",
        provider: "sandbox",
        eventId: `evt_${randomUUID()}`,
        paymentId,
        orderId: order.orderId,
        amountMinor: "100000",
        currency: "RUB",
        occurredAt: `2026-08-03T00:00:0${index}.000Z`,
        payloadDigest: `sha256:${String(index).repeat(64)}`,
      });
    }

    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    const verifiedEvents = events.map((event) =>
      verifiedEventFixture(event, {
        verificationId: `verify_${event.eventId}`,
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:03.000Z",
        payloadDigest: event.payloadDigest,
      }),
    );
    const controlLocked = deferred();
    const releaseControl = deferred();
    const blocker = testDb.db.transaction(async (tx) => {
      await tx.execute(sql`select feature_key
        from expert_referral_feature_controls
        where feature_key = 'expert_referrals' for update`);
      controlLocked.resolve();
      await releaseControl.promise;
    });
    await controlLocked.promise;
    const firstSettlement = repo.settle(verifiedEvents[0]!);
    try {
      await waitForFeatureControlWaiter();
      const probe = await testDb.db.transaction(
        async (tx) =>
          (
            await tx.execute<{
              acquired: boolean;
            }>(sql`select pg_try_advisory_xact_lock(
            hashtextextended(${`expert-referral:${invitee.expertId}`}, 0)
          ) as acquired`)
          ).rows[0]?.acquired,
      );
      expect(probe).toBe(true);
    } finally {
      releaseControl.resolve();
      await blocker;
    }
    const results = await Promise.all([
      firstSettlement,
      repo.settle(verifiedEvents[1]!),
    ]);

    expect(results.map((result) => result.kind)).toEqual([
      "settled",
      "settled",
    ]);
    const facts = (
      await testDb.db.execute<{
        markers: number;
        rewards: number;
        inbox: number;
        settledOrders: number;
      }>(sql`select
        (select count(*)::integer from expert_first_residency_settlements
          where expert_id = ${invitee.expertId}::uuid) as markers,
        (select count(*)::integer from expert_referral_reward_grants
          where inviter_expert_id = ${inviter.expertId}::uuid) as rewards,
        (select count(*)::integer from expert_residency_provider_event_inbox
          where processing_status = 'processed') as inbox,
        (select count(*)::integer from expert_residency_orders
          where expert_id = ${invitee.expertId}::uuid and status = 'settled') as "settledOrders"
      `)
    ).rows[0]!;
    expect(facts).toEqual({
      markers: 1,
      rewards: 1,
      inbox: 2,
      settledOrders: 2,
    });
    const intervals = (
      await testDb.db.execute<{
        startsAt: Date | string;
        endsAt: Date | string;
      }>(sql`
        select residency_starts_at as "startsAt", residency_ends_at as "endsAt"
        from expert_residency_orders where expert_id = ${invitee.expertId}::uuid
          and status = 'settled' order by residency_starts_at
      `)
    ).rows;
    expect(intervals).toHaveLength(2);
    const firstEndsAt = new Date(intervals[0]!.endsAt).getTime();
    const secondStartsAt = new Date(intervals[1]!.startsAt).getTime();
    expect(secondStartsAt).toBe(firstEndsAt);
    expect(firstEndsAt).toBeLessThanOrEqual(secondStartsAt);
  });
});
