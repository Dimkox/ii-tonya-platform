import { describe, expect, it, vi } from "vitest";
import { createAdminService, type AdminPrincipal, type AdminWorkflowPort } from "./admin-service.js";

const principal: AdminPrincipal = {
  id: "server-resolved-only",
  sessionIdHash: "session-hash",
  roles: ["entitlement_admin"],
  mfaVerifiedAt: new Date(0),
};

const workflows = (): AdminWorkflowPort => ({
  createClient: vi.fn(),
  deactivateClient: vi.fn(),
  grantPackage: vi.fn(),
  grantIntroPackage: vi.fn(),
  revokePackage: vi.fn(),
  verifyExpert: vi.fn(),
  suspendExpert: vi.fn(),
  activateService: vi.fn(),
  deactivateService: vi.fn(),
  resolveIntegrationError: vi.fn(),
  acknowledgeSafetyAlert: vi.fn(),
  resolveSafetyAlert: vi.fn(),
  acknowledgeNegativeFeedback: vi.fn(),
  resolveNegativeFeedback: vi.fn(),
});

const auth = {
  routeObjectId: "00000000-0000-4000-8000-000000000001",
  approvalId: "00000000-0000-4000-8000-000000000002",
  nonce: "nonce-1",
  correlationId: "corr-1",
};

describe("admin application command boundary", () => {
  it("dispatches every operation to an exact workflow method using only the session hash", async () => {
    const port = workflows();
    const service = createAdminService({ workflows: port });
    await service.createClient(principal, { ...auth, userId: auth.routeObjectId });
    await service.deactivateClient(principal, { ...auth, userId: auth.routeObjectId });
    await service.grantPackage(principal, { ...auth, userId: auth.routeObjectId, units: 500, idempotencyKey: "grant-1" });
    await service.grantIntroPackage(principal, { ...auth, userId: auth.routeObjectId, units: 100, idempotencyKey: "intro-1" });
    await service.revokePackage(principal, { ...auth, userId: auth.routeObjectId, packageId: "00000000-0000-4000-8000-000000000003", idempotencyKey: "revoke-1" });
    await service.updateExpertVerification(principal, { ...auth, expertId: auth.routeObjectId, verified: true });
    await service.updateExpertVerification(principal, { ...auth, expertId: auth.routeObjectId, verified: false });
    await service.updateService(principal, { ...auth, serviceId: auth.routeObjectId, active: true });
    await service.updateService(principal, { ...auth, serviceId: auth.routeObjectId, active: false });
    await service.resolveIntegrationError(principal, { ...auth, errorId: auth.routeObjectId });
    await service.resolveAlert(principal, { ...auth, alertId: auth.routeObjectId, alertType: "safety", resolution: "acknowledge" });
    await service.resolveAlert(principal, { ...auth, alertId: auth.routeObjectId, alertType: "safety", resolution: "resolve" });
    await service.resolveAlert(principal, { ...auth, alertId: auth.routeObjectId, alertType: "feedback", resolution: "acknowledge" });
    await service.resolveAlert(principal, { ...auth, alertId: auth.routeObjectId, alertType: "feedback", resolution: "resolve" });

    for (const method of Object.values(port)) expect(method).toHaveBeenCalledOnce();
    expect(port.grantPackage).toHaveBeenCalledWith(expect.objectContaining({
      sessionIdHash: "session-hash",
      userId: auth.routeObjectId,
      units: 500,
    }));
  });

  it("rejects route/command target mismatch before any workflow call", async () => {
    const port = workflows();
    await expect(createAdminService({ workflows: port }).grantPackage(principal, {
      ...auth,
      routeObjectId: "00000000-0000-4000-8000-000000000099",
      userId: auth.routeObjectId,
      units: 500,
      idempotencyKey: "grant-mismatch",
    })).rejects.toThrow("Admin route object does not match command target");
    for (const method of Object.values(port)) expect(method).not.toHaveBeenCalled();
  });

  it.each([0, 100, 750, 2500])("rejects non-catalog admin package size %s", async (units) => {
    const port = workflows();
    await expect(createAdminService({ workflows: port }).grantPackage(principal, {
      ...auth,
      userId: auth.routeObjectId,
      units,
      idempotencyKey: `grant-${units}`,
    })).rejects.toThrow("Package size is not allowed");
    expect(port.grantPackage).not.toHaveBeenCalled();
  });

  it("keeps intro grant a distinct exact 100-unit operation", async () => {
    const port = workflows();
    await expect(createAdminService({ workflows: port }).grantIntroPackage(principal, {
      ...auth,
      userId: auth.routeObjectId,
      units: 500,
      idempotencyKey: "intro-invalid",
    })).rejects.toThrow("Intro package must contain exactly 100 units");
    expect(port.grantIntroPackage).not.toHaveBeenCalled();
  });
});
