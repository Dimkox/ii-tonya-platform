#!/usr/bin/env node
// Verify the machine-checkable part of the Claw evidence bundles.
//
// Every bundle under docs/test-evidence/claw/ claims that a gate ran on a specific
// commit. Most of them only contain prose. This script checks the ones that carry
// hashes, and reports how many carry nothing that can be re-checked at all, so that
// number can be pinned by a test instead of remembered by an operator.
//
// Exit code 1 when a manifest does not match, when a manifest lists a file that is
// not in the bundle, or when a deviation is not covered by a reasoned exemption.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const EVIDENCE_ROOT = "docs/test-evidence/claw";
const EXEMPTIONS_FILE = "docs/test-evidence/claw-exemptions.json";
// ARTIFACTS.sha256 lists files that must sit next to it. remote-SHA256SUMS lists the
// raw per-step logs of the remote run, which are deliberately not committed - its
// purpose is that whoever holds those logs can re-check them - so an absent target is
// counted, not failed. A present target must still match.
const IN_BUNDLE_MANIFEST = "ARTIFACTS.sha256";
const EXTERNAL_MANIFEST = "remote-SHA256SUMS";
const HASH_MANIFESTS = [IN_BUNDLE_MANIFEST, EXTERNAL_MANIFEST];
const MACHINE_CHECKABLE = [
  IN_BUNDLE_MANIFEST,
  EXTERNAL_MANIFEST,
  "summary.tsv",
  "environment.txt",
];

const asJson = process.argv.includes("--json");

const manifestEntries = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const digest = line.slice(0, 64);
      // sha256sum writes "<hash>  <name>" (two spaces) or "<hash> *<name>" for binary mode.
      const name = line
        .slice(64)
        .replace(/^\s*\*?\s*/, "")
        .replace(/^\.\//, "");
      return { digest, name };
    })
    .filter((entry) => entry.digest.length === 64 && entry.name.length > 0);

const sha256Of = (path) =>
  execFileSync("sha256sum", [path], { encoding: "utf8" })
    .trim()
    .split(/\s+/)[0];

const loadExemptions = () => {
  if (!existsSync(EXEMPTIONS_FILE)) {
    return { exemptions: [] };
  }
  return JSON.parse(readFileSync(EXEMPTIONS_FILE, "utf8"));
};

const dirs = readdirSync(EVIDENCE_ROOT)
  .filter((name) => statSync(join(EVIDENCE_ROOT, name)).isDirectory())
  .sort();

const exemptions = loadExemptions().exemptions ?? [];
const exemptionFor = (dir) => exemptions.find((item) => item.dir === dir);

const failures = [];
const usedExemptions = new Set();
const checkedManifests = [];
let machineVerifiable = 0;
let proseOnly = 0;
let externalAbsent = 0;

for (const dir of dirs) {
  const bundle = join(EVIDENCE_ROOT, dir);
  const files = readdirSync(bundle).sort();
  if (files.some((name) => MACHINE_CHECKABLE.includes(name))) {
    machineVerifiable += 1;
  } else {
    proseOnly += 1;
  }

  for (const manifestName of HASH_MANIFESTS) {
    const manifestPath = join(bundle, manifestName);
    if (!existsSync(manifestPath)) {
      continue;
    }
    for (const entry of manifestEntries(readFileSync(manifestPath, "utf8"))) {
      const target = join(bundle, entry.name);
      const record = { dir, manifest: manifestName, file: entry.name };
      checkedManifests.push(record);
      if (!existsSync(target)) {
        if (manifestName === EXTERNAL_MANIFEST) {
          externalAbsent += 1;
          record.status = "external";
          continue;
        }
        record.status = "missing";
        record.expected = entry.digest;
        failures.push(record);
        continue;
      }
      const actual = sha256Of(target);
      if (actual === entry.digest) {
        record.status = "ok";
        continue;
      }
      const exemption = exemptionFor(dir);
      const covered = exemption?.deviations?.some((item) => {
        const matches =
          item.file === entry.name &&
          item.hashAtManifestTime === entry.digest &&
          item.hashNow === actual;
        if (matches) {
          usedExemptions.add(`${dir}/${entry.name}`);
        }
        return matches;
      });
      record.status = covered ? "exempt" : "mismatch";
      record.expected = entry.digest;
      record.actual = actual;
      if (!covered) {
        failures.push({
          ...record,
          hint:
            exemption === undefined
              ? "no exemption entry for this bundle; the manifest was written before the file changed"
              : "exemption exists but does not cover this file/hash pair",
        });
      }
    }
  }
}

// An exemption whose deviation no longer exists is stale: either the bundle was
// repaired or the file drifted again. Both mean the entry must go, so that the
// registry cannot quietly accumulate accepted lies.
for (const exemption of exemptions) {
  for (const deviation of exemption.deviations ?? []) {
    const key = `${exemption.dir}/${deviation.file}`;
    if (!usedExemptions.has(key)) {
      failures.push({
        dir: exemption.dir,
        file: deviation.file,
        status: "stale-exemption",
        hint: "no matching deviation found; remove this entry or re-record the hashes",
      });
    }
  }
}

const summary = {
  bundles: dirs.length,
  machineVerifiable,
  proseOnly,
  manifestEntriesChecked: checkedManifests.length,
  externalLogEntries: externalAbsent,
  failures: failures.length,
  exemptionsUsed: exemptions.length,
};

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ status: failures.length === 0 ? 0 : 1, summary, failures }, null, 2)}\n`,
  );
} else {
  process.stdout.write(
    `bundles=${summary.bundles} machine-verifiable=${summary.machineVerifiable} prose-only=${summary.proseOnly} manifest-entries=${summary.manifestEntriesChecked} external-log-entries=${summary.externalLogEntries} failures=${summary.failures}\n`,
  );
  for (const failure of failures) {
    process.stdout.write(
      `  ${failure.dir}/${failure.file}: ${failure.status} (manifest ${failure.manifest}) expected ${failure.expected.slice(0, 12)} got ${failure.actual?.slice(0, 12) ?? "missing"}${failure.hint ? ` - ${failure.hint}` : ""}\n`,
    );
  }
  const unresolved = checkedManifests.filter(
    (item) => item.status === "missing" || item.status === "mismatch",
  );
  const covered = checkedManifests.filter(
    (item) => item.status === "exempt",
  ).length;
  if (covered > 0) {
    process.stdout.write(
      `  ${covered} deviation(s) covered by documented exemptions in ${relative(process.cwd(), EXEMPTIONS_FILE)}\n`,
    );
  }
  if (unresolved.length > 0) {
    process.stdout.write(`  unresolved: ${unresolved.length}\n`);
  }
}

process.exitCode = failures.length === 0 ? 0 : 1;
