import { describe, expect, it } from "vitest";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  databaseTestInventory,
  verifyDatabaseResults,
} from "../../scripts/assert-ci-db-results.mjs";

const root = "/workspace/source";
const paths = [
  "tests/integration/schema.test.ts",
  "packages/db/src/repositories/ledger.test.ts",
];
const report = {
  success: true,
  testResults: paths.map((path) => ({
    name: resolve(root, path),
    status: "passed",
    assertionResults: [{ status: "passed" }],
  })),
};

describe("hosted DB evidence", () => {
  it("accepts only a complete successful database manifest", () => {
    expect(verifyDatabaseResults(report, paths, root)).toBe(2);
  });
  it("rejects missing, skipped, failed and duplicate database files", () => {
    expect(() =>
      verifyDatabaseResults(
        { ...report, testResults: report.testResults.slice(0, 1) },
        paths,
        root,
      ),
    ).toThrow("missing");
    expect(() =>
      verifyDatabaseResults(
        {
          ...report,
          testResults: [
            report.testResults[0],
            {
              ...report.testResults[1],
              assertionResults: [{ status: "pending" }],
            },
          ],
        },
        paths,
        root,
      ),
    ).toThrow("not executed");
    expect(() =>
      verifyDatabaseResults(
        {
          ...report,
          testResults: [
            report.testResults[0],
            {
              ...report.testResults[1],
              assertionResults: [
                { status: "passed" },
                { status: "pending", fullName: "unexpected" },
              ],
            },
          ],
        },
        paths,
        root,
      ),
    ).toThrow("not executed");
    expect(() =>
      verifyDatabaseResults({ ...report, success: false }, paths, root),
    ).toThrow("suite");
    expect(() =>
      verifyDatabaseResults(
        {
          ...report,
          testResults: [...report.testResults, report.testResults[0]],
        },
        paths,
        root,
      ),
    ).toThrow("duplicate");
  });
  it("rejects an empty expected inventory", () => {
    expect(() => verifyDatabaseResults(report, [], root)).toThrow("empty");
  });
  it("permits only the documented socket-dependent skipped case", () => {
    const path = "tests/integration/verification-private-jobs.test.ts";
    const evidence = {
      success: true,
      testResults: [
        {
          name: resolve(root, path),
          status: "passed",
          assertionResults: [
            { status: "passed" },
            {
              status: "pending",
              fullName:
                "normal worker composes real local Telegram/S3/VK and isolated extraction without approval authority",
            },
          ],
        },
      ],
    };
    expect(verifyDatabaseResults(evidence, [path], root)).toBe(1);
    evidence.testResults[0]!.assertionResults[1]!.fullName =
      "another skipped test";
    expect(() => verifyDatabaseResults(evidence, [path], root)).toThrow(
      "not executed",
    );
  });
  it("requires each database test group and discovers new files", () => {
    const dir = mkdtempSync(join(tmpdir(), "ii-ci-manifest-"));
    try {
      expect(() => databaseTestInventory(dir)).toThrow("incomplete");
      for (const path of [
        "tests/integration/new.test.ts",
        "packages/db/src/repositories/new.test.ts",
        "apps/api/src/routes/new.integration.test.ts",
      ]) {
        mkdirSync(resolve(dir, path, ".."), { recursive: true });
        writeFileSync(resolve(dir, path), "");
      }
      expect(databaseTestInventory(dir).sort()).toEqual(
        [
          "packages/db/src/repositories/new.test.ts",
          "apps/api/src/routes/new.integration.test.ts",
          "tests/integration/new.test.ts",
        ].sort(),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
