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
  it("contains a private package and source entrypoint for every module", () => {
    const missing = roots.filter((root) => {
      if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "src/index.ts"))) return true;
      const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { private?: boolean };
      return manifest.private !== true;
    });
    expect(missing).toEqual([]);
  });
});
