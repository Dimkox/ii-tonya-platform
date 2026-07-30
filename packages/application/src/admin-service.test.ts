import { describe, expect, it } from "vitest";
import { createAdminService } from "./admin-service.js";
import { adminFixture } from "./admin-service.testkit.js";

describe("admin application boundary", () => {
  it.each([500, 1000, 1500, 2000] as const)("fails closed for unfinished package grant size %s", async (units) => {
    const deps = adminFixture({ approval: "valid" });
    await expect(createAdminService(deps).grantPackage(deps.principal, { userId: "u-1", units, idempotencyKey: `grant-${units}`, approvalId: `approval-${units}`, now: new Date("2026-07-28T10:00:00.000Z"), correlationId: `corr-${units}` })).rejects.toThrow("Admin workflows are not registered");
    expect(deps.ledger.facts()).toEqual([]);
  });

  it("fails closed for unfinished revocation", async () => {
    const deps = adminFixture({ approval: "valid", packageBalance: 500 });
    await expect(createAdminService(deps).revokePackage(deps.principal, { userId: "u-1", packageId: "package-1", idempotencyKey: "revoke-1", approvalId: "approval-revoke", now: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-revoke" })).rejects.toThrow("Admin workflows are not registered");
    expect(deps.ledger.facts()).toHaveLength(1);
  });

  it("fails closed for unfinished intro package grants", async () => {
    const deps = adminFixture({ approval: "valid" });
    await expect(createAdminService(deps).grantIntroPackage(deps.principal, { userId: "u-1", units: 100, idempotencyKey: "intro-1", approvalId: "approval-intro", now: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-intro" })).rejects.toThrow("Admin workflows are not registered");
    expect(deps.ledger.facts()).toEqual([]);
  });
});
