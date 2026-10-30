import { expect, it, vi } from "vitest";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import { composeReceiptRevocationRecovery } from "./receipt-revocation-recovery.js";
it("retains unresolved tokens when gateway is offline and acknowledges only after successful revoke", async () => {
  const gateway = new ExperimentalGatewayIpc({
      address: "\0unused",
      key: Buffer.alloc(32, 1),
      authKey: Buffer.alloc(32, 2),
      timeoutMs: 10,
    }),
    revoke = vi
      .spyOn(gateway, "revokeContactToken")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(),
    token = "a".repeat(64),
    listPending = vi
      .fn()
      .mockResolvedValue([
        { token, contactId: "2526c71d-803f-4c3d-9b57-74e902170001" },
      ]),
    acknowledge = vi.fn().mockResolvedValue(undefined);
  const run = composeReceiptRevocationRecovery(
    { listPending, acknowledge },
    gateway,
    "v1",
  );
  await expect(run()).rejects.toThrow("offline");
  expect(acknowledge).not.toHaveBeenCalled();
  expect(await run()).toBe(1);
  expect(acknowledge).toHaveBeenCalledWith(token, "v1");
  expect(revoke).toHaveBeenCalledTimes(2);
});
