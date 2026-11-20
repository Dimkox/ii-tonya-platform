/**
 * Compiled release entry. Runs with node after the database package is built.
 *
 *   node scripts/planerka-service-mappings.mjs list
 *   node scripts/planerka-service-mappings.mjs remove <id> --confirm
 */
import { runPlanerkaMappingsCli } from "../packages/db/dist/index.js";

runPlanerkaMappingsCli(process.argv.slice(2), process.env, (line) =>
  console.log(line),
).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(
      error instanceof Error ? error.message.split("\n")[0] : "failed",
    );
    process.exitCode = 1;
  },
);
