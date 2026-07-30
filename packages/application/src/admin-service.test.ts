import { describe, expect, it } from "vitest";
import { createAdminService } from "./admin-service.js";
import { adminFixture } from "./admin-service.testkit.js";

describe("package administration", () => {
  it.each([500, 1000, 1500, 2000] as const)("grants allowed size %s for exactly 60 days", async (units) => {
    const deps = adminFixture({ approval: "valid" });
    await createAdminService(deps).grantPackage(deps.principal, { userId: "u-1", units, idempotencyKey: `grant-${units}`, approvalId: `approval-${units}`, now: new Date("2026-07-28T10:00:00.000Z"), correlationId: `corr-${units}` });
    expect(deps.ledger.facts()).toContainEqual(expect.objectContaining({ kind: "grant", delta: units, expiresAt: new Date("2026-09-26T10:00:00.000Z") }));
  });

  it("rejects an unapproved size and revokes through one append-only ledger fact", async () => {
    const deps = adminFixture({ approval: "valid", packageBalance: 500 });
    await expect(createAdminService(deps).grantPackage(deps.principal, { userId: "u-1", units: 750, idempotencyKey: "grant-invalid", approvalId: "approval-invalid", now: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-invalid" })).rejects.toThrow("Package size is not allowed");
    await createAdminService(deps).revokePackage(deps.principal, { userId: "u-1", packageId: "package-1", idempotencyKey: "revoke-1", approvalId: "approval-revoke", now: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-revoke" });
    expect(deps.ledger.facts()).toContainEqual(expect.objectContaining({ kind: "revocation", delta: -500, originalEntryId: "grant-1" }));
  });

  it("separates the 100-unit no-expiry intro grant from normal package grants", async () => {
    const deps = adminFixture({ approval: "valid" });
    await createAdminService(deps).grantIntroPackage(deps.principal, { userId: "u-1", units: 100, idempotencyKey: "intro-1", approvalId: "approval-intro", now: new Date("2026-07-28T10:00:00.000Z"), correlationId: "corr-intro" });
    expect(deps.ledger.facts()).toContainEqual(expect.objectContaining({ kind: "grant", delta: 100, packageKind: "intro", expiresAt: null }));
  });
});
