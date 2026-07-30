import { describe, expect, it, vi } from "vitest";
import { authorizeAdminAction } from "./admin.js";
import { fakeApprovalRepository } from "./admin.testkit.js";

describe("admin authorization boundary", () => {
  it.each(["package.grant", "feedback.read", "safety.read"] as const)("fails closed for unregistered %s paths", async (action) => {
    const audit = { append: vi.fn() };
    const approvals = fakeApprovalRepository({ case: "valid" });
    await expect(authorizeAdminAction({
      principal: { id: "admin-1", sessionIdHash: "session-hash-1", roles: ["entitlement_admin", "support", "security_admin"], mfaVerifiedAt: new Date("2026-07-28T09:59:00.000Z") },
      action,
      routeObjectId: "object-1",
      commandObjectId: "object-1",
      approvalId: "approval-valid",
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: `unregistered-${action}`,
    }, approvals, audit)).resolves.toBe("deny");
    expect(approvals.consumeIfValid).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: `${action}.denied`,
      decision: "denied",
      reasonCode: "route_unregistered",
    }));
  });
});
