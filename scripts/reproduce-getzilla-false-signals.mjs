#!/usr/bin/env node
// SCRUM-503 slice 4: reproduce Getzilla review_plan false signals at a fixed commit pair.
// Read-only. Runs the vendored engine's review_plan.assess() for BASE..HEAD in a clean detached
// worktree of HEAD (assess() reads HEAD and `git status` of its root), then attributes every path
// that makes it report BINARY_OR_UNKNOWN_INVENTORY to the engine branch that fired, joined with
// the slice-1 classifier class. Usage: reproduce-getzilla-false-signals.mjs BASE HEAD
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1_048_576,
    ...opts,
  });
const git = (...args) => run("git", args);

const ENGINE = `
import json, sys
from pathlib import Path
from types import SimpleNamespace as N
tree, base = Path(sys.argv[1]), sys.argv[2]
sys.path.insert(0, str(tree / '.getzilla'))
from getzilla import __version__
from getzilla import review_plan
a = review_plan.assess(tree, None, N(bases=[N(comparison_base_sha=base)], findings=[]))['risk_assessment']
print(json.dumps({'version': __version__, 'suffixes': list(review_plan._EXECUTABLE_BINARY),
                  'engine': {k: a[k] for k in ('status', 'risk', 'gaps')}}))
`;

// Mirror of the binary branch of review_plan.assess() (engine 2.3.1): one label per condition.
export function causes(name, modes, suffixes) {
  const found = [];
  if (suffixes.some((s) => name.toLowerCase().endsWith(s)))
    found.push("archive-or-executable-suffix");
  const base = name.split("/").pop().replace(/^\.+/u, "");
  if (!base.includes(".")) found.push("extensionless-name");
  if (modes.has("100755")) found.push("executable-mode");
  if (!modes.size || [...modes].some((m) => m !== "100644" && m !== "100755"))
    found.push("non-regular-mode");
  return found;
}

function modesOf(refs) {
  const out = new Map();
  for (const ref of refs)
    for (const row of git("ls-tree", "-r", "-z", ref).split("\0")) {
      if (!row) continue;
      const [meta, name] = row.split("\t");
      if (!out.has(name)) out.set(name, new Set());
      out.get(name).add(meta.split(" ")[0]);
    }
  return out;
}

export function reproduce(baseRef, headRef) {
  const [base, head] = [baseRef, headRef].map((r) =>
    git("rev-parse", "--verify", `${r}^{commit}`).trim(),
  );
  const scratch = mkdtempSync(join(tmpdir(), "gz-repro-"));
  const tree = join(scratch, "tree");
  let engineRun;
  try {
    git("worktree", "add", "--quiet", "--detach", tree, head);
    engineRun = JSON.parse(run("python3", ["-c", ENGINE, tree, base]));
  } finally {
    try {
      git("worktree", "remove", "--force", tree);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const modes = modesOf([base, head]);
  const classes = new Map(
    JSON.parse(
      run("node", ["scripts/classify-historical-binaries.mjs", "--full"]),
    ).entries.map((e) => [e.path, e.class]),
  );
  const signals = [];
  let binaryFileReasons = 0;
  const stats = git(
    "diff",
    "--numstat",
    "-z",
    "--no-renames",
    "--no-textconv",
    "--no-ext-diff",
    base,
    head,
    "--",
  );
  for (const row of stats.split("\0")) {
    if (!row) continue;
    const [added, removed, name] = row.split("\t");
    let reasons;
    if (added === "-" && removed === "-") {
      reasons = causes(name, modes.get(name) ?? new Set(), engineRun.suffixes);
      if (!reasons.length) {
        binaryFileReasons += 1; // BINARY_FILE high-risk reason, not a gap
        continue;
      }
    } else if (!/^\d+$/u.test(added) || !/^\d+$/u.test(removed)) {
      reasons = ["unreadable-numstat"];
    } else continue;
    signals.push({
      path: name,
      causes: reasons,
      classifier: classes.get(name) ?? "not-in-classifier",
    });
  }
  const count = (values) =>
    Object.fromEntries([
      ...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map()),
    ]);
  const byClass = count(signals.map((s) => s.classifier));
  return {
    engine_version: engineRun.version,
    base,
    head,
    engine: engineRun.engine,
    binary_file_reasons: binaryFileReasons,
    gap_paths: signals.length,
    by_cause: count(signals.flatMap((s) => s.causes)),
    by_classifier: byClass,
    unexplained: signals.filter((s) =>
      ["unclassified", "not-in-classifier"].includes(s.classifier),
    ),
    examples: Object.fromEntries(
      Object.keys(byClass).map((c) => [
        c,
        signals.filter((s) => s.classifier === c).slice(0, 3),
      ]),
    ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.length !== 4) {
    console.error("usage: reproduce-getzilla-false-signals.mjs BASE HEAD");
    process.exit(2);
  }
  console.log(
    JSON.stringify(reproduce(process.argv[2], process.argv[3]), null, 1),
  );
}
