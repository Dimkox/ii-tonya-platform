import { recordExpertReferralLifecycle } from "@ii-tonya/observability";
import type { AdminPrincipal } from "./admin-service.js";

export const EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID =
  "00000000-0000-4000-8000-000000000018";

export interface ExpertReferralAdminAuthorization {
  readonly routeObjectId: string;
  readonly approvalId: string;
  readonly nonce: string;
}

interface AdminEvidence {
  readonly adminId: string;
  readonly approvalId: string;
  readonly sessionIdHash: string;
  readonly nonce: string;
}

export interface ExpertReferralAdminDependencies {
  readonly environment: {
    read(): {
      readonly referralEnabled: boolean;
      readonly residencyBillingEnabled: boolean;
    };
  };
  readonly referrals: {
    issueBatch(
      command: AdminEvidence & {
        readonly inviterExpertId: string;
        readonly count: number;
        readonly overrideId?: string;
      },
    ): Promise<{
      readonly batchId: string;
      readonly inviterExpertId: string;
      readonly codes: readonly {
        readonly codeId: string;
        readonly plaintext: string;
        readonly maskedSuffix: string;
      }[];
    }>;
    revokeCode(
      command: AdminEvidence & {
        readonly codeId: string;
        readonly reasonCode: string;
      },
    ): Promise<{
      readonly codeId: string;
      readonly inviterExpertId: string;
      readonly maskedSuffix: string;
      readonly status: "revoked";
      readonly issuedAt: Date;
    }>;
    maskedInventory(inviterExpertId: string): Promise<
      readonly {
        readonly batchId: string;
        readonly status: "issued" | "redeemed" | "revoked";
        readonly maskedSuffix: string;
        readonly createdAt: Date;
      }[]
    >;
  };
  readonly overrides: {
    createIssuanceOverride(
      command: AdminEvidence & {
        readonly overrideId: string;
        readonly inviterExpertId: string;
        readonly additionalQuota: number;
        readonly reason: string;
        readonly validFrom: Date;
        readonly expiresAt: Date;
        readonly nonce: string;
        readonly secondApprovalId: string;
        readonly secondNonce: string;
      },
    ): Promise<{
      readonly overrideId: string;
      readonly inviterExpertId: string;
      readonly additionalQuota: number;
      readonly consumedCount: number;
      readonly expiresAt: Date;
    } | null>;
  };
  readonly controls: {
    updateFeatureControl(
      command: AdminEvidence & {
        readonly expectedVersion: number;
        readonly newCommandsEnabled: boolean;
        readonly rewardGrantsEnabled: boolean;
      },
    ): Promise<{
      readonly persisted: boolean;
      readonly version: number;
      readonly newCommandsEnabled: boolean;
      readonly rewardGrantsEnabled: boolean;
    }>;
    openAbuseHold(
      command: AdminEvidence & {
        readonly expertId: string;
        readonly reasonCode: string;
      },
    ): Promise<ExpertReferralAbuseHoldResult>;
    closeAbuseHold(
      command: AdminEvidence & {
        readonly expertId: string;
        readonly reasonCode: string;
      },
    ): Promise<ExpertReferralAbuseHoldResult>;
  };
  readonly tariffs: {
    createTariffVersion(
      command: AdminEvidence & {
        readonly tariffVersionId: string;
        readonly tariffKey: string;
        readonly version: number;
        readonly displayName: string;
        readonly description: string;
        readonly priceMinor: bigint;
        readonly durationSeconds: number;
        readonly activeFrom: Date;
        readonly activeTo: Date | null;
      },
    ): Promise<ExpertReferralAdminTariff>;
    retireTariffVersion(
      command: AdminEvidence & {
        readonly tariffVersionId: string;
        readonly activeTo: Date;
      },
    ): Promise<void>;
  };
  readonly heldRewards: {
    replayHeldRewardAsAdmin(
      command: AdminEvidence & {
        readonly expertId: string;
        readonly qualifyingOrderId: string;
      },
    ): Promise<AdminHeldRewardReplayResult>;
  };
}

export interface ExpertReferralAbuseHoldResult {
  readonly holdId: string;
  readonly expertId: string;
  readonly status: "open" | "closed";
  readonly version: number;
}

