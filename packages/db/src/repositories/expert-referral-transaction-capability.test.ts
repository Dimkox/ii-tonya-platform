import { describe, expect, it } from "vitest";
import * as publicDb from "../index.js";
import { assertTrustedExpertReferralTransaction, createTrustedExpertReferralTransaction } from "./expert-referral-transaction-capability.js";

describe("expert referral transaction capability", () => {
  it("does not expose transaction-owned factories from the package root", () => {
    expect(publicDb).not.toHaveProperty("createTrustedExpertReferralTransaction");
    expect(publicDb).not.toHaveProperty("createTransactionOwnedExpertReferralRepository");
    expect(publicDb).not.toHaveProperty("createTransactionOwnedExpertReferralControlRepository");
  });

  it("rejects a top-level Drizzle database handle", () => {
    const database = { execute: async () => ({}), transaction: async () => ({}), $client: {} };
    expect(() => createTrustedExpertReferralTransaction(database)).toThrow("transaction_handle_required");
  });

  it("is bound to exactly one transaction handle", () => {
    const tx = { execute: async () => ({}), transaction: async () => ({}) };
    const other = { execute: async () => ({}), transaction: async () => ({}) };
    const capability = createTrustedExpertReferralTransaction(tx);
    expect(() => assertTrustedExpertReferralTransaction(capability, tx)).not.toThrow();
    expect(() => assertTrustedExpertReferralTransaction(capability, other)).toThrow("transaction_capability_mismatch");
    expect(() => assertTrustedExpertReferralTransaction({}, tx)).toThrow("transaction_capability_mismatch");
  });
});
