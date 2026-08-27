import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const roots = [
  "apps/api",
  "apps/worker",
  "packages/application",
  "packages/config",
  "packages/contracts",
  "packages/db",
  "packages/domain",
  "packages/integrations",
  "packages/observability",
  "packages/worker",
];

describe("workspace layout", () => {
  it("contains a private Vite web workspace with strict build scripts", () => {
    const manifestPath = "apps/web/package.json";
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      private?: boolean;
      type?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest).toMatchObject({
      private: true,
      type: "module",
      scripts: {
        build: "vite build",
        typecheck: "tsc --noEmit",
        test: "vitest run",
      },
    });
    expect(manifest.devDependencies?.vite).toMatch(/^\^7\./u);
  });

  it("contains a private package and source entrypoint for every module", () => {
    const missing = roots.filter((root) => {
      if (
        !existsSync(join(root, "package.json")) ||
        !existsSync(join(root, "src/index.ts"))
      )
        return true;
      const manifest = JSON.parse(
        readFileSync(join(root, "package.json"), "utf8"),
      ) as { private?: boolean };
      return manifest.private !== true;
    });
    expect(missing).toEqual([]);
  });

  it("contains the expert residency worker, release evidence, and recovery artifacts", () => {
    const required = [
      "packages/db/src/repositories/expert-referral-worker-repository.ts",
      "packages/worker/src/expert-residency-expiry.ts",
      "packages/worker/src/expert-residency-reconciliation.ts",
      "packages/worker/src/expert-referral-hold-replay.ts",
      "packages/observability/src/metrics.test.ts",
      "tests/e2e/expert-residency-referral.test.ts",
      "docs/spec/expert-residency-referrals-traceability.md",
      "docs/runbooks/expert-residency-referrals.md",
      "docs/runbooks/expert-residency-referrals-rollback.md",
    ];
    expect(required.filter((path) => !existsSync(path))).toEqual([]);
  });
});
