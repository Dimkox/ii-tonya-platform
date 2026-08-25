import { createHash, randomUUID } from "node:crypto";
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function payloadHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

interface HeldScenario {
  readonly inviterId: string;
  readonly inviteeId: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly cashMinor: string;
  readonly creditGrantId: string;
  readonly settlement: ReturnType<typeof verifiedEventFixture>;
}

async function scenario(
  input: {
    readonly rewardEnabled?: boolean;
    readonly abuseHold?: boolean;
    readonly creditMinor?: bigint;
  } = {},
): Promise<HeldScenario> {
  await fixtures.enableFeatureControl();
  if (input.rewardEnabled === false) {
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = false, version = version + 1`);
  }
  const inviter = await fixtures.createExpert();
  const invitee = await fixtures.createExpert();
  const creditMinor = input.creditMinor ?? 0n;
  const cashMinor = 100_000n - creditMinor;
  const creditSourceInvitee =
    creditMinor > 0n ? await fixtures.createExpert() : undefined;
  const tariffId = randomUUID();
  const orderId = randomUUID();
  const attemptId = randomUUID();
  const paymentId = `pay_${randomUUID()}`;
  const batchId = randomUUID();
  const codeId = randomUUID();
  const referralId = randomUUID();
  const creditBatchId = randomUUID();
  const creditCodeId = randomUUID();
  const creditReferralId = randomUUID();
  const creditOrderId = randomUUID();
  const creditAttemptId = randomUUID();
  const creditMarkerId = randomUUID();
  const creditGrantId = randomUUID();
  const creditRewardEntryId = randomUUID();
  const creditPaymentId = `pay_${randomUUID()}`;
  const approval = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create",
    tariffId,
    { priceMinor: "100000", durationSeconds: 2_592_000 },
  );
  const creditApproval =
    creditSourceInvitee === undefined
      ? undefined
      : await fixtures.createAdminEvidence(
          "expert_referral.batch_generate",
          creditBatchId,
          { count: 1, overrideId: null },
        );
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
      ${`hold-${codeId}`}, '…hold', 1, 'redeemed', transaction_timestamp())`);
    await tx.execute(sql`insert into expert_referrals (
      id, code_id, inviter_expert_id, invitee_expert_id
    ) values (${referralId}::uuid, ${codeId}::uuid, ${inviter.expertId}::uuid,
      ${invitee.expertId}::uuid)`);
    await tx.execute(sql`insert into expert_residency_tariff_versions (
      id, tariff_key, version, display_name, description, price_minor,
      currency, duration_seconds, active_from, created_by_admin_id, approval_id,
      admin_session_id_hash
    ) values (${tariffId}::uuid, ${`hold-${tariffId}`}, 1, 'Hold',
      'Hold fixture', 100000, 'RUB', 2592000,
      transaction_timestamp() - interval '1 day', ${approval.adminId}::uuid,
      ${approval.approvalId}::uuid, ${approval.sessionIdHash})`);
    if (creditSourceInvitee !== undefined) {
      await tx.execute(sql`insert into expert_referral_code_batches (
        id, inviter_expert_id, requested_count, issued_by_admin_id, approval_id,
        admin_session_id_hash
      ) values (${creditBatchId}::uuid, ${invitee.expertId}::uuid, 1,
        ${creditApproval!.adminId}::uuid, ${creditApproval!.approvalId}::uuid,
        ${creditApproval!.sessionIdHash})`);
      await tx.execute(sql`insert into expert_referral_codes (
        id, batch_id, inviter_expert_id, code_hash, masked_suffix,
        hmac_key_version, status, redeemed_at
      ) values (${creditCodeId}::uuid, ${creditBatchId}::uuid,
        ${invitee.expertId}::uuid, ${`credit-${creditCodeId}`}, '…cred', 1,
        'redeemed', transaction_timestamp())`);
      await tx.execute(sql`insert into expert_referrals (
        id, code_id, inviter_expert_id, invitee_expert_id
      ) values (${creditReferralId}::uuid, ${creditCodeId}::uuid,
        ${invitee.expertId}::uuid, ${creditSourceInvitee.expertId}::uuid)`);
      await tx.execute(sql`insert into expert_residency_orders (
        id, expert_id, tariff_version_id, tariff_name, tariff_description,
        price_minor, currency, duration_seconds, credit_minor, cash_minor,
        payment_deadline, provider_deadline, idempotency_key, payment_provider,
        provider_payment_id, status, quoted_at, payment_started_at, settled_at,
        residency_starts_at, residency_ends_at
      ) values (${creditOrderId}::uuid, ${creditSourceInvitee.expertId}::uuid,
        ${tariffId}::uuid, 'Credit source', 'Credit source fixture', 100000,
        'RUB', 2592000, 0, 100000,
        transaction_timestamp() + interval '1 day',
        transaction_timestamp() + interval '1 day',
        ${`credit-source-${creditOrderId}`}, 'sandbox', ${creditPaymentId},
        'settled', transaction_timestamp() - interval '1 day',
        transaction_timestamp() - interval '1 day',
        transaction_timestamp() - interval '1 day',
        transaction_timestamp() - interval '1 day',
        transaction_timestamp() - interval '1 day' + interval '30 days')`);
      await tx.execute(sql`insert into expert_residency_payment_attempts (
        id, order_id, provider, provider_request_id, expected_amount_minor,
        currency, status, idempotency_key
      ) values (${creditAttemptId}::uuid, ${creditOrderId}::uuid, 'sandbox',
        ${creditPaymentId}, 100000, 'RUB', 'succeeded',
        ${`credit-attempt-${creditAttemptId}`})`);
      await tx.execute(sql`insert into expert_first_residency_settlements (
        id, expert_id, qualifying_order_id, eligibility_status,
        eligibility_reason_code, expert_active, expert_verified,
        unique_identity, abuse_cleared, settled_at
      ) values (${creditMarkerId}::uuid, ${creditSourceInvitee.expertId}::uuid,
        ${creditOrderId}::uuid, 'eligible', 'eligible', true, true, true, true,
        transaction_timestamp() - interval '1 day')`);
      await tx.execute(sql`insert into expert_referral_reward_grants (
        id, inviter_expert_id, referral_id, qualifying_order_id,
        first_settlement_id, amount_minor, granted_at, expires_at
      ) values (${creditGrantId}::uuid, ${invitee.expertId}::uuid,
        ${creditReferralId}::uuid, ${creditOrderId}::uuid,
        ${creditMarkerId}::uuid, 100000,
        transaction_timestamp() - interval '1 day',
        transaction_timestamp() - interval '1 day' + interval '365 days')`);
      await tx.execute(sql`insert into expert_referral_ledger_entries (
        id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
        reward_grant_id, idempotency_key
      ) values (${creditRewardEntryId}::uuid, ${invitee.expertId}::uuid,
        'reward_grant', 100000, 'reward_grant', ${creditGrantId}::uuid,
        ${creditGrantId}::uuid, ${`credit-reward-${creditGrantId}`})`);
      await tx.execute(sql`insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values (${creditRewardEntryId}::uuid, ${creditGrantId}::uuid, 100000)`);
    }
    await tx.execute(sql`insert into expert_residency_orders (
      id, expert_id, tariff_version_id, tariff_name, tariff_description,
      price_minor, currency, duration_seconds, credit_minor, cash_minor,
      payment_deadline, provider_deadline, idempotency_key, payment_provider,
      provider_payment_id, status, quoted_at, payment_started_at
    ) values (${orderId}::uuid, ${invitee.expertId}::uuid, ${tariffId}::uuid,
      'Hold', 'Hold fixture', 100000, 'RUB', 2592000, ${creditMinor},
      ${cashMinor},
      transaction_timestamp() + interval '1 day',
      transaction_timestamp() + interval '1 day', ${`hold-order-${orderId}`},
      'sandbox', ${paymentId}, 'payment_pending', transaction_timestamp(),
      transaction_timestamp())`);
    await tx.execute(sql`insert into expert_residency_payment_attempts (
      id, order_id, provider, provider_request_id, expected_amount_minor,
      currency, status, idempotency_key
    ) values (${attemptId}::uuid, ${orderId}::uuid, 'sandbox', ${paymentId},
      ${cashMinor}, 'RUB', 'pending', ${`hold-attempt-${attemptId}`})`);
    if (creditMinor > 0n) {
      const reservationId = randomUUID();
      await tx.execute(sql`insert into expert_referral_ledger_entries (
        id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
        idempotency_key
      ) values (${reservationId}::uuid, ${invitee.expertId}::uuid,
        'reservation', ${-creditMinor}, 'residency_order', ${orderId}::uuid,
        ${`credit-reservation-${orderId}`})`);
      await tx.execute(sql`insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values (${reservationId}::uuid, ${creditGrantId}::uuid, ${creditMinor})`);
    }
  });
  if (input.abuseHold === true) {
    const holdEvidence = await fixtures.createAdminEvidence(
      "expert_referral.abuse_hold_open",
      invitee.expertId,
      { expertId: invitee.expertId, reasonCode: "manual_review" },
    );
    await testDb.db.execute(sql`insert into expert_referral_abuse_holds (
      expert_id, status, reason_code, opened_approval_id, opened_by_admin_id,
      opened_admin_session_id_hash
    ) values (${invitee.expertId}::uuid, 'open', 'manual_review',
      ${holdEvidence.approvalId}::uuid, ${holdEvidence.adminId}::uuid,
      ${holdEvidence.sessionIdHash})`);
  }
  const raw: ExpertResidencyPaymentEvent = {
    kind: "settled",
    provider: "sandbox",
    eventId: `evt_settle_${randomUUID()}`,
    paymentId,
    orderId,
    amountMinor: cashMinor.toString(),
    currency: "RUB",
    occurredAt: "2026-08-03T00:00:00.000Z",
    payloadDigest: `sha256:${"c".repeat(64)}`,
  };
  return {
    inviterId: inviter.expertId,
    inviteeId: invitee.expertId,
    orderId,
    paymentId,
    cashMinor: cashMinor.toString(),
    creditGrantId,
    settlement: verifiedEventFixture(raw, {
      verificationId: `verify_${raw.eventId}`,
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
      payloadDigest: raw.payloadDigest,
    }),
  };
}

