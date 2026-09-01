import { describe, expect, it } from "vitest";
import {
  ExpertReferralAdminServiceError,
  createExpertReferralAdminService,
  type ExpertReferralAdminDependencies,
} from "./expert-referral-admin-service.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000901";
const INVITER_ID = "00000000-0000-4000-8000-000000000902";
const CODE_ID = "00000000-0000-4000-8000-000000000903";
const TARIFF_ID = "00000000-0000-4000-8000-000000000904";
const ORDER_ID = "00000000-0000-4000-8000-000000000905";
const OVERRIDE_ID = "00000000-0000-4000-8000-000000000906";
const APPROVAL_ID = "00000000-0000-4000-8000-000000000907";
const SECOND_APPROVAL_ID = "00000000-0000-4000-8000-000000000908";
const FEATURE_ID = "00000000-0000-4000-8000-000000000018";

const principal = {
  id: ADMIN_ID,
  sessionIdHash: "sha256:admin-session",
  roles: ["entitlement_admin" as const],
  mfaVerifiedAt: new Date("2026-08-03T00:00:00.000Z"),
};

const authorization = {
  approvalId: APPROVAL_ID,
  nonce: "nonce:expert-referral-admin-001",
};

function fixture(): ExpertReferralAdminDependencies & {
  readonly operations: string[];
  readonly nonces: string[];
  setCeilings(referralEnabled: boolean, residencyBillingEnabled: boolean): void;
} {
  const operations: string[] = [];
  const nonces: string[] = [];
  let ceilings = { referralEnabled: true, residencyBillingEnabled: true };
  return {
    operations,
    nonces,
    setCeilings(referralEnabled, residencyBillingEnabled) {
      ceilings = { referralEnabled, residencyBillingEnabled };
    },
    environment: { read: () => ceilings },
    referrals: {
      async issueBatch(command) {
        operations.push(`issue:${command.count}`);
        nonces.push(command.nonce);
        return {
          batchId: "00000000-0000-4000-8000-000000000910",
          inviterExpertId: command.inviterExpertId,
          codes: [
            {
              codeId: "00000000-0000-4000-8000-000000000911",
              plaintext: "EXPERT-PLAINTEXT-NEVER-PERSIST",
              maskedSuffix: "…SIST",
            },
          ],
        };
      },
      async revokeCode(command) {
        operations.push(`revoke:${command.codeId}:${command.reasonCode}`);
        return {
          codeId: command.codeId,
          inviterExpertId: INVITER_ID,
          maskedSuffix: "…VOKE",
          status: "revoked" as const,
          issuedAt: new Date("2026-08-03T00:00:00.000Z"),
        };
      },
      async maskedInventory() {
        operations.push("inventory");
        return [
          {
            batchId: "00000000-0000-4000-8000-000000000910",
            status: "issued" as const,
            maskedSuffix: "…SIST",
            createdAt: new Date("2026-08-03T00:00:00.000Z"),
            plaintext: "EXPERT-PLAINTEXT-NEVER-PERSIST",
            digest: "sha256:must-not-leak",
            inviterExpertId: INVITER_ID,
            paymentId: "pay_must_not_leak",
          },
        ];
      },
    },
    overrides: {
      async createIssuanceOverride(command) {
        operations.push(`override:${command.additionalQuota}`);
        return {
          overrideId: command.overrideId,
          inviterExpertId: command.inviterExpertId,
          additionalQuota: command.additionalQuota,
          consumedCount: 0,
          expiresAt: command.expiresAt,
        };
      },
    },
    controls: {
      async updateFeatureControl(command) {
        operations.push(`feature:${command.expectedVersion}`);
        return {
          persisted: true,
          version: command.expectedVersion + 1,
          newCommandsEnabled: command.newCommandsEnabled,
          rewardGrantsEnabled: command.rewardGrantsEnabled,
        };
      },
      async openAbuseHold(command) {
        operations.push(`open:${command.expertId}:${command.reasonCode}`);
        return {
          holdId: "00000000-0000-4000-8000-000000000912",
          expertId: command.expertId,
          status: "open" as const,
          version: 1,
        };
      },
      async closeAbuseHold(command) {
        operations.push(`close:${command.expertId}:${command.reasonCode}`);
        return {
          holdId: "00000000-0000-4000-8000-000000000912",
          expertId: command.expertId,
          status: "closed" as const,
          version: 2,
        };
      },
    },
    tariffs: {
      async createTariffVersion(command) {
        operations.push(`tariff-create:${command.tariffVersionId}`);
        return {
          tariffVersionId: command.tariffVersionId,
          displayName: command.displayName,
          description: command.description,
          priceMinor: command.priceMinor.toString(),
          currency: "RUB" as const,
          durationSeconds: command.durationSeconds,
          creditMinor: "0",
          cashMinor: command.priceMinor.toString(),
        };
      },
      async retireTariffVersion(command) {
        operations.push(`tariff-retire:${command.tariffVersionId}`);
      },
    },
    heldRewards: {
      async replayHeldRewardAsAdmin(command) {
        operations.push(`replay:${command.qualifyingOrderId}`);
        return {
          kind: "reward_granted" as const,
          amountMinor: "100000" as const,
        };
      },
    },
  };
}