export interface ExpertReferralAdminTariff {
  readonly tariffVersionId: string;
  readonly displayName: string;
  readonly description: string;
  readonly priceMinor: string;
  readonly currency: "RUB";
  readonly durationSeconds: number;
  readonly creditMinor: string;
  readonly cashMinor: string;
}

export type AdminHeldRewardReplayResult =
  | Readonly<{ kind: "still_held" }>
  | Readonly<{ kind: "cancelled_by_refund" }>
  | Readonly<{ kind: "ineligible"; reason: string }>
  | Readonly<{ kind: "terminated_after_grant" }>
  | Readonly<{ kind: "reward_granted"; amountMinor: "100000" }>
  | Readonly<{ kind: "debt_repaid"; amountMinor: string }>;

export class ExpertReferralAdminServiceError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: 400 | 403 | 409,
  ) {
    super(code);
    this.name = "ExpertReferralAdminServiceError";
  }
}

export interface ExpertReferralAdminService {
  issueBatch(
    principal: AdminPrincipal,
    command: ExpertReferralAdminAuthorization & {
      readonly inviterExpertId: string;
      readonly count: number;
      readonly overrideId?: string;
    },
  ): ReturnType<ExpertReferralAdminDependencies["referrals"]["issueBatch"]>;
  revokeCode(
    principal: AdminPrincipal,
    command: ExpertReferralAdminAuthorization & {
      readonly codeId: string;
      readonly reasonCode: string;
    },
  ): ReturnType<ExpertReferralAdminDependencies["referrals"]["revokeCode"]>;
  createIssuanceOverride(
    principal: AdminPrincipal,
    command: ExpertReferralAdminAuthorization & {
      readonly overrideId: string;
      readonly inviterExpertId: string;
      readonly additionalQuota: number;
      readonly reason: string;
      readonly validFrom: Date;
      readonly expiresAt: Date;
      readonly secondApprovalId: string;
      readonly secondNonce: string;
    },
  ): ReturnType<
    ExpertReferralAdminDependencies["overrides"]["createIssuanceOverride"]
  >;
  openAbuseHold(
    principal: AdminPrincipal,
    command: ExpertReferralAdminAuthorization & {
      readonly expertId: string;
      readonly reasonCode: string;
    },
  ): ReturnType<ExpertReferralAdminDependencies["controls"]["openAbuseHold"]>;
  closeAbuseHold(
    principal: AdminPrincipal,
    command: ExpertReferralAdminAuthorization & {
      readonly expertId: string;
      readonly reasonCode: string;
    },
  ): ReturnType<ExpertReferralAdminDependencies["controls"]["closeAbuseHold"]>;
  createTariffVersion(
    principal: AdminPrincipal,
    command: ExpertReferralAdminAuthorization & {
      readonly tariffVersionId: string;
      readonly tariffKey: string;
      readonly version: number;
      readonly displayName: string;
      readonly description: string;
      readonly priceMinor: string;
      readonly durationSeconds: number;
      readonly activeFrom: Date;
      readonly activeTo: Date | null;
    },
  ): ReturnType<
    ExpertReferralAdminDependencies["tariffs"]["createTariffVersion"]
  >;
  retireTariffVersion(
    principal: AdminPrincipal,
    command: ExpertReferralAdminAuthorization & {
      readonly tariffVersionId: string;
      readonly activeTo: Date;
    },
  ): ReturnType<
    ExpertReferralAdminDependencies["tariffs"]["retireTariffVersion"]
  >;
  replayHeldReward(
    principal: AdminPrincipal,
    command: ExpertReferralAdminAuthorization & {
      readonly expertId: string;
      readonly qualifyingOrderId: string;
    },
  ): ReturnType<
    ExpertReferralAdminDependencies["heldRewards"]["replayHeldRewardAsAdmin"]
  >;
  updateFeatureControl(
    principal: AdminPrincipal,
    command: ExpertReferralAdminAuthorization & {
      readonly expectedVersion: number;
      readonly newCommandsEnabled: boolean;
      readonly rewardGrantsEnabled: boolean;
    },
  ): ReturnType<
    ExpertReferralAdminDependencies["controls"]["updateFeatureControl"]
  >;
  maskedInventory(
    principal: AdminPrincipal,
    inviterExpertId: string,
  ): Promise<
    readonly {
      readonly batchId: string;
      readonly status: "issued" | "redeemed" | "revoked";
      readonly maskedSuffix: string;
      readonly createdAt: Date;
    }[]
  >;
}

