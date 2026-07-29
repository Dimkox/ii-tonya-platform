import { runPnpm } from "./lib/run-pnpm.mjs";

const forwarded = process.argv.slice(2);
const [countText, ...testPaths] = forwarded[0] === "--" ? forwarded.slice(1) : forwarded;
const count = Number.parseInt(countText ?? "", 10);
if (!Number.isInteger(count) || count < 1 || testPaths.length === 0) {
  throw new Error("Usage: pnpm test:repeat -- <positive-count> <test-path> [test-path]");
}
for (let index = 1; index <= count; index += 1) {
  runPnpm(["exec", "vitest", "run", ...testPaths], {
    env: { ...process.env, TEST_RUN_INDEX: String(index) },
  });
}
