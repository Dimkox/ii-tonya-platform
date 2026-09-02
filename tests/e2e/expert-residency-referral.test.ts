import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ExpertCodeCrypto,
  type ExpertCodeKeyring,
} from "../../packages/application/src/expert-code-crypto.js";
import type { ExpertResidencyPaymentEvent } from "../../packages/contracts/src/index.js";
import { PostgresExpertReferralControlRepository } from "../../packages/db/src/repositories/expert-referral-control-repository.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  EXPERT_REFERRAL_FEATURE_CONTROL_TEST_OBJECT_ID,
  ExpertReferralTestkit,
  type ExpertReferralExpertFixture,
} from "../../packages/db/src/testkit/expert-referral.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/testing.testkit.js";

const keyring: ExpertCodeKeyring = {
  currentVersion: "v1",
  versions: ["v1"],
  key(version) {
    if (version !== "v1") throw new Error("unknown_key_version");
    return new Uint8Array(32).fill(12);
  },
};

let testDb: TestDatabase;
let fixtures: ExpertReferralTestkit;
let controls: PostgresExpertReferralControlRepository;
let referrals: PostgresExpertReferralRepository;
let residency: PostgresExpertResidencyRepository;
let providerInbox: PostgresExpertResidencyProviderInboxRepository;
const liveProviderCalls = 0;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
  controls = new PostgresExpertReferralControlRepository(testDb.db);
  referrals = new PostgresExpertReferralRepository(
    testDb.db,
    new ExpertCodeCrypto(keyring),
  );
  residency = new PostgresExpertResidencyRepository(testDb.db);
  providerInbox = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
}, 120_000);

afterAll(async () => testDb?.stop(), 120_000);

async function databaseNow(): Promise<Date> {
  const value = (
    await testDb.db.execute<{ now: Date | string }>(
      sql`select transaction_timestamp() as now`,
    )
  ).rows[0]?.now;
  if (value === undefined) throw new Error("database_time_missing");
  return value instanceof Date ? value : new Date(value);
}

async function switchFeature(
  newCommandsEnabled: boolean,
  rewardGrantsEnabled: boolean,
) {
  const current = await controls.readForCommand();
  const payload = {
    expectedVersion: current.version,
    newCommandsEnabled,
    rewardGrantsEnabled,
  };
  const evidence = await fixtures.createAdminEvidence(
    "expert_referral.feature_switch",
    EXPERT_REFERRAL_FEATURE_CONTROL_TEST_OBJECT_ID,
    payload,
  );
  return controls.updateFeatureControl({ ...payload, ...evidence });
}

async function issueAndRedeem(
  inviter: ExpertReferralExpertFixture,
  invitee: ExpertReferralExpertFixture,
) {
  const evidence = await fixtures.createAdminEvidence(
    "expert_referral.batch_generate",
    inviter.expertId,
    { count: 1, overrideId: null },
  );
  const batch = await referrals.issueBatch({
    inviterExpertId: inviter.expertId,
    count: 1,
    ...evidence,
  });
  const plaintext = batch.codes[0]!.plaintext;
  const redeemed = await referrals.redeemCode({
    plaintext,
    inviteeExpertId: invitee.expertId,
    provider: invitee.provider,
    externalId: invitee.externalId,
  });
  return { batch, plaintext, redeemed };
}

async function createTariff(): Promise<string> {
  const tariffVersionId = randomUUID();
  const tariffKey = `e2e-${tariffVersionId}`;
  const now = await databaseNow();
  const command = {
    tariffVersionId,
    tariffKey,
    version: 1,
    displayName: "Synthetic residency",
    description: "Provider-neutral E2E only",
    priceMinor: 200_000n,
    durationSeconds: 31_536_000,
    activeFrom: new Date(now.getTime() - 86_400_000),
    activeTo: null,
  } as const;
  const evidence = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create",
    tariffVersionId,
    {
      tariffKey,
      version: 1,
      displayName: command.displayName,
      description: command.description,
      priceMinor: "200000",
      durationSeconds: command.durationSeconds,
      activeFrom: command.activeFrom.toISOString(),
      activeTo: null,
    },
  );
  await residency.createTariffVersion({ ...command, ...evidence });
  return tariffKey;
}

