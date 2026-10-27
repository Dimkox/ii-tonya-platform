import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import { createLogger } from "@ii-tonya/observability";
import { loadEnv } from "../../packages/config/src/env.js";
import { buildApp } from "../../apps/api/src/app.js";
import { createDefaultLifecycle } from "../../apps/api/src/server.js";

const canary = "ordinary_private_appointment_details";
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture(
  options: { serviceFailure?: boolean; booking?: boolean } = {},
) {
  const config = loadEnv({
    DATABASE_URL: "postgresql://localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    CLIENT_TELEGRAM_NAVIGATION_ENABLED: "true",
    CLIENT_WEB_ORIGIN: "https://client.example",
    CLIENT_TELEGRAM_BOT_KEY: "synthetic-key",
    TELEGRAM_WEBHOOK_SECRET: "synthetic-secret-".repeat(3),
    TELEGRAM_BOT_TOKEN: `123456:${"a".repeat(35)}`,
  });
  const deps = await createDefaultLifecycle().dependencies(
    config,
    {} as DrizzleDb,
  );
  const logs: string[] = [];
  const sink = new PassThrough();
  sink.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  deps.logger = createLogger(sink);
  const navigation = vi.fn(async () => ({ status: "unavailable" as const }));
  deps.clientNavigationGateway = { handle: navigation };
  config.features.clientSession = true;
  config.features.clientCatalog = true;
  config.features.clientBooking = options.booking === true;
  if (options.booking) {
    config.features.clientTelegramNavigation = false;
    config.features.workerOutboxDelivery = true;
  }
  const issue = vi.fn(async () => ({ kind: "unauthorized" as const }));
  deps.clientSessionService = { issue };
  deps.clientSessionRepository = { revoke: async () => ({ kind: "denied" }) };
  deps.clientPrincipal = { resolve: async () => ({ kind: "denied" }) };
  deps.clientBookingPrincipal = deps.clientPrincipal;
  deps.clientCatalogService = {
    request: vi.fn(),
    choices: vi.fn(),
  } as unknown as NonNullable<typeof deps.clientCatalogService>;
  deps.clientBookingService = {
    reserve: vi.fn(),
    cancel: vi.fn(),
    reschedule: vi.fn(async () => {
      throw new Error("unexpected_reschedule");
    }),
    list: vi.fn(),
  };
  const handleInbound = vi.fn<typeof deps.conversationService.handleInbound>(
    async () => {
      if (options.serviceFailure)
        throw Object.assign(new Error(canary, { cause: canary }), {
          code: "ECONNREFUSED",
        });
      return { kind: "duplicate" as const, chargedMessages: 0 as const };
    },
  );
  deps.conversationService = { ...deps.conversationService, handleInbound };
  const decodeVerifiedWebhook = vi.fn<
    typeof deps.selarti.decodeVerifiedWebhook
  >(async () => ({
    kind: "inbound_message" as const,
    providerEventId: canary,
    providerMessageId: canary,
    channelUserId: canary,
    text: canary,
    occurredAt: new Date().toISOString(),
  }));
  deps.selarti = { ...deps.selarti, decodeVerifiedWebhook };
  const app = await buildApp(deps);
  apps.push(app);
  return { app, logs, navigation, handleInbound, decodeVerifiedWebhook, issue };
}
async function emitted(logs: string[]) {
  await new Promise<void>((resolve) => setImmediate(resolve));
  return logs.join("");
}

it("never echoes unknown URL paths, query values, headers or caller request IDs", async () => {
  const f = await fixture();
  const response = await f.app.inject({
    url: `/${canary}?${canary}=${canary}`,
    headers: {
      "x-request-id": canary,
      "x-correlation-id": canary,
      authorization: canary,
    },
  });
  expect(response.statusCode).toBe(404);
  expect(response.body).not.toContain(canary);
  const logs = await emitted(f.logs);
  expect(logs).not.toContain(canary);
  expect(logs).toContain('"event":"http_request_completed"');
  expect(logs).toContain('"statusCode":404');
  expect(logs).not.toContain('"reqId"');
});

it("never echoes malformed paths or unknown validation fields", async () => {
  const f = await fixture();
  f.app.post(
    "/telemetry-validation",
    { schema: { body: { type: "object", additionalProperties: false } } },
    async () => ({ ok: true }),
  );
  const malformed = await f.app.inject({
    url: `/v1/webhooks/telegram/client/${canary}%world`,
  });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.body).not.toContain(canary);
  const invalid = await f.app.inject({
    method: "POST",
    url: "/telemetry-validation",
    payload: { [canary]: canary },
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.body).not.toContain(canary);
  expect(await emitted(f.logs)).not.toContain(canary);
});

