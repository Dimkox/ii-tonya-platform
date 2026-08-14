import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

describe("MVP worker outbox delivery boundaries", () => {
  it("owns exactly the two approved local topics without provider composition", () => {
    const registry = read("packages/worker/src/local-operator-case-outbox.ts");
    const localRepository = read(
      "packages/db/src/repositories/operator-case-outbox-repository.ts",
    );
    const topicLiterals = [
      ...registry.matchAll(
        /"(safety\.operator_escalation|admin\.negative_feedback)"/gu,
      ),
    ].map((match) => match[1]);

    expect(new Set(topicLiterals)).toEqual(
      new Set(["safety.operator_escalation", "admin.negative_feedback"]),
    );
    expect(registry).not.toMatch(
      /provider|telegram|selarti|planerka|yookassa/iu,
    );
    expect(localRepository).not.toMatch(
      /provider_operation|recipient|transport|telegram|selarti|planerka|yookassa/iu,
    );
  });

  it("adds no migration and keeps the feature false in the tracked example", () => {
    const migrations = readdirSync("packages/db/migrations")
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort();
    expect(migrations.at(-1)).toBe("0028_operator_case_inbox.sql");
    expect(read(".env.example")).toContain(
      "WORKER_OUTBOX_DELIVERY_ENABLED=false",
    );
  });

  it("keeps disabled legacy SQL pending-only and documents drain-before-disable", () => {
    const jobsRepository = read(
      "packages/db/src/repositories/worker-jobs-repository.ts",
    );
    const legacyMethod = jobsRepository.slice(
      jobsRepository.indexOf("async materializeOperatorCasesBatch"),
      jobsRepository.indexOf("async deliverSafetyEscalationsBatch"),
    );
    expect(legacyMethod).toContain("status in ('pending', 'retry_wait')");
    expect(legacyMethod).not.toMatch(
      /unknown_outcome|reconciling|processing/gu,
    );

    const runtime = read("apps/worker/src/runtime.ts");
    expect(runtime).toContain("owned_by_filtered_runner");
    const runbook = read("docs/runbooks/worker-outbox-delivery.md");
    expect(runbook).toContain("Drain before planned disable");
    expect(runbook).toContain("processing");
    expect(runbook).toContain("reconciling");
    expect(runbook).toContain("unknown_outcome");
    expect(runbook).toContain("Emergency disable pauses durable unknown rows");
    expect(runbook).not.toMatch(/reset.*unknown|rewrite.*unknown/iu);
  });

  it("binds traceability and the implementation report without activation claims", () => {
    const traceability = read(
      "docs/spec/mvp-worker-outbox-001-traceability.md",
    );
    const progress = read("docs/spec/mvp-worker-outbox-001-progress.md");
    const report = read(".superpowers/sdd/mvp-worker-outbox-001-report.md");
    for (const requirement of Array.from(
      { length: 13 },
      (_, index) => index + 1,
    )) {
      expect(traceability).toContain(`WORKER-OUTBOX-001-R${requirement}`);
    }
    expect(progress).toMatch(/Task 5 runtime\/metrics\s+\| complete/gu);
    expect(report).toContain("No provider activation");
    expect(report).toContain("No production deployment");
    expect(report).not.toMatch(/provider activation[^\n]*PASS/iu);
  });
});
