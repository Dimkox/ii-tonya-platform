import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import { composeReceiptRetention } from "./receipt-disclosure-retention.js";
import { createProductionWorkerRuntimeFactory } from "./main.js";
let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
it("revokes only the selected contact over IPC before retention", async () => {
  const auth = Buffer.alloc(32, 2),
    key = Buffer.alloc(32, 1),
    address = `\0retention-${randomUUID()}`,
    order: string[] = [];
  server = createServer((socket) =>
    socket.once("data", (helloChunk) => {
      const hello = JSON.parse(helloChunk.toString()) as { hello: string };
      const challenge = "b".repeat(64);
      const greeting = createHmac("sha256", auth)
        .update(`hello\n${hello.hello}\n${challenge}`)
        .digest("hex");
      socket.write(
        JSON.stringify({ nonce: hello.hello, challenge, mac: greeting }) + "\n",
      );
      socket.once("data", (chunk) => {
        const envelope = JSON.parse(chunk.toString()) as {
          nonce: string;
          challenge: string;
          body: string;
          mac: string;
        };
        expect(envelope.mac).toBe(
          createHmac("sha256", auth)
            .update(
              `request\n${envelope.nonce}\n${envelope.challenge}\n${envelope.body}`,
            )
            .digest("hex"),
        );
        order.push((JSON.parse(envelope.body) as { op: string }).op);
        const outcome = "erased",
          mac = createHmac("sha256", auth)
            .update(
              `response\n${envelope.nonce}\n${envelope.challenge}\n${outcome}`,
            )
            .digest("hex");
        socket.end(
          JSON.stringify({
            outcome,
            nonce: envelope.nonce,
            challenge: envelope.challenge,
            mac,
          }) + "\n",
        );
      });
    }),
  );
  await new Promise<void>((resolve, reject) =>
    server!.once("error", reject).listen(address, resolve),
  );
  const gateway = new ExperimentalGatewayIpc({
    address,
    key,
    authKey: auth,
    timeoutMs: 200,
  });
  const cleanup = vi.fn(async () => {
    order.push("cleanup");
    return 1;
  });
  const userId = randomUUID();
  const repository = {
    listExpiredBatch: async () => [{ id: randomUUID(), userId }],
    redactExpiredSelection: cleanup,
  };
  expect(
    await composeReceiptRetention(repository, {
      checkoutEnabled: true,
      gateway,
    })(),
  ).toBe(1);
  expect(order).toEqual(["revoke_contact", "cleanup"]);
});
it("rejects active checkout without gateway before creating the worker", async () => {
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
  config.expertVerification = { checkoutEnabled: true } as never;
  await expect(
    createProductionWorkerRuntimeFactory().create(config),
  ).rejects.toThrow("receipt disclosure cancellation gateway required");
});
