import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { telegramWebhookRoutes } from "./telegram-webhook.js";
const disabledClient = {
  clientIngressEnabled: false,
  clientHybridRoutingEnabled: false,
  clientBotKey: undefined,
  clientGateway: undefined,
};
const secret = "synthetic_work_secret_123456789012";
const base = {
  update_id: 20,
  message: {
    from: { id: 33 },
    chat: { id: 33, type: "private" },
    text: "private-raw-answer",
  },
};
async function fixture(enabled = true) {
  const app = Fastify({ logger: false });
  const legacyRead = vi.fn<
    (input: {
      botId: string;
      updateId: string;
    }) => Promise<"absent" | "complete" | "pending">
  >(async () => "absent");
  const handleWork = vi.fn<
      (input: unknown) => Promise<{ status: "handled"; text: string }>
    >(async () => ({
      status: "handled" as const,
      text: "Ответ сохранён",
    })),
    claim = vi.fn(async () => ({ kind: "claimed" as const, claimId: "claim" })),
    process = vi.fn(async () => {});
  await app.register(telegramWebhookRoutes, {
    ...disabledClient,
    secret,
    rateLimiter: { consume: () => true },
    inbox: { claim, complete: async () => {}, fail: async () => {} },
    callbacks: {
      isAuthorizedIdentity: async () => true,
      verifyCallback: async () => true,
      process,
    },
    expertCardEnabled: enabled,
    expertCard: {
      workBotId: "11",
      workBotKey: "work",
      webhookSecret: secret,
      service: { handleWork },
      legacyReplay: { read: legacyRead },
    },
  });
  return { app, handleWork, claim, process, legacyRead };
}
const send = (
  f: Awaited<ReturnType<typeof fixture>>,
  payload: Record<string, unknown>,
  header = secret,
) =>
  f.app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram",
    headers: { "x-telegram-bot-api-secret-token": header },
    payload,
  });
