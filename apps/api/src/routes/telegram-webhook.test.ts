import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { telegramWebhookRoutes } from "./telegram-webhook.js";

const secret = "telegram-webhook-secret";

const build = async () => {
  const claim = vi.fn(async () => ({ kind: "claimed" as const, claimId: "claim-1" }));
  const complete = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  const isAuthorizedIdentity = vi.fn(async () => true);
  const verifyCallback = vi.fn(async () => true);
  const process = vi.fn(async () => undefined);
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret,
    callbacks: { isAuthorizedIdentity, verifyCallback, process },
    inbox: { claim, complete, fail },
    rateLimiter: { consume: () => true },
  });
  return {
    app,
    claim,
    complete,
    fail,
    isAuthorizedIdentity,
    verifyCallback,
    process,
  };
};

const headers = { "x-telegram-bot-api-secret-token": secret };

describe("Telegram webhook callback boundary", () => {
  it("rejects missing callback data before authorization or inbox intake", async () => {
    const state = await build();
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 1,
          callback_query: { from: { id: 123456789 } },
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "invalid_callback" });
      expect(state.isAuthorizedIdentity).not.toHaveBeenCalled();
      expect(state.verifyCallback).not.toHaveBeenCalled();
      expect(state.claim).not.toHaveBeenCalled();
      expect(state.process).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("rejects callback data above Telegram's 64-byte limit", async () => {
    const state = await build();
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 2,
          callback_query: {
            from: { id: 123456789 },
            data: "я".repeat(33),
          },
        },
      });
      expect(Buffer.byteLength("я".repeat(33), "utf8")).toBeGreaterThan(64);
      expect(response.statusCode).toBe(403);
      expect(state.verifyCallback).not.toHaveBeenCalled();
      expect(state.claim).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("reauthorizes and verifies a valid callback before processing", async () => {
    const state = await build();
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 3,
          callback_query: {
            id: "callback-1",
            from: { id: 123456789 },
            data: "ct2.safe_callback_token",
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(state.isAuthorizedIdentity).toHaveBeenCalledWith("123456789");
      expect(state.verifyCallback).toHaveBeenCalledTimes(1);
      expect(state.claim).toHaveBeenCalledWith("telegram", "3");
      expect(state.process).toHaveBeenCalledTimes(1);
      expect(state.complete).toHaveBeenCalledWith("claim-1");
    } finally {
      await state.app.close();
    }
  });
});
