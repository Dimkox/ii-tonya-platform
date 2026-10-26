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
it("accepts scoped form callbacks and private media with per-result markup", async () => {
  const app = Fastify({ logger: false });
  const seen: unknown[] = [];
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: {
      botId: "123",
      botKey: "promo-key",
      webhookSecret: "synthetic-secret",
      verificationFormEnabled: true,
      service: {
        async handle(input) {
          seen.push(input);
          return {
            status: "handled",
            text: "Выберите роль",
            replyMarkup: {
              inline_keyboard: [[{ text: "EXPERT", callback_data: "rv:test" }]],
            },
          };
        },
      },
    },
  });
  const post = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/promo-key",
      headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
      payload,
    });
  const r = await post({
    update_id: 2,
    callback_query: {
      id: "query",
      from: { id: 456 },
      message: {
        from: { id: 123, is_bot: true },
        chat: { id: 456, type: "private" },
      },
      data: "rv:00000000-0000-4000-8000-000000000001:0:r:EXPERT",
    },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().reply_markup.inline_keyboard[0][0].text).toBe("EXPERT");
  const media = await post({
    update_id: 3,
    message: {
      from: { id: 456 },
      chat: { id: 456, type: "private" },
      document: {
        file_id: "private-file",
        mime_type: "application/pdf",
        file_size: 100,
      },
    },
  });
  expect(media.statusCode).toBe(200);
  expect(seen[1]).toMatchObject({
    media: {
      kind: "document",
      fileId: "private-file",
      mimeType: "application/pdf",
      size: 100,
    },
  });
  expect(
    (
      await post({
        update_id: 4,
        message: {
          from: { id: 456 },
          chat: { id: 456, type: "private" },
          document: {
            file_id: "private-file",
            mime_type: "application/pdf",
            file_size: 20971521,
          },
        },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await post({
        update_id: 5,
        callback_query: {
          id: "q",
          from: { id: 789 },
          message: {
            from: { id: 123, is_bot: true },
            chat: { id: 456, type: "private" },
          },
          data: "rv:test",
        },
      })
    ).statusCode,
  ).toBe(400);
  await app.close();
});
it("preserves honest unknown media metadata when Telegram omits optional fields", async () => {
  const app = Fastify({ logger: false });
  const handle = vi.fn<
    (input: unknown) => Promise<{ status: "handled"; text: string }>
  >(async () => ({
    status: "handled" as const,
    text: "Документ сохранён для проверки",
  }));
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: {
      botId: "123",
      botKey: "promo-key",
      webhookSecret: "synthetic-secret",
      verificationFormEnabled: true,
      service: { handle },
    },
  });
  for (const [i, content] of [
    { photo: [{ file_id: "private-photo", width: 100, height: 100 }] },
    { document: { file_id: "private-doc" } },
  ].entries()) {
    const r = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/promo-key",
      headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
      payload: {
        update_id: 100 + i,
        message: {
          from: { id: 456 },
          chat: { id: 456, type: "private" },
          ...content,
        },
      },
    });
    expect(r.statusCode).toBe(200);
    expect(handle.mock.calls[i]?.[0]).toMatchObject({
      media: { size: null, mimeType: null },
    });
  }
  await app.close();
});
it("acknowledges stale form controls without mutation or Telegram retries", async () => {
  const { createResidentVerificationService } =
    await import("../../../../packages/application/src/resident-verification-service.js");
  let mutations = 0;
  const form = createResidentVerificationService({
    enabled: true,
    repository: {
      async mutate(input) {
        if (input.action !== "start") mutations++;
        return {
          id: "00000000-0000-4000-8000-000000000001",
          revision: 2,
          draft: { roles: ["EXPERT"] },
          status: "PENDING_DOCS",
          progress: "FORM_FILLING",
          replay: false,
        };
      },
    },
  });
  const app = Fastify({ logger: false });
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: {
      botId: "123",
      botKey: "promo-key",
      webhookSecret: "synthetic-secret",
      verificationFormEnabled: true,
      service: {
        async handle(input) {
          return (await form.handle(input)) ?? { status: "rejected" };
        },
      },
    },
  });
  const r = await app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/expert-promo/promo-key",
    headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
    payload: {
      update_id: 777,
      callback_query: {
        id: "q",
        from: { id: 456 },
        message: {
          from: { id: 123, is_bot: true },
          chat: { id: 456, type: "private" },
        },
        data: "rv:00000000-0000-4000-8000-000000000001:0:r:CENTER",
      },
    },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().text).toContain("основную роль");
  expect(mutations).toBe(0);
  await app.close();
});
