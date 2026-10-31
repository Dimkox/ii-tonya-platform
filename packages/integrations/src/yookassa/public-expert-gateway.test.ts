import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
import { PublicExpertGatewayTransport } from "./public-expert-gateway.js";
import { yooKassaPaymentSchema, yooKassaRefundSchema } from "./contracts.js";
import type { PublicExpertPaymentSnapshot } from "./public-expert-gateway-contracts.js";

const id = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const contactId = "33333333-3333-4333-8333-333333333333";
const key = Buffer.alloc(32, 1),
  authKey = Buffer.alloc(32, 2);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});
const body = Buffer.from("{}");
function snapshot(free = false): PublicExpertPaymentSnapshot {
  return {
    version: 1,
    requestId,
    userId: id,
    product: "onboarding",
    kind: free ? "onboarding_cancel" : "onboarding_create",
    legacySourceId: id,
    legacyOperationId: id,
    mode: "test",
    amountMinor: "300000",
    currency: "RUB",
    idempotencyKey: id,
    contactId: free ? null : contactId,
    parentPaymentId: free ? "a1" : null,
    requestDigest: "sha256:" + createHash("sha256").update(body).digest("hex"),
    bodyVersion: 1,
    bodyExpiresAt: free ? null : "2026-11-01T00:00:00Z",
    paymentDeadline: "2026-11-01T00:00:00Z",
    providerDeadline: "2026-11-01T00:00:00Z",
    createdAt: "2026-10-30T00:00:00Z",
    state: "admitted",
    providerObjectId: free ? "a1" : null,
    envelope: free ? null : { ciphertext: "sealed", keyReference: "local:key" },
  };
}
function payment() {
  return {
    id: "a1",
    status: "pending",
    paid: false,
    test: true,
    refundable: false,
    amount: { value: "3000.00", currency: "RUB" },
    created_at: "2026-10-30T00:00:00Z",
    metadata: {},
  };
}
const metadata = {
  purpose: "public_main_refund",
  operation_id: id,
  order_id: id,
  user_id: id,
};
function refund() {
  return {
    id: "b1",
    payment_id: "a1",
    status: "pending",
    amount: { value: "3000.00", currency: "RUB" },
    created_at: "2026-10-30T00:00:00Z",
    metadata,
  };
}
async function fixture(respond: (command: Record<string, unknown>) => unknown) {
  const address = "\0public-gateway-" + randomBytes(12).toString("hex");
  const commands: Record<string, unknown>[] = [];
  const mac = (s: string) =>
    createHmac("sha256", authKey).update(s).digest("hex");
  const server = createServer((socket) => {
    let buffer = "",
      nonce = "",
      challenge = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (!buffer.endsWith("\n")) return;
      const frame = JSON.parse(buffer) as Record<string, string>;
      buffer = "";
      if (frame.hello) {
        nonce = frame.hello;
        challenge = "a".repeat(64);
        socket.write(
          JSON.stringify({
            nonce,
            challenge,
            mac: mac(`hello\n${nonce}\n${challenge}`),
          }) + "\n",
        );
      } else {
        expect(frame.mac).toBe(
          mac(`request\n${nonce}\n${challenge}\n${frame.body}`),
        );
        const command = JSON.parse(frame.body ?? "") as Record<string, unknown>;
        commands.push(command);
        const response = respond(command);
        const outcome =
          typeof response === "string"
            ? response
            : "response:" +
              Buffer.from(JSON.stringify(response)).toString("base64url");
        socket.end(
          JSON.stringify({
            outcome,
            nonce,
            challenge,
            mac: mac(`response\n${nonce}\n${challenge}\n${outcome}`),
          }) + "\n",
        );
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(address, resolve));
  const ipc = new ExperimentalGatewayIpc({
    address,
    key,
    authKey,
    timeoutMs: 1000,
  });
  return { transport: new PublicExpertGatewayTransport(ipc), commands };
}

describe("public gateway transport", () => {
  it("uses authenticated typed body-only opcode and never retries uncertainty", async () => {
    const { transport, commands } = await fixture(() => "unknown");
    expect(await transport.dispatch(snapshot(), body)).toEqual({
      kind: "unknown",
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      op: "public_dispatch",
      request_id: requestId,
      contact_id: contactId,
      request: "e30=",
    });
    expect(commands[0]).not.toHaveProperty("path");
    expect(commands[0]).not.toHaveProperty("parent_payment_id");
  });
  it("uses a separate operation token with null contact and subject for cancel", async () => {
    const { transport, commands } = await fixture(() => "cancelled");
    expect(await transport.dispatch(snapshot(true), body)).toEqual({
      kind: "cancelled",
    });
    expect(commands[0]).toMatchObject({ contact_id: null, subject: null });
    expect(commands[0]?.operation_token).toBe(
      createHmac("sha256", key)
        .update(Buffer.from("ii-tonya-gateway-public-operation-v1\0"))
        .update(Buffer.from(requestId.replaceAll("-", ""), "hex"))
        .digest("hex"),
    );
  });
  it("rejects tampered snapshot or body before IPC", async () => {
    const { transport, commands } = await fixture(() => "unknown");
    expect(
      await transport.dispatch({ ...snapshot(), contactId: null }, body),
    ).toEqual({ kind: "unknown" });
    expect(
      await transport.dispatch(snapshot(), Buffer.from('{"wrong":true}')),
    ).toEqual({ kind: "unknown" });
    expect(commands).toEqual([]);
  });
  it("keeps observed payment method and strict refund identity through fresh GET", async () => {
    const { transport } = await fixture((command) =>
      command.op === "inspect_refund"
        ? refund()
        : { ...payment(), payment_method: { type: "sbp" } },
    );
    expect((await transport.getPayment("a1")).paymentMethodType).toBe("sbp");
    expect((await transport.getRefund("b1")).metadata).toEqual(metadata);
    expect(yooKassaPaymentSchema.parse(payment())).not.toHaveProperty(
      "paymentMethodType",
    );
    expect(
      yooKassaRefundSchema.safeParse({
        ...refund(),
        metadata: { ...metadata, user_id: "forged" },
      }).success,
    ).toBe(false);
  });
  it("requires bounded complete pages and preserves refund identity", async () => {
    const { transport, commands } = await fixture(() => ({
      items: [refund()],
    }));
    const result = await transport.listRefunds({
      createdFrom: "2026-10-30T00:00:00Z",
      createdTo: "2026-10-31T00:00:00Z",
    });
    expect(result.complete).toBe(true);
    expect(result.items[0]?.metadata).toEqual(metadata);
    expect(commands[0]?.op).toBe("public_list_refunds");
  });
  it("leaves truncated, cyclic, duplicate or unavailable discovery incomplete", async () => {
    for (const response of [
      { items: [payment()], next_cursor: "again" },
      { items: [payment(), payment()] },
      { items: [], next_cursor: "truncated" },
      "unavailable",
    ]) {
      const { transport } = await fixture(() => response);
      const result = await transport.listPayments({
        createdFrom: "2026-10-30T00:00:00Z",
        createdTo: "2026-10-31T00:00:00Z",
        maxPages: 2,
      });
      expect(result.complete).toBe(false);
      expect(result.items).toEqual([]);
    }
  });
});