function refundEvent(
  scenario: HeldScenario,
  input: {
    readonly kind?: "refunded" | "charged_back";
    readonly eventId?: string;
    readonly amountMinor?: string;
    readonly terminatesResidency?: boolean;
    readonly digestCharacter?: string;
  } = {},
) {
  const common = {
    provider: "sandbox",
    eventId: input.eventId ?? `evt_refund_${randomUUID()}`,
    paymentId: scenario.paymentId,
    orderId: scenario.orderId,
    amountMinor: input.amountMinor ?? scenario.cashMinor,
    currency: "RUB" as const,
    occurredAt: "2026-08-03T00:00:02.000Z",
    payloadDigest: `sha256:${(input.digestCharacter ?? "d").repeat(64)}`,
  };
  const event: ExpertResidencyPaymentEvent =
    input.kind === "refunded"
      ? {
          ...common,
          kind: "refunded",
          terminatesResidency: input.terminatesResidency ?? true,
        }
      : {
          ...common,
          kind: "charged_back",
          terminatesResidency: input.terminatesResidency ?? true,
        };
  return verifiedEventFixture(event, {
    verificationId: `verify_${event.eventId}`,
    verifierKeyVersion: "sandbox-v1",
    verifiedAt: "2026-08-03T00:00:03.000Z",
    payloadDigest: event.payloadDigest,
  });
}

