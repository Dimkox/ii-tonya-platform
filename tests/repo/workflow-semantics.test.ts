import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = { name?: string; run?: string; uses?: string };

type WorkflowJob = {
  if?: string;
  needs?: string;
  "runs-on"?: string | string[];
  steps: Array<WorkflowStep & { id?: string; if?: string }>;
};

describe("CI and release workflow semantics", () => {
  it("keeps merge and release controls independent of paid hosted runners", () => {
    const native = parse(
      readFileSync(".github/workflows/server-native.yml", "utf8"),
    );
    const release = parse(
      readFileSync(".github/workflows/release.yml", "utf8"),
    );

    expect(native.on.push).toBeUndefined();
    expect(native.on.workflow_dispatch).toBeDefined();
    expect(native.jobs.deploy).toBeUndefined();
    expect(JSON.stringify(native.jobs["legacy-disabled"])).toContain(
      "Legacy native deployment is disabled",
    );
    expect(JSON.stringify(native.jobs["legacy-disabled"])).toContain("exit 1");
    expect(JSON.stringify(release)).not.toContain("ubuntu-24.04");
    for (const job of Object.values(release.jobs) as WorkflowJob[]) {
      expect(job["runs-on"]).toEqual([
        "self-hosted",
        "linux",
        "x64",
        "claw",
        "ii-tonya-release",
      ]);
    }
  });

  it("runs mandatory pull-request checks on the isolated Claw test profile", () => {
    for (const [file, jobName, mode] of [
      [".github/workflows/ci.yml", "verify", "ci"],
      [".github/workflows/db-gate.yml", "postgres-schema", "database"],
    ] as const) {
      const workflow = parse(readFileSync(file, "utf8"));
      const job = workflow.jobs[jobName] as WorkflowJob;
      expect(job["runs-on"]).toEqual([
        "self-hosted",
        "linux",
        "x64",
        "claw",
        "ii-tonya-test",
      ]);
      expect(job.if).toContain("github.repository_owner");
      expect(job.if).toContain("github.event.pull_request.user.login");
      expect(JSON.stringify(job)).toContain(
        `scripts/run-claw-actions-job.sh ${mode}`,
      );
      expect(JSON.stringify(job)).not.toContain("ubuntu-24.04");
    }
  });

  it("installs the frozen dependency graph before every pnpm execution", () => {
    const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const steps = workflow.jobs.verify.steps as WorkflowStep[];
    const runner = readFileSync("scripts/run-claw-actions-job.sh", "utf8");
    const install = runner.indexOf("pnpm install --frozen-lockfile");
    const build = runner.indexOf("pnpm build", install);
    const verify = runner.indexOf("pnpm exec vitest run --maxWorkers=1", build);
    expect(install).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(install);
    expect(verify).toBeGreaterThan(build);
    expect(
      steps.some((step) => step.run?.includes("run-claw-actions-job.sh ci")),
    ).toBe(true);
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

  it("runs the mandatory expert residency database gates three times", () => {
    const runs = readFileSync("scripts/run-claw-actions-job.sh", "utf8");

    expect(runs).toContain("tests/repo/db-schema-parity.test.ts");
    for (const path of [
      "tests/integration/expert-referral-redemption-concurrency.test.ts",
      "tests/integration/expert-residency-checkout-concurrency.test.ts",
      "tests/integration/expert-residency-settlement-concurrency.test.ts",
      "tests/integration/expert-residency-deadline.test.ts",
      "tests/integration/expert-residency-hold-replay.test.ts",
    ]) {
      expect(runs).toContain(`pnpm test:repeat -- 3 ${path}`);
    }
    expect(runs).not.toContain("pnpm test:repeat -- 20 ");
    expect(runs).not.toContain("EXPERT_REFERRAL_ENABLED=true");
    expect(runs).not.toContain("EXPERT_RESIDENCY_BILLING_ENABLED=true");
  });

  it("limits server control to explicit manual dispatch", () => {
    const workflow = parse(
      readFileSync(".github/workflows/server-control.yml", "utf8"),
    );
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({
      group: "ii-tonya-server-control",
      "cancel-in-progress": true,
    });
    expect(Object.keys(workflow.jobs)).toEqual(["command"]);
    expect((workflow.jobs.command as WorkflowJob).if).toBeUndefined();
  });

  it("keeps server command failure while publishing only safe metadata", () => {
    const workflow = parse(
      readFileSync(".github/workflows/server-control.yml", "utf8"),
    );
    const command = workflow.jobs.command as WorkflowJob;
    const execute = command.steps.find((step) => step.id === "execute");
    const publish = command.steps.find(
      (step) => step.name === "Publish safe command status",
    );
    expect(execute?.run).toContain('exit "$status"');
    expect(publish?.if).toBe("always()");
    expect(JSON.stringify(publish)).toContain("steps.execute.outputs.status");
    expect(publish?.run).not.toContain("server-command-output.txt");
    expect(publish?.run).not.toContain("head -c");
    expect(publish?.run).toContain("GITHUB_STEP_SUMMARY");
    expect(JSON.stringify(workflow)).not.toContain("gh issue comment");
    expect(JSON.stringify(workflow)).not.toContain("base64");

    const commandScript = readFileSync("ops/server-command.sh", "utf8");
    expect(commandScript).not.toContain("command=$BASH_COMMAND");
    expect(commandScript).toContain(
      "Failed to configure the database role password.",
    );
  });
});
