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
    expect(runner).toContain("<ci|database|release|client-booking>");
    expect(runner).toContain(
      'source_root="$(realpath "${SOURCE_ROOT:?SOURCE_ROOT is required}")"',
    );
    expect(runner).toContain(
      'source_sha="${SOURCE_SHA:?SOURCE_SHA is required}"',
    );
    expect(runner).toContain(
      'test "$(git -C "$source_root" rev-parse HEAD)" = "$source_sha"',
    );
    expect(runner).toContain(
      'git_common_dir="$(git -C "$source_root" rev-parse --path-format=absolute --git-common-dir)"',
    );
    expect(runner).toContain('git_marker="$source_root/.git"');
    expect(runner).toContain('[[ "$(hostname -s)" == "claw" ]]');
    expect(runner).toContain("--profile test run --rm --no-deps");
    expect(runner).toContain('docker compose "${compose_args[@]}"');
    expect(runner).toContain(
      'compose_root="${CLAW_COMPOSE_ROOT:-/home/pall/app-stack}"',
      "claw_store=$compose_root/ii-tonya-test-workspace/.pnpm-store",
    );
    expect(runner).toContain(
      "test_image=29993b4fe96facf8c07781833dc7f2d5f560aa7e",
    );
    expect(runner).toContain(
      "expected_test_image_id=sha256:fd31ecb001fea3e4c6d044a420ce2b607586dfa4441ee98b3f7ae6e20abedd63",
    );
    expect(runner).toContain(
      'test "$(docker image inspect "$test_image_ref" --format \'{{.Id}}\')" = "$expected_test_image_id"',
    );
    expect(runner).toContain('-v "$claw_store:/workspace/.pnpm-store"');
    expect(runner).toContain('-v "$git_common_dir:$git_common_dir:ro"');
    expect(runner).toContain('-v "$git_marker:/workspace/source/.git:ro"');
    expect(runner).toContain(
      '-v "$CLAW_HOST_GIT_COMMON_DIR:$CLAW_HOST_GIT_COMMON_DIR:ro"',
    );
    expect(runner).toContain('-e "CLAW_HOST_GIT_COMMON_DIR=$git_common_dir"');
    expect(
      runner.split(
        'test "$(git -C "$source_root" rev-parse HEAD)" = "$source_sha"',
      ),
    ).toHaveLength(3);
    expect(
      runner.split(
        'test -z "$(git -C "$source_root" status --porcelain --untracked-files=no)"',
      ),
    ).toHaveLength(3);
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
      "tests/integration/test-expert-trial-postgres.test.ts",
      "tests/integration/yookassa-migration-upgrade.test.ts",
      "tests/integration/yookassa-operation-concurrency.test.ts",
      "tests/integration/yookassa-reconciliation.test.ts",
    ]) {
      expect(runner.split(suite)).toHaveLength(2);
    }
  });

  it("pins the sandbox builder to the same immutable Claw image", () => {
    const builder = read("scripts/build-sandbox-image-offline.sh");
    expect(builder).toContain(
      "ii-tonya-test:29993b4fe96facf8c07781833dc7f2d5f560aa7e",
    );
    expect(builder).toContain(
      "sha256:fd31ecb001fea3e4c6d044a420ce2b607586dfa4441ee98b3f7ae6e20abedd63",
    );
  });

  it("keeps unbound YooKassa recovery blocked behind explicit policy inputs", () => {
    const runbook = read("docs/runbooks/yookassa-provider.md");
    const design = read(
      "docs/superpowers/specs/2026-08-14-yookassa-provider-design.md",
    );
    const traceability = read("docs/spec/yookassa-provider-traceability.md");

    expect(runbook).toMatch(
      /default operator path remains a user-command retry with the same idempotency key and\s+exact request body/u,
    );
    expect(runbook).toContain("Autonomous recovery remains **BLOCKED**");
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
    expect(runner).toContain("printf 'source_sha=%s\\n' \"$CLAW_SOURCE_SHA\"");
    expect(runner).toContain('claw_seal_bundle "$evidence_dir"');
    // Every step is recorded with its exit status and both timestamps, and the record is
    // appended: that printf is what turns a step name into a measured duration.
    expect(runner).toContain(
      'printf \'%s\\t%s\\t%s\\t%s\\n\' "$name" "$code" "$started" "$finished" >> "$summary_tsv"',
    );
    // Bash resolves a function call only if the definition has already executed, so a
    // seal defined after its first call fails with 127 and leaves an unsealed bundle.
    const sealDefinition = runner.indexOf("claw_seal_bundle() {");
    const firstSealCall = runner.search(/claw_seal_bundle "\$/u);
    expect(sealDefinition).toBeGreaterThan(-1);
    expect(firstSealCall).toBeGreaterThan(sealDefinition);
    expect(runner.match(/^claw_seal_bundle\(\) \{/gmu)).toHaveLength(1);
  });

  it("keeps one step log and one environment snapshot per gate mode", () => {
    // #81: summary.tsv and environment.txt were shared by every mode and truncated at the
    // start of each run, so a release run after a ci run on the same SHA destroyed the proof
    // that ci had ever happened, and the bundle showed one step out of dozens while three
    // mode reports claimed PASS.
    const runner = read("scripts/run-claw-ci.sh");
    expect(runner).toContain(
      'summary_tsv="$evidence_dir/summary-$CLAW_GATE_MODE.tsv"',
    );
    expect(runner).toContain(
      'environment_txt="$evidence_dir/environment-$CLAW_GATE_MODE.txt"',
    );
    expect(runner).toContain('} > "$environment_txt"');
    expect(runner).not.toContain('"$evidence_dir/summary.tsv"');
    expect(runner).not.toContain('"$evidence_dir/environment.txt"');
    // Repeating one mode must still replace that mode's own record, but by removing the log
    // rather than truncating it: a mode that records no step then leaves no empty file.
    expect(runner).toContain('rm -f "$summary_tsv"');
    expect(runner).not.toContain(': > "$summary_tsv"');
    // The human-readable report was already per-mode and stays that way.
    expect(runner).toContain('cat > "$evidence_dir/${mode}.md" <<EOF');
    // The seal appends the exit code to the snapshot this run owns, never to another
    // mode's or to the legacy shared one.
    expect(runner).toContain('[[ -f "$dir/environment-$mode.txt" ]]');
    expect(runner).toContain(
      'printf \'exit_code=%s\\n\' "$status" >> "$dir/environment-$mode.txt"',
    );
  });

  it("records every gate body, the release build included, as a timed step", () => {
    const runner = read("scripts/run-claw-ci.sh");
    const gateCase = runner.indexOf('case "$CLAW_GATE_MODE" in');
    expect(gateCase).toBeGreaterThan(-1);
    const bodyOf = (mode: string): string[] => {
      const start = runner.indexOf(`  ${mode})`, gateCase);
      expect(start).toBeGreaterThan(gateCase);
      const body = runner.slice(start, runner.indexOf("    ;;", start));
      const statements: string[] = [];
      let pending = "";
      for (const rawLine of body.split("\n")) {
        const line =
          pending.length > 0 ? `${pending} ${rawLine.trim()}` : rawLine.trim();
        if (line.endsWith("\\")) {
          pending = line.slice(0, -1).trim();
          continue;
        }
        pending = "";
        if (line.length === 0 || line.startsWith("#")) {
          continue;
        }
        statements.push(line);
      }
      // Drop the case label and the terminator, keep the commands.
      return statements.filter((line) => line !== ";;" && !line.endsWith(")"));
    };
    for (const mode of ["ci", "database", "release"]) {
      const statements = bodyOf(mode);
      expect(statements.length, `${mode} gate body is empty`).toBeGreaterThan(
        0,
      );
      for (const statement of statements) {
        expect(statement, `${mode}: ${statement}`).toMatch(
          /^step [a-z0-9][a-z0-9-]* /u,
        );
      }
    }
    // Done-when #2: the release bundle must carry the artifact build itself, with an exit
    // code and a measured duration, not just the report that claims it passed.
    const release = bodyOf("release");
    expect(release).toEqual([
      'step build-native-release env SOURCE_SHA="$CLAW_SOURCE_SHA" OUTPUT_DIR=/workspace/release-output bash scripts/build-native-release.sh',
      "step release-artifact-present test -f /workspace/release-output/native-release.tar.gz",
    ]);
  });

  it("freezes the one-process client-booking gate and its secret-safe cleanup", () => {
    const runner = read("scripts/run-claw-ci.sh");
    const manifest = [
      "tests/integration/client-booking-schema.test.ts",
      "tests/repo/db-schema-parity.test.ts",
      "tests/integration/client-catalog-booking-choice.test.ts",
      "tests/integration/client-booking-repository.test.ts",
      "tests/integration/client-booking-privacy.test.ts",
      "tests/e2e/client-booking-boundary.test.ts",
      "tests/repo/client-booking-boundaries.test.ts",
      "apps/api/src/client-booking-principal-resolver.test.ts",
      "apps/api/src/routes/client-booking.test.ts",
      "packages/worker/src/client-booking-erasure.test.ts",
      "packages/contracts/src/worker-outbox.test.ts",
      "apps/worker/src/main.test.ts",
      "apps/worker/src/runtime.test.ts",
      "packages/observability/src/logger.test.ts",
      "packages/observability/src/metrics.test.ts",
      "tests/repo/workflow-semantics.test.ts",
    ];
    const literal = `/seed/node_modules/.bin/vitest run ${manifest.join(" ")} --maxWorkers=1`;
    expect(runner).toContain("ci | database | release | client-booking");
    expect(runner).toContain(literal);
    expect(runner.split("pnpm exec vitest run", 20)).toHaveLength(18);
    expect(runner).toContain("--untracked-files=all");
    expect(runner).toContain("-e II_TONYA_TEST_POSTGRES_ADMIN_URL");
    expect(runner).not.toContain("$II_TONYA_TEST_POSTGRES_ADMIN_URL");
    expect(runner).toContain("trap cleanup EXIT");
    expect(runner).toContain("repeat_limit: 1");
  });

  it("materializes the client-booking package closure from the pinned seed without reinstalling", () => {
    const runner = read("scripts/run-claw-ci.sh");
    const gateCase = runner.indexOf('case "$CLAW_GATE_MODE" in');
    const clientBooking = runner.slice(
      runner.indexOf("  client-booking)", gateCase),
      runner.indexOf("    ;;", runner.indexOf("  client-booking)", gateCase)),
    );

    expect(runner).toContain("export CI=true");
    expect(clientBooking).not.toContain("find /seed/node_modules");
    expect(runner).not.toMatch(/find\s+[^\n]*-exec/u);
    expect(clientBooking).toContain("test -d /seed/node_modules/.pnpm");
    expect(clientBooking).toContain(
      "ln -s /seed/node_modules/.pnpm node_modules/.pnpm",
    );
    expect(clientBooking).toContain(
      'test "$(readlink -f node_modules/.pnpm)" = /seed/node_modules/.pnpm',
    );
    expect(clientBooking).toContain("resolve_seed_package() {");
    expect(clientBooking).toContain(
      'candidates=(/seed/node_modules/.pnpm/"$pnpm_prefix"*/node_modules/"$package_name")',
    );
    expect(clientBooking).toContain('test "${#candidates[@]}" -eq 1');
    expect(clientBooking).toContain(
      '"$candidate/package.json" "$package_name" "$package_version"',
    );
    expect(clientBooking).toContain('"drizzle-orm|0.45.2|drizzle-orm@"');
    expect(clientBooking).toContain('"pg|8.22.0|pg@"');
    expect(clientBooking).toContain('"pino|9.14.0|pino@"');
    expect(clientBooking).toContain('"fastify|5.10.0|fastify@"');
    expect(clientBooking).toContain(
      '"@fastify/rate-limit" 10.3.0 "@fastify+rate-limit@"',
    );
    expect(clientBooking).toContain("node_modules/@fastify/rate-limit");
    expect(clientBooking).toContain(
      'vitest_package="$(resolve_seed_package vitest 3.2.7 vitest@)"',
    );
    expect(clientBooking).toContain(
      'ln -s "$vitest_package" node_modules/vitest',
    );
    expect(clientBooking).toContain(
      'test "$(readlink -f node_modules/vitest)" = "$vitest_package"',
    );
    expect(clientBooking).toContain("mkdir node_modules/@opentelemetry");
    expect(clientBooking).toContain(
      'opentelemetry_api_package="$(resolve_seed_package "@opentelemetry/api" 1.9.1 "@opentelemetry+api@")"',
    );
    expect(clientBooking).toContain(
      'ln -s "$opentelemetry_api_package" node_modules/@opentelemetry/api',
    );
    expect(clientBooking).toContain(
      'test "$(readlink -f node_modules/@opentelemetry/api)" = "$opentelemetry_api_package"',
    );
    expect(clientBooking).toContain("mkdir node_modules/@testcontainers");
    expect(clientBooking).toContain(
      'testcontainers_postgresql_package="$(resolve_seed_package "@testcontainers/postgresql" 10.28.0 "@testcontainers+postgresql@")"',
    );
    expect(clientBooking).toContain(
      'ln -s "$testcontainers_postgresql_package" node_modules/@testcontainers/postgresql',
    );
    expect(clientBooking).toContain(
      'test "$(readlink -f node_modules/@testcontainers/postgresql)" = "$testcontainers_postgresql_package"',
    );
    expect(clientBooking).toContain(
      "node scripts/assert-client-booking-postgres.mjs",
    );
    expect(clientBooking).toContain("rm -f node_modules/@ii-tonya");
    expect(clientBooking).toContain(
      'zod_package="$(resolve_seed_package zod 4.4.3 zod@)"',
    );
    expect(clientBooking).toContain("rm -f node_modules/zod");
    expect(clientBooking).toContain('ln -s "$zod_package" node_modules/zod');
    expect(clientBooking).toContain(
      'test "$(readlink -f node_modules/zod)" = "$zod_package"',
    );
    expect(clientBooking).toContain(
      "workspace_packages=(domain config contracts application integrations db observability worker)",
    );
    expect(clientBooking).toContain(
      'test "$(readlink -f "node_modules/@ii-tonya/$workspace_package")" = "/workspace/source/packages/$workspace_package"',
    );
    expect(clientBooking).toContain(
      'test -f "packages/$workspace_package/dist/index.js"',
    );
    expect(clientBooking).toContain(
      'for workspace_package in "${workspace_packages[@]}"; do\n' +
        '      test "$(readlink -f "node_modules/@ii-tonya/$workspace_package")" = "/workspace/source/packages/$workspace_package"\n' +
        '      test -f "packages/$workspace_package/dist/index.js"\n' +
        "    done",
    );
    expect(clientBooking).toContain(
      "node scripts/assert-client-booking-postgres.mjs",
    );
    expect(clientBooking).not.toContain(
      "pnpm --workspace-concurrency=1 -r --sort run build",
    );
    expect(clientBooking).toContain(
      'for workspace_package in "${workspace_packages[@]}"; do',
    );
    expect(clientBooking).toContain(
      "/seed/node_modules/.bin/tsup src/index.ts --format esm --clean --tsconfig ../../tsconfig.base.json",
    );
    expect(clientBooking).not.toContain("--dts");
    expect(clientBooking).toContain("/seed/node_modules/.bin/vitest run");
    expect(clientBooking).not.toContain("pnpm exec vitest run");
    expect(clientBooking).not.toContain("pnpm install");
    expect(clientBooking).toContain(
      'ln -sfn "/workspace/source/packages/$workspace_package" "node_modules/@ii-tonya/$workspace_package"',
    );
    expect(runner).toContain('test ! -e "$source_root/node_modules"');
    expect(runner).toContain(": > .claw-client-booking-node-modules");
    expect(runner).toContain(
      'rm -rf "$source_root/node_modules" "$source_root/.claw-client-booking-node-modules"',
    );
  });
});