async function heldFacts(scenario: HeldScenario) {
  return (
    await testDb.db.execute<{
      eligibility: string;
      reason: string;
      grants: number;
      reversals: number;
      debtMinor: string;
      spendableMinor: string;
    }>(sql`select
      (select eligibility_status::text from expert_first_residency_settlements
        where expert_id = ${scenario.inviteeId}::uuid) as eligibility,
      (select eligibility_reason_code from expert_first_residency_settlements
        where expert_id = ${scenario.inviteeId}::uuid) as reason,
      (select count(*)::integer from expert_referral_reward_grants
        where qualifying_order_id = ${scenario.orderId}::uuid) as grants,
      (select count(*)::integer from expert_referral_ledger_entries reversal
        join expert_referral_reward_grants reward_grant
          on reward_grant.id = reversal.source_id
        where reversal.entry_kind = 'reversal'
          and reward_grant.qualifying_order_id = ${scenario.orderId}::uuid) as reversals,
      (select debt_minor::text from expert_referral_balances
        where expert_id = ${scenario.inviterId}::uuid) as "debtMinor",
      (select spendable_balance_minor::text from expert_referral_balances
        where expert_id = ${scenario.inviterId}::uuid) as "spendableMinor"`)
  ).rows[0]!;
}

describe("expert residency held reward replay", () => {
  it.each(["refunded", "charged_back"] as const)(
    "releases credit for an early terminating %s and prevents delayed settlement",
    async (kind) => {
      const prepared = await scenario({
        rewardEnabled: false,
        creditMinor: 50_000n,
      });
      const repo = new PostgresExpertResidencyProviderInboxRepository(
        testDb.db,
      );
      const eventId = `evt_early_${kind}_${randomUUID()}`;
      const event = refundEvent(prepared, { kind, eventId });

      const first = await repo.refund(event);
      await expect(repo.refund(event)).resolves.toEqual(first);
      expect(first).toMatchObject({
        kind,
        cumulativeCashRefundedMinor: "50000",
        residencyTerminated: true,
        rewardReversed: false,
        eligibilityStatus: "not_first_settlement",
      });
      await expect(
        repo.refund(
          refundEvent(prepared, {
            kind,
            eventId,
            digestCharacter: "e",
          }),
        ),
      ).rejects.toMatchObject({ code: "provider_event_replay_conflict" });
      await expect(repo.settle(prepared.settlement)).rejects.toMatchObject({
        code: "order_state_invalid",
      });
      await expect(repo.settle(prepared.settlement)).rejects.toMatchObject({
        code: "order_state_invalid",
      });
      await expect(
        repo.replayHeldReward({
          expertId: prepared.inviteeId,
          qualifyingOrderId: prepared.orderId,
        }),
      ).rejects.toMatchObject({ code: "held_marker_not_found" });

      const state = (
        await testDb.db.execute<{
          status: string;
          settledAt: Date | null;
          residencyStartsAt: Date | null;
          residencyEndsAt: Date | null;
          markers: number;
          grants: number;
          reversals: number;
          refundInboxStatus: string;
          settlementInboxStatus: string;
          attemptStatus: string;
          releases: number;
          releaseAllocationMinor: string;
          releaseGrantId: string;
          spends: number;
          reservedMinor: string;
          spendableMinor: string;
        }>(sql`select
          (select status::text from expert_residency_orders
            where id = ${prepared.orderId}::uuid) as status,
          (select settled_at from expert_residency_orders
            where id = ${prepared.orderId}::uuid) as "settledAt",
          (select residency_starts_at from expert_residency_orders
            where id = ${prepared.orderId}::uuid) as "residencyStartsAt",
          (select residency_ends_at from expert_residency_orders
            where id = ${prepared.orderId}::uuid) as "residencyEndsAt",
          (select count(*)::integer from expert_first_residency_settlements
            where qualifying_order_id = ${prepared.orderId}::uuid) as markers,
          (select count(*)::integer from expert_referral_reward_grants
            where qualifying_order_id = ${prepared.orderId}::uuid) as grants,
          (select count(*)::integer from expert_referral_ledger_entries
            where entry_kind = 'reversal') as reversals,
          (select processing_status::text
            from expert_residency_provider_event_inbox
            where external_event_id = ${eventId}) as "refundInboxStatus",
          (select processing_status::text
            from expert_residency_provider_event_inbox
            where external_event_id = ${prepared.settlement.eventId})
            as "settlementInboxStatus",
          (select status::text from expert_residency_payment_attempts
            where order_id = ${prepared.orderId}::uuid) as "attemptStatus",
          (select count(*)::integer from expert_referral_ledger_entries
            where entry_kind = 'release'
              and source_id = ${prepared.orderId}::uuid) as releases,
          (select coalesce(sum(allocation.amount_minor), 0)::text
            from expert_referral_ledger_entries release
            join expert_referral_ledger_allocations allocation
              on allocation.ledger_entry_id = release.id
            where release.entry_kind = 'release'
              and release.source_id = ${prepared.orderId}::uuid)
            as "releaseAllocationMinor",
          (select allocation.reward_grant_id::text
            from expert_referral_ledger_entries release
            join expert_referral_ledger_allocations allocation
              on allocation.ledger_entry_id = release.id
            where release.entry_kind = 'release'
              and release.source_id = ${prepared.orderId}::uuid)
            as "releaseGrantId",
          (select count(*)::integer from expert_referral_ledger_entries
            where entry_kind = 'spend'
              and source_id = ${prepared.orderId}::uuid) as spends,
          (select reserved_balance_minor::text from expert_referral_balances
            where expert_id = ${prepared.inviteeId}::uuid) as "reservedMinor",
          (select spendable_balance_minor::text from expert_referral_balances
            where expert_id = ${prepared.inviteeId}::uuid) as "spendableMinor"`)
      ).rows[0];
      expect(state).toEqual({
        status: kind,
        settledAt: null,
        residencyStartsAt: null,
        residencyEndsAt: null,
        markers: 0,
        grants: 0,
        reversals: 0,
        refundInboxStatus: "processed",
        settlementInboxStatus: "failed",
        attemptStatus: "cancelled",
        releases: 1,
        releaseAllocationMinor: "50000",
        releaseGrantId: prepared.creditGrantId,
        spends: 0,
        reservedMinor: "0",
        spendableMinor: "100000",
      });
    },
  );

  it("preserves an early active refund and includes it in a later terminating cumulative bound", async () => {
    const prepared = await scenario();
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    const early = refundEvent(prepared, {
      kind: "refunded",
      amountMinor: "10000",
      terminatesResidency: false,
    });

    const earlyResult = await repo.refund(early);
    await expect(repo.refund(early)).resolves.toEqual(earlyResult);
    expect(earlyResult).toMatchObject({
      cumulativeCashRefundedMinor: "10000",
      residencyTerminated: false,
      rewardReversed: false,
    });
    await expect(repo.settle(prepared.settlement)).resolves.toMatchObject({
      kind: "settled",
      rewardEffect: { kind: "reward_granted", amountMinor: "100000" },
    });
    await expect(
      repo.refund(
        refundEvent(prepared, {
          kind: "refunded",
          amountMinor: "90000",
          terminatesResidency: true,
        }),
      ),
    ).resolves.toMatchObject({
      cumulativeCashRefundedMinor: "100000",
      residencyTerminated: true,
      rewardReversed: true,
      removedCreditMinor: "100000",
    });
    expect(await heldFacts(prepared)).toMatchObject({
      eligibility: "eligible",
      grants: 1,
      reversals: 1,
      debtMinor: "0",
      spendableMinor: "0",
    });
  });

  it("lets a terminating refund cancel a held marker permanently", async () => {
    const prepared = await scenario({ rewardEnabled: false });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    await expect(repo.settle(prepared.settlement)).resolves.toMatchObject({
      eligibilityStatus: "pending_feature_hold",
      rewardEffect: { kind: "none" },
    });

    await expect(repo.refund(refundEvent(prepared))).resolves.toMatchObject({
      residencyTerminated: true,
      eligibilityStatus: "cancelled_by_refund",
      rewardReversed: false,
    });
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = true, version = version + 1`);
    await expect(
      repo.replayHeldReward({
        expertId: prepared.inviteeId,
        qualifyingOrderId: prepared.orderId,
      }),
    ).resolves.toMatchObject({ kind: "cancelled_by_refund" });
    expect(await heldFacts(prepared)).toMatchObject({
      eligibility: "cancelled_by_refund",
      grants: 0,
      reversals: 0,
      debtMinor: "0",
      spendableMinor: "0",
    });
  });

  it("grants a valid held reward once after re-enable", async () => {
    const prepared = await scenario({ rewardEnabled: false });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    await repo.settle(prepared.settlement);
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = true, version = version + 1`);
    const command = {
      expertId: prepared.inviteeId,
      qualifyingOrderId: prepared.orderId,
    };

    const first = await repo.replayHeldReward(command);
    await expect(repo.replayHeldReward(command)).resolves.toEqual(first);
    expect(first).toMatchObject({
      kind: "reward_granted",
      amountMinor: "100000",
    });
    expect(await heldFacts(prepared)).toMatchObject({
      eligibility: "eligible",
      grants: 1,
      reversals: 0,
      debtMinor: "0",
      spendableMinor: "100000",
    });
  });

  it("permanently records an open settlement-time abuse hold", async () => {
    const prepared = await scenario({ abuseHold: true });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    await expect(repo.settle(prepared.settlement)).resolves.toMatchObject({
      eligibilityStatus: "ineligible",
      rewardEffect: { kind: "none" },
    });
    await expect(
      repo.replayHeldReward({
        expertId: prepared.inviteeId,
        qualifyingOrderId: prepared.orderId,
      }),
    ).resolves.toMatchObject({ kind: "ineligible" });
    expect(await heldFacts(prepared)).toMatchObject({
      eligibility: "ineligible",
      reason: "abuse_review_open",
      grants: 0,
    });
  });

  it("rolls back held reward effects when its exact outbox fact conflicts", async () => {
    const prepared = await scenario({ rewardEnabled: false });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    await repo.settle(prepared.settlement);
    const markerId = (
      await testDb.db.execute<{ markerId: string }>(sql`select id as "markerId"
        from expert_first_residency_settlements
        where expert_id = ${prepared.inviteeId}::uuid`)
    ).rows[0]!.markerId;
    await testDb.db.execute(sql`insert into integration_outbox (
      idempotency_key, topic, payload, correlation_id, reconciliation_key,
      payload_hash
    ) values (${`expert-residency-held-replay:${markerId}`},
      'expert_residency.held_reward_replayed', '{"conflict":true}'::jsonb,
      'wrong', ${`expert-residency:${prepared.orderId}`},
      ${`sha256:${"f".repeat(64)}`})`);
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = true, version = version + 1`);

    await expect(
      repo.replayHeldReward({
        expertId: prepared.inviteeId,
        qualifyingOrderId: prepared.orderId,
      }),
    ).rejects.toMatchObject({ code: "outbox_replay_conflict" });
    expect(await heldFacts(prepared)).toMatchObject({
      eligibility: "pending_feature_hold",
      grants: 0,
      reversals: 0,
      debtMinor: "0",
      spendableMinor: "0",
    });
  });

  it("rejects a kind-only held reward outbox that omits the canonical reward amount", async () => {
    const prepared = await scenario({ rewardEnabled: false });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    await repo.settle(prepared.settlement);
    const markerId = (
      await testDb.db.execute<{ markerId: string }>(sql`select id as "markerId"
        from expert_first_residency_settlements
        where expert_id = ${prepared.inviteeId}::uuid`)
    ).rows[0]!.markerId;
    const incompletePayload = {
      orderId: prepared.orderId,
      expertId: prepared.inviteeId,
      markerId,
      outcome: "reward_granted",
    };
    await testDb.db.execute(sql`insert into integration_outbox (
      idempotency_key, topic, payload, correlation_id, reconciliation_key,
      payload_hash
    ) values (${`expert-residency-held-replay:${markerId}`},
      'expert_residency.held_reward_replayed',
      ${JSON.stringify(incompletePayload)}::jsonb, ${`held-replay:${markerId}`},
      ${`expert-residency:${prepared.orderId}`},
      ${payloadHash(incompletePayload)})`);
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = true, version = version + 1`);

    await expect(
      repo.replayHeldReward({
        expertId: prepared.inviteeId,
        qualifyingOrderId: prepared.orderId,
      }),
    ).rejects.toMatchObject({ code: "outbox_replay_conflict" });
    expect(await heldFacts(prepared)).toMatchObject({
      eligibility: "pending_feature_hold",
      grants: 0,
      spendableMinor: "0",
    });
  });

  it("rejects a kind-only held ineligibility outbox that omits the canonical reason", async () => {
    const prepared = await scenario({ rewardEnabled: false });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    await repo.settle(prepared.settlement);
    await testDb.db.execute(sql`update expert_residency_orders set
      residency_starts_at = transaction_timestamp() - interval '60 days',
      residency_ends_at = transaction_timestamp() - interval '30 days'
      where id = ${prepared.orderId}::uuid`);
    const markerId = (
      await testDb.db.execute<{ markerId: string }>(sql`select id as "markerId"
        from expert_first_residency_settlements
        where expert_id = ${prepared.inviteeId}::uuid`)
    ).rows[0]!.markerId;
    const incompletePayload = {
      orderId: prepared.orderId,
      expertId: prepared.inviteeId,
      markerId,
      outcome: "ineligible",
    };
    await testDb.db.execute(sql`insert into integration_outbox (
      idempotency_key, topic, payload, correlation_id, reconciliation_key,
      payload_hash
    ) values (${`expert-residency-held-replay:${markerId}`},
      'expert_residency.held_reward_replayed',
      ${JSON.stringify(incompletePayload)}::jsonb, ${`held-replay:${markerId}`},
      ${`expert-residency:${prepared.orderId}`},
      ${payloadHash(incompletePayload)})`);
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = true, version = version + 1`);

    await expect(
      repo.replayHeldReward({
        expertId: prepared.inviteeId,
        qualifyingOrderId: prepared.orderId,
      }),
    ).rejects.toMatchObject({ code: "outbox_replay_conflict" });
    expect(await heldFacts(prepared)).toMatchObject({
      eligibility: "pending_feature_hold",
      reason: "reward_grants_disabled",
      grants: 0,
    });
  });

  it("serializes terminating refund against held replay without duplicate value", async () => {
    const prepared = await scenario({ rewardEnabled: false });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    await repo.settle(prepared.settlement);
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = true, version = version + 1`);

    await Promise.all([
      repo.refund(refundEvent(prepared)),
      repo.replayHeldReward({
        expertId: prepared.inviteeId,
        qualifyingOrderId: prepared.orderId,
      }),
    ]);
    const facts = await heldFacts(prepared);
    expect(facts.debtMinor).toBe("0");
    expect(facts.spendableMinor).toBe("0");
    expect(
      (facts.eligibility === "cancelled_by_refund" &&
        facts.grants === 0 &&
        facts.reversals === 0) ||
        (facts.eligibility === "eligible" &&
          facts.grants === 1 &&
          facts.reversals === 1),
    ).toBe(true);
  });
});
