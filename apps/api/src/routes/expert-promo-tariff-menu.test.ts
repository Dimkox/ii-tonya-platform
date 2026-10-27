import Fastify from "fastify";
import { it, expect, vi } from "vitest";
import { createExpertApplicantService } from "../../../../packages/application/src/expert-applicant-service.js";
import { expertApplicantTelegramRoutes } from "./expert-applicant-telegram.js";
it("renders an actual promo tariff button and routes its click before verification or handoff", async () => {
  const readPromoIdentity = vi.fn(async () => ({
    offer_start_date: "2026-10-23T00:00:00.000Z",
    current_discount_stage: 1,
    discount_percent: 40,
    locked_price_monthly: "540000",
    locked_price_package: "1500000",
    payment_link_expires_at: "2026-10-27T00:00:00.000Z",
    remaining_seconds: 300,
    readiness: "pending_gates" as const,
    payment_url: null,
  }));
  const service = createExpertApplicantService({
    enabled: true,
    repository: {
      beginEnrollment: async () => ({ kind: "ready" }),
      register: async () => ({
        userId: "synthetic",
        refCode: "promo_synthetic",
        referralCount: 0,
        bonusPoints: 0,
        bonusStatus: "none",
        guideStatus: "none",
        replay: false,
      }),
    } as never,
    personalOffers: { readPromoIdentity },
  });
  const app = Fastify({ logger: false });
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: {
      botId: "123",
      botKey: "promo-menu",
      webhookSecret: "synthetic-menu-secret",
      service,
    },
  });
  try {
    const send = (text: string, update_id: number) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram/expert-promo/promo-menu",
        headers: { "x-telegram-bot-api-secret-token": "synthetic-menu-secret" },
        payload: {
          update_id,
          message: {
            from: { id: 456 },
            chat: { id: 456, type: "private" },
            text,
          },
        },
      });
    const start = await send("/start", 1);
    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({
      method: "sendMessage",
      reply_markup: {
        keyboard: [[{ text: "Мой актуальный тариф" }]],
        resize_keyboard: true,
      },
    });
    const click = await send("Мой актуальный тариф", 2);
    expect(click.statusCode).toBe(200);
    expect(click.json().text).toContain("5 400 ₽");
    expect(click.json().text).toContain("15 000 ₽");
    expect(click.json().text).toContain("2026-10-23T00:00:00.000Z");
    expect(click.json().text).toContain("300 сек.");
    expect(click.json().text).not.toContain("Оплатить:");
    expect(readPromoIdentity).toHaveBeenCalledExactlyOnceWith({
      botId: "123",
      botKey: "promo-menu",
      telegramUserId: "456",
      chatId: "456",
    });
  } finally {
    await app.close();
  }
});
