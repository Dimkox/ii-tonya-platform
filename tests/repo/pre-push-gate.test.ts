import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const GATE = "scripts/pre-push-gate.sh";
const HOOK = "scripts/git-hooks/pre-push";
const INSTALLER = "scripts/install-git-hooks.sh";

// The hook has no file extension, so scope-boundary's automation matcher
// (/\.(ps1|sh|bash|py|cmd|bat)$/) never visits it and it cannot be registered in
// approvedAutomationArtifactHashes. Its content is pinned here instead, using the same
// CRLF-normalized sha256 the manifest uses.
const HOOK_SHA256 =
  "dad652903c723aa7b949b1086561f4a87c02505419b53b85358975df12a44719";

const read = (path: string): string =>
  readFileSync(path, "utf8").replace(/\r\n?/gu, "\n");

const git = (args: string[]): string =>
  spawnSync("git", args, { encoding: "utf8" }).stdout.trim();

describe("pre-push gate", () => {
  it("pins the extensionless hook that the scope-boundary manifest cannot reach", () => {
    const digest = createHash("sha256")
      .update(read(HOOK), "utf8")
      .digest("hex");
    expect(digest, HOOK).toBe(HOOK_SHA256);
  });

  it("stores the hook with the executable bit, because git skips non-executable hooks silently", () => {
    expect(git(["ls-files", "-s", HOOK])).toMatch(/^100755\b/u);
    expect(statSync(HOOK).mode & 0o111).toBeGreaterThan(0);
  });

  it("delegates from the hook to the gate and refuses a main push it cannot attribute", () => {
    const hook = read(HOOK);
    expect(hook).toContain("bash scripts/pre-push-gate.sh");
    expect(hook).toContain("pushes_main");
    expect(hook).toContain("git status --porcelain --untracked-files=no");
    // A green gate must describe the commit being pushed, not an unrelated working tree.
    expect(hook).toContain("is not the commit being pushed to main");
    expect(hook).toContain("refs/heads/main");
    expect(hook).toContain('if [[ "$seen_ref" != "true" ]]');
  });

  it("records exit statuses without losing them to the negation", () => {
    const gate = read(GATE);
    expect(gate).toContain('"$@" >"$results_dir/$name.log" 2>&1 || code=$?');
    // `if ! cmd; then code=$?; fi` stores the status of `!`, which is always 0: the gate then
    // reports every check green without running anything.
    expect(gate).not.toMatch(/if\s+!\s+"\$@"[\s\S]{0,80}?code=\$\?/u);
  });

  it("syntax-checks shell scripts one per bash -n invocation", () => {
    const gate = read(GATE);
    expect(gate).toContain(
      "for file in scripts/*.sh deploy/bootstrap/*.sh deploy/claw/*.sh",
    );
    expect(gate).toContain('bash -n "$file" || return $?');
    // bash -n parses only its first operand; the rest become positional parameters.
    expect(gate).not.toMatch(/bash -n scripts\/\*\.sh \S/u);
    expect(gate).toContain("refusing to report syntax success");
  });

  it("takes its prettier scope from package.json instead of duplicating it", () => {
    const gate = read(GATE);
    expect(gate).toContain('scripts["format:check"]');
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["verify:gate"]).toBe(
      "bash scripts/pre-push-gate.sh",
    );
  });

  it("runs the timing-sensitive suite alone, after the parallel group", () => {
    const gate = read(GATE);
    const waitAt = gate.indexOf("\nwait\n");
    const suiteAt = gate.indexOf("record repo-tests");
    expect(waitAt).toBeGreaterThan(-1);
    expect(suiteAt).toBeGreaterThan(waitAt);
    // Issue #71: the variable is host load, not worker count.
    expect(gate).toContain("issue #71");
  });

  it("refuses to report success when the toolchain is missing", () => {
    const gate = read(GATE);
    expect(gate).toContain("cannot run the gate");
    expect(gate).toContain("for tool in vitest eslint prettier");
  });

  it("validates its own arguments", () => {
    const help = spawnSync("bash", [GATE, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--changed-file");

    const unknown = spawnSync("bash", [GATE, "--nope"], { encoding: "utf8" });
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("unknown argument");

    const dangling = spawnSync("bash", [GATE, "--changed-file"], {
      encoding: "utf8",
    });
    expect(dangling.status).toBe(2);

    const missingList = spawnSync(
      "bash",
      [GATE, "--changed-file", "/nonexistent/changed-list"],
      { encoding: "utf8" },
    );
    expect(missingList.status).toBe(2);
    expect(missingList.stderr).toContain("changed-file list not found");
  });

  it("installs the hook outside the worktree so a stale checkout cannot disable it silently", () => {
    const installer = read(INSTALLER);
    expect(installer).toContain("git rev-parse --git-common-dir");
    expect(installer).toContain('hooks_dir="$common_dir/hooks"');
    // core.hooksPath resolves against the checkout, so a checkout without the versioned hook
    // would push ungated and without a message; the installer clears it instead of using it.
    expect(installer).toContain("git config --unset core.hooksPath");
    expect(installer).toContain(
      "refusing to overwrite an existing foreign hook",
    );
    expect(installer).toMatch(/\.foreign\.\$\(date/u);
    expect(installer).toContain("--check");
    expect(installer).toContain("not the dispatcher this installer writes");
  });

  it("makes the dispatcher fail loudly when the checkout carries no gate", () => {
    const installer = read(INSTALLER);
    expect(installer).toContain("REFUSING");
    expect(installer).toContain("bypass knowingly");
  });
});
