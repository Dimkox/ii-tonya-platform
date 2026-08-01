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
      publishSteps.every((step) => step.if === "github.event_name == 'push'"),
    ).toBe(true);

    const provenanceText = JSON.stringify(workflow.jobs.verify_provenance);
    const provenanceRun = (
      workflow.jobs.verify_provenance.steps as WorkflowStep[]
    )
      .map((step) => step.run ?? "")
      .join("\n");
    expect(provenanceText).toContain("actions/runs/$CI_RUN_ID");
    expect(provenanceRun).toContain('.conclusion == "success"');
    expect(provenanceRun).toContain('.path == ".github/workflows/ci.yml"');
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
      expect(deploy).toBeGreaterThanOrEqual(0);
      expect(migration).toBeGreaterThan(deploy);
      expect(smoke).toBeGreaterThan(migration);
      expect(reconciliation).toBeGreaterThan(smoke);
    }
    expect(JSON.stringify(workflow.jobs.release)).toContain("rollback.md");
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
});
