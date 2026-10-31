import { expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import { buildApp } from "./app.js";
import { createDefaultLifecycle } from "./server.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const userId = "00000000-0000-4000-8000-000000000002",
  approvalId = "00000000-0000-4000-8000-000000000003";
it("registers direct pricing approval routes only with explicit enablement and approval workflow", async () => {
  const config = loadEnv({ ...base, OWNER_TEST_PRICING_ADMIN_ENABLED: "true" });
  const lifecycle = createDefaultLifecycle();
  lifecycle.preflight(config);
  const deps = await lifecycle.dependencies(config, undefined as never);
  const { ownerTestPricingWorkflow: omittedWorkflow, ...withoutWorkflow } =
    deps;
  expect(omittedWorkflow).toBeDefined();
  await expect(buildApp(withoutWorkflow)).rejects.toThrow(
    "owner_test_pricing_approval_capability_required",
  );
  vi.spyOn(deps.adminApprovals!, "resolvePrincipal").mockImplementation(
    async (hash) => ({
      id: userId,
      sessionIdHash: hash,
      roles: ["security_admin"],
      mfaVerifiedAt: new Date(),
    }),
  );
  const request = vi
    .spyOn(deps.adminApprovals!, "requestApproval")
    .mockResolvedValue({ approvalId, expiresAt: new Date() });
  const app = await buildApp(deps);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/owner-test-pricing/approvals",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
      payload: { action: "grant", objectId: userId, nonce: "wiring-nonce-001" },
      remoteAddress: "192.0.2.5",
    });
    expect(response.statusCode).toBe(201);
    expect(request).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
});
it("does not expose pricing grant routes by default", async () => {
  const config = loadEnv(base);
  const deps = await createDefaultLifecycle().dependencies(
    config,
    undefined as never,
  );
  const app = await buildApp(deps);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/owner-test-pricing/approvals",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
      payload: {
        action: "grant",
        objectId: userId,
        nonce: "disabled-nonce-001",
      },
    });
    expect(response.statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
