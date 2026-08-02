import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("release assets", () => {
  it("contains runtime, rollback, retention, recovery, reconciliation, and evidence assets", () => {
    const required = [
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      ".dockerignore",
      "Dockerfile",
      "compose.yaml",
      "scripts/smoke.mjs",
      "tests/container/image-smoke.test.mjs",
      "tests/provider-stubs/server.mjs",
      "docs/operations/data-retention.md",
      "docs/operations/disaster-recovery.md",
      "docs/operations/reconciliation.md",
      "docs/operations/safety-handoff.md",
      "docs/runbooks/go-live-evidence.md",
      "docs/runbooks/provider-staging-evidence.md",
      "docs/runbooks/rollback.md",
    ];
    expect(required.filter((path) => !existsSync(path))).toEqual([]);
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

  it("defines portable non-root API and worker images with the required entrypoints", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("RUN pnpm build");
    expect(dockerfile).toContain(
      "RUN pnpm --filter @ii-tonya/api --prod deploy /out/api",
    );
    expect(dockerfile).toContain(
      "RUN pnpm --filter @ii-tonya/app-worker --prod deploy /out/worker",
    );
    expect(dockerfile).toContain('CMD ["node", "dist/server.js"]');
    expect(dockerfile).toContain('CMD ["node", "dist/main.js"]');
    expect(dockerfile).toContain("rm -rf /usr/local/lib/node_modules/npm");
    expect(dockerfile).toContain("rm -f /usr/local/bin/npm /usr/local/bin/npx");
    expect(dockerfile.match(/node:24\.18\.0-bookworm-slim/g)).toHaveLength(2);
    expect(dockerfile).toContain(
      'CMD ["node", "--input-type=module", "--eval", "const s=(await import(\'node:fs/promises\')).stat;',
    );
    expect(dockerfile.match(/USER 10001:10001/g)).toHaveLength(2);
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
    expect(smoke).toContain("resolved.startsWith('file:///app/node_modules/')");
    expect(smoke).toContain("resolved.includes('/workspace/')");
    expect(smoke.match(/"--input-type=module"/g)).toHaveLength(2);
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
    expect(
      workflow.match(
        /uses: anchore\/sbom-action@e22c389904149dbc22b58101806040fa8d37a610/g,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain("image: ${{ env.API_IMAGE_REF }}");
    expect(workflow).toContain("image: ${{ env.WORKER_IMAGE_REF }}");
    expect(workflow).toContain("output-file: api-sbom.spdx.json");
    expect(workflow).toContain("output-file: worker-sbom.spdx.json");
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
});