it("actual secret-authenticated work route intercepts private interview without generic replay claims", async () => {
  const f = await fixture();
  const r = await send(f, base);
  expect(r.statusCode).toBe(200);
  expect(r.json()).toMatchObject({
    method: "sendMessage",
    chat_id: "33",
    text: "Ответ сохранён",
    protect_content: true,
  });
  expect(f.handleWork).toHaveBeenCalledWith(
    expect.objectContaining({
      botId: "11",
      botKey: "work",
      telegramUserId: "33",
      chatId: "33",
      updateId: "20",
      content: { kind: "text", text: "private-raw-answer" },
      requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    }),
  );
  expect(f.claim).not.toHaveBeenCalled();
  expect(f.process).not.toHaveBeenCalled();
  await f.app.close();
});
it.each(["20", 1.5, 9007199254740992, -1, null])(
  "rejects raw malformed update ID %j before AJV coercion",
  async (update_id) => {
    const f = await fixture();
    const r = await send(f, { ...base, update_id });
    expect(r.statusCode).toBe(400);
    expect(f.handleWork).not.toHaveBeenCalled();
    expect(f.claim).not.toHaveBeenCalled();
    await f.app.close();
  },
);
it("does not touch interview storage before webhook authentication", async () => {
  const f = await fixture();
  expect((await send(f, base, "wrong")).statusCode).toBe(401);
  expect(f.handleWork).not.toHaveBeenCalled();
  await f.app.close();
});
it.each(["photo", "document"])(
  "extracts only opaque %s reference and trusted scope",
  async (kind) => {
    const f = await fixture();
    const message = {
      from: base.message.from,
      chat: base.message.chat,
      [kind]:
        kind === "photo"
          ? [{ file_id: "synthetic_small" }, { file_id: "synthetic_large" }]
          : { file_id: "synthetic_doc", file_name: "private-name" },
      caption: "/promo_proof 2",
      botId: "evil",
      botKey: "evil",
    };
    const r = await send(f, { update_id: 21, message });
    expect(r.statusCode).toBe(200);
    const event = f.handleWork.mock.calls[0]![0];
    expect(event).toMatchObject({
      botId: "11",
      botKey: "work",
      content: {
        kind,
        reference: `telegram:file:${kind === "photo" ? "synthetic_large" : "synthetic_doc"}`,
        caption: "/promo_proof 2",
      },
    });
    expect(JSON.stringify(event)).not.toContain("private-name");
    expect(JSON.stringify(event)).not.toContain("evil");
    await f.app.close();
  },
);
it("preserves legacy callback processing without invoking card ingress", async () => {
  const f = await fixture();
  const r = await send(f, {
    update_id: 22,
    callback_query: {
      id: "synthetic-callback",
      from: { id: 33 },
      data: "other",
      message: { chat: { id: 33, type: "private" } },
    },
  });
  expect(r.statusCode).toBe(200);
  expect(f.handleWork).not.toHaveBeenCalled();
  expect(f.process).toHaveBeenCalled();
  await f.app.close();
});
it("unhandled active expert command continues through legacy route", async () => {
  const f = await fixture();
  f.handleWork.mockResolvedValueOnce({ status: "unhandled" } as never);
  const r = await send(f, {
    ...base,
    message: { ...base.message, text: "/help" },
  });
  expect(r.statusCode).toBe(200);
  expect(f.process).toHaveBeenCalled();
  await f.app.close();
});
it("fixed failures cannot expose private input or service error", async () => {
  const f = await fixture();
  f.handleWork.mockRejectedValueOnce(new Error("private-raw-secret"));
  const r = await send(f, base);
  expect(r.statusCode).toBe(503);
  expect(r.body).not.toContain("private");
  expect(f.claim).not.toHaveBeenCalled();
  await f.app.close();
});
it("disabled C preserves legacy raw string update behavior", async () => {
  const f = await fixture(false);
  const r = await send(f, { ...base, update_id: "20" });
  expect(r.statusCode).toBe(200);
  expect(f.handleWork).not.toHaveBeenCalled();
  expect(f.process).toHaveBeenCalled();
  await f.app.close();
});
it("fails enabled route startup without a complete interview service", async () => {
  const app = Fastify({ logger: false });
  await expect(
    app.register(telegramWebhookRoutes, {
      ...disabledClient,
      secret,
      rateLimiter: { consume: () => true },
      inbox: {
        claim: async () => ({ kind: "duplicate" as const }),
        complete: async () => {},
        fail: async () => {},
      },
      callbacks: {
        isAuthorizedIdentity: async () => true,
        verifyCallback: async () => true,
        process: async () => {},
      },
      expertCardEnabled: true,
      expertCard: {
        workBotId: "11",
        workBotKey: "work",
        webhookSecret: secret,
        legacyReplay: { read: async () => "absent" as const },
        service: {},
      } as never,
    }),
  ).rejects.toThrow("expert_card_capability_required");
  await app.close();
});
it.each([
  { ...base.message, chat: { id: 33, type: "group" } },
  { ...base.message, from: { id: 33, is_bot: "false" } },
])(
  "rejects malformed/private-scope evidence before card mutations",
  async (message) => {
    const f = await fixture();
    const r = await send(f, { ...base, message });
    expect(r.statusCode).toBe(400);
    expect(f.handleWork).not.toHaveBeenCalled();
    expect(f.claim).not.toHaveBeenCalled();
    await f.app.close();
  },
);
it("preserves the existing authenticated /schedule query and its single legacy receipt", async () => {
  const app = Fastify({ logger: false });
  const claim = vi.fn(async () => ({
    kind: "claimed" as const,
    claimId: "legacy-query",
  }));
  const processCommand = vi.fn(async () => ({ kind: "processed" as const }));
  await app.register(telegramWebhookRoutes, {
    ...disabledClient,
    secret,
    rateLimiter: {
      consume: (key: string) => !key.startsWith("telegram:expert-card:"),
    },
    inbox: { claim, complete: async () => {}, fail: async () => {} },
    callbacks: {
      isAuthorizedIdentity: async () => true,
      verifyCallback: async () => true,
      process: async () => {},
    },
    expertCardEnabled: true,
    expertCard: {
      workBotId: "11",
      workBotKey: "work",
      webhookSecret: secret,
      service: { handleWork: async () => ({ status: "unhandled" as const }) },
      legacyReplay: { read: async () => "absent" as const },
    },
    expertQueriesEnabled: true,
    expertQueries: {
      resolvePrincipal: async () => ({
        userId: "u",
        expertId: "e",
        telegramUserId: "33",
        timezone: "UTC",
      }),
      processCommand,
    } as never,
  });
  const r = await app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram",
    headers: { "x-telegram-bot-api-secret-token": secret },
    payload: { ...base, message: { ...base.message, text: "/schedule" } },
  });
  expect(r.statusCode).toBe(200);
  expect(processCommand).toHaveBeenCalledOnce();
  expect(claim).toHaveBeenCalledExactlyOnceWith("telegram", "20");
  await app.close();
});

it("fences an old completed work update before C mutation with no fresh generic claim", async () => {
  const f = await fixture();
  f.legacyRead.mockResolvedValueOnce("complete");
  const r = await send(f, base);
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ accepted: true, duplicate: true });
  expect(f.handleWork).not.toHaveBeenCalled();
  expect(f.claim).not.toHaveBeenCalled();
  await f.app.close();
});
it("keeps an old in-flight work receipt retryable before C mutation", async () => {
  const f = await fixture();
  f.legacyRead.mockResolvedValueOnce("pending");
  expect((await send(f, base)).statusCode).toBe(503);
  expect(f.handleWork).not.toHaveBeenCalled();
  expect(f.claim).not.toHaveBeenCalled();
  await f.app.close();
});
it("fails closed if old work receipt lookup is unavailable", async () => {
  const f = await fixture();
  f.legacyRead.mockRejectedValueOnce(new Error("private-error"));
  expect((await send(f, base)).statusCode).toBe(503);
  expect(f.handleWork).not.toHaveBeenCalled();
  await f.app.close();
});