async function prepareSettlement(input: {
  expertId: string;
  tariffKey: string;
  idempotencyKey: string;
  providerDeadline?: Date;
}) {
  const now = await databaseNow();
  const order = await residency.createCheckoutOrder({
    expertId: input.expertId,
    tariffKey: input.tariffKey,
    providerDeadline:
      input.providerDeadline ?? new Date(now.getTime() + 86_400_000),
    idempotencyKey: input.idempotencyKey,
  });
  const attemptId = randomUUID();
  const paymentId = `sandbox-pay-${randomUUID()}`;
  await testDb.db.transaction(async (tx) => {
    await tx.execute(sql`insert into expert_residency_payment_attempts (
      id, order_id, provider, provider_request_id, expected_amount_minor,
      currency, status, idempotency_key
    ) values (${attemptId}::uuid, ${order.orderId}::uuid, 'sandbox', ${paymentId},
      ${BigInt(order.cashMinor)}, 'RUB', 'pending', ${`attempt-${attemptId}`})`);
    await tx.execute(sql`update expert_residency_orders set
      payment_provider = 'sandbox', provider_payment_id = ${paymentId},
      status = 'payment_pending', payment_started_at = transaction_timestamp()
      where id = ${order.orderId}::uuid`);
  });
  const raw: ExpertResidencyPaymentEvent = {
    kind: "settled",
    provider: "sandbox",
    eventId: `sandbox-settled-${randomUUID()}`,
    paymentId,
    orderId: order.orderId,
    amountMinor: order.cashMinor,
    currency: "RUB",
    occurredAt: "2026-09-02T00:00:00.000Z",
    payloadDigest: `sha256:${"a".repeat(64)}`,
  };
  return {
    order,
    paymentId,
    event: verifiedEventFixture(raw, {
      verificationId: `verified-${raw.eventId}`,
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-09-02T00:00:01.000Z",
      payloadDigest: raw.payloadDigest,
    }),
  };
}

function refundEvent(
  prepared: Awaited<ReturnType<typeof prepareSettlement>>,
  input: {
    amountMinor: string;
    terminatesResidency: boolean;
    kind?: "refunded" | "charged_back";
  },
) {
  const raw: ExpertResidencyPaymentEvent = {
    kind: input.kind ?? "refunded",
    provider: "sandbox",
    eventId: `sandbox-refund-${randomUUID()}`,
    paymentId: prepared.paymentId,
    orderId: prepared.order.orderId,
    amountMinor: input.amountMinor,
    currency: "RUB",
    occurredAt: "2026-09-02T00:00:02.000Z",
    payloadDigest: `sha256:${"b".repeat(64)}`,
    terminatesResidency: input.terminatesResidency,
  };
  return verifiedEventFixture(raw, {
    verificationId: `verified-${raw.eventId}`,
    verifierKeyVersion: "sandbox-v1",
    verifiedAt: "2026-09-02T00:00:03.000Z",
    payloadDigest: raw.payloadDigest,
  });
}

