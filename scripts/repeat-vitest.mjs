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

const maximumRepeatCount = 3;
if (count > maximumRepeatCount) {
  throw new Error(
    `Refuse to run test:repeat ${count}×; maximum is ${maximumRepeatCount}.`,
  );
}

for (let index = 1; index <= count; index += 1) {
  runPnpm(["exec", "vitest", "run", ...testPaths], {
    env: { ...process.env, TEST_RUN_INDEX: String(index) },
  });
}
