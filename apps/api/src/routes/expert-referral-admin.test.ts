import { describe, expect, it } from "vitest";
import {
  EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID,
  ExpertReferralAdminServiceError,
  type AdminPrincipal,
  type ExpertReferralAdminService,
} from "@ii-tonya/application";
import type { AdminPayload } from "@ii-tonya/db";
import {
  EXPERT_REFERRAL_ADMIN_LOG_REDACT_PATHS,
  buildExpertReferralAdminApi,
} from "./expert-referral-admin.js";
import { hashAdminSessionToken } from "./admin.js";

const token = "t".repeat(32);
const requester: AdminPrincipal = {
  id: "00000000-0000-4000-8000-000000000921",
  sessionIdHash: hashAdminSessionToken(token),
  roles: ["entitlement_admin"],
  mfaVerifiedAt: new Date("2026-08-03T00:00:00.000Z"),
};
const inviterId = "00000000-0000-4000-8000-000000000922";
const approvalId = "00000000-0000-4000-8000-000000000923";
const codeId = "00000000-0000-4000-8000-000000000926";
const overrideId = "00000000-0000-4000-8000-000000000927";
const expertId = "00000000-0000-4000-8000-000000000928";
const tariffId = "00000000-0000-4000-8000-000000000929";
const orderId = "00000000-0000-4000-8000-000000000930";
const secondApprovalId = "00000000-0000-4000-8000-000000000931";
const requestNonce = "nonce:expert-referral-request";

function fixture() {
  const requested: Array<{
    sessionIdHash: string;
    action: string;
    objectType: string;
    objectId: string;
    payload: AdminPayload;
    nonce: string;
  }> = [];
  const executed: Array<{
    method: string;
    principal: AdminPrincipal;
    command: Readonly<Record<string, unknown>>;
  }> = [];
  const failures = new Map<string, unknown>();
  let approved = false;
  const admin = new Proxy(
    {
      async issueBatch() {
        return {
          batchId: "00000000-0000-4000-8000-000000000924",
          inviterExpertId: inviterId,
          codes: [
            {
              codeId: "00000000-0000-4000-8000-000000000925",
              plaintext: "EXPERT-ONE-TIME-PLAINTEXT",
              maskedSuffix: "…TEXT",
            },
          ],
        };
      },
      async maskedInventory() {
        return [
          {
            batchId: "00000000-0000-4000-8000-000000000924",
            status: "issued" as const,
            maskedSuffix: "…TEXT",
            createdAt: new Date("2026-08-03T00:00:00.000Z"),
          },
        ];
      },
    },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return async (
          principal: AdminPrincipal,
          command: Readonly<Record<string, unknown>>,
        ) => {
          const method = String(property);
          const failure = failures.get(method);
          if (failure !== undefined) throw failure;
          executed.push({ method, principal, command });
          return { allowed: true };
        };
      },
    },
  ) as unknown as ExpertReferralAdminService;
  return {
    requested,
    executed,
    fail(method: string, error: unknown) {
      failures.set(method, error);
    },
    setApproved(value: boolean) {
      approved = value;
    },
    deps: {
      approvals: {
        async resolvePrincipal(sessionIdHash: string) {
          return sessionIdHash === requester.sessionIdHash ? requester : null;
        },
        async requestApproval(input: {
          sessionIdHash: string;
          action: string;
          objectType: string;
          objectId: string;
          payload: AdminPayload;
          nonce: string;
        }) {
          requested.push({
            sessionIdHash: input.sessionIdHash,
            action: input.action,
            objectType: input.objectType,
            objectId: input.objectId,
            payload: input.payload,
            nonce: input.nonce,
          });
          return {
            approvalId,
            expiresAt: new Date("2026-08-03T00:05:00.000Z"),
          };
        },
        async approveApproval() {
          return approved;
        },
      },
      admin,
    },
  };
}

