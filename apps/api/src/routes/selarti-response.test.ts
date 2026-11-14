import Fastify from "fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SELARTI_ALL_MESSAGES_FIXTURE } from "../../../../packages/config/src/selarti-official-response-fixture.js";
import { createSelartiAllMessagesBridge } from "../../../../packages/application/src/selarti-all-messages-bridge.js";
import { selartiResponseRoutes } from "./selarti-response.js";

const secret = `B2_Response_Shared_Secret_0123456789abcdef`;
const body = {
  version: 1,
  requestId: `sha256:${"a".repeat(64)}`,
  dialogueId: "00000000-0000-4000-8000-000000000501",
  threadId: `sha256:${"a".repeat(64)}`,
  text: "Ответ",
};

const build = async (
  enabled: boolean,
  handle: (raw: unknown) => Promise<{ status: string }>,
) => {
  const app = Fastify({ logger: false });
  await app.register(selartiResponseRoutes, {
    enabled,
    secret,
    responses: { handle },
    rateLimiter: { consume: () => true },
  });
  return app;
};

describe("dedicated Selarti response endpoint", () => {
  const handle = vi.fn(async () => ({ status: "accepted" }));
  let app: Awaited<ReturnType<typeof build>>;
  let disabledApp: Awaited<ReturnType<typeof build>>;

  beforeAll(async () => {
    app = await build(true, handle);
    disabledApp = await build(false, handle);
  });

  beforeEach(() => {
    handle.mockReset();
    handle.mockResolvedValue({ status: "accepted" });
  });

  afterAll(async () => {
    await Promise.all([app.close(), disabledApp.close()]);
  });

  it.each([undefined, "Bearer wrong-secret"])(
    "rejects missing or wrong authentication before service",
    async (authorization) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/webhooks/selarti/responses",
        headers: authorization ? { authorization } : {},
        payload: body,
      });
      expect(response.statusCode).toBe(401);
      expect(handle).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["accepted", 200, { accepted: true }],
    ["duplicate", 200, { accepted: true, duplicate: true }],
    ["rejected", 200, { accepted: true, rejected: true }],
    ["conflict", 200, { accepted: true, rejected: true }],
    ["late", 200, { accepted: true, rejected: true }],
    ["ignored", 200, { accepted: true, ignored: true }],
    ["unavailable", 503, { error: "selarti_response_unavailable" }],
  ])("maps %s to HTTP %s", async (status, expectedCode, expectedBody) => {
    handle.mockResolvedValue({ status });
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti/responses",
      headers: { authorization: `Bearer ${secret}` },
      payload: body,
    });
    expect(response.statusCode).toBe(expectedCode);
    expect(response.json()).toEqual(expectedBody);
  });

  it("keeps the endpoint unavailable while its independent flag is off", async () => {
    const response = await disabledApp.inject({
      method: "POST",
      url: "/v1/webhooks/selarti/responses",
      headers: { authorization: `Bearer ${secret}` },
      payload: body,
    });
    expect(response.statusCode).toBe(503);
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when the transactional service throws", async () => {
    handle.mockRejectedValue(new Error("database unavailable"));
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti/responses",
      headers: { authorization: `Bearer ${secret}` },
      payload: body,
    });
    expect(response.statusCode).toBe(503);
  });
});

describe("Selarti all_messages route", () => {
  const requestId = `sha256:${"c".repeat(64)}`;
  const dialogueId = "00000000-0000-4000-8000-000000000601";
  const inner = vi.fn<(raw: unknown) => Promise<{ status: "accepted" }>>(
    async () => ({ status: "accepted" }),
  );
  const receipts = new Set<string>();
  const ingress = createSelartiAllMessagesBridge({
    taskId: SELARTI_ALL_MESSAGES_FIXTURE.task_id,
    correlation: {
      async findPending() {
        return { kind: "one", requestId, dialogueId };
      },
    },
    receipts: {
      async lookup(messageKey) {
        return receipts.has(messageKey) ? "complete" : "absent";
      },
    },
    responses: {
      async handle(raw, context) {
        if (context?.messageReceiptKey) receipts.add(context.messageReceiptKey);
        return inner(raw);
      },
    },
  });
  let app: Awaited<ReturnType<typeof build>>;

  beforeAll(async () => {
    app = await build(true, (raw) => ingress.handle(raw));
  });
  beforeEach(() => {
    inner.mockClear();
    receipts.clear();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    ["/v1/webhooks/selarti/responses", {}],
    [
      "/v1/webhooks/selarti/responses",
      { authorization: "Bearer wrong-secret" },
    ],
    [
      "/v1/webhooks/selarti/responses?token=wrong-secret-value-0123456789abcd",
      {},
    ],
    [`/v1/webhooks/selarti/responses/${"x".repeat(32)}`, {}],
  ])(
    "rejects missing or wrong URL and bearer auth for %s",
    async (url, headers) => {
      const response = await app.inject({
        method: "POST",
        url,
        headers,
        payload: SELARTI_ALL_MESSAGES_FIXTURE,
      });
      expect(response.statusCode).toBe(401);
      expect(inner).not.toHaveBeenCalled();
      expect(response.body).not.toContain(secret);
    },
  );

  it.each([
    [
      "bearer",
      "/v1/webhooks/selarti/responses",
      { authorization: `Bearer ${secret}` },
    ],
    ["query", `/v1/webhooks/selarti/responses?token=${secret}`, {}],
    ["path", `/v1/webhooks/selarti/responses/${secret}`, {}],
  ])(
    "accepts the documented payload with a %s token",
    async (_kind, url, headers) => {
      const response = await app.inject({
        method: "POST",
        url,
        headers,
        payload: {
          ...SELARTI_ALL_MESSAGES_FIXTURE,
          unexpected_provider_field: "kept",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: true });
      expect(inner).toHaveBeenCalledTimes(1);
      expect(inner.mock.calls[0]![0]).toMatchObject({
        version: 1,
        requestId,
        dialogueId,
        threadId: requestId,
        text: SELARTI_ALL_MESSAGES_FIXTURE.message_text,
      });
      expect(JSON.stringify(inner.mock.calls[0]![0])).not.toContain(
        SELARTI_ALL_MESSAGES_FIXTURE.thread_id,
      );
    },
  );

  it("ignores user messages and repeats the same message_id", async () => {
    const user = await app.inject({
      method: "POST",
      url: `/v1/webhooks/selarti/responses?token=${secret}`,
      payload: { ...SELARTI_ALL_MESSAGES_FIXTURE, message_type: "user" },
    });
    expect(user.statusCode).toBe(200);
    expect(user.json()).toEqual({ accepted: true, ignored: true });
    expect(inner).not.toHaveBeenCalled();

    const url = `/v1/webhooks/selarti/responses/${secret}`;
    const first = await app.inject({
      method: "POST",
      url,
      payload: {
        ...SELARTI_ALL_MESSAGES_FIXTURE,
        message_id: "1731336491876x582725124419040777",
      },
    });
    const second = await app.inject({
      method: "POST",
      url,
      payload: {
        ...SELARTI_ALL_MESSAGES_FIXTURE,
        message_id: "1731336491876x582725124419040777",
        message_text: "Повтор",
      },
    });
    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual({ accepted: true, duplicate: true });
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
