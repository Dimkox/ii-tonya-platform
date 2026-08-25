import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { ExpertResidencyPaymentEvent } from "../../packages/contracts/src/index.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { ExpertReferralTestkit } from "../../packages/db/src/testkit/expert-referral.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/testing.testkit.js";

let testDb: TestDatabase;
let fixtures: ExpertReferralTestkit;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

interface RewardScenario {
  readonly inviterId: string;
  readonly inviteeId: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly grantId: string;
  readonly rewardEntryId: string;
  readonly reservedOrderId?: string;
  readonly reservedSettlement?: ReturnType<typeof verifiedEventFixture>;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForOrderLockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const waiting = Number(
      (
        await testDb.db.execute<{ waiting: number | string }>(sql`select
          count(*)::integer as waiting from pg_stat_activity
          where wait_event_type = 'Lock'
            and query like '%expert_residency_orders%'`)
      ).rows[0]?.waiting ?? 0,
    );
    if (waiting >= count) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`expected_${count}_order_lock_waiters`);
}

async function seedRewardScenario(
  input: {
    readonly spentMinor?: bigint;
    readonly activeReservationMinor?: bigint;
    readonly expiredMinor?: bigint;
    readonly expiredGrant?: boolean;
  } = {},
): Promise<RewardScenario> {
  await fixtures.enableFeatureControl();
  const inviter = await fixtures.createExpert();
  const invitee = await fixtures.createExpert();
  const tariffId = randomUUID();
  const orderId = randomUUID();
  const paymentAttemptId = randomUUID();
  const paymentId = `pay_${randomUUID()}`;
  const batchId = randomUUID();
  const codeId = randomUUID();
  const referralId = randomUUID();
  const markerId = randomUUID();
  const grantId = randomUUID();
  const rewardEntryId = randomUUID();
  const approval = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create",
    tariffId,
    { priceMinor: "100000", durationSeconds: 63_072_000 },
  );
  const expiredMinor = input.expiredMinor ?? 0n;
  let reservedOrderId: string | undefined;
  let reservedSettlement: ReturnType<typeof verifiedEventFixture> | undefined;
  const settledAgo =
    expiredMinor > 0n || input.expiredGrant === true ? "400 days" : "1 day";

  await testDb.db.transaction(async (tx) => {
    await tx.execute(sql`insert into expert_referral_code_batches (
      id, inviter_expert_id, requested_count, issued_by_admin_id, approval_id,
      admin_session_id_hash
    ) values (${batchId}::uuid, ${inviter.expertId}::uuid, 1,
      ${approval.adminId}::uuid, ${approval.approvalId}::uuid,
      ${approval.sessionIdHash})`);
    await tx.execute(sql`insert into expert_referral_codes (
      id, batch_id, inviter_expert_id, code_hash, masked_suffix,
      hmac_key_version, status, redeemed_at
    ) values (${codeId}::uuid, ${batchId}::uuid, ${inviter.expertId}::uuid,
      ${`seed-${codeId}`}, '…seed', 1, 'redeemed', transaction_timestamp())`);
    await tx.execute(sql`insert into expert_referrals (
      id, code_id, inviter_expert_id, invitee_expert_id
    ) values (${referralId}::uuid, ${codeId}::uuid, ${inviter.expertId}::uuid,
      ${invitee.expertId}::uuid)`);
    await tx.execute(sql`insert into expert_residency_tariff_versions (
      id, tariff_key, version, display_name, description, price_minor,
      currency, duration_seconds, active_from, created_by_admin_id, approval_id,
      admin_session_id_hash
    ) values (${tariffId}::uuid, ${`refund-${tariffId}`}, 1, 'Refund',
      'Refund fixture', 100000, 'RUB', 63072000,
      transaction_timestamp() - interval '500 days', ${approval.adminId}::uuid,
      ${approval.approvalId}::uuid, ${approval.sessionIdHash})`);
    await tx.execute(sql`insert into expert_residency_orders (
      id, expert_id, tariff_version_id, tariff_name, tariff_description,
      price_minor, currency, duration_seconds, credit_minor, cash_minor,
      payment_deadline, provider_deadline, idempotency_key, payment_provider,
      provider_payment_id, status, quoted_at, payment_started_at, settled_at,
      residency_starts_at, residency_ends_at
    ) values (${orderId}::uuid, ${invitee.expertId}::uuid, ${tariffId}::uuid,
      'Refund', 'Refund fixture', 100000, 'RUB', 63072000, 0, 100000,
      transaction_timestamp() + interval '1 day',
      transaction_timestamp() + interval '1 day', ${`order-${orderId}`},
      'sandbox', ${paymentId}, 'settled',
      transaction_timestamp() - interval ${sql.raw(`'${settledAgo}'`)},
      transaction_timestamp() - interval ${sql.raw(`'${settledAgo}'`)},
      transaction_timestamp() - interval ${sql.raw(`'${settledAgo}'`)},
      transaction_timestamp() - interval ${sql.raw(`'${settledAgo}'`)},
      transaction_timestamp() - interval ${sql.raw(`'${settledAgo}'`)} + interval '730 days')`);
    await tx.execute(sql`insert into expert_residency_payment_attempts (
      id, order_id, provider, provider_request_id, expected_amount_minor,
      currency, status, idempotency_key
    ) values (${paymentAttemptId}::uuid, ${orderId}::uuid, 'sandbox',
      ${paymentId}, 100000, 'RUB', 'succeeded', ${`attempt-${paymentAttemptId}`})`);
    await tx.execute(sql`insert into expert_first_residency_settlements (
      id, expert_id, qualifying_order_id, eligibility_status,
      eligibility_reason_code, expert_active, expert_verified, unique_identity,
      abuse_cleared, settled_at
    ) values (${markerId}::uuid, ${invitee.expertId}::uuid, ${orderId}::uuid,
      'eligible', 'eligible', true, true, true, true,
      transaction_timestamp() - interval ${sql.raw(`'${settledAgo}'`)})`);
    await tx.execute(sql`insert into expert_referral_reward_grants (
      id, inviter_expert_id, referral_id, qualifying_order_id,
      first_settlement_id, amount_minor, granted_at, expires_at
    ) values (${grantId}::uuid, ${inviter.expertId}::uuid, ${referralId}::uuid,
      ${orderId}::uuid, ${markerId}::uuid, 100000,
      transaction_timestamp() - interval ${sql.raw(`'${settledAgo}'`)},
      transaction_timestamp() - interval ${sql.raw(`'${settledAgo}'`)} + interval '365 days')`);
    await tx.execute(sql`insert into expert_referral_ledger_entries (
      id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
      reward_grant_id, idempotency_key
    ) values (${rewardEntryId}::uuid, ${inviter.expertId}::uuid, 'reward_grant',
      100000, 'reward_grant', ${grantId}::uuid, ${grantId}::uuid,
      ${`reward-${grantId}`})`);
    await tx.execute(sql`insert into expert_referral_ledger_allocations (
      ledger_entry_id, reward_grant_id, amount_minor
    ) values (${rewardEntryId}::uuid, ${grantId}::uuid, 100000)`);

    if ((input.spentMinor ?? 0n) > 0n) {
      const reservationId = randomUUID();
      const spendId = randomUUID();
      const spentOrderId = randomUUID();
      await tx.execute(sql`insert into expert_referral_ledger_entries (
        id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
        original_entry_id, idempotency_key
      ) values
        (${reservationId}::uuid, ${inviter.expertId}::uuid, 'reservation',
          ${-input.spentMinor!}, 'residency_order', ${spentOrderId}::uuid, null,
          ${`spent-reservation-${spentOrderId}`}),
        (${spendId}::uuid, ${inviter.expertId}::uuid, 'spend',
          ${-input.spentMinor!}, 'residency_order', ${spentOrderId}::uuid,
          ${reservationId}::uuid, ${`spent-${spentOrderId}`})`);
      await tx.execute(sql`insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values (${reservationId}::uuid, ${grantId}::uuid, ${input.spentMinor!}),
        (${spendId}::uuid, ${grantId}::uuid, ${input.spentMinor!})`);
    }
    if (expiredMinor > 0n) {
      const expiryId = randomUUID();
      await tx.execute(sql`insert into expert_referral_ledger_entries (
        id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
        original_entry_id, idempotency_key
      ) values (${expiryId}::uuid, ${inviter.expertId}::uuid, 'expiry',
        ${-expiredMinor}, 'reward_grant', ${grantId}::uuid,
        ${rewardEntryId}::uuid, ${`expiry-${grantId}`})`);
      await tx.execute(sql`insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values (${expiryId}::uuid, ${grantId}::uuid, ${expiredMinor})`);
    }
    if ((input.activeReservationMinor ?? 0n) > 0n) {
      reservedOrderId = randomUUID();
      const reservationId = randomUUID();
      const reservedAttemptId = randomUUID();
      const reservedPaymentId = `pay_${randomUUID()}`;
      const reservedCashMinor = 100_000n - input.activeReservationMinor!;
      await tx.execute(sql`insert into expert_residency_orders (
        id, expert_id, tariff_version_id, tariff_name, tariff_description,
        price_minor, currency, duration_seconds, credit_minor, cash_minor,
        payment_deadline, provider_deadline, idempotency_key, payment_provider,
        provider_payment_id, status, quoted_at, payment_started_at
      ) values (${reservedOrderId}::uuid, ${inviter.expertId}::uuid,
        ${tariffId}::uuid, 'Reserved', 'Reserved fixture', 100000, 'RUB',
        63072000, ${input.activeReservationMinor!},
        ${reservedCashMinor},
        transaction_timestamp() + interval '1 day',
        transaction_timestamp() + interval '1 day',
        ${`reserved-${reservedOrderId}`}, 'sandbox', ${reservedPaymentId},
        'payment_pending', transaction_timestamp(), transaction_timestamp())`);
      await tx.execute(sql`insert into expert_residency_payment_attempts (
        id, order_id, provider, provider_request_id, expected_amount_minor,
        currency, status, idempotency_key
      ) values (${reservedAttemptId}::uuid, ${reservedOrderId}::uuid, 'sandbox',
        ${reservedPaymentId}, ${reservedCashMinor}, 'RUB', 'pending',
        ${`reserved-attempt-${reservedAttemptId}`})`);
      await tx.execute(sql`insert into expert_referral_ledger_entries (
        id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
        idempotency_key
      ) values (${reservationId}::uuid, ${inviter.expertId}::uuid,
        'reservation', ${-input.activeReservationMinor!}, 'residency_order',
        ${reservedOrderId}::uuid, ${`active-reservation-${reservedOrderId}`})`);
      await tx.execute(sql`insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values (${reservationId}::uuid, ${grantId}::uuid,
        ${input.activeReservationMinor!})`);
      const settlementEvent: ExpertResidencyPaymentEvent = {
        kind: "settled",
        provider: "sandbox",
        eventId: `evt_reserved_${randomUUID()}`,
        paymentId: reservedPaymentId,
        orderId: reservedOrderId,
        amountMinor: reservedCashMinor.toString(),
        currency: "RUB",
        occurredAt: "2026-08-03T00:00:04.000Z",
        payloadDigest: `sha256:${"f".repeat(64)}`,
      };
      reservedSettlement = verifiedEventFixture(settlementEvent, {
        verificationId: `verify_${settlementEvent.eventId}`,
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:05.000Z",
        payloadDigest: settlementEvent.payloadDigest,
      });
    }
  });
  return {
    inviterId: inviter.expertId,
    inviteeId: invitee.expertId,
    orderId,
    paymentId,
    grantId,
    rewardEntryId,
    ...(reservedOrderId === undefined
      ? {}
      : { reservedOrderId, reservedSettlement: reservedSettlement! }),
  };
}

