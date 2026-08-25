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

interface HeldScenario {
  readonly inviterId: string;
  readonly inviteeId: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly settlement: ReturnType<typeof verifiedEventFixture>;
}

async function scenario(
  input: {
    readonly rewardEnabled?: boolean;
    readonly abuseHold?: boolean;
  } = {},
): Promise<HeldScenario> {
  await fixtures.enableFeatureControl();
  if (input.rewardEnabled === false) {
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = false, version = version + 1`);
  }
  const inviter = await fixtures.createExpert();
  const invitee = await fixtures.createExpert();
  const tariffId = randomUUID();
  const orderId = randomUUID();
  const attemptId = randomUUID();
  const paymentId = `pay_${randomUUID()}`;
  const batchId = randomUUID();
  const codeId = randomUUID();
  const referralId = randomUUID();
  const approval = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create",
    tariffId,
    { priceMinor: "100000", durationSeconds: 2_592_000 },
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
    await tx.execute(sql`insert into expert_residency_orders (
      id, expert_id, tariff_version_id, tariff_name, tariff_description,
      price_minor, currency, duration_seconds, credit_minor, cash_minor,
      payment_deadline, provider_deadline, idempotency_key, payment_provider,
      provider_payment_id, status, quoted_at, payment_started_at
    ) values (${orderId}::uuid, ${invitee.expertId}::uuid, ${tariffId}::uuid,
      'Hold', 'Hold fixture', 100000, 'RUB', 2592000, 0, 100000,
      transaction_timestamp() + interval '1 day',
      transaction_timestamp() + interval '1 day', ${`hold-order-${orderId}`},
      'sandbox', ${paymentId}, 'payment_pending', transaction_timestamp(),
      transaction_timestamp())`);
    await tx.execute(sql`insert into expert_residency_payment_attempts (
      id, order_id, provider, provider_request_id, expected_amount_minor,
      currency, status, idempotency_key
    ) values (${attemptId}::uuid, ${orderId}::uuid, 'sandbox', ${paymentId},
      100000, 'RUB', 'pending', ${`hold-attempt-${attemptId}`})`);
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
    amountMinor: "100000",
    currency: "RUB",
    occurredAt: "2026-08-03T00:00:00.000Z",
    payloadDigest: `sha256:${"c".repeat(64)}`,
  };
  return {
    inviterId: inviter.expertId,
    inviteeId: invitee.expertId,
    orderId,
    paymentId,
    settlement: verifiedEventFixture(raw, {
      verificationId: `verify_${raw.eventId}`,
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
      payloadDigest: raw.payloadDigest,
    }),
  };
}

function terminatingRefund(scenario: HeldScenario) {
  const event = {
    kind: "charged_back" as const,
    provider: "sandbox",
    eventId: `evt_chargeback_${randomUUID()}`,
    paymentId: scenario.paymentId,
    orderId: scenario.orderId,
    amountMinor: "100000",
    currency: "RUB" as const,
    occurredAt: "2026-08-03T00:00:02.000Z",
    payloadDigest: `sha256:${"d".repeat(64)}`,
    terminatesResidency: true as const,
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
  it("lets a terminating refund cancel a held marker permanently", async () => {
    const prepared = await scenario({ rewardEnabled: false });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    await expect(repo.settle(prepared.settlement)).resolves.toMatchObject({
      eligibilityStatus: "pending_feature_hold",
      rewardEffect: { kind: "none" },
    });

    await expect(
      repo.refund(terminatingRefund(prepared)),
    ).resolves.toMatchObject({
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

  it("serializes terminating refund against held replay without duplicate value", async () => {
    const prepared = await scenario({ rewardEnabled: false });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    await repo.settle(prepared.settlement);
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = true, version = version + 1`);

    await Promise.all([
      repo.refund(terminatingRefund(prepared)),
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
