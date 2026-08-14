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
    expect(runner).toContain(
      "expected_test_image_id=sha256:587eec47e1e3a9c79a4cbce2981342bded8455e198b5b1aa29316579eb6dab60",
    );
    expect(runner).toContain(
      'test "$(docker image inspect "$test_image_ref" --format \'{{.Id}}\')" = "$expected_test_image_id"',
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

  it("rebuilds the Claw image only from the offline frozen store", () => {
    const dockerfile = read("deploy/claw/Dockerfile.test");
    expect(dockerfile).toContain(
      "pnpm install --offline --frozen-lockfile --trust-lockfile",
    );
    expect(dockerfile).not.toContain("pnpm install --frozen-lockfile;");
  });

  it("runs every database suite once without a repeat adapter", () => {
    const runner = read("scripts/run-claw-ci.sh");
    expect(runner).not.toContain("pnpm test:repeat");
    expect(runner).toContain("repeat_limit: 1");
    for (const suite of [
      "tests/integration/yookassa-migration-upgrade.test.ts",
      "tests/integration/yookassa-operation-concurrency.test.ts",
      "tests/integration/yookassa-reconciliation.test.ts",
    ]) {
      expect(runner.split(suite)).toHaveLength(2);
    }
  });

  it("keeps unbound YooKassa recovery blocked behind explicit policy inputs", () => {
    const runbook = read("docs/runbooks/yookassa-provider.md");
    const design = read(
      "docs/superpowers/specs/2026-08-14-yookassa-provider-design.md",
    );
    const traceability = read("docs/spec/yookassa-provider-traceability.md");

    expect(runbook).toContain("user-command retry only");
    expect(runbook).toContain("same idempotency key and exact request body");
    expect(runbook).toContain("autonomous unbound recovery remains BLOCKED");
    for (const placeholder of [
      "YOOKASSA_RECEIPT_CONTACT_CONSENT_PURPOSE=",
      "YOOKASSA_RECEIPT_CONTACT_POLICY_VERSION=",
      "YOOKASSA_RECOVERY_ENCRYPTION_KEY_REFERENCE=",
      "YOOKASSA_RECOVERY_RETENTION_DAYS=",
      "YOOKASSA_UNBOUND_RECOVERY_ENABLED=",
      "YOOKASSA_UNBOUND_RECOVERY_WINDOW_HOURS=",
    ]) {
      expect(runbook).toContain(placeholder);
      expect(runbook).not.toContain(`${placeholder}__PLACEHOLDER`);
    }
    expect(design).toContain("YKP-015 — Consent-bound receipt contact");
    expect(design).toContain("YKP-016 — Encrypted exact-body unbound recovery");
    expect(traceability).toContain("YKP-015");
    expect(traceability).toContain("YKP-016");
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
