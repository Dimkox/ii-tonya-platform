import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdVerifiedPaymentReader } from "./early-bird-verified-payment-reader.js";
it("fails closed on an unsafe reader principal before querying any binding", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ safe: false }] });
  const db = {
    transaction: async (cb: (tx: { execute: typeof execute }) => unknown) =>
      cb({ execute }),
  } as unknown as DrizzleDb;
  const reader = new PostgresEarlyBirdVerifiedPaymentReader(db, "wave_reader");
  await expect(reader.findInvoiceByProviderObject("p1")).rejects.toThrow(
    "early_bird_verified_reader_principal_unsafe",
  );
  expect(execute).toHaveBeenCalledOnce();
});
it("rejects invalid IDs before database access", async () => {
  const transaction = vi.fn();
  const reader = new PostgresEarlyBirdVerifiedPaymentReader(
    { transaction } as unknown as DrizzleDb,
    "wave_reader",
  );
  expect(await reader.findInvoiceByProviderObject("https://bad")).toBeNull();
  expect(await reader.findEarlyBirdBinding("bad")).toBeNull();
  expect(transaction).not.toHaveBeenCalled();
});
