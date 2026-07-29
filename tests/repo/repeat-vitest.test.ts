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
      });

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage: pnpm test:repeat");
    },
  );
});
