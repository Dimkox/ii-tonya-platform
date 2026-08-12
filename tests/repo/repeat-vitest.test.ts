import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runner = resolve("scripts/repeat-vitest.mjs");
const testPath = "packages/domain/src/reservation.test.ts";

describe("repeat Vitest runner", () => {
  it.each(["2junk", "1.5", "+2", "0", "-1", ""])(
    "rejects malformed count %j before launching a child",
    (count) => {
      const result = spawnSync(process.execPath, [runner, count, testPath], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, CI: "", GITHUB_ACTIONS: "" },
      });

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage: pnpm test:repeat");
    },
  );

  it("refuses repeat counts above three in every environment", () => {
    const result = spawnSync(process.execPath, [runner, "4", testPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Refuse to run test:repeat 4×; maximum is 3/);
  });

  it("allows exactly three repeats outside CI", () => {
    // Use a missing path so Vitest fails fast after the repeat guard.
    const result = spawnSync(
      process.execPath,
      [runner, "3", "tests/repo/__does-not-exist__.test.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, CI: "", GITHUB_ACTIONS: "" },
        timeout: 60_000,
      },
    );

    expect(result.stderr).not.toMatch(/Refuse to run test:repeat/);
  });
});
