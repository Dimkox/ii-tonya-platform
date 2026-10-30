import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { afterEach, expect, it } from "vitest";
import {
  ExperimentalGatewayIpc,
  gatewayContactToken,
} from "./experimental-gateway-ipc.js";
let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
it("transmits exact prepared bytes, uses the shared opaque subject, and accepts only signed structured results", async () => {
  const key = Buffer.alloc(32, 1),
    auth = Buffer.alloc(32, 2),
    address = `\0dispatch-${randomUUID()}`,
    user = randomUUID(),
    attempt = "a".repeat(64),
    request = Buffer.from("POST /v3/payments HTTP/1.1\r\nX: z\r\n\r\nraw");
  let command: Record<string, string> | undefined;
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
        const env = JSON.parse(chunk.toString()) as {
          nonce: string;
          challenge: string;
          body: string;
          mac: string;
        };
        expect(env.mac).toBe(
          createHmac("sha256", auth)
            .update(`request\n${env.nonce}\n${env.challenge}\n${env.body}`)
            .digest("hex"),
        );
        command = JSON.parse(env.body);
        const result = {
            confirmation_url: "https://yoomoney.ru/checkout/test",
            payment_id: "pay1",
            payment_status: "pending",
          },
          outcome = `response:${Buffer.from(JSON.stringify(result)).toString("base64url")}`,
          mac = createHmac("sha256", auth)
            .update(`response\n${env.nonce}\n${env.challenge}\n${outcome}`)
            .digest("hex");
        socket.end(
          JSON.stringify({
            outcome,
            nonce: env.nonce,
            challenge: env.challenge,
            mac,
          }) + "\n",
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
  expect(await client.dispatch(user, attempt, request)).toEqual({
    kind: "response",
    paymentId: "pay1",
    paymentStatus: "pending",
    confirmationUrl: "https://yoomoney.ru/checkout/test",
  });
  expect(command).toEqual({
    op: "dispatch",
    subject: gatewayContactToken(key, user),
    attempt,
    request: request.toString("base64"),
  });
});
it("reports unknown for an unreachable gateway and never resends", async () => {
  const client = new ExperimentalGatewayIpc({
    address: `\0missing-${randomUUID()}`,
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 30,
  });
  expect(
    await client.dispatch(randomUUID(), "a".repeat(64), Buffer.from("exact")),
  ).toEqual({ kind: "unknown" });
});
it("never sends receipt bytes to an unauthenticated socket impersonator", async () => {
  const auth = Buffer.alloc(32, 2),
    key = Buffer.alloc(32, 1),
    address = `\0hostile-${randomUUID()}`;
  let captured = "";
  server = createServer((socket) =>
    socket.on("data", (chunk) => {
      captured += chunk.toString();
      socket.end("{}\n");
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
  const request = Buffer.from("SENSITIVE_RECEIPT");
  expect(await client.dispatch(randomUUID(), "a".repeat(64), request)).toEqual({
    kind: "unknown",
  });
  expect(captured).not.toContain("SENSITIVE_RECEIPT");
  expect(captured).not.toContain(request.toString("base64"));
  expect(JSON.parse(captured)).toEqual({
    hello: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
});
it("preserves a confirmed terminal provider result without requiring a checkout URL", async () => {
  const auth = Buffer.alloc(32, 2),
    key = Buffer.alloc(32, 1),
    address = `\0terminal-${randomUUID()}`;
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
        const request = JSON.parse(chunk.toString()) as { nonce: string };
        const outcome = `response:${Buffer.from(JSON.stringify({ payment_id: "paid-1", payment_status: "succeeded" })).toString("base64url")}`;
        const mac = createHmac("sha256", auth)
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
  expect(
    await client.dispatch(randomUUID(), "a".repeat(64), Buffer.from("exact")),
  ).toEqual({
    kind: "response",
    paymentId: "paid-1",
    paymentStatus: "succeeded",
  });
});
