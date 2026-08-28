import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PostgresClientCommercialPolicyRepository,
  PostgresMessageRepository,
} from "../../packages/db/src/index.js";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import { createExpertResidencyService } from "../../packages/application/src/expert-residency-service.js";
import { PostgresExpertReferralAdminRepository } from "../../packages/db/src/repositories/expert-referral-admin-repository.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { EXPERT_REFERRAL_FEATURE_CONTROL_ID } from "../../packages/db/src/repositories/expert-referral-control-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";
import { expertResidencyPaymentEventSchema } from "../../packages/contracts/src/expert-residency.js";

const crypto = new ExpertCodeCrypto({
  currentVersion: "v1",
  activeVersions: ["v1"],
  key: () => new Uint8Array(32).fill(7),
});
function payment(orderId: string, amountMinor: string) {
  const eventId = randomUUID();
  return verifiedEventFixture(
    expertResidencyPaymentEventSchema.parse({
      kind: "settled",
      provider: "a1-never-provider",
      eventId,
      paymentId: `pay:${eventId}`,
      orderId,
      amountMinor,
      currency: "RUB",
      occurredAt: "2026-08-28T12:00:00.000Z",
      payloadDigest: `sha256:${eventId.replaceAll("-", "").padEnd(64, "a")}`,
    }),
    {
      verificationId: `verify:${eventId}`,
      verifierKeyVersion: "a1-v1",
      verifiedAt: "2026-08-28T12:00:01.000Z",
    },
  );
}

