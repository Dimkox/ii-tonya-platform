import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const VERIFIER = "scripts/verify-claw-evidence.mjs";
// Absolute, because the fixture runs report against a throwaway working directory.
const VERIFIER_PATH = resolve(VERIFIER);
const EXEMPTIONS = "docs/test-evidence/claw-exemptions.json";
const EVIDENCE_ROOT = "docs/test-evidence/claw";
const HEX64 = /^[0-9a-f]{64}$/;

type Failure = {
  dir: string;
  file: string;
  status: string;
  recordedSteps?: string[];
};

type Summary = {
  bundles: number;
  machineVerifiable: number;
  proseOnly: number;
  manifestEntriesChecked: number;
  externalLogEntries: number;
  bundlesWithStepLog: number;
  stepRecords: number;
  machineCheckableWithoutSteps: number;
  stepCoverageWaivers: number;
  failures: number;
  exemptionsUsed: number;
};

type Waiver = {
  dir: string;
  reason: string;
  resolution: string;
  stepLogs: { file: string; hash: string }[];
  recordedSteps: string[];
};

type Report = {
  status: number;
  summary: Summary;
  failures: Failure[];
  deviations: { dir: string; status: string }[];
};

const interpret = (child: {
  status: number | null;
  stdout: string;
  stderr: string;
}): Report => {
  expect(child.stderr, "verifier must not write to stderr").toBe("");
  const parsed = JSON.parse(child.stdout) as Report;
  expect(parsed.status).toBe(child.status ?? 0);
  return parsed;
};

const run = (): Report =>
  interpret(
    spawnSync(process.execPath, [VERIFIER, "--json"], { encoding: "utf8" }),
  );

// A fixture bundle in a throwaway tree: the verifier resolves its evidence root relatively,
// so the rules can be exercised without writing into docs/test-evidence/claw.
const sha = (seed: string): string => seed.repeat(40).slice(0, 40);
const stepLine = (name: string): string =>
  `${name}\t0\t2026-09-11T00:00:00Z\t2026-09-11T00:01:00Z\n`;

const fixture = async (
  bundle: string,
  files: Record<string, string>,
  registry?: unknown,
): Promise<{ root: string; report: () => Report }> => {
  const root = await mkdtemp(join(tmpdir(), "claw-evidence-"));
  const dir = join(root, EVIDENCE_ROOT, bundle);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  if (registry !== undefined) {
    mkdirSync(join(root, "docs/test-evidence"), { recursive: true });
    writeFileSync(
      join(root, EXEMPTIONS),
      `${JSON.stringify(registry, null, 2)}\n`,
    );
  }
  return {
    root,
    report: () =>
      interpret(
        spawnSync(process.execPath, [VERIFIER_PATH, "--json"], {
          encoding: "utf8",
          cwd: root,
        }),
      ),
  };
};