describe("expert residency referral disabled release chain", () => {
  it("runs the approved provider-neutral chain and returns to fail-closed ceilings", async () => {
    expect(await controls.readForCommand()).toMatchObject({
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    });
    expect(readFileSync(".env.example", "utf8")).toContain(
      "EXPERT_REFERRAL_ENABLED=false",
    );
    expect(readFileSync(".env.example", "utf8")).toContain(
      "EXPERT_RESIDENCY_BILLING_ENABLED=false",
    );
    expect(liveProviderCalls).toBe(0);

    await switchFeature(true, true);
    const inviter = await fixtures.createExpert();
    const invitee = await fixtures.createExpert();
    const issued = await issueAndRedeem(inviter, invitee);
    expect(issued.batch.codes).toHaveLength(1);
    expect(issued.redeemed).toMatchObject({
      inviterExpertId: inviter.expertId,
      inviteeExpertId: invitee.expertId,
    });
    expect(JSON.stringify(await fixtures.storedCodes())).not.toContain(
      issued.plaintext,
    );

    const tariffKey = await createTariff();
    const qualifying = await prepareSettlement({
      expertId: invitee.expertId,
      tariffKey,
      idempotencyKey: "e2e-qualifying",
    });
    await expect(providerInbox.settle(qualifying.event)).resolves.toMatchObject(
      {
        kind: "settled",
        eligibilityStatus: "eligible",
        rewardEffect: { kind: "reward_granted", amountMinor: "100000" },
      },
    );

    const grant = (
      await testDb.db.execute<{
        grantedAt: Date | string;
        expiresAt: Date | string;
      }>(sql`select granted_at as "grantedAt", expires_at as "expiresAt"
        from expert_referral_reward_grants
        where inviter_expert_id = ${inviter.expertId}::uuid`)
    ).rows[0]!;
    expect(
      new Date(grant.expiresAt).getTime() - new Date(grant.grantedAt).getTime(),
    ).toBe(365 * 86_400_000);

    await expect(
      residency.quote({ expertId: inviter.expertId, tariffKey }),
    ).resolves.toMatchObject({
      priceMinor: "200000",
      creditMinor: "100000",
      cashMinor: "100000",
    });
    const fiftyFifty = await prepareSettlement({
      expertId: inviter.expertId,
      tariffKey,
      idempotencyKey: "e2e-fifty-fifty",
    });
    expect(fiftyFifty.order).toMatchObject({
      creditMinor: "100000",
      cashMinor: "100000",
    });
    await expect(providerInbox.settle(fiftyFifty.event)).resolves.toMatchObject(
      {
        kind: "settled",
        financialFacts: { creditSpentMinor: "100000" },
      },
    );

    await expect(
      providerInbox.refund(
        refundEvent(qualifying, {
          amountMinor: "50000",
          terminatesResidency: false,
        }),
      ),
    ).resolves.toMatchObject({
      cumulativeCashRefundedMinor: "50000",
      residencyTerminated: false,
      rewardReversed: false,
    });
    await expect(
      providerInbox.refund(
        refundEvent(qualifying, {
          amountMinor: "150000",
          terminatesResidency: true,
        }),
      ),
    ).resolves.toMatchObject({
      cumulativeCashRefundedMinor: "200000",
      residencyTerminated: true,
      rewardReversed: true,
      debtMinor: "100000",
    });
    await expect(residency.balance(inviter.expertId)).resolves.toMatchObject({
      spendableBalanceMinor: "0",
      debtMinor: "100000",
    });

    const futureInvitee = await fixtures.createExpert();
    await issueAndRedeem(inviter, futureInvitee);
    const future = await prepareSettlement({
      expertId: futureInvitee.expertId,
      tariffKey,
      idempotencyKey: "e2e-debt-first",
    });
    await expect(providerInbox.settle(future.event)).resolves.toMatchObject({
      rewardEffect: { kind: "debt_repaid", amountMinor: "100000" },
    });
    await expect(residency.balance(inviter.expertId)).resolves.toMatchObject({
      spendableBalanceMinor: "0",
      debtMinor: "0",
    });

    const expiryInvitee = await fixtures.createExpert();
    await issueAndRedeem(inviter, expiryInvitee);
    const expiryReward = await prepareSettlement({
      expertId: expiryInvitee.expertId,
      tariffKey,
      idempotencyKey: "e2e-expiry-reward",
    });
    await providerInbox.settle(expiryReward.event);
    const shortDeadline = new Date((await databaseNow()).getTime() + 500);
    const expiringOrder = await residency.createCheckoutOrder({
      expertId: inviter.expertId,
      tariffKey,
      providerDeadline: shortDeadline,
      idempotencyKey: "e2e-expiry-release",
    });
    expect(expiringOrder.creditMinor).toBe("100000");
    await new Promise((resolve) => setTimeout(resolve, 650));
    await expect(
      residency.releaseExpiredOrders({ orderId: expiringOrder.orderId }),
    ).resolves.toEqual({ kind: "expired", released: true });

    await switchFeature(true, false);
    const replayInvitee = await fixtures.createExpert();
    await issueAndRedeem(inviter, replayInvitee);
    const replayable = await prepareSettlement({
      expertId: replayInvitee.expertId,
      tariffKey,
      idempotencyKey: "e2e-held-replay",
    });
    await expect(providerInbox.settle(replayable.event)).resolves.toMatchObject(
      {
        eligibilityStatus: "pending_feature_hold",
        rewardEffect: { kind: "none" },
      },
    );
    await switchFeature(true, true);
    const successfulReplayEvidence = await fixtures.createAdminEvidence(
      "expert_referral.hold_replay",
      replayable.order.orderId,
      { expertId: replayInvitee.expertId },
    );
    await testDb.db.execute(sql`update admin_approvals
      set object_type = 'expert_residency_order'
      where id = ${successfulReplayEvidence.approvalId}::uuid`);
    await expect(
      providerInbox.replayHeldRewardAsAdmin({
        ...successfulReplayEvidence,
        expertId: replayInvitee.expertId,
        qualifyingOrderId: replayable.order.orderId,
      }),
    ).resolves.toMatchObject({
      kind: "reward_granted",
      amountMinor: "100000",
    });

    await switchFeature(true, false);
    const heldInvitee = await fixtures.createExpert();
    await issueAndRedeem(inviter, heldInvitee);
    const held = await prepareSettlement({
      expertId: heldInvitee.expertId,
      tariffKey,
      idempotencyKey: "e2e-held",
    });
    await expect(providerInbox.settle(held.event)).resolves.toMatchObject({
      eligibilityStatus: "pending_feature_hold",
      rewardEffect: { kind: "none" },
    });
    await expect(
      providerInbox.refund(
        refundEvent(held, {
          amountMinor: "200000",
          terminatesResidency: true,
          kind: "charged_back",
        }),
      ),
    ).resolves.toMatchObject({
      kind: "charged_back",
      eligibilityStatus: "cancelled_by_refund",
      rewardReversed: false,
    });
    await switchFeature(true, true);
    const replayEvidence = await fixtures.createAdminEvidence(
      "expert_referral.hold_replay",
      held.order.orderId,
      { expertId: heldInvitee.expertId },
    );
    await testDb.db.execute(sql`update admin_approvals
      set object_type = 'expert_residency_order'
      where id = ${replayEvidence.approvalId}::uuid`);
    await expect(
      providerInbox.replayHeldRewardAsAdmin({
        ...replayEvidence,
        expertId: heldInvitee.expertId,
        qualifyingOrderId: held.order.orderId,
      }),
    ).resolves.toMatchObject({ kind: "cancelled_by_refund" });

    const existingInvitee = await fixtures.createExpert();
    await issueAndRedeem(inviter, existingInvitee);
    const existingState = await prepareSettlement({
      expertId: existingInvitee.expertId,
      tariffKey,
      idempotencyKey: "e2e-existing-state-after-kill-switch",
    });
    const disabled = await switchFeature(false, false);
    const blockedEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 1, overrideId: null },
    );
    await expect(
      referrals.issueBatch({
        inviterExpertId: inviter.expertId,
        count: 1,
        ...blockedEvidence,
      }),
    ).rejects.toMatchObject({ code: "expert_referral_commands_disabled" });
    await expect(
      providerInbox.settle(existingState.event),
    ).resolves.toMatchObject({
      kind: "settled",
      eligibilityStatus: "pending_feature_hold",
    });
    await expect(
      providerInbox.refund(
        refundEvent(existingState, {
          amountMinor: "200000",
          terminatesResidency: true,
        }),
      ),
    ).resolves.toMatchObject({
      residencyTerminated: true,
      eligibilityStatus: "cancelled_by_refund",
    });
    await expect(providerInbox.settle(future.event)).resolves.toMatchObject({
      financialFacts: { disposition: "duplicate" },
    });
    expect(disabled).toMatchObject({
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    });
    expect(liveProviderCalls).toBe(0);
  }, 120_000);
});