async function futureRewardSettlement(inviterExpertId: string) {
  const invitee = await fixtures.createExpert();
  const tariffId = randomUUID();
  const orderId = randomUUID();
  const paymentAttemptId = randomUUID();
  const paymentId = `pay_${randomUUID()}`;
  const batchId = randomUUID();
  const codeId = randomUUID();
  const referralId = randomUUID();
  const approval = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create",
    tariffId,
    { priceMinor: "100000", durationSeconds: 63_072_000 },
  );
  await testDb.db.transaction(async (tx) => {
    await tx.execute(sql`insert into expert_referral_code_batches (
      id, inviter_expert_id, requested_count, issued_by_admin_id, approval_id,
      admin_session_id_hash
    ) values (${batchId}::uuid, ${inviterExpertId}::uuid, 1,
      ${approval.adminId}::uuid, ${approval.approvalId}::uuid,
      ${approval.sessionIdHash})`);
    await tx.execute(sql`insert into expert_referral_codes (
      id, batch_id, inviter_expert_id, code_hash, masked_suffix,
      hmac_key_version, status, redeemed_at
    ) values (${codeId}::uuid, ${batchId}::uuid, ${inviterExpertId}::uuid,
      ${`future-${codeId}`}, '…next', 1, 'redeemed', transaction_timestamp())`);
    await tx.execute(sql`insert into expert_referrals (
      id, code_id, inviter_expert_id, invitee_expert_id
    ) values (${referralId}::uuid, ${codeId}::uuid, ${inviterExpertId}::uuid,
      ${invitee.expertId}::uuid)`);
    await tx.execute(sql`insert into expert_residency_tariff_versions (
      id, tariff_key, version, display_name, description, price_minor,
      currency, duration_seconds, active_from, created_by_admin_id, approval_id,
      admin_session_id_hash
    ) values (${tariffId}::uuid, ${`future-${tariffId}`}, 1, 'Future reward',
      'Debt repayment fixture', 100000, 'RUB', 63072000,
      transaction_timestamp() - interval '1 day', ${approval.adminId}::uuid,
      ${approval.approvalId}::uuid, ${approval.sessionIdHash})`);
    await tx.execute(sql`insert into expert_residency_orders (
      id, expert_id, tariff_version_id, tariff_name, tariff_description,
      price_minor, currency, duration_seconds, credit_minor, cash_minor,
      payment_deadline, provider_deadline, idempotency_key, payment_provider,
      provider_payment_id, status, quoted_at, payment_started_at
    ) values (${orderId}::uuid, ${invitee.expertId}::uuid, ${tariffId}::uuid,
      'Future reward', 'Debt repayment fixture', 100000, 'RUB', 63072000,
      0, 100000, transaction_timestamp() + interval '1 day',
      transaction_timestamp() + interval '1 day', ${`future-order-${orderId}`},
      'sandbox', ${paymentId}, 'payment_pending', transaction_timestamp(),
      transaction_timestamp())`);
    await tx.execute(sql`insert into expert_residency_payment_attempts (
      id, order_id, provider, provider_request_id, expected_amount_minor,
      currency, status, idempotency_key
    ) values (${paymentAttemptId}::uuid, ${orderId}::uuid, 'sandbox',
      ${paymentId}, 100000, 'RUB', 'pending',
      ${`future-attempt-${paymentAttemptId}`})`);
  });
  const event: ExpertResidencyPaymentEvent = {
    kind: "settled",
    provider: "sandbox",
    eventId: `evt_future_${randomUUID()}`,
    paymentId,
    orderId,
    amountMinor: "100000",
    currency: "RUB",
    occurredAt: "2026-08-03T00:00:06.000Z",
    payloadDigest: `sha256:${"a".repeat(64)}`,
  };
  return verifiedEventFixture(event, {
    verificationId: `verify_${event.eventId}`,
    verifierKeyVersion: "sandbox-v1",
    verifiedAt: "2026-08-03T00:00:07.000Z",
    payloadDigest: event.payloadDigest,
  });
}

