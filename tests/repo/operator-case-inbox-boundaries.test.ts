import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = "packages/db/migrations/0028_operator_case_inbox.sql";

describe("MVP-OPS-CASE-001 repository boundary", () => {
  it("keeps operator cases limited to reviewed metadata", async () => {
    const migration = await readFile(migrationPath, "utf8");
    for (const column of [
      '"case_type"',
      '"status"',
      '"rating"',
      '"content_hash"',
      '"policy_version"',
      '"acknowledged_at"',
      '"resolved_at"',
      '"updated_at"',
    ])
      expect(migration).toContain(column);
    expect(migration).not.toMatch(
      /"(?:raw_text|feedback_text|dialogue|narrative|user_id|expert_id|reservation_id|handoff_id|feedback_id|payment_url|payload)"/u,
    );
    expect(migration).toContain(
      "'safety','negative_feedback','delivery_failure'",
    );
    expect(migration).toContain("'open','acknowledged','resolved'");
  });

  it("materializes locally without a network or notifier capability", async () => {
    const worker = await readFile(
      "packages/db/src/repositories/worker-jobs-repository.ts",
      "utf8",
    );
    expect(worker).toContain("materializeOperatorCasesBatch");
    expect(worker).toContain("safety.operator_escalation");
    expect(worker).toContain("admin.negative_feedback");
    expect(worker).not.toMatch(/\bfetch\s*\(|https?:\/\//u);
  });

  it("never exposes the source outbox key or payload from the read repository", async () => {
    const repository = await readFile(
      "packages/db/src/repositories/operator-case-repository.ts",
      "utf8",
    );
    expect(repository).not.toMatch(/as\s+"?(?:outboxId|payload)"?/u);
    expect(repository).toContain("for update");
    expect(repository).toContain("operator_case.transitioned");
  });
});
