import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = { name?: string; run?: string; uses?: string };

describe("CI and release workflow semantics", () => {
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
