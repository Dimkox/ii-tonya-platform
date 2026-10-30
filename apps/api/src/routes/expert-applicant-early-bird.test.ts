import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { expertApplicantTelegramRoutes } from "./expert-applicant-telegram.js";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic-secret";

it("admits wave buttons only when a wave capability is installed", async () => {
  for (const enabled of [false, true]) {
    const handle = vi
      .fn()
      .mockResolvedValue({ status: "handled", text: "Проверено" });
    const app = Fastify();
    await app.register(expertApplicantTelegramRoutes, {
      enabled: true,
      capability: {
        botId: "123",
        botKey: "promo-key",
        webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
        verificationFormEnabled: true,
        separatedSalesEnabled: true,
        earlyBirdEnabled: enabled,
        service: { handle },
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/promo-key",
      headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
      payload: {
        update_id: 2,
        callback_query: {
          id: "query",
          from: { id: 456 },
          message: {
            from: { id: 123, is_bot: true },
            chat: { id: 456, type: "private" },
          },
          data: "eb:00000000-0000-4000-8000-000000000001:1:now",
        },
      },
    });
    expect(res.statusCode).toBe(enabled ? 200 : 400);
    expect(handle).toHaveBeenCalledTimes(enabled ? 1 : 0);
    await app.close();
  }
});

it.each([
  "eb:00000000-0000-4000-8000-000000000001:1:now",
  "ss:00000000-0000-4000-8000-000000000001:1:positive",
])("routes %s when verification form is disabled", async (data) => {
  const handle = vi
    .fn()
    .mockResolvedValue({ status: "handled", text: "Проверено" });
  const app = Fastify();
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: {
      botId: "123",
      botKey: "promo-key",
      webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
      verificationFormEnabled: false,
      separatedSalesEnabled: true,
      earlyBirdEnabled: true,
      service: { handle },
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/expert-promo/promo-key",
    headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
    payload: {
      update_id: 2,
      callback_query: {
        id: "query",
        from: { id: 456 },
        message: {
          from: { id: 123, is_bot: true },
          chat: { id: 456, type: "private" },
        },
        data,
      },
    },
  });
  expect(res.statusCode).toBe(200);
  expect(handle).toHaveBeenCalledOnce();
  await app.close();
});

it("passes a bounded safe Telegram first name only after scoped identity validation", async () => {
  const handle = vi.fn().mockResolvedValue({ status: "handled", text: "ok" });
  const app = Fastify();
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: {
      botId: "123",
      botKey: "promo-key",
      webhookSecret: SYNTHETIC_FIXTURE_VALUE_1,
      separatedSalesEnabled: true,
      earlyBirdEnabled: true,
      verificationFormEnabled: true,
      service: { handle },
    },
  });
  const post = (first_name: string, userId = 456) =>
    app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/promo-key",
      headers: { "x-telegram-bot-api-secret-token": "synthetic-secret" },
      payload: {
        update_id: 1,
        callback_query: {
          id: "q",
          from: { id: userId, first_name },
          message: {
            from: { id: 123, is_bot: true },
            chat: { id: 456, type: "private" },
          },
          data: "eb:00000000-0000-4000-8000-000000000001:1:now",
        },
      },
    });
  expect((await post(" Анна ")).statusCode).toBe(200);
  expect(handle).toHaveBeenLastCalledWith(
    expect.objectContaining({ firstName: "Анна" }),
  );
  expect((await post("X\u202eY")).statusCode).toBe(200);
  expect(handle.mock.lastCall?.[0]).not.toHaveProperty("firstName");
  expect((await post("Анна", 999)).statusCode).toBe(400);
  expect(handle).toHaveBeenCalledTimes(2);
  await app.close();
});
