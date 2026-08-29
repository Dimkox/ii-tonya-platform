import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { WebhookInbox } from "./selarti-webhook.js";
import {
  telegramWebhookRoutes,
  type TelegramExpertAiIngress,
  type TelegramExpertQueryIngress,
} from "./telegram-webhook.js";

const secret = "telegram-webhook-secret";

const build = async (
  options: {
    queriesEnabled?: boolean;
    aiEnabled?: boolean;
    checkoutEnabled?: boolean;
    consume?: (key: string, limit: number, windowMs: number) => boolean;
    clientHandle?: (
      raw: unknown,
    ) => Promise<{ status: string; route?: string }>;
  } = {},
) => {
  const claim = vi.fn<WebhookInbox["claim"]>(async () => ({
    kind: "claimed" as const,
    claimId: "claim-1",
  }));
  const complete = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  const isAuthorizedIdentity = vi.fn(async () => true);
  const verifyCallback = vi.fn(async () => true);
  const process = vi.fn(async () => undefined);
  const resolvePrincipal = vi.fn<
    TelegramExpertQueryIngress["resolvePrincipal"]
  >(async (telegramUserId: string) => ({
    userId: "00000000-0000-4000-8000-000000000100",
    expertId: "00000000-0000-4000-8000-000000000101",
    telegramUserId,
    timezone: "Europe/Moscow",
  }));
  const authenticateClientView = vi.fn<
    TelegramExpertQueryIngress["authenticateClientView"]
  >(async () => ({
    tokenHash: "a".repeat(64),
    claims: {
      reservationId: "00000000-0000-4000-8000-000000000201",
      expertId: "00000000-0000-4000-8000-000000000101",
      telegramUserId: "123456789",
      version: 1,
      expiresAtEpochSeconds: 1_786_000_000,
    },
  }));
  const processCommand = vi.fn<TelegramExpertQueryIngress["processCommand"]>(
    async () => ({ kind: "processed", deliveryOutcome: "applied" }),
  );
  const processClientView = vi.fn<
    TelegramExpertQueryIngress["processClientView"]
  >(async () => ({
    kind: "processed" as const,
    deliveryOutcome: "applied" as const,
  }));
  const answerCallbackQuery = vi.fn<
    TelegramExpertQueryIngress["answerCallbackQuery"]
  >(async () => ({
    kind: "applied" as const,
    providerOperationId: "answer-1",
  }));
  const resolveAiPrincipal = vi.fn<TelegramExpertAiIngress["resolvePrincipal"]>(
    async () => ({
      authenticated: true,
      userId: "00000000-0000-4000-8000-000000000100",
      expertId: "00000000-0000-4000-8000-000000000101",
    }),
  );
  const handleAi = vi.fn<TelegramExpertAiIngress["handle"]>(async () => ({
    kind: "completed",
    proposalKind: "view_referral_summary",
    result: { private: "not-delivered" },
  }));
  const processResidencyCheckout = vi.fn<
    TelegramExpertQueryIngress["processResidencyCheckout"]
  >(async () => ({
    kind: "ready" as const,
    tokenHash: "b".repeat(64),
    checkoutUrl: "https://pay.example/checkout",
    replay: false,
  }));
  const sendResidencyCheckoutLink = vi.fn<
    TelegramExpertQueryIngress["sendResidencyCheckoutLink"]
  >(async () => ({
    kind: "applied" as const,
    providerOperationId: "checkout-message-1",
  }));
  const clientGatewayHandle = vi.fn(
    options.clientHandle ?? (async () => ({ status: "disabled" })),
  );
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret,
    callbacks: { isAuthorizedIdentity, verifyCallback, process },
    inbox: { claim, complete, fail },
    rateLimiter: { consume: options.consume ?? (() => true) },
    expertQueriesEnabled: options.queriesEnabled ?? false,
    expertCheckoutEnabled: options.checkoutEnabled ?? false,
    expertQueries: {
      resolvePrincipal,
      authenticateClientView,
      processCommand,
      processClientView,
      answerCallbackQuery,
      processResidencyCheckout,
      sendResidencyCheckoutLink,
    },
    expertAiEnabled: options.aiEnabled ?? false,
    expertAi: { resolvePrincipal: resolveAiPrincipal, handle: handleAi },
    clientIngressEnabled: options.clientHandle !== undefined,
    clientHybridRoutingEnabled: true,
    clientBotKey: "bot-client",
    clientGateway:
      options.clientHandle === undefined
        ? undefined
        : { handle: clientGatewayHandle },
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
    resolveAiPrincipal,
    handleAi,
    processResidencyCheckout,
    sendResidencyCheckoutLink,
    clientGatewayHandle,
  };
};