const fail = (code: string, statusCode: 400 | 403 | 409): never => {
  throw new ExpertReferralAdminServiceError(code, statusCode);
};

const authorize = (principal: AdminPrincipal): void => {
  if (!principal.roles.includes("entitlement_admin")) fail("forbidden", 403);
};

const exactTarget = (routeObjectId: string, objectId: string): void => {
  if (routeObjectId !== objectId) fail("target_mismatch", 400);
};

const evidence = (
  principal: AdminPrincipal,
  command: ExpertReferralAdminAuthorization,
): AdminEvidence => ({
  adminId: principal.id,
  approvalId: command.approvalId,
  sessionIdHash: principal.sessionIdHash,
  nonce: command.nonce,
});

const boundedReason = (reason: string): void => {
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(reason)) fail("invalid_command", 400);
};

const boundedHumanReason = (reason: string): void => {
  if (reason.trim().length === 0 || reason.length > 200) {
    fail("invalid_command", 400);
  }
};

const validDate = (value: Date): boolean =>
  value instanceof Date && Number.isFinite(value.getTime());

export const createExpertReferralAdminService = (
  dependencies: ExpertReferralAdminDependencies,
): ExpertReferralAdminService => ({
  async issueBatch(principal, command) {
    authorize(principal);
    exactTarget(command.routeObjectId, command.inviterExpertId);
    if (
      !Number.isInteger(command.count) ||
      command.count < 1 ||
      command.count > 1000
    ) {
      fail("invalid_command", 400);
    }
    if (!dependencies.environment.read().referralEnabled) {
      fail("feature_disabled", 403);
    }
    try {
      const result = await dependencies.referrals.issueBatch({
        ...evidence(principal, command),
        inviterExpertId: command.inviterExpertId,
        count: command.count,
        ...(command.overrideId === undefined
          ? {}
          : { overrideId: command.overrideId }),
      });
      recordExpertReferralLifecycle({
        module: "expert_referral",
        operation: "batch_lifecycle",
        outcome: "issued",
        errorCode: "none",
      });
      if (result.codes.length > 0) {
        recordExpertReferralLifecycle(
          {
            module: "expert_referral",
            operation: "code_lifecycle",
            outcome: "issued",
            errorCode: "none",
          },
          result.codes.length,
        );
      }
      return result;
    } catch (error) {
      recordExpertReferralLifecycle({
        module: "expert_referral",
        operation: "batch_lifecycle",
        outcome: "failed",
        errorCode: "unknown",
      });
      throw error;
    }
  },

  async revokeCode(principal, command) {
    authorize(principal);
    exactTarget(command.routeObjectId, command.codeId);
    boundedReason(command.reasonCode);
    try {
      const result = await dependencies.referrals.revokeCode({
        ...evidence(principal, command),
        codeId: command.codeId,
        reasonCode: command.reasonCode,
      });
      recordExpertReferralLifecycle({
        module: "expert_referral",
        operation: "code_lifecycle",
        outcome: "revoked",
        errorCode: "none",
      });
      return result;
    } catch (error) {
      recordExpertReferralLifecycle({
        module: "expert_referral",
        operation: "code_lifecycle",
        outcome: "failed",
        errorCode: "unknown",
      });
      throw error;
    }
  },

  async createIssuanceOverride(principal, command) {
    authorize(principal);
    exactTarget(command.routeObjectId, command.overrideId);
    if (
      !Number.isInteger(command.additionalQuota) ||
      command.additionalQuota < 1 ||
      command.additionalQuota > 1000 ||
      !validDate(command.validFrom) ||
      !validDate(command.expiresAt) ||
      command.expiresAt <= command.validFrom ||
      command.approvalId === command.secondApprovalId ||
      command.nonce === command.secondNonce
    ) {
      fail("invalid_command", 400);
    }
    boundedHumanReason(command.reason);
    const created = await dependencies.overrides.createIssuanceOverride({
      ...evidence(principal, command),
      overrideId: command.overrideId,
      inviterExpertId: command.inviterExpertId,
      additionalQuota: command.additionalQuota,
      reason: command.reason,
      validFrom: command.validFrom,
      expiresAt: command.expiresAt,
      nonce: command.nonce,
      secondApprovalId: command.secondApprovalId,
      secondNonce: command.secondNonce,
    });
    return created ?? fail("forbidden", 403);
  },

  async openAbuseHold(principal, command) {
    authorize(principal);
    exactTarget(command.routeObjectId, command.expertId);
    boundedReason(command.reasonCode);
    return dependencies.controls.openAbuseHold({
      ...evidence(principal, command),
      expertId: command.expertId,
      reasonCode: command.reasonCode,
    });
  },

  async closeAbuseHold(principal, command) {
    authorize(principal);
    exactTarget(command.routeObjectId, command.expertId);
    boundedReason(command.reasonCode);
    return dependencies.controls.closeAbuseHold({
      ...evidence(principal, command),
      expertId: command.expertId,
      reasonCode: command.reasonCode,
    });
  },

  async createTariffVersion(principal, command) {
    authorize(principal);
    exactTarget(command.routeObjectId, command.tariffVersionId);
    if (!dependencies.environment.read().residencyBillingEnabled) {
      fail("feature_disabled", 403);
    }
    let priceMinor: bigint;
    try {
      priceMinor = BigInt(command.priceMinor);
    } catch {
      return fail("invalid_command", 400);
    }
    if (
      priceMinor <= 0n ||
      !Number.isSafeInteger(command.version) ||
      command.version < 1 ||
      !Number.isSafeInteger(command.durationSeconds) ||
      command.durationSeconds < 86_400 ||
      command.durationSeconds > 315_360_000 ||
      !validDate(command.activeFrom) ||
      (command.activeTo !== null &&
        (!validDate(command.activeTo) ||
          command.activeTo <= command.activeFrom))
    ) {
      fail("invalid_command", 400);
    }
    return dependencies.tariffs.createTariffVersion({
      ...evidence(principal, command),
      tariffVersionId: command.tariffVersionId,
      tariffKey: command.tariffKey,
      version: command.version,
      displayName: command.displayName,
      description: command.description,
      priceMinor,
      durationSeconds: command.durationSeconds,
      activeFrom: command.activeFrom,
      activeTo: command.activeTo,
    });
  },

  async retireTariffVersion(principal, command) {
    authorize(principal);
    exactTarget(command.routeObjectId, command.tariffVersionId);
    if (!dependencies.environment.read().residencyBillingEnabled) {
      fail("feature_disabled", 403);
    }
    if (!validDate(command.activeTo)) fail("invalid_command", 400);
    return dependencies.tariffs.retireTariffVersion({
      ...evidence(principal, command),
      tariffVersionId: command.tariffVersionId,
      activeTo: command.activeTo,
    });
  },

  async replayHeldReward(principal, command) {
    authorize(principal);
    exactTarget(command.routeObjectId, command.qualifyingOrderId);
    return dependencies.heldRewards.replayHeldRewardAsAdmin({
      ...evidence(principal, command),
      expertId: command.expertId,
      qualifyingOrderId: command.qualifyingOrderId,
    });
  },

  async updateFeatureControl(principal, command) {
    authorize(principal);
    exactTarget(
      command.routeObjectId,
      EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID,
    );
    if (
      !Number.isSafeInteger(command.expectedVersion) ||
      command.expectedVersion < 0
    ) {
      fail("invalid_command", 400);
    }
    const ceilings = dependencies.environment.read();
    if (
      (command.newCommandsEnabled &&
        (!ceilings.referralEnabled || !ceilings.residencyBillingEnabled)) ||
      (command.rewardGrantsEnabled && !ceilings.referralEnabled)
    ) {
      fail("feature_ceiling_conflict", 409);
    }
    return dependencies.controls.updateFeatureControl({
      ...evidence(principal, command),
      expectedVersion: command.expectedVersion,
      newCommandsEnabled: command.newCommandsEnabled,
      rewardGrantsEnabled: command.rewardGrantsEnabled,
    });
  },

  async maskedInventory(principal, inviterExpertId) {
    authorize(principal);
    return (await dependencies.referrals.maskedInventory(inviterExpertId)).map(
      (row) => ({
        batchId: row.batchId,
        status: row.status,
        maskedSuffix: row.maskedSuffix,
        createdAt: row.createdAt,
      }),
    );
  },
});
