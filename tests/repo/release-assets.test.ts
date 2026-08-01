import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
  });
});
