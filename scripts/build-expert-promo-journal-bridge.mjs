#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourcePath = "scripts/build-expert-promo-journal-bridge.mjs";
const previous = {
  source: "cf8bab328306b6d6245a09c0991c69f1897d16e0",
  archive: "dc7dd9e7006aa545a7be66b965581d61a59253ce5b05fb6b5b85ca9c08ca95f0",
  migrationsTree: "f6b2bb51502b94630c5f8f2b0a3cd29cba2789c0",
  journal: "767edd7f787fea59bc9f04ebc32465c1fd2b5bdc2b57e522b3f43c9f12bd1116",
};
const reviewed = {
  source: "2bf7ddcebb7b7242ad4febf01987d1ab5739a1a7",
  migrationsTree: "6eb480e96396e71bc0458088c244cb241c939846",
  journal: "17b5ad3e1d69ad6b73c9091b4025b62a1639e2d567ee36ab1fb76455bb8b1640",
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Hashes bind the ordered list of every timestamp and SQL digest. A partial
// 0091, drifted row, or later schema requires separate operator recovery.
function journalDigest(rows) {
  return sha256(
    JSON.stringify(rows.map(({ hash, created_at }) => ({ hash, created_at }))),
  );
}
export async function assertJournal(db) {
  const { rows } = await db.$client.query(
    "select hash, created_at::text from drizzle.__drizzle_migrations order by id",
  );
  const digest = journalDigest(rows);
  if (
    !(rows.length === 91 && digest === previous.journal) &&
    !(rows.length === 93 && digest === reviewed.journal)
  )
    throw new Error("bridge_migration_history_reconciliation_required");
}
export function workerEnvironment(env) {
  // cf8 has one inseparable old gift/reminder dispatcher. Leave its work unclaimed.
  return { ...env, WAITLIST_FUNNEL_V4_ENABLED: "false" };
}
export const databaseFacadeSource =
  'export * from "@ii-tonya/db";\nexport {assertJournal as migrateDb} from "./expert-promo-bridge.mjs";\n';

async function startApi() {
  const entry = new URL("./dist/server.js", import.meta.url).href;
  const facade = new URL("./journal-db.mjs", import.meta.url).href;
  let redirected = false;
  // Only the static DB import made by this exact API entrypoint is adapted.
  // All other consumers use the archived DB package, including gateway actors.
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === entry && specifier === "@ii-tonya/db") {
        redirected = true;
        return { url: facade, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  let api;
  try {
    api = await import(entry);
  } finally {
    hook.deregister();
  }
  if (!redirected) throw Error("archived API migration import not found");
  return api.main();
}

export async function runRuntime(mode) {
  if (!["api", "worker", "migrate"].includes(mode))
    throw Error("invalid bridge runtime");
  if (mode === "api") return startApi();
  const validateOnly = process.argv.includes("--validate-config");
  // Reuse cf8's original URL/timeout validation without ever invoking its migrator.
  if (!validateOnly) process.argv.push("--validate-config");
  try {
    await import("./migrate-cf8.mjs");
  } finally {
    if (!validateOnly) process.argv.pop();
  }
  if (validateOnly) return;
  const { createDb, closeDb } = await import("@ii-tonya/db");
  const db = createDb(process.env.DATABASE_URL, {
    options: "-c lock_timeout=10000 -c statement_timeout=10000",
    connectionTimeoutMillis: 10000,
  });
  try {
    await assertJournal(db);
  } finally {
    await closeDb(db);
  }
  if (mode === "worker") {
    const worker = await import("../worker/dist/main.js");
    await worker.main({ env: workerEnvironment(process.env) });
  }
}

async function build() {
  const { archiveSource, hashFile } =
    await import("./early-bird-bridge/archive-hash.mjs");
  const { validateMigrationTag } =
    await import("./early-bird-bridge/migration-tags.mjs");
  const {
    SOURCE_SHA: source,
    OLD_RELEASE_ARCHIVE: archive,
    OUTPUT_DIR,
  } = process.env;
  const git = (...args) => execFileSync("git", args);
  if (
    !source ||
    !/^[a-f0-9]{40}$/.test(source) ||
    git("rev-parse", "HEAD").toString().trim() !== source ||
    git("status", "--porcelain", "--untracked-files=no").length
  )
    throw Error("a clean committed bridge source is required");
  if (!archive || (await hashFile(archive)) !== previous.archive)
    throw Error("wrong cf8 release archive");
  if (!OUTPUT_DIR || existsSync(OUTPUT_DIR))
    throw Error("a new OUTPUT_DIR is required");
  const output = resolve(OUTPUT_DIR);
  mkdirSync(dirname(output), { recursive: true });
  const stage = mkdtempSync(join(dirname(output), ".promo-bridge-"));
  const work = mkdtempSync(join(tmpdir(), "promo-bridge-"));
  const bundle = join(work, "release");
  try {
    mkdirSync(bundle);
    const sourceTar = join(work, "source.tar");
    archiveSource(source, sourceTar);
    execFileSync("tar", [
      "-xzf",
      resolve(archive),
      "-C",
      bundle,
      "--no-same-owner",
      "--no-same-permissions",
    ]);
    const read = (file) => readFileSync(join(bundle, file), "utf8");
    const write = (file, bytes) => writeFileSync(join(bundle, file), bytes);
    const oldProvenance = JSON.parse(read("provenance.json"));
    if (
      read("SOURCE_SHA").trim() !== previous.source ||
      oldProvenance.source_sha !== previous.source ||
      oldProvenance.format !== "ii-tonya-native-v1" ||
      oldProvenance.profile !== undefined
    )
      throw Error("wrong cf8 provenance");
    const rows = JSON.parse(read("migrations/meta/_journal.json")).entries.map(
      (entry, index) => {
        if (!validateMigrationTag(entry, index))
          throw Error("invalid cf8 migration entry");
        return {
          hash: sha256(
            readFileSync(join(bundle, "migrations", entry.tag + ".sql")),
          ),
          created_at: String(entry.when),
        };
      },
    );
    if (rows.length !== 91 || journalDigest(rows) !== previous.journal)
      throw Error("wrong cf8 schema");
    write(
      "api/expert-promo-bridge.mjs",
      git("show", source + ":" + sourcePath),
    );
    write("api/journal-db.mjs", databaseFacadeSource);
    renameSync(
      join(bundle, "api/migrate-native.mjs"),
      join(bundle, "api/migrate-cf8.mjs"),
    );
    write(
      "api/migrate-native.mjs",
      "import {runRuntime} from './expert-promo-bridge.mjs'; await runRuntime('migrate');\n",
    );
    for (const [service, entry] of [
      ["api", "api/dist/server.js"],
      ["worker", "worker/dist/main.js"],
    ]) {
      const file = "systemd/ii-tonya-" + service + ".service";
      const unit = read(file),
        line = "ExecStart=/usr/bin/node " + entry;
      if (
        unit
          .split("\n")
          .filter((x) => x.startsWith("ExecStart="))
          .join("\n") !== line
      )
        throw Error("unexpected cf8 unit");
      write(
        file,
        unit.replace(
          line,
          "ExecStart=/usr/bin/node api/expert-promo-bridge.mjs " + service,
        ),
      );
    }
    // The standard native payment/gateway policy is unchanged. This metadata
    // identifies the separate journal bridge and its immutable business inputs.
    const provenance = {
      format: "ii-tonya-native-v1",
      source_sha: source,
      source_archive_sha256: await hashFile(sourceTar),
      journal_bridge: {
        kind: "expert-promo-0090-to-0092-v1",
        runtime: previous,
        accepted_target: reviewed,
        api_entry_sha256: await hashFile(join(bundle, "api/dist/server.js")),
        worker_entry_sha256: await hashFile(
          join(bundle, "worker/dist/main.js"),
        ),
        startup_adapter_sha256: await hashFile(
          join(bundle, "api/expert-promo-bridge.mjs"),
        ),
        api_migration_facade_sha256: sha256(databaseFacadeSource),
        runtime_source_archive_sha256: oldProvenance.source_archive_sha256,
      },
    };
    write("SOURCE_SHA", source + "\n");
    write("provenance.json", JSON.stringify(provenance) + "\n");
    const tar = "native-release.tar.gz",
      sbom = "native-release.spdx.json",
      prov = "native-release.provenance.json";
    execFileSync("tar", [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-C",
      bundle,
      "-czf",
      join(stage, tar),
      ".",
    ]);
    copyFileSync(join(bundle, "provenance.json"), join(stage, prov));
    execFileSync(
      "syft",
      ["dir:" + bundle, "-o", "spdx-json=" + join(stage, sbom)],
      { stdio: "inherit" },
    );
    const checks = [];
    for (const name of [tar, sbom, prov])
      checks.push((await hashFile(join(stage, name))) + "  " + name);
    writeFileSync(
      join(stage, "native-release.sha256"),
      checks.join("\n") + "\n",
    );
    renameSync(stage, output);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(stage, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv[2] === "build") await build();
  else {
    // Finish evaluating this module before the API's DB facade re-exports
    // assertJournal from it. Awaiting API startup here would create an ESM cycle.
    void runRuntime(process.argv[2]).catch(() => {
      console.error("Native journal bridge startup failed.");
      process.exitCode = 1;
    });
  }
}