const validFrom = "2026-08-03T00:00:00.000Z";
const expiresAt = "2026-08-04T00:00:00.000Z";
const activeTo = "2026-09-03T00:00:00.000Z";
const nonBatchCases = [
  {
    action: "expert_referral.code_revoke",
    objectType: "expert_referral_code",
    objectId: codeId,
    requestCommand: { reasonCode: "security_review" },
    executionCommand: { reasonCode: "security_review" },
    canonicalPayload: { reasonCode: "security_review" },
    method: "revokeCode",
    serviceCommand: {
      routeObjectId: codeId,
      approvalId,
      nonce: requestNonce,
      codeId,
      reasonCode: "security_review",
    },
  },
  {
    action: "expert_referral.issuance_override",
    objectType: "expert",
    objectId: overrideId,
    requestCommand: {
      inviterExpertId: inviterId,
      additionalQuota: 25,
      reason: "Temporary campaign exception",
      validFrom,
      expiresAt,
    },
    executionCommand: {
      inviterExpertId: inviterId,
      additionalQuota: 25,
      reason: "Temporary campaign exception",
      validFrom,
      expiresAt,
      secondApprovalId,
      secondNonce: "nonce:expert-referral-second",
    },
    canonicalPayload: {
      inviterExpertId: inviterId,
      additionalQuota: 25,
      reason: "Temporary campaign exception",
      validFrom,
      expiresAt,
    },
    method: "createIssuanceOverride",
    serviceCommand: {
      routeObjectId: overrideId,
      approvalId,
      nonce: requestNonce,
      overrideId,
      inviterExpertId: inviterId,
      additionalQuota: 25,
      reason: "Temporary campaign exception",
      validFrom: new Date(validFrom),
      expiresAt: new Date(expiresAt),
      secondApprovalId,
      secondNonce: "nonce:expert-referral-second",
    },
  },
  {
    action: "expert_referral.abuse_hold_open",
    objectType: "expert",
    objectId: expertId,
    requestCommand: { reasonCode: "identity_review" },
    executionCommand: { reasonCode: "identity_review" },
    canonicalPayload: { reasonCode: "identity_review" },
    method: "openAbuseHold",
    serviceCommand: {
      routeObjectId: expertId,
      approvalId,
      nonce: requestNonce,
      expertId,
      reasonCode: "identity_review",
    },
  },
  {
    action: "expert_referral.abuse_hold_close",
    objectType: "expert",
    objectId: expertId,
    requestCommand: { reasonCode: "review_complete" },
    executionCommand: { reasonCode: "review_complete" },
    canonicalPayload: { reasonCode: "review_complete" },
    method: "closeAbuseHold",
    serviceCommand: {
      routeObjectId: expertId,
      approvalId,
      nonce: requestNonce,
      expertId,
      reasonCode: "review_complete",
    },
  },
  {
    action: "expert_residency.tariff_create",
    objectType: "expert",
    objectId: tariffId,
    requestCommand: {
      tariffKey: "residency-month",
      version: 2,
      displayName: "Monthly residency",
      description: "Thirty-day residency",
      priceMinor: "250001",
      durationSeconds: 2_592_000,
      activeFrom: validFrom,
      activeTo: null,
    },
    executionCommand: {
      tariffKey: "residency-month",
      version: 2,
      displayName: "Monthly residency",
      description: "Thirty-day residency",
      priceMinor: "250001",
      durationSeconds: 2_592_000,
      activeFrom: validFrom,
      activeTo: null,
    },
    canonicalPayload: {
      tariffKey: "residency-month",
      version: 2,
      displayName: "Monthly residency",
      description: "Thirty-day residency",
      priceMinor: "250001",
      durationSeconds: 2_592_000,
      activeFrom: validFrom,
      activeTo: null,
    },
    method: "createTariffVersion",
    serviceCommand: {
      routeObjectId: tariffId,
      approvalId,
      nonce: requestNonce,
      tariffVersionId: tariffId,
      tariffKey: "residency-month",
      version: 2,
      displayName: "Monthly residency",
      description: "Thirty-day residency",
      priceMinor: "250001",
      durationSeconds: 2_592_000,
      activeFrom: new Date(validFrom),
      activeTo: null,
    },
  },
  {
    action: "expert_residency.tariff_retire",
    objectType: "expert",
    objectId: tariffId,
    requestCommand: { activeTo },
    executionCommand: { activeTo },
    canonicalPayload: { activeTo },
    method: "retireTariffVersion",
    serviceCommand: {
      routeObjectId: tariffId,
      approvalId,
      nonce: requestNonce,
      tariffVersionId: tariffId,
      activeTo: new Date(activeTo),
    },
  },
  {
    action: "expert_referral.hold_replay",
    objectType: "expert_residency_order",
    objectId: orderId,
    requestCommand: { expertId },
    executionCommand: { expertId },
    canonicalPayload: { expertId },
    method: "replayHeldReward",
    serviceCommand: {
      routeObjectId: orderId,
      approvalId,
      nonce: requestNonce,
      expertId,
      qualifyingOrderId: orderId,
    },
  },
  {
    action: "expert_referral.feature_switch",
    objectType: "expert_referral_feature_control",
    objectId: EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID,
    requestCommand: {
      expectedVersion: 3,
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    },
    executionCommand: {
      expectedVersion: 3,
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    },
    canonicalPayload: {
      expectedVersion: 3,
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    },
    method: "updateFeatureControl",
    serviceCommand: {
      routeObjectId: EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID,
      approvalId,
      nonce: requestNonce,
      expectedVersion: 3,
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    },
  },
] as const;

