import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findProjectionImportViolations } from "./support/projection-architecture-boundary.js";

describe("projection architecture boundary", () => {
  it("allows projection imports only in worker delivery composition", () => {
    const violations: string[] = [];
    for (const file of globSync(["apps/**/*.ts", "packages/**/*.ts"], {
      exclude: ["**/*.test.ts", "**/*.testkit.ts"],
    })) {
      violations.push(...findProjectionImportViolations({
        path: file,
        content: readFileSync(file, "utf8"),
      }));
    }
    expect(violations).toEqual([]);
  });

  it.each([
    ["direct projection import", 'import { MakeProjectionSink } from "../projections/make-projection-sink.js";'],
    ["barrel named import", 'import { MakeProjectionSink } from "@ii-tonya/integrations";'],
    ["barrel alias import", 'import { ProjectionSink as Sink } from "@ii-tonya/integrations";'],
    ["barrel namespace import", 'import * as integrations from "@ii-tonya/integrations";'],
    ["barrel re-export", 'export { ProjectionTopic as Topic } from "@ii-tonya/integrations";'],
    ["barrel namespace re-export", 'export * as integrations from "@ii-tonya/integrations";'],
    ["direct projection re-export", 'export * from "../projections/projection-port.js";'],
    ["dynamic direct projection import", 'void import("../projections/make-projection-sink.js");'],
    ["dynamic barrel import", 'const integrations = import("@ii-tonya/integrations");'],
    ["CommonJS direct projection require", 'const sink = require("../projections/make-projection-sink.js");'],
    ["CommonJS barrel destructuring", 'const { MakeProjectionSink: Sink } = require("@ii-tonya/integrations");'],
    ["TypeScript import equals require", 'import integrations = require("@ii-tonya/integrations");'],
  ])("rejects an unauthorized %s", (_label, content) => {
    expect(findProjectionImportViolations({
      path: "apps/api/src/unauthorized.ts",
      content,
    })).not.toEqual([]);
  });

  it("allows only worker composition and the integrations public boundary", () => {
    expect(findProjectionImportViolations({
      path: "packages/worker/src/projection-delivery.ts",
      content: 'import { MakeProjectionSink } from "@ii-tonya/integrations";',
    })).toEqual([]);
    expect(findProjectionImportViolations({
      path: "packages/integrations/src/index.ts",
      content: 'export { MakeProjectionSink } from "./projections/make-projection-sink.js";',
    })).toEqual([]);
  });
});

describe("expert residency referral architecture boundary", () => {
  it("keeps production worker provider reads disabled", () => {
    const main = readFileSync("apps/worker/src/main.ts", "utf8");
    expect(main).toContain("disabledExpertResidencyProviderReader");
    expect(main).toContain('kind: "disabled" as const');
    expect(main).not.toMatch(/\b(?:fetch|axios|stripe|yookassa|cloudpayments|paypal|adyen)\b/iu);
  });

  it("keeps expert prompt context read-only and explicitly rejects financial authority fields", () => {
    const prompt = readFileSync(
      "packages/application/src/expert-prompt-context.ts",
      "utf8",
    );
    expect(prompt).not.toContain("@ii-tonya/db");
    expect(prompt).not.toContain("@ii-tonya/integrations");
    expect(prompt).toContain('"providerPayload"');
    expect(prompt).toContain('"ledgerEntries"');
    expect(prompt).toContain("forbiddenAuthorityFields");
    expect(prompt).toContain("validateExpertIntentProposal");
  });

  it("keeps expert proposals separate from the client intent engine contract", () => {
    const ports = readFileSync("packages/application/src/ports.ts", "utf8");
    const expertStart = ports.indexOf("export type ExpertIntentProposal");
    const clientStart = ports.indexOf("export type IntentProposal");
    expect(expertStart).toBeGreaterThanOrEqual(0);
    expect(clientStart).toBeGreaterThan(expertStart);
    const clientBlock = ports.slice(clientStart, ports.indexOf("export interface IntentEngine"));
    expect(clientBlock).not.toContain("redeem_expert_referral");
    expect(clientBlock).not.toContain("start_residency_checkout");
  });
});