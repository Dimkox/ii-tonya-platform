import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const hookSource = new URL("../../scripts/git-hooks/pre-push", import.meta.url);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );

describe("pre-push hook git env isolation", () => {
  it("does not leak the hook's repo-local git vars into the gate", () => {
    const repo = mkdtempSync(join(tmpdir(), "prepush-env-"));
    dirs.push(repo);
    const git = (...a: string[]) =>
      execFileSync("git", ["-C", repo, ...a], {
        encoding: "utf8",
        env: cleanEnv(),
      }).trim();
    git("init", "-q", "-b", "feature");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    mkdirSync(join(repo, "scripts", "git-hooks"), { recursive: true });
    copyFileSync(hookSource, join(repo, "scripts", "git-hooks", "pre-push"));
    const seen = join(repo, "seen-env.txt");
    writeFileSync(
      join(repo, "scripts", "pre-push-gate.sh"),
      `#!/usr/bin/env bash\nenv | grep '^GIT_' > ${JSON.stringify(seen)} || true\n`,
    );
    chmodSync(join(repo, "scripts", "pre-push-gate.sh"), 0o755);
    git("add", "-A");
    git("commit", "-qm", "init");
    const sha = git("rev-parse", "HEAD");
    const gitDir = join(repo, ".git");

    execFileSync(
      "bash",
      ["scripts/git-hooks/pre-push", "origin", "https://example.invalid/r.git"],
      {
        cwd: repo,
        input: `refs/heads/feature ${sha} refs/heads/feature ${"0".repeat(40)}\n`,
        env: {
          ...cleanEnv(),
          GIT_DIR: gitDir,
          GIT_INDEX_FILE: join(gitDir, "index"),
          GIT_WORK_TREE: repo,
          GIT_PREFIX: "",
        },
      },
    );

    expect(readFileSync(seen, "utf8").trim()).toBe("");
  });
});
