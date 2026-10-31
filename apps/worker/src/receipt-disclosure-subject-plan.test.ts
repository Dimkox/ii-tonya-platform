import { expect, it, vi } from "vitest";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import { composeReceiptRetention } from "./receipt-disclosure-retention.js";
it("revokes only listed contacts and leaves empty plans idle", async () => {
  const gateway = new ExperimentalGatewayIpc({
      address: "\0not-used",
      key: Buffer.alloc(32, 1),
      authKey: Buffer.alloc(32, 2),
      timeoutMs: 20,
    }),
    revoke = vi.spyOn(gateway, "revokeContact").mockResolvedValue(),
    user = vi.spyOn(gateway, "revokeUser"),
    stop = vi.spyOn(gateway, "stopAll");
  const plan = [
      { id: "c1", userId: "u1" },
      { id: "c2", userId: "u1" },
    ],
    listExpiredBatch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(plan),
    redactExpiredSelection = vi.fn().mockResolvedValue(2);
  const run = composeReceiptRetention(
    { listExpiredBatch, redactExpiredSelection },
    { checkoutEnabled: true, gateway },
  );
  expect(await run()).toBe(0);
  expect(await run()).toBe(2);
  expect(revoke.mock.calls).toEqual([["c1"], ["c2"]]);
  expect(user).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
  expect(redactExpiredSelection).toHaveBeenCalledWith(plan);
});
it("does not delete when contact cancellation is uncertain", async () => {
  const gateway = new ExperimentalGatewayIpc({
    address: "\0not-used",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 20,
  });
  vi.spyOn(gateway, "revokeContact").mockRejectedValue(new Error("offline"));
  const redactExpiredSelection = vi.fn();
  const run = composeReceiptRetention(
    {
      listExpiredBatch: async () => [{ id: "c", userId: "u" }],
      redactExpiredSelection,
    },
    { checkoutEnabled: true, gateway },
  );
  await expect(run()).rejects.toThrow("offline");
  expect(redactExpiredSelection).not.toHaveBeenCalled();
});
it("adapts early bird retention without touching contacts outside the selected plan", async () => {
  const { adaptEarlyBirdReceiptRetention } =
    await import("./receipt-disclosure-retention.js");
  const plan = [
      { id: "a", userId: "u" },
      { id: "b", userId: "u" },
    ],
    expireSelected = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
  const run = composeReceiptRetention(
    adaptEarlyBirdReceiptRetention({
      listExpired: async () => plan,
      expireSelected,
    }),
    { checkoutEnabled: false },
  );
  expect(await run()).toBe(1);
  expect(expireSelected.mock.calls).toEqual([[plan[0]], [plan[1]]]);
});
