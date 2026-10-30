import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdRefundBindingStore } from "./early-bird-refund-binding-store.js";
it("rejects forged proof and does not touch the database", async () => {
  const transaction = vi.fn();
  const store = new PostgresEarlyBirdRefundBindingStore(
    { transaction } as unknown as DrizzleDb,
    {} as never,
    "wave_bind_login",
  );
  await expect(store.bind({})).rejects.toThrow(
    "early_bird_refund_proof_required",
  );
  expect(transaction).not.toHaveBeenCalled();
});
