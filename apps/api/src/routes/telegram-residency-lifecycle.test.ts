import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { telegramWebhookRoutes } from "./telegram-webhook.js";
const secret = "synthetic_work_secret_123456789012",
  scope = { workBotId: "11", workBotKey: "work", webhookSecret: secret };
const update = {
  update_id: 20,
  message: {
    from: { id: 33 },
    chat: { id: 33, type: "private" },
    text: "/residency",
  },
};
async function fixture(d = true, c = false) {
  const app = Fastify({ logger: false });
  const dHandle = vi.fn<
      (input: unknown) => Promise<{ status: "handled"; text: string }>
    >(async () => ({ status: "handled", text: "Статус актуален" })),
    cHandle = vi.fn<
      (input: unknown) => Promise<{ status: "handled"; text: string }>
    >(async () => ({ status: "handled", text: "Карточка" }));
  const read = vi.fn<
      (input: {
        botId: string;
        updateId: string;
      }) => Promise<"absent" | "complete" | "pending">
    >(async () => "absent"),
    claim = vi.fn(async () => ({
      kind: "claimed" as const,
      claimId: "legacy",
    })),
    process = vi.fn(async () => {});
  await app.register(telegramWebhookRoutes, {
    secret,
    clientIngressEnabled: false,
    clientHybridRoutingEnabled: false,
    clientBotKey: undefined,
    clientGateway: undefined,
    rateLimiter: { consume: () => true },
    inbox: { claim, complete: async () => {}, fail: async () => {} },
    callbacks: {
      isAuthorizedIdentity: async () => true,
      verifyCallback: async () => true,
      process,
    },
    expertCardEnabled: c,
    expertCard: {
      ...scope,
      legacyReplay: { read },
      service: { handleWork: cHandle },
    },
    expertResidencyLifecycleEnabled: d,
    expertResidencyLifecycle: {
      ...scope,
      legacyReplay: { read },
      service: { handleWork: dHandle },
    },
  });
  return { app, dHandle, cHandle, read, claim, process };
}
const send = (
  f: Awaited<ReturnType<typeof fixture>>,
  body: Record<string, unknown> = update,
) =>
  f.app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram",
    headers: { "x-telegram-bot-api-secret-token": secret },
    payload: body,
  });
it("actual trusted work route retains D owner commands with C admission off", async () => {
  const f = await fixture();
  const r = await send(f);
  expect(r.statusCode).toBe(200);
  expect(r.json()).toMatchObject({
    method: "sendMessage",
    chat_id: "33",
    text: "Статус актуален",
    protect_content: true,
  });
  expect(f.dHandle).toHaveBeenCalledWith(
    expect.objectContaining({
      botId: "11",
      botKey: "work",
      updateId: "20",
      content: { kind: "text", text: "/residency" },
    }),
  );
  expect(f.cHandle).not.toHaveBeenCalled();
  expect(f.claim).not.toHaveBeenCalled();
  await f.app.close();
});
it("preserves C commands without passing through D mutations", async () => {
  const f = await fixture(true, true);
  expect(
    (
      await send(f, {
        ...update,
        message: { ...update.message, text: "/card" },
      })
    ).statusCode,
  ).toBe(200);
  expect(f.cHandle).toHaveBeenCalledOnce();
  expect(f.dHandle).not.toHaveBeenCalled();
  await f.app.close();
});
it("D off preserves old /residency navigation even while C is enabled", async () => {
  const f = await fixture(false, true);
  expect((await send(f)).statusCode).toBe(200);
  expect(f.dHandle).not.toHaveBeenCalled();
  expect(f.cHandle).not.toHaveBeenCalled();
  await f.app.close();
});
it("ordinary expert queries do not consume a D request", async () => {
  const f = await fixture();
  expect(
    (
      await send(f, {
        ...update,
        message: { ...update.message, text: "/schedule" },
      })
    ).statusCode,
  ).toBe(200);
  expect(f.dHandle).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  await f.app.close();
});
it.each(["20", 1.5, 9007199254740992])(
  "D-only ingress rejects raw unsafe update ID %j before coercion",
  async (update_id) => {
    const f = await fixture();
    expect((await send(f, { ...update, update_id })).statusCode).toBe(400);
    expect(f.dHandle).not.toHaveBeenCalled();
    await f.app.close();
  },
);
it("historical completed work receipt fences D with no fresh legacy claim", async () => {
  const f = await fixture();
  f.read.mockResolvedValueOnce("complete");
  expect((await send(f)).json()).toEqual({ accepted: true, duplicate: true });
  expect(f.dHandle).not.toHaveBeenCalled();
  expect(f.claim).not.toHaveBeenCalled();
  await f.app.close();
});
it("historical pending work receipt keeps D retryable", async () => {
  const f = await fixture();
  f.read.mockResolvedValueOnce("pending");
  expect((await send(f)).statusCode).toBe(503);
  expect(f.dHandle).not.toHaveBeenCalled();
  await f.app.close();
});
it("D callback traffic retains existing private callback authentication", async () => {
  const f = await fixture();
  const r = await send(f, {
    update_id: 21,
    callback_query: {
      id: "cb",
      from: { id: 33 },
      data: "other",
      message: { chat: { id: 33, type: "private" } },
    },
  });
  expect(r.statusCode).toBe(200);
  expect(f.dHandle).not.toHaveBeenCalled();
  expect(f.process).toHaveBeenCalledOnce();
  await f.app.close();
});
it("same-event D replay produces only a duplicate acknowledgment", async () => {
  const f = await fixture();
  f.dHandle.mockResolvedValueOnce({ status: "duplicate" } as never);
  expect((await send(f)).json()).toEqual({ accepted: true, duplicate: true });
  await f.app.close();
});