function verifiedRefund(
  scenario: RewardScenario,
  input: {
    readonly eventId?: string;
    readonly kind?: "refunded" | "charged_back";
    readonly amountMinor: string;
    readonly terminatesResidency: boolean;
  },
) {
  const event: ExpertResidencyPaymentEvent = {
    kind: input.kind ?? "refunded",
    provider: "sandbox",
    eventId: input.eventId ?? `evt_${randomUUID()}`,
    paymentId: scenario.paymentId,
    orderId: scenario.orderId,
    amountMinor: input.amountMinor,
    currency: "RUB",
    occurredAt: "2026-08-03T00:00:00.000Z",
    payloadDigest: `sha256:${"b".repeat(64)}`,
    terminatesResidency: input.terminatesResidency,
  };
  return verifiedEventFixture(event, {
    verificationId: `verify_${event.eventId}`,
    verifierKeyVersion: "sandbox-v1",
    verifiedAt: "2026-08-03T00:00:01.000Z",
    payloadDigest: event.payloadDigest,
  });
}

describe("expert residency refund and reward reversal", () => {
  it("bounds cumulative cash refunds and leaves an active partial refund unreversed", async () => {
    const scenario = await seedRewardScenario();
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    const event = verifiedRefund(scenario, {
      amountMinor: "10000",
      terminatesResidency: false,
    });

    const first = await repo.refund(event);
    await expect(repo.refund(event)).resolves.toEqual(first);
    expect(first).toMatchObject({
      kind: "refunded",
      cashRefundedMinor: "10000",
      cumulativeCashRefundedMinor: "10000",
      restoredCreditMinor: "0",
      residencyTerminated: false,
      rewardReversed: false,
    });
    await expect(
      repo.refund(
        verifiedRefund(scenario, {
          amountMinor: "90001",
          terminatesResidency: false,
        }),
      ),
    ).rejects.toMatchObject({ code: "refund_cash_exceeded" });
    const state = (
      await testDb.db.execute<{ status: string; reversals: number }>(sql`select
        (select status::text from expert_residency_orders
          where id = ${scenario.orderId}::uuid) as status,
        (select count(*)::integer from expert_referral_ledger_entries
          where entry_kind = 'reversal' and source_id = ${scenario.grantId}::uuid)
          as reversals`)
    ).rows[0];
    expect(state).toEqual({ status: "settled", reversals: 0 });
  });

  it("derives one terminating reversal from spend and active reservations without restoring credit", async () => {
    const scenario = await seedRewardScenario({
      spentMinor: 60_000n,
      activeReservationMinor: 20_000n,
    });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    const event = verifiedRefund(scenario, {
      amountMinor: "100000",
      terminatesResidency: true,
    });

    const first = await repo.refund(event);
    await expect(repo.refund(event)).resolves.toEqual(first);
    expect(first).toMatchObject({
      kind: "refunded",
      restoredCreditMinor: "0",
      residencyTerminated: true,
      rewardReversed: true,
      removedCreditMinor: "20000",
      cancelledReservationMinor: "20000",
      debtMinor: "60000",
    });
    const facts = (
      await testDb.db.execute<{
        status: string;
        reversals: number;
        releases: number;
        debtMinor: string;
        spendableMinor: string;
      }>(sql`select
        (select status::text from expert_residency_orders
          where id = ${scenario.orderId}::uuid) as status,
        (select count(*)::integer from expert_referral_ledger_entries
          where entry_kind = 'reversal' and source_id = ${scenario.grantId}::uuid)
          as reversals,
        (select count(*)::integer from expert_referral_ledger_entries release
          join expert_referral_ledger_allocations allocation
            on allocation.ledger_entry_id = release.id
          where release.entry_kind = 'release'
            and allocation.reward_grant_id = ${scenario.grantId}::uuid) as releases,
        (select debt_minor::text from expert_referral_balances
          where expert_id = ${scenario.inviterId}::uuid) as "debtMinor",
        (select spendable_balance_minor::text from expert_referral_balances
          where expert_id = ${scenario.inviterId}::uuid) as "spendableMinor"`)
    ).rows[0];
    expect(facts).toEqual({
      status: "refunded",
      reversals: 1,
      releases: 1,
      debtMinor: "60000",
      spendableMinor: "0",
    });
  });

  it("locks an affected reservation order before ledger rows when reversal races settlement", async () => {
    const scenario = await seedRewardScenario({
      activeReservationMinor: 20_000n,
    });
    expect(scenario.reservedOrderId).toBeDefined();
    expect(scenario.reservedSettlement).toBeDefined();
    const providerRepo = new PostgresExpertResidencyProviderInboxRepository(
      testDb.db,
    );
    const residencyRepo = new PostgresExpertResidencyRepository(testDb.db);
    const orderLocked = deferred();
    const releaseOrder = deferred();
    const blocker = testDb.db.transaction(async (tx) => {
      await tx.execute(sql`select id from expert_residency_orders
          where id = ${scenario.reservedOrderId!}::uuid for update`);
      orderLocked.resolve();
      await releaseOrder.promise;
    });
    await orderLocked.promise;
    const settlement = providerRepo.settle(scenario.reservedSettlement!);
    await waitForOrderLockWaiters(1);
    const reversal = testDb.db.transaction((tx) =>
      residencyRepo.reverseRewardGrant(tx, {
        grantId: scenario.grantId,
        inviterExpertId: scenario.inviterId,
        reversedAt: new Date(),
      }),
    );
    try {
      await waitForOrderLockWaiters(2);
    } finally {
      releaseOrder.resolve();
      await blocker;
    }

    await expect(settlement).resolves.toMatchObject({ kind: "settled" });
    await expect(reversal).resolves.toMatchObject({
      rewardReversed: true,
      removedCreditMinor: 80_000n,
      cancelledReservationMinor: 0n,
      debtMinor: 20_000n,
    });
    const replay = await testDb.db.transaction((tx) =>
      residencyRepo.reverseRewardGrant(tx, {
        grantId: scenario.grantId,
        inviterExpertId: scenario.inviterId,
        reversedAt: new Date(),
      }),
    );
    expect(replay).toEqual({
      rewardReversed: false,
      removedCreditMinor: 0n,
      cancelledReservationMinor: 0n,
      debtMinor: 0n,
    });
    const facts = (
      await testDb.db.execute<{
        reservedStatus: string;
        reversals: number;
        releases: number;
        spends: number;
        debtMinor: string;
      }>(sql`select
          (select status::text from expert_residency_orders
            where id = ${scenario.reservedOrderId!}::uuid) as "reservedStatus",
          (select count(*)::integer from expert_referral_ledger_entries
            where entry_kind = 'reversal'
              and source_id = ${scenario.grantId}::uuid) as reversals,
          (select count(*)::integer from expert_referral_ledger_entries
            where entry_kind = 'release'
              and source_id = ${scenario.reservedOrderId!}::uuid) as releases,
          (select count(*)::integer from expert_referral_ledger_entries
            where entry_kind = 'spend'
              and source_id = ${scenario.reservedOrderId!}::uuid) as spends,
          (select debt_minor::text from expert_referral_balances
            where expert_id = ${scenario.inviterId}::uuid) as "debtMinor"`)
    ).rows[0];
    expect(facts).toEqual({
      reservedStatus: "settled",
      reversals: 1,
      releases: 0,
      spends: 1,
      debtMinor: "20000",
    });
  }, 30_000);

  it("repays debt from a real reversal before a future reward becomes spendable", async () => {
    const scenario = await seedRewardScenario({ spentMinor: 60_000n });
    const providerRepo = new PostgresExpertResidencyProviderInboxRepository(
      testDb.db,
    );

    await expect(
      providerRepo.refund(
        verifiedRefund(scenario, {
          amountMinor: "100000",
          terminatesResidency: true,
        }),
      ),
    ).resolves.toMatchObject({ debtMinor: "60000" });
    await expect(
      providerRepo.settle(await futureRewardSettlement(scenario.inviterId)),
    ).resolves.toMatchObject({
      kind: "settled",
      rewardEffect: { kind: "debt_repaid", amountMinor: "60000" },
    });
    const balance = (
      await testDb.db.execute<{
        debtMinor: string;
        spendableMinor: string;
        repayments: number;
      }>(sql`select debt_minor::text as "debtMinor",
        spendable_balance_minor::text as "spendableMinor",
        (select count(*)::integer from expert_referral_ledger_entries
          where account_expert_id = ${scenario.inviterId}::uuid
            and entry_kind = 'debt_repayment') as repayments
        from expert_referral_balances
        where expert_id = ${scenario.inviterId}::uuid`)
    ).rows[0];
    expect(balance).toEqual({
      debtMinor: "0",
      spendableMinor: "40000",
      repayments: 1,
    });
  });

  it("durably fails a refund outbox conflict without partial financial effects", async () => {
    const scenario = await seedRewardScenario();
    const eventId = `evt_${randomUUID()}`;
    await testDb.db.execute(sql`insert into integration_outbox (
      idempotency_key, topic, payload, correlation_id, reconciliation_key,
      payload_hash
    ) values (${`expert-residency-refunded:sandbox:${eventId}`},
      'expert_residency.refunded', '{"conflict":true}'::jsonb, 'wrong',
      ${`expert-residency:${scenario.orderId}`}, ${`sha256:${"e".repeat(64)}`})`);
    const event = verifiedRefund(scenario, {
      eventId,
      amountMinor: "100000",
      terminatesResidency: true,
    });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);

    await expect(repo.refund(event)).rejects.toMatchObject({
      code: "outbox_replay_conflict",
    });
    await expect(repo.refund(event)).rejects.toMatchObject({
      code: "outbox_replay_conflict",
    });
    const state = (
      await testDb.db.execute<{
        orderStatus: string;
        inboxStatus: string;
        inboxCode: string;
        reversals: number;
      }>(sql`select
        (select status::text from expert_residency_orders
          where id = ${scenario.orderId}::uuid) as "orderStatus",
        (select processing_status::text from expert_residency_provider_event_inbox
          where external_event_id = ${eventId}) as "inboxStatus",
        (select processing_result_code from expert_residency_provider_event_inbox
          where external_event_id = ${eventId}) as "inboxCode",
        (select count(*)::integer from expert_referral_ledger_entries
          where entry_kind = 'reversal' and source_id = ${scenario.grantId}::uuid)
          as reversals`)
    ).rows[0];
    expect(state).toEqual({
      orderStatus: "settled",
      inboxStatus: "failed",
      inboxCode: "outbox_replay_conflict",
      reversals: 0,
    });
  });

  it("leaves expired allocation expired and reverses only the historically spent remainder", async () => {
    const scenario = await seedRewardScenario({
      spentMinor: 40_000n,
      expiredGrant: true,
    });
    const result = await new PostgresExpertResidencyProviderInboxRepository(
      testDb.db,
    ).refund(
      verifiedRefund(scenario, {
        kind: "charged_back",
        amountMinor: "100000",
        terminatesResidency: true,
      }),
    );

    expect(result).toMatchObject({
      kind: "charged_back",
      rewardReversed: true,
      removedCreditMinor: "0",
      debtMinor: "40000",
    });
    const compensation = (
      await testDb.db.execute<{ kind: string; amountMinor: string }>(sql`select
        entry_kind::text as kind, amount_minor::text as "amountMinor"
        from expert_referral_ledger_entries
        where source_id = ${scenario.grantId}::uuid
          and entry_kind in ('expiry', 'reversal')
        order by entry_kind`)
    ).rows;
    expect(compensation).toEqual([
      { kind: "expiry", amountMinor: "-60000" },
      { kind: "reversal", amountMinor: "-40000" },
    ]);
  });
});
