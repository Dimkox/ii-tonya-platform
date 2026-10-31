import { afterEach, expect, it, vi } from "vitest";
import { EarlyBirdBoundReconciliation } from "./early-bird-bound-reconciliation.js";
afterEach(() => vi.useRealTimers());
const row = {
  key: "composite/1",
  product: "composite" as const,
  invoiceId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  providerId: "pay1",
  ambiguous: false,
};
it("serializes cycles and rotates past a failed or ambiguous payment without issuing a payment", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const source = {
    list: vi
      .fn()
      .mockResolvedValue([
        row,
        { ...row, key: "deferred/2", product: "deferred", ambiguous: true },
      ]),
  };
  const reconcile = vi.fn(
    async () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const job = new EarlyBirdBoundReconciliation(source, reconcile);
  job.start();
  await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
  expect(await job.runOnce()).toEqual({ kind: "overlap" });
  release();
  await vi.waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
  await job.stop();
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(await job.runOnce()).toEqual({ kind: "stopped" });
});
it("stops new commits and drains an existing GET before shutdown", async () => {
  let release!: () => void;
  const commit = vi.fn();
  const source = { list: vi.fn().mockResolvedValue([row]) };
  const job = new EarlyBirdBoundReconciliation(source, async (_, canCommit) => {
    await new Promise<void>((r) => {
      release = r;
    });
    if (canCommit()) commit();
  });
  job.start();
  await vi.waitFor(() => expect(source.list).toHaveBeenCalledOnce());
  const stopping = job.stop();
  release();
  await stopping;
  expect(commit).not.toHaveBeenCalled();
});
it("commits only fresh exact succeeded facts and never pending, failed, ambiguous or stopped work", async () => {
  const { createEarlyBirdBoundPaymentReconciler } =
    await import("./early-bird-bound-reconciliation.js");
  const commit = vi.fn(),
    deferredCommit = vi.fn(),
    verify = vi.fn().mockResolvedValue(null),
    deferredVerify = vi.fn().mockResolvedValue({
      invoiceId: row.invoiceId,
      userId: row.userId,
      providerId: row.providerId,
      status: "pending",
    });
  const reconcile = createEarlyBirdBoundPaymentReconciler({
    compositeVerifier: { verify },
    compositeStore: { commit },
    deferredVerifier: { verify: deferredVerify } as never,
    deferredStore: { commit: deferredCommit },
  });
  await reconcile(row, () => true);
  await reconcile({ ...row, product: "deferred" }, () => true);
  expect(commit).not.toHaveBeenCalled();
  expect(deferredCommit).not.toHaveBeenCalled();
  verify.mockRejectedValueOnce(new Error("provider unavailable"));
  await expect(reconcile(row, () => true)).rejects.toThrow();
  await expect(
    reconcile({ ...row, ambiguous: true }, () => true),
  ).rejects.toThrow("ambiguous");
  verify.mockResolvedValue({
    invoiceId: row.invoiceId,
    userId: row.userId,
    providerObjectId: row.providerId,
  });
  await reconcile(row, () => false);
  expect(commit).not.toHaveBeenCalled();
  await reconcile(row, () => true);
  expect(commit).toHaveBeenCalledOnce();
  deferredVerify.mockResolvedValue({
    invoiceId: row.invoiceId,
    userId: row.userId,
    providerId: "wrong",
    status: "succeeded",
  });
  await expect(
    reconcile({ ...row, product: "deferred" }, () => true),
  ).rejects.toThrow("mismatch");
  expect(deferredCommit).not.toHaveBeenCalled();
});
it("rotates after a poison entry and clears future polling when stopped", async () => {
  vi.useFakeTimers();
  const second = { ...row, key: "deferred/2", product: "deferred" as const };
  const source = {
    list: vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([second]),
  };
  const reconcile = vi
    .fn()
    .mockRejectedValueOnce(new Error("unverifiable"))
    .mockResolvedValueOnce(undefined);
  const job = new EarlyBirdBoundReconciliation(source, reconcile);
  job.start();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(await job.runOnce()).toMatchObject({
    kind: "completed",
    examined: 1,
    failed: 0,
  });
  expect(source.list).toHaveBeenNthCalledWith(2, row.key, 10);
  await job.stop();
  await vi.advanceTimersByTimeAsync(120000);
  expect(source.list).toHaveBeenCalledTimes(2);
});
