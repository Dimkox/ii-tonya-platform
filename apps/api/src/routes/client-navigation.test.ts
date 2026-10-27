import Fastify from "fastify";
import { PassThrough } from "node:stream";
import { createLogger } from "@ii-tonya/observability";
import { afterEach, expect, it, vi } from "vitest";
import { telegramWebhookRoutes } from "./telegram-webhook.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const replyBody = {
  method: "sendMessage" as const,
  chat_id: 123,
  text: "Навигация",
  reply_markup: { inline_keyboard: [] },
};
const build = async (
  options: {
    navigation?: boolean;
    result?: unknown;
    failure?: boolean;
    terminal?: boolean;
    lookupFailure?: boolean;
    allow?: boolean;
    promo?: boolean;
  } = {},
) => {
  const sink = new PassThrough();
  const logs: string[] = [];
  sink.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  const app = Fastify({ loggerInstance: createLogger(sink) });
  apps.push(app);
  const navigation = vi.fn(async () => {
    if (options.failure) throw new Error("SYNTHETIC_PRIVATE_CANARY");
    return (options.result ?? {
      status: "reply",
      reply: replyBody,
    }) as import("@ii-tonya/application").ClientNavigationResult;
  });
  const legacy = vi.fn(async () => ({
    status: "accepted",
    route: "deterministic",
  }));
  const promo = vi.fn(async () => ({ status: "handled" as const }));
  const hasReceipt = vi.fn(async () => {
    if (options.lookupFailure) throw new Error("SYNTHETIC_PRIVATE_CANARY");
    return options.terminal ?? false;
  });
  const claim = vi.fn();
  await app.register(telegramWebhookRoutes, {
    secret: "synthetic-webhook-secret",
    clientBotKey: "synthetic-route-key",
    clientIngressEnabled: options.navigation === false,
    clientHybridRoutingEnabled: false,
    clientNavigationEnabled: options.navigation !== false,
    clientNavigationGateway: { handle: navigation },
    clientBotId: "123456",
    clientIngressReplay: { hasReceipt },
    clientGateway: { handle: legacy },
    testExpertPromoEnabled: options.promo !== false,
    testExpertPromo: { handle: promo },
    callbacks: {
      isAuthorizedIdentity: vi.fn(),
      verifyCallback: vi.fn(),
      process: vi.fn(),
    },
    inbox: { claim, complete: vi.fn(), fail: vi.fn() },
    rateLimiter: { consume: () => options.allow !== false },
  });
  return { app, navigation, legacy, promo, hasReceipt, claim, logs };
};
const inject = (
  app: ReturnType<typeof Fastify>,
  payload: unknown = {
    update_id: 7,
    message: {
      text: "/start",
      chat: { id: 123, type: "private" },
      from: { id: 123 },
    },
  },
  headers: Record<string, string> = {
    "x-telegram-bot-api-secret-token": "synthetic-webhook-secret",
  },
  key = "synthetic-route-key",
) =>
  app.inject({
    method: "POST",
    url: `/v1/webhooks/telegram/client/${key}`,
    headers,
    payload,
  });

