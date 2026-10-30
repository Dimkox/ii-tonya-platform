import { expect, it } from "vitest";
import { requiredApprovalRole } from "./admin-approval-repository.js";
it("requires security administrators for grant and revoke approvals", () => {
  expect(requiredApprovalRole("owner_test_pricing.grant")).toBe("security_admin");
  expect(requiredApprovalRole("owner_test_pricing.revoke")).toBe("security_admin");
});
