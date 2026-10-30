import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("timeout bounds a synthetic child process without shell evaluation", () => {
  const start = Date.now();
  const result = spawnSync(
    "/usr/bin/timeout",
    [
      "--kill-after=1s",
      "0.2s",
      process.execPath,
      "-e",
      "setTimeout(() => {}, 5000)",
    ],
    { stdio: "ignore", timeout: 3000 },
  );
  assert.equal(result.status, 124);
  assert.ok(Date.now() - start < 3000);
});
