import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
it("cancels an in-flight provider read without waiting for the gateway timeout", async () => {
  const address = `\0test-worker-abort-${randomBytes(12).toString("hex")}`;
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(address, resolve));
  try {
    const gateway = new ExperimentalGatewayIpc({
      address,
      key: Buffer.alloc(32, 1),
      authKey: Buffer.alloc(32, 2),
      timeoutMs: 10000,
    });
    const controller = new AbortController();
    const pending = gateway.getPayment("payment1", controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
