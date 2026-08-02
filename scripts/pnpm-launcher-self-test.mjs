import { readFileSync } from "node:fs";
import { runPnpm } from "./lib/run-pnpm.mjs";

const expectedVersion = JSON.parse(readFileSync("package.json", "utf8"))
  .packageManager.replace(/^pnpm@/, "");
const outputs = [];
for (let childExecution = 1; childExecution <= 2; childExecution += 1) {
  const result = runPnpm(["--version"], { encoding: "utf8", stdio: "pipe" });
  const version = result.stdout.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid pnpm version: ${version}`);
  if (version !== expectedVersion) {
    throw new Error(`pnpm version mismatch: expected ${expectedVersion}, received ${version}`);
  }
  outputs.push({ childExecution, version });
}
if (outputs.length !== 2 || outputs.some((item) => item.childExecution < 1)) {
  throw new Error("launcher did not complete exactly two child executions");
}
process.stdout.write(`${JSON.stringify({ childExecutions: outputs.length, outputs })}\n`);