const headers = { "x-telegram-bot-api-secret-token": secret };

describe("Telegram webhook callback boundary", () => {
  it.each([
    ["accepted", 200, { status: "accepted", route: "deterministic" }],
    ["duplicate", 200, { status: "duplicate" }],
    ["rejected", 200, { status: "rejected" }],
    ["conflict", 200, { status: "conflict" }],
    ["unavailable", 503, { status: "unavailable" }],
  ])("maps client gateway %s to HTTP %s", async (_name, expected, result) => {
    const state = await build({ clientHandle: async () => result });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram/client/bot-client",
        headers,
        payload: {
          update_id: 901,
          message: {
            from: { id: 123 },
            chat: { id: 123, type: "private" },
            text: "/help",
          },
        },
      });
      expect(response.statusCode).toBe(expected);
    } finally {
      await state.app.close();
    }
  });
  it("returns 503 when client gateway throws", async () => {
    const state = await build({
      clientHandle: async () => {
        throw new Error("db");
      },
    });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram/client/bot-client",
        headers,
        payload: {
          update_id: 902,
          message: {
            from: { id: 123 },
            chat: { id: 123, type: "private" },
            text: "/help",
          },
        },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      await state.app.close();
    }
  });
  it("keeps ordinary private text on the default Telegram lifecycle", async () => {
    const state = await build();
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 910,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "Покажи баланс",
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(state.handleAi).not.toHaveBeenCalled();
      expect(state.process).toHaveBeenCalledTimes(1);
    } finally {
      await state.app.close();
    }
  });

  it("dispatches enabled private non-slash text with a fresh principal and server keys", async () => {
    const state = await build({ aiEnabled: true });
    try {
      const request = (updateId: number) =>
        state.app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          headers: { ...headers, "x-correlation-id": "telegram-corr" },
          payload: {
            update_id: updateId,
            message: {
              from: { id: 123456789 },
              chat: { id: 123456789, type: "private" },
              text: "Покажи баланс",
            },
          },
        });
      expect((await request(911)).json()).toEqual({ accepted: true });
      expect((await request(912)).statusCode).toBe(200);
      expect(state.resolveAiPrincipal).toHaveBeenCalledTimes(2);
      expect(state.handleAi).toHaveBeenNthCalledWith(1, {
        principal: {
          authenticated: true,
          userId: "00000000-0000-4000-8000-000000000100",
          expertId: "00000000-0000-4000-8000-000000000101",
        },
        text: "Покажи баланс",
        locale: "ru-RU",
        correlationId: "telegram-corr",
        idempotencyKey: "telegram:911:expert-ai",
      });
      expect(state.process).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });
  it("never invokes the client gateway from the generic expert webhook", async () => {
    const state = await build({
      clientHandle: async () => ({ status: "accepted" }),
    });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 920,
          message: {
            from: { id: 123 },
            chat: { id: 123, type: "private" },
            text: "client text",
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(state.clientGatewayHandle).not.toHaveBeenCalled();
      expect(state.process).toHaveBeenCalledOnce();
    } finally {
      await state.app.close();
    }
  });
  it("terminally rejects a wrong dedicated bot path before gateway", async () => {
    const state = await build({
      clientHandle: async () => ({ status: "accepted" }),
    });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram/client/wrong-bot",
        headers,
        payload: {
          update_id: 921,
          message: {
            from: { id: 123 },
            chat: { id: 123, type: "private" },
            text: "client text",
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: true, rejected: true });
      expect(state.clientGatewayHandle).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });
  it("caps the dedicated body before gateway and uses a bot-scoped rate key", async () => {
    const consume = vi.fn(() => true);
    const state = await build({
      consume,
      clientHandle: async () => ({ status: "accepted" }),
    });
    try {
      const oversized = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram/client/bot-client",
        headers,
        payload: {
          update_id: 922,
          message: {
            from: { id: 123 },
            chat: { id: 123, type: "private" },
            text: "x".repeat(65_536),
          },
        },
      });
      expect(oversized.statusCode).toBe(413);
      expect(state.clientGatewayHandle).not.toHaveBeenCalled();

      await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram/client/bot-client",
        headers,
        payload: {
          update_id: 923,
          message: {
            from: { id: 123 },
            chat: { id: 123, type: "private" },
            text: "ok",
          },
        },
      });
      expect(consume).toHaveBeenCalledWith(
        "telegram:client:auth:bot-client",
        100,
        60_000,
      );
      expect(consume).not.toHaveBeenCalledWith(
        "telegram:auth:provider",
        expect.anything(),
        expect.anything(),
      );
    } finally {
      await state.app.close();
    }
  });

  it("never dispatches slash text or non-private text to expert AI", async () => {
    const state = await build({ aiEnabled: true, queriesEnabled: true });
    try {
      await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 913,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "/stats",
          },
        },
      });
      const group = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 914,
          message: {
            from: { id: 123456789 },
            chat: { id: -1, type: "group" },
            text: "Покажи баланс",
          },
        },
      });
      expect(group.statusCode).toBe(403);
      expect(state.processCommand).toHaveBeenCalledTimes(1);
      expect(state.handleAi).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("fails retryably on unavailable AI and completes bounded denials", async () => {
    const unavailable = await build({ aiEnabled: true });
    unavailable.handleAi.mockResolvedValueOnce({ kind: "unavailable" });
    try {
      const response = await unavailable.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 915,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "Баланс",
          },
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "expert_ai_unavailable" });
      expect(unavailable.fail).toHaveBeenCalledWith("claim-1");
    } finally {
      await unavailable.app.close();
    }

    const denied = await build({ aiEnabled: true });
    denied.handleAi.mockResolvedValueOnce({ kind: "forbidden" });
    try {
      const response = await denied.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 916,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "Баланс",
          },
        },
      });
      expect(response.json()).toEqual({ accepted: true, unavailable: true });
      expect(denied.complete).toHaveBeenCalledWith("claim-1");
      expect(denied.fail).not.toHaveBeenCalled();
    } finally {
      await denied.app.close();
    }
  });

  it("deduplicates private expert AI text before a second source dispatch", async () => {
    const state = await build({ aiEnabled: true });
    state.claim.mockResolvedValueOnce({ kind: "duplicate" });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 917,
          message: {
            from: { id: 123456789 },
            chat: { id: 123456789, type: "private" },
            text: "Баланс",
          },
        },
      });
      expect(response.json()).toEqual({ accepted: true, duplicate: true });
      expect(state.resolveAiPrincipal).toHaveBeenCalledTimes(1);
      expect(state.handleAi).not.toHaveBeenCalled();
      expect(state.complete).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });
  it("keeps xr1 isolated from ct2/cv1 until checkout readiness is composed", async () => {
    const state = await build({ queriesEnabled: true });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 901,
          callback_query: {
            id: "xr1-checkout",
            from: { id: 123456789 },
            data: "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        },
      });
      expect(response.json()).toEqual({ accepted: true, unsupported: true });
      expect(state.authenticateClientView).not.toHaveBeenCalled();
      expect(state.verifyCallback).not.toHaveBeenCalled();
      expect(state.claim).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("fresh-resolves an xr1 principal, processes checkout, and delivers only the stored URL", async () => {
    const state = await build({ checkoutEnabled: true });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 902,
          callback_query: {
            id: "xr1-ready",
            from: { id: 123456789 },
            data: "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: true });
      expect(state.resolvePrincipal).toHaveBeenCalledWith("123456789");
      expect(state.processResidencyCheckout).toHaveBeenCalledWith({
        data: "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        principal: expect.objectContaining({
          userId: "00000000-0000-4000-8000-000000000100",
          expertId: "00000000-0000-4000-8000-000000000101",
          telegramUserId: "123456789",
        }),
      });
      expect(state.sendResidencyCheckoutLink).toHaveBeenCalledWith({
        idempotencyKey: `telegram:${"b".repeat(64)}:checkout:delivery`,
        telegramUserId: "123456789",
        checkoutUrl: "https://pay.example/checkout",
      });
      expect(state.complete).toHaveBeenCalledWith("claim-1");
      expect(state.fail).not.toHaveBeenCalled();
      expect(state.answerCallbackQuery).toHaveBeenCalledWith({
        callbackQueryId: "xr1-ready",
        status: "processed",
        idempotencyKey: "telegram:902:checkout:answer",
      });
      expect(state.verifyCallback).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("releases the inbox claim on ambiguous checkout-link delivery for idempotent retry", async () => {
    const state = await build({ checkoutEnabled: true });
    state.sendResidencyCheckoutLink.mockResolvedValueOnce({
      kind: "unknown_outcome",
      reconciliationKey: "checkout-link",
      reasonCode: "timeout_after_write",
    });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 903,
          callback_query: {
            id: "xr1-ambiguous",
            from: { id: 123456789 },
            data: "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "expert_checkout_delivery_unavailable",
      });
      expect(response.body).not.toContain("timeout_after_write");
      expect(state.fail).toHaveBeenCalledWith("claim-1");
      expect(state.complete).not.toHaveBeenCalled();
      expect(state.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ status: "unavailable" }),
      );
    } finally {
      await state.app.close();
    }
  });

  it("returns retryable 503 without owning a busy xr1 inbox claim", async () => {
    const state = await build({ checkoutEnabled: true });
    state.claim.mockResolvedValueOnce({ kind: "busy" });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 906,
          callback_query: {
            id: "xr1-busy",
            from: { id: 123456789 },
            data: "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "expert_checkout_unavailable" });
      expect(state.complete).not.toHaveBeenCalled();
      expect(state.fail).not.toHaveBeenCalled();
      expect(state.processResidencyCheckout).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("releases an xr1 inbox claim while checkout processing is nonterminal", async () => {
    const state = await build({ checkoutEnabled: true });
    state.processResidencyCheckout.mockResolvedValueOnce({
      kind: "processing",
      tokenHash: "c".repeat(64),
      replay: true,
    });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 907,
          callback_query: {
            id: "xr1-processing",
            from: { id: 123456789 },
            data: "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "expert_checkout_unavailable" });
      expect(state.fail).toHaveBeenCalledWith("claim-1");
      expect(state.complete).not.toHaveBeenCalled();
      expect(state.sendResidencyCheckoutLink).not.toHaveBeenCalled();

      const retry = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 907,
          callback_query: {
            id: "xr1-processing-retry",
            from: { id: 123456789 },
            data: "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        },
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual({ accepted: true });
      expect(state.sendResidencyCheckoutLink).toHaveBeenCalledTimes(1);
    } finally {
      await state.app.close();
    }
  });

  it("completes a denied xr1 claim without attempting link delivery", async () => {
    const state = await build({ checkoutEnabled: true });
    state.processResidencyCheckout.mockResolvedValueOnce({
      kind: "unavailable",
      replay: true,
    });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 904,
          callback_query: {
            id: "xr1-denied",
            from: { id: 123456789 },
            data: "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: true, unavailable: true });
      expect(state.complete).toHaveBeenCalledWith("claim-1");
      expect(state.fail).not.toHaveBeenCalled();
      expect(state.sendResidencyCheckoutLink).not.toHaveBeenCalled();
      expect(state.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ status: "unavailable" }),
      );
    } finally {
      await state.app.close();
    }
  });

  it("completes a revoked-principal xr1 claim as a generic denial", async () => {
    const state = await build({ checkoutEnabled: true });
    state.resolvePrincipal.mockResolvedValueOnce(null);
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 905,
          callback_query: {
            id: "xr1-revoked",
            from: { id: 123456789 },
            data: "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: true, unavailable: true });
      expect(state.complete).toHaveBeenCalledWith("claim-1");
      expect(state.fail).not.toHaveBeenCalled();
      expect(state.processResidencyCheckout).not.toHaveBeenCalled();
      expect(state.sendResidencyCheckoutLink).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });
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

  it.each([
    "/schedule",
    "/referral",
    "/residency 00000000-0000-4000-8000-000000000301",
  ])("keeps %s isolated while the query flag is false", async (text) => {
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
            text,
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
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "expert_query_unavailable" });
      expect(state.complete).not.toHaveBeenCalled();
      expect(state.fail).toHaveBeenCalledWith("claim-1");
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
