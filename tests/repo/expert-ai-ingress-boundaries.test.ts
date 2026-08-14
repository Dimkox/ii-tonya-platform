import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("expert AI ingress architecture boundary", () => {
  it("stays distinct and inside application authority", () => {
    const ingress = readFileSync(
      "packages/application/src/expert-ai-ingress-service.ts",
      "utf8",
    );
    const conversation = readFileSync(
      "packages/application/src/conversation-service.ts",
      "utf8",
    );
    expect(ingress).toContain("validateExpertIntentProposal");
    expect(ingress).toContain("deps.referrals.redeemCode");
    expect(ingress).toContain("deps.residency.checkout");
    expect(ingress).not.toMatch(
      /@ii-tonya\/(?:db|integrations)|node:|fetch\s*\(/u,
    );
    expect(conversation).not.toContain("ExpertAiIngress");
  });
});
