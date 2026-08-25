import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { ExpertResidencyPaymentEvent } from "../../packages/contracts/src/index.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
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
      const reservedOrderId = randomUUID();
      const reservationId = randomUUID();
      await tx.execute(sql`insert into expert_residency_orders (
        id, expert_id, tariff_version_id, tariff_name, tariff_description,
        price_minor, currency, duration_seconds, credit_minor, cash_minor,
        payment_deadline, provider_deadline, idempotency_key, status, quoted_at
      ) values (${reservedOrderId}::uuid, ${inviter.expertId}::uuid,
        ${tariffId}::uuid, 'Reserved', 'Reserved fixture', 100000, 'RUB',
        63072000, ${input.activeReservationMinor!},
        ${100000n - input.activeReservationMinor!},
        transaction_timestamp() + interval '1 day',
        transaction_timestamp() + interval '1 day',
        ${`reserved-${reservedOrderId}`}, 'quoted', transaction_timestamp())`);
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
    }
  });
  return {
    inviterId: inviter.expertId,
    inviteeId: invitee.expertId,
    orderId,
    paymentId,
    grantId,
    rewardEntryId,
  };
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
