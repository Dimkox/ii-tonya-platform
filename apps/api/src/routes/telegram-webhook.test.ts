import { describe, expect, it } from "vitest";

import { CallbackInfrastructureError } from "@ii-tonya/integrations";
import { createWindowedRateLimiter } from "../rate-limit.js";
import { telegramWebhookRoutes } from "./telegram-webhook.js";
import Fastify from "fastify";

describe("Telegram expert callback boundary", () => {
  it("fails callback infrastructure errors closed without claiming the update", async () => {
    let claims = 0;
    const app = Fastify();
    await app.register(telegramWebhookRoutes, {
      secret: "telegram-webhook-secret",
      callbacks: {
        isAuthorizedIdentity: async () => true,
        verifyCallback: async () => {
          throw new CallbackInfrastructureError();
        },
        process: async () => undefined,
      },
      inbox: {
        claim: async () => {
          claims += 1;
          return { kind: "claimed" as const, claimId: "claim-1" };
        },
        complete: async () => undefined,
        fail: async () => undefined,
      },
      rateLimiter: createWindowedRateLimiter(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram",
      headers: { "x-telegram-bot-api-secret-token": "telegram-webhook-secret" },
      payload: {
        update_id: 10,
        callback_query: {
          id: "query-1",
          from: { id: 1001 },
          data: "ct3.token",
        },
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "callback_unavailable" });
    expect(claims).toBe(0);
    await app.close();
  });
});
