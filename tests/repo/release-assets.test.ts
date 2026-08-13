import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("release assets", () => {
  it("contains runtime, rollback, retention, recovery, reconciliation, and evidence assets", () => {
    const required = [
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      ".dockerignore",
      "Dockerfile",
      "Dockerfile.sandbox",
      "compose.yaml",
      "compose.sandbox.yaml",
      "deploy/compose.remote.yml",
      "deploy/runtime.env.example",
      "scripts/deploy-compose-remote.sh",
      "scripts/validate-runtime-env.sh",
      "scripts/smoke.mjs",
      "tests/container/image-smoke.test.mjs",
      "tests/container/sandbox-image-smoke.test.mjs",
      "scripts/run-sandbox-container-smoke.sh",
      "scripts/build-sandbox-image-offline.sh",
      "scripts/sandbox-container-lifecycle.mjs",
      "tests/provider-stubs/server.mjs",
      "docs/operations/data-retention.md",
      "docs/operations/disaster-recovery.md",
      "docs/operations/reconciliation.md",
      "docs/operations/safety-handoff.md",
      "docs/runbooks/go-live-evidence.md",
      "docs/runbooks/provider-staging-evidence.md",
      "docs/runbooks/remote-compose-deployment.md",
      "docs/runbooks/rollback.md",
    ];
    expect(required.filter((path) => !existsSync(path))).toEqual([]);
  });

  it("defines an explicit hardened sandbox image without changing production Compose", () => {
    const dockerfile = readFileSync("Dockerfile.sandbox", "utf8");
    const productionCompose = parse(readFileSync("compose.yaml", "utf8")) as {
      services: Record<string, unknown>;
    };
    const sandboxCompose = parse(
      readFileSync("compose.sandbox.yaml", "utf8"),
    ) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, { internal?: boolean }>;
    };
    expect(Object.keys(productionCompose.services)).not.toContain(
      "sandbox-api",
    );
    expect(dockerfile).toContain("AS sandbox-api");
    const builder = readFileSync(
      "scripts/build-sandbox-image-offline.sh",
      "utf8",
    );
    expect(builder).toContain("SOURCE_ARCHIVE_SHA");
    expect(builder).toContain("SOURCE_BUNDLE");
    expect(builder).toContain("git clone --quiet --no-checkout");
    expect(builder).toContain("git_source_sha");
    expect(builder).toContain("source_archive_sha256");
    expect(builder).toMatch(
      /pnpm[^\r\n]*--filter @ii-tonya\/sandbox-api --prod deploy/u,
    );
    expect(builder).not.toContain('cp -a "$fixture/source/node_modules"');
    expect(builder).toContain('find "$artifact" -type l');
    expect(builder).toContain("devDependencies");
    expect(builder).toContain("--network none");
    expect(builder).toContain("--cpus 1");
    expect(builder).toContain("--memory 1g");
    expect(builder).toContain("DOCKER_HOST_SOURCE_ROOT");
    expect(builder).toContain("LOCAL_SOURCE_ROOT");
    expect(builder).toContain("DOCKER_HOST_INSTALLED_ROOT");
    expect(builder).toContain("/installed:ro");
    expect(builder).toContain("-type d -name dist");
    expect(builder).not.toContain("/seed/.pnpm-store");
    expect(builder).not.toContain("--filter @ii-tonya/sandbox-api... install");
    expect(builder).toContain("build:bounded");
    expect(builder).toContain("test -f apps/sandbox-api/dist/server.js");
    expect(builder).toContain(
      "pnpm --offline --filter @ii-tonya/sandbox-api --prod deploy",
    );
    expect(builder).toMatch(/git[^\r\n]*read-tree "\$git_source_sha"/u);
    expect(builder).toMatch(/git[^\r\n]*checkout-index --all/u);
    expect(builder).toContain('diff -qr "$fixture/expected" "$fixture/source"');
    expect(builder).toContain(
      "sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8",
    );
    const lifecycle = readFileSync(
      "scripts/sandbox-container-lifecycle.mjs",
      "utf8",
    );
    expect(lifecycle).toContain('"/sandbox/v1/checkouts"');
    expect(lifecycle).toContain("/request");
    expect(lifecycle).toContain("/approve");
    expect(lifecycle).toContain("/transitions/${transition}");
    expect(lifecycle).toContain("expert_residency_provider_event_inbox");
    expect(lifecycle).toContain("sandbox_expert_residency_events");
    expect(lifecycle).toContain('interval_seconds: "86400"');
    expect(dockerfile).toContain('CMD ["node", "dist/server.js"]');
    expect(dockerfile).toContain("USER 10001:10001");
    const service = sandboxCompose.services["sandbox-api"]!;
    expect(service.image).toBe(
      "${SANDBOX_IMAGE_REF:?SANDBOX_IMAGE_REF is required}",
    );
    expect(service.build).toBeUndefined();
    expect(service.profiles).toContain("sandbox");
    expect(service.read_only).toBe(true);
    expect(service.tmpfs).toContain("/tmp");
    expect(service.cap_drop).toContain("ALL");
    expect(service.security_opt).toContain("no-new-privileges:true");
    expect(service.cpus).toBe(1);
    expect(service.mem_limit).toBe("1g");
    expect(JSON.stringify(service)).not.toContain("docker.sock");
    expect(service.environment).toMatchObject({
      II_TONYA_RUNTIME_MODE: "sandbox",
      PAYMENT_API_KEY: "",
      PAYMENT_TOKEN: "",
      PAYMENT_SECRET: "",
      PAYMENT_WEBHOOK_SECRET: "",
    });
    expect(sandboxCompose.services["sandbox-postgres"]?.ports).toBeUndefined();
    expect(sandboxCompose.networks["sandbox-db"]?.internal).toBe(true);
    expect(service.networks).toEqual(["sandbox-db"]);
  });

  it("does not convert local fixtures or container health into provider evidence", () => {
    const evidence = readFileSync("docs/runbooks/go-live-evidence.md", "utf8");
    const providerEvidence = readFileSync(
      "docs/runbooks/provider-staging-evidence.md",
      "utf8",
    );
    expect(evidence).toContain("Release status: NO-GO");
    expect(evidence).toContain("Live payments: disabled");
    expect(providerEvidence).toContain("Provider staging status: BLOCKED");
    expect(providerEvidence).toContain(
      "Project-owned authenticated sessions: unavailable",
    );
    expect(providerEvidence).not.toContain("Provider staging status: PASS");
  });

  it("drives the sandbox lifecycle through container HTTP and authoritative database assertions", () => {
    const smoke = readFileSync(
      "scripts/run-sandbox-container-smoke.sh",
      "utf8",
    );
    const lifecycle = readFileSync(
      "scripts/sandbox-container-lifecycle.mjs",
      "utf8",
    );
    expect(smoke).toContain("packages/db/migrations/*.sql");
    expect(smoke).toContain("0000_sandbox_expert_residency.sql");
    expect(smoke).toContain("sandbox-container-lifecycle.mjs");
    expect(smoke).toContain("org.opencontainers.image.revision");
    expect(smoke).toContain("sandbox_image_id");
    for (const fragment of [
      "/sandbox/v1/checkouts",
      "/request",
      "/approve",
      "/transitions/${transition}",
      "SANDBOX_REQUESTER_TOKEN",
      "SANDBOX_APPROVER_TOKEN",
      "86400",
      "expert_residency_provider_event_inbox",
      "sandbox_expert_residency_events",
      "expert_residency_payment_attempts",
      "audit_events",
      "integration_outbox",
      "result_schema_version",
    ])
      expect(lifecycle).toContain(fragment);
  });

  it("defines portable non-root API and worker images with the required entrypoints", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("RUN pnpm build");
    expect(dockerfile).toContain("npm config set fetch-timeout 300000");
    expect(dockerfile).toContain("npm config set fetch-retries 5");
    expect(dockerfile).toContain("pnpm config set fetch-timeout 300000");
    expect(dockerfile).toContain("pnpm config set fetch-retries 5");
    expect(dockerfile.match(/for attempt in 1 2 3/g)).toHaveLength(2);
    expect(dockerfile).toContain("FROM runtime-base AS evidence");
    expect(dockerfile).toContain(
      "COPY --chown=10001:10001 tests/provider-stubs/server.mjs /app/tests/provider-stubs/server.mjs",
    );
    expect(dockerfile).toContain(
      "COPY --chown=10001:10001 scripts/smoke.mjs /app/scripts/smoke.mjs",
    );
    expect(dockerfile).toContain(
      "RUN pnpm --filter @ii-tonya/api --prod deploy /out/api",
    );
    expect(dockerfile).toContain(
      "RUN pnpm --filter @ii-tonya/app-worker --prod deploy /out/worker",
    );
    expect(dockerfile).toContain(
      "RUN rm -f /out/api/pnpm-lock.yaml /out/api/pnpm-workspace.yaml",
    );
    expect(dockerfile).toContain(
      "/out/worker/pnpm-lock.yaml /out/worker/pnpm-workspace.yaml",
    );
    expect(dockerfile).toContain(
      'find /out/api /out/worker -type f -name "*.d.ts" -delete',
    );
    expect(dockerfile).toContain('CMD ["node", "dist/server.js"]');
    expect(dockerfile).toContain('CMD ["node", "dist/main.js"]');
    expect(dockerfile).toContain(
      "FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:af85d11ce7ef10172855a6e3649e3e8125b1b9e3ca41849ec2918036f05cb212 AS runtime-base",
    );
    expect(dockerfile).toContain("ENV PATH=/nodejs/bin:$PATH");
    expect(dockerfile).toContain("ENTRYPOINT []");
    expect(dockerfile.match(/node:24\.18\.0-bookworm-slim/g)).toHaveLength(1);
    expect(dockerfile).toContain(
      'CMD ["node", "--input-type=module", "--eval", "const s=(await import(\'node:fs/promises\')).stat;',
    );
    expect(dockerfile.match(/USER 10001:10001/g)).toHaveLength(3);
    expect(dockerfile).toContain(
      "LABEL org.opencontainers.image.revision=$VCS_REF",
    );
  });

  it("prepares an exact Git archive and bundle for the sandbox image smoke", () => {
    const runner = readFileSync("scripts/run-claw-actions-job.sh", "utf8");
    expect(runner).toContain("git archive --format=tar");
    expect(runner).toContain("git bundle create");
    expect(runner).toContain("SANDBOX_SOURCE_ARCHIVE");
    expect(runner).toContain("SOURCE_BUNDLE");
    expect(runner).toContain("DOCKER_HOST_SOURCE_ROOT");
    expect(runner).toContain("DOCKER_HOST_INSTALLED_ROOT");
    expect(runner).toContain("LOCAL_SOURCE_ROOT");
  });

  it("keeps every live capability disabled in local containers", () => {
    const compose = readFileSync("compose.yaml", "utf8");
    for (const flag of [
      "MINOR_ONBOARDING_ENABLED",
      "SELARTI_ENABLED",
      "PLANERKA_ENABLED",
      "TELEGRAM_ENABLED",
      "PAYMENTS_ENABLED",
      "LLM_ENABLED",
      "INTENT_MODEL_ENABLED",
      "MAKE_PROJECTION_ENABLED",
      "GOOGLE_SHEETS_PROJECTION_ENABLED",
    ]) {
      expect(compose).toContain(`${flag}: \"false\"`);
    }
  });

  it("hardens every application and evidence container at runtime", () => {
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
    expect(compose.services["provider-stubs"].user).toBe("10001:10001");
    expect(compose.services.smoke.user).toBe("10001:10001");
  });

  it("probes the API from a disposable container on the internal network", () => {
    const smoke = readFileSync("tests/container/image-smoke.test.mjs", "utf8");
    const compose = readFileSync("compose.yaml", "utf8");
    expect(smoke).toContain(
      'compose(["--profile", "smoke", "run", "--rm", "smoke"]);',
    );
    expect(compose).toContain("--base-url=http://api:3000");
    expect(compose).toContain("profiles: [smoke]");
    expect(compose).toContain("target: evidence");
    expect(compose).not.toContain("./scripts/smoke.mjs:");
    expect(compose).not.toContain("./tests/provider-stubs/server.mjs:");
    expect(smoke).toContain("resolved.startsWith('file:///app/node_modules/')");
    expect(smoke).toContain("resolved.includes('/workspace/')");
    expect(smoke.match(/"--input-type=module"/g)).toHaveLength(4);
  });

  it("fails image scans on every high or critical vulnerability", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(
      workflow.match(/image --severity HIGH,CRITICAL --exit-code 1/g),
    ).toHaveLength(2);
    expect(workflow).not.toContain("--ignore-unfixed");
  });

  it("creates and signs digest-bound SBOMs for both release images", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).not.toContain("anchore/sbom-action");
    expect(workflow).toContain('syft_version="1.42.3"');
    expect(workflow).toContain("gh release download");
    expect(workflow).toContain("--repo anchore/syft");
    expect(workflow).toContain("sha256sum -c --ignore-missing");
    expect(workflow).toContain('echo "$syft_dir" >> "$GITHUB_PATH"');
    expect(workflow).toContain(
      'syft "$API_IMAGE_REF" -o spdx-json=api-sbom.spdx.json',
    );
    expect(workflow).toContain(
      'syft "$WORKER_IMAGE_REF" -o spdx-json=worker-sbom.spdx.json',
    );
    expect(workflow).not.toContain("DOCKER_CONFIG: ${{ runner.temp }}");
    expect(workflow).toContain(
      'docker_config="$RUNNER_TEMP/ii-tonya-docker-config"',
    );
    expect(workflow).toContain(
      'echo "DOCKER_CONFIG=$docker_config" >> "$GITHUB_ENV"',
    );
    expect(workflow).toContain("Remove transient CI credentials and artifacts");
    expect(workflow).toContain('rm -rf "$DOCKER_CONFIG"');
    expect(workflow).toContain('rm -rf "$RUNNER_TEMP/ii-tonya-syft"');
    expect(workflow).toContain(
      "cosign sign-blob --yes --bundle api-sbom.bundle api-sbom.spdx.json",
    );
    expect(workflow).toContain(
      "cosign sign-blob --yes --bundle worker-sbom.bundle worker-sbom.spdx.json",
    );
    expect(workflow).toContain("--arg api_sbom_sha256");
    expect(workflow).toContain("--arg worker_sbom_sha256");
    expect(workflow).toContain("api_sbom_sha256:$api_sbom_sha256");
    expect(workflow).toContain("worker_sbom_sha256:$worker_sbom_sha256");

    const release = readFileSync(".github/workflows/release.yml", "utf8");
    expect(release).toContain("--bundle provenance/api-sbom.bundle");
    expect(release).toContain("--bundle provenance/worker-sbom.bundle");
    expect(release).toContain("provenance/api-sbom.spdx.json");
    expect(release).toContain("provenance/worker-sbom.spdx.json");
    expect(release).toContain(".api_sbom_sha256 == $api_sbom_sha256");
    expect(release).toContain(".worker_sbom_sha256 == $worker_sbom_sha256");
    expect(release).toContain('.primaryPackagePurpose == "CONTAINER"');
  });

  it("defines a target-neutral remote Compose release without bundled credentials or mutable image tags", () => {
    const remote = parse(readFileSync("deploy/compose.remote.yml", "utf8")) as {
      services: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(remote.services).sort()).toEqual([
      "api",
      "migrate",
      "worker",
    ]);
    expect(JSON.stringify(remote)).not.toContain("build");
    expect(JSON.stringify(remote)).not.toContain("postgres-data");
    expect(JSON.stringify(remote)).not.toContain("provider-stubs");

    for (const serviceName of ["migrate", "api", "worker"]) {
      const service = remote.services[serviceName];
      expect(service, serviceName).toBeDefined();
      if (!service) throw new Error(`missing remote service: ${serviceName}`);
      expect(service.env_file, serviceName).toContain(
        "${RUNTIME_ENV_FILE:?RUNTIME_ENV_FILE is required}",
      );
      expect(service.read_only, serviceName).toBe(true);
      expect(service.tmpfs, serviceName).toContain("/tmp");
      expect(service.cap_drop, serviceName).toContain("ALL");
      expect(service.security_opt, serviceName).toContain(
        "no-new-privileges:true",
      );
      expect(service.pids_limit, serviceName).toBe(128);
      expect(service.mem_limit, serviceName).toBe("512m");
      expect(service.cpus, serviceName).toBe(1);
    }
    expect(remote.services.api?.image).toBe(
      "${API_IMAGE_REF:?API_IMAGE_REF is required}",
    );
    expect(remote.services.worker?.image).toBe(
      "${WORKER_IMAGE_REF:?WORKER_IMAGE_REF is required}",
    );
  });

  it("ships a fail-closed remote deployment adapter with migration, health, reconciliation, and rollback commands", () => {
    const adapter = readFileSync("scripts/deploy-compose-remote.sh", "utf8");
    const runtimeValidator = readFileSync(
      "scripts/validate-runtime-env.sh",
      "utf8",
    );
    expect(adapter).toContain("set -euo pipefail");
    expect(adapter).toContain("preflight)");
    expect(adapter).toContain("migration)");
    expect(adapter).toContain("deploy)");
    expect(adapter).toContain("reconcile)");
    expect(adapter).toContain("rollback)");
    expect(adapter).toContain("docker compose");
    expect(adapter).toContain("@sha256:");
    expect(adapter).toContain("UserKnownHostsFile");
    expect(adapter).not.toContain("ssh-keyscan");
    expect(adapter).not.toContain("StrictHostKeyChecking=no");
    expect(adapter).not.toContain("password");
    expect(runtimeValidator).toContain("MIGRATION_COMPATIBILITY_APPROVED_SHA");
    expect(adapter).toContain("RELEASE_SHA");
    expect(adapter).not.toContain("GITHUB_SHA");
    expect(adapter).toContain('test ! -e "$release_dir"');
    expect(adapter).toContain('current_target="$(readlink');
    expect(adapter).toContain("^releases/[0-9a-f]{40}$");
    expect(adapter).toContain("stopped-first-release");
    expect(adapter).toContain(".Config.Image");
    expect(adapter).toContain("unknown_outcome");
    expect(adapter).toContain("migration-recover)");
    expect(adapter).toContain("rollback-complete)");
    expect(adapter).toContain('cat "$deploy_path/.rollback-in-progress"');
    expect(adapter).toContain("capture-current)");
    expect(adapter).toContain("ROLLBACK_API_IMAGE_REF");
    expect(adapter).toContain("ROLLBACK_WORKER_IMAGE_REF");
    expect(adapter).toContain("recoveries/$RELEASE_SHA");
    expect(adapter).toContain("git show");
    expect(adapter).toContain(".rollback-in-progress");
    expect(adapter).toContain("org.opencontainers.image.revision");
  });

  it("accepts only an environment-matching dedicated deployment root", () => {
    const fixture = mkdtempSync(join(tmpdir(), "ii-tonya-deploy-input-"));
    const common = {
      ...process.env,
      DEPLOY_HOST: "staging.example.internal",
      DEPLOY_USER: "ii_tonya",
      DEPLOY_PORT: "22",
      RUNTIME_ENV_FILE: "/etc/ii-tonya/staging.env",
      SSH_KEY_FILE: join(fixture, "key"),
      KNOWN_HOSTS_FILE: join(fixture, "known_hosts"),
      DEPLOY_ENVIRONMENT: "staging",
      API_IMAGE_REF: `ghcr.io/example/api@sha256:${"a".repeat(64)}`,
      WORKER_IMAGE_REF: `ghcr.io/example/worker@sha256:${"b".repeat(64)}`,
      RELEASE_SHA: "c".repeat(40),
    };
    writeFileSync(common.SSH_KEY_FILE, "fixture\n");
    writeFileSync(common.KNOWN_HOSTS_FILE, "fixture\n");

    for (const deployPath of [
      "/opt/ii-tonya-staging",
      "/srv/ii-tonya-staging",
    ]) {
      const result = spawnSync(
        "bash",
        ["scripts/deploy-compose-remote.sh", "validate"],
        { env: { ...common, DEPLOY_PATH: deployPath }, encoding: "utf8" },
      );
      expect(result.status, `${deployPath}: ${result.stderr}`).toBe(0);
    }

    for (const deployPath of [
      "/opt/ii-tonya-production",
      "/opt/ii-tonya-staging/../production",
      "/tmp/ii-tonya-staging",
    ]) {
      const result = spawnSync(
        "bash",
        ["scripts/deploy-compose-remote.sh", "validate"],
        { env: { ...common, DEPLOY_PATH: deployPath }, encoding: "utf8" },
      );
      expect(result.status, deployPath).not.toBe(0);
    }
  }, 15_000);

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

    expect(
      validate("postgresql://user:pass@db.internal/app?sslmode=verify-full")
        .status,
    ).toBe(0);
    expect(
      validate(
        "postgresql://user:pass@db.internal/app?sslmode=verify-full&sslmode=disable",
      ).status,
    ).not.toBe(0);
    expect(
      validate(
        "postgresql://user:pass@db.internal/app?sslmode=verify-full&%73slmode=disable",
      ).status,
    ).not.toBe(0);
    expect(
      validate("postgresql://user:pass@db.internal/app?sslmode=disable").status,
    ).not.toBe(0);
  });

  it("documents a disabled placeholder-only runtime contract for remote hosts", () => {
    const example = readFileSync("deploy/runtime.env.example", "utf8");
    const runbook = readFileSync(
      "docs/runbooks/remote-compose-deployment.md",
      "utf8",
    );
    expect(example).toContain("<database-password>");
    expect(example).toContain("ALLOW_INSECURE_LOCAL_DATABASE=false");
    expect(example).toContain(
      "MIGRATION_COMPATIBILITY_APPROVED_SHA=<full-approved-commit-sha>",
    );
    for (const flag of [
      "MINOR_ONBOARDING_ENABLED",
      "SELARTI_ENABLED",
      "PLANERKA_ENABLED",
      "TELEGRAM_ENABLED",
      "PAYMENTS_ENABLED",
      "LLM_ENABLED",
      "INTENT_MODEL_ENABLED",
      "MAKE_PROJECTION_ENABLED",
      "GOOGLE_SHEETS_PROJECTION_ENABLED",
      "RAW_CONVERSATION_LOGGING",
    ]) {
      expect(example).toContain(`${flag}=false`);
    }
    expect(runbook).toContain("STAGING_SSH_KEY");
    expect(runbook).toContain("STAGING_KNOWN_HOSTS");
    expect(runbook).toContain("PRODUCTION_SSH_KEY");
    expect(runbook).toContain("PRODUCTION_KNOWN_HOSTS");
    expect(runbook).toContain("chmod 640");
    expect(runbook).toContain("Release status: NO-GO");
  });

  it("keeps remote deployment assets inside the mandatory formatting gate", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const formatCheck = manifest.scripts["format:check"] ?? "";
    expect(formatCheck).toContain("deploy/compose.remote.yml");
    expect(formatCheck).toContain("docs/runbooks");
    const deployCheck = manifest.scripts["verify:deploy"] ?? "";
    expect(deployCheck).toContain("bash -n scripts/deploy-compose-remote.sh");
    expect(deployCheck).toContain("scripts/validate-runtime-env.sh");
    expect(deployCheck).toContain("tests/repo/release-assets.test.ts");
    expect(deployCheck).toContain("tests/repo/workflow-semantics.test.ts");
    expect(manifest.scripts.verify).toContain("pnpm verify:deploy");
  });
});
