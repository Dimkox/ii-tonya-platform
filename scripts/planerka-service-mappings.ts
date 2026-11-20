/**
 * Dev entry. Production releases have no tsx; use
 * scripts/planerka-service-mappings.mjs against the built package.
 */
import { pathToFileURL } from "node:url";
import { runPlanerkaMappingsCli } from "../packages/db/src/planerka-service-mappings-cli.js";

export { runPlanerkaMappingsCli };

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  runPlanerkaMappingsCli(process.argv.slice(2), process.env, (line) =>
    console.log(line),
  ).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(
        error instanceof Error ? error.message.split("\n")[0] : "failed",
      );
      process.exitCode = 1;
    },
  );
}
