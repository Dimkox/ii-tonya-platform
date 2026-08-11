import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("expert residency referral release readiness", () => {
  it("maps every ERR-FR requirement to implementation and verification evidence", () => {
    const traceability = read(
      "docs/spec/expert-residency-referrals-traceability.md",
    );
    const ids = Array.from(
      { length: 42 },
      (_, index) => `ERR-FR-${String(index + 1).padStart(3, "0")}`,
    );
    for (const id of ids) {
      expect(traceability).toContain(`| ${id} |`);
    }
    const requirementRows = traceability
      .split("\n")
      .filter((line) => /^\| ERR-FR-\d{3} \|/u.test(line));
    expect(requirementRows).toHaveLength(42);
    for (const row of requirementRows) {
      const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
      expect(cells).toHaveLength(7);
      expect(cells.every((cell) => cell.length > 0)).toBe(true);
    }
  });

  it("ships operating and rollback procedures without authorizing activation", () => {
    const operations = read("docs/runbooks/expert-residency-referrals.md");
    const rollback = read(
      "docs/runbooks/expert-residency-referrals-rollback.md",
    );
    for (const required of [
      "Default state",
      "Key rotation",
      "Kill switch",
      "Reconciliation",
      "Held reward replay",
      "Refund and chargeback response",
      "Debt investigation",
      "Database recovery",
      "Client 500/500 isolation proof",
    ]) {
      expect(operations).toContain(required);
    }
    for (const required of [
      "Immediate containment",
      "Application rollback",
      "Migration rollback versus forward-fix",
      "Database restore",
      "Reward or balance incident",
      "Validation after rollback",
    ]) {
      expect(rollback).toContain(required);
    }
    expect(operations.toLowerCase()).toContain("does not authorize");
    expect(rollback.toLowerCase()).toContain("does not authorize");
  });

  it("keeps expert referral/residency and payment provider defaults disabled", () => {
    const env = read(".env.example");
    expect(env).toContain("EXPERT_REFERRAL_ENABLED=false");
    expect(env).toContain("EXPERT_RESIDENCY_BILLING_ENABLED=false");
    expect(env).toContain("PAYMENTS_ENABLED=false");
    expect(env).toContain("PAYMENT_PROVIDER=disabled");
  });

  it("composes the expert residency worker with a disabled provider reader", () => {
    const main = read("apps/worker/src/main.ts");
    expect(main).toContain("disabledExpertResidencyProviderReader");
    expect(main).toContain("kind: \"disabled\"");
    expect(main).not.toMatch(/\b(?:fetch|axios|stripe|yookassa)\b/u);
  });
});
