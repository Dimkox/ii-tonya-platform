import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminApprovalIntegration = readFileSync(
  "tests/integration/admin-approval.test.ts",
  "utf8",
);

describe("admin upgrade timestamp guard", () => {
  it("proves legacy expiry preservation with database booleans", () => {
    expect(adminApprovalIntegration).toContain("timestamptz '2036-08-10T00:00:00Z'");
    expect(adminApprovalIntegration).toContain("as \"expiryPreserved\"");
    expect(adminApprovalIntegration).toContain("as \"expiryIsNull\"");
    expect(adminApprovalIntegration).not.toContain("expiresAt: expect.any(Date)");
    expect(adminApprovalIntegration).not.toContain("expiresAt: Date | null");
  });
});
