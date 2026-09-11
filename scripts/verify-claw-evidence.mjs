#!/usr/bin/env node
// Verify the machine-checkable part of the Claw evidence bundles.
//
// Every bundle under docs/test-evidence/claw/ claims that a gate ran on a specific
// commit. Most of them only contain prose. This script checks the ones that carry
// hashes, and reports how many carry nothing that can be re-checked at all, so that
// number can be pinned by a test instead of remembered by an operator.
//
// Exit code 1 when a manifest does not match, when a manifest lists a file that is
// not in the bundle, when a deviation is not covered by a reasoned exemption, when a
// machine-checkable bundle records no gate step beyond the dependency install (#81), or when
// a recorded exemption or step-coverage waiver no longer matches the bundle it describes.

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
// Step logs and environment snapshots exist per gate mode since #81: one SHA can carry
// summary-ci.tsv, summary-release.tsv, environment-release.txt and so on side by side. The
// names the pre-#81 runner wrote (summary.tsv, environment.txt) stay accepted, so the bundles
// already committed classify and verify exactly as they did before this change - history is
// not renamed.
const STEP_LOG = /^summary(?:-[a-z0-9][a-z0-9_.-]*)?\.tsv$/u;
const ENVIRONMENT_SNAPSHOT = /^environment(?:-[a-z0-9][a-z0-9_.-]*)?\.txt$/u;
const ALWAYS_MACHINE_CHECKABLE = new Set([
  IN_BUNDLE_MANIFEST,
  EXTERNAL_MANIFEST,
]);
const isStepLog = (name) => STEP_LOG.test(name);
const isMachineCheckableName = (name) =>
  ALWAYS_MACHINE_CHECKABLE.has(name) ||
  isStepLog(name) ||
  ENVIRONMENT_SNAPSHOT.test(name);
// `step <name> <command...>` in the runner records "<name>\t<exit>\t<started>\t<finished>".
// The install step is present in every mode's log by design, so a log whose only names are
// install steps proves that dependencies were fetched and nothing was verified (#81).
const INSTALL_STEP_NAME = /(?:^|[-_])install(?:[-_]|$)/u;
const isInstallStep = (name) => INSTALL_STEP_NAME.test(name);

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

// Recorded step names of one log, in file order. A hand-made log may open with a tab
// separated header (bundle c560cbb starts with "step  status  test_files  ..."), which
// is not a step. An empty log records nothing and returns an empty list.
const stepNamesOf = (path) => {
  const names = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const fields = line.split("\t").map((field) => field.trim());
    const [name, second] = fields;
    if (name === "step" && second === "status") {
      continue;
    }
    if (name.length === 0) {
      continue;
    }
    names.push(name);
  }
  return names;
};

const loadRegistry = () => {
  if (!existsSync(EXEMPTIONS_FILE)) {
    return {};
  }
  return JSON.parse(readFileSync(EXEMPTIONS_FILE, "utf8"));
};

const registry = loadRegistry();
const exemptions = registry.exemptions ?? [];
const exemptionFor = (dir) => exemptions.find((item) => item.dir === dir);
// Step-coverage waivers: a bundle whose recorded steps prove nothing beyond the install step.
// Such a bundle is a failure like any other unless this registry names it together with the
// exact step-log hashes and the exact step list it is frozen at, so a waiver cannot outlive
// the state it describes: regenerate the bundle and the pair stops matching, which reports
// both the failure and a stale waiver.
const stepWaivers = registry.stepCoverageWaivers ?? [];
const stepWaiverFor = (dir) => stepWaivers.find((item) => item.dir === dir);

const sameList = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  JSON.stringify(a) === JSON.stringify(b);

// A waiver covers the install-only state of a bundle only while every step log the bundle
// holds is listed with its current hash and the union of recorded steps is unchanged.
const stepWaiverCovers = (waiver, bundle, stepLogs, recordedSteps) => {
  if (waiver === undefined) {
    return false;
  }
  const listed = waiver.stepLogs ?? [];
  if (
    !sameList(
      listed.map((item) => item?.file),
      stepLogs,
    )
  ) {
    return false;
  }
  for (const item of listed) {
    const target = join(bundle, item.file);
    if (!isStepLog(item.file) || !existsSync(target)) {
      return false;
    }
    if (sha256Of(target) !== item.hash) {
      return false;
    }
  }
  return sameList(waiver.recordedSteps, recordedSteps);
};

const dirs = readdirSync(EVIDENCE_ROOT)
  .filter((name) => statSync(join(EVIDENCE_ROOT, name)).isDirectory())
  .sort();

const failures = [];
const waivedDeviations = [];
const usedExemptions = new Set();
const usedStepWaivers = new Set();
const checkedManifests = [];
let machineVerifiable = 0;
let proseOnly = 0;
let externalAbsent = 0;
let bundlesWithStepLog = 0;
let stepRecords = 0;
let machineCheckableWithoutSteps = 0;

