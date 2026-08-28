import { describe, expect, it } from "vitest";
import type { ClientCommercialPolicyPort } from "./client-commercial-policy.js";

describe("ClientCommercialPolicyPort", () => {
  it("describes the immutable resolution contract", async () => {
    const port: ClientCommercialPolicyPort = {
      resolveOrAssign: async () => "legacy_package_v1",
    };
    await expect(
      port.resolveOrAssign({ userId: "u", allowV2Admission: false }),
    ).resolves.toBe("legacy_package_v1");
  });
});
