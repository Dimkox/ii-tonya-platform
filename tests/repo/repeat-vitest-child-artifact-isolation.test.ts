import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";

const root = process.cwd();

// Read the actual fixture environment without registering/rerunning its tests.
function fixtureChildEnvironment(parent: NodeJS.ProcessEnv) {
  const source = ts.createSourceFile(
    "repeat-vitest.test.ts",
    readFileSync("tests/repo/repeat-vitest.test.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "spawnSync"
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const options = calls.at(-1)!.arguments[2] as ts.ObjectLiteralExpression;
  const property = options.properties.find(
    (node) =>
      ts.isPropertyAssignment(node) && node.name.getText(source) === "env",
  ) as ts.PropertyAssignment;
  return runInNewContext(`(${property.initializer.getText(source)})`, {
    process: { env: parent },
  }) as NodeJS.ProcessEnv;
}

it("nested missing-path Vitest preserves its parent's coverage and report under hosted flags", () => {
  const directory = mkdtempSync(join(tmpdir(), "ii-tonya-nested-evidence-"));
  const parent = {
    ...process.env,
    II_TONYA_CI_DB_REPORT: "true",
    CI: "true",
    GITHUB_ACTIONS: "true",
  };
  try {
    copyFileSync("vitest.config.ts", join(directory, "vitest.config.ts"));
    writeFileSync(join(directory, "package.json"), '{"type":"module"}\n');
    symlinkSync(
      resolve("node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    mkdirSync(join(directory, "coverage/.tmp"), { recursive: true });
    const coverage = join(directory, "coverage/.tmp/parent.json");
    const report = join(directory, "vitest-results.json");
    writeFileSync(coverage, "parent coverage");
    writeFileSync(report, "parent report");
    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts/repeat-vitest.mjs"),
        "3",
        "tests/repo/__does-not-exist__.test.ts",
      ],
      {
        cwd: directory,
        env: fixtureChildEnvironment(parent),
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("No test files found");
    expect(existsSync(coverage)).toBe(true);
    expect(readFileSync(coverage, "utf8")).toBe("parent coverage");
    expect(readFileSync(report, "utf8")).toBe("parent report");
    expect(parent.II_TONYA_CI_DB_REPORT).toBe("true");
    expect(parent.CI).toBe("true");
    expect(parent.GITHUB_ACTIONS).toBe("true");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 65_000);

it("ignores only generated JSON evidence while actual Getzilla still detects tracked source changes", () => {
  const actual = spawnSync(
    "git",
    ["check-ignore", "--no-index", "vitest-results.json"],
    {
      encoding: "utf8",
    },
  );
  expect(actual.status).toBe(0);
  const directory = mkdtempSync(
    join(tmpdir(), "ii-tonya-evidence-fingerprint-"),
  );
  try {
    copyFileSync(".gitignore", join(directory, ".gitignore"));
    writeFileSync(join(directory, "source.ts"), "export const value = 1;\n");
    for (const args of [
      ["init", "--quiet"],
      ["add", ".gitignore", "source.ts"],
      [
        "-c",
        "user.name=Synthetic Unit",
        "-c",
        "user.email=unit@example.invalid",
        "commit",
        "-qm",
        "fixture",
      ],
    ]) {
      const result = spawnSync("git", args, {
        cwd: directory,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
    }
    const result = spawnSync(
      "python3",
      [
        "-c",
        `
import json,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from getzilla.util import tree_fingerprint
root=Path(sys.argv[2])
before=tree_fingerprint(root)
(root/'vitest-results.json').write_text('{"synthetic":true}\\n')
generated=tree_fingerprint(root)
(root/'source.ts').write_text('export const value = 2;\\n')
changed=tree_fingerprint(root)
print(json.dumps({'reportIgnored':before==generated,'sourceDetected':generated!=changed}))
`,
        join(root, ".getzilla"),
        directory,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      reportIgnored: true,
      sourceDetected: true,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
