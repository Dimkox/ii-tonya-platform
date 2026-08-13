import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { telegramWebhookRoutes } from "./telegram-webhook.js";

const secret = "telegram-webhook-secret";

const build = async (options: { queriesEnabled?: boolean } = {}) => {
  const claim = vi.fn(async () => ({
    kind: "claimed" as const,
    claimId: "claim-1",
  }));
  const complete = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  const isAuthorizedIdentity = vi.fn(async () => true);
  const verifyCallback = vi.fn(async () => true);
  const process = vi.fn(async () => undefined);
  const resolvePrincipal = vi.fn(async (telegramUserId: string) => ({
    expertId: "00000000-0000-4000-8000-000000000101",
    telegramUserId,
    timezone: "Europe/Moscow",
  }));
  const authenticateClientView = vi.fn(async () => ({
    tokenHash: "a".repeat(64),
    claims: {
      reservationId: "00000000-0000-4000-8000-000000000201",
      expertId: "00000000-0000-4000-8000-000000000101",
      version: 1,
      expiresAtEpochSeconds: 1_786_000_000,
    },
  }));
  const processCommand = vi.fn(async () => undefined);
  const processClientView = vi.fn(async () => undefined);
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret,
    callbacks: { isAuthorizedIdentity, verifyCallback, process },
    inbox: { claim, complete, fail },
    rateLimiter: { consume: () => true },
    expertQueriesEnabled: options.queriesEnabled ?? false,
    expertQueries: {
      resolvePrincipal,
      authenticateClientView,
      processCommand,
      processClientView,
    },
  });
  return {
    app,
    claim,
    complete,
    fail,
    isAuthorizedIdentity,
    verifyCallback,
    process,
    resolvePrincipal,
    authenticateClientView,
    processCommand,
    processClientView,
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

  it("keeps query commands isolated while the flag is false", async () => {
    const state = await build();
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 4,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "/schedule",
          },
        },
      });
      expect(response.json()).toEqual({ accepted: true, unsupported: true });
      expect(state.resolvePrincipal).not.toHaveBeenCalled();
      expect(state.processCommand).not.toHaveBeenCalled();
      expect(state.process).not.toHaveBeenCalled();
      expect(state.claim).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("requires a private chat with matching immutable numeric identity", async () => {
    const state = await build({ queriesEnabled: true });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 5,
          message: {
            from: { id: 123456789 },
            chat: { id: -100123, type: "group" },
            text: "/stats",
          },
        },
      });
      expect(response.statusCode).toBe(403);
      expect(state.resolvePrincipal).not.toHaveBeenCalled();
      expect(state.claim).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("claims the inbox before processing an authenticated cv1 read", async () => {
    const state = await build({ queriesEnabled: true });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 6,
          callback_query: {
            id: "client-view-1",
            from: { id: 123456789 },
            data: "cv1.safe-token",
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(state.authenticateClientView).toHaveBeenCalledTimes(1);
      expect(state.claim).toHaveBeenCalledWith("telegram", "6");
      expect(state.processClientView).toHaveBeenCalledTimes(1);
      expect(state.complete).toHaveBeenCalledWith("claim-1");
      expect(state.verifyCallback).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });
});
