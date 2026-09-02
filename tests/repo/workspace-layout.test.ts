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
  it("contains the expert residency release evidence layout", () => {
    for (const path of [
      "tests/e2e/expert-residency-referral.test.ts",
      "docs/runbooks/expert-residency-referrals.md",
      "docs/runbooks/expert-residency-referrals-rollback.md",
      "docs/spec/expert-residency-referrals-traceability.md",
    ]) {
      expect(existsSync(path), path).toBe(true);
    }
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
});
