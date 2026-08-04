import { runPnpm } from "./lib/run-pnpm.mjs";

const forwarded = process.argv.slice(2);
const [countText, ...testPaths] = forwarded[0] === "--" ? forwarded.slice(1) : forwarded;
if (!countText || !/^[1-9]\d*$/.test(countText)) {
  throw new Error("Usage: pnpm test:repeat -- <positive-count> <test-path> [test-path]");
}
const count = Number(countText);
if (!Number.isSafeInteger(count) || testPaths.length === 0) {
  throw new Error("Usage: pnpm test:repeat -- <positive-count> <test-path> [test-path]");
}

// High-N repeat gates belong in CI only. Agents (and local shells without CI=true)
// must not burn time/tokens looping the same suite 20× — CI db-gate.yml owns that.
const inCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const maxLocal = Number(process.env.AGENT_MAX_REPEAT || 2);
if (!inCi && count > maxLocal) {
  throw new Error(
    `Refuse to run test:repeat ${count}× outside CI (local max ${maxLocal}). ` +
      `Run once/twice locally; leave 20× gates to .github/workflows/db-gate.yml. ` +
      `Override with CI=true or AGENT_MAX_REPEAT=<n> only when intentional.`,
  );
}

for (let index = 1; index <= count; index += 1) {
  runPnpm(["exec", "vitest", "run", ...testPaths], {
    env: { ...process.env, TEST_RUN_INDEX: String(index) },
  });
}
