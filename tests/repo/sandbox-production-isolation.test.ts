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

  it("keeps the production Docker build and runtime closure sandbox-free", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).not.toContain("apps/sandbox-api");
    expect(dockerfile).not.toContain("packages/sandbox-payments");
    expect(dockerfile).not.toContain("@ii-tonya/sandbox-api");
    expect(dockerfile).not.toContain("@ii-tonya/sandbox-payments");
    expect(dockerfile).not.toContain(
      "createCanonicalExpertResidencyPaymentEventVerifier",
    );
  });

  it("publishes a real executable sandbox entrypoint", () => {
    const manifest = JSON.parse(
      readFileSync("apps/sandbox-api/package.json", "utf8"),
    ) as {
      scripts?: { start?: string; build?: string; "build:bounded"?: string };
    };
    expect(manifest.scripts?.start).toBe("node dist/server.js");
    expect(manifest.scripts?.build).toBe("tsup --config tsup.config.ts");
    expect(manifest.scripts?.["build:bounded"]).toBe(
      "tsup --config tsup.config.ts",
    );
    const buildConfig = readFileSync("apps/sandbox-api/tsup.config.ts", "utf8");
    expect(buildConfig).toContain("noExternal: [/^@ii-tonya\\//u]");
    expect(buildConfig).toContain("(?!@ii-tonya\\/)");
    const server = readFileSync("apps/sandbox-api/src/server.ts", "utf8");
    expect(server).toContain(
      "createCanonicalExpertResidencyPaymentEventVerifier",
    );
    expect(server).toContain("new PostgresSandboxPaymentRepository");
    expect(server).toContain("new SandboxTransitionWorkflow");
    expect(server).toContain(
      "if (isDirectExecution(import.meta.url, process.argv[1]))",
    );
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
      /type Action = Exclude<ApprovalAdminAction, SandboxAction>;/u,
    );
  });
});
