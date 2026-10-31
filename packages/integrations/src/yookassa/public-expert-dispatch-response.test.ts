/** New response-acceptance/rejection coverage; does not execute the exhausted suite. */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
import { PublicExpertGatewayTransport } from "./public-expert-gateway.js";
import type {
  PublicExpertPaymentKind,
  PublicExpertPaymentSnapshot,
} from "./public-expert-gateway-contracts.js";

const userId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const contactId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const key = Buffer.alloc(32, 3),
  authKey = Buffer.alloc(32, 4);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

function command(kind: PublicExpertPaymentKind) {
  const free = kind === "onboarding_capture" || kind === "onboarding_cancel";
  const amount = { value: "3000.00", currency: "RUB" };
  const metadata = {
    purpose:
      kind === "main_refund"
        ? "public_main_refund"
        : kind === "main_create"
          ? "main_residency"
          : "onboarding",
    operation_id: operationId,
    order_id: operationId,
    user_id: userId,
  };
  const raw =
    kind === "onboarding_cancel"
      ? {}
      : kind === "onboarding_capture"
        ? { amount }
        : {
            amount,
            metadata,
            receipt: {
              customer: { email: "synthetic@example.com" },
              items: [
                {
                  description: "Service",
                  quantity: "1.00",
                  amount,
                  vat_code: 1,
                  payment_subject: "service",
                  payment_mode: "full_payment",
                },
              ],
            },
            ...(kind === "main_refund"
              ? { payment_id: "a1" }
              : {
                  capture: kind === "main_create",
                  confirmation: {
                    type: "redirect",
                    return_url: "https://example.com/return",
                  },
                  ...(kind === "onboarding_create"
                    ? { payment_method_data: { type: "bank_card" } }
                    : {}),
                }),
          };
  const body = Buffer.from(JSON.stringify(raw));
  const snapshot: PublicExpertPaymentSnapshot = {
    version: 1,
    requestId,
    userId,
    product:
      kind === "main_refund"
        ? "refund"
        : kind === "main_create"
          ? "main"
          : "onboarding",
    kind,
    legacySourceId: operationId,
    legacyOperationId: operationId,
    mode: "test",
    amountMinor: "300000",
    currency: "RUB",
    idempotencyKey: userId,
    contactId: free ? null : contactId,
    parentPaymentId: free || kind === "main_refund" ? "a1" : null,
    requestDigest: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    bodyVersion: 1,
    bodyExpiresAt: free ? null : "2026-11-01T00:00:00Z",
    paymentDeadline: "2026-11-01T00:00:00Z",
    providerDeadline: "2026-11-01T00:00:00Z",
    createdAt: "2026-10-30T00:00:00Z",
    state: "admitted",
    providerObjectId: free ? "a1" : null,
    envelope: free ? null : { ciphertext: "sealed", keyReference: "local:key" },
  };
  return { snapshot, body };
}

async function respondWith(response: unknown) {
  const address = "\0public-response-" + randomBytes(12).toString("hex");
  const received: unknown[] = [];
  const mac = (value: string) =>
    createHmac("sha256", authKey).update(value).digest("hex");
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
        challenge = randomBytes(32).toString("hex");
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
        received.push(JSON.parse(frame.body ?? ""));
        const outcome =
          "response:" +
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
  const transport = new PublicExpertGatewayTransport(
    new ExperimentalGatewayIpc({ address, key, authKey, timeoutMs: 1000 }),
  );
  return { transport, received };
}

describe("public dispatch authenticated responses", () => {
  it("returns a verified pending public-create redirect through the real transport parser", async () => {
    const { transport, received } = await respondWith({
      payment_id: "a1",
      payment_status: "pending",
      confirmation_url: "https://pay.yookassa.ru/synthetic",
    });
    const { snapshot, body } = command("onboarding_create");
    expect(await transport.dispatch(snapshot, body)).toEqual({
      kind: "response",
      providerObjectId: "a1",
      status: "pending",
      confirmationUrl: "https://pay.yookassa.ru/synthetic",
    });
    expect(received).toHaveLength(1);
  });
  it("returns held, capture and cancellation responses only for the bound parent", async () => {
    for (const [kind, status] of [
      ["onboarding_create", "waiting_for_capture"],
      ["onboarding_capture", "succeeded"],
      ["onboarding_cancel", "canceled"],
    ] as const) {
      const { transport } = await respondWith({
        payment_id: "a1",
        payment_status: status,
      });
      const { snapshot, body } = command(kind);
      expect(await transport.dispatch(snapshot, body)).toEqual({
        kind: "response",
        providerObjectId: "a1",
        status,
      });
    }
  });
  it("returns a distinct refund identity with no invented payment fields", async () => {
    const { transport } = await respondWith({
      payment_id: "b1",
      payment_status: "succeeded",
    });
    const { snapshot, body } = command("main_refund");
    expect(await transport.dispatch(snapshot, body)).toEqual({
      kind: "response",
      providerObjectId: "b1",
      status: "succeeded",
    });
  });
  it("rejects an acknowledged capture for another parent", async () => {
    const { transport } = await respondWith({
      payment_id: "a2",
      payment_status: "succeeded",
    });
    const { snapshot, body } = command("onboarding_capture");
    expect(await transport.dispatch(snapshot, body)).toEqual({
      kind: "unknown",
    });
  });
  it("rejects untrusted or credential-bearing redirect URLs in authenticated responses", async () => {
    for (const url of [
      "https://evil.example/synthetic",
      "https://user:pass@pay.yookassa.ru/synthetic",
      "http://pay.yookassa.ru/synthetic",
      "https://pay.yookassa.ru/synthetic#fragment",
      "https://pay.yookassa.ru:444/synthetic",
    ]) {
      const { transport } = await respondWith({
        payment_id: "a1",
        payment_status: "pending",
        confirmation_url: url,
      });
      const { snapshot, body } = command("onboarding_create");
      expect(await transport.dispatch(snapshot, body)).toEqual({
        kind: "unknown",
      });
    }
  });
  it("rejects malformed, expanded or payment-shaped refund response claims", async () => {
    for (const response of [
      { payment_id: "b1" },
      { payment_id: "b1", payment_status: "succeeded", amount: "1.00" },
      { payment_id: "b1", payment_status: "waiting_for_capture" },
      {
        payment_id: "b1",
        payment_status: "pending",
        confirmation_url: "https://pay.yookassa.ru/synthetic",
      },
    ]) {
      const { transport } = await respondWith(response);
      const { snapshot, body } = command("main_refund");
      expect(await transport.dispatch(snapshot, body)).toEqual({
        kind: "unknown",
      });
    }
  });
});