const expectError = async (
  promise: Promise<unknown>,
  code: string,
  statusCode: ExpertReferralAdminServiceError["statusCode"],
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({
    name: "ExpertReferralAdminServiceError",
    code,
    statusCode,
  } satisfies Partial<ExpertReferralAdminServiceError>);
};

describe("expert referral admin application boundary", () => {
  it.each([0, 1001])(
    "rejects batch count %i before referral issuance",
    async (count) => {
      const deps = fixture();
      const service = createExpertReferralAdminService(deps);

      await expectError(
        service.issueBatch(principal, {
          ...authorization,
          routeObjectId: INVITER_ID,
          inviterExpertId: INVITER_ID,
          count,
        }),
        "invalid_command",
        400,
      );
      expect(deps.operations).toEqual([]);
    },
  );

  it("enforces the fresh referral process ceiling before every batch issuance", async () => {
    const deps = fixture();
    const service = createExpertReferralAdminService(deps);
    deps.setCeilings(false, true);

    await expectError(
      service.issueBatch(principal, {
        ...authorization,
        routeObjectId: INVITER_ID,
        inviterExpertId: INVITER_ID,
        count: 1,
      }),
      "feature_disabled",
      403,
    );
    deps.setCeilings(true, true);
    await expect(
      service.issueBatch(principal, {
        ...authorization,
        routeObjectId: INVITER_ID,
        inviterExpertId: INVITER_ID,
        count: 1,
      }),
    ).resolves.toMatchObject({
      codes: [{ plaintext: "EXPERT-PLAINTEXT-NEVER-PERSIST" }],
    });
    deps.setCeilings(false, true);
    await expectError(
      service.issueBatch(principal, {
        ...authorization,
        routeObjectId: INVITER_ID,
        inviterExpertId: INVITER_ID,
        count: 1,
      }),
      "feature_disabled",
      403,
    );
    expect(deps.operations).toEqual(["issue:1"]);
    expect(deps.nonces).toEqual([authorization.nonce]);
  });

  it("binds the route target and authenticated approval evidence for referral mutations", async () => {
    const deps = fixture();
    const service = createExpertReferralAdminService(deps);

    await expectError(
      service.revokeCode(principal, {
        ...authorization,
        routeObjectId: INVITER_ID,
        codeId: CODE_ID,
        reasonCode: "fraud_review",
      }),
      "target_mismatch",
      400,
    );
    await expect(
      service.revokeCode(principal, {
        ...authorization,
        routeObjectId: CODE_ID,
        codeId: CODE_ID,
        reasonCode: "fraud_review",
      }),
    ).resolves.toMatchObject({ status: "revoked", maskedSuffix: "…VOKE" });
    expect(deps.operations).toEqual([`revoke:${CODE_ID}:fraud_review`]);
  });

  it("creates only a bounded dual-approved issuance override", async () => {
    const deps = fixture();
    const service = createExpertReferralAdminService(deps);
    const validFrom = new Date("2026-08-03T00:00:00.000Z");
    const expiresAt = new Date("2026-08-04T00:00:00.000Z");

    await expectError(
      service.createIssuanceOverride(principal, {
        ...authorization,
        routeObjectId: OVERRIDE_ID,
        overrideId: OVERRIDE_ID,
        inviterExpertId: INVITER_ID,
        additionalQuota: 1001,
        reason: "Temporary campaign exception",
        validFrom,
        expiresAt,
        secondApprovalId: SECOND_APPROVAL_ID,
        secondNonce: "nonce:expert-referral-admin-002",
      }),
      "invalid_command",
      400,
    );
    await expect(
      service.createIssuanceOverride(principal, {
        ...authorization,
        routeObjectId: OVERRIDE_ID,
        overrideId: OVERRIDE_ID,
        inviterExpertId: INVITER_ID,
        additionalQuota: 25,
        reason: "Temporary campaign exception",
        validFrom,
        expiresAt,
        secondApprovalId: SECOND_APPROVAL_ID,
        secondNonce: "nonce:expert-referral-admin-002",
      }),
    ).resolves.toMatchObject({ overrideId: OVERRIDE_ID, additionalQuota: 25 });
    expect(deps.operations).toEqual(["override:25"]);
  });

  it("uses separate approvals for abuse-hold open and close transitions", async () => {
    const deps = fixture();
    const service = createExpertReferralAdminService(deps);

    await expect(
      service.openAbuseHold(principal, {
        ...authorization,
        routeObjectId: INVITER_ID,
        expertId: INVITER_ID,
        reasonCode: "identity_review",
      }),
    ).resolves.toMatchObject({ status: "open", version: 1 });
    await expect(
      service.closeAbuseHold(principal, {
        ...authorization,
        approvalId: SECOND_APPROVAL_ID,
        nonce: "nonce:expert-referral-admin-002",
        routeObjectId: INVITER_ID,
        expertId: INVITER_ID,
        reasonCode: "review_cleared",
      }),
    ).resolves.toMatchObject({ status: "closed", version: 2 });
    expect(deps.operations).toEqual([
      `open:${INVITER_ID}:identity_review`,
      `close:${INVITER_ID}:review_cleared`,
    ]);
  });

  it("requires the residency ceiling for tariff create and retire on each call", async () => {
    const deps = fixture();
    const service = createExpertReferralAdminService(deps);
    const command = {
      ...authorization,
      routeObjectId: TARIFF_ID,
      tariffVersionId: TARIFF_ID,
      tariffKey: "annual",
      version: 1,
      displayName: "Expert residency",
      description: "One year",
      priceMinor: "200000",
      durationSeconds: 31_536_000,
      activeFrom: new Date("2026-08-03T00:00:00.000Z"),
      activeTo: null,
    };
    deps.setCeilings(true, false);
    await expectError(
      service.createTariffVersion(principal, command),
      "feature_disabled",
      403,
    );
    deps.setCeilings(true, true);
    await expect(
      service.createTariffVersion(principal, command),
    ).resolves.toMatchObject({
      tariffVersionId: TARIFF_ID,
      priceMinor: "200000",
    });
    deps.setCeilings(true, false);
    await expectError(
      service.retireTariffVersion(principal, {
        ...authorization,
        routeObjectId: TARIFF_ID,
        tariffVersionId: TARIFF_ID,
        activeTo: new Date("2026-09-03T00:00:00.000Z"),
      }),
      "feature_disabled",
      403,
    );
    expect(deps.operations).toEqual([`tariff-create:${TARIFF_ID}`]);
  });

  it("refuses feature enablement above either process ceiling but permits disabling", async () => {
    const deps = fixture();
    const service = createExpertReferralAdminService(deps);
    deps.setCeilings(false, false);

    await expectError(
      service.updateFeatureControl(principal, {
        ...authorization,
        routeObjectId: FEATURE_ID,
        expectedVersion: 2,
        newCommandsEnabled: true,
        rewardGrantsEnabled: false,
      }),
      "feature_ceiling_conflict",
      409,
    );
    await expectError(
      service.updateFeatureControl(principal, {
        ...authorization,
        routeObjectId: FEATURE_ID,
        expectedVersion: 2,
        newCommandsEnabled: false,
        rewardGrantsEnabled: true,
      }),
      "feature_ceiling_conflict",
      409,
    );
    await expect(
      service.updateFeatureControl(principal, {
        ...authorization,
        routeObjectId: FEATURE_ID,
        expectedVersion: 2,
        newCommandsEnabled: false,
        rewardGrantsEnabled: false,
      }),
    ).resolves.toMatchObject({ version: 3 });
    expect(deps.operations).toEqual(["feature:2"]);
  });

  it("keeps approved held replay callable as an existing-state operation", async () => {
    const deps = fixture();
    deps.setCeilings(false, false);
    const service = createExpertReferralAdminService(deps);

    await expect(
      service.replayHeldReward(principal, {
        ...authorization,
        routeObjectId: ORDER_ID,
        expertId: INVITER_ID,
        qualifyingOrderId: ORDER_ID,
      }),
    ).resolves.toEqual({ kind: "reward_granted", amountMinor: "100000" });
    expect(deps.operations).toEqual([`replay:${ORDER_ID}`]);
  });

  it("projects masked inventory to four fields and rejects a wrong role", async () => {
    const deps = fixture();
    const service = createExpertReferralAdminService(deps);

    await expect(
      service.maskedInventory(principal, INVITER_ID),
    ).resolves.toEqual([
      {
        batchId: "00000000-0000-4000-8000-000000000910",
        status: "issued",
        maskedSuffix: "…SIST",
        createdAt: new Date("2026-08-03T00:00:00.000Z"),
      },
    ]);
    expect(
      JSON.stringify(await service.maskedInventory(principal, INVITER_ID)),
    ).not.toContain("EXPERT-PLAINTEXT-NEVER-PERSIST");
    await expectError(
      service.maskedInventory({ ...principal, roles: ["support"] }, INVITER_ID),
      "forbidden",
      403,
    );
  });
});
