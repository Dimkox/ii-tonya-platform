import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { telegramWebhookRoutes } from "./telegram-webhook.js";
it.each([
  "/orders",
  "/orders@trusted_bot",
  "/coupons_balance",
  "/reservations",
])(
  "never routes disabled account command %s into navigation or hybrid",
  async (text) => {
    const app = Fastify();
    const navigation = vi.fn(),
      legacy = vi.fn(),
      record = vi.fn();
    await app.register(telegramWebhookRoutes, {
      secret: "synthetic-secret",
      clientBotKey: "assistant",
      clientBotId: "123",
      clientIngressEnabled: true,
      clientHybridRoutingEnabled: true,
      clientGateway: { handle: legacy },
      clientNavigationEnabled: true,
      clientNavigationGateway: { handle: navigation },
      clientIngressReplay: { hasReceipt: record },
      callbacks: {
        isAuthorizedIdentity: vi.fn(),
        verifyCallback: vi.fn(),
        process: vi.fn(),
      },
      inbox: { claim: vi.fn(), complete: vi.fn(), fail: vi.fn() },
      rateLimiter: { consume: () => true },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram/client/assistant",
        headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
        payload: {
          update_id: 1,
          message: {
            text,
            from: { id: 7, is_bot: false },
            chat: { id: 7, type: "private" },
          },
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "client_account_queries_unavailable",
      });
      expect(navigation).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  },
);
