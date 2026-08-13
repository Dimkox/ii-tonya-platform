import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

describe("direct Claw verification semantics", () => {
  it("does not ship GitHub Actions workflows", () => {
    const workflows = existsSync(".github/workflows")
      ? readdirSync(".github/workflows").filter((name) =>
          /\.ya?ml$/u.test(name),
        )
      : [];
    expect(workflows).toEqual([]);
  });

  it("runs CI and database gates directly on Claw without Actions context", () => {
    const runner = read("scripts/run-claw-ci.sh");
    expect(runner).toContain("<ci|database|release>");
    expect(runner).toContain(
      'source_root="$(realpath "${SOURCE_ROOT:?SOURCE_ROOT is required}")"',
    );
    expect(runner).toContain(
      'source_sha="${SOURCE_SHA:?SOURCE_SHA is required}"',
    );
    expect(runner).toContain(
      'test "$(git -C "$source_root" rev-parse HEAD)" = "$source_sha"',
    );
    expect(runner).toContain('[[ "$(hostname -s)" == "claw" ]]');
    expect(runner).toContain("--profile test run --rm --no-deps");
    expect(runner).toContain('docker compose "${compose_args[@]}"');
    expect(runner).toContain(
      "claw_store=$compose_root/ii-tonya-test-workspace/.pnpm-store",
    );
    expect(runner).toContain('-v "$claw_store:/workspace/.pnpm-store"');
    expect(runner).not.toMatch(/GITHUB_|actions-runner|workflow_dispatch/u);
  });

  it("installs the frozen dependency graph before verification", () => {
    const runner = read("scripts/run-claw-ci.sh");
    const install = runner.indexOf(
      "pnpm install --offline --frozen-lockfile --trust-lockfile",
    );
    const build = runner.indexOf("pnpm build", install);
    const verify = runner.indexOf("pnpm exec vitest run", build);
    expect(install).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(install);
    expect(verify).toBeGreaterThan(build);
  });

  it("runs financial database concurrency gates exactly three times", () => {
    const runner = read("scripts/run-claw-ci.sh");
    for (const path of [
      "tests/integration/expert-referral-redemption-concurrency.test.ts",
      "tests/integration/expert-residency-checkout-concurrency.test.ts",
      "tests/integration/expert-residency-settlement-concurrency.test.ts",
      "tests/integration/expert-residency-deadline.test.ts",
      "tests/integration/expert-residency-hold-replay.test.ts",
    ]) {
      expect(runner).toContain(`pnpm test:repeat -- 3 ${path}`);
    }
    expect(runner).not.toContain("pnpm test:repeat -- 20 ");
  });

  it("writes exact-SHA evidence outside transient test containers", () => {
    const runner = read("scripts/run-claw-ci.sh");
    expect(runner).toContain("docs/test-evidence/claw/$source_sha");
    expect(runner).toContain("source_sha: $source_sha");
    expect(runner).toContain("claw_test_container: true");
    expect(runner).toContain("production_container: false");
    expect(runner).toContain("trap cleanup EXIT");
  });
});
