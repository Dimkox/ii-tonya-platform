import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { telegramWebhookRoutes } from "./telegram-webhook.js";

const secret = "telegram-webhook-secret";

const build = async (
  options: {
    queriesEnabled?: boolean;
    consume?: (key: string, limit: number, windowMs: number) => boolean;
  } = {},
) => {
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
      telegramUserId: "123456789",
      version: 1,
      expiresAtEpochSeconds: 1_786_000_000,
    },
  }));
  const processCommand = vi.fn(async () => undefined);
  const processClientView = vi.fn(async () => ({
    kind: "processed" as const,
    deliveryOutcome: "applied" as const,
  }));
  const answerCallbackQuery = vi.fn(async () => ({
    kind: "applied" as const,
    providerOperationId: "answer-1",
  }));
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret,
    callbacks: { isAuthorizedIdentity, verifyCallback, process },
    inbox: { claim, complete, fail },
    rateLimiter: { consume: options.consume ?? (() => true) },
    expertQueriesEnabled: options.queriesEnabled ?? false,
    expertQueries: {
      resolvePrincipal,
      authenticateClientView,
      processCommand,
      processClientView,
      answerCallbackQuery,
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
    answerCallbackQuery,
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
      expect(state.answerCallbackQuery).toHaveBeenCalledWith({
        callbackQueryId: "client-view-1",
        status: "processed",
        idempotencyKey: "telegram:6:client-view:answer",
      });
      expect(state.complete).toHaveBeenCalledWith("claim-1");
      expect(state.verifyCallback).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it.each(["not_applied", "unknown_outcome"] as const)(
    "completes the inbox after a consumed client view with %s delivery",
    async (kind) => {
      const state = await build({ queriesEnabled: true });
      state.processClientView.mockResolvedValueOnce({
        kind: kind === "not_applied" ? "reissue_client" : "unavailable",
        deliveryOutcome: kind,
      });
      try {
        const response = await state.app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          headers,
          payload: {
            update_id: kind === "not_applied" ? 61 : 62,
            callback_query: {
              id: `client-view-${kind}`,
              from: { id: 123456789 },
              data: "cv1.safe-token",
            },
          },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(
          kind === "not_applied"
            ? { accepted: true, unavailable: true, reissueClient: true }
            : { accepted: true, unavailable: true, ambiguous: true },
        );
        expect(state.answerCallbackQuery).toHaveBeenCalledWith({
          callbackQueryId: `client-view-${kind}`,
          status: "unavailable",
          idempotencyKey: `telegram:${kind === "not_applied" ? 61 : 62}:client-view:answer`,
        });
        expect(state.answerCallbackQuery).not.toHaveBeenCalledWith(
          expect.objectContaining({ status: "processed" }),
        );
        expect(state.complete).toHaveBeenCalledWith("claim-1");
        expect(state.fail).not.toHaveBeenCalled();
      } finally {
        await state.app.close();
      }
    },
  );

  it("treats callback acknowledgement failure as best effort after a successful view", async () => {
    const state = await build({ queriesEnabled: true });
    state.answerCallbackQuery.mockRejectedValueOnce(new Error("ack failed"));
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 63,
          callback_query: {
            id: "client-view-ack-failed",
            from: { id: 123456789 },
            data: "cv1.safe-token",
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(state.processClientView).toHaveBeenCalledTimes(1);
      expect(state.complete).toHaveBeenCalledWith("claim-1");
      expect(state.fail).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("routes every enabled private slash command through the expert processor", async () => {
    const state = await build({ queriesEnabled: true });
    try {
      for (const [index, text] of ["/schedule", "/unknown"].entries()) {
        const response = await state.app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          headers,
          payload: {
            update_id: 20 + index,
            message: {
              from: { id: 123456789 },
              chat: { id: 123456789, type: "private" },
              text,
            },
          },
        });
        expect(response.statusCode).toBe(200);
      }
      expect(state.processCommand).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ text: "/unknown" }),
      );
      expect(state.process).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("deduplicates enabled commands before a second processor call", async () => {
    const state = await build({ queriesEnabled: true });
    state.claim
      .mockResolvedValueOnce({ kind: "claimed", claimId: "claim-1" })
      .mockResolvedValueOnce({ kind: "duplicate" });
    try {
      const request = {
        method: "POST" as const,
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 30,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "/stats",
          },
        },
      };
      await state.app.inject(request);
      expect((await state.app.inject(request)).json()).toEqual({
        accepted: true,
        duplicate: true,
      });
      expect(state.processCommand).toHaveBeenCalledTimes(1);
    } finally {
      await state.app.close();
    }
  });

  it("releases the inbox claim and returns sanitized 5xx when command processing fails", async () => {
    const state = await build({ queriesEnabled: true });
    state.processCommand.mockRejectedValueOnce(new Error("database details"));
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 31,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "/client",
          },
        },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("database details");
      expect(state.fail).toHaveBeenCalledWith("claim-1");
      expect(state.complete).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("completes an ordinary command with unknown delivery outcome without resending", async () => {
    const state = await build({ queriesEnabled: true });
    state.processCommand.mockResolvedValueOnce({
      kind: "processed",
      deliveryOutcome: "unknown_outcome",
    });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 64,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "/stats",
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(state.complete).toHaveBeenCalledWith("claim-1");
      expect(state.fail).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("enforces the per-expert query limit while retaining a reachable 20/min allowance", async () => {
    const keys: string[] = [];
    const state = await build({
      queriesEnabled: true,
      consume: (key, limit) => {
        keys.push(`${key}:${limit}`);
        return key === "telegram:query:123456789" ? false : true;
      },
    });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 32,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "/stats",
          },
        },
      });
      expect(response.statusCode).toBe(429);
      expect(keys).toContain("telegram:auth:provider:100");
      expect(keys).toContain("telegram:query:123456789:20");
    } finally {
      await state.app.close();
    }
  });

  it("keeps two experts' 20/min query budgets independent below the provider defense", async () => {
    const counts = new Map<string, number>();
    const state = await build({
      queriesEnabled: true,
      consume: (key, limit) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next <= limit;
      },
    });
    try {
      for (const telegramUserId of [123456789, 987654321]) {
        for (let index = 0; index < 20; index += 1) {
          const response = await state.app.inject({
            method: "POST",
            url: "/v1/webhooks/telegram",
            headers,
            payload: {
              update_id: telegramUserId + index,
              message: {
                from: { id: telegramUserId },
                chat: { id: telegramUserId, type: "private" },
                text: "/stats",
              },
            },
          });
          expect(response.statusCode).toBe(200);
        }
      }
      expect(counts.get("telegram:query:123456789")).toBe(20);
      expect(counts.get("telegram:query:987654321")).toBe(20);
      expect(counts.get("telegram:auth:provider")).toBe(40);
    } finally {
      await state.app.close();
    }
  });

  it("makes revoked, malformed, stale, replayed, and acknowledgement-failed cv1 denials equivalent", async () => {
    const outcomes: { status: number; body: unknown }[] = [];
    for (const scenario of [
      "revoked",
      "malformed",
      "foreign",
      "stale",
      "replayed",
      "ack_failed",
    ] as const) {
      const state = await build({ queriesEnabled: true });
      if (scenario === "revoked")
        state.resolvePrincipal.mockResolvedValueOnce(null);
      if (scenario === "malformed")
        state.authenticateClientView.mockResolvedValueOnce(null);
      if (scenario === "foreign")
        state.authenticateClientView.mockResolvedValueOnce(null);
      if (scenario === "stale" || scenario === "replayed")
        state.processClientView.mockRejectedValueOnce(new Error("denied"));
      if (scenario === "replayed")
        state.claim.mockResolvedValueOnce({ kind: "duplicate" });
      if (scenario === "ack_failed")
        state.authenticateClientView.mockResolvedValueOnce(null);
      if (scenario === "ack_failed")
        state.answerCallbackQuery.mockRejectedValueOnce(
          new Error("ack failed"),
        );
      try {
        const updateId = 70 + outcomes.length;
        const response = await state.app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          headers,
          payload: {
            update_id: updateId,
            callback_query: {
              id: `callback-${scenario}`,
              from: { id: 123456789 },
              data: scenario === "malformed" ? "cv1.invalid" : "cv1.safe-token",
            },
          },
        });
        outcomes.push({ status: response.statusCode, body: response.json() });
        expect(state.claim).toHaveBeenCalledWith("telegram", String(updateId));
        if (scenario !== "replayed") {
          expect(state.complete).toHaveBeenCalledWith("claim-1");
          expect(state.fail).not.toHaveBeenCalled();
        }
      } finally {
        await state.app.close();
      }
    }
    expect(outcomes).toEqual(
      Array.from({ length: 6 }, () => ({
        status: 200,
        body: { accepted: true, unavailable: true },
      })),
    );
  });
});
