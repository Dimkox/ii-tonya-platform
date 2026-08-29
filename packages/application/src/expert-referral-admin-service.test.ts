import { describe, expect, it, vi } from "vitest";
import { createExpertReferralAdminService } from "./expert-referral-admin-service.js";

const principal = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionIdHash: "sha256:requester",
  roles: ["security_admin" as const],
  mfaVerifiedAt: new Date("2026-08-04T10:00:00.000Z"),
};

describe("expert referral admin application boundary", () => {
  it.each([
    ["START", 390000, 0, "basic", "standard"],
    ["BASE", 590000, 1, "expanded", "standard"],
    ["PRO", 999000, 3, "expanded", "priority"],
  ])(
    "accepts exact v2 tariff %s",
    async (
      tariffKey,
      priceMinor,
      groupEventLimit,
      statisticsLevel,
      supportPriority,
    ) => {
      const workflows = {
        execute: vi.fn(async () => ({
          allowed: true as const,
          replayed: false,
          tariffVersionId: "00000000-0000-4000-8000-000000000030",
        })),
        inventory: vi.fn(),
      };
      const service = createExpertReferralAdminService({ workflows });
      await service.execute(principal, {
        action: "expert_residency.tariff_create_v2",
        objectId: "00000000-0000-4000-8000-000000000030",
        approvalId: "00000000-0000-4000-8000-000000000020",
        nonce: "nonce-task3-v2",
        correlationId: "correlation-task3-v2",
        payload: {
          tariffKey,
          displayName: { START: "Старт", BASE: "База", PRO: "Про" }[tariffKey],
          priceMinor,
          durationSeconds: 2592000,
          commercialPolicyVersion: "expert_residency_v2",
          creditCapBps: 3000,
          individualServicesEnabled: true,
          groupEventLimit,
          statisticsLevel,
          supportPriority,
          activeFrom: "2026-09-01T00:00:00.000Z",
          activeTo: "2027-09-01T00:00:00.000Z",
        },
        environmentCeilings: {
          expertReferral: false,
          expertResidencyBilling: true,
        },
      });
      expect(workflows.execute).toHaveBeenCalled();
    },
  );

  it("validates the exact client v2 control payload", async () => {
    const workflows = {
      execute: vi.fn(async () => ({
        allowed: true as const,
        replayed: false,
        version: 1,
        admissionPolicy: "free_client_v2",
      })),
      inventory: vi.fn(),
    };
    const service = createExpertReferralAdminService({ workflows });
    await service.execute(principal, {
      action: "client_commercial_policy.control_v2",
      objectId: "00000000-0000-0000-0000-000000000041",
      approvalId: "00000000-0000-4000-8000-000000000020",
      nonce: "nonce-task3-control",
      correlationId: "correlation-task3-control",
      payload: { expectedVersion: 0, admissionPolicy: "free_client_v2" },
      environmentCeilings: {
        expertReferral: false,
        expertResidencyBilling: false,
      },
    });
    await expect(
      service.execute(principal, {
        action: "client_commercial_policy.control_v2",
        objectId: "00000000-0000-0000-0000-000000000041",
        approvalId: "00000000-0000-4000-8000-000000000020",
        nonce: "nonce-task3-control",
        correlationId: "correlation-task3-control",
        payload: {
          expectedVersion: 0,
          admissionPolicy: "free_client_v2",
          unknown: true,
        },
        environmentCeilings: {
          expertReferral: false,
          expertResidencyBilling: false,
        },
      }),
    ).rejects.toThrow("invalid_admin_command");
  });
  it("rejects a referral batch above the 1000-code limit before persistence", async () => {
    const workflows = { execute: vi.fn(), inventory: vi.fn() };
    const service = createExpertReferralAdminService({ workflows });
    await expect(
      service.execute(principal, {
        action: "expert_referral.batch_generate",
        objectId: "00000000-0000-4000-8000-000000000010",
        approvalId: "00000000-0000-4000-8000-000000000020",
        nonce: "nonce-task9-0001",
        correlationId: "correlation-task9-0001",
        payload: { count: 1001 },
        environmentCeilings: {
          expertReferral: true,
          expertResidencyBilling: false,
        },
      }),
    ).rejects.toThrow("invalid_admin_command");
    expect(workflows.execute).not.toHaveBeenCalled();
  });

  it("forwards a bounded feature switch with the authenticated session and ceilings", async () => {
    const workflows = {
      execute: vi.fn(async () => ({
        allowed: true as const,
        replayed: false,
        version: 3,
      })),
      inventory: vi.fn(),
    };
    const service = createExpertReferralAdminService({ workflows });
    await service.execute(principal, {
      action: "expert_referral.feature_switch",
      objectId: "00000000-0000-0000-0000-000000000041",
      approvalId: "00000000-0000-4000-8000-000000000020",
      nonce: "nonce-task9-0002",
      correlationId: "correlation-task9-0002",
      payload: {
        expectedVersion: 2,
        newCommandsEnabled: false,
        rewardGrantsEnabled: false,
      },
      environmentCeilings: {
        expertReferral: false,
        expertResidencyBilling: false,
      },
    });
    expect(workflows.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionIdHash: principal.sessionIdHash,
        expectedVersion: 2,
      }),
    );
  });

  it("exposes only the masked batch inventory projection", async () => {
    const workflows = {
      execute: vi.fn(),
      inventory: vi.fn(async () => [
        {
          batchId: "batch",
          status: "issued",
          maskedSuffix: "A1B2",
          createdAt: new Date("2026-08-04T10:00:00Z"),
        },
      ]),
    };
    const service = createExpertReferralAdminService({ workflows });
    expect(
      await service.inventory(
        principal,
        "00000000-0000-4000-8000-000000000010",
      ),
    ).toEqual([
      {
        batchId: "batch",
        status: "issued",
        maskedSuffix: "A1B2",
        createdAt: new Date("2026-08-04T10:00:00Z"),
      },
    ]);
  });

  it("never enables either durable switch above the environment ceilings", async () => {
    const workflows = { execute: vi.fn(), inventory: vi.fn() };
    const service = createExpertReferralAdminService({ workflows });
    await expect(
      service.execute(principal, {
        action: "expert_referral.feature_switch",
        objectId: "00000000-0000-0000-0000-000000000041",
        approvalId: "00000000-0000-4000-8000-000000000020",
        nonce: "nonce-task9-0004",
        correlationId: "correlation-task9-0004",
        payload: {
          expectedVersion: 0,
          newCommandsEnabled: true,
          rewardGrantsEnabled: false,
        },
        environmentCeilings: {
          expertReferral: false,
          expertResidencyBilling: false,
        },
      }),
    ).rejects.toThrow("invalid_admin_command");
    expect(workflows.execute).not.toHaveBeenCalled();
  });

  it("rejects noncanonical embedded UUIDs and reversed canonical instants before persistence", async () => {
    const workflows = { execute: vi.fn(), inventory: vi.fn() };
    const service = createExpertReferralAdminService({ workflows });
    await expect(
      service.execute(principal, {
        action: "expert_referral.issuance_override",
        objectId: "00000000-0000-4000-8000-000000000030",
        approvalId: "00000000-0000-4000-8000-000000000020",
        secondApprovalId: "00000000-0000-4000-8000-000000000021",
        nonce: "nonce-task9-strict",
        secondNonce: "nonce-task9-strict-2",
        correlationId: "correlation-task9-strict",
        payload: {
          overrideId: "00000000-0000-4000-8000-000000000030",
          inviterExpertId: "00000000-0000-4000-8000-0000000000AA",
          requesterId: principal.id,
          requesterSessionIdHash: principal.sessionIdHash,
          additionalQuota: 1,
          reasonCode: "approved",
          validFrom: "2026-08-04T10:00:00.000Z",
          validUntil: "2026-08-04T09:00:00.000Z",
        },
        environmentCeilings: {
          expertReferral: true,
          expertResidencyBilling: true,
        },
      }),
    ).rejects.toThrow("invalid_admin_command");
    expect(workflows.execute).not.toHaveBeenCalled();
  });

  it("rejects dual-control fields on non-override commands", async () => {
    const workflows = { execute: vi.fn(), inventory: vi.fn() };
    const service = createExpertReferralAdminService({ workflows });
    await expect(
      service.execute(principal, {
        action: "expert_referral.batch_generate",
        objectId: "00000000-0000-4000-8000-000000000010",
        approvalId: "00000000-0000-4000-8000-000000000020",
        secondApprovalId: "00000000-0000-4000-8000-000000000021",
        nonce: "nonce-task9-dual",
        secondNonce: "nonce-task9-dual-2",
        correlationId: "correlation-task9-dual",
        payload: {
          inviterExpertId: "00000000-0000-4000-8000-000000000010",
          count: 1,
        },
        environmentCeilings: {
          expertReferral: true,
          expertResidencyBilling: true,
        },
      }),
    ).rejects.toThrow("invalid_admin_command");
    expect(workflows.execute).not.toHaveBeenCalled();
  });

  it("rejects the feature-control sentinel for every non-feature action", async () => {
    const workflows = { execute: vi.fn(), inventory: vi.fn() };
    const service = createExpertReferralAdminService({ workflows });
    await expect(
      service.execute(principal, {
        action: "expert_referral.batch_generate",
        objectId: "00000000-0000-0000-0000-000000000041",
        approvalId: "00000000-0000-4000-8000-000000000020",
        nonce: "nonce-task9-sentinel",
        correlationId: "correlation-task9-sentinel",
        payload: {
          inviterExpertId: "00000000-0000-0000-0000-000000000041",
          count: 1,
        },
        environmentCeilings: {
          expertReferral: true,
          expertResidencyBilling: true,
        },
      }),
    ).rejects.toThrow("invalid_admin_command");
    expect(workflows.execute).not.toHaveBeenCalled();
  });
});
