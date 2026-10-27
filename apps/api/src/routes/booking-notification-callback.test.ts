import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { issueCallback } from "../../../../packages/integrations/src/telegram/callback-token.js";
import {
  createBookingCallbackService,
  type ScopedBookingDecision,
} from "../booking-callback-service.js";
import { telegramWebhookRoutes } from "./telegram-webhook.js";
import type { WebhookInbox } from "./selarti-webhook.js";

const secret = new Uint8Array(32).fill(17);
const linked = {
  deliveryId: "11111111-1111-4111-8111-111111111111",
  reservationId: "22222222-2222-4222-8222-222222222222",
  expertId: "33333333-3333-4333-8333-333333333333",
  action: "confirm" as const,
  version: 1,
};
const claims = {
  reservationId: linked.reservationId,
  expertId: linked.expertId,
  action: "confirm" as const,
  version: 1,
  expiresAtEpochSeconds: 1,
};
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture(
  options: {
    action?: "confirm" | "cancel";
    inboxKind?: "claimed" | "duplicate" | "busy";
    completeFails?: boolean;
    transactionFails?: boolean;
    ackFails?: boolean;
    ackStalls?: boolean;
    enabled?: boolean;
    lookupMissing?: boolean;
  } = {},
) {
  let storedHash = "";
  let ackSignal: AbortSignal | undefined;
  const token = await issueCallback(claims, secret, {
    async put(hash) {
      storedHash = hash;
    },
    async peek() {
      return null;
    },
    async consumeIfValid() {
      return null;
    },
  });
  const calls = {
    lookup: 0,
    actions: [] as string[],
    commands: [] as ScopedBookingDecision[],
    events: [] as string[],
    complete: 0,
    fail: 0,
    ack: 0,
    mutation: 0,
    legacy: 0,
    navigation: 0,
  };
  const inbox: WebhookInbox = {
    async claim(_provider, event) {
      calls.events.push(event);
      return options.inboxKind && options.inboxKind !== "claimed"
        ? { kind: options.inboxKind }
        : { kind: "claimed", claimId: "claim" };
    },
    async complete() {
      calls.complete++;
      if (options.completeFails) throw new Error("syntheticDB");
    },
    async fail() {
      calls.fail++;
    },
  };
  const decide = async (
    action: string,
    command: ScopedBookingDecision,
  ): Promise<{ replayed?: true }> => {
    calls.actions.push(action);
    calls.commands.push(command);
    if (options.transactionFails) throw new Error("syntheticDB");
    if (calls.mutation) return { replayed: true };
    calls.mutation++;
    return {};
  };
  const service = createBookingCallbackService({
    botKey: "client",
    secret,
    inbox,
    repository: {
      async findLinkedCallback(hash) {
        calls.lookup++;
        return hash === storedHash && !options.lookupMissing
          ? { ...linked, action: options.action ?? "confirm" }
          : null;
      },
    },
    bookings: {
      confirmByExpert: (c) => decide("confirm", c),
      cancelByExpert: (c) => decide("cancel", c),
    },
    async acknowledge({ signal }) {
      ackSignal = signal;
      calls.ack++;
      if (options.ackFails) throw new Error("syntheticACK");
      if (options.ackStalls) await new Promise<void>(() => {});
    },
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(telegramWebhookRoutes, {
    secret: "webhook-secret",
    callbacks: {
      async isAuthorizedIdentity() {
        calls.legacy++;
        return false;
      },
      async verifyCallback() {
        return false;
      },
      async process() {
        calls.legacy++;
      },
    },
    inbox,
    rateLimiter: { consume: () => true },
    clientBotKey: "client",
    clientIngressEnabled: false,
    clientHybridRoutingEnabled: false,
    clientGateway: undefined,
    clientNavigationEnabled: true,
    clientNavigationGateway: {
      async handle() {
        calls.navigation++;
        return { status: "ignored" as const };
      },
    },
    bookingCallbacksEnabled: options.enabled ?? true,
    bookingCallbacks: service,
  } as Parameters<typeof telegramWebhookRoutes>[1]);
  const update = () => ({
    update_id: 7,
    callback_query: {
      id: "query-7",
      from: { id: 201 },
      data: token,
      message: { message_id: 77, chat: { id: 201, type: "private" } },
    },
  });
  const send = (
    payload: unknown = update(),
    url = "/v1/webhooks/telegram/client/client",
    header = "webhook-secret",
  ) =>
    app.inject({
      method: "POST",
      url,
      headers: { "x-telegram-bot-api-secret-token": header },
      payload: payload as object,
    });
  return {
    app,
    service,
    calls,
    update,
    send,
    token,
    storedHash,
    getAckSignal: () => ackSignal,
  };
}

it.each([
  ["/v1/webhooks/telegram/client/client", false],
  ["/v1/webhooks/telegram/client/client", true],
  ["/v1/webhooks/telegram", false],
  ["/v1/webhooks/telegram", true],
] as const)(
  "authenticates malformed JSON before parsing on %s (header=%s)",
  async (url, withHeader) => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "POST",
      url,
      headers: {
        "content-type": "application/json",
        ...(withHeader ? { "x-telegram-bot-api-secret-token": "wrong" } : {}),
      },
      payload: "{",
    });
    expect(response.statusCode).toBe(401);
    expect(f.calls.lookup).toBe(0);
    expect(f.calls.events).toHaveLength(0);
    expect(f.calls.legacy).toBe(0);
    expect(f.calls.navigation).toBe(0);
  },
);

