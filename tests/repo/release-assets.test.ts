import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("release assets", () => {
  it("documents the exact test-release boundary and provider capability matrix", () => {
    const readme = readFileSync("README.md", "utf8");
    const providerEvidence = readFileSync(
      "docs/runbooks/provider-staging-evidence.md",
      "utf8",
    );
    expect(readme).toContain("Test delivery deadline: 2026-09-07");
    expect(readme).toContain("test-only release boundary");
    expect(providerEvidence).toContain("Capability matrix");
    expect(providerEvidence).toContain(
      "default-off until its test evidence passes",
    );
    for (const capability of [
      "Selarti",
      "Planerka",
      "Unified client Telegram bot",
      "Expert promo Telegram bot",
      "YooKassa",
      "MAX Business",
    ]) {
      expect(providerEvidence).toMatch(
        new RegExp(`${capability}[\\s\\S]{0,220}default-off`, "i"),
      );
    }
    expect(providerEvidence).toContain("Provider staging status: BLOCKED");
    expect(providerEvidence).toContain("not provider-connected evidence");
    expect(providerEvidence).toContain(
      "Production activation remains excluded",
    );
    expect(providerEvidence).toMatch(
      /^\|\s*Unified client Telegram bot\s*\|\s*not executed\s*\|/m,
    );
    expect(providerEvidence).toMatch(
      /^\|\s*Expert promo Telegram bot\s*\|\s*not executed\s*\|/m,
    );
    expect(providerEvidence).not.toMatch(
      /^\|\s*Telegram\s*\|\s*not executed\s*\|/m,
    );
    expect(providerEvidence).not.toContain("Provider staging status: PASS");
    expect(providerEvidence).not.toContain("production release");
  });

  it("contains direct-Claw, native runtime, rollback, and evidence assets", () => {
    const required = [
      "scripts/run-claw-ci.sh",
      "scripts/build-native-release.sh",
      "scripts/deploy-native-remote.sh",
      "deploy/systemd/ii-tonya-api.service",
      "deploy/systemd/ii-tonya-worker.service",
      "deploy/systemd/ii-tonya-migrate.service",
      "deploy/runtime.env.example",
      "scripts/validate-runtime-env.sh",
      "scripts/smoke.mjs",
      "Dockerfile",
      "Dockerfile.sandbox",
      "compose.yaml",
      "compose.sandbox.yaml",
      "scripts/run-sandbox-container-smoke.sh",
      "scripts/build-sandbox-image-offline.sh",
      "scripts/sandbox-container-lifecycle.mjs",
      "docs/runbooks/native-production-deployment.md",
      "docs/runbooks/go-live-evidence.md",
      "docs/runbooks/provider-staging-evidence.md",
      "docs/runbooks/rollback.md",
      "scripts/pre-push-gate.sh",
      "scripts/install-git-hooks.sh",
      "scripts/git-hooks/pre-push",
    ];
    expect(required.filter((path) => !existsSync(path))).toEqual([]);
  });

  it("keeps Docker and Compose limited to development and Claw test evidence", () => {
    const readme = readFileSync("README.md", "utf8");
    const nativeRunbook = readFileSync(
      "docs/runbooks/native-production-deployment.md",
      "utf8",
    );
    expect(readme).toContain(
      "Docker and Compose are development and Claw test tools only",
    );
    expect(readme).toContain(
      "GitHub Actions provide hosted CI and Database Gate",
    );
    expect(nativeRunbook).toContain(
      "container imitates the native server contract",
    );
    expect(nativeRunbook).toContain("scripts/run-claw-ci.sh");
  });

  it("defines a hardened test-only sandbox image and isolated database network", () => {
    const dockerfile = readFileSync("Dockerfile.sandbox", "utf8");
    const sandboxCompose = parse(
      readFileSync("compose.sandbox.yaml", "utf8"),
    ) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, { internal?: boolean }>;
    };
    expect(dockerfile).toContain("AS sandbox-api");
    expect(dockerfile).toContain('CMD ["node", "dist/server.js"]');
    expect(dockerfile).toContain("USER 10001:10001");
    const service = sandboxCompose.services["sandbox-api"]!;
    expect(service.profiles).toContain("sandbox");
    expect(service.read_only).toBe(true);
    expect(service.tmpfs).toContain("/tmp");
    expect(service.cap_drop).toContain("ALL");
    expect(service.security_opt).toContain("no-new-privileges:true");
    expect(service.cpus).toBe(1);
    expect(service.mem_limit).toBe("1g");
    expect(sandboxCompose.services["sandbox-postgres"]?.ports).toBeUndefined();
    expect(sandboxCompose.networks["sandbox-db"]?.internal).toBe(true);
    expect(service.networks).toEqual(["sandbox-db"]);
  });

  it("keeps every live capability disabled in the local test stack", () => {
    const compose = readFileSync("compose.yaml", "utf8");
    for (const flag of [
      "MINOR_ONBOARDING_ENABLED",
      "EXPERT_REFERRAL_ENABLED",
      "EXPERT_RESIDENCY_BILLING_ENABLED",
      "EXPERT_TELEGRAM_QUERIES_ENABLED",
      "SELARTI_ENABLED",
      "PLANERKA_ENABLED",
      "TELEGRAM_ENABLED",
      "PAYMENTS_ENABLED",
      "LLM_ENABLED",
      "INTENT_MODEL_ENABLED",
      "MAKE_PROJECTION_ENABLED",
      "GOOGLE_SHEETS_PROJECTION_ENABLED",
    ]) {
      expect(compose).toContain(`${flag}: "false"`);
    }
  });

  it("does not convert fixtures or test-container health into provider evidence", () => {
    const evidence = readFileSync("docs/runbooks/go-live-evidence.md", "utf8");
    const providerEvidence = readFileSync(
      "docs/runbooks/provider-staging-evidence.md",
      "utf8",
    );
    expect(evidence).toContain("Release status: NO-GO");
    expect(evidence).toContain("Live payments: disabled");
    expect(providerEvidence).toContain("Provider staging status: BLOCKED");
    expect(providerEvidence).not.toContain("Provider staging status: PASS");
  });

  it("drives the sandbox lifecycle through HTTP and authoritative database assertions", () => {
    const lifecycle = readFileSync(
      "scripts/sandbox-container-lifecycle.mjs",
      "utf8",
    );
    for (const fragment of [
      '"/sandbox/v1/checkouts"',
      "/request",
      "/approve",
      "/transitions/${transition}",
      "expert_residency_provider_event_inbox",
      "sandbox_expert_residency_events",
      "expert_residency_payment_attempts",
      "audit_events",
      "integration_outbox",
      'interval_seconds: "86400"',
    ])
      expect(lifecycle).toContain(fragment);
  });

  it("hardens every application test container at runtime", () => {
    const compose = parse(readFileSync("compose.yaml", "utf8"));
    for (const serviceName of [
      "migrate",
      "provider-stubs",
      "api",
      "worker",
      "smoke",
    ]) {
      const service = compose.services[serviceName];
      expect(service.read_only, serviceName).toBe(true);
      expect(service.tmpfs, serviceName).toContain("/tmp");
      expect(service.cap_drop, serviceName).toContain("ALL");
      expect(service.security_opt, serviceName).toContain(
        "no-new-privileges:true",
      );
      expect(service.pids_limit, serviceName).toBe(128);
    }
  });

  it("rejects duplicate or downgraded PostgreSQL sslmode values", () => {
    const fixture = mkdtempSync(join(tmpdir(), "ii-tonya-runtime-env-"));
    const runtimeFile = join(fixture, "runtime.env");
    const validate = (databaseUrl: string) => {
      writeFileSync(
        runtimeFile,
        `NODE_ENV=production\nDATABASE_URL=${databaseUrl}\n`,
      );
      return spawnSync(
        "bash",
        ["scripts/validate-runtime-env.sh", runtimeFile],
        {
          encoding: "utf8",
        },
      );
    };
    expect(validate("postgresql://u:p@db/app?sslmode=verify-full").status).toBe(
      0,
    );
    expect(validate("postgresql://u:p@db/app?sslmode=disable").status).not.toBe(
      0,
    );
    expect(
      validate("postgresql://u:p@db/app?sslmode=verify-full&sslmode=disable")
        .status,
    ).not.toBe(0);
  });

  it("rejects NODE_OPTIONS from the runtime environment", () => {
    const fixture = mkdtempSync(join(tmpdir(), "ii-tonya-runtime-env-node-"));
    const runtimeFile = join(fixture, "runtime.env");
    writeFileSync(
      runtimeFile,
      [
        "NODE_ENV=production",
        "NODE_OPTIONS=--no-jitless",
        "DATABASE_URL=postgresql://u:p@db/app?sslmode=verify-full",
        "",
      ].join("\n"),
    );

    const result = spawnSync(
      "bash",
      ["scripts/validate-runtime-env.sh", runtimeFile],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NODE_OPTIONS is reserved by systemd");
  });

  it("keeps direct Claw and native deployment assets in mandatory verification", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const deployCheck = manifest.scripts["verify:deploy"] ?? "";
    // bash -n validates only its first operand: extra paths become positional parameters of
    // the first script. The previous single call therefore syntax-checked run-claw-ci.sh and
    // reported success for three unchecked deploy scripts, so the loop must stay per-file.
    expect(deployCheck).toContain("for clawScript in scripts/run-claw-ci.sh");
    expect(deployCheck).toContain("scripts/build-native-release.sh");
    expect(deployCheck).toContain("scripts/deploy-native-remote.sh");
    expect(deployCheck).toContain("scripts/validate-runtime-env.sh");
    expect(deployCheck).toContain('bash -n "$clawScript" || exit 1');
    expect(deployCheck).not.toMatch(
      /bash -n scripts\/run-claw-ci\.sh scripts\//u,
    );
    expect(deployCheck).toContain(
      "tests/repo/native-production-release.test.ts",
    );
    expect(manifest.scripts.verify).toContain("pnpm verify:deploy");
    expect(manifest.scripts["verify:gate"]).toBe(
      "bash scripts/pre-push-gate.sh",
    );
    expect(manifest.scripts["hooks:install"]).toBe(
      "bash scripts/install-git-hooks.sh",
    );
    expect(manifest.scripts["hooks:check"]).toBe(
      "bash scripts/install-git-hooks.sh --check",
    );
  });

  it("catches a syntax error in a script that is not first in the list", () => {
    // Pins the trap itself rather than the wording: one broken script anywhere in the loop must
    // fail, which the multi-file `bash -n a b` form does not do.
    const dir = mkdtempSync(join(tmpdir(), "gate-syntax-"));
    const good = join(dir, "good.sh");
    const broken = join(dir, "broken.sh");
    writeFileSync(good, "#!/usr/bin/env bash\necho ok\n");
    writeFileSync(broken, "#!/usr/bin/env bash\nif true then\n");

    const singleCall = spawnSync("bash", ["-n", good, broken], {
      encoding: "utf8",
    });
    expect(singleCall.status, "multi-file bash -n hides later files").toBe(0);

    const looped = spawnSync(
      "bash",
      [
        "-c",
        'for clawScript in "$1" "$2"; do bash -n "$clawScript" || exit 1; done',
        "gate",
        good,
        broken,
      ],
      { encoding: "utf8" },
    );
    expect(looped.status, "per-file loop must reject the broken script").toBe(
      1,
    );
  });
});
