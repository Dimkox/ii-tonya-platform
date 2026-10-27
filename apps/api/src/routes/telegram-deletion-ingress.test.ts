import { PassThrough } from "node:stream";
import { createLogger } from "@ii-tonya/observability";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { telegramWebhookRoutes } from "./telegram-webhook.js";
import type { TelegramDeletionCapability } from "../telegram-deletion.js";
async function build(deletion?: TelegramDeletionCapability, consume = true) {
  const app = Fastify();
  const downstream = vi.fn(async () => ({ status: "handled" }));
  await app.register(telegramWebhookRoutes, {
    secret: "secret",
    callbacks: {
      isAuthorizedIdentity: async () => true,
      verifyCallback: async () => true,
      process: async () => {
        await downstream();
      },
    },
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "claim" }),
      complete: async () => {},
      fail: async () => {},
    },
    rateLimiter: { consume: () => consume },
    clientIngressEnabled: true,
    clientHybridRoutingEnabled: true,
    clientBotKey: "bot",
    clientGateway: { handle: downstream },
    ...(deletion ? { deletion } : {}),
  });
  return { app, downstream };
}
it.each(["/v1/webhooks/telegram", "/v1/webhooks/telegram/client/bot"])(
  "intercepts deletion on %s before downstream routing",
  async (url) => {
    const service = {
      readOwned: vi.fn(async () => ({ kind: "denied" as const })),
      request: vi.fn(async () => ({
        kind: "accepted" as const,
        request: {
          requestId: "request",
          requestedAt: "2026-10-23T00:00:00Z",
          stage: "awaiting_execution" as const,
          retainedFacts: null,
        },
      })),
    };
    const { app, downstream } = await build({
      request: async () => service.request(),
    });
    const payload = {
      update_id: 1,
      message: {
        text: "/delete_data",
        from: { id: 42, is_bot: false },
        chat: { id: 42, type: "private" },
      },
    };
    const response = await app.inject({
      method: "POST",
      url,
      headers: { "x-telegram-bot-api-secret-token": "secret" },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      method: "sendMessage",
      chat_id: "42",
    });
    expect(service.request).toHaveBeenCalledTimes(1);
    expect(downstream).not.toHaveBeenCalled();
    await app.close();
    const disabled = await build();
    const unavailable = await disabled.app.inject({
      method: "POST",
      url,
      headers: { "x-telegram-bot-api-secret-token": "secret" },
      payload,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(disabled.downstream).not.toHaveBeenCalled();
    await disabled.app.close();
  },
);

it.each(["/v1/webhooks/telegram", "/v1/webhooks/telegram/client/bot"])(
  "logs safe fingerprints for rejected auth and rate limits on %s",
  async (url) => {
    const stream = new PassThrough();
    let output = "";
    stream.on("data", (chunk) => {
      output += String(chunk);
    });
    let allowed = true;
    const app = Fastify({ loggerInstance: createLogger(stream) });
    await app.register(telegramWebhookRoutes, {
      secret: "secret",
      callbacks: {
        isAuthorizedIdentity: async () => true,
        verifyCallback: async () => true,
        process: async () => {},
      },
      inbox: {
        claim: async () => ({ kind: "claimed", claimId: "claim" }),
        complete: async () => {},
        fail: async () => {},
      },
      rateLimiter: { consume: () => allowed },
      clientIngressEnabled: false,
      clientHybridRoutingEnabled: false,
      clientBotKey: "bot",
      clientGateway: undefined,
    });
    const marker = "PERSONAL_UA_SECRET";
    await app.inject({
      method: "POST",
      url,
      headers: {
        "user-agent": marker,
        "x-forwarded-for": "198.51.100.77",
        "x-telegram-bot-api-secret-token": "TOKEN_SECRET",
      },
      payload: "invalid json",
    });
    allowed = false;
    await app.inject({
      method: "POST",
      url,
      headers: {
        "user-agent": marker,
        "x-telegram-bot-api-secret-token": "secret",
      },
      payload: { update_id: 1 },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const events = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((row) => row.event === "telegram_ingress_security");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      reason: "authentication_rejected",
      ipFingerprint: expect.stringMatching(/^h1:[0-9a-f]{64}$/),
      uaFingerprint: expect.stringMatching(/^h1:[0-9a-f]{64}$/),
    });
    expect(events[1]).toMatchObject({ reason: "rate_limited" });
    expect(output).not.toContain(marker);
    expect(output).not.toContain("TOKEN_SECRET");
    expect(output).not.toContain("198.51.100.77");
    expect(output).not.toContain("127.0.0.1");
    await app.close();
  },
);
