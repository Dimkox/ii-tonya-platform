import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("lifecycle scheduler migration", () => {
  it("registers the migration in the Drizzle journal", () => {
    const journal = readFileSync(
      "packages/db/migrations/meta/_journal.json",
      "utf8",
    );
    expect(journal).toContain('"tag": "0039_lifecycle_scheduler_c1"');
  });

  it("defines bounded, fenced, deduplicated UTC lifecycle jobs", () => {
    const migration = readFileSync(
      "packages/db/migrations/0039_lifecycle_scheduler_c1.sql",
      "utf8",
    );
    expect(migration).toContain("CREATE TABLE lifecycle_jobs");
    expect(migration).toContain("lifecycle_jobs_subject_type_unique");
    expect(migration).toContain("run_at timestamptz NOT NULL");
    expect(migration).toContain("lease_token");
    expect(migration).toContain("attempt_count");
    expect(migration).toContain("lifecycle_jobs_due_claim_idx");
    expect(migration).not.toContain(
      "CREATE UNIQUE INDEX lifecycle_jobs_dedupe_idx",
    );
    expect(migration).toContain("status <> 'processing'");
  });

  it("lists the complete lifecycle contract", () => {
    const migration = readFileSync(
      "packages/db/migrations/0039_lifecycle_scheduler_c1.sql",
      "utf8",
    );
    for (const jobType of [
      "weekly_checkup",
      "post_visit_feedback",
      "coupon_expiry_14d",
      "coupon_expiry_7d",
    ])
      expect(migration).toContain(jobType);
    expect(migration).toContain("attempt_count BETWEEN 0 AND 5");
    expect(migration).toContain("lifecycle_jobs_subject_kind_check");
    expect(migration).toContain("lifecycle_jobs_occurrence_key_check");
    expect(migration).toContain(
      "UNIQUE (subject_kind, subject_id, job_type, occurrence_key)",
    );
    expect(migration).toContain("status = 'processing'");
    expect(migration).toContain("status <> 'processing'");
  });
});
