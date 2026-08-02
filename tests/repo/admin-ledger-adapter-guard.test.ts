import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminLedgerIntegration = readFileSync(
  "tests/integration/admin-ledger.test.ts",
  "utf8",
);

describe("admin ledger PostgreSQL adapter guard", () => {
  it("checks direct handoff rejections through exact PostgreSQL causes", () => {
    expect(adminLedgerIntegration).toContain("expectPostgresErrorCause");
    expect(adminLedgerIntegration).toContain('"P0001"');
    expect(adminLedgerIntegration).not.toMatch(
      /\.rejects\.toThrow\("(?:human escalation|invalid [^"]*human escalation)/,
    );
  });

  it("projects raw handoff timestamps as database booleans", () => {
    expect(adminLedgerIntegration).toContain('as "acknowledgedAtIsSet"');
    expect(adminLedgerIntegration).toContain('as "resolvedAtIsSet"');
    expect(adminLedgerIntegration).not.toContain("expect.any(Date)");
    expect(adminLedgerIntegration).not.toContain("Date | null");
  });
});
