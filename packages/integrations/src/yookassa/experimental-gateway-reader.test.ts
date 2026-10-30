import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { afterEach, expect, it } from "vitest";
import { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
it("uses authenticated IPC for a sanitized provider payment and validates it", async () => {
  const key = Buffer.alloc(32, 1),
    auth = Buffer.alloc(32, 2),
    address = `\0read-${randomUUID()}`;
  let command: unknown;
  server = createServer((socket) =>
    socket.once("data", (helloChunk) => {
      const hello = JSON.parse(helloChunk.toString()) as { hello: string },
        challenge = "b".repeat(64);
      socket.write(
        JSON.stringify({
          nonce: hello.hello,
          challenge,
          mac: createHmac("sha256", auth)
            .update(`hello\n${hello.hello}\n${challenge}`)
            .digest("hex"),
        }) + "\n",
      );
      socket.once("data", (chunk) => {
        const request = JSON.parse(chunk.toString()) as {
          nonce: string;
          body: string;
        };
        command = JSON.parse(request.body);
        const result = {
          id: "pay1",
          status: "succeeded",
          paid: true,
          test: false,
          refundable: true,
          amount: { value: "30.00", currency: "RUB" },
          created_at: "2026-01-01T00:00:00.000Z",
          captured_at: "2026-01-02T00:00:00.000Z",
          metadata: { order_id: "invoice" },
        };
        const outcome = `response:${Buffer.from(JSON.stringify(result)).toString("base64url")}`,
          mac = createHmac("sha256", auth)
            .update(`response\n${request.nonce}\n${challenge}\n${outcome}`)
            .digest("hex");
        socket.end(
          JSON.stringify({ outcome, nonce: request.nonce, challenge, mac }) +
            "\n",
        );
      });
    }),
  );
  await new Promise<void>((resolve, reject) =>
    server!.once("error", reject).listen(address, resolve),
  );
  const client = new ExperimentalGatewayIpc({
    address,
    key,
    authKey: auth,
    timeoutMs: 200,
  });
  expect(await client.getPayment("pay1")).toMatchObject({
    id: "pay1",
    status: "succeeded",
    capturedAt: "2026-01-02T00:00:00.000Z",
  });
  expect(command).toEqual({ op: "inspect_payment", payment_id: "pay1" });
});
it("rejects malformed IDs and never attempts a payment request when reads are unavailable", async () => {
  const client = new ExperimentalGatewayIpc({
    address: `\0missing-${randomUUID()}`,
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  await expect(client.getRefund("https://invalid")).rejects.toThrow();
  await expect(client.getPayment("pay1")).rejects.toThrow();
});
it("fails closed for mismatched PG dispatch context before connecting", async () => {
  const client = new ExperimentalGatewayIpc({
    address: `\0missing-${randomUUID()}`,
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  const contact = randomUUID(),
    context = {
      userId: randomUUID(),
      intentId: randomUUID(),
      contactId: randomUUID(),
      idempotencyKey: randomUUID(),
    };
  expect(
    await client.dispatch(
      contact,
      "a".repeat(64),
      Buffer.from("request"),
      context,
    ),
  ).toEqual({ kind: "unknown" });
});
