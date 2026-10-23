import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { expertApplicantTelegramRoutes } from "./expert-applicant-telegram.js";
const fixture = async (enabled = true) => {
  const handle = vi.fn(async () => ({
    status: "handled" as const,
    text: "synthetic-safe-reply",
  }));
  const app = Fastify({ logger: false });
  await app.register(expertApplicantTelegramRoutes, {
    enabled,
    capability: {
      botId: "123",
      botKey: "promo-key",
      webhookSecret: "synthetic-secret",
      service: { handle },
    },
  });
  return { app, handle };
};
const update = {
  update_id: 1,
  message: {
    from: { id: 456 },
    chat: { id: 456, type: "private" },
    text: "/start",
  },
};
it("authenticates the separate promo route and derives identity", async () => {
  const f = await fixture();
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/expert-promo/promo-key",
    headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
    payload: update,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    method: "sendMessage",
    chat_id: "456",
    text: "synthetic-safe-reply",
    protect_content: true,
    reply_markup: {
      keyboard: [[{ text: "Мой актуальный тариф" }]],
      resize_keyboard: true,
    },
  });
  expect(f.handle).toHaveBeenCalledWith({
    botId: "123",
    botKey: "promo-key",
    telegramUserId: "456",
    chatId: "456",
    updateId: 1,
    text: "/start",
  });
  await f.app.close();
});
it.each([{}, { "x-telegram-bot-api-secret-token": "wrong" }])(
  "rejects missing/wrong webhook secret",
  async (headers) => {
    const f = await fixture();
    const r = await f.app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/promo-key",
      headers,
      payload: update,
    });
    expect(r.statusCode).toBe(401);
    expect(f.handle).not.toHaveBeenCalled();
    await f.app.close();
  },
);
it.each([
  { ...update, update_id: "1" },
  {
    ...update,
    message: { ...update.message, from: { id: 456, is_bot: true } },
  },
  {
    ...update,
    message: { ...update.message, chat: { id: 456, type: "group" } },
  },
  {
    ...update,
    message: { ...update.message, chat: { id: 789, type: "private" } },
  },
])("rejects unsafe updates before repository", async (payload) => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/expert-promo/promo-key",
    headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
    payload,
  });
  expect(r.statusCode).toBe(400);
  expect(f.handle).not.toHaveBeenCalled();
  await f.app.close();
});
it("omits route when disabled", async () => {
  const f = await fixture(false);
  const r = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/expert-promo/promo-key",
    payload: update,
  });
  expect(r.statusCode).toBe(404);
  await f.app.close();
});
it("fails enabled startup without capability", async () => {
  const app = Fastify({ logger: false });
  await expect(
    app.register(expertApplicantTelegramRoutes, { enabled: true }),
  ).rejects.toThrow("expert_applicant_capability_required");
  await app.close();
});

it("bounds authenticated promo requests before storage", async () => {
  const f = await fixture();
  for (let i = 0; i < 30; i++) {
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram/expert-promo/promo-key",
          headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
          payload: { ...update, update_id: i },
        })
      ).statusCode,
    ).toBe(200);
  }
  const r = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/expert-promo/promo-key",
    headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
    payload: { ...update, update_id: 31 },
  });
  expect(r.statusCode).toBe(429);
  expect(f.handle).toHaveBeenCalledTimes(30);
  await f.app.close();
});
