import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ledgerIntegration = readFileSync(
  "tests/integration/message-ledger-concurrency.test.ts",
  "utf8",
);

describe("message-ledger integration fixture guard", () => {
  it("creates intro packages through the approved admin workflow", () => {
    const orderingCase = ledgerIntegration.slice(
      ledgerIntegration.indexOf("uses paid, earliest expiry"),
      ledgerIntegration.indexOf("rolls back inbox"),
    );

    expect(orderingCase).toContain("grantIntroPackage");
    expect(ledgerIntegration).toContain("package.intro_grant");
    expect(orderingCase).not.toContain("kind: string");
    expect(orderingCase).not.toContain("${kind}");
  });
});
