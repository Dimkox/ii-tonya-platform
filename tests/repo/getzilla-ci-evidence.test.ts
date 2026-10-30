import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/getzilla_ci_evidence.py");
const roots: string[] = [];
const canary = "secret-canary-do-not-publish-89324";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ci-report-export-"));
  roots.push(root);
  mkdirSync(join(root, ".getzilla"));
  mkdirSync(join(root, "packages/db/src"), { recursive: true });
  writeFileSync(
    join(root, "packages/db/src/example.integration.test.ts"),
    "// synthetic source location\n",
  );
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["add", "packages"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "fixture",
    ],
    { cwd: root },
  );
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return { root, head };
}
function run(root: string, head: string, status = "failure") {
  const output = join(root, "artifact");
  const result = spawnSync(
    "python3",
    [
      script,
      "--output",
      output,
      "--job",
      "getzilla-verify",
      "--status",
      status,
      "--vitest-summary",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        RUNNER_TEMP: root,
        GITHUB_RUN_ID: "12345",
        EXPECTED_SHA: head,
      },
    },
  );
  expect(
    result.status,
    "exporter must complete without printing report contents",
  ).toBe(0);
  expect(result.stdout.includes(canary) || result.stderr.includes(canary)).toBe(
    false,
  );
  return output;
}
function report(root: string, status = "failed") {
  const input = {
    success: status === "passed",
    testResults: [
      {
        name: join(root, "packages/db/src/example.integration.test.ts"),
        status,
        message: `Bearer ${canary}`,
        assertionResults: [
          {
            title: "preserves the guarded payment state",
            fullName: "payment lifecycle preserves the guarded payment state",
            ancestorTitles: ["payment lifecycle"],
            status,
            failureMessages: [
              `Error: relation \"${canary}\" already exists\n at ${root}/packages/db/src/example.integration.test.ts:42:7`,
            ],
            failureDetails: [
              { actual: canary, expected: canary, code: "42P07" },
            ],
            console: [canary],
          },
        ],
      },
    ],
    console: [canary],
  };
  const bytes = JSON.stringify(input);
  writeFileSync(join(root, "vitest-results.json"), bytes);
  return bytes;
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
describe("sanitized hosted Vitest evidence", () => {
  it.each(["failed", "passed"])(
    "preserves every test and status for a %s report without raw failure data",
    (status) => {
      const { root, head } = fixture();
      const bytes = report(root, status);
      const output = run(
        root,
        head,
        status === "passed" ? "success" : "failure",
      );
      const content = readFileSync(join(output, "vitest-summary.json"), "utf8");
      expect(content.includes(canary)).toBe(false);
      expect(readdirSync(output)).not.toContain("vitest-results.json");
      const summary = JSON.parse(content);
      expect(summary).toMatchObject({
        report_status: "available",
        source_sha: head,
        run_id: "12345",
        original_sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      expect(summary.files).toEqual([
        {
          path: "packages/db/src/example.integration.test.ts",
          status,
          errors: ["unclassified_failure"],
          locations: [],
          tests: [
            {
              name: "payment lifecycle preserves the guarded payment state",
              status,
              errors: ["postgres_duplicate_relation"],
              locations: [
                {
                  path: "packages/db/src/example.integration.test.ts",
                  line: 42,
                  column: 7,
                },
              ],
            },
          ],
        },
      ]);
      const provenance = JSON.parse(
        readFileSync(join(output, "provenance.json"), "utf8"),
      );
      expect(provenance).toMatchObject({ head, run_id: "12345" });
      expect(provenance.files).toContainEqual({
        path: "vitest-summary.json",
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    },
  );
  it.each(["missing", "invalid"])(
    "records an explicit %s report without inventing test success",
    (kind) => {
      const { root, head } = fixture();
      if (kind === "invalid")
        writeFileSync(join(root, "vitest-results.json"), `{${canary}`);
      const output = run(root, head);
      const summary = JSON.parse(
        readFileSync(join(output, "vitest-summary.json"), "utf8"),
      );
      expect(summary.report_status).toBe(kind);
      expect(summary.files).toEqual([]);
      expect(JSON.stringify(summary).includes(canary)).toBe(false);
    },
  );
  it("rejects invalid test structure and preserves the primary verification evidence", () => {
    const { root, head } = fixture();
    const directory = join(root, ".getzilla/runtime/evidence");
    mkdirSync(directory, { recursive: true });
    const primary = JSON.stringify({
      ci_run_id: "12345",
      git_head: head,
      status: "fail",
    });
    writeFileSync(join(directory, "verification.json"), primary);
    writeFileSync(
      join(root, "vitest-results.json"),
      JSON.stringify({
        testResults: [
          {
            name: "packages/example.test.ts",
            assertionResults: [{ fullName: canary, status: "unknown" }],
            status: "failed",
          },
        ],
      }),
    );
    const output = run(root, head);
    const summary = JSON.parse(
      readFileSync(join(output, "vitest-summary.json"), "utf8"),
    );
    expect(summary.report_status).toBe("invalid");
    expect(summary.files).toEqual([]);
    expect(readFileSync(join(output, "verification.json"), "utf8")).toBe(
      primary,
    );
    expect(readFileSync(join(directory, "verification.json"), "utf8")).toBe(
      primary,
    );
  });
  it("refuses report symlinks and foreign source identity", () => {
    const { root, head } = fixture();
    writeFileSync(join(root, "private.json"), canary);
    symlinkSync(join(root, "private.json"), join(root, "vitest-results.json"));
    let output = run(root, head);
    expect(
      JSON.parse(readFileSync(join(output, "vitest-summary.json"), "utf8"))
        .report_status,
    ).toBe("invalid");
    rmSync(output, { recursive: true });
    rmSync(join(root, "vitest-results.json"));
    report(root);
    output = run(root, "f".repeat(40));
    const summary = JSON.parse(
      readFileSync(join(output, "vitest-summary.json"), "utf8"),
    );
    expect(summary.report_status).toBe("source_mismatch");
    expect(summary.files).toEqual([]);
  });
  it("never follows traversal or URL locations and redacts credential-shaped test names", () => {
    const { root, head } = fixture();
    writeFileSync(
      join(root, "vitest-results.json"),
      JSON.stringify({
        testResults: [
          {
            name: "../../private.env",
            status: "failed",
            assertionResults: [
              {
                fullName: `Bearer ${canary} person@example.invalid https://private.invalid/${canary}`,
                status: "failed",
                failureMessages: [
                  `at https://private.invalid/${canary}:1:2\nat ../../private.env:3:4`,
                ],
              },
            ],
          },
        ],
      }),
    );
    const output = run(root, head);
    const content = readFileSync(join(output, "vitest-summary.json"), "utf8");
    expect(
      content.includes(canary) ||
        content.includes("person@example.invalid") ||
        content.includes("private.env") ||
        content.includes("private.invalid"),
    ).toBe(false);
    expect(JSON.parse(content).files[0]).toMatchObject({
      path: "[external]",
      tests: [
        {
          name: "[redacted] [redacted] [redacted]",
          status: "failed",
          errors: ["unclassified_failure"],
          locations: [],
        },
      ],
    });
  });
  it("exports no arbitrary report-controlled source paths", () => {
    const { root, head } = fixture();
    writeFileSync(
      join(root, "vitest-results.json"),
      JSON.stringify({
        testResults: [
          {
            name: `packages/${canary}.test.ts`,
            status: "failed",
            assertionResults: [
              {
                fullName: "uses a synthetic fixture",
                status: "failed",
                failureMessages: [`at packages/${canary}.test.ts:1:2`],
              },
            ],
          },
        ],
      }),
    );
    const output = run(root, head);
    const content = readFileSync(join(output, "vitest-summary.json"), "utf8");
    expect(content.includes(canary)).toBe(false);
    expect(JSON.parse(content).files[0]).toMatchObject({
      path: "[external]",
      tests: [{ locations: [] }],
    });
  });
});
