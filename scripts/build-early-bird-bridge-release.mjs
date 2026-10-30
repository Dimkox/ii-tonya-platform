#!/usr/bin/env node
// Build only from committed source and the pinned immutable old release archive.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { archiveSource, hashFile } from "./early-bird-bridge/archive-hash.mjs";
import { validateMigrationTag } from "./early-bird-bridge/migration-tags.mjs";

const sourceSha = process.env.SOURCE_SHA;
const oldArchive = resolve(process.env.OLD_RELEASE_ARCHIVE || "");
const output = resolve(process.env.OUTPUT_DIR || ".native-bridge-release");
const oldSha = "19ecb3456a647743f00584b14d097c2759f0d718";
const oldArchiveHash =
  "b8492c38c81b74eeeb72c956aac9b10d3889bdea0c814cbcb7ed7d07a906061a";
const hash = (data) => createHash("sha256").update(data).digest("hex");
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    stdio: "pipe",
    maxBuffer: 100 * 1024 * 1024,
    ...opts,
  });
if (
  !/^[a-f0-9]{40}$/.test(sourceSha || "") ||
  run("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== sourceSha
)
  throw Error("SOURCE_SHA must identify HEAD");
if ((await hashFile(oldArchive)) !== oldArchiveHash)
  throw Error("old archive digest mismatch");
const tmp = mkdtempSync(join(tmpdir(), "ii-tonya-bridge-"));
try {
  const src = join(tmp, "source");
  const bundle = join(tmp, "release");
  mkdirSync(src);
  mkdirSync(bundle);
  mkdirSync(output, { recursive: true });
  const sourceTar = join(tmp, "source.tar");
  archiveSource(sourceSha, sourceTar);
  const sourceArchiveHash = await hashFile(sourceTar);
  run("tar", ["-xf", sourceTar, "-C", src]);
  run("tar", [
    "-xzf",
    oldArchive,
    "-C",
    bundle,
    "--no-same-owner",
    "--no-same-permissions",
  ]);
  if (readFileSync(join(bundle, "SOURCE_SHA"), "utf8").trim() !== oldSha)
    throw Error("old release SHA mismatch");
  function rows(folder) {
    const journal = JSON.parse(
      readFileSync(join(folder, "meta/_journal.json"), "utf8"),
    );
    return journal.entries.map((entry, idx) => {
      if (!validateMigrationTag(entry, idx)) throw Error("invalid journal");
      return {
        hash: hash(readFileSync(join(folder, entry.tag + ".sql"))),
        created_at: String(entry.when),
      };
    });
  }
  const old = rows(join(bundle, "migrations"));
  const candidate = rows(join(src, "packages/db/migrations"));
  if (
    old.length !== 76 ||
    candidate.length <= old.length ||
    JSON.stringify(old) !== JSON.stringify(candidate.slice(0, old.length))
  )
    throw Error("candidate history is not exact old prefix");
  const bridge = join(bundle, "api/bridge");
  mkdirSync(bridge, { recursive: true });
  for (const name of ["runtime.mjs", "journal-validation.mjs"])
    cpSync(join(src, "scripts/early-bird-bridge", name), join(bridge, name));
  writeFileSync(
    join(bridge, "approved-journals.json"),
    JSON.stringify({ old, candidate }) + "\n",
  );
  // Both native migrate service and deploy validation use this same read-only entry.
  writeFileSync(
    join(bundle, "api/migrate-native.mjs"),
    "process.argv.splice(2,0,'migrate'); await import('./bridge/runtime.mjs');\n",
  );
  mkdirSync(join(bundle, "systemd"), { recursive: true });
  for (const [name, from, to] of [
    [
      "api",
      "ExecStart=/usr/bin/node api/dist/server.js",
      "ExecStart=/usr/bin/node api/bridge/runtime.mjs api",
    ],
    [
      "worker",
      "ExecStart=/usr/bin/node worker/dist/main.js",
      "ExecStart=/usr/bin/node api/bridge/runtime.mjs worker",
    ],
    ["migrate", null, null],
  ]) {
    let unit = readFileSync(
      join(src, "deploy/systemd", `ii-tonya-${name}.service`),
      "utf8",
    );
    if (from) {
      if (!unit.includes(from)) throw Error("unit entrypoint mismatch");
      unit = unit.replace(from, to);
    }
    writeFileSync(join(bundle, "systemd", `ii-tonya-${name}.service`), unit);
  }
  mkdirSync(join(bundle, "scripts"), { recursive: true });
  cpSync(
    join(src, "scripts/validate-runtime-env.sh"),
    join(bundle, "scripts/validate-runtime-env.sh"),
  );
  writeFileSync(join(bundle, "SOURCE_SHA"), sourceSha + "\n");
  const provenance = {
    source_sha: sourceSha,
    source_archive_sha256: sourceArchiveHash,
    format: "ii-tonya-native-v1",
    profile: "early-bird-compatibility-bridge-v1",
    runtime_source_sha: oldSha,
    old_release_sha256: oldArchiveHash,
  };
  writeFileSync(
    join(bundle, "provenance.json"),
    JSON.stringify(provenance) + "\n",
  );
  run("tar", [
    "--sort=name",
    "--mtime=UTC 1970-01-01",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-C",
    bundle,
    "-czf",
    join(output, "native-release.tar.gz"),
    ".",
  ]);
  cpSync(
    join(bundle, "provenance.json"),
    join(output, "native-release.provenance.json"),
  );
  run("syft", [
    `dir:${bundle}`,
    "-o",
    `spdx-json=${join(output, "native-release.spdx.json")}`,
  ]);
  const names = [
    "native-release.tar.gz",
    "native-release.spdx.json",
    "native-release.provenance.json",
  ];
  writeFileSync(
    join(output, "native-release.sha256"),
    (
      await Promise.all(
        names.map(async (n) => `${await hashFile(join(output, n))}  ${n}\n`),
      )
    ).join(""),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
