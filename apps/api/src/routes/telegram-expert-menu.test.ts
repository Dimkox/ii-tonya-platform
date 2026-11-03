import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import {
  telegramWebhookRoutes,
  type TelegramExpertQueryIngress,
} from "./telegram-webhook.js";

const secret = "telegram-webhook-secret";
const headers = { "x-telegram-bot-api-secret-token": secret };
const principal = {
  userId: "00000000-0000-4000-8000-000000000100",
  expertId: "00000000-0000-4000-8000-000000000101",
  telegramUserId: "123456789",
  timezone: "Europe/Moscow",
};

const build = async (active: boolean) => {
  const claim = vi.fn(async () => ({
    kind: "claimed" as const,
    claimId: "claim-1",
  }));
  const complete = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  const resolvePrincipal = vi.fn<
    TelegramExpertQueryIngress["resolvePrincipal"]
  >(async () => (active ? principal : null));
  const processCommand = vi.fn<TelegramExpertQueryIngress["processCommand"]>(
    async () => ({ kind: "processed", deliveryOutcome: "applied" }),
  );
  const processMenuAction = vi.fn(async () => ({
    kind: "processed" as const,
    deliveryOutcome: "applied" as const,
  }));
  const sendInactiveResident = vi.fn(async () => ({ kind: "applied" }));
  const processReschedule = vi.fn<
    NonNullable<TelegramExpertQueryIngress["processReschedule"]>
  >(async (input) =>
    input.data.startsWith("rs2.") && input.data.endsWith("A")
      ? { kind: "forbidden" }
      : { kind: "processed", deliveryOutcome: "applied" },
  );
  const answerCallbackQuery = vi.fn(async () => ({
    kind: "applied" as const,
    providerOperationId: "answer-1",
  }));
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret,
    callbacks: {
      isAuthorizedIdentity: vi.fn(async () => true),
      verifyCallback: vi.fn(async () => true),
      process: vi.fn(async () => undefined),
    },
    inbox: { claim, complete, fail },
    rateLimiter: { consume: () => true },
    expertQueriesEnabled: true,
    expertCheckoutEnabled: false,
    expertQueries: {
      resolvePrincipal,
      authenticateClientView: vi.fn(async () => null),
      processCommand,
      processClientView: vi.fn(async () => ({ kind: "processed" as const })),
      answerCallbackQuery,
      processResidencyCheckout: vi.fn(async () => {
        throw new Error("unused");
      }),
      sendResidencyCheckoutLink: vi.fn(async () => {
        throw new Error("unused");
      }),
      processMenuAction,
      processReschedule,
      sendInactiveResident,
    } as TelegramExpertQueryIngress,
    expertAiEnabled: false,
    clientIngressEnabled: false,
    clientHybridRoutingEnabled: false,
    clientBotKey: "bot-client",
    testExpertPromoEnabled: false,
  } as unknown as Parameters<typeof telegramWebhookRoutes>[1]);
  return {
    app,
    claim,
    complete,
    resolvePrincipal,
    processCommand,
    processMenuAction,
    processReschedule,
    sendInactiveResident,
    answerCallbackQuery,
  };
};

const start = {
  update_id: 41,
  message: {
    text: "/start",
    from: { id: 123456789 },
    chat: { id: 123456789, type: "private" },
  },
};

describe("BOT-03 expert /start and main menu", () => {
  it("routes /start of an active resident to the command processor", async () => {
    const state = await build(true);
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: start,
      });
      expect(response.statusCode).toBe(200);
      expect(state.processCommand).toHaveBeenCalledWith(
        expect.objectContaining({ text: "/start", principal }),
      );
      expect(state.sendInactiveResident).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("refuses an inactive resident with the promo bot link and does not process the command", async () => {
    const state = await build(false);
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: start,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ inactive: true });
      expect(state.sendInactiveResident).toHaveBeenCalledWith({
        idempotencyKey: "telegram:41:inactive",
        telegramUserId: "123456789",
      });
      expect(state.processCommand).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("resolves the principal before a menu action and rejects an inactive one", async () => {
    const state = await build(false);
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: {
          update_id: 42,
          callback_query: {
            id: "menu-1",
            from: { id: 123456789 },
            data: "em1.bookings",
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(state.resolvePrincipal).toHaveBeenCalledWith("123456789");
      expect(state.processMenuAction).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it.each(["bookings", "slot", "balance", "support"] as const)(
    "dispatches the %s menu button for an active resident",
    async (action) => {
      const state = await build(true);
      try {
        const response = await state.app.inject({
          method: "POST",
          url: "/v1/webhooks/telegram",
          headers,
          payload: {
            update_id: 43,
            callback_query: {
              id: "menu-2",
              from: { id: 123456789 },
              data: `em1.${action}`,
            },
          },
        });
        expect(response.statusCode).toBe(200);
        expect(state.processMenuAction).toHaveBeenCalledWith(
          expect.objectContaining({ action, principal }),
        );
        expect(state.complete).toHaveBeenCalledWith("claim-1");
        expect(state.answerCallbackQuery).toHaveBeenCalledWith(
          expect.objectContaining({ status: "processed" }),
        );
      } finally {
        await state.app.close();
      }
    },
  );
});

describe("SCRUM-64 🔄 reschedule callbacks", () => {
  const callback = (data: string, updateId: number) => ({
    update_id: updateId,
    callback_query: { id: `rs-${updateId}`, from: { id: 123456789 }, data },
  });

  it("routes rs1 of an active resident with the resolved principal", async () => {
    const state = await build(true);
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: callback(`rs1.${"B".repeat(22)}`, 60),
      });
      expect(response.statusCode).toBe(200);
      expect(state.processReschedule).toHaveBeenCalledWith(
        expect.objectContaining({ data: `rs1.${"B".repeat(22)}`, principal }),
      );
      expect(state.complete).toHaveBeenCalledWith("claim-1");
    } finally {
      await state.app.close();
    }
  });

  it("does not touch bookings for an inactive resident", async () => {
    const state = await build(false);
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: callback(`rs2.${"B".repeat(44)}`, 61),
      });
      expect(response.statusCode).toBe(200);
      expect(state.processReschedule).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("answers 403 when the booking belongs to another expert", async () => {
    const state = await build(true);
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/telegram",
        headers,
        payload: callback(`rs2.${"B".repeat(43)}A`, 62),
      });
      expect(response.statusCode).toBe(403);
      expect(state.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ status: "unavailable" }),
      );
    } finally {
      await state.app.close();
    }
  });
});
