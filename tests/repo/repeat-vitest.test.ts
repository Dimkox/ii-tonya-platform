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

  it("refuses high-N repeats outside CI to protect agent token budget", () => {
    const result = spawnSync(process.execPath, [runner, "20", testPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, CI: "", GITHUB_ACTIONS: "", AGENT_MAX_REPEAT: "2" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Refuse to run test:repeat 20× outside CI/);
    expect(result.stderr).toMatch(/db-gate\.yml/);
  });

  it("does not refuse high-N repeats when CI=true", () => {
    // Guard must not fire under CI. Use a missing path so vitest fails fast
    // after the guard — we only assert the refuse message is absent.
    const result = spawnSync(
      process.execPath,
      [runner, "20", "tests/repo/__does-not-exist__.test.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true" },
        timeout: 60_000,
      },
    );

    expect(result.stderr).not.toMatch(/Refuse to run test:repeat/);
  });
});