it("preserves encapsulated body limits and fixed malformed JSON responses", async () => {
  const f = await fixture({ booking: true });
  for (const [url, size, status] of [
    ["/v1/client/sessions", 9_000, 400],
    ["/v1/client/bookings", 2_000, 400],
    ["/v1/webhooks/telegram", 65_000, 413],
    ["/v1/webhooks/selarti", 65_000, 413],
  ] as const) {
    const response = await f.app.inject({
      method: "POST",
      url,
      headers: {
        "x-telegram-bot-api-secret-token": "synthetic-secret-".repeat(3),
      },
      payload: { [canary]: canary.repeat(size) },
    });
    expect(response.statusCode, url).toBe(status);
    expect(response.body).not.toContain(canary);
  }
  const malformed = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/selarti",
    headers: { "content-type": "application/json" },
    payload: `{"${canary}":`,
  });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.body).not.toContain(canary);
  expect(f.decodeVerifiedWebhook).not.toHaveBeenCalled();
  expect(f.issue).not.toHaveBeenCalled();
  expect(await emitted(f.logs)).not.toContain(canary);
});

it("keeps unauthenticated navigation out of the gateway and records only fixed HTTP facts", async () => {
  const f = await fixture();
  const response = await f.app.inject({
    method: "POST",
    url: `/v1/webhooks/telegram/client/synthetic-key?${canary}`,
    headers: { "x-telegram-bot-api-secret-token": canary },
    payload: { update_id: 7, message: { text: canary } },
  });
  expect(response.statusCode).toBe(401);
  expect(response.body).not.toContain(canary);
  expect(f.navigation).not.toHaveBeenCalled();
  const logs = await emitted(f.logs);
  expect(logs).not.toContain(canary);
  expect(logs).toContain('"statusCode":401');
});

it.each([false, true])(
  "Selarti keeps business correlation/raw bytes while telemetry and failure replies stay content free (failure=%s)",
  async (serviceFailure) => {
    const f = await fixture({ serviceFailure });
    const payload = JSON.stringify({ detail: canary });
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": canary,
      },
      payload,
    });
    expect(response.statusCode).toBe(serviceFailure ? 500 : 200);
    expect(response.body).not.toContain(canary);
    expect(f.handleInbound).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        correlationId: canary,
        providerEventId: canary,
        text: canary,
      }),
    );
    expect(f.decodeVerifiedWebhook.mock.calls[0]?.[0]).toEqual(
      Buffer.from(payload),
    );
    const logs = await emitted(f.logs);
    expect(logs).not.toContain(canary);
    expect(logs).not.toContain("eventIdHash");
    expect(logs).toContain(
      serviceFailure
        ? '"failureClass":"connection_refused"'
        : '"event":"selarti_inbound"',
    );
  },
);

it.each([
  [401, {}, 401],
  [429, {}, 429],
  [200, { status: 422 }, 422],
  [401, { statusCode: 503 }, 503],
  [429, { status: 422, statusCode: 503 }, 422],
] as const)(
  "preserves Fastify error status precedence (%s, %j)",
  async (selected, fields, expected) => {
    const f = await fixture();
    f.app.get("/protocol", async (_request, reply) => {
      reply.code(selected);
      throw Object.assign(new Error(canary), fields);
    });
    const response = await f.app.inject("/protocol");
    expect(response.statusCode).toBe(expected);
    expect(response.body).not.toContain(canary);
  },
);

it.each([
  3,
  "60",
  0,
  "86400",
  -1,
  86_401,
  "https://private.example/" + canary,
  "3\r\nx-private: " + canary,
  { toString: () => canary },
])("copies only bounded delta-seconds Retry-After (%j)", async (retryAfter) => {
  const f = await fixture();
  f.app.get("/limited", async () => {
    throw Object.assign(new Error(canary), {
      statusCode: 429,
      headers: {
        "retry-after": retryAfter,
        location: `https://private.example/${canary}`,
        "x-private": canary,
      },
    });
  });
  const response = await f.app.inject("/limited");
  expect(response.statusCode).toBe(429);
  const valid = [3, "60", 0, "86400"].includes(retryAfter as number | string);
  expect(response.headers["retry-after"]).toBe(
    valid ? String(retryAfter) : undefined,
  );
  expect(response.headers.location).toBeUndefined();
  expect(response.headers["x-private"]).toBeUndefined();
  expect(
    response.body + JSON.stringify(response.headers) + (await emitted(f.logs)),
  ).not.toContain(canary);
});

it("classifies real router constraint failures as internal errors", async () => {
  const f = await fixture();
  f.app.addConstraintStrategy({
    name: "synthetic",
    storage: () => ({ get: () => null, set: () => undefined }),
    // find-my-way detects async strategies by arity=3; its types omit that overload.
    deriveConstraint: (
      _request: unknown,
      _context: unknown,
      done?: (error: Error) => void,
    ) => {
      done?.(new Error(canary));
    },
    validate: () => true,
  });
  f.app.get(
    "/constraint",
    { constraints: { synthetic: "present" } },
    async () => ({ ok: true }),
  );
  const response = await f.app.inject("/constraint");
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: "internal_error" });
  const logs = await emitted(f.logs);
  expect(logs).toContain('"failureClass":"internal_error"');
  expect(logs).not.toContain(canary);
});