describe("Commercial Core V2 A1 PostgreSQL path", () => {
  let database: ExpertReferralTestDatabase;
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
  }, 120_000);
  afterAll(async () => database?.stop(), 60_000);

  it("audits V2 controls and START, settles an eligible referral, completes free, and snapshots the 30% cap", async () => {
    const admin = new PostgresExpertReferralAdminRepository(
      database.db,
      crypto,
    );
    const execute = async (
      action:
        | "expert_referral.feature_switch"
        | "client_commercial_policy.control_v2"
        | "expert_residency.tariff_create_v2",
      objectId: string,
      payload: Record<string, string | number | boolean>,
      ceilings: { expertReferral: boolean; expertResidencyBilling: boolean },
    ) => {
      const audit = await database.createAdminAudit({
        action,
        objectId,
        objectType:
          action === "expert_referral.feature_switch"
            ? "expert_referral_feature_control"
            : action === "client_commercial_policy.control_v2"
              ? "client_commercial_policy_control"
              : "expert_residency_tariff_version",
        payload,
      });
      if (action !== "expert_referral.feature_switch") {
        await database.db.execute(
          sql`insert into admin_role_assignments (admin_id,role) values (${audit.adminId}::uuid,'entitlement_admin'),(${audit.approverId}::uuid,'entitlement_admin') on conflict do nothing`,
        );
        await database.db.execute(
          sql`update admin_approvals set required_role='entitlement_admin' where id=${audit.approvalId}::uuid`,
        );
      }
      return admin.execute({
        action,
        objectId,
        approvalId: audit.approvalId,
        nonce: audit.nonce,
        correlationId: randomUUID(),
        payload,
        sessionIdHash: audit.sessionIdHash,
        expectedVersion: Number(payload.expectedVersion),
        environmentCeilings: ceilings,
      });
    };
    await expect(
      execute(
        "expert_referral.feature_switch",
        EXPERT_REFERRAL_FEATURE_CONTROL_ID,
        {
          expectedVersion: 0,
          newCommandsEnabled: true,
          rewardGrantsEnabled: true,
        },
        { expertReferral: true, expertResidencyBilling: true },
      ),
    ).resolves.toMatchObject({ allowed: true, version: 1 });
    await expect(
      execute(
        "client_commercial_policy.control_v2",
        EXPERT_REFERRAL_FEATURE_CONTROL_ID,
        {
          expectedVersion: 0,
          admissionPolicy: "free_client_v2",
          newCommandsEnabled: false,
          rewardGrantsEnabled: false,
        },
        { expertReferral: false, expertResidencyBilling: false },
      ),
    ).resolves.toMatchObject({ allowed: true, version: 1 });
    const tariff = randomUUID();
    const tariffPayload = {
      tariffKey: "START",
      displayName: "Старт",
      priceMinor: 390000,
      durationSeconds: 2592000,
      commercialPolicyVersion: "expert_residency_v2",
      creditCapBps: 3000,
      individualServicesEnabled: true,
      groupEventLimit: 0,
      statisticsLevel: "basic",
      supportPriority: "standard",
      activeFrom: new Date(Date.now() - 60_000).toISOString(),
      activeTo: new Date(Date.now() + 86_400_000).toISOString(),
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    };
    await expect(
      execute("expert_residency.tariff_create_v2", tariff, tariffPayload, {
        expertReferral: false,
        expertResidencyBilling: true,
      }),
    ).resolves.toMatchObject({ allowed: true, tariffVersionId: tariff });
    const client = await database.createUser();
    const policies = new PostgresClientCommercialPolicyRepository(database.db);
    await expect(
      Promise.all([
        policies.resolveOrAssign({ userId: client, allowV2Admission: true }),
        policies.resolveOrAssign({ userId: client, allowV2Admission: true }),
      ]),
    ).resolves.toEqual(["free_client_v2", "free_client_v2"]);
    const inbound = await new PostgresMessageRepository(
      database.db,
    ).prepareInbound({
      provider: "selarti",
      externalEventId: randomUUID(),
      externalMessageId: randomUUID(),
      userId: client,
      messageClass: "ordinary_inbound",
      occurredAt: new Date(),
      correlationId: randomUUID(),
    });
    await expect(
      new PostgresMessageRepository(database.db).completeInbound({
        messageEventId: inbound.messageEventId,
        userId: client,
        correlationId: randomUUID(),
        billingPolicy: "free",
        outcome: { kind: "no_package", topic: "client.free", payload: {} },
      }),
    ).resolves.toMatchObject({
      kind: "completed",
      packageId: null,
      ledgerBalance: 0,
    });
    const inviter = await database.createExpertIdentity();
    const invitee = await database.createExpertIdentity();
    const referrals = new PostgresExpertReferralRepository(database.db, crypto);
    const issueAudit = await database.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: inviter.expertId,
    });
    const issued = await referrals.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 1,
      issuedByAdminId: issueAudit.adminId,
      approvalId: issueAudit.approvalId,
      adminSessionIdHash: issueAudit.sessionIdHash,
    });
    await referrals.redeemCode({
      plaintext: issued.codes[0]!.plaintext,
      userId: invitee.userId,
      provider: invitee.provider,
      externalId: invitee.externalId,
    });
    const residency = new PostgresExpertResidencyRepository(database.db);
    const qualifying = await residency.createCheckoutOrder({
      expertId: invitee.expertId,
      tariffVersionId: tariff,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: randomUUID(),
    });
    await expect(
      new PostgresExpertResidencyProviderInboxRepository(database.db).settle(
        payment(qualifying.id, qualifying.cashMinor),
      ),
    ).resolves.toMatchObject({
      firstSettlement: true,
      rewardGranted: true,
      eligibility: "eligible",
    });
    const secondInvitee = await database.createExpertIdentity();
    const secondIssueAudit = await database.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: inviter.expertId,
    });
    const secondIssued = await referrals.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 1,
      issuedByAdminId: secondIssueAudit.adminId,
      approvalId: secondIssueAudit.approvalId,
      adminSessionIdHash: secondIssueAudit.sessionIdHash,
    });
    await referrals.redeemCode({
      plaintext: secondIssued.codes[0]!.plaintext,
      userId: secondInvitee.userId,
      provider: secondInvitee.provider,
      externalId: secondInvitee.externalId,
    });
    const secondQualifying = await residency.createCheckoutOrder({
      expertId: secondInvitee.expertId,
      tariffVersionId: tariff,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: randomUUID(),
    });
    await new PostgresExpertResidencyProviderInboxRepository(
      database.db,
    ).settle(payment(secondQualifying.id, secondQualifying.cashMinor));
    const graph = await database.db.execute<{
      referrals: number;
      settled: number;
      markers: number;
      grants: number;
      entries: number;
      allocations: number;
    }>(
      sql`select (select count(*)::int from expert_referrals where invitee_expert_id=${invitee.expertId}::uuid) referrals,(select count(*)::int from expert_residency_orders where id=${qualifying.id}::uuid and status='settled') settled,(select count(*)::int from expert_first_residency_settlements where qualifying_order_id=${qualifying.id}::uuid and eligibility='eligible') markers,(select count(*)::int from expert_referral_reward_grants where expert_id=${inviter.expertId}::uuid) grants,(select count(*)::int from expert_referral_ledger_entries where expert_id=${inviter.expertId}::uuid and entry_kind='reward_grant') entries,(select count(*)::int from expert_referral_ledger_allocations a join expert_referral_reward_grants g on g.id=a.reward_grant_id where g.expert_id=${inviter.expertId}::uuid) allocations`,
    );
    expect(graph.rows[0]).toEqual({
      referrals: 1,
      settled: 1,
      markers: 1,
      grants: 2,
      entries: 2,
      allocations: 2,
    });
    const neverProvider = {
      createCheckout: vi.fn(async () => {
        throw new Error("provider must not be called in A1");
      }),
    };
    const commands = {
      listActiveTariffs: (input: { expertId: string; limit: 20 }) =>
        residency.listActiveTariffs(input),
      quote: (input: { expertId: string; tariffVersionId: string }) =>
        residency.quote(input),
      checkout: async () => {
        throw new Error("checkout orchestration is outside A1");
      },
    };
    const service = createExpertResidencyService({
      environmentEnabled: true,
      commands,
      queries: {
        ownerUserId: async (expertId) =>
          expertId === inviter.expertId ? inviter.userId : undefined,
      },
      reconciliation: {
        settle: async () => undefined,
        reverse: async () => undefined,
        replayHeldReward: async () => undefined,
        releaseExpiredOrders: async () => undefined,
      },
      checkoutProvider: neverProvider,
    });
    await expect(
      service.quote(
        {
          authenticated: true,
          expertId: inviter.expertId,
          userId: inviter.userId,
        },
        tariff,
      ),
    ).resolves.toMatchObject({ creditMinor: "117000", cashMinor: "273000" });
    const checkoutDisabled = createExpertResidencyService({
      environmentEnabled: false,
      commands,
      queries: { ownerUserId: async () => inviter.userId },
      reconciliation: service.reconciliation,
      checkoutProvider: neverProvider,
    });
    await expect(
      checkoutDisabled.checkout(
        {
          authenticated: true,
          expertId: inviter.expertId,
          userId: inviter.userId,
        },
        tariff,
        randomUUID(),
      ),
    ).resolves.toEqual({ kind: "disabled" });
    expect(neverProvider.createCheckout).not.toHaveBeenCalled();
    const order = await residency.createCheckoutOrder({
      expertId: inviter.expertId,
      tariffVersionId: tariff,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: randomUUID(),
    });
    expect(order).toMatchObject({
      commercialPolicyVersion: "expert_residency_v2",
      creditCapBps: 3000,
      priceMinor: "390000",
      creditMinor: "117000",
      cashMinor: "273000",
    });
    await expect(
      database.db.execute(
        sql`update expert_residency_orders set credit_cap_bps=5000 where id=${order.id}::uuid`,
      ),
    ).rejects.toBeDefined();
    await expect(
      database.db.execute<{ count: number }>(
        sql`select count(*)::int as count from expert_residency_provider_operations`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });
});
