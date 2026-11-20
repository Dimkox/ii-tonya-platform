/**
 * Compiled release entry. Runs with node after pnpm build.
 *
 *   node scripts/planerka-service-mappings.mjs list
 *   node release/scripts/planerka-service-mappings.mjs remove <id> --confirm
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(here, "../packages/db/dist/index.js"),
  join(here, "../worker/node_modules/@ii-tonya/db/dist/index.js"),
  join(here, "node_modules/@ii-tonya/db/dist/index.js"),
];
const found = candidates.find((path) => existsSync(path));
if (!found) {
  console.error("planerka_cli_build_missing");
  process.exit(1);
}
const { runPlanerkaMappingsCli } = await import(pathToFileURL(found).href);
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