it.each([false, true])(
  "does not leak through the parent fallback when onSend throws (logger fails=%s)",
  async (loggerFails) => {
    const f = await fixture();
    const onError = vi.fn();
    f.app.addHook("onError", async () => {
      onError();
    });
    f.app.addHook("onSend", async () => {
      throw new Error(canary);
    });
    f.app.get("/fallback", async (request, reply) => {
      if (loggerFails)
        request.log.error = request.log.info = () => {
          throw new Error(canary);
        };
      reply.header("www-authenticate", "Bearer");
      reply.header("retry-after", "7");
      reply.header("set-cookie", [
        "synthetic=1; HttpOnly",
        "synthetic2=1; Secure",
      ]);
      reply.code(401);
      throw new Error(canary);
    });
    const response = await f.app.inject("/fallback");
    expect(response.body).not.toContain(canary);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_request" });
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.headers["retry-after"]).toBe("7");
    expect(response.headers["set-cookie"]).toEqual([
      "synthetic=1; HttpOnly",
      "synthetic2=1; Secure",
    ]);
    expect(Number(response.headers["content-length"])).toBe(
      Buffer.byteLength(response.body),
    );
    expect(onError).toHaveBeenCalled();
    expect(await emitted(f.logs)).not.toContain(canary);
  },
);

it("contains a failing onSend on a normal response, retaining error hooks and completion", async () => {
  const f = await fixture();
  const onSend = vi.fn(async () => {
    throw new Error(canary);
  });
  const onError = vi.fn();
  f.app.addHook("onSend", onSend);
  f.app.addHook("onError", async () => {
    onError();
  });
  f.app.get("/send-failure", async () => ({ ok: true }));
  const response = await f.app.inject("/send-failure");
  expect(response.json()).toEqual({ error: "internal_error" });
  expect(response.statusCode).toBe(500);
  expect(onSend).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalled();
  const logs = await emitted(f.logs);
  expect(logs).not.toContain(canary);
  expect(logs).toContain('"event":"http_request_completed"');
});

it("retains encapsulated body-limit status when a local error response's onSend also fails", async () => {
  const f = await fixture({ booking: true });
  const onSend = vi.fn(async () => {
    throw new Error(canary);
  });
  f.app.addHook("onSend", onSend);
  for (const [url, size, status] of [
    ["/v1/client/sessions", 9_000, 400],
    ["/v1/client/bookings", 2_000, 400],
    ["/v1/webhooks/telegram", 65_000, 413],
  ] as const) {
    const response = await f.app.inject({
      method: "POST",
      url,
      headers: {
        "x-telegram-bot-api-secret-token": "synthetic-secret-".repeat(3),
      },
      payload: { detail: canary.repeat(size) },
    });
    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain(canary);
  }
  expect(f.issue).not.toHaveBeenCalled();
  expect(onSend).toHaveBeenCalledTimes(3);
  expect(await emitted(f.logs)).not.toContain(canary);
});

it("keeps authentication denial and HEAD framing with the terminal boundary", async () => {
  const f = await fixture();
  f.app.addHook("onSend", async () => {
    throw new Error(canary);
  });
  f.app.get("/head-error", async () => {
    throw new Error(canary);
  });
  const denied = await f.app.inject({
    method: "POST",
    url: "/v1/webhooks/telegram/client/synthetic-key",
    headers: { "x-telegram-bot-api-secret-token": canary },
    payload: { update_id: 7, message: { text: canary } },
  });
  // This route's existing local error handler explicitly maps onSend failure
  // to 503 before escalating to the root. Authentication still never reaches work.
  expect(denied.statusCode).toBe(503);
  expect(denied.body).not.toContain(canary);
  expect(f.navigation).not.toHaveBeenCalled();
  const head = await f.app.inject({ method: "HEAD", url: "/head-error" });
  expect(head.statusCode).toBe(500);
  expect(head.body).toBe("");
  expect(await emitted(f.logs)).not.toContain(canary);
});

it("honors composed route silent for completion and failure while ordinary routes log", async () => {
  const f = await fixture();
  f.app.get("/silent", { logLevel: "silent" }, async () => ({ ok: true }));
  f.app.get("/silent-error", { logLevel: "silent" }, async () => {
    throw new Error(canary);
  });
  f.app.get("/ordinary", async () => ({ ok: true }));
  expect((await f.app.inject("/silent")).statusCode).toBe(200);
  expect((await f.app.inject("/silent-error")).statusCode).toBe(500);
  expect(await emitted(f.logs)).toBe("");
  expect((await f.app.inject("/ordinary")).statusCode).toBe(200);
  expect(JSON.parse(await emitted(f.logs))).toMatchObject({
    event: "http_request_completed",
    statusCode: 200,
  });
});
