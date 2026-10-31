import { globSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Fail closed if a database test file is missing, duplicated, skipped or failed. */
const allowedSkips = new Set([
  "tests/integration/verification-private-jobs.test.ts\0normal worker composes real local Telegram/S3/VK and isolated extraction without approval authority",
  "tests/integration/resident-semantic-tags.test.ts\0normal authenticated ingress uses real helper/cache, replays unchanged update after reload, and measures warm composed pipeline",
  "tests/integration/resident-semantic-tags.test.ts\0S3b realistic partial service warm pipeline, strict cache restore and real callback repeat",
  "tests/integration/resident-rich-onboarding.test.ts\0original-bot PDF and DOCX pass the isolated parser into reviewed proposals, failed files retain raw entry",
  "packages/integrations/src/documents/safe-document-parser.test.ts\0extracts real synthetic PDF and DOCX through the locked helper",
  "tests/integration/residency-core-stabilization.test.ts\0residency core stabilization PG17.5 extracts actual PDF and DOCX through Fastify, saves private proposal and leaves publication empty",
]);

export function databaseTestInventory(root) {
  // Match every include in vitest.config.ts, a superset of all database paths.
  const groups = [
    "packages/**/*.test.ts",
    "apps/**/*.test.ts",
    "tests/**/*.test.ts",
  ].map((pattern) => globSync(pattern, { cwd: root }));
  if (groups.some((group) => group.length === 0))
    throw new Error("database test inventory incomplete");
  return groups.flat();
}

export function verifyDatabaseResults(report, expectedPaths, root) {
  if (!Array.isArray(expectedPaths) || expectedPaths.length === 0)
    throw new Error("database inventory is empty");
  if (!report || report.success !== true || !Array.isArray(report.testResults))
    throw new Error("test suite did not succeed");
  const expected = new Set(expectedPaths.map((path) => resolve(root, path)));
  if (expected.size !== expectedPaths.length)
    throw new Error("duplicate expected database test");
  const found = new Map();
  for (const result of report.testResults) {
    if (!result || typeof result.name !== "string")
      throw new Error("invalid test report");
    const name = resolve(root, result.name);
    if (!expected.has(name)) continue;
    if (found.has(name)) throw new Error("duplicate database test result");
    found.set(name, result);
  }
  for (const name of expected) {
    const result = found.get(name);
    if (!result)
      throw new Error(`missing database test: ${relative(root, name)}`);
    if (
      result.status !== "passed" ||
      !Array.isArray(result.assertionResults) ||
      !result.assertionResults.some(
        (assertion) => assertion?.status === "passed",
      ) ||
      result.assertionResults.some(
        (assertion) =>
          assertion?.status !== "passed" &&
          !(
            assertion?.status === "pending" &&
            allowedSkips.has(`${relative(root, name)}\0${assertion.fullName}`)
          ),
      )
    )
      throw new Error(
        `database test not executed successfully: ${relative(root, name)}`,
      );
  }
  return found.size;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = process.cwd();
  const reportPath = process.argv[2];
  if (!reportPath || isAbsolute(reportPath))
    throw new Error("invalid report path");
  const expected = databaseTestInventory(root);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const count = verifyDatabaseResults(report, expected, root);
  process.stdout.write(
    `Verified ${count} test files in the successful full-suite report.\n`,
  );
  for (const result of report.testResults) {
    for (const assertion of result.assertionResults ?? []) {
      if (assertion.status === "pending")
        process.stdout.write(
          `Documented skip: ${relative(root, result.name)}: ${assertion.fullName}\n`,
        );
    }
  }
}
