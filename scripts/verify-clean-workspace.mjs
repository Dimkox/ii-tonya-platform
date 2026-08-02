import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runPnpm } from "./lib/run-pnpm.mjs";

const sourceRoot = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "ii-tonya-clean-"));
const copyRoot = join(scratch, "repo");
const excluded = new Set([".git", "node_modules", "dist", "coverage", ".turbo"]);

const run = (args) => {
  runPnpm(args, { cwd: copyRoot });
  return true;
};

try {
  cpSync(sourceRoot, copyRoot, {
    recursive: true,
    filter: (source) => {
      const parts = relative(sourceRoot, source).split(sep);
      if (parts.some((part) => excluded.has(part))) return false;
      const name = basename(source);
      return name === ".env.example" || !name.startsWith(".env");
    },
  });
  if (!run(["install", "--frozen-lockfile"])) throw new Error("clean install failed");
  if (!run(["build"])) throw new Error("clean build failed");
  if (!run(["typecheck"])) throw new Error("clean typecheck failed");
  for (const packageRoot of [
    "application", "config", "contracts", "db",
    "domain", "integrations", "observability", "worker",
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", "await import('./dist/index.js')"],
      { cwd: join(copyRoot, "packages", packageRoot), stdio: "inherit", shell: false },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`clean runtime import failed: ${packageRoot}`);
  }
} finally {
  const relativeScratch = relative(tmpdir(), scratch);
  if (!relativeScratch.startsWith("ii-tonya-clean-") || relativeScratch.includes(sep)) {
    throw new Error("refusing to remove an unexpected path");
  }
  rmSync(scratch, { recursive: true, force: true });
}
