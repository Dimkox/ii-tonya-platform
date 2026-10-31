import { expect, it, vi } from "vitest";
import { retryEarlyBirdSerialization } from "./early-bird-serialization-retry.js";
it("retries a whole transaction on wrapped 40001 and returns its result", async () => {
  const transaction = vi
    .fn()
    .mockRejectedValueOnce(new Error("query", { cause: { code: "40001" } }))
    .mockResolvedValueOnce("committed");
  await expect(retryEarlyBirdSerialization(transaction)).resolves.toBe(
    "committed",
  );
  expect(transaction).toHaveBeenCalledTimes(2);
});
it("bounds retries and propagates non-serialization errors immediately", async () => {
  const serial = new Error("serial", { cause: { code: "40001" } });
  const transaction = vi.fn().mockRejectedValue(serial);
  await expect(retryEarlyBirdSerialization(transaction)).rejects.toBe(serial);
  expect(transaction).toHaveBeenCalledTimes(3);
  const other = new Error("provider failure");
  const unsafe = vi.fn().mockRejectedValue(other);
  await expect(retryEarlyBirdSerialization(unsafe)).rejects.toBe(other);
  expect(unsafe).toHaveBeenCalledOnce();
});
