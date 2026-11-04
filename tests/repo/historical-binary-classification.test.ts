import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script without type declarations
import { classifyRepository } from "../../scripts/classify-historical-binaries.mjs";

const script = resolve("scripts/classify-historical-binaries.mjs");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "historical-binaries-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "f",
    ],
    { cwd: root },
  );
  return root;
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe("historical binary classification (SCRUM-503)", () => {
  it("classifies evidence, images and flags unknown binaries without touching files", () => {
    const root = fixture({
      "docs/test-evidence/x/run.log.gz": gzipSync("ok\n"),
      "docs/test-evidence/x/bad.log.gz": gzipSync(Buffer.from([0, 1, 2, 0xff])),
      "docs/img/a.png": png,
      "docs/test-evidence/x/shot.png.gz": gzipSync(png),
      "tools/blob": Buffer.from([0, 0xff, 0, 0xfe]),
      "README.md": Buffer.from("text\n"),
    });
    const before = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    });
    const report = classifyRepository(root);
    expect(report.total).toBe(5);
    expect(report.counts).toEqual({
      "compressed-inert-image": 1,
      "compressed-text-evidence": 1,
      "inert-image": 1,
      unclassified: 2,
    });
    const reasons = Object.fromEntries(
      report.entries.map((e: { path: string; reason?: string }) => [
        e.path,
        e.reason,
      ]),
    );
    expect(reasons["docs/test-evidence/x/bad.log.gz"]).toBe("gzip-not-text");
    expect(reasons["tools/blob"]).toBe("unknown-type");
    expect(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }),
    ).toBe(before);
    const cli = spawnSync(process.execPath, [script, "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(cli.status).toBe(1);
  });

  it("treats an executable-mode image as unclassified", () => {
    const root = fixture({ "a.png": png });
    execFileSync("git", ["update-index", "--chmod=+x", "a.png"], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "x",
      ],
      { cwd: root },
    );
    expect(classifyRepository(root).entries[0]).toMatchObject({
      class: "unclassified",
      reason: "mode",
    });
  });

  it("revokes a reviewed exception when the blob changes", () => {
    const path =
      "docs/test-evidence/residency-rich-onboarding-2026-10-27/labelled.docx.gz";
    const root = fixture({
      [path]: gzipSync(Buffer.from([0x50, 0x4b, 3, 4, 0])),
    });
    expect(classifyRepository(root).entries[0]).toMatchObject({
      path,
      class: "unclassified",
    });
  });

  it("leaves no unclassified binary artifact in this repository", () => {
    const report = classifyRepository(process.cwd());
    const unclassified = report.entries.filter(
      (e: { class: string }) => e.class === "unclassified",
    );
    expect(unclassified).toEqual([]);
    expect(report.total).toBeGreaterThan(0);
  });
});
