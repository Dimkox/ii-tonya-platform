import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = { name?: string; run?: string; uses?: string };

describe("CI and release workflow semantics", () => {
  it("runs every planned repeat gate count-first exactly three times", () => {
    const dbGateText = readFileSync(".github/workflows/db-gate.yml", "utf8");
    const planText = readFileSync(
      "docs/superpowers/plans/2026-08-03-expert-residency-referrals.md",
      "utf8",
    );
    const traceabilityText = readFileSync(
      "docs/spec/expert-residency-referrals-traceability.md",
      "utf8",
    );
    const trackedDocumentationText = `${planText}\n${traceabilityText}`;
    const trackedRepeatPolicyText = `${dbGateText}\n${trackedDocumentationText}`;
    const dbGate = parse(dbGateText);
    const workflowCommands = (
      dbGate.jobs["postgres-schema"].steps as WorkflowStep[]
    )
      .map((step) => step.run ?? "")
      .filter((run) => run.includes("pnpm test:repeat"));
    const documentedCommands = trackedDocumentationText.match(
      /pnpm test:repeat[^`\n]*/gu,
    );
    const plannedCommands = [
      ...workflowCommands,
      ...(documentedCommands ?? []),
    ];

    expect(trackedRepeatPolicyText).toContain("## External release gates");
    expect(plannedCommands.length).toBeGreaterThan(0);
    expect(
      plannedCommands.every((command) =>
        /pnpm test:repeat\s+--\s+3(?:\s|$)/u.test(command),
      ),
    ).toBe(true);
    expect(trackedRepeatPolicyText).not.toMatch(
      /pnpm test:repeat[^`\n]*(?:--\s+20\b|\b20\s*$)/u,
    );
  });

  it("makes the expert referral database and release gates executable", () => {
    const workflow = parse(
      readFileSync(".github/workflows/db-gate.yml", "utf8"),
    );
    const dbRuns = (workflow.jobs["postgres-schema"].steps as WorkflowStep[])
      .map((step) => step.run ?? "")
      .join("\n");
    for (const path of [
      "tests/integration/expert-referral-redemption-concurrency.test.ts",
      "tests/integration/expert-residency-checkout-concurrency.test.ts",
      "tests/integration/expert-residency-settlement-concurrency.test.ts",
      "tests/integration/expert-residency-deadline.test.ts",
      "tests/integration/expert-residency-hold-replay.test.ts",
      "tests/integration/expert-residency-refund-reversal.test.ts",
      "tests/integration/expert-referral-migration-upgrade.test.ts",
      "tests/repo/db-schema-parity.test.ts",
      "tests/repo/scope-boundary.test.ts",
    ]) {
      expect(dbRuns).toContain(path);
    }
    expect(dbRuns).toContain("pnpm test:repeat -- 3 ");

    const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const ciRuns = (ci.jobs.verify.steps as WorkflowStep[])
      .map((step) => step.run ?? "")
      .join("\n");
    expect(ciRuns).toContain("pnpm verify:expert-residency-release");

    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(manifest.scripts?.verify).toContain(
      "pnpm verify:expert-residency-release",
    );
    expect(manifest.scripts?.["verify:expert-residency-release"]).toBeTruthy();
    expect(manifest.scripts?.["test:integration"]).toContain("--maxWorkers=4");
    expect(manifest.scripts?.verify).not.toContain("pnpm verify &&");
  });

  it("ships complete and path-valid ERR-FR-001 through ERR-FR-042 traceability", () => {
    const path = "docs/spec/expert-residency-referrals-traceability.md";
    expect(existsSync(path)).toBe(true);
    const traceability = readFileSync(path, "utf8");
    const rows = traceability
      .split(/\r?\n/u)
      .filter((line) => /^\|\s*ERR-FR-\d{3}\s*\|/u.test(line));
    const expectedIds = Array.from(
      { length: 42 },
      (_, index) => `ERR-FR-${String(index + 1).padStart(3, "0")}`,
    );
    expect(rows.map((row) => row.split("|")[1]?.trim())).toEqual(expectedIds);

    for (const row of rows) {
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(7);
      expect(cells.every((cell) => cell.length > 0 && cell !== "covered")).toBe(
        true,
      );
      const citedPaths = [
        ...row.matchAll(
          /`([^`# ]+\/[^`# ]+\.(?:ts|md|yml|yaml|json|sql|mjs))(?:#[^`]*)?`/gu,
        ),
      ].map((match) => match[1]!);
      expect(citedPaths.length).toBeGreaterThanOrEqual(2);
      expect(citedPaths.every((citedPath) => existsSync(citedPath))).toBe(true);
    }
  });

  it("keeps expert release runbooks fail-closed, synthetic, and redacted", () => {
    const operations = readFileSync(
      "docs/runbooks/expert-residency-referrals.md",
      "utf8",
    );
    const rollback = readFileSync(
      "docs/runbooks/expert-residency-referrals-rollback.md",
      "utf8",
    );
    const combined = `${operations}\n${rollback}`;
    for (const required of [
      "SYNTHETIC-ONLY",
      "PENDING/BLOCKING",
      "EXPERT_REFERRAL_ENABLED=false",
      "EXPERT_RESIDENCY_BILLING_ENABLED=false",
      "HMAC",
      "kill switch",
      "held replay",
      "chargeback",
      "debt",
      "reconciliation",
      "500/500",
      "forward-fix",
    ]) {
      expect(combined).toContain(required);
    }
    expect(combined).not.toMatch(/rm\s+-rf|truncate\s+table|delete\s+from/iu);
    expect(combined).not.toMatch(
      /(?:api[_-]?key|token|secret)\s*=\s*(?!<REDACTED>)/iu,
    );
  });

  it("distinguishes provider-neutral reconciliation state from live payment activation", () => {
    const reconciliation = readFileSync(
      "docs/operations/reconciliation.md",
      "utf8",
    );

    expect(reconciliation).toContain("PAYMENT_PROVIDER=disabled");
    expect(reconciliation).toMatch(/provider-neutral contracts and tables/iu);
    expect(reconciliation).toContain("expert_residency_payment_attempts");
    expect(reconciliation).toContain("expert_residency_provider_event_inbox");
    for (const forbiddenLiveSurface of [
      "route",
      "adapter",
      "SDK",
      "credential",
      "provider configuration activation",
      "composition",
    ]) {
      expect(reconciliation).toContain(forbiddenLiveSurface);
    }
    expect(reconciliation).not.toContain(
      "no payment routes, tables, or provider configuration exist",
    );
  });

  it("installs the frozen dependency graph before every pnpm execution", () => {
    const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const steps = workflow.jobs.verify.steps as WorkflowStep[];
    const install = steps.findIndex((step) =>
      step.run?.includes("pnpm install --frozen-lockfile"),
    );
    const build = steps.findIndex((step) => step.run?.trim() === "pnpm build");
    const executable = steps
      .map((step, index) => ({ index, run: step.run ?? "" }))
      .filter(({ run }) =>
        /\bpnpm (exec|verify|test|lint|typecheck)\b/.test(run),
      );
    expect(install).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(install);
    expect(executable.every(({ index }) => index > build)).toBe(true);
    expect(steps.some((step) => step.run?.includes("pnpm verify"))).toBe(true);
    expect(JSON.stringify(workflow)).not.toContain("corepack");
  });

  it("derives release images only from signed provenance of a successful exact CI run", () => {
    const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const workflow = parse(
      readFileSync(".github/workflows/release.yml", "utf8"),
    );
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      "ci_run_id",
      "migration_approval_pr",
      "migration_approval_review_id",
    ]);
    expect(JSON.stringify(workflow.on.workflow_dispatch.inputs)).not.toContain(
      "image_digest",
    );
    const ciText = JSON.stringify(ci.jobs.verify);
    expect(ciText).toContain("docker push");
    expect(ciText).toContain("imagetools inspect");
    expect(ciText).not.toContain("docker image inspect");
    expect(ciText).toContain("cosign sign --yes");
    expect(ciText).toContain("cosign sign-blob");
    expect(ciText).toContain("release-provenance-${{ github.sha }}");
    const publishSteps = (
      ci.jobs.verify.steps as Array<WorkflowStep & { if?: string }>
    ).filter(
      (step) =>
        step.name?.includes("GHCR") ||
        step.name?.includes("Publish tested") ||
        step.name?.includes("Sign exact") ||
        step.name?.includes("signed release provenance"),
    );
    expect(publishSteps.length).toBeGreaterThan(0);
    expect(
      publishSteps.every(
        (step) =>
          step.if ===
          "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      ),
    ).toBe(true);
    expect(ci.on.push.branches).toEqual(["main"]);

    const provenanceText = JSON.stringify(workflow.jobs.verify_provenance);
    const provenanceRun = (
      workflow.jobs.verify_provenance.steps as WorkflowStep[]
    )
      .map((step) => step.run ?? "")
      .join("\n");
    expect(provenanceText).toContain("actions/runs/$CI_RUN_ID");
    expect(provenanceRun).toContain('.conclusion == "success"');
    expect(provenanceRun).toContain('.path == ".github/workflows/ci.yml"');
    expect(provenanceRun).toContain('.head_branch == "main"');
    expect(provenanceRun).toContain('test "$GITHUB_REF" = "refs/heads/main"');
    expect(provenanceRun).toContain("MIGRATION-COMPATIBILITY:");
    expect(provenanceRun).toContain(".user.login != $actor");
    expect(JSON.stringify(workflow.on.workflow_dispatch.inputs)).toContain(
      "migration_approval_review_id",
    );
    expect(provenanceRun).not.toContain('startswith("codex/")');
    expect(provenanceText).toContain("run-id");
    expect(provenanceText).toContain("cosign verify-blob");
    expect(provenanceText).toContain("cosign verify --certificate-identity");
    expect(provenanceText).toContain("token.actions.githubusercontent.com");
    expect(provenanceText).toContain("@sha256:");
    expect(workflow.jobs.release.needs).toEqual(
      expect.arrayContaining(["verify_provenance", "staging", "evidence_gate"]),
    );
    expect(JSON.stringify(workflow.jobs.release)).toContain("image_ref");
    expect(JSON.stringify(workflow.jobs.evidence_gate)).toContain(
      "Release status: GO",
    );
    expect(JSON.stringify(workflow.jobs.evidence_gate)).toContain(
      "Provider staging status: PASS",
    );
    expect(JSON.stringify(workflow.jobs.evidence_gate)).toContain(
      "release-evidence.bundle",
    );

    const stagingSteps = workflow.jobs.staging.steps as WorkflowStep[];
    const productionSteps = workflow.jobs.release.steps as WorkflowStep[];
    for (const steps of [stagingSteps, productionSteps]) {
      const names = steps.map((step) => step.name?.toLowerCase() ?? "");
      const deploy = names.findIndex((name) => name.includes("deploy"));
      const migration = names.findIndex((name) =>
        name.includes("migration preflight"),
      );
      const smoke = names.findIndex((name) => name.includes("smoke"));
      const reconciliation = names.findIndex((name) =>
        name.includes("reconciliation"),
      );
      expect(migration).toBeGreaterThanOrEqual(0);
      expect(deploy).toBeGreaterThan(migration);
      expect(smoke).toBeGreaterThan(deploy);
      expect(reconciliation).toBeGreaterThan(smoke);
    }
    expect(JSON.stringify(workflow.jobs.release)).toContain("rollback.md");
    expect(JSON.stringify(workflow)).not.toContain(
      "deployment adapter is not configured",
    );
    expect(JSON.stringify(workflow.jobs.staging)).toContain(
      "scripts/deploy-compose-remote.sh",
    );
    expect(JSON.stringify(workflow.jobs.release)).toContain(
      "scripts/deploy-compose-remote.sh",
    );
    expect(JSON.stringify(workflow.jobs.staging)).toContain(
      "secrets.STAGING_SSH_KEY",
    );
    expect(JSON.stringify(workflow.jobs.staging)).toContain(
      "secrets.STAGING_KNOWN_HOSTS",
    );
    expect(JSON.stringify(workflow.jobs.release)).toContain(
      "secrets.PRODUCTION_SSH_KEY",
    );
    expect(JSON.stringify(workflow.jobs.release)).toContain(
      "secrets.PRODUCTION_KNOWN_HOSTS",
    );
    expect(JSON.stringify(workflow.jobs.release)).toContain("rollback");
    expect(workflow.jobs.evidence_gate.needs).toEqual(
      expect.arrayContaining(["verify_provenance", "staging"]),
    );
    expect(JSON.stringify(workflow.jobs.evidence_gate)).toContain(
      "staging-evidence-${{ github.run_id }}",
    );
    expect(JSON.stringify(workflow.jobs.evidence_gate)).toContain(
      "staging-evidence.txt",
    );
    for (const jobName of ["staging", "release"]) {
      const job = workflow.jobs[jobName];
      expect(job.env.RELEASE_SHA).toBe(
        "${{ needs.verify_provenance.outputs.head_sha }}",
      );
      const steps = job.steps as Array<
        WorkflowStep & { id?: string; if?: string }
      >;
      expect(
        steps.some((step) =>
          step.run?.includes("deploy-compose-remote.sh migration"),
        ),
      ).toBe(true);
      const rollback = steps.find((step) =>
        step.run?.includes("deploy-compose-remote.sh rollback"),
      );
      expect(rollback?.if).toBe(
        "failure() && steps.deploy.outcome != 'skipped'",
      );
    }
    for (const jobName of ["staging", "evidence_gate", "release"]) {
      const checkout = (
        workflow.jobs[jobName].steps as Array<
          WorkflowStep & { with?: { ref?: string } }
        >
      ).find((step) => step.uses?.startsWith("actions/checkout@"));
      expect(checkout?.with?.ref).toBe(
        "${{ needs.verify_provenance.outputs.head_sha }}",
      );
    }
  });

  it("runs migration recovery when migration starts but deployment is skipped", () => {
    const workflow = parse(
      readFileSync(".github/workflows/release.yml", "utf8"),
    );
    for (const jobName of ["staging", "release"]) {
      const steps = workflow.jobs[jobName].steps as Array<
        WorkflowStep & { id?: string; if?: string }
      >;
      expect(
        steps.some(
          (step) =>
            step.id === "migration" &&
            step.run?.includes("deploy-compose-remote.sh migration"),
        ),
      ).toBe(true);
      const recovery = steps.find((step) =>
        step.run?.includes("deploy-compose-remote.sh migration-recover"),
      );
      expect(recovery?.if).toBe(
        "failure() && steps.migration.outcome != 'skipped' && steps.deploy.outcome == 'skipped'",
      );
    }
  });

  it("captures and verifies signed rollback digests before deployment", () => {
    const workflow = parse(
      readFileSync(".github/workflows/release.yml", "utf8"),
    );
    for (const jobName of ["staging", "release"]) {
      const steps = workflow.jobs[jobName].steps as WorkflowStep[];
      expect(
        steps.some((step) =>
          step.run?.includes("deploy-compose-remote.sh capture-current"),
        ),
      ).toBe(true);
      expect(
        steps.some(
          (step) =>
            step.run?.includes("cosign verify") &&
            step.run?.includes("ROLLBACK_API_IMAGE_REF"),
        ),
      ).toBe(true);
      const rollback = steps.find((step) =>
        step.run?.includes("deploy-compose-remote.sh rollback"),
      );
      expect(rollback?.run).toContain("smoke.mjs");
      expect(rollback?.run).toContain("rollback-complete");
    }
  });
});