it("hands off navigation with content ingress off before all legacy processors", async () => {
  const f = await build();
  const response = await inject(f.app);
  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("application/json");
  expect(response.json()).toEqual(replyBody);
  expect(f.navigation).toHaveBeenCalledTimes(1);
  for (const forbidden of [f.legacy, f.promo, f.claim, f.hasReceipt])
    expect(forbidden).not.toHaveBeenCalled();
});
it("authenticates header and route key before any gateway or DB work", async () => {
  const f = await build();
  expect((await inject(f.app, { update_id: 7 }, {})).statusCode).toBe(401);
  expect(
    (await inject(f.app, { update_id: 7 }, undefined, "wrong-key")).json(),
  ).toEqual({ accepted: true, rejected: true });
  for (const forbidden of [
    f.navigation,
    f.legacy,
    f.promo,
    f.hasReceipt,
    f.claim,
  ])
    expect(forbidden).not.toHaveBeenCalled();
});
it.each([
  {},
  { update_id: -1 },
  { update_id: 1.2 },
  { update_id: Number.MAX_SAFE_INTEGER + 1 },
  { update_id: "7" },
  { update_id: true },
  { update_id: null },
])("rejects unsafe IDs before receipt work: %j", async (payload) => {
  const f = await build();
  expect((await inject(f.app, payload)).statusCode).toBe(400);
  expect(f.navigation).not.toHaveBeenCalled();
});
it.each(["unavailable", "disabled"])(
  "never acknowledges a %s receipt",
  async (status) => {
    const f = await build({ result: { status } });
    const response = await inject(f.app);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "client_navigation_unavailable" });
    expect(f.legacy).not.toHaveBeenCalled();
  },
);
it("sanitizes gateway failures", async () => {
  const f = await build({ failure: true });
  const response = await inject(f.app);
  expect(response.statusCode).toBe(503);
  expect(response.body).not.toContain("CANARY");
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(f.logs.join("")).not.toContain("CANARY");
  expect(f.logs.join("")).not.toContain('"stack"');
});
it("never resends a duplicate", async () => {
  const f = await build({ result: { status: "duplicate" } });
  expect((await inject(f.app)).json()).toEqual({
    accepted: true,
    duplicate: true,
  });
  expect(f.legacy).not.toHaveBeenCalled();
});
it.each([false, true])(
  "fences terminal legacy replay before promo/hybrid, lookup error=%s",
  async (lookupFailure) => {
    const f = await build({ navigation: false, terminal: true, lookupFailure });
    const response = await inject(f.app);
    expect(response.statusCode).toBe(lookupFailure ? 503 : 200);
    expect(response.json()).toEqual(
      lookupFailure
        ? { error: "client_gateway_unavailable" }
        : { accepted: true, duplicate: true },
    );
    expect(f.hasReceipt).toHaveBeenCalledWith({ botId: "123456", updateId: 7 });
    for (const forbidden of [f.navigation, f.legacy, f.promo, f.claim])
      expect(forbidden).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  "continues a fresh legacy event through the fence, promo=%s",
  async (promo) => {
    const f = await build({ navigation: false, terminal: false, promo });
    const response = await inject(f.app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: true,
      route: promo ? "test_expert" : "deterministic",
    });
    expect(f.hasReceipt).toHaveBeenCalledExactlyOnceWith({
      botId: "123456",
      updateId: 7,
    });
    const next = promo ? f.promo : f.legacy;
    expect(next).toHaveBeenCalledTimes(1);
    expect(f.hasReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      next.mock.invocationCallOrder[0]!,
    );
    expect(promo ? f.legacy : f.promo).not.toHaveBeenCalled();
    expect(f.navigation).not.toHaveBeenCalled();
    expect(f.claim).not.toHaveBeenCalled();
  },
);
it("retains rate and body limits", async () => {
  const f = await build({ allow: false });
  expect((await inject(f.app)).statusCode).toBe(429);
  const allowed = await build();
  expect(
    (await inject(allowed.app, { update_id: 7, text: "x".repeat(65536) }))
      .statusCode,
  ).toBe(413);
  expect(allowed.navigation).not.toHaveBeenCalled();
  expect(f.navigation).not.toHaveBeenCalled();
});
it.each([
  ["plain malformed JSON", "SYNTHETIC_PERSONAL_CANARY", 400],
  ["malformed object", '{"SYNTHETIC_PERSONAL_CANARY":broken}', 400],
  ["schema", { update_id: { SYNTHETIC_PERSONAL_CANARY: "private" } }, 400],
  [
    "oversize",
    { update_id: 7, message: "SYNTHETIC_PERSONAL_CANARY".repeat(5000) },
    413,
  ],
])(
  "keeps %s out of responses and actual logger",
  async (_name, payload, status) => {
    const f = await build();
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/synthetic-route-key?note=SYNTHETIC_PERSONAL_CANARY",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "synthetic-webhook-secret",
        "x-correlation-id": "SYNTHETIC_PERSONAL_CANARY",
      },
      payload,
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({
      error: status === 413 ? "payload_too_large" : "invalid_update",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.logs.length).toBeGreaterThan(0);
    expect(f.logs.join("")).not.toContain("SYNTHETIC_PERSONAL_CANARY");
    expect(f.logs.join("")).not.toContain('"stack"');
    expect(f.navigation).not.toHaveBeenCalled();
  },
);
it("authenticates before malformed or oversized content is parsed", async () => {
  const f = await build();
  for (const payload of [
    "SYNTHETIC_PERSONAL_CANARY",
    "SYNTHETIC_PERSONAL_CANARY".repeat(5000),
  ]) {
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/client/synthetic-route-key",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(f.logs.join("")).not.toContain("SYNTHETIC_PERSONAL_CANARY");
  expect(f.navigation).not.toHaveBeenCalled();
});
