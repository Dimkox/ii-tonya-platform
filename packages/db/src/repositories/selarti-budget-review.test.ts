import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { PostgresSelartiBudgetRepository } from "./selarti-budget-repository.js";
import type { DrizzleDb } from "../client.js";

describe("budget outcome reconciliation against durable replies", () => {
  it("returns conflict without writing usage or releases when a reply already establishes application", async () => {
    const writes: string[] = [];
    const dialect = new PgDialect();
    const tx = {
      execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const text = dialect.sqlToQuery(query).sql;
        if (text.includes("selarti_response_proposals"))
          return { rows: [{ found: true }] };
        if (text.includes("select reserved_rub_minor"))
          return { rows: [{ reserved: "100", effectiveQuote: "85954100" }] };
        if (text.trimStart().startsWith("insert")) writes.push(text);
        return { rows: [] };
      },
    };
    const db = {
      transaction: async (fn: (transaction: typeof tx) => Promise<unknown>) =>
        fn(tx),
    } as unknown as DrizzleDb;
    expect(
      await new PostgresSelartiBudgetRepository(db).recordOutcome({
        requestId: "synthetic",
        factId: "contradiction",
        outcome: "not_applied",
      }),
    ).toBe("conflict");
    expect(writes).toEqual([]);
  });
});
