import { expect, it, vi } from "vitest";
import { PostgresPaymentsPilotLedger } from "./payments-pilot-ledger.js";

it("checks the terminal payment state after taking a transaction-wide payment lock", async () => {
  const statements: string[] = [];
  const db = {
    transaction: vi.fn(async (work: (tx: unknown) => unknown) =>
      work({
        execute: async (statement: { queryChunks?: unknown[] }) => {
          statements.push(JSON.stringify(statement));
          return {
            rows:
              statements.length === 3
                ? [
                    {
                      principal_id: "11111111-2222-4333-8444-555555555555",
                      action: "PAYMENTS_PILOT_CREATED",
                      decision: "succeeded",
                      reason_code: "amount_minor:1000",
                    },
                  ]
                : [],
          };
        },
      }),
    ),
  };
  const ledger = new PostgresPaymentsPilotLedger(db as never);
  await ledger.recordStatus({
    providerPaymentId: "2f4b6d0d-000f-5000-9000-000000000601",
    principalId: "11111111-2222-4333-8444-555555555555",
    status: "pending",
  });
  expect(db.transaction).toHaveBeenCalledOnce();
  expect(statements[1]).toContain("pg_advisory_xact_lock");
  expect(statements[1]).toContain("2f4b6d0d-000f-5000-9000-000000000601");
  expect(statements[0]).toContain("SET LOCAL lock_timeout");
});