// Recomputed here with node:crypto rather than the sha256sum the verifier shells out to, so
// a pin checks the file and not just the tool that wrote it.
const sha256File = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("claw evidence integrity", () => {
  const result = run();

  it("has no unexplained deviation in any evidence bundle", () => {
    expect(result.summary.failures, JSON.stringify(result.failures)).toBe(0);
    expect(result.status).toBe(0);
  });

  it("keeps the machine-checkable coverage as a floor, never a ceiling", () => {
    // 24 of 28 bundles are prose only: nothing an outside reviewer can re-check.
    // Raising coverage is the point of #51, so the number is pinned from below.
    // The runner now seals its own bundle, so a generated run counts too.
    expect(result.summary.machineVerifiable).toBeGreaterThanOrEqual(3);
    expect(result.summary.manifestEntriesChecked).toBeGreaterThanOrEqual(26);
    expect(result.summary.proseOnly).toBe(
      result.summary.bundles - result.summary.machineVerifiable,
    );
    expect(result.summary.bundles).toBeGreaterThanOrEqual(27);
    // #81 raised the floor from "a bundle carries hashes" to "a bundle carries steps that
    // prove a gate ran": every committed step log now counts towards measurable coverage,
    // so the recorded-step total is pinned as well. Both numbers only ever grow: adding a
    // bundle cannot lower them, deleting recorded steps can.
    expect(result.summary.bundlesWithStepLog).toBeGreaterThanOrEqual(4);
    expect(result.summary.bundlesWithStepLog).toBeLessThanOrEqual(
      result.summary.machineVerifiable,
    );
    expect(result.summary.stepRecords).toBeGreaterThanOrEqual(36);
    expect(result.summary.stepRecords).toBeGreaterThanOrEqual(
      result.summary.bundlesWithStepLog,
    );
  });

  it("documents every exemption with both hashes and a reason", () => {
    const registry = JSON.parse(readFileSync(EXEMPTIONS, "utf8")) as {
      exemptions: {
        dir: string;
        reason: string;
        resolution: string;
        deviations: {
          file: string;
          hashAtManifestTime: string;
          hashNow: string;
        }[];
      }[];
    };
    // Growth here is a regression in trust, not progress: each entry means one
    // bundle that no longer proves what it claims.
    expect(registry.exemptions.length).toBeLessThanOrEqual(1);
    for (const exemption of registry.exemptions) {
      expect(exemption.dir).toMatch(/^[0-9a-f]{40}$|^[\w.-]+$/);
      expect(exemption.reason.length).toBeGreaterThan(40);
      expect(exemption.resolution.length).toBeGreaterThan(10);
      expect(exemption.deviations.length).toBeGreaterThan(0);
      for (const deviation of exemption.deviations) {
        expect(deviation.file).toMatch(/\.md$|\.tsv$|\.txt$/);
        expect(deviation.hashAtManifestTime).toMatch(HEX64);
        expect(deviation.hashNow).toMatch(HEX64);
        expect(deviation.hashNow).not.toBe(deviation.hashAtManifestTime);
      }
    }
  });

  it("reports the known bundle drift with the exact hashes involved", () => {
    // Proves the verifier actually looks at content: the registry entry is only
    // accepted while both recorded hashes are the real pair.
    const { exemptions } = JSON.parse(readFileSync(EXEMPTIONS, "utf8")) as {
      exemptions: { dir: string }[];
    };
    expect(exemptions.map((item) => item.dir)).toContain(
      "c560cbb65e105e1aaeb8d86f544ff95cfd218346",
    );
  });

  it("waives the one install-only bundle by name, hash and step list", () => {
    // #81: bundle 7498ce65 seals ci.md, database.md and release.md but its single legacy
    // summary.tsv survived only the last run's frozen-install. That is a failure the
    // verifier reports; the registry keeps it reported-and-recorded instead of silent, so
    // regenerating the bundle on the Claw host turns the entry into a stale-step-waiver
    // failure and the waiver cannot outlive the state it describes.
    const registry = JSON.parse(readFileSync(EXEMPTIONS, "utf8")) as {
      stepCoverageWaivers: Waiver[];
    };
    expect(registry.stepCoverageWaivers.length).toBeLessThanOrEqual(1);
    expect(result.summary.stepCoverageWaivers).toBe(
      registry.stepCoverageWaivers.length,
    );
    for (const waiver of registry.stepCoverageWaivers) {
      expect(waiver.dir).toMatch(/^[0-9a-f]{40}$/);
      expect(waiver.reason.length).toBeGreaterThan(120);
      expect(waiver.resolution.length).toBeGreaterThan(10);
      expect(waiver.stepLogs.length).toBeGreaterThan(0);
      // A waiver may only ever cover a bundle that records nothing but the install,
      // otherwise it would excuse a bundle that does prove a gate ran.
      for (const name of waiver.recordedSteps) {
        expect(name).toMatch(/(?:^|[-_])install(?:[-_]|$)/u);
      }
      for (const log of waiver.stepLogs) {
        expect(log.file).toMatch(/^summary(-[a-z0-9][a-z0-9_.-]*)?\.tsv$/u);
        expect(log.hash).toMatch(HEX64);
        const path = join(EVIDENCE_ROOT, waiver.dir, log.file);
        expect(sha256File(path), `${path} drifted from its waiver`).toBe(
          log.hash,
        );
      }
    }
    expect(result.summary.failures, JSON.stringify(result.failures)).toBe(0);
  });

  describe("verifier rules on fixtures", () => {
    it("accepts the per-mode step log and snapshot names", async () => {
      const bundle = await fixture(sha("1"), {
        "summary-ci.tsv": `${stepLine("frozen-install")}${stepLine("coverage")}`,
        "environment-ci.txt": "gate_mode=ci\n",
        "ci.md": "# run\n",
      });
      const report = bundle.report();
      try {
        expect(report.summary.machineVerifiable).toBe(1);
        expect(report.summary.bundlesWithStepLog).toBe(1);
        expect(report.summary.stepRecords).toBe(2);
        expect(report.summary.failures).toBe(0);
        expect(report.failures).toEqual([]);
      } finally {
        rmSync(bundle.root, { recursive: true, force: true });
      }
    });

    it("keeps accepting the legacy shared names", async () => {
      const bundle = await fixture(sha("2"), {
        "summary.tsv": `${stepLine("frozen-install")}${stepLine("build")}`,
        "environment.txt": "gate_mode=ci\n",
      });
      const report = bundle.report();
      try {
        expect(report.summary.machineVerifiable).toBe(1);
        expect(report.summary.stepRecords).toBe(2);
        expect(report.summary.failures).toBe(0);
      } finally {
        rmSync(bundle.root, { recursive: true, force: true });
      }
    });

    it("ignores the header line of a hand-made step log", async () => {
      const bundle = await fixture(sha("3"), {
        "summary.tsv":
          "step\tstatus\ttest_files\ttests\tduration\n" +
          "e2e-required-library-build\t0\t-\t-\t-\n",
      });
      const report = bundle.report();
      try {
        expect(report.summary.stepRecords).toBe(1);
        expect(report.summary.failures).toBe(0);
      } finally {
        rmSync(bundle.root, { recursive: true, force: true });
      }
    });

    it("fails a machine-checkable bundle whose only step is the install", async () => {
      // The #81 rule: this is what the 7498ce6 bundle looked like after the release run
      // truncated the shared log. It must not read as green.
      const bundle = await fixture(sha("4"), {
        "summary-release.tsv": stepLine("frozen-install"),
        "environment-release.txt": "gate_mode=release\n",
        "release.md": "- status: PASS\n",
      });
      const report = bundle.report();
      try {
        expect(report.summary.failures).toBe(1);
        expect(report.status).toBe(1);
        expect(report.failures).toEqual([
          {
            dir: sha("4"),
            file: "summary-release.tsv",
            status: "install-only-steps",
            recordedSteps: ["frozen-install"],
            hint: expect.any(String),
          },
        ]);
      } finally {
        rmSync(bundle.root, { recursive: true, force: true });
      }
    });

    it("passes a bundle that records one gate step beyond the install", async () => {
      const bundle = await fixture(sha("5"), {
        "summary-release.tsv": `${stepLine("frozen-install")}${stepLine("build-native-release")}`,
      });
      const report = bundle.report();
      try {
        expect(report.summary.failures).toBe(0);
      } finally {
        rmSync(bundle.root, { recursive: true, force: true });
      }
    });

    it("does not judge bundles that record no step at all", async () => {
      // Hand-made prose bundles and the manifest-only bundles predate the runner and make no
      // machine-checkable step claim; the gap is counted, not condemned.
      const prose = await fixture(sha("6"), {
        "verification.md": "# prose only\n",
      });
      const snapshotOnly = await fixture(sha("7"), {
        "environment-database.txt": "gate_mode=database\n",
        "database.md": "- status: PASS\n",
      });
      const first = prose.report();
      const second = snapshotOnly.report();
      try {
        expect(first.summary.proseOnly).toBe(1);
        expect(first.summary.machineVerifiable).toBe(0);
        expect(first.summary.bundlesWithStepLog).toBe(0);
        expect(first.summary.failures).toBe(0);
        expect(second.summary.machineVerifiable).toBe(1);
        expect(second.summary.machineCheckableWithoutSteps).toBe(1);
        expect(second.summary.failures).toBe(0);
      } finally {
        rmSync(prose.root, { recursive: true, force: true });
        rmSync(snapshotOnly.root, { recursive: true, force: true });
      }
    });

    it("honours a step-coverage waiver only while it still matches", async () => {
      const dir = sha("8");
      const log = "summary.tsv";
      const content = stepLine("frozen-install");
      const hash = createHash("sha256").update(content).digest("hex");
      const waiver = {
        dir,
        reason:
          "recorded install-only evidence pending a regenerated gate bundle",
        resolution: "regenerate the bundle, then delete this entry",
        stepLogs: [{ file: log, hash }],
        recordedSteps: ["frozen-install"],
      };

      const covered = await fixture(
        dir,
        { [log]: content },
        { stepCoverageWaivers: [waiver] },
      );
      const drifted = await fixture(
        dir,
        { [log]: `${content}${stepLine("frozen-install")}` },
        { stepCoverageWaivers: [waiver] },
      );
      const repaired = await fixture(
        dir,
        { [log]: `${stepLine("frozen-install")}${stepLine("build")}` },
        { stepCoverageWaivers: [waiver] },
      );
      const coveredReport = covered.report();
      const driftedReport = drifted.report();
      const repairedReport = repaired.report();
      try {
        expect(coveredReport.summary.failures).toBe(0);
        expect(coveredReport.deviations.map((item) => item.status)).toContain(
          "install-only-steps",
        );
        // Extra install-only lines change the step list and the hash: the waiver no longer
        // describes the bundle, so the state is reported twice instead of excused.
        expect(driftedReport.summary.failures).toBe(2);
        expect(
          driftedReport.failures.map((item) => item.status).sort(),
        ).toEqual(["install-only-steps", "stale-step-waiver"]);
        // A bundle that now proves a gate must not keep its waiver either.
        expect(repairedReport.summary.failures).toBe(1);
        expect(repairedReport.failures.map((item) => item.status)).toEqual([
          "stale-step-waiver",
        ]);
      } finally {
        rmSync(covered.root, { recursive: true, force: true });
        rmSync(drifted.root, { recursive: true, force: true });
        rmSync(repaired.root, { recursive: true, force: true });
      }
    });
  });
});
