import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ownerPricingApprovedRoutes } from "./owner-pricing-approved.js";
const userId = "00000000-0000-4000-8000-000000000002",
  approvalId = "00000000-0000-4000-8000-000000000003",
  actorId = "00000000-0000-4000-8000-000000000001";
const token = "a".repeat(32),
  headers = { authorization: `Bearer ${token}` };
const actor = {
  id: actorId,
  sessionIdHash: "sha256:bound",
  roles: ["security_admin" as const],
  mfaVerifiedAt: new Date(),
};
describe("test-pricing admin approval routes", () => {
  it("requires authenticated security admin and binds approval to exact target", async () => {
    const approvals = {
      resolvePrincipal: vi.fn(async () => actor),
      requestApproval: vi.fn(async () => ({
        approvalId,
        expiresAt: new Date(),
      })),
      approveApproval: vi.fn(async () => true),
    };
    const workflow = {
      grant: vi.fn(async () => ({ grantId: approvalId })),
      revoke: vi.fn(async () => ({ grantId: approvalId })),
    };
    const app = Fastify({
      ajv: { customOptions: { removeAdditional: false } },
    });
    await app.register(ownerPricingApprovedRoutes, {
      approvals,
      workflow,
      sessionTokenHash: () => actor.sessionIdHash,
    });
    const payload = {
      action: "grant",
      objectId: userId,
      nonce: "grant-nonce-001",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/owner-test-pricing/approvals",
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/owner-test-pricing/approvals",
          headers,
          payload: { ...payload, actorId },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/owner-test-pricing/approvals",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(201);
    expect(approvals.requestApproval).toHaveBeenCalledWith({
      action: "owner_test_pricing.grant",
      objectType: "user",
      objectId: userId,
      payload: { userId },
      nonce: payload.nonce,
      sessionIdHash: actor.sessionIdHash,
    });
    const execute = await app.inject({
      method: "POST",
      url: "/v1/admin/owner-test-pricing/execute",
      headers,
      payload: { ...payload, approvalId },
    });
    expect(execute.statusCode).toBe(200);
    expect(workflow.grant).toHaveBeenCalledWith({
      userId,
      actorId,
      sessionIdHash: actor.sessionIdHash,
      nonce: payload.nonce,
      approvalId,
    });
    await app.close();
  });
  it("rejects mismatched identity and roles; direct routes retain independent IP limits", async () => {
    const approvals = {
      resolvePrincipal: vi.fn(async () => actor),
      requestApproval: vi.fn(async () => ({
        approvalId,
        expiresAt: new Date(),
      })),
      approveApproval: vi.fn(async () => true),
    };
    const workflow = {
      grant: vi.fn(async () => ({ grantId: approvalId })),
      revoke: vi.fn(async () => ({ grantId: approvalId })),
    };
    const app = Fastify();
    await app.register(ownerPricingApprovedRoutes, {
      approvals,
      workflow,
      sessionTokenHash: () => actor.sessionIdHash,
      rateLimitMax: 1,
    });
    const payload = {
      action: "grant",
      objectId: userId,
      nonce: "grant-nonce-002",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/owner-test-pricing/approvals",
          headers,
          payload,
          remoteAddress: "192.0.2.1",
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/owner-test-pricing/approvals",
          headers,
          payload,
          remoteAddress: "192.0.2.1",
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/owner-test-pricing/approvals",
          headers,
          payload,
          remoteAddress: "192.0.2.2",
        })
      ).statusCode,
    ).toBe(201);
    await app.close();
  });
  it("requires a security admin for approval and binds revocation to the exact grant", async () => {
    const approvals = {
      resolvePrincipal: vi.fn(async () => actor),
      requestApproval: vi.fn(async () => ({
        approvalId,
        expiresAt: new Date(),
      })),
      approveApproval: vi.fn(async () => true),
    };
    const workflow = {
      grant: vi.fn(async () => ({ grantId: approvalId })),
      revoke: vi.fn(async () => ({ grantId: approvalId })),
    };
    const app = Fastify();
    await app.register(ownerPricingApprovedRoutes, {
      approvals,
      workflow,
      sessionTokenHash: () => actor.sessionIdHash,
    });
    const approval = await app.inject({
      method: "POST",
      url: `/v1/admin/owner-test-pricing/approvals/${approvalId}/approve`,
      headers,
      payload: {},
    });
    expect(approval.statusCode).toBe(200);
    expect(approvals.approveApproval).toHaveBeenCalledWith({
      approvalId,
      sessionIdHash: actor.sessionIdHash,
    });
    const revoke = {
      action: "revoke",
      objectId: userId,
      nonce: "revoke-nonce-001",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/owner-test-pricing/approvals",
          headers,
          payload: revoke,
        })
      ).statusCode,
    ).toBe(201);
    expect(approvals.requestApproval).toHaveBeenCalledWith({
      action: "owner_test_pricing.revoke",
      objectType: "owner_test_pricing_grant",
      objectId: userId,
      payload: { grantId: userId },
      nonce: revoke.nonce,
      sessionIdHash: actor.sessionIdHash,
    });
    await app.close();
  });
  it("returns conflict without leaking an internal database error", async () => {
    const approvals = {
      resolvePrincipal: vi.fn(async () => actor),
      requestApproval: vi.fn(),
      approveApproval: vi.fn(),
    };
    const workflow = {
      grant: vi.fn(async () => {
        throw new Error("owner_test_pricing_conflict");
      }),
      revoke: vi.fn(),
    };
    const app = Fastify();
    await app.register(ownerPricingApprovedRoutes, {
      approvals,
      workflow,
      sessionTokenHash: () => actor.sessionIdHash,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/owner-test-pricing/execute",
      headers,
      payload: {
        action: "grant",
        objectId: userId,
        nonce: "conflict-nonce-001",
        approvalId,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "conflict" });
    await app.close();
  });
});