for (const dir of dirs) {
  const bundle = join(EVIDENCE_ROOT, dir);
  const files = readdirSync(bundle).sort();
  const checkable = files.some(isMachineCheckableName);
  if (checkable) {
    machineVerifiable += 1;
  } else {
    proseOnly += 1;
  }

  const stepLogs = files.filter(isStepLog);
  if (stepLogs.length > 0) {
    bundlesWithStepLog += 1;
  }
  const recordedSteps = stepLogs.flatMap((name) =>
    stepNamesOf(join(bundle, name)),
  );
  stepRecords += recordedSteps.length;
  if (checkable && recordedSteps.length === 0) {
    machineCheckableWithoutSteps += 1;
  }
  // Only bundles that actually recorded steps are judged. A bundle with no step log makes no
  // machine-checkable claim about what was run (most of them are hand-made prose), and
  // counting a log that was never written as a lie would condemn those retroactively; the
  // gap stays visible as machineCheckableWithoutSteps instead.
  if (
    checkable &&
    recordedSteps.length > 0 &&
    recordedSteps.every(isInstallStep)
  ) {
    const waiver = stepWaiverFor(dir);
    if (stepWaiverCovers(waiver, bundle, stepLogs, recordedSteps)) {
      usedStepWaivers.add(dir);
      waivedDeviations.push({
        dir,
        status: "install-only-steps",
        files: stepLogs,
        recordedSteps,
        reason: waiver.reason,
      });
    } else {
      failures.push({
        dir,
        file: stepLogs.join(","),
        status: "install-only-steps",
        recordedSteps,
        hint:
          "the bundle records no gate step beyond the dependency install, so it proves " +
          "nothing was verified; recorded steps: " +
          recordedSteps.join(", ") +
          ". Either regenerate the bundle or add a reasoned stepCoverageWaivers entry.",
      });
    }
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
      if (covered) {
        waivedDeviations.push({
          dir,
          manifest: manifestName,
          file: entry.name,
          status: "exempt",
          hashAtManifestTime: entry.digest,
          hashNow: actual,
          reason: exemption.reason,
        });
      } else {
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

// Same rule for step-coverage waivers: a waiver that no longer matches the bundle means the
// bundle was regenerated (good news, delete the entry) or drifted in a way nobody recorded
// (bad news, look at it).
for (const waiver of stepWaivers) {
  if (!usedStepWaivers.has(waiver.dir)) {
    failures.push({
      dir: waiver.dir,
      file: (waiver.stepLogs ?? []).map((item) => item?.file).join(","),
      status: "stale-step-waiver",
      hint: "no install-only step evidence matches this waiver; remove the entry or re-record the step-log hashes",
    });
  }
}

const summary = {
  bundles: dirs.length,
  machineVerifiable,
  proseOnly,
  manifestEntriesChecked: checkedManifests.length,
  externalLogEntries: externalAbsent,
  bundlesWithStepLog,
  stepRecords,
  machineCheckableWithoutSteps,
  stepCoverageWaivers: stepWaivers.length,
  failures: failures.length,
  exemptionsUsed: exemptions.length,
};

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ status: failures.length === 0 ? 0 : 1, summary, failures, deviations: waivedDeviations }, null, 2)}\n`,
  );
} else {
  process.stdout.write(
    `bundles=${summary.bundles} machine-verifiable=${summary.machineVerifiable} prose-only=${summary.proseOnly} manifest-entries=${summary.manifestEntriesChecked} external-log-entries=${summary.externalLogEntries} step-bundles=${summary.bundlesWithStepLog} steps=${summary.stepRecords} failures=${summary.failures}\n`,
  );
  for (const failure of failures) {
    if (failure.manifest === undefined) {
      process.stdout.write(
        `  ${failure.dir}/${failure.file}: ${failure.status}${failure.hint ? ` - ${failure.hint}` : ""}\n`,
      );
      continue;
    }
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
  const stepCoverageWaived = waivedDeviations.filter(
    (item) => item.status === "install-only-steps",
  ).length;
  if (stepCoverageWaived > 0) {
    process.stdout.write(
      `  ${stepCoverageWaived} bundle(s) record install-only step evidence, covered by stepCoverageWaivers in ${relative(process.cwd(), EXEMPTIONS_FILE)}; regenerate them on the next gate run so this number can drop\n`,
    );
  }
  if (summary.machineCheckableWithoutSteps > 0) {
    process.stdout.write(
      `  ${summary.machineCheckableWithoutSteps} machine-checkable bundle(s) carry no recorded step at all (not judged: they make no machine-checkable step claim)\n`,
    );
  }
  if (unresolved.length > 0) {
    process.stdout.write(`  unresolved: ${unresolved.length}\n`);
  }
}

process.exitCode = failures.length === 0 ? 0 : 1;
