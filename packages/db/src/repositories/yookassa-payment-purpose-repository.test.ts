import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresYooKassaPaymentPurposeRepository } from "./yookassa-payment-purpose-repository.js";
it("refuses ambiguous cross-product provider IDs rather than choosing the first match", async () => {
  const execute = vi.fn().mockResolvedValue({
    rows: [{ purpose: "ONBOARDING_FEE" }, { purpose: "MAIN_SUBSCRIPTION" }],
  });
  const repo = new PostgresYooKassaPaymentPurposeRepository({
    execute,
  } as unknown as DrizzleDb);
  await expect(
    repo.resolvePurpose("payment", "payment.succeeded"),
  ).rejects.toThrow("payment_purpose_ambiguous");
});
it("retains a missing durable binding as unknown and rejects malformed IDs before DB I/O", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const repo = new PostgresYooKassaPaymentPurposeRepository({
    execute,
  } as unknown as DrizzleDb);
  expect(await repo.resolvePurpose("payment", "payment.succeeded")).toBeNull();
  await expect(
    repo.resolvePurpose("https://attacker.invalid", "payment.succeeded"),
  ).rejects.toThrow("payment_purpose_invalid");
  expect(execute).toHaveBeenCalledOnce();
});
