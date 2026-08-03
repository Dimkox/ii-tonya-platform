import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DrizzleDb } from "../client.js";
import * as publicDb from "../index.js";
import * as transactionApi from "./expert-referral-transaction-capability.js";
import { assertTrustedExpertReferralTransaction, withTrustedExpertReferralTransaction } from "./expert-referral-transaction-capability.js";

describe("expert referral transaction capability", () => {
  it("does not expose transaction-owned factories from the package root", () => {
    expect(publicDb).not.toHaveProperty("withTrustedExpertReferralTransaction");
    expect(publicDb).not.toHaveProperty("createTransactionOwnedExpertReferralRepository");
    expect(publicDb).not.toHaveProperty("createTransactionOwnedExpertReferralControlRepository");
    expect(transactionApi).not.toHaveProperty("registerTrustedExpertReferralTransaction");
    expect(transactionApi).not.toHaveProperty("createTrustedExpertReferralTransaction");
  });

  it("rejects a forged structural database wrapper", () => {
    const database = { $client: {}, execute: async () => ({}), transaction: async () => ({}) };
    expect(() => withTrustedExpertReferralTransaction(database as unknown as DrizzleDb, async () => undefined)).toThrow("database_handle_required");
  });

  it("registers only the transaction yielded inside the owning wrapper", async () => {
    const tx = { execute: async () => ({}), transaction: async () => ({}) };
    const other = { execute: async () => ({}), transaction: async () => ({}) };
    const database = drizzle(new Pool()) as DrizzleDb;
    Object.defineProperty(database, "transaction", { value: async (callback: (actual: typeof tx) => Promise<void>) => callback(tx) });
    await withTrustedExpertReferralTransaction(database, async (actual, capability) => {
      expect(actual).toBe(tx);
      expect(() => assertTrustedExpertReferralTransaction(capability, actual)).not.toThrow();
      expect(() => assertTrustedExpertReferralTransaction(capability, other)).toThrow("transaction_capability_mismatch");
      expect(() => assertTrustedExpertReferralTransaction({}, actual)).toThrow("transaction_capability_mismatch");
    });
    await database.$client.end();
  });
});
