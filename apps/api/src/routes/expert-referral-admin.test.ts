import { describe, expect, it } from "vitest";
import type {
  AdminPrincipal,
  ExpertReferralAdminService,
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

function fixture() {
  const requested: Array<{
    action: string;
    objectId: string;
    payload: AdminPayload;
  }> = [];
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
        return async () => ({ allowed: true });
      },
    },
  ) as unknown as ExpertReferralAdminService;
  return {
    requested,
    setApproved(value: boolean) {
      approved = value;
    },
    deps: {
      approvals: {
        async resolvePrincipal(sessionIdHash: string) {
          return sessionIdHash === requester.sessionIdHash ? requester : null;
        },
        async requestApproval(input: {
          action: string;
          objectId: string;
          payload: AdminPayload;
        }) {
          requested.push({
            action: input.action,
            objectId: input.objectId,
            payload: input.payload,
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
        action: "expert_referral.batch_generate",
        objectId: inviterId,
        payload: { count: 2, overrideId: null },
      },
    ]);
    await app.close();
  });

  it("returns one-time batch plaintext while masked inventory cannot disclose it", async () => {
    const context = fixture();
    const app = await buildExpertReferralAdminApi(context.deps);
    const issued = await app.inject({
      method: "POST",
      url: `/v1/admin/expert-referrals/actions/expert_referral.batch_generate/${inviterId}/execute`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        approvalId,
        nonce: "nonce:expert-referral-request",
        correlationId: "correlation:expert-referral-request",
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
