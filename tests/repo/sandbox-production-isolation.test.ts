import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../../apps/api/src/app.js";
import { findSandboxProductionCompositionViolations } from "./support/payment-scope-boundary.js";

describe("sandbox production isolation", () => {
  it("does not expose sandbox routes from the production application", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/sandbox/v1/payments/sandbox_payment_abcdefghijklmnopqrstuv",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("rejects privileged canonical verifier composition outside sandbox and tests", () => {
    expect(
      findSandboxProductionCompositionViolations({
        path: "apps/api/src/server.ts",
        content:
          'import { createCanonicalExpertResidencyPaymentEventVerifier } from "@ii-tonya/integrations"; createCanonicalExpertResidencyPaymentEventVerifier();',
      }),
    ).not.toEqual([]);
    expect(
      findSandboxProductionCompositionViolations({
        path: "apps/sandbox-api/src/server.ts",
        content:
          'import { createCanonicalExpertResidencyPaymentEventVerifier } from "@ii-tonya/integrations"; createCanonicalExpertResidencyPaymentEventVerifier();',
      }),
    ).toEqual([]);
    expect(
      findSandboxProductionCompositionViolations({
        path: "packages/integrations/src/verified-event.test.ts",
        content: "createCanonicalExpertResidencyPaymentEventVerifier();",
      }),
    ).toEqual([]);
  });

  it("keeps production manifests and composition free of sandbox dependencies", () => {
    expect(readFileSync("apps/api/package.json", "utf8")).not.toContain(
      "sandbox",
    );
    for (const path of [
      "apps/api/src/app.ts",
      "apps/api/src/server.ts",
      "apps/api/src/index.ts",
    ]) {
      expect(
        findSandboxProductionCompositionViolations({
          path,
          content: readFileSync(path, "utf8"),
        }),
      ).toEqual([]);
    }
  });

  it("keeps the shared approval object-type map exhaustive without composing sandbox", () => {
    const repository = readFileSync(
      "packages/db/src/repositories/admin-repository.ts",
      "utf8",
    );
    expect(repository).toContain(
      '"expert_residency.sandbox_settle": "sandbox_expert_residency_payment"',
    );
    expect(repository).toContain(
      '"expert_residency.sandbox_refund": "sandbox_expert_residency_payment"',
    );
    const expertRepository = readFileSync(
      "packages/db/src/repositories/expert-referral-admin-repository.ts",
      "utf8",
    );
    expect(expertRepository).toMatch(
      /type Action = Exclude<[\s\S]*Extract<ApprovalAdminAction, `expert_\$\{string\}`>,[\s\S]*SandboxAction[\s\S]*>;/u,
    );
  });
});
