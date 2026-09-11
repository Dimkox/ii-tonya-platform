import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VERIFIER = "scripts/verify-claw-evidence.mjs";
const EXEMPTIONS = "docs/test-evidence/claw-exemptions.json";
const HEX64 = /^[0-9a-f]{64}$/;

type Summary = {
  bundles: number;
  machineVerifiable: number;
  proseOnly: number;
  manifestEntriesChecked: number;
  externalLogEntries: number;
  failures: number;
  exemptionsUsed: number;
};

const run = (): { status: number; summary: Summary; failures: unknown[] } => {
  const child = spawnSync(process.execPath, [VERIFIER, "--json"], {
    encoding: "utf8",
  });
  expect(child.stderr, "verifier must not write to stderr").toBe("");
  const parsed = JSON.parse(child.stdout) as {
    status: number;
    summary: Summary;
    failures: unknown[];
  };
  expect(parsed.status).toBe(child.status ?? 0);
  return parsed;
};

describe("claw evidence integrity", () => {
  const result = run();

  it("has no unexplained deviation in any evidence bundle", () => {
    expect(result.summary.failures, JSON.stringify(result.failures)).toBe(0);
    expect(result.status).toBe(0);
  });

  it("keeps the machine-checkable coverage as a floor, never a ceiling", () => {
    // 24 of 26 bundles are prose only: nothing an outside reviewer can re-check.
    // Raising coverage is the point of #51, so the number is pinned from below.
    expect(result.summary.machineVerifiable).toBeGreaterThanOrEqual(2);
    expect(result.summary.manifestEntriesChecked).toBeGreaterThanOrEqual(23);
    expect(result.summary.proseOnly).toBe(
      result.summary.bundles - result.summary.machineVerifiable,
    );
    expect(result.summary.bundles).toBeGreaterThanOrEqual(26);
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
});
