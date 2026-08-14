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

  it("keeps transport free of providers, persistence, and raw result delivery", () => {
    const route = readFileSync(
      "apps/api/src/routes/expert-ai-ingress.ts",
      "utf8",
    );
    const telegram = readFileSync(
      "apps/api/src/routes/telegram-webhook.ts",
      "utf8",
    );
    expect(route).toContain("deps.principals.resolve");
    expect(route).toContain("deps.ingress.handle");
    expect(route).toContain("deps.requests.claim");
    expect(route).not.toContain("new Map");
    expect(route).not.toMatch(
      /@ii-tonya\/(?:db|integrations)|yookassa|node:fs|fetch\s*\(|result:\s*result\.result/u,
    );
    expect(telegram).toContain("telegram:${updateId}:expert-ai");
    expect(telegram).toContain('!text.startsWith("/")');
  });

  it("retains deterministic evaluation and the blocked human checkpoint", () => {
    const design = readFileSync(
      "docs/superpowers/specs/2026-08-14-expert-ai-ingress-design.md",
      "utf8",
    );
    const baseline = readFileSync(
      "tests/fixtures/prompts/expert-ai-distribution-baseline.json",
      "utf8",
    );
    expect(design).toContain("Human spot-check result: **BLOCKED**");
    expect(JSON.parse(baseline)).toMatchObject({
      schemaVersion: 1,
      validatorContract: "expert-intent-v1",
    });
  });
});
