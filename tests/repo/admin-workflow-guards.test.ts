import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repository = readFileSync(
  "packages/db/src/repositories/admin-repository.ts",
  "utf8",
);
const migration = readFileSync(
  "packages/db/migrations/0016_task17c_admin_workflows.sql",
  "utf8",
);

describe("Task 17C structural guards", () => {
  it("exposes exact workflow methods and no generic mutation switch", () => {
    for (const method of [
      "createClient",
      "deactivateClient",
      "grantPackage",
      "grantIntroPackage",
      "revokePackage",
      "verifyExpert",
      "suspendExpert",
      "activateService",
      "deactivateService",
      "resolveIntegrationError",
      "acknowledgeSafetyAlert",
      "resolveSafetyAlert",
      "acknowledgeNegativeFeedback",
      "resolveNegativeFeedback",
    ]) {
      expect(repository).toContain(`async ${method}(`);
    }
    expect(repository).not.toContain("admin.mutate");
    expect(repository).not.toContain("authorizationHeader");
    expect(repository).not.toContain("rawText");
  });

  it("keeps approval consumption, mutation callback, and allow audit under one database transaction", () => {
    const transaction = repository.slice(
      repository.indexOf("private async executeApproved"),
      repository.indexOf("async createClient"),
    );
    expect(transaction).toContain("this.db.transaction");
    expect(transaction.indexOf(".consumeApproval(")).toBeLessThan(
      transaction.indexOf("mutate(tx, approval)"),
    );
    expect(transaction.indexOf("mutate(tx, approval)")).toBeLessThan(
      transaction.indexOf("decision: \"allowed\""),
    );
  });

  it("has one consolidated additive migration and immutable case-action trigger", () => {
    const task17cMigrations = readdirSync("packages/db/migrations")
      .filter((name) => name.startsWith("0016_"));
    expect(task17cMigrations).toEqual(["0016_task17c_admin_workflows.sql"]);
    expect(migration).toContain("admin_case_actions_append_only");
    expect(migration).toContain("message_packages_admin_contract");
    expect(migration).toContain("admin_requester_session_id_hash");
  });
});