it("rejects a canonical token with a corrupted authentication tag before lookup", async () => {
  const f = await fixture();
  const bytes = Buffer.from(f.token.slice(4), "base64url");
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  const update = f.update();
  update.callback_query.data = `ct2.${bytes.toString("base64url")}`;
  expect((await f.send(update)).statusCode).toBe(403);
  expect(f.calls.lookup).toBe(0);
  expect(f.calls.events).toHaveLength(0);
});

it("bounds a stalled ACK and aborts its signal without repeating the transaction", async () => {
  const f = await fixture({ ackStalls: true });
  vi.useFakeTimers();
  let settled = false;
  const result = f.service
    .handle(f.update(), "client", "test-correlation")
    .then((value) => {
      settled = true;
      return value;
    });
  await vi.advanceTimersByTimeAsync(2999);
  expect(f.calls.ack).toBe(1);
  expect(settled).toBe(false);
  expect(f.getAckSignal()?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ kind: "processed" });
  expect(f.getAckSignal()?.aborted).toBe(true);
  expect(f.calls.actions).toHaveLength(1);
  expect(f.calls.complete).toBe(1);
});

it.each(["/v1/webhooks/telegram/client/client", "/v1/webhooks/telegram"])(
  "routes ct2 through booking before navigation/legacy on%s",
  async (url) => {
    const f = await fixture();
    const response = await f.send(f.update(), url);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ accepted: true, route: "booking" });
    expect(f.calls.actions).toEqual(["confirm"]);
    expect(f.calls.legacy).toBe(0);
    expect(f.calls.navigation).toBe(0);
    expect(f.calls.commands[0]).toMatchObject({
      callbackTokenHash: f.storedHash,
      expectedVersion: 1,
      telegramContext: {
        botKey: "client",
        telegramUserId: "201",
        chatId: "201",
        messageId: 77,
        deliveryId: linked.deliveryId,
      },
    });
    expect(f.calls.events).toEqual(["booking:client:7"]);
    expect(f.calls.complete).toBe(1);
    expect(f.calls.ack).toBe(1);
  },
);
it("selects cancellation from stored action, not arbitrary update fields", async () => {
  const f = await fixture({ action: "cancel" });
  expect((await f.send()).statusCode).toBe(200);
  expect(f.calls.actions).toEqual(["cancel"]);
});
it("does not process missing/invalid webhook credentials", async () => {
  const f = await fixture();
  expect((await f.send(f.update(), undefined, "wrong")).statusCode).toBe(401);
  expect(f.calls.lookup).toBe(0);
  expect(f.calls.mutation).toBe(0);
});
it("does not send disabled booking tokens to legacy or navigation", async () => {
  const f = await fixture({ enabled: false });
  expect((await f.send()).json()).toMatchObject({
    accepted: true,
    unsupported: true,
  });
  expect(f.calls.legacy).toBe(0);
  expect(f.calls.navigation).toBe(0);
  expect(f.calls.lookup).toBe(0);
});
it.each([
  "group",
  "wrong_chat",
  "missing_message",
  "unsafe_id",
  "string_id",
  "zero_message",
  "invalid_token",
  "invalid_query",
])("rejects%s before DB and inbox", async (kind) => {
  const f = await fixture();
  const u: {
    update_id: number;
    callback_query: {
      id: string;
      from: { id: number | string };
      data: string;
      message?: { message_id: number; chat: { id: number; type: string } };
    };
  } = f.update();
  const message = u.callback_query.message!;
  if (kind === "group") message.chat.type = "group";
  if (kind === "wrong_chat") message.chat.id = 202;
  if (kind === "missing_message") delete u.callback_query.message;
  if (kind === "unsafe_id") u.callback_query.from.id = 9007199254740992;
  if (kind === "string_id") u.callback_query.from.id = "201";
  if (kind === "zero_message") message.message_id = 0;
  if (kind === "invalid_token") u.callback_query.data = "ct2." + "a".repeat(44);
  if (kind === "invalid_query") u.callback_query.id = "bad\n";
  expect((await f.send(u)).statusCode).toBe(403);
  expect(f.calls.lookup).toBe(0);
  expect(f.calls.events).toHaveLength(0);
});
it("rejects unlinked valid token", async () => {
  const f = await fixture({ lookupMissing: true });
  expect((await f.send()).statusCode).toBe(403);
  expect(f.calls.mutation).toBe(0);
});
it("revalidates a duplicate through the booking transaction", async () => {
  const f = await fixture({ inboxKind: "duplicate" });
  await f.send();
  const response = await f.send();
  expect(response.json()).toMatchObject({ duplicate: true });
  expect(f.calls.actions).toHaveLength(2);
  expect(f.calls.mutation).toBe(1);
  expect(f.calls.complete).toBe(0);
});
it("busy inbox retries without transition", async () => {
  const f = await fixture({ inboxKind: "busy" });
  expect((await f.send()).statusCode).toBe(503);
  expect(f.calls.mutation).toBe(0);
});
it("lost inbox completion retries the committed action without another mutation", async () => {
  const f = await fixture({ completeFails: true });
  expect((await f.send()).statusCode).toBe(503);
  expect((await f.send()).statusCode).toBe(503);
  expect(f.calls.mutation).toBe(1);
  expect(f.calls.fail).toBe(2);
});
it("transaction failure releases inbox for retry without ACK", async () => {
  const f = await fixture({ transactionFails: true });
  expect((await f.send()).statusCode).toBe(503);
  expect(f.calls.fail).toBe(1);
  expect(f.calls.ack).toBe(0);
});
it("ACK failure does not rerun transition or undo inbox", async () => {
  const f = await fixture({ ackFails: true });
  expect((await f.send()).statusCode).toBe(200);
  expect(f.calls.actions).toHaveLength(1);
  expect(f.calls.complete).toBe(1);
});
