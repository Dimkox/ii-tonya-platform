import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import { expertResidencyPaymentEventSchema } from "../../packages/contracts/src/expert-residency.js";
import { PostgresExpertReferralControlRepository } from "../../packages/db/src/repositories/expert-referral-control-repository.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import { PostgresExpertReferralWorkerRepository } from "../../packages/db/src/repositories/expert-referral-worker-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";

let testDb: ExpertReferralTestDatabase | undefined;

const codeCrypto = new ExpertCodeCrypto({
  currentVersion: "v1",
  activeVersions: ["v1"],
  key: () => new Uint8Array(32).fill(23),
});

const referralRepo = () =>
  new PostgresExpertReferralRepository(testDb!.db, codeCrypto);
const residencyRepo = () => new PostgresExpertResidencyRepository(testDb!.db);
const providerRepo = () =>
  new PostgresExpertResidencyProviderInboxRepository(testDb!.db);

async function switchControl(input: {
  expectedVersion: number;
  newCommandsEnabled: boolean;
  rewardGrantsEnabled: boolean;
}) {
  const audit = await testDb!.createFeatureControlApproval(input);
  return new PostgresExpertReferralControlRepository(testDb!.db).setFeatureControl({
    ...input,
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
}

async function createTariff(input: {
  key: string;
  displayName: string;
  priceMinor: bigint;
  durationSeconds?: number;
}) {
  const audit = await testDb!.createAdminAudit({
    action: "expert_residency.tariff_create",
    objectId: randomUUID(),
  });
  return residencyRepo().createTariffVersion({
    tariffKey: `${input.key}-${randomUUID()}`,
    displayName: input.displayName,
    priceMinor: input.priceMinor,
    durationSeconds: input.durationSeconds ?? 86_400,
    activeFrom: new Date(Date.now() - 60_000),
    activeTo: new Date(Date.now() + 7 * 86_400_000),
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
}

function verifiedPayment(input: {
  kind: "settled" | "refunded" | "charged_back";
  eventId: string;
  paymentId: string;
  orderId: string;
  amountMinor: string;
}) {
  const hex = input.eventId
    .toLowerCase()
    .replace(/[^0-9a-f]/gu, "a")
    .padEnd(64, "a")
    .slice(0, 64);
  return verifiedEventFixture(
    expertResidencyPaymentEventSchema.parse({
      kind: input.kind,
      provider: "sandbox",
      eventId: input.eventId,
      paymentId: input.paymentId,
      orderId: input.orderId,
      amountMinor: input.amountMinor,
      currency: "RUB",
      occurredAt: "2026-08-11T08:00:00.000Z",
      payloadDigest: `sha256:${hex}`,
    }),
    {
      verificationId: `verify_${input.eventId}`,
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-11T08:00:01.000Z",
    },
  ) as never;
}

describe("expert residency referral release candidate", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await testDb!.reset();
  });

  afterAll(async () => {
    await testDb?.stop();
  });

  it("runs the disabled-boundary financial lifecycle without a live provider call", async () => {
    await expect(
      switchControl({
        expectedVersion: 0,
        newCommandsEnabled: true,
        rewardGrantsEnabled: true,
      }),
    ).resolves.toMatchObject({ version: 1 });

    const inviter = await testDb!.createExpertIdentity();
    const inviteeOne = await testDb!.createExpertIdentity();
    const inviteeTwo = await testDb!.createExpertIdentity();

    const issueAudit = await testDb!.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: inviter.expertId,
    });
    const issued = await referralRepo().issueBatch({
      inviterExpertId: inviter.expertId,
      count: 2,
      issuedByAdminId: issueAudit.adminId,
      approvalId: issueAudit.approvalId,
      adminSessionIdHash: issueAudit.sessionIdHash,
    });
    expect(issued.codes).toHaveLength(2);

    await referralRepo().redeemCode({
      plaintext: issued.codes[0]!.plaintext,
      userId: inviteeOne.userId,
      provider: inviteeOne.provider,
      externalId: inviteeOne.externalId,
    });
    await referralRepo().redeemCode({
      plaintext: issued.codes[1]!.plaintext,
      userId: inviteeTwo.userId,
      provider: inviteeTwo.provider,
      externalId: inviteeTwo.externalId,
    });

    const entryTariff = await createTariff({
      key: "e2e-entry",
      displayName: "Entry residency",
      priceMinor: 50_000n,
    });
    const renewalTariff = await createTariff({
      key: "e2e-renewal",
      displayName: "Renewal residency",
      priceMinor: 200_000n,
    });

    const inviteeOneOrder = await residencyRepo().createCheckoutOrder({
      expertId: inviteeOne.expertId,
      tariffVersionId: entryTariff.id,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: `e2e-invitee-one-${randomUUID()}`,
    });
    const inviteeTwoOrder = await residencyRepo().createCheckoutOrder({
      expertId: inviteeTwo.expertId,
      tariffVersionId: entryTariff.id,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: `e2e-invitee-two-${randomUUID()}`,
    });

    const firstSettlement = await providerRepo().settle(
      verifiedPayment({
        kind: "settled",
        eventId: "e2e_settle_one",
        paymentId: "pay_e2e_one",
        orderId: inviteeOneOrder.id,
        amountMinor: "50000",
      }),
    );
    expect(firstSettlement).toMatchObject({
      firstSettlement: true,
      rewardGranted: true,
      eligibility: "eligible",
    });
    await expect(residencyRepo().balance(inviter.expertId)).resolves.toMatchObject({
      availableCreditMinor: "100000",
      debtMinor: "0",
    });

    const expiringOrder = await residencyRepo().createCheckoutOrder({
      expertId: inviter.expertId,
      tariffVersionId: renewalTariff.id,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: `e2e-expiry-${randomUUID()}`,
    });
    expect(expiringOrder).toMatchObject({
      priceMinor: "200000",
      creditMinor: "100000",
      cashMinor: "100000",
    });
    await testDb!.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role=replica`);
      await tx.execute(sql`
        update expert_residency_orders
        set payment_deadline=transaction_timestamp()-interval '1 second'
        where id=${expiringOrder.id}::uuid
      `);
    });
    const worker = new PostgresExpertReferralWorkerRepository(testDb!.db);
    await expect(
      worker.expireDueBatch({ now: new Date(), batchSize: 100 }),
    ).resolves.toMatchObject({ examined: 1, changed: 1, failed: 0 });
    await expect(residencyRepo().balance(inviter.expertId)).resolves.toMatchObject({
      availableCreditMinor: "100000",
      reservedCreditMinor: "0",
    });

    const quote = await residencyRepo().quote({
      expertId: inviter.expertId,
      tariffVersionId: renewalTariff.id,
    });
    expect(quote).toMatchObject({
      priceMinor: "200000",
      creditMinor: "100000",
      cashMinor: "100000",
    });
    const renewalOrder = await residencyRepo().createCheckoutOrder({
      expertId: inviter.expertId,
      tariffVersionId: renewalTariff.id,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: `e2e-renewal-${randomUUID()}`,
    });
    await providerRepo().settle(
      verifiedPayment({
        kind: "settled",
        eventId: "e2e_renewal_settle",
        paymentId: "pay_e2e_renewal",
        orderId: renewalOrder.id,
        amountMinor: "100000",
      }),
    );

    const partialRefund = await providerRepo().reverse(
      verifiedPayment({
        kind: "refunded",
        eventId: "e2e_renewal_partial_refund",
        paymentId: "pay_e2e_renewal",
        orderId: renewalOrder.id,
        amountMinor: "10000",
      }),
    );
    expect(partialRefund).toMatchObject({
      cashRefundedMinor: 10_000n,
      restoredCreditMinor: 0n,
      rewardReversed: false,
      terminated: false,
    });

    const qualifyingChargeback = await providerRepo().reverse(
      verifiedPayment({
        kind: "charged_back",
        eventId: "e2e_first_chargeback",
        paymentId: "pay_e2e_one",
        orderId: inviteeOneOrder.id,
        amountMinor: "50000",
      }),
    );
    expect(qualifyingChargeback).toMatchObject({
      rewardReversed: true,
      debtMinor: 100_000n,
      terminated: true,
    });
    await expect(residencyRepo().balance(inviter.expertId)).resolves.toMatchObject({
      availableCreditMinor: "0",
      debtMinor: "100000",
    });

    await expect(
      switchControl({
        expectedVersion: 1,
        newCommandsEnabled: false,
        rewardGrantsEnabled: false,
      }),
    ).resolves.toMatchObject({ version: 2 });

    const heldSettlement = await providerRepo().settle(
      verifiedPayment({
        kind: "settled",
        eventId: "e2e_settle_two_held",
        paymentId: "pay_e2e_two",
        orderId: inviteeTwoOrder.id,
        amountMinor: "50000",
      }),
    );
    expect(heldSettlement).toMatchObject({
      firstSettlement: true,
      rewardGranted: false,
      eligibility: "pending_feature_hold",
    });

    const blockedAudit = await testDb!.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: inviter.expertId,
    });
    await expect(
      referralRepo().issueBatch({
        inviterExpertId: inviter.expertId,
        count: 1,
        issuedByAdminId: blockedAudit.adminId,
        approvalId: blockedAudit.approvalId,
        adminSessionIdHash: blockedAudit.sessionIdHash,
      }),
    ).rejects.toMatchObject({ code: "EXPERT_REFERRAL_DISABLED" });

    await expect(
      switchControl({
        expectedVersion: 2,
        newCommandsEnabled: false,
        rewardGrantsEnabled: true,
      }),
    ).resolves.toMatchObject({ version: 3 });

    const replay = await worker.replayDueBatch({
      now: new Date(Date.now() + 1_000),
      batchSize: 100,
    });
    expect(replay).toEqual({ examined: 1, granted: 1, cancelled: 0 });
    await expect(residencyRepo().balance(inviter.expertId)).resolves.toMatchObject({
      availableCreditMinor: "0",
      debtMinor: "0",
    });

    const heldMarker = await testDb!.db.execute<{ eligibility: string }>(sql`
      select eligibility
      from expert_first_residency_settlements
      where expert_id=${inviteeTwo.expertId}::uuid
    `);
    expect(heldMarker.rows[0]?.eligibility).toBe("eligible");

    const liveProviderArtifacts = await testDb!.db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from integration_errors
      where provider <> 'expert_residency'
        and reason_code like 'expert_residency%'
    `);
    expect(liveProviderArtifacts.rows[0]?.n).toBe(0);
  });
}, 120_000);
