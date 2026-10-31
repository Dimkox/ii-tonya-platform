import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const exporter = resolve("scripts/getzilla_ci_evidence.py");
const roots: string[] = [];
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function exportTitles(titles: string[]) {
  const root = mkdtempSync(join(tmpdir(), "ci-title-privacy-"));
  roots.push(root);
  mkdirSync(join(root, ".getzilla"));
  mkdirSync(join(root, "tests/repo"), { recursive: true });
  const source = "tests/repo/synthetic.test.ts";
  writeFileSync(join(root, source), "// Synthetic test source\n");
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["add", "tests"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "synthetic source",
    ],
    { cwd: root },
  );
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const raw = JSON.stringify({
    testResults: [
      {
        name: join(root, source),
        status: "failed",
        message: titles.join("\n"),
        assertionResults: titles.map((fullName, i) => ({
          fullName,
          title: fullName,
          ancestorTitles: [fullName],
          status: i % 2 ? "pending" : "failed",
          failureMessages: [
            `AssertionError: ${fullName}\n at ${root}/${source}:10:3`,
          ],
          failureDetails: [{ actual: fullName, expected: fullName }],
          console: [{ message: fullName }],
        })),
      },
    ],
    console: titles,
  });
  writeFileSync(join(root, "vitest-results.json"), raw);
  const output = join(root, "artifact");
  const result = spawnSync(
    "python3",
    [
      exporter,
      "--output",
      output,
      "--job",
      "getzilla-verify",
      "--status",
      "failure",
      "--vitest-summary",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        EXPECTED_SHA: head,
        GITHUB_RUN_ID: "314159",
        RUNNER_TEMP: root,
      },
    },
  );
  expect(result.status).toBe(0);
  const summaryText = readFileSync(join(output, "vitest-summary.json"), "utf8");
  const allExported =
    readdirSync(output)
      .map((file) => readFileSync(join(output, file), "utf8"))
      .join("\n") +
    result.stdout +
    result.stderr;
  expect(readFileSync(join(root, "vitest-results.json"), "utf8") === raw).toBe(
    true,
  );
  expect(readdirSync(output)).not.toContain("vitest-results.json");
  return { summary: JSON.parse(summaryText), allExported, raw, source, head };
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
describe("public CI title privacy", () => {
  it("publishes no raw title fragments for credentials, quoted values, contacts or arbitrary prose", () => {
    const secrets = [
      "basic-canary-59423",
      "quoted-canary-59423",
      "multiline-canary-59423",
      "bearer-canary-59423",
      "prose-canary-59423",
      "contact-canary-59423",
    ];
    const titles = [
      `authorization=Basic ${secrets[0]}`,
      ["password", `"two word ${secrets[1]}"`].join("="),
      ["secret", `'two\nword ${secrets[2]}'`].join("="),
      `Bearer ${secrets[3]}`,
      `ordinary words about ${secrets[4]} with no recognizable credential marker`,
      `client ${secrets[5]}@example.invalid`,
    ];
    const { summary, allExported, raw, source, head } = exportTitles(titles);
    expect(secrets.some((secret) => allExported.includes(secret))).toBe(false);
    expect(
      allExported.includes("ordinary words about") ||
        allExported.includes("two word") ||
        allExported.includes("authorization="),
    ).toBe(false);
    expect(summary).toMatchObject({
      report_status: "available",
      original_sha256: digest(raw),
      source_sha: head,
      run_id: "314159",
    });
    expect(summary.files[0].path).toBe(source);
    expect(summary.files[0].tests).toEqual(
      titles.map((title, i) => ({
        ordinal: i + 1,
        name_sha256: digest(title),
        status: i % 2 ? "pending" : "failed",
        errors: ["assertion_failure"],
        locations: [{ path: source, line: 10, column: 3 }],
      })),
    );
  });
  it("retains every ordinal and digest in an inventory exceeding the old stream truncation", () => {
    const titles = Array.from(
      { length: 512 },
      (_, i) =>
        `private fixture title ${i}: synthetic-prose-${i}-not-for-publication`,
    );
    const { summary, allExported, raw } = exportTitles(titles);
    expect(raw.length).toBeGreaterThan(12_000);
    expect(
      allExported.includes("private fixture title") ||
        allExported.includes("synthetic-prose-"),
    ).toBe(false);
    expect(summary.files[0].tests).toHaveLength(titles.length);
    expect(
      summary.files[0].tests.map(
        (test: { ordinal: number; name_sha256: string }) => [
          test.ordinal,
          test.name_sha256,
        ],
      ),
    ).toEqual(titles.map((title, i) => [i + 1, digest(title)]));
  });
});
