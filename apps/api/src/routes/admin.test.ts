import { describe, expect, it, vi } from "vitest";
import { authorizeAdminAction } from "./admin.js";
import { fakeApprovalRepository } from "./admin.testkit.js";

describe("admin authorization", () => {
  it("requires recent MFA and object-scoped role for an entitlement grant", async () => {
    const audit = { append: vi.fn() };
    await expect(authorizeAdminAction({ principal: { id: "admin-1", sessionIdHash: "session-hash-1", roles: ["support"], mfaVerifiedAt: new Date("2026-07-28T09:00:00.000Z") }, action: "package.grant", routeObjectId: "u-2", commandObjectId: "u-2", now: new Date("2026-07-28T10:00:00.000Z"), correlationId: "admin-1" }, fakeApprovalRepository(), audit)).resolves.toBe("deny");
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: "package.grant.denied", reasonCode: "role_or_mfa" }));
  });

  it.each([["forged", "approval_not_found"], ["stale", "approval_expired"], ["cross_object", "approval_binding"], ["same_actor", "dual_control"]] as const)("rejects invalid server-resolved approval: %s", async (approvalCase, reasonCode) => {
    const audit = { append: vi.fn() };
    await expect(authorizeAdminAction({ principal: { id: "admin-1", sessionIdHash: "session-hash-1", roles: ["entitlement_admin"], mfaVerifiedAt: new Date("2026-07-28T09:55:00.000Z") }, action: "package.grant", routeObjectId: "u-2", commandObjectId: "u-2", approvalId: `approval-${approvalCase}`, now: new Date("2026-07-28T10:00:00.000Z"), correlationId: "admin-2" }, fakeApprovalRepository({ case: approvalCase }), audit)).resolves.toBe("deny");
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ actorId: "admin-1", objectType: "user", objectId: "u-2", decision: "denied", reasonCode, occurredAt: new Date("2026-07-28T10:00:00.000Z") }));
  });

  it("consumes one fresh distinct bound approval and records a complete allow audit", async () => {
    const audit = { append: vi.fn() };
    const approvals = fakeApprovalRepository({ case: "valid" });
    await expect(authorizeAdminAction({ principal: { id: "admin-requester", sessionIdHash: "session-hash-valid", roles: ["entitlement_admin"], mfaVerifiedAt: new Date("2026-07-28T09:55:00.000Z") }, action: "package.grant", routeObjectId: "u-2", commandObjectId: "u-2", approvalId: "approval-valid", now: new Date("2026-07-28T10:00:00.000Z"), correlationId: "admin-valid" }, approvals, audit)).resolves.toBe("allow");
    expect(approvals.consumeIfValid).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ actorId: "admin-requester", action: "package.grant.allowed", objectId: "u-2", decision: "allowed" }));
  });

  it("fails closed when route and command targets differ", async () => {
    const audit = { append: vi.fn() };
    await expect(authorizeAdminAction({ principal: { id: "admin-1", sessionIdHash: "s", roles: ["entitlement_admin"], mfaVerifiedAt: new Date("2026-07-28T09:59:00.000Z") }, action: "package.grant", routeObjectId: "u-1", commandObjectId: "u-2", approvalId: "approval-valid", now: new Date("2026-07-28T10:00:00.000Z"), correlationId: "c" }, fakeApprovalRepository({ case: "valid" }), audit)).resolves.toBe("deny");
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: "object_mismatch" }));
  });
});
