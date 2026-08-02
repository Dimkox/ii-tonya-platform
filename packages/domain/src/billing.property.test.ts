import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { derivePackageBalance, type LedgerFact } from "./billing.js";

describe("ledger conservation", () => {
  it("rebuilds the same non-negative balance from append-only facts", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 200 }),
      fc.array(fc.constantFrom<"debit" | "compensation">("debit", "compensation"), { maxLength: 400 }),
      (grant, operations) => {
        const facts: LedgerFact[] = [
          { sequence: 1, kind: "grant", delta: grant, idempotencyKey: "grant" },
        ];
        let expected = grant;
        for (const operation of operations) {
          if (operation === "debit" && expected > 0) {
            expected -= 1;
            facts.push({
              sequence: facts.length + 1,
              kind: "debit",
              delta: -1,
              idempotencyKey: `debit-${facts.length}`,
            });
          } else if (operation === "compensation" && expected < grant) {
            expected += 1;
            facts.push({
              sequence: facts.length + 1,
              kind: "compensation",
              delta: 1,
              idempotencyKey: `compensation-${facts.length}`,
            });
          }
        }
        expect(derivePackageBalance(facts)).toBe(expected);
        expect(derivePackageBalance(facts)).toBeGreaterThanOrEqual(0);
      },
    ), { numRuns: 500 });
  });
});
