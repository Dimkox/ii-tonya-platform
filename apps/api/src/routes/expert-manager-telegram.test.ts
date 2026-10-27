import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { expertManagerTelegramRoutes } from "./expert-manager-telegram.js";
const setup = async (enabled = true) => {
  const service = {
    createPairing: vi
      .fn()
      .mockResolvedValue({ kind: "ok", token: "a".repeat(43) }),
    pair: vi.fn().mockResolvedValue({ kind: "ok" }),
    callback: vi.fn().mockResolvedValue({ kind: "forbidden" }),
    tick: vi.fn().mockResolvedValue({ sent: 0 }),
    signCallback: vi.fn(),
  };
  const app = Fastify();
  await app.register(
    expertManagerTelegramRoutes,
    enabled
      ? {
          capability: {
            enabled: true,
            botId: "42",
            botKey: "manager",
            webhookSecret: "synthetic-manager-secret",
            service,
          },
        }
      : {},
  );
  return { app, service };
};
it("registers no manager routes without explicit capability", async () => {
  const { app } = await setup(false);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/admin/expert-verification/telegram-pairing",
      })
    ).statusCode,
  ).toBe(404);
  await app.close();
});
it("requires bearer session before issuing trusted pairing", async () => {
  const { app, service } = await setup();
  const result = await app.inject({
    method: "POST",
    url: "/v1/admin/expert-verification/telegram-pairing",
  });
  expect(result.statusCode).toBe(401);
  expect(service.createPairing).not.toHaveBeenCalled();
  await app.close();
});
it("hashes staff bearer before pairing and marks response no-store", async () => {
  const { app, service } = await setup();
  const result = await app.inject({
    method: "POST",
    url: "/v1/admin/expert-verification/telegram-pairing",
    headers: { authorization: `Bearer ${"s".repeat(24)}` },
  });
  expect(result.statusCode).toBe(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(service.createPairing).toHaveBeenCalledWith(
    expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
  );
  await app.close();
});
it("rejects webhook credentials before touching manager authority", async () => {
  const { app, service } = await setup();
  const result = await app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/expert-manager/manager",
    payload: { update_id: 1 },
  });
  expect(result.statusCode).toBe(401);
  expect(service.pair).not.toHaveBeenCalled();
  expect(service.callback).not.toHaveBeenCalled();
  await app.close();
});
it("binds private callback to authenticated Telegram sender and chat", async () => {
  const { app, service } = await setup();
  const result = await app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/expert-manager/manager",
    headers: { "x-telegram-bot-api-secret-token": "synthetic-manager-secret" },
    payload: {
      update_id: 1,
      callback_query: {
        data: "mt1.synthetic",
        from: { id: 123, is_bot: false },
        message: { chat: { id: 123, type: "private" } },
      },
    },
  });
  expect(result.statusCode).toBe(200);
  expect(service.callback).toHaveBeenCalledWith("123", "123", "mt1.synthetic");
  expect(result.json().text).toContain("MFA");
  await app.close();
});
it("denies group callbacks even with correct webhook secret", async () => {
  const { app, service } = await setup();
  const result = await app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/expert-manager/manager",
    headers: { "x-telegram-bot-api-secret-token": "synthetic-manager-secret" },
    payload: {
      update_id: 1,
      callback_query: {
        data: "mt1.synthetic",
        from: { id: 123 },
        message: { chat: { id: 123, type: "group" } },
      },
    },
  });
  expect(result.statusCode).toBe(400);
  expect(service.callback).not.toHaveBeenCalled();
  await app.close();
});