describe("expert referral admin routes", () => {
  it.each([0, 1001])(
    "rejects batch count %i before requesting approval",
    async (count) => {
      const context = fixture();
      const app = await buildExpertReferralAdminApi(context.deps);
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/expert-referrals/actions/expert_referral.batch_generate/${inviterId}/approvals`,
        headers: { authorization: `Bearer ${token}` },
        payload: { nonce: "nonce:expert-referral-request", command: { count } },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_command" });
      expect(context.requested).toEqual([]);
      await app.close();
    },
  );

  it("binds approval requests to the exact action, object, and canonical payload", async () => {
    const context = fixture();
    const app = await buildExpertReferralAdminApi(context.deps);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/expert-referrals/actions/expert_referral.batch_generate/${inviterId}/approvals`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        nonce: "nonce:expert-referral-request",
        command: { count: 2 },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(context.requested).toEqual([
      {
        sessionIdHash: requester.sessionIdHash,
        action: "expert_referral.batch_generate",
        objectType: "expert",
        objectId: inviterId,
        payload: { count: 2, overrideId: null },
        nonce: requestNonce,
      },
    ]);
    await app.close();
  });

  it.each(nonBatchCases)(
    "binds and dispatches $action with its exact canonical command",
    async (entry) => {
      const context = fixture();
      const app = await buildExpertReferralAdminApi(context.deps);
      const approval = await app.inject({
        method: "POST",
        url: `/v1/admin/expert-referrals/actions/${entry.action}/${entry.objectId}/approvals`,
        headers: { authorization: `Bearer ${token}` },
        payload: { nonce: requestNonce, command: entry.requestCommand },
      });

      expect(approval.statusCode).toBe(201);
      expect(context.requested).toEqual([
        {
          sessionIdHash: requester.sessionIdHash,
          action: entry.action,
          objectType: entry.objectType,
          objectId: entry.objectId,
          payload: entry.canonicalPayload,
          nonce: requestNonce,
        },
      ]);

      const execution = await app.inject({
        method: "POST",
        url: `/v1/admin/expert-referrals/actions/${entry.action}/${entry.objectId}/execute`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          approvalId,
          nonce: requestNonce,
          command: entry.executionCommand,
        },
      });

      expect(execution.statusCode).toBe(200);
      expect(context.executed).toEqual([
        {
          method: entry.method,
          principal: requester,
          command: entry.serviceCommand,
        },
      ]);
      await app.close();
    },
  );

  it("rejects normalized impossible ISO dates before requesting approval", async () => {
    const context = fixture();
    const app = await buildExpertReferralAdminApi(context.deps);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/expert-referrals/actions/expert_residency.tariff_create/${tariffId}/approvals`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        nonce: requestNonce,
        command: {
          tariffKey: "residency-month",
          version: 1,
          displayName: "Monthly residency",
          description: "Thirty-day residency",
          priceMinor: "250001",
          durationSeconds: 2_592_000,
          activeFrom: "2026-02-30T00:00:00.000Z",
          activeTo: null,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_command" });
    expect(context.requested).toEqual([]);
    await app.close();
  });

  it.each([
    {
      error: new ExpertReferralAdminServiceError("target_mismatch", 400),
      expectedStatus: 400,
      expectedBody: { error: "target_mismatch" },
    },
    {
      error: Object.assign(new Error("private approval detail"), {
        code: "admin_evidence_invalid",
      }),
      expectedStatus: 403,
      expectedBody: { error: "forbidden" },
    },
    {
      error: new Error("private database relation detail"),
      expectedStatus: 409,
      expectedBody: { error: "operation_denied" },
    },
  ])(
    "maps a non-batch execution failure to $expectedStatus without enumeration",
    async ({ error, expectedStatus, expectedBody }) => {
      const context = fixture();
      context.fail("revokeCode", error);
      const app = await buildExpertReferralAdminApi(context.deps);
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/expert-referrals/actions/expert_referral.code_revoke/${codeId}/execute`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          approvalId,
          nonce: requestNonce,
          command: { reasonCode: "security_review" },
        },
      });

      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json()).toEqual(expectedBody);
      expect(response.body).not.toContain("private");
      await app.close();
    },
  );

  it("returns one-time batch plaintext while masked inventory cannot disclose it", async () => {
    const context = fixture();
    const app = await buildExpertReferralAdminApi(context.deps);
    const issued = await app.inject({
      method: "POST",
      url: `/v1/admin/expert-referrals/actions/expert_referral.batch_generate/${inviterId}/execute`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        approvalId,
        nonce: requestNonce,
        command: { count: 1 },
      },
    });
    expect(issued.statusCode).toBe(200);
    expect(issued.json()).toEqual({
      batchId: "00000000-0000-4000-8000-000000000924",
      codes: ["EXPERT-ONE-TIME-PLAINTEXT"],
    });

    const inventory = await app.inject({
      method: "GET",
      url: `/v1/admin/expert-referrals/inviters/${inviterId}/inventory`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(inventory.statusCode).toBe(200);
    expect(inventory.json()).toEqual([
      {
        batchId: "00000000-0000-4000-8000-000000000924",
        status: "issued",
        maskedSuffix: "…TEXT",
        createdAt: "2026-08-03T00:00:00.000Z",
      },
    ]);
    expect(inventory.body).not.toContain("EXPERT-ONE-TIME-PLAINTEXT");
    await app.close();
  });

  it("denies self or duplicate approval attempts without revealing state", async () => {
    const context = fixture();
    const app = await buildExpertReferralAdminApi(context.deps);
    const request = () =>
      app.inject({
        method: "POST",
        url: `/v1/admin/expert-referrals/approvals/${approvalId}/approve`,
        headers: { authorization: `Bearer ${token}` },
      });

    expect((await request()).statusCode).toBe(403);
    context.setApproved(true);
    expect((await request()).statusCode).toBe(204);
    context.setApproved(false);
    expect((await request()).json()).toEqual({ error: "forbidden" });
    await app.close();
  });

  it("rate limits operations and declares authorization and body redaction", async () => {
    const context = fixture();
    const app = await buildExpertReferralAdminApi({
      ...context.deps,
      rateLimitMax: 1,
    });
    const request = () =>
      app.inject({
        method: "GET",
        url: `/v1/admin/expert-referrals/inviters/${inviterId}/inventory`,
        headers: { authorization: `Bearer ${token}` },
      });

    expect((await request()).statusCode).toBe(200);
    expect((await request()).statusCode).toBe(429);
    expect(EXPERT_REFERRAL_ADMIN_LOG_REDACT_PATHS).toContain(
      "req.headers.authorization",
    );
    expect(EXPERT_REFERRAL_ADMIN_LOG_REDACT_PATHS).toContain("body");
    await app.close();
  });
});
