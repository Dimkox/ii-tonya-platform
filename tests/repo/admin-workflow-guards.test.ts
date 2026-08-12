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
  it("keeps sandbox approval and transition under one transaction", () => {
    const workflow = readFileSync("packages/sandbox-payments/src/workflow.ts", "utf8");
    expect(workflow).toContain("this.db.transaction");
    expect(workflow).toContain("consumeApprovalInTransaction");
    expect(workflow).toContain("transitionInTransaction");
    expect(workflow.indexOf("this.db.transaction")).toBeLessThan(workflow.indexOf("consumeApprovalInTransaction"));
  });
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

  it("uses one full approval replay validator for both grant and revoke", () => {
    expect(repository).toContain("validateConsumedApprovalReplay");
    expect(repository.match(/validateConsumedApprovalReplay/g)).toHaveLength(2);
    expect(repository).not.toContain(".resolvePrincipal(input.sessionIdHash)");
  });

  it("limits revocation to provenance-bound normal admin grants", () => {
    expect(repository).toContain("p.kind = 'admin'");
    expect(repository).toContain("g.admin_approval_id = p.admin_approval_id");
    expect(repository).toContain("g.admin_requester_session_id_hash = p.admin_requester_session_id_hash");
  });

  it("applies authoritative safety and feedback state transitions under row lock", () => {
    expect(repository).toContain("status = 'acknowledged'");
    expect(repository).toContain("status = 'resolved'");
    expect(repository).toContain("version = version + 1");
    expect(repository).toContain("for update");
    expect(repository).toContain("escalation_status = 'acknowledged'");
    expect(repository).toContain("escalation_status = 'resolved'");
  });

  it("grandfathers only populated pre-0016 admin facts and protects new provenance with FKs", () => {
    expect(migration).toContain("legacy_admin_grant");
    expect(migration).toContain("legacy_admin_fact");
    expect(migration).toContain("REFERENCES \"public\".\"admin_approvals\"");
    expect(migration).toContain("REFERENCES \"public\".\"admin_sessions\"");
    expect(migration).toContain("enforce_admin_ledger_provenance");
  });

  it("replaces the broad handoff append-only trigger with transition-integrity enforcement", () => {
    const transitionTrigger = migration.slice(
      migration.indexOf("CREATE FUNCTION enforce_human_escalation_transition"),
      migration.indexOf("CREATE TRIGGER \"human_escalations_transition_integrity\""),
    );
    expect(migration).toContain("enforce_human_escalation_transition");
    expect(migration).toContain("human escalation deletion is forbidden");
    expect(migration).toContain("NEW.version <> OLD.version + 1");
    expect(migration).toContain("OLD.status = 'opened' AND NEW.status = 'assigned'");
    expect(migration).toContain("OLD.status = 'assigned' AND NEW.status = 'acknowledged'");
    expect(migration).toContain("OLD.status = 'assigned' AND NEW.status = 'escalated'");
    expect(migration).toContain("OLD.status IN ('acknowledged', 'escalated') AND NEW.status = 'resolved'");
    expect(transitionTrigger).toContain("transition_now timestamptz := clock_timestamp()");
    expect(transitionTrigger.match(/clock_timestamp\(\)/g)).toHaveLength(1);
    expect(transitionTrigger).toContain("transition_now < OLD.acknowledgement_deadline");
    expect(transitionTrigger).toContain("NEW.updated_at > transition_now");
    expect(transitionTrigger).toContain("NEW.acknowledged_at < OLD.updated_at");
    expect(transitionTrigger).toContain("NEW.resolved_at < COALESCE(OLD.acknowledged_at, OLD.updated_at)");
  });
});
